#!/usr/bin/env node
// 每周自动更新：抓新文献 → DeepSeek 整理成中文卡片 → 落成新一期 → 重建独立版。
//
//   node scripts/update-weekly.mjs               # 正常跑（默认窗口：上一期之后 → 今天）
//   node scripts/update-weekly.mjs --dry-run     # 只打印将要写入的条目，不落盘
//   node scripts/update-weekly.mjs --no-curate   # 不调模型，只存英文摘要
//   node scripts/update-weekly.mjs --rebuild     # 只重建独立版 HTML
//
// 设计原则：
// - 数据源只用能拿到"逐字摘要"的：Crossref（部分出版社）、arXiv、以及配置里列的刊。
// - 拿不到摘要的候选直接丢弃，绝不写字。
// - 没有 API key 也能跑（只是没有中文摘要与关键技术点）。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJournals, metricsFor } from './lib/metrics.mjs'
import { shortVenue } from './lib/venues.mjs'
import { scopusSearch, scopusAbstract, buildQuery } from './lib/scopus.mjs'
import { rankOf, detectAcceptance, CONFERENCES } from './lib/rank.mjs'
import { curateItem, resolveApiKey } from './lib/deepseek.mjs'
import { buildStandalone, buildSite } from './lib/standalone.mjs'
import { resolveArea } from './lib/domains.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const MAILTO = process.env.DWP_MAILTO || 'weekly-paper@example.com'

const args = new Set(process.argv.slice(2))
const flagValue = (name, fallback) => {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : fallback
}
/** 数据目录可覆盖（测试时指向一份拷贝，不动真数据）。 */
const ROOT_DATA = resolve(flagValue('--data-dir', join(ROOT, 'data')))
/** 研究方向：--domain=wake → 写进 data/domains/wake/；不传就是默认方向。 */
const AREA = resolveArea(ROOT_DATA, flagValue('--domain', '') || undefined)
const DATA = AREA.dir
const DOMAIN_ID = AREA.id
const DRY_RUN = args.has('--dry-run')
const NO_CURATE = args.has('--no-curate')
const NO_SUMMARY = args.has('--no-summary')
const REBUILD_ONLY = args.has('--rebuild')

const logsDir = join(ROOT_DATA, 'logs')
mkdirSync(logsDir, { recursive: true })
// 新方向第一次跑：把 issues/ 建好（index.json 由后面的写入步骤生成）
mkdirSync(join(DATA, 'issues'), { recursive: true })
const logPath = join(logsDir, `update-${new Date().toISOString().slice(0, 10)}.log`)
const logLines = []
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`
  logLines.push(line)
  console.log(line)
}
function flushLog() {
  if (logLines.length === 0) return
  appendFileSync(logPath, `${logLines.join('\n')}\n`, 'utf8')
  logLines.length = 0
}

// ---------------------------------------------------------------- helpers ---
const pad = (value) => String(value).padStart(2, '0')
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
function localIso(date = new Date()) {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = pad(Math.floor(Math.abs(offset) / 60))
  const minutes = pad(Math.abs(offset) % 60)
  return `${isoDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${hours}:${minutes}`
}
function isoWeek(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return { year: target.getUTCFullYear(), week: Math.ceil(((target - yearStart) / 86400000 + 1) / 7) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function formatAuthors(list) {
  const names = (list || [])
    .map((entry) => (typeof entry === 'string' ? entry : `${entry.family ?? ''} ${(entry.given ?? '').replace(/[^A-Za-z]/g, '').slice(0, 1)}`).trim())
    .filter(Boolean)
  if (names.length === 0) return ''
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')}, et al.`
}

function buildCitation(item) {
  const authors = (item.authorsText || '').replace(/\.$/, '')
  const prefix = authors ? `${authors}. ` : ''
  const year = item.year
  if (item.kind === 'conference') {
    return `${prefix}${item.title}[C]//${item.venue}. ${year}.`
  }
  if (item.kind === 'preprint') {
    return `${prefix}${item.title}[EB/OL]. arXiv:${item.arxivId}, ${year}.`
  }
  const volume = item.volume ? `, ${year}, ${item.volume}` : `, ${year}`
  const issue = item.issue ? `(${item.issue})` : ''
  const pages = item.pages ? `: ${item.pages}` : ''
  return `${prefix}${item.title}[J]. ${item.venue}${volume}${issue}${pages}.`
}

// ------------------------------------------------------------- collectors ---
function crossrefItem(work, section) {
  const venue = (work['container-title'] || [''])[0] || ''
  const authors = work.author || []
  const online = work['published-online']?.['date-parts']?.[0]
  const issued = work.issued?.['date-parts']?.[0]
  const fullDate = online && online.length === 3 ? online : issued || []
  // 没有精确到日的日期就不收：否则会把"只有期次年份"的老文章当成本周新增
  if (fullDate.length !== 3) return undefined
  const abstract = cleanText(work.abstract || '')
  const item = {
    id: (work.DOI || '').toLowerCase(),
    doi: work.DOI,
    title: cleanText((work.title || [''])[0]),
    titleZh: '',
    authors: authors.slice(0, 8).map((entry) => `${entry.family ?? ''} ${(entry.given ?? '').replace(/[^A-Za-z]/g, '').slice(0, 1)}`.trim()),
    authorsText: formatAuthors(authors),
    venue,
    venueShort: shortVenue(venue),
    year: fullDate[0] || new Date().getFullYear(),
    date: fullDate.length === 3 ? `${fullDate[0]}-${pad(fullDate[1])}-${pad(fullDate[2])}` : `${fullDate[0] || new Date().getFullYear()}-01-01`,
    level: 'SCI',
    citation: '',
    abstractEn: abstract,
    abstractZh: '',
    abstractZhSource: '译',
    keyPoints: [],
    keywords: [],
    figures: [],
    relevance: '',
    tags: [],
    section,
    kind: 'journal',
    volume: work.volume,
    issue: work.issue,
    pages: work.page,
    links: [{ label: 'DOI', url: `https://doi.org/${work.DOI}` }],
    source: 'crossref',
  }
  item.citation = buildCitation(item)
  return item
}

// --- Elsevier API（需要免费 key：https://dev.elsevier.com） -------------------
// 取值顺序：环境变量 → 命令行 --elsevier-key= → 密钥文件（data/.elsevier-key）
function readKeyFile() {
  for (const candidate of [join(DATA, '.elsevier-key'), join(ROOT_DATA, '.elsevier-key'), join(ROOT, '.elsevier-key')]) {
    try {
      if (existsSync(candidate)) return readFileSync(candidate, 'utf8').trim()
    } catch {
      /* 忽略 */
    }
  }
  return ''
}
const ELSEVIER_KEY = process.env.ELSEVIER_API_KEY || flagValue('--elsevier-key', '') || readKeyFile()

/** 用 Elsevier 官方 API 取摘要；没有 key 或该 DOI 没摘要时返回 undefined。 */
async function elsevierAbstract(doi) {
  if (!ELSEVIER_KEY || !doi) return undefined
  const url =
    'https://api.elsevier.com/content/abstract/doi/' +
    encodeURIComponent(doi) +
    '?apiKey=' +
    encodeURIComponent(ELSEVIER_KEY)
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return undefined
    const body = await res.json()
    const coredata = body?.['abstracts-retrieval-response']?.coredata
    const desc = coredata?.['dc:description']
    if (typeof desc === 'string' && desc.trim()) return cleanText(desc)
    if (desc && typeof desc === 'object' && typeof desc['$'] === 'string') return cleanText(desc['$'])
  } catch {
    return undefined
  }
  return undefined
}

async function collectCrossref(cfg, from, until, journals) {
  const out = []
  let budget = 0
  const seenIssn = new Set()
  for (const journal of journals) {
    if (!journal.issn) continue
    // 用 works?filter=issn: 而不是 /journals/<issn>/works：后者对部分 ISSN 会 404
    if (seenIssn.has(journal.issn)) continue
    seenIssn.add(journal.issn)
    const url =
      'https://api.crossref.org/works' +
      `?filter=issn:${journal.issn},from-pub-date:${from},until-pub-date:${until}` +
      (journal.publisher === 'elsevier' && ELSEVIER_KEY ? '' : ',has-abstract:true') +
      `&rows=25&sort=published&order=desc` +
      `&select=DOI,title,container-title,issued,published-online,author,abstract,volume,issue,page` +
      `&mailto=${encodeURIComponent(MAILTO)}`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': `dsh-weekly-paper/0.2 (mailto:${MAILTO})` } })
      budget += 1
      if (!res.ok) {
        log(`  crossref ${journal.name} → HTTP ${res.status}`)
        continue
      }
      const body = await res.json()
      const works = body?.message?.items ?? []
      let kept = 0
      for (const work of works) {
        const section = journal.section === 'both' ? 'algo' : journal.section
        const item = crossrefItem(work, section)
        if (!item) continue
        if (!item.id || !item.title) continue
        // Elsevier 的摘要在 Crossref 里没有，有 key 就走官方 API 补
        if (item.abstractEn.length < 120 && journal.publisher === 'elsevier') {
          const fetched = await elsevierAbstract(item.doi)
          if (fetched) item.abstractEn = fetched
          await sleep(150)
        }
        if (item.abstractEn.length < 120) continue
        out.push(item)
        kept += 1
      }
      log(`  crossref ${journal.name}: ${works.length} 条候选，保留 ${kept}`)
    } catch (error) {
      log(`  crossref ${journal.name} 失败：${error.message}`)
    }
    await sleep(250)
  }
  log(`crossref 共 ${budget} 个刊、${out.length} 条带摘要候选`)
  return out
}

const VENUE_FULL = {
  neurips: 'Conference on Neural Information Processing Systems',
  nips: 'Conference on Neural Information Processing Systems',
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
}

function detectVenue(comment, published) {
  const text = String(comment || '').toLowerCase()
  if (!text) return undefined
  for (const [key, full] of Object.entries(VENUE_FULL)) {
    if (!text.includes(key)) continue
    const yearMatch = text.match(/(20\d{2})/)
    const year = yearMatch ? Number(yearMatch[1]) : new Date(published).getFullYear()
    return { key, full, year, label: `${key.toUpperCase()} ${year}` }
  }
  return undefined
}

function arxivEntries(xml) {
  const entries = []
  const blocks = xml.split('<entry>').slice(1)
  for (const block of blocks) {
    const pick = (tag) => {
      const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
      return match ? match[1].trim() : ''
    }
    entries.push({
      id: pick('id'),
      title: cleanText(pick('title')),
      summary: cleanText(pick('summary')),
      published: pick('published'),
      updated: pick('updated'),
      comment: cleanText(pick('arxiv:comment')),
      journalRef: cleanText(pick('arxiv:journal_ref')),
      authors: [...block.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => cleanText(m[1])),
      primary: pick('arxiv:primary_category'),
    })
  }
  return entries
}

/**
 * Scopus 一路：覆盖 Elsevier 四刊、IEEE、以及中文核心（电机工程学报 / 电力系统自动化）。
 * 检索用 Scopus，摘要用 `view=META_ABS` 单篇取，逐字、体量小。
 */
async function collectScopus(cfg, from, until, apiKey, seen) {
  const out = []
  if (!apiKey) return out
  const conf = cfg.scopus || {}
  const aliases = conf.aliases || {}
  const budget = conf.abstractBudget ?? 20
  const candidates = []

  for (const section of ['field', 'algo']) {
    const terms = conf.queries?.[section] || []
    const rawQueries = conf.rawQueries?.[section] || []
    const queries = [
      ...(terms.length ? [buildQuery(terms, from, until)] : []),
      ...rawQueries.map((raw) =>
        `${raw}${/PUBYEAR|PUBDATETXT/i.test(raw) ? '' : ` AND PUBYEAR > ${Number(String(from).slice(0, 4)) - 1}`}`,
      ),
    ]
    if (!queries.length) continue
    for (const query of queries) {
      const { entries, total, error } = await scopusSearch({
        apiKey,
        query,
        count: conf.maxPerQuery ?? 25,
      })
      if (error) {
        log(`  scopus[${section}] 检索失败：${error}`)
        continue
      }
      let fresh = 0
      // 只收"最近 120 天内"的期次封面日：再老的即使没收录过，也不该进本周新增
      const tooOld = isoDate(new Date(Date.now() - 120 * 86400000))
      for (const entry of entries) {
        if (!entry.doi) continue
        if (entry.date && entry.date < tooOld) continue
        if (seen.has(entry.doi)) continue
        if (candidates.some((item) => item.doi === entry.doi)) continue
        candidates.push({ ...entry, section })
        fresh += 1
      }
      log(`  scopus[${section}]「${query.slice(0, 60)}…」命中 ${total} 条，窗口内新文献 ${fresh} 条`)
      await sleep(600)
    }
  }

  if (candidates.length === 0) {
    log('scopus 无新候选')
    return out
  }

  // 先按关键词粗排，再对前 budget 条取摘要
  for (const candidate of candidates) {
    candidate.score = scoreItem(
      { title: candidate.title, abstractEn: candidate.title, date: candidate.date, level: 'SCI' },
      cfg,
      candidate.section,
    )
  }
  candidates.sort((a, b) => b.score - a.score)
  const shortlist = candidates.slice(0, budget)
  log(`scopus 待取摘要 ${shortlist.length} 条（候选 ${candidates.length} 条）`)

  for (const candidate of shortlist) {
    const detail = await scopusAbstract({ apiKey, doi: candidate.doi })
    await sleep(250)
    if (!detail || !detail.abstract || detail.abstract.length < 120) {
      log(`  scopus 摘要缺失：${candidate.doi}`)
      continue
    }
    const venue = aliases[detail.venue] || aliases[candidate.venue] || detail.venue || candidate.venue
    // 作者：META_ABS 视图常常只回第一作者，检索结果里的 dc:creator 才是全名单
    const fromCreators = String(candidate.creators || '')
      .split(';')
      .map((name) => name.trim().replace(/\.$/, ''))
      .filter(Boolean)
    const fromDetail = (detail.authors || []).filter(Boolean)
    const authors = (fromCreators.length >= fromDetail.length ? fromCreators : fromDetail).slice(0, 8)
    const fullDate = /^\d{4}-\d{2}-\d{2}$/.test(String(detail.date || '')) ? detail.date : candidate.date
    const coverDate = /^\d{4}-\d{2}-\d{2}$/.test(String(fullDate || '')) ? fullDate : until
    // 期次封面日可能在未来（在线首发但排到明年某期）：展示用今天，真期次存 coverDate
    const futureDated = coverDate > until
    const item = {
      id: candidate.doi,
      doi: candidate.doi,
      title: detail.title || candidate.title,
      titleZh: '',
      authors,
      authorsText: (authors.length > 3 ? authors.slice(0, 3).join(', ') + ', et al.' : authors.join(', ')).replace(/\.$/, ''),
      venue,
      venueShort: shortVenue(venue),
      publisher: /^10\.1016/.test(candidate.doi) ? 'Elsevier' : /^10\.1109/.test(candidate.doi) ? 'IEEE' : '',
      year: futureDated ? new Date(until).getFullYear() : Number(String(coverDate).slice(0, 4)) || new Date().getFullYear(),
      date: futureDated ? until : coverDate,
      ...(futureDated ? { coverDate, note: `在线首发，期次 ${coverDate}` } : {}),
      level:
        /[\u4e00-\u9fa5]/.test(venue) || /^10\.(1109|13334|7500)/.test(candidate.doi) ? 'EI' : 'SCI',
      citation: '',
      abstractEn: detail.abstract,
      abstractZh: '',
      abstractZhSource: '译',
      keyPoints: [],
      keywords: [],
      figures: [],
      relevance: '',
      tags: [],
      section: candidate.section,
      kind: /proceedings|conference|congress/i.test(detail.aggregationType || '') ? 'conference' : 'journal',
      volume: detail.volume || undefined,
      issue: detail.issue || undefined,
      pages: detail.pages || undefined,
      links: [{ label: 'DOI', url: `https://doi.org/${candidate.doi}` }],
      source: 'scopus',
      score: candidate.score,
    }
    // 引用里的年份用期刊期次年（在线首发排到明年某期时，展示年与引用年不同是正常的）
    item.citation = buildCitation(futureDated ? { ...item, year: Number(String(coverDate).slice(0, 4)) } : item)
    out.push(item)
  }
  log(`scopus 收到 ${out.length} 条带摘要文献`)
  return out
}

/**
 * 顶会那一路：用 arXiv 的 `co:`（comment）字段直接捞"已被 XXX 2026 录用"的论文。
 * 这是"来源是 arXiv、但确实是顶会论文"的关键——不看 comment 就只能捞到普通预印本。
 */
async function collectArxivConferences(cfg, from) {
  const out = []
  const conf = cfg.arxivConferences || {}
  const venues = conf.venues || []
  if (!venues.length) return out
  const topics = conf.topicQuery || 'abs:"time series" OR abs:forecasting OR abs:"language model"'
  const maxPerVenue = conf.maxPerVenue ?? 15

  for (const venue of venues) {
    const query = `co:"${venue}" AND (${topics})`
    const url =
      'http://export.arxiv.org/api/query?search_query=' +
      encodeURIComponent(query) +
      `&sortBy=submittedDate&sortOrder=descending&max_results=${maxPerVenue}`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': `dsh-weekly-paper/0.3 (mailto:${MAILTO})` } })
      if (!res.ok) {
        log(`  arxiv-co "${venue}" → HTTP ${res.status}`)
        continue
      }
      const xml = await res.text()
      let kept = 0
      for (const entry of arxivEntries(xml)) {
        if (!entry.published) continue
        const published = entry.published.slice(0, 10)
        if (published < from) continue
        const acceptance = detectAcceptance(entry.comment, entry.journalRef, venue)
        if (!acceptance) continue
        const arxivId = (entry.id.match(/abs\/([^/]+)$/) || [])[1] || ''
        const info = CONFERENCES[acceptance.key] || { label: venue.split(' ')[0] }
        const fullName = VENUE_FULL[acceptance.key] || info.label
        const item = {
          id: `arxiv:${arxivId}`,
          arxivId,
          title: entry.title,
          titleZh: '',
          authors: entry.authors.slice(0, 8),
          authorsText: formatAuthors(
            entry.authors.map((name) => ({
              family: name.split(' ').slice(-1)[0],
              given: name.split(' ').slice(0, -1).join(' '),
            })),
          ),
          venue: `${fullName} (${acceptance.label})`,
          venueShort: acceptance.label,
          year: acceptance.year,
          date: published,
          level: acceptance.ccf === 'A' ? 'CCF-A' : 'CCF-B',
          citation: '',
          abstractEn: entry.summary,
          abstractZh: '',
          abstractZhSource: '译',
          keyPoints: [],
          keywords: [],
          figures: [],
          relevance: '',
          tags: [],
          section: 'algo',
          kind: 'conference',
          acceptance: { venue: acceptance.label, ccf: acceptance.ccf, kind: acceptance.kind, evidence: entry.comment.slice(0, 160) },
          links: [
            { label: '原文', url: entry.id.replace('http://', 'https://') },
            { label: 'PDF', url: entry.id.replace('http://', 'https://').replace('/abs/', '/pdf/') },
          ],
          source: 'arxiv-conference',
        }
        if (item.abstractEn.length < 120) continue
        item.citation = buildCitation(item)
        out.push(item)
        kept += 1
      }
      log(`  arxiv-co "${venue}": 命中录用 ${kept} 条`)
    } catch (error) {
      log(`  arxiv-co "${venue}" 失败：${error.message}`)
    }
    await sleep(1200)
  }
  return out
}

async function collectArxiv(cfg, from, queries) {
  const out = []
  const top = new Set((cfg.topVenues || []).map((v) => v.toLowerCase()))
  const ccfA = new Set((cfg.ccfA || []).map((v) => v.toLowerCase()))
  const ccfB = new Set((cfg.ccfB || []).map((v) => v.toLowerCase()))
  for (const query of queries) {
    const url =
      'http://export.arxiv.org/api/query?search_query=' +
      encodeURIComponent(`all:"${query}"`) +
      '&sortBy=submittedDate&sortOrder=descending&max_results=25'
    try {
      const res = await fetch(url, { headers: { 'User-Agent': `dsh-weekly-paper/0.2 (mailto:${MAILTO})` } })
      if (!res.ok) {
        log(`  arxiv "${query}" → HTTP ${res.status}`)
        continue
      }
      const xml = await res.text()
      let kept = 0
      for (const entry of arxivEntries(xml)) {
        if (!entry.published) continue
        const published = entry.published.slice(0, 10)
        if (published < from || published > `${new Date().getFullYear()}-12-31`) continue
        const arxivId = (entry.id.match(/abs\/([^/]+)$/) || [])[1] || ''
        const venue = detectVenue(entry.comment, entry.published)
        const level = venue ? (ccfA.has(venue.key) ? 'CCF-A' : ccfB.has(venue.key) ? 'CCF-B' : 'PREPRINT') : 'PREPRINT'
        if (venue && !top.has(venue.key)) continue
        const item = {
          id: `arxiv:${arxivId}`,
          arxivId,
          title: entry.title,
          titleZh: '',
          authors: entry.authors.slice(0, 8),
          authorsText: formatAuthors(entry.authors.map((name) => ({ family: name.split(' ').slice(-1)[0], given: name.split(' ').slice(0, -1).join(' ') }))),
          venue: venue ? `${venue.full} (${venue.label})` : 'arXiv preprint',
          venueShort: venue ? venue.label : 'arXiv',
          year: Number(published.slice(0, 4)),
          date: published,
          level,
          citation: '',
          abstractEn: entry.summary,
          abstractZh: '',
          abstractZhSource: '译',
          keyPoints: [],
          keywords: [],
          figures: [],
          relevance: '',
          tags: [],
          section: 'algo',
          kind: venue ? 'conference' : 'preprint',
          links: [
            { label: venue ? '原文' : '预印本', url: entry.id.replace('http://', 'https://') },
            { label: 'PDF', url: entry.id.replace('http://', 'https://').replace('/abs/', '/pdf/') },
          ],
          source: 'arxiv',
        }
        item.citation = buildCitation(item)
        if (item.abstractEn.length < 120) continue
        out.push(item)
        kept += 1
      }
      log(`  arxiv "${query}": 保留 ${kept}`)
    } catch (error) {
      log(`  arxiv "${query}" 失败：${error.message}`)
    }
    await sleep(1200)
  }
  log(`arxiv 共 ${out.length} 条候选`)
  return out
}

// --------------------------------------------------------------- pipeline ---
function scoreItem(item, cfg, section) {
  const title = item.title.toLowerCase()
  const text = `${item.title} ${item.abstractEn}`.toLowerCase()

  // 明确排除的主题（生态/林业/金融/医学等误命中）
  for (const bad of cfg.exclude || []) {
    if (text.includes(bad.toLowerCase())) return 0
  }
  // 领域闸门：至少出现一个本领域词
  const domain = (cfg.domain?.[section] || []).some((word) => text.includes(word.toLowerCase()))
  if (!domain) return 0

  // 核心词：必须命中至少一个，否则不算相关
  let core = 0
  let coreInTitle = 0
  for (const keyword of cfg.core?.[section] || []) {
    const needle = keyword.toLowerCase()
    if (!text.includes(needle)) continue
    core += 1
    if (title.includes(needle)) coreInTitle += 1
  }
  if (core === 0) return 0
  if (coreInTitle === 0 && core < 3) return 0

  let score = core * 2 + coreInTitle * 3
  for (const keyword of cfg.keywords[section] || []) {
    const needle = keyword.toLowerCase()
    if (!text.includes(needle)) continue
    score += title.includes(needle) ? 2 : 1
  }
  // 算法侧：时序/预测方向比"泛大模型"更贴用户方向，额外加权
  if (section === 'algo' && /time series|forecast|temporal|probabilistic/i.test(title)) score += 8
  if (item.level === 'CCF-A') score += 12
  else if (item.level === 'CCF-B') score += 6
  const days = (Date.now() - new Date(item.date).getTime()) / 86400000
  if (days <= 7) score += 2
  else if (days <= 21) score += 1
  return score
}

function normaliseTitle(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
}

function existingState() {
  const indexPath = join(DATA, 'index.json')
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { issues: [] }
  const seen = new Set()
  const titleSeen = new Set()
  const issuesDir = join(DATA, 'issues')
  const dates = []
  if (existsSync(issuesDir)) {
    for (const name of readdirSync(issuesDir).filter((file) => file.endsWith('.json'))) {
      const issue = JSON.parse(readFileSync(join(issuesDir, name), 'utf8'))
      for (const section of Object.values(issue.sections || {})) {
        for (const item of section.items || []) {
          if (item.id) seen.add(String(item.id).toLowerCase())
          titleSeen.add(normaliseTitle(item.title))
          if (item.date) dates.push(String(item.date))
        }
      }
    }
  }
  return { index, seen, titleSeen, dates }
}

async function main() {
  log('=== 每周文献速递 自动更新开始 ===')

  if (REBUILD_ONLY) {
    const result = buildStandalone({ dataDir: ROOT_DATA })
    log(`只重建独立版：${result.path}（${(result.bytes / 1024).toFixed(0)} KB，${result.issues} 期，${result.figures} 张图）`)
    flushLog()
    return
  }

  const cfgPath = join(DATA, 'sources.json')
  if (!existsSync(cfgPath)) throw new Error('缺少 data/sources.json')
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
  const { index, seen, titleSeen, dates } = existingState()
  const journalsInDb = loadJournals(AREA.journalsPath)

  const now = new Date()
  const until = isoDate(now)
  const configuredStart = flagValue('--since', index.coverage?.nextWindowFrom)
  const fallbackStart = isoDate(new Date(now.getTime() - (cfg.limits?.lookbackDays ?? 21) * 86400000))
  const from = configuredStart && configuredStart <= until ? configuredStart : fallbackStart
  log(`检索窗口：${from} → ${until}（上一期覆盖到 ${index.coverage?.to ?? '无'}）`)

  const [crossrefItems, arxivItems, scopusItems, conferenceItems] = await Promise.all([
    collectCrossref(cfg, from, until, cfg.journals || []),
    collectArxiv(cfg, from, [].concat(cfg.arxiv?.field || [], cfg.arxiv?.algo || [])),
    collectScopus(cfg, from, until, ELSEVIER_KEY, seen),
    collectArxivConferences(cfg, from),
  ])

  // 同一个 DOI 可能同时被 Crossref 与 Scopus 命中：保留摘要更长的那条
  const byId = new Map()
  for (const item of [...conferenceItems, ...crossrefItems, ...arxivItems, ...scopusItems]) {
    const key = String(item.id).toLowerCase()
    const previous = byId.get(key)
    if (!previous || (item.abstractEn || '').length > (previous.abstractEn || '').length) {
      byId.set(key, previous ? { ...previous, ...item } : item)
    }
  }
  const pool = [...byId.values()]
  log(
    `合并候选 ${pool.length} 条（顶会 ${conferenceItems.length} / Crossref ${crossrefItems.length} / arXiv ${arxivItems.length} / Scopus ${scopusItems.length}），开始过滤`,
  )

  const fresh = []
  let dropped = { seen: 0, dupTitle: 0, lowScore: 0 }
  for (const item of pool) {
    if (seen.has(String(item.id).toLowerCase())) {
      dropped.seen += 1
      continue
    }
    const titleKey = normaliseTitle(item.title)
    if (titleSeen.has(titleKey)) {
      dropped.dupTitle += 1
      continue
    }
    const section = item.section === 'algo' ? 'algo' : 'field'
    item.score = scoreItem(item, cfg, section)
    if (item.score < (cfg.limits?.minScore ?? 2)) {
      dropped.lowScore += 1
      continue
    }
    fresh.push(item)
  }
  log(`过滤后 ${fresh.length} 条（已收录 ${dropped.seen}，标题重复 ${dropped.dupTitle}，相关性不足 ${dropped.lowScore}）`)

  const maxPerSection = cfg.limits?.maxPerSection ?? 6
  const pickBySection = (section) => {
    const pool2 = fresh.filter((item) => (section === 'algo' ? item.section === 'algo' : item.section !== 'algo'))
    // 先算等级：会议/顶刊/1区/领域旗舰刊 在前，预印本垫底
    const flagship = cfg.flagship?.[section] || []
    for (const item of pool2) {
      const { rank, tierLabel } = rankOf(item, { flagship })
      item.rank = rank
      item.tierLabel = tierLabel
    }
    pool2.sort((a, b) => (a.rank - b.rank) || (b.score - a.score) || String(b.date).localeCompare(String(a.date)))
    const preprintCap = cfg.limits?.preprintCap ?? 2
    const scopusCap = cfg.limits?.scopusAlgoCap ?? 2
    const picked = []
    let preprints = 0
    let scopusCount = 0
    for (const item of pool2) {
      if (item.level === 'PREPRINT') {
        if (preprints >= preprintCap) continue
        preprints += 1
      }
      if (section === 'algo' && item.source === 'scopus') {
        if (scopusCount >= scopusCap) continue
        scopusCount += 1
      }
      picked.push(item)
      if (picked.length >= maxPerSection) break
    }
    return picked
  }
  const selected = [...pickBySection('field'), ...pickBySection('algo')]
  log(`选中：field ${pickBySection('field').length} 条 / algo ${pickBySection('algo').length} 条`)
  for (const item of selected) {
    log(`  [${item.section}] ${item.score}分 ${item.level} ${item.venueShort} ${item.date} · ${item.title.slice(0, 70)}`)
  }

  if (selected.length === 0) {
    log('本期没有新文献，不写入新期号（避免空期）。')
    flushLog()
    return
  }

  const apiKey = NO_CURATE ? undefined : resolveApiKey()
  if (!apiKey && !NO_CURATE) log('⚠️ 没有找到 DEEPSEEK_API_KEY：只保存英文摘要，中文内容留空。')

  let usageTotal = 0
  if (apiKey) {
    let done = 0
    const queue = [...selected]
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift()
        try {
          const { fields, usage } = await curateItem(apiKey, item)
          Object.assign(item, {
            titleZh: fields.titleZh,
            abstractZh: fields.abstractZh,
            keyPoints: fields.keyPoints,
            relevance: fields.relevance,
            keywords: fields.keywords,
            tags: fields.tags.length ? fields.tags : item.tags,
          })
          usageTotal += (usage.total_tokens || 0)
          done += 1
          log(`  整理完成 ${done}/${selected.length}：${fields.titleZh.slice(0, 40)}`)
        } catch (error) {
          log(`  ⚠️ 整理失败（${item.id}）：${error.message}`)
          item.needsCuration = true
        }
      }
    })
    await Promise.all(workers)
    log(`整理调用 token 合计 ${usageTotal}`)
  } else {
    for (const item of selected) item.needsCuration = true
  }

  // 期刊等级
  for (const item of selected) {
    const metrics = metricsFor(journalsInDb, item.venue, item.venueShort) || {}
    if (Object.keys(metrics).length) item.metrics = metrics
  }

  const { year, week } = isoWeek(now)
  let issueId = `${year}-W${pad(week)}`
  // 同一周重复跑时不要覆盖已有期号
  for (let suffix = 2; existsSync(join(DATA, 'issues', `${issueId}.json`)); suffix += 1) {
    issueId = `${year}-W${pad(week)}-${suffix}`
  }
  const field = selected.filter((item) => item.section !== 'algo')
  const algo = selected.filter((item) => item.section === 'algo')
  // 排名要在期刊分区算完之后再算一次（分区信息影响 1 区/Q1 的判断，领域旗舰刊也会在这里被顶上去）
  for (const list of [field, algo]) {
    for (const item of list) {
      const section = item.section === 'algo' ? 'algo' : 'field'
      const { rank, tierLabel } = rankOf(item, { flagship: cfg.flagship?.[section] || [] })
      item.rank = rank
      item.tierLabel = tierLabel
    }
    list.sort((a, b) => (a.rank - b.rank) || String(b.date).localeCompare(String(a.date)))
  }
  selected.length = 0
  selected.push(...field, ...algo)
  const allDates = selected.map((item) => item.date).sort()
  const issue = {
    id: issueId,
    label: `${year}-W${pad(week)} · 自动更新`,
    week,
    year,
    range: [allDates[0], allDates[allDates.length - 1]],
    mode: 'incremental',
    generatedAt: localIso(now),
    generatedBy: 'auto',
    note: `自动抓取 ${from} → ${until} 的新文献；Crossref + arXiv + 刊级检索。`,
    counts: { field: field.length, algo: algo.length, figures: 0 },
    domain: DOMAIN_ID,
    sections: {
      field: {
        title: AREA.entry.sections?.field || '专业前沿',
        subtitle: AREA.entry.subtitle || '功率预测 · 气象预报 · 雷达流场重构',
        items: field,
      },
      algo: { title: AREA.entry.sections?.algo || '算法进展', subtitle: '大模型 · 时序预测', items: algo },
    },
  }

  // 自动生成"本期概述"（写进 sections.<key>.summary，界面默认折叠）
  if (!NO_SUMMARY && apiKey) {
    try {
      const { summarizeSection } = await import('./lib/summary.mjs')
      for (const key of ['field', 'algo']) {
        const list = key === 'field' ? field : algo
        if (!list.length) continue
        try {
          const text = await summarizeSection(key, list, apiKey)
          if (text) {
            issue.sections[key].summary = text
            log(`  ${key} 概述已生成（${text.length} 字）`)
          }
        } catch (error) {
          log(`  ⚠️ ${key} 概述生成失败：${error.message}`)
        }
      }
    } catch (error) {
      log(`  ⚠️ 概述模块加载失败：${error.message}`)
    }
  }

  if (DRY_RUN) {
    log(`[dry-run] 将写入 ${issueId}：field ${field.length} / algo ${algo.length}，不落盘。`)
    flushLog()
    return
  }

  writeFileSync(join(DATA, 'issues', `${issueId}.json`), `${JSON.stringify(issue, null, 2)}\n`, 'utf8')
  log(`已写入 ${join(DATA, "issues", `${issueId}.json`)}`)

  // 重建索引（扫描全部期号，保证 totalItems / figures 准确）
  const issuesDir = join(DATA, 'issues')
  const issueFiles = readdirSync(issuesDir).filter((file) => file.endsWith('.json'))
  const summaries = []
  let totalItems = 0
  let totalFigures = 0
  let minDate = '9999-12-31'
  let maxDate = '0000-01-01'
  for (const file of issueFiles) {
    const data = JSON.parse(readFileSync(join(issuesDir, file), 'utf8'))
    const items = Object.values(data.sections || {}).flatMap((section) => section.items || [])
    const figures = items.reduce((sum, item) => sum + (item.figures?.length || 0), 0)
    totalItems += items.length
    totalFigures += figures
    for (const item of items) {
      if (item.date && item.date < minDate) minDate = item.date
      if (item.date && item.date > maxDate) maxDate = item.date
    }
    summaries.push({
      id: data.id,
      label: data.label || data.id,
      range: data.range || [],
      mode: data.mode || 'incremental',
      updatedAt: data.generatedAt || localIso(now),
      counts: { field: data.sections?.field?.items?.length || 0, algo: data.sections?.algo?.items?.length || 0, figures },
      note: data.note || '',
    })
  }
  summaries.sort((a, b) => String((b.range || [])[1] || '').localeCompare(String((a.range || [])[1] || '')))

  const nextIndex = {
    schema: 1,
    title: index.title || `每周文献速递 · ${AREA.entry.short || AREA.entry.label}`,
    subtitle: index.subtitle || AREA.entry.subtitle || '功率预测 · 气象预报 · 雷达流场重构 / 大模型 · 时序预测',
    domain: DOMAIN_ID,
    updatedAt: localIso(now),
    current: summaries[0]?.id,
    coverage: {
      backfillFrom: index.coverage?.backfillFrom || minDate,
      coveredFrom: dates.length ? [minDate, ...dates].sort()[0] : minDate,
      to: maxDate,
      totalItems,
      figures: totalFigures,
      mode: 'incremental',
      nextWindowFrom: until,
      note: '首轮做过近三年回溯，之后每周只取上一期之后的新文献。',
    },
    issues: summaries,
  }
  writeFileSync(join(DATA, 'index.json'), `${JSON.stringify(nextIndex, null, 2)}\n`, 'utf8')
  log(`index.json 更新完成：${summaries.length} 期 / ${totalItems} 篇 / ${totalFigures} 张图`)

  try {
    const result = buildStandalone({ dataDir: ROOT_DATA })
    log(`独立版重建：${result.path}（${(result.bytes / 1024).toFixed(0)} KB，${result.figures} 张图）`)
  } catch (error) {
    log(`⚠️ 独立版重建失败：${error.message}`)
  }

  // 顺手把"在线版"目录也更新一遍（如果你把它放到了服务器上，覆盖这个目录即可）
  try {
    const site = buildSite({ dataDir: ROOT_DATA })
    log(`在线版重建：${site.path}（${(site.bytes / 1024).toFixed(0)} KB）`)
  } catch (error) {
    log(`⚠️ 在线版重建失败：${error.message}`)
  }

  // 发布到 GitHub（配了 data/publish.json + token 才生效）：这样自己电脑关机了别人也能看
  if (!DRY_RUN) {
    try {
      const { publishToGitHub } = await import('./lib/publish.mjs')
      const published = await publishToGitHub({ dataDir: ROOT_DATA, reason: `weekly-${DOMAIN_ID}` })
      if (published?.ok) {
        const detail = Object.entries(published.branches || {})
          .map(([branch, info]) => `${branch}${info.skipped ? '(无变化)' : `(+${info.uploaded})`}`)
          .join(' ')
        log(`GitHub 已更新：${published.repo} ${detail}${published.pagesUrl ? ` · ${published.pagesUrl}` : ''}`)
      } else if (published?.skipped) {
        log(`GitHub 未推送（${published.reason === 'no-token' ? '没有配 token' : '没有配仓库'}）`)
      } else if (published?.error) {
        log(`⚠️ GitHub 推送失败：${published.error}`)
      }
    } catch (error) {
      log(`⚠️ GitHub 推送异常：${error.message}`)
    }
  }

  log('=== 完成 ===')
  flushLog()
}

main().catch((error) => {
  log(`❌ 失败：${error.stack || error.message}`)
  flushLog()
  process.exitCode = 1
})
