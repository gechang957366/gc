#!/usr/bin/env node
// 把多期合并成"一期精选"，并按等级过滤（只留顶刊 / 中科院 1 区 / CCF-A …）。
//
//   node scripts/merge-issues.mjs --id=2026-BACKFILL --label="回溯精选 · 近三年顶级" \
//        --keep=top --delete=all
//
// --keep=top      只留 顶刊(Nature/Science) + 中科院1区/Top + CCF-A
// --keep=top+     额外保留 CCF-B、JCR Q1、中科院2区
// --keep=all      全留
// --delete=all    合并后删除被合并的那些期号文件（默认不删）
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rankOf } from './lib/rank.mjs'
import { buildStandalone } from './lib/standalone.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const DATA = resolve(flag('data-dir', join(ROOT, 'data')))
const ID = flag('id', '')
const LABEL = flag('label', ID)
const KEEP = flag('keep', 'top')
const DELETE = flag('delete', '')
const SOURCES = flag('sources', '') // 逗号分隔的期号；默认取 index 里全部
const DOMAIN_FILTER = flag('domain', '1') !== '0'
if (!ID) {
  console.error('用法：node scripts/merge-issues.mjs --id=2026-BACKFILL --label="回溯精选" [--keep=top|top+|all] [--delete=all]')
  process.exit(1)
}

const index = JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8'))
const allIds = (index.issues || []).map((entry) => entry.id)
const sourceIds = SOURCES ? SOURCES.split(',').map((value) => value.trim()).filter(Boolean) : allIds

const TOP_JOURNALS = /^(nature|science|nature (energy|communications|machine intelligence|climate change|sustainability)|science advances|joule|cell|pnas)/i

function tierOf(item) {
  const level = String(item.level || '').toUpperCase()
  const metrics = item.metrics || {}
  const casZone = metrics.cas?.zone || ''
  const casTop = Boolean(metrics.cas?.top)
  const jcr = metrics.jcr?.quartile || ''
  const isTopJournal = TOP_JOURNALS.test(String(item.venue || '').trim())
  if (isTopJournal || casZone === '1区' || casTop || level === 'CCF-A') return 0 // 顶级
  if (level === 'CCF-B' || jcr === 'Q1' || casZone === '2区') return 1 // 次一级
  return 2 // 其余
}

const keepFn = (item) => {
  const tier = tierOf(item)
  // 方向相关性：顶会里也有一堆"纯多智能体/视觉检索"的论文，和功率预测无关的不要
  if (item.section === 'algo' && DOMAIN_FILTER) {
    const text = `${item.title || ''} ${item.abstractEn || ''} ${item.titleZh || ''} ${(item.tags || []).join(' ')}`
    const relevant = /time series|forecast|temporal|sequence model|wind|power|energy|load|weather|climate|photovoltaic|solar|radar|lidar|grid/i.test(
      text,
    )
    const isTopJournal = TOP_JOURNALS.test(String(item.venue || '').trim())
    if (!relevant && !isTopJournal) return false
  }
  if (KEEP === 'all') return true
  if (KEEP === 'top+') return tier <= 1
  return tier === 0
}

const seen = new Set()
const items = []
const dropped = { duplicate: 0, lower: 0 }
for (const id of sourceIds) {
  const path = join(DATA, 'issues', `${id}.json`)
  if (!existsSync(path)) {
    console.warn(`跳过不存在的期号：${id}`)
    continue
  }
  const issue = JSON.parse(readFileSync(path, 'utf8'))
  for (const section of ['field', 'algo']) {
    for (const item of issue.sections?.[section]?.items || []) {
      const key = String(item.id).toLowerCase()
      if (seen.has(key)) {
        dropped.duplicate += 1
        continue
      }
      if (!keepFn(item)) {
        dropped.lower += 1
        continue
      }
      seen.add(key)
      items.push(item)
    }
  }
}

for (const item of items) {
  const { rank, tierLabel } = rankOf(item)
  item.rank = rank
  item.tierLabel = tierLabel
}
const field = items.filter((item) => item.section !== 'algo')
const algo = items.filter((item) => item.section === 'algo')
const sortFn = (a, b) => (a.rank - b.rank) || String(b.date).localeCompare(String(a.date))
field.sort(sortFn)
algo.sort(sortFn)

const dates = items.map((item) => String(item.date)).filter(Boolean).sort()
const pad = (v) => String(v).padStart(2, '0')
const now = new Date()
const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00+08:00`

const merged = {
  id: ID,
  label: LABEL,
  week: null,
  year: now.getFullYear(),
  range: [dates[0] || '', dates[dates.length - 1] || ''],
  mode: 'backfill',
  generatedAt: iso,
  generatedBy: 'merge',
  note: `合并 ${sourceIds.join(' + ')}，只保留${KEEP === 'top' ? '顶刊/中科院1区/CCF-A' : KEEP === 'top+' ? '顶刊/1区/2区/CCF-A/CCF-B/Q1' : '全部'}；丢弃 ${dropped.lower} 条次级、去重 ${dropped.duplicate} 条。`,
  counts: { field: field.length, algo: algo.length, figures: items.reduce((sum, item) => sum + (item.figures?.length || 0), 0) },
  sections: {
    field: { title: '专业前沿', subtitle: '功率预测 · 气象预报 · 雷达流场重构', items: field },
    algo: { title: '算法进展', subtitle: '大模型 · 时序预测', items: algo },
  },
}

writeFileSync(join(DATA, 'issues', `${ID}.json`), `${JSON.stringify(merged, null, 2)}\n`, 'utf8')

const nextIndex = {
  schema: 1,
  title: index.title || '每周论文速递',
  subtitle: index.subtitle,
  updatedAt: iso,
  current: ID,
  coverage: {
    backfillFrom: dates[0] || index.coverage?.backfillFrom,
    coveredFrom: dates[0] || '',
    to: dates[dates.length - 1] || '',
    totalItems: items.length,
    figures: merged.counts.figures,
    mode: 'incremental',
    nextWindowFrom: dates[dates.length - 1] || '',
    note: '首轮做过近三年回溯（已合并为精选），之后每周只取上一期之后的新文献。',
  },
  issues: [
    {
      id: ID,
      label: LABEL,
      range: merged.range,
      mode: 'backfill',
      updatedAt: iso,
      counts: merged.counts,
      note: merged.note,
    },
  ],
}
writeFileSync(join(DATA, 'index.json'), `${JSON.stringify(nextIndex, null, 2)}\n`, 'utf8')

if (DELETE === 'all') {
  for (const id of sourceIds) {
    if (id === ID) continue
    const path = join(DATA, 'issues', `${id}.json`)
    if (existsSync(path)) {
      unlinkSync(path)
      console.log(`已删除旧期号：${id}`)
    }
  }
}

console.log(
  `${ID} 合并完成：field ${field.length} 条 / algo ${algo.length} 条（丢弃次级 ${dropped.lower}、去重 ${dropped.duplicate}），区间 ${merged.range.join(' ~ ')}`,
)
const result = buildStandalone({ dataDir: DATA })
console.log(`独立版已重建：${result.path}（${(result.bytes / 1024).toFixed(0)} KB）`)
