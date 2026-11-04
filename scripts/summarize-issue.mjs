#!/usr/bin/env node
// 给某一期生成"本期概述"：把该期的条目喂给 DeepSeek，产出 3-5 句中文综述，
// 写进 issue.sections.<section>.summary，界面顶部默认折叠展示。
//
//   node scripts/summarize-issue.mjs [--issue=2026-BACKFILL] [--section=field|algo] [--data-dir=data]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveApiKey } from './lib/deepseek.mjs'
import { summarizeSection } from './lib/summary.mjs'
import { buildStandalone, buildSite } from './lib/standalone.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const DATA = resolve(flag('data-dir', join(ROOT, 'data')))
const ONLY = flag('section', '')
const apiKey = resolveApiKey()
if (!apiKey) {
  console.error('需要 DEEPSEEK_API_KEY（或 ~/.dsh/.credentials.yaml）')
  process.exit(1)
}

const indexPath = join(DATA, 'index.json')
const index = JSON.parse(readFileSync(indexPath, 'utf8'))
let issueId = flag('issue', index.current)
if (!issueId) {
  const files = readdirSync(join(DATA, 'issues')).filter((f) => f.endsWith('.json'))
  issueId = files[0]?.replace(/\.json$/, '')
}
const issuePath = join(DATA, 'issues', `${issueId}.json`)
if (!existsSync(issuePath)) {
  console.error(`找不到期号：${issuePath}`)
  process.exit(1)
}
const issue = JSON.parse(readFileSync(issuePath, 'utf8'))

for (const key of ['field', 'algo']) {
  if (ONLY && ONLY !== key) continue
  const items = issue.sections?.[key]?.items || []
  if (!items.length) continue
  process.stdout.write(`· ${issueId}/${key}（${items.length} 篇）生成概述…`)
  const summary = await summarizeSection(key, items, apiKey)
  issue.sections[key].summary = summary
  console.log(' 完成')
  console.log(`  ${summary.slice(0, 80)}…`)
}

writeFileSync(issuePath, `${JSON.stringify(issue, null, 2)}\n`, 'utf8')
console.log(`\n已写入 ${issuePath}`)
try {
  buildStandalone({ dataDir: DATA })
  buildSite({ dataDir: DATA })
  console.log('独立版 / 在线版已重建')
} catch (error) {
  console.log(`重建失败：${error.message}`)
}
