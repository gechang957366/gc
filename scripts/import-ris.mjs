#!/usr/bin/env node
// 把从知网 / 万方 / Web of Science / Scopus / ScienceDirect / IEEE Xplore 导出的题录
// 变成周报条目。用于那些"程序抓不到摘要"的库：
// 你手动导出 → 这条命令批量导入 → 自动补中文摘要与关键技术点。
//
//   node scripts/import-ris.mjs 导出文件 [--issue=2026-W45] [--section=field] [--no-curate]
//
// 自动识别格式：RIS / NoteExpress、EndNote(%0)、RefWorks、WoS 纯文本、WoS 制表符分隔。
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRecords, normalizeRecord } from './lib/records.mjs'
import { loadJournals, metricsFor } from './lib/metrics.mjs'
import { shortVenue } from './lib/venues.mjs'
import { curateItem, resolveApiKey } from './lib/deepseek.mjs'
import { buildStandalone } from './lib/standalone.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA = join(ROOT, 'data')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : fallback
}
const file = argv.find((arg) => !arg.startsWith('--'))
const ISSUE = flag('--issue', '')
const SECTION = flag('--section', 'field')
const NO_CURATE = argv.includes('--no-curate')

if (!file || !existsSync(file)) {
  console.error(
    [
      '用法：node scripts/import-ris.mjs <题录文件> [--issue=2026-W45] [--section=field] [--no-curate]',
      '',
      '支持：RIS / NoteExpress / EndNote(%0) / RefWorks / Web of Science 纯文本 / WoS 制表符分隔',
      '导出方法：知网「导出/参考文献 → EndNote 或 RefWorks」；WoS「Export → Plain text file 或 Tab-delimited」；',
      'ScienceDirect / IEEE Xplore「Export citation to RIS」。',
    ].join('\n'),
  )
  process.exit(1)
}

const parsed = readRecords(file)
console.log(`识别格式：${parsed.format}，共 ${parsed.records.length} 条题录`)
if (parsed.records.length === 0) {
  console.error('没解析出任何条目——把文件前 20 行贴给我，我加格式支持。')
  process.exit(1)
}

const journals = loadJournals(join(DATA, 'journals.json'))
const apiKey = NO_CURATE ? undefined : resolveApiKey()
if (!apiKey && !NO_CURATE) console.log('⚠️ 没有 DEEPSEEK_API_KEY：只导入英文信息，中文摘要留空')

const today = new Date()
const pad = (v) => String(v).padStart(2, '0')
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function isoWeek(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return { year: target.getUTCFullYear(), week: Math.ceil(((target - yearStart) / 86400000 + 1) / 7) }
}
const { year, week } = isoWeek(today)
const issueId = ISSUE || `${year}-W${pad(week)}-import`
const issuePath = join(DATA, 'issues', `${issueId}.json`)

const existing = existsSync(issuePath)
  ? JSON.parse(readFileSync(issuePath, 'utf8'))
  : {
      id: issueId,
      label: `${issueId} · 手动导入`,
      week,
      year,
      range: [isoDate(today), isoDate(today)],
      mode: 'incremental',
      generatedAt: `${isoDate(today)}T${pad(today.getHours())}:${pad(today.getMinutes())}:00+08:00`,
      generatedBy: 'import',
      note: `从题录文件导入：${file}`,
      counts: { field: 0, algo: 0, figures: 0 },
      sections: {
        field: { title: '专业前沿', subtitle: '功率预测 · 气象预报 · 雷达流场重构', items: [] },
        algo: { title: '算法进展', subtitle: '大模型 · 时序预测', items: [] },
      },
    }

const known = new Set(
  Object.values(existing.sections).flatMap((section) => (section.items || []).map((item) => String(item.id).toLowerCase())),
)

let added = 0
let skipped = 0
for (const tags of parsed.records) {
  const record = normalizeRecord(tags)
  if (!record.title || record.title.length < 8) {
    skipped += 1
    continue
  }
  const id = (record.doi || `import:${record.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').slice(0, 80)}`).toLowerCase()
  if (known.has(id)) {
    skipped += 1
    continue
  }

  const authors = record.authors.slice(0, 8)
  const yearNum = Number((String(record.date).match(/(19|20)\d{2}/) || [])[0] || year)
  const item = {
    id,
    doi: record.doi || undefined,
    title: record.title,
    titleZh: '',
    authors,
    authorsText: authors.length > 3 ? `${authors.slice(0, 3).join(', ')}, et al.` : authors.join(', '),
    venue: record.venue,
    venueShort: shortVenue(record.venue),
    year: yearNum,
    date: /\d{4}-\d{2}-\d{2}/.test(String(record.date)) ? String(record.date).slice(0, 10) : `${yearNum}-01-01`,
    level: 'SCI',
    citation:
      record.kind === 'conference'
        ? `${authors.slice(0, 3).join(', ')}. ${record.title}[C]//${record.venue}. ${yearNum}.`
        : `${authors.slice(0, 3).join(', ')}. ${record.title}[J]. ${record.venue}, ${yearNum}` +
          (record.volume ? `, ${record.volume}` : '') +
          (record.issue ? `(${record.issue})` : '') +
          (record.pages ? `: ${record.pages}` : '') +
          '.',
    abstractEn: record.abstract,
    abstractZh: '',
    abstractZhSource: '译',
    keyPoints: [],
    keywords: record.keywords.slice(0, 6),
    figures: [],
    relevance: '',
    tags: [],
    section: SECTION,
    kind: record.kind,
    volume: record.volume || undefined,
    issue: record.issue || undefined,
    pages: record.pages || undefined,
    links: [
      ...(record.doi ? [{ label: 'DOI', url: `https://doi.org/${record.doi}` }] : []),
      ...(record.url ? [{ label: '原文', url: record.url }] : []),
    ],
    source: 'import',
  }
  const metrics = metricsFor(journals, item.venue, item.venueShort)
  if (metrics) item.metrics = metrics

  const hasCjk = /[\u4e00-\u9fa5]/.test(record.abstract)
  if (hasCjk) {
    // 中文库导出的摘要本身就是中文
    item.abstractZh = record.abstract
    item.abstractZhSource = '原文'
    item.abstractEn = ''
  }

  if (apiKey && (hasCjk ? item.abstractZh.length > 60 : item.abstractEn.length > 80)) {
    try {
      const { fields } = await curateItem(apiKey, {
        ...item,
        abstractEn: hasCjk ? item.abstractZh : item.abstractEn,
      })
      Object.assign(item, {
        titleZh: fields.titleZh,
        ...(hasCjk ? {} : { abstractZh: fields.abstractZh }),
        keyPoints: fields.keyPoints,
        relevance: fields.relevance,
        keywords: fields.keywords.length ? fields.keywords : item.keywords,
        tags: fields.tags,
      })
      if (!hasCjk) item.abstractZhSource = '译'
    } catch (error) {
      console.log(`  ⚠️ 整理失败（${id}）：${error.message}`)
      item.needsCuration = true
    }
  } else if (!apiKey) {
    item.needsCuration = true
  }

  existing.sections[SECTION].items.push(item)
  known.add(id)
  added += 1
  console.log(`  + [${item.kind}] ${item.title.slice(0, 64)}`)
}

if (added === 0) {
  console.log(`没有新增条目（跳过 ${skipped} 条：重复或缺题名）`)
  process.exit(0)
}

existing.counts = {
  field: existing.sections.field.items.length,
  algo: existing.sections.algo.items.length,
  figures: Object.values(existing.sections).reduce(
    (sum, section) => sum + section.items.reduce((n, item) => n + (item.figures?.length || 0), 0),
    0,
  ),
}
writeFileSync(issuePath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')
console.log(
  `\n已写入 ${issuePath}\n新增 ${added} 条，跳过 ${skipped} 条；${issueId} 现有 ${
    existing.sections.field.items.length + existing.sections.algo.items.length
  } 条`,
)

const indexPath = join(DATA, 'index.json')
const index = JSON.parse(readFileSync(indexPath, 'utf8'))
const entry = {
  id: issueId,
  label: existing.label,
  range: existing.range,
  mode: existing.mode,
  updatedAt: existing.generatedAt,
  counts: existing.counts,
  note: existing.note,
}
const position = (index.issues || []).findIndex((it) => it.id === issueId)
if (position >= 0) index.issues[position] = entry
else index.issues.unshift(entry)
index.current = index.issues[0].id
index.updatedAt = existing.generatedAt
writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
console.log(`索引已更新：current = ${index.current}`)

try {
  buildStandalone({ dataDir: DATA })
  console.log('独立版已重建')
} catch (error) {
  console.log(`独立版重建失败：${error.message}`)
}
