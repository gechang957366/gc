#!/usr/bin/env node
// 重算所有期号的等级与排序：把 metrics / rank / tierLabel 刷新一遍
//（分区表更新、或期刊匹配规则改过之后跑一次）。
//
//   node scripts/rebuild-rank.mjs [--domain=wake] [--data-dir=data]
//
// --domain 会让它用该方向 sources.json 里的旗舰刊（flagship）来判定「领域顶刊」。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rankOf } from './lib/rank.mjs'
import { loadJournals, metricsFor } from './lib/metrics.mjs'
import { shortVenue } from './lib/venues.mjs'
import { resolveArea } from './lib/domains.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const flagValue = (name, fallback = '') => {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const ROOT_DATA = resolve(flagValue('data-dir', join(ROOT, 'data')))
const AREA = resolveArea(ROOT_DATA, flagValue('domain', '') || undefined)
const issuesDir = AREA.issuesDir
if (!existsSync(issuesDir)) {
  console.error(`找不到 ${issuesDir}`)
  process.exit(1)
}

let flagship = []
try {
  flagship = JSON.parse(readFileSync(AREA.sourcesPath, 'utf8')).flagship?.field || []
} catch {
  flagship = []
}
const journals = loadJournals(AREA.journalsPath)
console.log(`方向：${AREA.entry.label}（${AREA.id}）· 旗舰刊 ${flagship.length} 本 · 期刊分区表 ${journals.length} 条`)

let touched = 0
for (const file of readdirSync(issuesDir).filter((name) => name.endsWith('.json'))) {
  const path = join(issuesDir, file)
  const issue = JSON.parse(readFileSync(path, 'utf8'))
  let changed = false
  for (const section of Object.values(issue.sections || {})) {
    const items = section.items || []
    for (const item of items) {
      // 期刊短名（界面徽标用）也跟着规则刷新
      const short = shortVenue(item.venue)
      if (short && item.venueShort !== short) {
        item.venueShort = short
        changed = true
      }
      // 分区/IF：缓存里存的是生成时的结果，规则改了要重算
      const metrics = metricsFor(journals, item.venue, item.venueShort)
      const before = JSON.stringify(item.metrics || null)
      const after = JSON.stringify(metrics || null)
      if (before !== after) {
        if (metrics) item.metrics = metrics
        else delete item.metrics
        changed = true
      }
      const { rank, tierLabel } = rankOf(item, { flagship })
      if (item.rank !== rank || item.tierLabel !== tierLabel) {
        item.rank = rank
        item.tierLabel = tierLabel
        changed = true
      }
    }
    const sorted = [...items].sort(
      (a, b) => (a.rank ?? 99) - (b.rank ?? 99) || String(b.date || '').localeCompare(String(a.date || '')),
    )
    if (sorted.some((item, index) => item.id !== items[index].id)) {
      section.items = sorted
      changed = true
    }
  }
  if (changed) {
    writeFileSync(path, `${JSON.stringify(issue, null, 2)}\n`, 'utf8')
    touched += 1
    const field = issue.sections?.field?.items || []
    console.log(`${issue.id}: 重排完成，field 前三条 = ${field.slice(0, 3).map((item) => `${item.tierLabel}`).join(' / ')}`)
  }
}
console.log(`\n共更新 ${touched} 个期号文件`)
