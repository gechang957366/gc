#!/usr/bin/env node
// 把采集结果（_incoming/field.json + algo.json）按时间窗切成三期，写入
// data/issues/*.json 与 data/index.json。
//
//   node scripts/seed-initial.mjs
//
// 首期建库脚本：之后的每周只需要新建一期（照 data/issues/ 里的结构写），
// 或复用 scripts/ingest.mjs 的思路。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJournals, metricsFor } from './lib/metrics.mjs'
import { rankOf } from './lib/rank.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA = join(ROOT, 'data')

const readItems = (file) => {
  const path = join(ROOT, '_incoming', file)
  if (!existsSync(path)) return []
  const body = JSON.parse(readFileSync(path, 'utf8'))
  const items = Array.isArray(body) ? body : body.items ?? []
  return items.filter((item) => item && item.id && item.title)
}

const all = [
  ...readItems('field.json'),
  ...readItems('priority.json'),
  ...readItems('cn.json'),
  ...readItems('algo.json'),
  ...readItems('algo2.json'),
]

// 一条文献只能出现一次：同一 id 保留日期最新的那条
const byId = new Map()
for (const item of all) {
  const previous = byId.get(item.id)
  if (!previous || String(item.date) > String(previous.date)) byId.set(item.id, item)
}
const items = [...byId.values()]

const buckets = [
  {
    id: '2026-W45',
    label: '2026-W45 · 本周新增',
    mode: 'incremental',
    note: '本周新增：最近两个自然周内在线首发的文献（含上周末的补收）。',
    pick: (date) => date >= '2026-10-20',
  },
  {
    id: '2026-W44',
    label: '回溯批次 1',
    mode: 'backfill',
    note: '回溯扫描第 1 批：2026 年 8—10 月的高相关文献，建立基线。',
    pick: (date) => date >= '2026-08-01' && date < '2026-10-20',
  },
  {
    id: '2026-W43',
    label: '回溯批次 2',
    mode: 'backfill',
    note: '回溯扫描第 2 批：2024—2026 年的代表作，补齐方法论谱系。',
    pick: (date) => date < '2026-08-01',
  },
]

const sortByDate = (a, b) => String(b.date).localeCompare(String(a.date))

/** 统一排序：先按等级 rank（会议/顶刊/1区 在前），同级再按日期。 */
const sortByRank = (a, b) => {
  const rank = (a.rank ?? 99) - (b.rank ?? 99)
  if (rank !== 0) return rank
  return sortByDate(a, b)
}

/** 本地时区的 ISO 时间串（带 +08:00 这类偏移，便于界面直接展示）。 */
function localIso(date = new Date()) {
  const pad = (value, width = 2) => String(Math.trunc(Math.abs(value))).padStart(width, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
}

/** 配图路径统一成 "fig/<文件名>"（相对 data/assets/）。 */
function normalizeFigure(file) {
  if (!file) return file
  let value = String(file).replace(/\\/g, '/')
  value = value.replace(/^\.?\//, '')
  value = value.replace(/^data\/assets\//, '')
  value = value.replace(/^assets\//, '')
  if (!value.startsWith('fig/')) value = `fig/${value}`
  return value
}

for (const item of items) {
  if (Array.isArray(item.figures)) {
    item.figures = item.figures.map((figure) => ({ ...figure, file: normalizeFigure(figure.file) }))
  }
}

// 期刊等级：会议论文用自带的 ccf，期刊论文查 data/journals.json
const journals = loadJournals(join(DATA, 'journals.json'))
let withMetrics = 0
for (const item of items) {
  const resolved = metricsFor(journals, item.venue, item.venueShort)
  const existing = item.metrics && typeof item.metrics === 'object' ? item.metrics : undefined
  if (resolved && !existing) {
    item.metrics = resolved
    withMetrics += 1
  } else if (resolved && existing) {
    item.metrics = { ...resolved, ...existing }
    withMetrics += 1
  }
}
console.log(`期刊等级：${withMetrics}/${items.length} 条匹配到分区数据（库内 ${journals.length} 种刊）`)

// 统一排序层级：会议/顶刊/1区 在前，预印本垫底
for (const item of items) {
  const { rank, tierLabel } = rankOf(item)
  item.rank = rank
  item.tierLabel = tierLabel
}

const issuesDir = join(DATA, 'issues')
mkdirSync(issuesDir, { recursive: true })

const indexIssues = []
let totalItems = 0
let totalFigures = 0
let minDate = '9999-12-31'
let maxDate = '0000-01-01'

for (const bucket of buckets) {
  const field = items.filter((item) => item.section === 'field' && bucket.pick(String(item.date))).sort(sortByRank)
  const algo = items.filter((item) => item.section === 'algo' && bucket.pick(String(item.date))).sort(sortByRank)
  const picked = [...field, ...algo]
  if (!picked.length) continue

  const dates = picked.map((item) => String(item.date)).sort()
  const range = [dates[0], dates[dates.length - 1]]
  minDate = range[0] < minDate ? range[0] : minDate
  maxDate = range[1] > maxDate ? range[1] : maxDate
  const figures = picked.reduce((sum, item) => sum + ((item.figures ?? []).length), 0)
  totalItems += picked.length
  totalFigures += figures

  const issue = {
    id: bucket.id,
    label: bucket.label,
    week: Number(String(bucket.id).slice(-2)),
    year: Number(String(bucket.id).slice(0, 4)),
    range,
    mode: bucket.mode,
    generatedAt: localIso(),
    note: bucket.note,
    counts: { field: field.length, algo: algo.length, figures },
    sections: {
      field: { title: '专业前沿', subtitle: '功率预测 · 气象预报 · 雷达流场重构', items: field },
      algo: { title: '算法进展', subtitle: '大模型 · 时序预测', items: algo },
    },
  }
  writeFileSync(join(issuesDir, `${bucket.id}.json`), `${JSON.stringify(issue, null, 2)}\n`, 'utf8')
  indexIssues.push({
    id: bucket.id,
    label: bucket.label,
    range,
    mode: bucket.mode,
    updatedAt: issue.generatedAt,
    counts: issue.counts,
    note: bucket.note,
  })
  console.log(`${bucket.id}: field ${field.length} · algo ${algo.length} · figures ${figures} · range ${range.join(' ~ ')}`)
}

const index = {
  schema: 1,
  title: '每周论文速递',
  subtitle: '功率预测 · 气象预报 · 雷达流场重构 / 大模型 · 时序预测',
  updatedAt: localIso(),
  current: indexIssues[0]?.id,
  coverage: {
    backfillFrom: '2023-11-01',
    coveredFrom: minDate,
    to: maxDate,
    totalItems,
    figures: totalFigures,
    mode: 'incremental',
    nextWindowFrom: maxDate,
    note: '首轮为近三年回溯，之后每周只取上一期之后的新文献。',
  },
  issues: indexIssues,
}

writeFileSync(join(DATA, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
console.log(`\nindex.json: ${indexIssues.length} 期 · ${totalItems} 篇 · ${totalFigures} 张配图 · current=${index.current}`)
