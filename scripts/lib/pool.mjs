// 候选池：文献检索（/api/search）与"换一批"（/api/reroll）共用的一套取数逻辑。
//
// 为什么要有这一层：老检索是一条 `TITLE-ABS-KEY("wind power forecasting")` 打天下，
// Scopus 按相关度回的前 25 条里混着 Electric Power Systems Research、
// Lecture Notes in Computer Science（书系）这类来源，而 Applied Energy / Energy /
// Renewable Energy / IEEE TSTE 一条都没有——所以"额外搜出来的"和"换一批换出来的"
// 明显比每周精选差一档。实测同一个词，加上 ISSN 期刊限定后前 25 条全部是
// Applied Energy(10) / Energy(8) / Renewable Energy(3) / ECM(1) / IEEE TSTE(2) / TSG(1)。
//
// 现在改成三条互补的路子，取完先按等级排序、同等级内再按相关度排序：
//   ① Scopus 期刊定向：主题词 AND (ISSN(0306-2619) OR ISSN(0960-1481) …)
//   ② Crossref 期刊定向：query.bibliographic + filter=issn:A,issn:B,…（缺的摘要靠 Scopus 补）
//   ③ arXiv：主题检索 + co:（comment）里的顶会录用论文（detectAcceptance 严格判定）
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJournals, metricsFor } from './metrics.mjs'
import { rankOf, detectAcceptance, CONFERENCES, flagshipHit } from './rank.mjs'
import { resolveArea } from './domains.mjs'
import { shortVenue } from './venues.mjs'
import { buildCitation } from './citation.mjs'
import { scopusSearch, scopusAbstract } from './scopus.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
export const DEFAULT_DATA_DIR = join(HERE, '..', '..', 'data')

const MAILTO = process.env.DWP_MAILTO || 'weekly-paper@example.com'
const UA_JSON = { 'User-Agent': `dsh-weekly-paper/0.5 (mailto:${MAILTO})`, Accept: 'application/json' }
const UA_TEXT = { 'User-Agent': `dsh-weekly-paper/0.5 (mailto:${MAILTO})` }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'and', 'or', 'in', 'on', 'to', 'with', 'by', 'from',
  'using', 'based', 'via', 'toward', 'towards', 'under', 'over', 'into', 'its', 'their',
])

/** 期刊定向检索最多带多少个 ISSN（Scopus 查询串别太长）。 */
const MAX_ISSN = 26
/** 一批结果里预印本最多几条（和每周精选的口径一致）。 */
const PREPRINT_CAP = 1
/** 一条摘要短于这个长度就认为"没有摘要"，需要补。 */
const MIN_ABSTRACT = 120

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function normaliseTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
}

/** 查询词 → 检索用 token（去停用词、去标点）。 */
export function queryTokens(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
}

/**
 * 解析"数据位置"：可以直接传 area 对象（domains.mjs 解析出来的），
 * 也可以传 { area } / { dataDir, domain }。
 * 默认方向就在 data/ 根下，其他方向在 data/domains/<id>/，期刊分区总表只有一份。
 */
function areaOf(input = {}) {
  // 直接传的就是 area 本身（seenFromIssues(area) 这类调用）——必须先认出来，
  // 否则会一路回落到默认方向，把别的方向的数据当成自己的。
  if (input && input.sourcesPath && input.journalsPath && input.id) return input
  const { area, dataDir, domain } = input
  if (area && area.sourcesPath) return area
  return resolveArea(dataDir || DEFAULT_DATA_DIR, domain)
}

/** 读 sources.json + journals.json；任一缺失时退回空配置（不会抛错）。 */
export function loadPoolSources(input = DEFAULT_DATA_DIR) {
  let area
  if (typeof input === 'string') area = resolveArea(input)
  else if (input && input.sourcesPath && input.journalsPath) area = input
  else area = areaOf(input)
  let cfg = {}
  try {
    cfg = JSON.parse(readFileSync(area.sourcesPath, 'utf8'))
  } catch {
    cfg = {}
  }
  const journals = loadJournals(area.journalsPath)
  return { cfg, journals, area }
}

const FIELD_VENUE_HINT =
  /energy|power|wind|solar|photovoltaic|renewable|weather|meteorolog|atmospher|climate|remote sensing|forecast|grid|turbine|electric/i
const ALGO_VENUE_HINT =
  /machine learning|knowledge and data|pattern analysis|artificial intelligence|neural|computational|data mining|nature|science|information science/i

/**
 * 优先期刊的 ISSN 列表：sources.json 里点名的刊 + journals.json 里 1/2 区、Q1/Q2、CCF-A 的刊。
 * 这是"同水平的那一批"的来源——不加这一层，Scopus 按相关度回的就是另一批人。
 */
export function priorityIssns({ cfg = {}, journals = [], section = 'field' } = {}) {
  const out = new Map()
  const push = (issn) => {
    const key = String(issn || '').trim().toUpperCase()
    if (/^\d{4}-?\d{3}[\dX]$/.test(key) && !out.has(key)) out.set(key, true)
  }
  for (const journal of cfg.journals || []) {
    if (section === 'algo' && journal.section === 'field') continue
    if (section === 'field' && journal.section === 'algo') continue
    push(journal.issn)
  }
  const declared = out.size
  // 方向自己没点名优先期刊时，别退回"分区表里所有热门刊"：
  // 那样新建方向（例如 wind farm wake）会被能源/电力类大刊的 ISSN 过滤带偏，
  // 搜出来还是功率预测那批。宁可只按关键词检索，结果反而更准。
  if (declared < 2) return [...out.keys()].slice(0, MAX_ISSN)
  for (const journal of journals) {
    const zone = journal.cas?.zone
    const quartile = journal.jcr?.quartile
    const hot = zone === '1区' || zone === '2区' || quartile === 'Q1' || quartile === 'Q2' || journal.ccf === 'A'
    if (!hot) continue
    if (section === 'field' && !FIELD_VENUE_HINT.test(journal.name)) continue
    if (section === 'algo' && !ALGO_VENUE_HINT.test(journal.name) && !FIELD_VENUE_HINT.test(journal.name)) continue
    push(journal.issn)
  }
  return [...out.keys()].slice(0, MAX_ISSN)
}

function scopusTopicExpression(query) {
  const tokens = queryTokens(query)
  const phrase = `TITLE-ABS-KEY("${String(query).replace(/"/g, ' ')}")`
  if (tokens.length <= 1) return phrase
  const conjunction = tokens.map((token) => `TITLE-ABS-KEY(${token})`).join(' AND ')
  return `(${phrase} OR (${conjunction}))`
}

function scopusYearClause(years) {
  const fromYear = new Date().getFullYear() - years
  return `PUBYEAR > ${fromYear}`
}

/**
 * Scopus 两路：宽主题 + 期刊定向。
 * @returns {Promise<{entries: object[], stats: object}>}
 */
async function collectScopus({ query, apiKey, years, issns, pages = 2 }) {
  const out = []
  const stats = { topicTotal: 0, journalTotal: 0, requests: 0, error: '' }
  if (!apiKey) return { entries: out, stats: { ...stats, error: 'no-key' } }
  const topic = scopusTopicExpression(query)
  const yearClause = scopusYearClause(years)
  const queries = []
  queries.push({ name: 'topic', query: `${topic} AND ${yearClause}` })
  if (issns.length) {
    const clause = issns.map((issn) => `ISSN(${issn})`).join(' OR ')
    queries.push({ name: 'journal', query: `${topic} AND (${clause}) AND ${yearClause}` })
  }
  for (const entry of queries) {
    for (let page = 0; page < pages; page += 1) {
      const { entries, total, error } = await scopusSearch({
        apiKey,
        query: entry.query,
        count: 25,
        start: page * 25,
      })
      stats.requests += 1
      if (error) {
        stats.error = error
        break
      }
      if (entry.name === 'topic') stats.topicTotal = total
      else stats.journalTotal = total
      out.push(...entries.map((item) => ({ ...item, _rankSource: entry.name })))
      if (entries.length < 25) break
      await sleep(250)
    }
    await sleep(200)
  }
  return { entries: out, stats }
}

/** Crossref：一条请求，用 filter=issn:A,issn:B,… 把范围钉在优先期刊里。 */
async function collectCrossref({ query, years, issns, rows = 100 }) {
  const out = []
  if (!issns.length) return { works: out, total: 0 }
  const from = `${new Date().getFullYear() - years}-01-01`
  const filter = [...issns.map((issn) => `issn:${issn}`), `from-pub-date:${from}`].join(',')
  const url =
    'https://api.crossref.org/works' +
    `?query.bibliographic=${encodeURIComponent(query)}` +
    `&filter=${encodeURIComponent(filter)}` +
    `&rows=${rows}&sort=relevance&order=desc` +
    '&select=DOI,title,container-title,issued,published,author,abstract,volume,issue,page,type' +
    `&mailto=${encodeURIComponent(MAILTO)}`
  try {
    const res = await fetch(url, { headers: UA_JSON })
    if (!res.ok) return { works: out, total: 0, error: `HTTP ${res.status}` }
    const body = await res.json()
    const items = body?.message?.items ?? []
    for (const work of items) {
      if (!work?.DOI) continue
      const title = cleanText((work.title || [])[0])
      if (!title || title.length < 8) continue
      if (work.type && !/journal-article|article|review/i.test(work.type)) continue
      const dateParts = work.published?.['date-parts']?.[0] || work.issued?.['date-parts']?.[0] || []
      const stamp = dateParts.length
        ? `${dateParts[0]}-${String(dateParts[1] || 1).padStart(2, '0')}-${String(dateParts[2] || 1).padStart(2, '0')}`
        : ''
      const authors = (work.author || [])
        .map((person) => [person.family, person.given].filter(Boolean).join(' ').trim())
        .filter(Boolean)
      out.push({
        doi: String(work.DOI).toLowerCase(),
        title,
        venue: cleanText((work['container-title'] || [])[0]),
        date: stamp,
        abstract: cleanText(work.abstract),
        authors,
        volume: work.volume || '',
        issue: work.issue || '',
        pages: work.page || '',
        type: work.type || '',
        _rankSource: 'crossref',
      })
    }
    return { works: out, total: items.length }
  } catch (error) {
    return { works: out, total: 0, error: String(error?.message || error) }
  }
}

function arxivEntries(xml) {
  const out = []
  for (const block of xml.split('<entry>').slice(1)) {
    const pick = (tag) => {
      const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
      return match ? cleanText(match[1]) : ''
    }
    out.push({
      id: pick('id'),
      title: pick('title'),
      summary: pick('summary'),
      published: pick('published').slice(0, 10),
      authors: [...block.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((match) => cleanText(match[1])),
      comment: pick('arxiv:comment'),
      journalRef: pick('arxiv:journal_ref'),
    })
  }
  return out
}

async function arxivQuery(searchQuery, maxResults, sortBy = 'relevance') {
  const url =
    'http://export.arxiv.org/api/query?search_query=' +
    encodeURIComponent(searchQuery) +
    `&sortBy=${sortBy}&sortOrder=descending&max_results=${maxResults}`
  try {
    const res = await fetch(url, { headers: UA_TEXT })
    if (!res.ok) return { entries: [], error: `HTTP ${res.status}` }
    const xml = await res.text()
    return { entries: arxivEntries(xml) }
  } catch (error) {
    return { entries: [], error: String(error?.message || error) }
  }
}

const CONFERENCE_FULL = {
  neurips: 'Conference on Neural Information Processing Systems',
  icml: 'International Conference on Machine Learning',
  iclr: 'International Conference on Learning Representations',
  cvpr: 'IEEE/CVF Conference on Computer Vision and Pattern Recognition',
  iccv: 'IEEE/CVF International Conference on Computer Vision',
  acl: 'Annual Meeting of the Association for Computational Linguistics',
  emnlp: 'Conference on Empirical Methods in Natural Language Processing',
  kdd: 'ACM SIGKDD Conference on Knowledge Discovery and Data Mining',
  www: 'ACM Web Conference',
  sigir: 'ACM SIGIR Conference on Research and Development in Information Retrieval',
  aaai: 'AAAI Conference on Artificial Intelligence',
  ijcai: 'International Joint Conference on Artificial Intelligence',
  vldb: 'International Conference on Very Large Data Bases',
  sigmod: 'ACM SIGMOD International Conference on Management of Data',
  icde: 'IEEE International Conference on Data Engineering',
  naacl: 'Conference of the North American Chapter of the ACL',
  eccv: 'European Conference on Computer Vision',
  cikm: 'ACM International Conference on Information and Knowledge Management',
  wsdm: 'ACM International Conference on Web Search and Data Mining',
  icdm: 'IEEE International Conference on Data Mining',
  coling: 'International Conference on Computational Linguistics',
}

/** 算法侧的顶会那一路：用 arXiv 的 co: 字段直接捞"已被 XXX 录用"。 */
async function collectArxivConferences({ query, years }) {
  const tokens = queryTokens(query)
  const topic = tokens.length
    ? tokens.map((token) => `abs:${token}`).join(' OR ')
    : `abs:"${String(query).replace(/"/g, ' ')}"`
  const venues = Object.keys(CONFERENCES)
    .map((key) => CONFERENCES[key].label)
    .slice(0, 16)
  const coClause = venues.map((label) => `co:${label}`).join(' OR ')
  const { entries, error } = await arxivQuery(`(${coClause}) AND (${topic})`, 40)
  if (error) return { items: [], error }
  const fromDate = `${new Date().getFullYear() - years}-01-01`
  const items = []
  for (const entry of entries) {
    const acceptance = detectAcceptance(entry.comment, entry.journalRef)
    if (!acceptance) continue
    // 会议论文的 published 是首次挂 arXiv 的日子，可能比录用早很久：按录用年份放宽
    const fresh = entry.published >= fromDate || acceptance.year >= new Date().getFullYear() - 1
    if (!fresh) continue
    items.push(buildArxivItem(entry, { section: 'algo', acceptance }))
  }
  return { items }
}

function buildArxivItem(entry, { section = 'algo', acceptance } = {}) {
  const arxivId = (entry.id.match(/abs\/([^/]+)$/) || [])[1] || ''
  const authors = (entry.authors || []).slice(0, 8)
  const info = acceptance ? CONFERENCES[acceptance.key] : undefined
  const venue = acceptance
    ? `${CONFERENCE_FULL[acceptance.key] || info?.label || acceptance.label} (${acceptance.label})`
    : 'arXiv preprint'
  return {
    id: `arxiv:${arxivId}`,
    arxivId,
    title: entry.title,
    titleZh: '',
    authors,
    authorsText:
      authors.length > 3 ? `${authors.slice(0, 3).join(', ')}, et al.` : authors.join(', '),
    venue,
    venueShort: acceptance ? acceptance.label : 'arXiv',
    year: acceptance ? acceptance.year : Number(entry.published.slice(0, 4)) || new Date().getFullYear(),
    date: entry.published,
    level: acceptance ? (acceptance.ccf === 'A' ? 'CCF-A' : 'CCF-B') : 'PREPRINT',
    citation: '',
    abstractEn: entry.summary || '',
    abstractZh: '',
    abstractZhSource: '译',
    keyPoints: [],
    keywords: [],
    figures: [],
    relevance: '',
    tags: [],
    section,
    kind: acceptance ? 'conference' : 'preprint',
    links: [
      { label: '原文', url: entry.id.replace('http://', 'https://') },
      { label: 'PDF', url: entry.id.replace('http://', 'https://').replace('/abs/', '/pdf/') },
    ],
    source: acceptance ? 'arxiv-conf' : 'arxiv',
    ...(entry.comment ? { note: `arXiv 备注：${entry.comment.slice(0, 120)}` } : {}),
  }
}

function scopusItem(entry, { section, aliases }) {
  const doi = String(entry.doi || '').toLowerCase()
  const rawVenue = entry.venue || ''
  const venue = aliases[rawVenue] || rawVenue
  const creators = String(entry.creators || '')
    .split(';')
    .map((name) => name.trim().replace(/\.$/, ''))
    .filter(Boolean)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || '')) ? entry.date : ''
  return {
    id: doi,
    doi,
    title: cleanText(entry.title),
    titleZh: '',
    authors: creators.slice(0, 8),
    authorsText:
      creators.length > 3 ? `${creators.slice(0, 3).join(', ')}, et al.` : creators.join(', '),
    venue,
    venueShort: shortVenue(venue),
    year: Number(String(date).slice(0, 4)) || new Date().getFullYear(),
    date,
    level: /[\u4e00-\u9fa5]/.test(venue) || /^10\.(1109|13334|7500)/.test(doi) ? 'EI' : 'SCI',
    citation: '',
    abstractEn: '',
    abstractZh: '',
    abstractZhSource: '译',
    keyPoints: [],
    keywords: [],
    figures: [],
    relevance: '',
    tags: [],
    section,
    kind: 'journal',
    links: [{ label: 'DOI', url: `https://doi.org/${doi}` }],
    source: 'scopus',
    _aggregation: entry.aggregationType || '',
  }
}

function crossrefItem(work, { section, aliases }) {
  const doi = String(work.doi || '').toLowerCase()
  const venue = aliases[work.venue] || work.venue || ''
  const date = work.date || ''
  const authors = (work.authors || []).slice(0, 8)
  return {
    id: doi,
    doi,
    title: work.title,
    titleZh: '',
    authors,
    authorsText:
      authors.length > 3 ? `${authors.slice(0, 3).join(', ')}, et al.` : authors.join(', '),
    venue,
    venueShort: shortVenue(venue),
    year: Number(date.slice(0, 4)) || new Date().getFullYear(),
    date,
    level: /[\u4e00-\u9fa5]/.test(venue) || /^10\.(1109|13334|7500)/.test(doi) ? 'EI' : 'SCI',
    citation: '',
    abstractEn: work.abstract || '',
    abstractZh: '',
    abstractZhSource: '译',
    keyPoints: [],
    keywords: [],
    figures: [],
    relevance: '',
    tags: [],
    section,
    kind: 'journal',
    volume: work.volume || undefined,
    issue: work.issue || undefined,
    pages: work.pages || undefined,
    links: [{ label: 'DOI', url: `https://doi.org/${doi}` }],
    source: 'crossref',
  }
}

/**
 * 词命中：按词边界匹配，允许常见词形变化（s/es/ed/ing）。
 * 不能用 `\bwake` 这种前缀匹配——"wakefulness" 会把神经科学论文也算成尾流论文。
 */
function wordHit(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![a-z0-9])${escaped}(?:s|es|ed|d|ing)?(?![a-z0-9])`, 'i').test(text)
}

/**
 * 相关度：命中越集中在标题、命中词越全，分越高；
 * strong 为 false 的条目在严格闸门下会被丢掉（"同水平"靠的是闸门，不是运气）。
 */
function relevanceOf(item, tokens, phrase) {
  const title = String(item.title || '').toLowerCase()
  const body = `${title} ${String(item.abstractEn || '').toLowerCase()} ${(item.keywords || []).join(' ').toLowerCase()}`
  const phraseText = String(phrase || '').toLowerCase().trim()
  let titleHits = 0
  let bodyHits = 0
  for (const token of tokens) {
    const inTitle = wordHit(title, token)
    if (inTitle) titleHits += 1
    if (inTitle || wordHit(body, token)) bodyHits += 1
  }
  const phraseInTitle = Boolean(phraseText) && title.includes(phraseText)
  const phraseInBody = Boolean(phraseText) && body.includes(phraseText)
  const ratio = tokens.length ? bodyHits / tokens.length : 1
  // 这里是"补摘要之前"的粗筛：摘要还没取，标题只写了半个主题的好论文不能被误杀，
  // 严格判定放在 matchesQuery（补完摘要之后再判一次）。
  const needTitle = Math.min(tokens.length, Math.max(1, Math.ceil(tokens.length * 0.5)))
  const strong =
    phraseInTitle ||
    (phraseInBody && titleHits >= 1) ||
    titleHits >= needTitle ||
    bodyHits === tokens.length
  const phraseHit = phraseInTitle ? 3 : phraseInBody ? 1.5 : 0
  return { titleHits, bodyHits, ratio, phraseHit, strong, score: titleHits * 3 + bodyHits + phraseHit }
}

/**
 * 严格相关性（补摘要之后再判一次）：标题+摘要里必须覆盖检索词的绝大多数。
 * 门槛这样设计是因为"同水平"的论文本质上都写在标题摘要里，
 * 而 sleep–wake、metasurface control 这类词面命中的噪声只有摘要才看得出来。
 */
export function matchesQuery(item, query) {
  const tokens = queryTokens(query)
  if (!tokens.length) return true
  const title = String(item.title || '').toLowerCase()
  const body = `${title} ${String(item.abstractEn || '').toLowerCase()} ${(item.keywords || []).join(' ').toLowerCase()}`
  const phrase = String(query).toLowerCase().replace(/\s+/g, ' ').trim()
  if (phrase && body.includes(phrase)) return true
  const hit = tokens.filter((token) => wordHit(body, token)).length
  // 三个词以上允许漏一个（"wake steering control" 的论文未必把三个词都写出来），
  // 但方向词闸门（sources.json 的 core）已经把词面噪声挡在外面了。
  const need = tokens.length >= 3 ? tokens.length - 1 : tokens.length
  return hit >= need
}

/**
 * 建池：三条路并行取候选 → 去重 → 相关度闸门 → 期刊等级 → 排序。
 * @returns {Promise<{items: object[], stats: object}>}
 */
export async function buildPool({
  query,
  section = 'field',
  apiKey,
  dataDir = DEFAULT_DATA_DIR,
  domain,
  area,
  years = 5,
  scopusPages = 2,
  crossrefRows = 100,
  arxivMax = 40,
  conferences = true,
  sources = { scopus: true, crossref: true, arxiv: true },
} = {}) {
  const started = Date.now()
  const resolved = areaOf({ area, dataDir, domain })
  const { cfg, journals } = loadPoolSources(resolved)
  const aliases = cfg.scopus?.aliases || {}
  const issns = priorityIssns({ cfg, journals, section })
  const flagshipWords = (cfg.flagship?.[section] || []).map((word) => String(word).toLowerCase())
  const stats = {
    query,
    section,
    domain: resolved.id,
    issns: issns.length,
    scopus: 0,
    flagship: 0,
    flagshipCrossref: 0,
    crossref: 0,
    arxiv: 0,
    arxivConf: 0,
    merged: 0,
    kept: 0,
    dropped: 0,
    errors: [],
    ms: 0,
  }

  const tasks = []
  // 领域旗舰刊单独拉一路：优先期刊那一堆 ISSN 里，旗舰刊的命中常被能量类大刊稀释
  // （尾流方向实测：Applied Energy/Energy 会占满前 25 条，JFM/POF 一条都出不来）
  const flagshipIssns = (cfg.journals || [])
    .filter((journal) => flagshipHit({ venue: journal.name }, flagshipWords) && journal.issn)
    .map((journal) => journal.issn)
    .slice(0, 8)
  if (sources.scopus && apiKey && flagshipIssns.length) {
    tasks.push(
      collectScopus({ query, apiKey, years, issns: flagshipIssns, pages: 1 })
        .then((result) => ({ kind: 'flagship', ...result }))
        .catch((error) => ({ kind: 'flagship', entries: [], stats: {}, error: String(error?.message || error) })),
    )
  }
  if (sources.scopus && apiKey) {
    tasks.push(
      collectScopus({ query, apiKey, years, issns, pages: scopusPages })
        .then((result) => ({ kind: 'scopus', ...result }))
        .catch((error) => ({ kind: 'scopus', entries: [], stats: {}, error: String(error?.message || error) })),
    )
  }
  if (sources.crossref) {
    tasks.push(
      collectCrossref({ query, years, issns, rows: crossrefRows })
        .then((result) => ({ kind: 'crossref', ...result }))
        .catch((error) => ({ kind: 'crossref', works: [], total: 0, error: String(error?.message || error) })),
    )
    if (flagshipIssns.length) {
      tasks.push(
        collectCrossref({ query, years, issns: flagshipIssns, rows: 60 })
          .then((result) => ({ kind: 'crossref-flagship', ...result }))
          .catch((error) => ({ kind: 'crossref-flagship', works: [], total: 0, error: String(error?.message || error) })),
      )
    }
  }
  if (sources.arxiv) {
    const tokens = queryTokens(query)
    const topic = tokens.length
      ? tokens.map((token) => `abs:${token}`).join(' OR ')
      : `all:"${String(query).replace(/"/g, ' ')}"`
    tasks.push(
      arxivQuery(`(${topic})`, arxivMax)
        .then((result) => ({ kind: 'arxiv', ...result }))
        .catch((error) => ({ kind: 'arxiv', entries: [], error: String(error?.message || error) })),
    )
    if (conferences && section === 'algo') {
      tasks.push(
        collectArxivConferences({ query, years })
          .then((result) => ({ kind: 'arxiv-conf', ...result }))
          .catch((error) => ({ kind: 'arxiv-conf', items: [], error: String(error?.message || error) })),
      )
    }
  }

  const results = await Promise.all(tasks)
  const fromDate = `${new Date().getFullYear() - years}-01-01`
  const byKey = new Map()
  const titleSeen = new Set()
  // 勘误/撤稿/社论这些不是研究论文，混进「换一批」很难看
  const NOT_A_PAPER = /^(corrigendum|corrigenda|erratum|retraction|retracted|correction to|editorial|preface|foreword|guest editorial|book review|comment on|reply to|in this issue|table of contents)\b/i
  const add = (item, origin) => {
    if (!item || !item.title) return
    if (NOT_A_PAPER.test(String(item.title).trim())) {
      stats.dropped += 1
      return
    }
    if (item._aggregation && !/journal/i.test(item._aggregation)) {
      stats.dropped += 1
      return
    }
    const key = String(item.id || '').toLowerCase()
    if (!key) return
    const titleKey = normaliseTitle(item.title)
    if (titleSeen.has(titleKey)) return
    const previous = byKey.get(key)
    if (previous) {
      // 同一篇被两条路命中：留摘要更长、期刊信息更全的那条
      const preferNew = (item.abstractEn || '').length > (previous.abstractEn || '').length
      if (preferNew) byKey.set(key, { ...previous, ...item })
      return
    }
    titleSeen.add(titleKey)
    byKey.set(key, { ...item, _origin: origin })
  }

  for (const result of results) {
    if (result.error) stats.errors.push(`${result.kind}: ${result.error}`)
    if (result.kind === 'scopus' || result.kind === 'flagship') {
      const entries = (result.entries || []).filter((entry) => entry.doi)
      if (result.kind === 'scopus') stats.scopus = entries.length
      else stats.flagship = entries.length
      for (const entry of entries) {
        add(scopusItem(entry, { section, aliases }), result.kind === 'flagship' ? 'flagship' : 'scopus')
      }
    } else if (result.kind === 'crossref' || result.kind === 'crossref-flagship') {
      const works = result.works || []
      if (result.kind === 'crossref') stats.crossref = works.length
      else stats.flagshipCrossref = works.length
      for (const work of works) {
        add(crossrefItem(work, { section, aliases }), result.kind === 'crossref' ? 'crossref' : 'flagship')
      }
    } else if (result.kind === 'arxiv') {
      const entries = (result.entries || []).filter(
        (entry) => entry.published && entry.published >= fromDate,
      )
      stats.arxiv = entries.length
      for (const entry of entries) {
        const acceptance = detectAcceptance(entry.comment, entry.journalRef)
        const item = buildArxivItem(entry, { section, acceptance })
        add(item, acceptance ? 'arxiv-conf' : 'arxiv')
      }
    } else if (result.kind === 'arxiv-conf') {
      stats.arxivConf = (result.items || []).length
      for (const item of result.items || []) add(item, 'arxiv-conf')
    }
  }
  stats.merged = byKey.size

  // 领域词表（和每周自动更新同一份 sources.json）：排除词直接丢，主题词用来加权
  const tokens = queryTokens(query)
  const lowerQuery = String(query).toLowerCase()
  const excludeWords = (cfg.exclude || [])
    .map((word) => String(word).toLowerCase())
    .filter((word) => word && !lowerQuery.includes(word))
  const coreWords = (cfg.core?.[section] || []).map((word) => String(word).toLowerCase())
  const domainWords = (cfg.domain?.[section] || []).map((word) => String(word).toLowerCase())

  // 闸门一：搜不到领域外的噪声（stock market / covid 之类）
  const passesDomain = (item) => {
    const text = `${item.title} ${item.abstractEn}`.toLowerCase()
    for (const bad of excludeWords) if (text.includes(bad)) return false
    return true
  }

  // 闸门二：相关度（先严后松，宁可放宽也别把池子清空）
  const scored0 = [...byKey.values()].filter(passesDomain)
  // 闸门三：方向词。sources.json 的 core 是"这个方向确实在用的说法"，
  // 用它能把 sleep–wake / metasurface control 这种词面命中挡在外面；
  // 只有池子还够用时才收紧，避免冷门检索词被清空。
  const withCore = scored0.filter((item) => {
    const text = `${item.title} ${item.abstractEn}`.toLowerCase()
    return coreWords.some((word) => text.includes(word))
  })
  const scored = withCore.length >= 12 ? withCore : scored0
  const strong = scored.filter((item) => relevanceOf(item, tokens, query).strong)
  const loose = scored.filter((item) => {
    const { bodyHits } = relevanceOf(item, tokens, query)
    return tokens.length > 0 && bodyHits === tokens.length
  })
  let kept = strong
  if (kept.length < 12) kept = [...new Map([...strong, ...loose].map((item) => [item.id, item])).values()]
  if (kept.length < 6) kept = scored.filter((item) => relevanceOf(item, tokens, query).ratio >= 0.5)
  if (kept.length < 3) kept = scored.length ? scored : [...byKey.values()]
  stats.kept = kept.length
  stats.dropped += byKey.size - kept.length

  const items = kept.map((item) => {
    const metrics = metricsFor(journals, item.venue, item.venueShort)
    if (metrics) item.metrics = metrics
    // 领域旗舰刊（sources.json 的 flagship，例如尾流方向的 JFM / POF / PRF / JWEIA）：
    // 中科院大类分区未必高，但在本方向就是顶刊，排到最前面。
    if (flagshipHit(item, flagshipWords)) item.flagship = true
    const { rank, tierLabel } = rankOf(item, { flagship: flagshipWords })
    item.rank = rank
    item.tierLabel = tierLabel
    const rel = relevanceOf(item, tokens, query)
    const text = `${item.title} ${item.abstractEn}`.toLowerCase()
    const ageDays = item.date ? (Date.now() - new Date(item.date).getTime()) / 86400000 : 3650
    let score = rel.score * 2 + rel.ratio * 4
    if (ageDays <= 365) score += 3
    else if (ageDays <= 1095) score += 1.5
    if (item.level === 'CCF-A') score += 6
    else if (item.level === 'CCF-B') score += 3
    if (item.source === 'scopus' || item.source === 'crossref') score += 1
    // 方向词（sources.json 的 core/domain）：同等级内优先出真正贴方向的那几篇
    const coreHits = coreWords.reduce((sum, word) => (text.includes(word) ? sum + 1 : sum), 0)
    score += Math.min(coreHits, 4) * 1.5
    if (domainWords.length && !domainWords.some((word) => text.includes(word))) score -= 3
    item._rel = Number(score.toFixed(3))
    return item
  })

  items.sort(
    (a, b) =>
      a.rank - b.rank ||
      b._rel - a._rel ||
      String(b.date).localeCompare(String(a.date)) ||
      String(a.title).localeCompare(String(b.title)),
  )

  stats.ms = Date.now() - started
  return { items, stats }
}

/**
 * 按顺序补齐摘要（Scopus META_ABS），直到有 want 条够长。
 * 会就地改写 item.abstractEn / authors / volume 等字段。
 */
export async function fillAbstracts(items, { apiKey, want = 8, minLen = MIN_ABSTRACT } = {}) {
  if (!apiKey || !items.length) return items
  const need = items.filter((item) => (item.abstractEn || '').length >= minLen)
  if (need.length >= want) return items
  const queue = items.filter((item) => (item.abstractEn || '').length < minLen && item.doi)
  let cursor = 0
  let added = need.length
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (cursor < queue.length && added < want) {
      const item = queue[cursor]
      cursor += 1
      const detail = await scopusAbstract({ apiKey, doi: item.doi })
      await sleep(120)
      if (!detail) continue
      if (detail.abstract && detail.abstract.length >= minLen) {
        item.abstractEn = detail.abstract
        added += 1
      }
      if (detail.title && detail.title.length > item.title.length) item.title = detail.title
      if (detail.authors?.length) {
        item.authors = detail.authors.slice(0, 8)
        item.authorsText =
          item.authors.length > 3
            ? `${item.authors.slice(0, 3).join(', ')}, et al.`
            : item.authors.join(', ')
      }
      if (detail.volume) item.volume = detail.volume
      if (detail.issue) item.issue = detail.issue
      if (detail.pages) item.pages = detail.pages
      if (detail.date && !item.date) item.date = detail.date
    }
  })
  await Promise.all(workers)
  return items
}

/** 把一条补成和速递一样的成品：分区 + 引用。 */
export function finaliseItem(item, { journals = [], section, flagship = [] } = {}) {
  const metrics = metricsFor(journals, item.venue, item.venueShort)
  if (metrics) item.metrics = metrics
  else delete item.metrics
  // flagship 必须一起传：否则这里重算 rank 会把池子里判好的「领域顶刊」覆盖成 JCR Q1
  const { rank, tierLabel } = rankOf(item, { flagship })
  item.rank = rank
  item.tierLabel = tierLabel
  item.citation = buildCitation(item)
  if (section) item.section = section
  if (item.abstractZh) item.abstractZhSource = '译'
  delete item._rel
  delete item._origin
  delete item._aggregation
  return item
}

/**
 * 从池里按等级顺序取下一批（跳过已收录的），同等级优先、预印本限量。
 */
export function pickBatch(items, { count = 8, excludeIds = new Set(), excludeTitles = new Set(), preprintCap = PREPRINT_CAP, minAbstract = 0 } = {}) {
  const picked = []
  let preprints = 0
  for (const item of items) {
    if (picked.length >= count) break
    const id = String(item.id || '').toLowerCase()
    if (!id || excludeIds.has(id)) continue
    if (excludeTitles.has(normaliseTitle(item.title))) continue
    if (minAbstract && (item.abstractEn || '').length < minAbstract) continue
    if (item.level === 'PREPRINT' || item.kind === 'preprint') {
      if (preprints >= preprintCap) continue
      preprints += 1
    }
    picked.push(item)
  }
  return picked
}

/**
 * 同一批里同一本刊最多出 venueCap 篇，避免「换一批」变成一整页 Physics of Fluids。
 * 不够 count 条时再用超额的补回来，不会因为限额导致结果变少。
 */
export function pickDiverse(items, { count = 8, venueCap = 3 } = {}) {
  const picked = []
  const byVenue = new Map()
  const overflow = []
  for (const item of items) {
    if (picked.length >= count) break
    const venue = String(item.venueShort || item.venue || '').toLowerCase()
    const used = byVenue.get(venue) || 0
    if (used >= venueCap) {
      overflow.push(item)
      continue
    }
    byVenue.set(venue, used + 1)
    picked.push(item)
  }
  for (const item of overflow) {
    if (picked.length >= count) break
    picked.push(item)
  }
  return picked
}

// ------------------------------------------------------------------ 缓存 ---
const MEMORY_TTL = 20 * 60 * 1000
const memoryCache = new Map()

function cacheGet(key) {
  const hit = memoryCache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > MEMORY_TTL) {
    memoryCache.delete(key)
    return undefined
  }
  return hit.value
}

function cacheSet(key, value) {
  memoryCache.set(key, { at: Date.now(), value })
  if (memoryCache.size > 40) {
    const oldest = [...memoryCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) memoryCache.delete(oldest[0])
  }
}

/** 检索用池：同一关键词 20 分钟内复用（"换一批"翻页才不会重复抓）。 */
export async function searchPool({ query, section = 'field', apiKey, dataDir = DEFAULT_DATA_DIR, domain, years = 5 } = {}) {
  const area = areaOf({ dataDir, domain })
  const key = `search|${area.id}|${section}|${years}|${String(query).toLowerCase()}`
  const cached = cacheGet(key)
  if (cached) return cached
  const pool = await buildPool({ query, section, apiKey, area, years })
  cacheSet(key, pool)
  return pool
}

const POOL_TTL = 12 * 60 * 60 * 1000

/** 检索词指纹（几行小哈希，够用来区分不同配置的池子）。 */
function fingerprintOf(list) {
  const text = (Array.isArray(list) ? list : []).join('|').toLowerCase()
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 0xffffffff
  }
  return hash.toString(36)
}

/** "换一批"用池：写盘缓存，免得每次点都重新抓一遍（12 小时内复用）。 */
export async function rerollPool({ section = 'field', apiKey, dataDir = DEFAULT_DATA_DIR, domain, area, years = 4, queries } = {}) {
  // area 必须透传：漏了它就会回落到默认方向，池子里用的是别的方向的期刊/旗舰刊配置
  const resolvedArea = areaOf({ area, dataDir, domain })
  const areaId = resolvedArea.id
  const { cfg } = loadPoolSources(resolvedArea)
  const list = (queries && queries.length ? queries : cfg.scopus?.queries?.[section] || []).slice(0, 4)
  // 缓存键要带上检索词指纹：改了方向的关键词之后，旧池子必须失效，
  // 否则「换一批」还会拿上一版关键词抓的那批（这就是改了配置却还是旧结果的原因）。
  const fingerprint = fingerprintOf(list)
  const key = `reroll|${areaId}|${section}|${years}|${fingerprint}`
  const memory = cacheGet(key)
  if (memory) return memory
  const poolDir = join(resolvedArea.dir, '.pool')
  const poolPath = join(poolDir, `${section}-${years}y-${fingerprint}.json`)
  if (existsSync(poolPath)) {
    try {
      const cached = JSON.parse(readFileSync(poolPath, 'utf8'))
      if (Date.now() - (cached.builtAt || 0) < POOL_TTL) {
        const value = { items: cached.items || [], stats: { ...(cached.stats || {}), cached: true } }
        cacheSet(key, value)
        return value
      }
    } catch {
      /* 缓存坏了就重建 */
    }
  }
  const merged = new Map()
  const stats = { domain: areaId, queries: list, per: [], dropped: 0 }
  for (const query of list) {
    const { items, stats: one } = await buildPool({ query, section, apiKey, area: resolvedArea, years, scopusPages: 2, crossrefRows: 100 })
    stats.per.push({ query, kept: items.length, merged: one.merged, scopus: one.scopus, crossref: one.crossref, arxiv: one.arxiv })
    for (const item of items) {
      const key = String(item.id).toLowerCase()
      if (!key || merged.has(key)) continue
      merged.set(key, item)
    }
    await sleep(300)
  }
  const items = [...merged.values()].sort(
    (a, b) => a.rank - b.rank || (b._rel || 0) - (a._rel || 0) || String(b.date).localeCompare(String(a.date)),
  )
  const value = { items, stats }
  cacheSet(key, value)
  try {
    mkdirSync(poolDir, { recursive: true })
    const slim = items.map((item) => ({ ...item }))
    writeFileSync(poolPath, `${JSON.stringify({ builtAt: Date.now(), stats, items: slim }, null, 2)}\n`, 'utf8')
  } catch {
    /* 写缓存失败不影响本次返回 */
  }
  return value
}

/** 已收录过的 id / 标题（"换一批"要跳过它们）。 */
export function seenFromIssues(input = DEFAULT_DATA_DIR) {
  const area = typeof input === 'string' ? resolveArea(input) : areaOf(input)
  const ids = new Set()
  const titles = new Set()
  const issuesDir = area.issuesDir
  if (!existsSync(issuesDir)) return { ids, titles }
  for (const name of readdirSync(issuesDir).filter((file) => file.endsWith('.json'))) {
    try {
      const issue = JSON.parse(readFileSync(join(issuesDir, name), 'utf8'))
      for (const section of Object.values(issue.sections || {})) {
        for (const item of section.items || []) {
          if (item.id) ids.add(String(item.id).toLowerCase())
          if (item.title) titles.add(normaliseTitle(item.title))
        }
      }
    } catch {
      /* 跳过坏文件 */
    }
  }
  return { ids, titles }
}
