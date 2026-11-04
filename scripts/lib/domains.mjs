// 研究方向（领域）：允许把默认方向换成别的方向，其余流程完全不变。
//
// 目录约定：
//   data/domains.json                  → 方向注册表（id / 名称 / 副标题 / 栏目名）
//   data/                              → 默认方向（power）的数据，历史格式，不动
//   data/domains/<id>/sources.json     → 该方向的检索配置（查询词、方向词、优先期刊、旗舰刊）
//   data/domains/<id>/index.json       → 该方向的期号索引
//   data/domains/<id>/issues/*.json    → 该方向的期号
//   data/journals.json                 → 期刊分区/IF 总表（所有方向共用）
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'

export const DEFAULT_DOMAIN_ID = 'power'

const BUILTIN = {
  id: DEFAULT_DOMAIN_ID,
  label: '功率预测 · 气象 · 雷达流场',
  short: '功率预测',
  subtitle: '功率预测 · 气象预报 · 雷达流场重构 / 大模型 · 时序预测',
  sections: { field: '专业前沿', algo: '算法进展' },
  note: '默认方向：风电/光伏功率预测、数值天气预报、雷达流场重构',
}

/** 读 data/domains.json；文件不存在时退化成"只有一个默认方向"。 */
export function loadDomainRegistry(rootDataDir) {
  const path = join(rootDataDir, 'domains.json')
  if (!existsSync(path)) return { default: DEFAULT_DOMAIN_ID, domains: [BUILTIN] }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const domains = (Array.isArray(raw.domains) ? raw.domains : [])
      .filter((entry) => entry && typeof entry.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(entry.id))
      .map((entry) => ({
        ...BUILTIN,
        ...entry,
        sections: { ...BUILTIN.sections, ...(entry.sections || {}) },
      }))
    if (!domains.length) return { default: DEFAULT_DOMAIN_ID, domains: [BUILTIN] }
    const fallback = domains.find((entry) => entry.id === DEFAULT_DOMAIN_ID) || domains[0]
    const def = domains.some((entry) => entry.id === raw.default) ? raw.default : fallback.id
    return { default: def, domains }
  } catch {
    return { default: DEFAULT_DOMAIN_ID, domains: [BUILTIN] }
  }
}

/** 注册表 + 兜底默认方向，保证默认方向永远排第一。 */
export function listDomains(rootDataDir) {
  const registry = loadDomainRegistry(rootDataDir)
  const domains = [...registry.domains].sort((a, b) => {
    if (a.id === registry.default) return -1
    if (b.id === registry.default) return 1
    return String(a.label).localeCompare(String(b.label), 'zh')
  })
  return { default: registry.default, domains }
}

/** 未知 id 一律回落到默认方向（不会 404，也不会写坏数据）。 */
export function pickDomain(rootDataDir, domainId) {
  const { default: def, domains } = listDomains(rootDataDir)
  const wanted = typeof domainId === 'string' ? domainId.trim() : ''
  const entry = domains.find((item) => item.id === wanted) || domains.find((item) => item.id === def) || domains[0]
  return { entry, isDefault: entry.id === def }
}

/**
 * 解析某个方向的数据位置。默认方向沿用根目录（历史数据不动）。
 * @returns {{id: string, entry: object, dir: string, root: string, isDefault: boolean,
 *            sourcesPath: string, journalsPath: string, issuesDir: string, indexPath: string}}
 */
export function resolveArea(rootDataDir, domainId) {
  const { entry, isDefault } = pickDomain(rootDataDir, domainId)
  const dir = isDefault ? rootDataDir : join(rootDataDir, 'domains', entry.id)
  return {
    id: entry.id,
    entry,
    root: rootDataDir,
    dir,
    isDefault,
    sourcesPath: join(dir, 'sources.json'),
    journalsPath: join(rootDataDir, 'journals.json'),
    issuesDir: join(dir, 'issues'),
    indexPath: join(dir, 'index.json'),
  }
}

const EMPTY_INDEX = (entry) => ({
  schema: 1,
  title: `每周文献速递 · ${entry.short || entry.label}`,
  subtitle: entry.subtitle || '',
  domain: entry.id,
  updatedAt: null,
  current: null,
  coverage: {},
  issues: [],
})

/** 新方向第一次被访问时把目录/空索引建好，界面因此是"空但可用"。 */
export function ensureAreaFiles(area) {
  try {
    mkdirSync(area.issuesDir, { recursive: true })
  } catch {
    /* 目录已存在或没权限，后面读的时候会报出来 */
  }
  if (!existsSync(area.indexPath)) {
    try {
      writeFileSync(area.indexPath, `${JSON.stringify(EMPTY_INDEX(area.entry), null, 2)}\n`, 'utf8')
    } catch {
      /* ignore */
    }
  }
  return area
}

/** 只读地拿某个方向的检索配置（sources.json）。 */
export function readDomainSources(area) {
  try {
    return JSON.parse(readFileSync(area.sourcesPath, 'utf8'))
  } catch {
    return {}
  }
}

// ------------------------------------------------------- 新建 / 编辑 / 删除 ---

const RESERVED_IDS = new Set(['power'])
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'based', 'using', 'via', 'into', 'over', 'under',
  'a', 'an', 'of', 'in', 'on', 'to', 'by', 'or',
])

/** 中文/英文名字 → 可用作目录名的 id（纯中文时给个 domainN）。 */
export function slugify(input, fallback = 'domain') {
  const ascii = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  if (ascii && /^[a-z0-9]/.test(ascii)) return ascii
  return `${fallback}-${Date.now().toString(36).slice(-5)}`
}

/** 中文名 + 英文关键词 → 尽量可读的 id：先试名称，再试前两个关键词。 */
export function domainIdFrom(spec = {}) {
  if (spec.id) return String(spec.id).trim()
  const candidates = [spec.label, ...parseList(spec.queries).slice(0, 3)]
  for (const candidate of candidates) {
    const words = String(candidate || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .slice(0, 2)
    const slug = words.join('-').slice(0, 32)
    // 中文名去掉汉字后可能只剩个 "2"，这种要跳过（必须有字母才像目录名）
    if (slug && /^[a-z0-9][a-z0-9-]*$/.test(slug) && /[a-z]/.test(slug)) return slug
  }
  return `domain-${Date.now().toString(36).slice(-5)}`
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  return String(value || '')
    .split(/[,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** "刊名, 0022-1120" / {name, issn} → {name, issn} */
export function parseJournals(value) {
  const list = Array.isArray(value) ? value : String(value || '').split('\n')
  const out = []
  const seen = new Set()
  for (const raw of list) {
    if (raw && typeof raw === 'object') {
      const name = String(raw.name || '').trim()
      if (!name) continue
      const issn = String(raw.issn || '').trim() || undefined
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ name, ...(issn ? { issn } : {}) })
      continue
    }
    const line = String(raw || '').trim()
    if (!line) continue
    const parts = line.split(/[,，\t]/).map((part) => part.trim())
    const name = parts[0]
    if (!name) continue
    const issnCandidate = parts.slice(1).find((part) => /^\d{4}-?\d{3}[\dX]$/i.test(part))
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, ...(issnCandidate ? { issn: issnCandidate } : {}) })
  }
  return out
}

/** 从关键词里抽方向词（供 core / domain 闸门用）。 */
function keywordsFromQueries(queries, label) {
  const tokens = new Set()
  for (const query of queries) {
    for (const token of String(query).toLowerCase().split(/[^a-z0-9-]+/)) {
      if (token.length > 3 && !STOPWORDS.has(token)) tokens.add(token)
    }
  }
  const asciiLabel = String(label || '')
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word))
  for (const word of asciiLabel) tokens.add(word)
  return [...tokens].slice(0, 24)
}

/** 找一手 ISSN：先查本地分区表，再问 Crossref 的 journals 接口。 */
async function lookupIssn(name, rootDataDir) {
  try {
    const journals = JSON.parse(readFileSync(join(rootDataDir, 'journals.json'), 'utf8'))
    const list = Array.isArray(journals) ? journals : journals.journals || []
    const needle = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '')
    for (const entry of list) {
      const key = String(entry.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
      if (key && (key === needle || key.includes(needle) || needle.includes(key))) {
        if (entry.issn) return entry.issn
      }
    }
  } catch {
    /* 没有分区表就继续问 Crossref */
  }
  try {
    const url =
      'https://api.crossref.org/journals?query=' +
      encodeURIComponent(name) +
      '&rows=1&select=ISSN,title&mailto=' +
      encodeURIComponent(process.env.DWP_MAILTO || 'weekly-paper@example.com')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'dsh-weekly-paper/0.5' } })
    clearTimeout(timer)
    if (!res.ok) return undefined
    const body = await res.json()
    const first = body?.message?.items?.[0]
    const issn = first?.ISSN?.[0]
    return issn ? String(issn) : undefined
  } catch {
    return undefined
  }
}

/**
 * 用一份"新建方向"的表单规格生成 sources.json 内容。
 * 关键词、优先期刊都由用户填；核心词/Scopus 查询/arXiv 话题自动派生，
 * 让新方向一建好就能跟默认方向一样跑（检索、换一批、每周更新都能用）。
 */
async function buildSourcesFromSpec(rootDataDir, spec) {
  const template = JSON.parse(readFileSync(resolveArea(rootDataDir, spec.template || 'power').sourcesPath, 'utf8'))
  const queries = parseList(spec.queries)
  if (!queries.length) throw new Error('至少要给一个检索关键词')
  const journals = parseJournals(spec.journals)
  for (const journal of journals) {
    if (journal.issn) continue
    const issn = await lookupIssn(journal.name, rootDataDir)
    if (issn) journal.issn = issn
  }
  const flagshipNames = parseList(spec.flagship).map((name) => name.toLowerCase())
  const flagship = flagshipNames.length
    ? journals.filter((journal) => flagshipNames.some((word) => journal.name.toLowerCase().includes(word))).map((journal) => journal.name.toLowerCase())
    : []
  const derived = keywordsFromQueries(queries, spec.label)
  const core = parseList(spec.core).length ? parseList(spec.core) : derived
  const rawQueries = journals
    .filter((journal) => journal.name)
    .slice(0, 8)
    .map((journal) => {
      const terms = core.slice(0, 4).join(' OR ')
      return `SRCTITLE("${journal.name}") AND TITLE-ABS-KEY(${terms || 'forecasting'})`
    })
  return {
    config: {
      schema: 1,
      domain: spec.id,
      note: `${spec.label}：查询词、方向词、优先期刊都在这里改，不需要改代码。`,
      journals: journals.map((journal) => ({ name: journal.name, ...(journal.issn ? { issn: journal.issn } : {}), section: 'field' })),
      flagship: flagship.length ? { field: flagship } : {},
      arxiv: {
        field: queries.slice(0, 8),
        algo: template.arxiv?.algo || [],
      },
      core: { field: core, algo: template.core?.algo || [] },
      domain: { field: core, algo: template.domain?.algo || [] },
      exclude: template.exclude || [],
      keywords: { field: core, algo: template.keywords?.algo || [] },
      limits: { maxPerSection: 8, minScore: 2, preprintCap: 2 },
      scopus: {
        note: '新建方向自动生成：主题查询 + 优先期刊定向（含 ISSN 时）。',
        queries: { field: queries.slice(0, 8), algo: template.scopus?.queries?.algo || [] },
        aliases: template.scopus?.aliases || {},
        maxPerQuery: 25,
        abstractBudget: 24,
        rawQueries: { field: rawQueries, algo: [] },
      },
      arxivConferences: template.arxivConferences || {},
    },
    journalsResolved: journals,
    missingIssn: journals.filter((journal) => !journal.issn).map((journal) => journal.name),
  }
}

/**
 * 新建方向：写 sources.json + 空 index.json，并登记到 domains.json。
 * @param {string} rootDataDir
 * @param {{id?: string, label: string, short?: string, subtitle?: string, queries: string|string[],
 *          journals?: string|object[], flagship?: string|string[], core?: string|string[],
 *          sections?: {field?: string, algo?: string}, setDefault?: boolean, template?: string}} spec
 */
export async function createDomain(rootDataDir, spec) {
  const label = String(spec.label || '').trim()
  if (!label) throw new Error('方向名称不能为空')
  const id = domainIdFrom(spec)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('方向 id 只能用小写字母、数字和短横线')
  if (RESERVED_IDS.has(id)) throw new Error(`方向 id「${id}」是内置默认方向，换一个名字`)
  const registryPath = join(rootDataDir, 'domains.json')
  const registry = existsSync(registryPath)
    ? JSON.parse(readFileSync(registryPath, 'utf8'))
    : { schema: 1, default: DEFAULT_DOMAIN_ID, domains: [] }
  if ((registry.domains || []).some((entry) => entry.id === id)) throw new Error(`方向「${id}」已经存在`)

  const { config, journalsResolved, missingIssn } = await buildSourcesFromSpec(rootDataDir, { ...spec, id, label })
  // 注意：这里不能用 resolveArea(rootDataDir, id) —— 此时方向还没登记，
  // resolveArea 会把未知 id 回落到默认方向，把 sources.json 写到 data/ 根上（踩过这个坑）。
  const dir = join(rootDataDir, 'domains', id)
  mkdirSync(join(dir, 'issues'), { recursive: true })
  writeFileSync(join(dir, 'sources.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  writeFileSync(
    join(dir, 'index.json'),
    `${JSON.stringify(
      {
        schema: 1,
        title: `每周文献速递 · ${spec.short || label}`,
        subtitle: spec.subtitle || label,
        domain: id,
        updatedAt: null,
        current: null,
        coverage: {},
        issues: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const entry = {
    id,
    label,
    short: String(spec.short || label).trim(),
    subtitle: String(spec.subtitle || label).trim(),
    sections: {
      field: String(spec.sections?.field || '专业前沿').trim(),
      algo: String(spec.sections?.algo || '算法进展').trim(),
    },
    custom: true,
    note: `关键词：${parseList(spec.queries).join(' / ')}${journalsResolved.length ? `；优先期刊 ${journalsResolved.length} 本` : ''}`,
  }
  registry.domains = [...(registry.domains || []), entry]
  if (spec.setDefault) registry.default = id
  registry.schema = registry.schema || 1
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  return { entry, journals: journalsResolved, missingIssn, default: registry.default }
}

/** 某个方向当前生效的配置摘要（编辑弹窗用它回填，别让用户以为没保存）。 */
export function domainDetail(rootDataDir, id) {
  const area = resolveArea(rootDataDir, id)
  const sources = readDomainSources(area)
  const entry = area.entry
  return {
    entry,
    isDefault: area.isDefault,
    queries: (sources.scopus?.queries?.field || []).slice(0, 12),
    journals: (sources.journals || []).map((journal) => ({
      name: journal.name,
      ...(journal.issn ? { issn: journal.issn } : {}),
    })),
    flagship: sources.flagship?.field || [],
    core: sources.core?.field || [],
    sections: entry.sections || {},
    indexPath: area.indexPath,
  }
}

/** 改一个方向的名称 / 关键词 / 优先期刊 / 旗舰刊 / 是否默认。 */
export async function updateDomain(rootDataDir, id, patch) {
  const registryPath = join(rootDataDir, 'domains.json')
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  const index = (registry.domains || []).findIndex((entry) => entry.id === id)
  if (index < 0) throw new Error(`没有这个方向：${id}`)
  const entry = { ...registry.domains[index] }
  const area = resolveArea(rootDataDir, id)
  const sources = readDomainSources(area)

  if (patch.label) entry.label = String(patch.label).trim()
  if (patch.short) entry.short = String(patch.short).trim()
  if (patch.subtitle) entry.subtitle = String(patch.subtitle).trim()
  if (patch.sections) entry.sections = { ...entry.sections, ...patch.sections }

  const queries = parseList(patch.queries)
  if (queries.length) {
    sources.scopus = { ...(sources.scopus || {}) }
    sources.scopus.queries = { ...(sources.scopus.queries || {}), field: queries.slice(0, 8) }
    sources.arxiv = { ...(sources.arxiv || {}), field: queries.slice(0, 8) }
    // 关键词变了，方向词（core / domain / keywords）必须跟着重算，
    // 否则检索还在用旧的关键词做相关性闸门 —— 表现出来就是"新方向搜出来还是老方向的文章"。
    const derived = keywordsFromQueries(queries, entry.label)
    sources.core = { ...(sources.core || {}), field: derived }
    sources.domain = { ...(sources.domain || {}), field: derived }
    sources.keywords = { ...(sources.keywords || {}), field: derived }
    if (!patch.journals) {
      const rawQueries = (sources.journals || [])
        .slice(0, 8)
        .map((journal) => `SRCTITLE("${journal.name}") AND TITLE-ABS-KEY(${(derived.slice(0, 4).join(' OR ') || 'forecasting')})`)
      sources.scopus.rawQueries = { ...(sources.scopus.rawQueries || {}), field: rawQueries }
    }
  }
  if (patch.journals !== undefined && patch.journals !== null && patch.journals !== '') {
    const journals = parseJournals(patch.journals)
    for (const journal of journals) {
      if (journal.issn) continue
      const issn = await lookupIssn(journal.name, rootDataDir)
      if (issn) journal.issn = issn
    }
    sources.journals = journals.map((journal) => ({ name: journal.name, ...(journal.issn ? { issn: journal.issn } : {}), section: 'field' }))
    sources.scopus = { ...(sources.scopus || {}) }
    const core = (sources.core?.field || []).slice(0, 4)
    sources.scopus.rawQueries = {
      ...(sources.scopus.rawQueries || {}),
      field: journals
        .slice(0, 8)
        .map((journal) => `SRCTITLE("${journal.name}") AND TITLE-ABS-KEY(${(core.join(' OR ') || 'forecasting')})`),
    }
    if (patch.flagship === undefined) {
      // 优先期刊变了，旗舰刊里不存在的名字自动丢掉
      const names = new Set(journals.map((journal) => journal.name.toLowerCase()))
      const kept = (sources.flagship?.field || []).filter((word) => [...names].some((name) => name.includes(word)))
      sources.flagship = kept.length ? { field: kept } : {}
    }
  }
  if (patch.flagship !== undefined) {
    const wanted = parseList(patch.flagship).map((name) => name.toLowerCase())
    const names = (sources.journals || []).map((journal) => journal.name.toLowerCase())
    const kept = wanted.filter((word) => names.some((name) => name.includes(word)))
    sources.flagship = kept.length ? { field: kept } : {}
  }
  // 名称变了，目录条目里的 label/short/subtitle 也要跟着
  writeFileSync(area.sourcesPath, `${JSON.stringify(sources, null, 2)}\n`, 'utf8')
  if (patch.setDefault !== undefined) {
    if (patch.setDefault) registry.default = id
    else if (registry.default === id) registry.default = DEFAULT_DOMAIN_ID
  }
  registry.domains[index] = entry
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  return { entry, default: registry.default }
}

/** 删掉一个方向（连同目录）。默认方向不能删。 */
export function deleteDomain(rootDataDir, id, { keepFiles = false } = {}) {
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('方向 id 不合法')
  if (RESERVED_IDS.has(id)) throw new Error('内置默认方向不能删')
  const registryPath = join(rootDataDir, 'domains.json')
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  if (id === registry.default) throw new Error('默认方向不能删；先把别的方向设为默认')
  if (!(registry.domains || []).some((entry) => entry.id === id)) throw new Error(`没有这个方向：${id}`)

  // 目录必须显式按 id 拼出来，不能用 resolveArea：
  // 从注册表摘掉之后再 resolveArea 会把未知 id 回落到默认方向（= data/ 根），
  // 曾经因此把整个 data/ 删过一次。
  const dir = join(rootDataDir, 'domains', id)
  const safeToRemove =
    dir.startsWith(join(rootDataDir, 'domains') + sep) &&
    dir !== rootDataDir &&
    existsSync(dir)

  registry.domains = (registry.domains || []).filter((entry) => entry.id !== id)
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  let removed = false
  if (!keepFiles && safeToRemove) {
    try {
      rmSync(dir, { recursive: true, force: true })
      removed = true
    } catch {
      removed = false
    }
  }
  return { id, removed, default: registry.default }
}
