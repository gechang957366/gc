#!/usr/bin/env node
// 校验 data/ 下的周报数据：必填字段、唯一性、配图文件是否真实存在。
//
//   node scripts/validate.mjs [dataDir]
//
// 退出码 0 表示通过（允许 warning），1 表示有 error。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const dataDir = resolve(process.argv[2] ?? join(ROOT, 'data'))

const errors = []
const warnings = []
const seen = new Map()

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function need(value, what, where) {
  if (value === undefined || value === null || value === '') {
    errors.push(`${where}: 缺少 ${what}`)
    return false
  }
  return true
}

function checkItem(item, where) {
  const required = [
    'id', 'title', 'titleZh', 'authors', 'venue', 'venueShort', 'year', 'date', 'level',
    'citation', 'abstractEn', 'abstractZh', 'keyPoints', 'relevance', 'tags', 'section',
  ]
  for (const field of required) need(item[field], field, where)
  if (!Array.isArray(item.authors) || item.authors.length === 0) errors.push(`${where}: authors 必须是非空数组`)
  if (!Array.isArray(item.keyPoints) || item.keyPoints.length < 3) warnings.push(`${where}: keyPoints 少于 3 条`)
  if (!Array.isArray(item.links) || item.links.length === 0) warnings.push(`${where}: 没有 links`)
  if (!['field', 'algo'].includes(item.section)) errors.push(`${where}: section 必须是 field 或 algo`)
  if (!['SCI', 'EI', '中文核心', 'PREPRINT', 'CCF-A', 'CCF-B'].includes(item.level)) warnings.push(`${where}: level=${item.level} 不在推荐枚举内`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.date))) warnings.push(`${where}: date 不是 YYYY-MM-DD`)
  if (!/^\d{4}$/.test(String(item.year))) warnings.push(`${where}: year 不是四位年份`)

  const previous = seen.get(item.id)
  if (previous) {
    if (previous === where) errors.push(`${where}: id 重复 ${item.id}`)
    else warnings.push(`${where}: id ${item.id} 与 ${previous} 重复（同一篇不能出现在多期）`)
  } else {
    seen.set(item.id, where)
  }

  for (const figure of item.figures ?? []) {
    if (!figure?.file) continue
    const target = join(dataDir, 'assets', figure.file)
    if (!existsSync(target)) {
      errors.push(`${where}: 配图不存在 data/assets/${figure.file}`)
      continue
    }
    const size = statSync(target).size
    if (size < 20 * 1024) warnings.push(`${where}: 配图 ${figure.file} 只有 ${size} 字节，可能是占位图`)
    if (!figure.caption) warnings.push(`${where}: 配图 ${figure.file} 缺少 caption`)
  }
}

const indexPath = join(dataDir, 'index.json')
if (!existsSync(indexPath)) {
  console.error(`data/index.json 不存在：${indexPath}`)
  process.exit(1)
}
const index = readJson(indexPath)
const issues = Array.isArray(index) ? index : index.issues ?? []
if (!issues.length) errors.push('index.json 没有任何期号')

let totalItems = 0
let totalFigures = 0
const current = index.current

for (const entry of issues) {
  const path = join(dataDir, 'issues', `${entry.id}.json`)
  if (!existsSync(path)) {
    errors.push(`缺少期号文件 data/issues/${entry.id}.json`)
    continue
  }
  const issue = readJson(path)
  for (const key of ['field', 'algo']) {
    const items = issue?.sections?.[key]?.items ?? []
    if (!items.length && issue?.mode !== 'batch') warnings.push(`${entry.id}: ${key} 没有条目`)
    for (const [index2, item] of items.entries()) {
      totalItems += 1
      totalFigures += (item.figures ?? []).length
      checkItem(item, `${entry.id}/${key}[${index2}] ${item.id ?? ''}`)
      if (item.section !== key) errors.push(`${entry.id}/${key}[${index2}]: section 与所在分区不一致`)
    }
  }
}

if (current && !issues.some((entry) => entry.id === current)) errors.push(`current=${current} 不在 issues 列表里`)

const issueFiles = existsSync(join(dataDir, 'issues'))
  ? readdirSync(join(dataDir, 'issues')).filter((name) => name.endsWith('.json'))
  : []
for (const file of issueFiles) {
  const id = file.replace(/\.json$/, '')
  if (!issues.some((entry) => entry.id === id)) warnings.push(`issues/${file} 未登记到 index.json`)
}

console.log(`data dir: ${dataDir}`)
console.log(`期号 ${issues.length} 个 · 条目 ${totalItems} 篇 · 配图 ${totalFigures} 张 · 去重后 id ${seen.size} 个`)
for (const warning of warnings) console.log(`WARN  ${warning}`)
for (const error of errors) console.log(`ERROR ${error}`)
if (errors.length) {
  console.log(`\n❌ ${errors.length} 个错误，${warnings.length} 个警告`)
  process.exit(1)
}
console.log(`\n✅ 通过（${warnings.length} 个警告）`)
