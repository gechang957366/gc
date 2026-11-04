#!/usr/bin/env node
// 加一个研究方向：把某份 sources.json 当模板，建出 data/domains/<id>/ 与注册表条目。
//
//   node scripts/add-domain.mjs --id=wake --label="风电场尾流与流场调控" --short=尾流 \
//        --from=power --flag="journal of fluid mechanics,physics of fluids"
//
// 说明：
//   --id     方向 id（小写字母/数字/短横线），会变成 data/domains/<id>/
//   --label  界面上显示的名字
//   --short  短名（缺省用 label）
//   --from   拿哪个方向的 sources.json 当模板（默认 power；也可以用 --template=<路径>）
//   --flag   领域旗舰刊（逗号分隔，小写即可），会写进 sources.json 的 flagship.field
//   --dry    只打印将要写入的内容，不落盘
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listDomains, resolveArea } from './lib/domains.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA = resolve(process.env.DWP_DATA_DIR || join(ROOT, 'data'))

function flag(name, fallback = '') {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const id = flag('id')
const label = flag('label')
const short = flag('short', label)
const from = flag('from', 'power')
const template = flag('template')
const flagships = flag('flag')
  .split(',')
  .map((word) => word.trim().toLowerCase())
  .filter(Boolean)
const dry = process.argv.includes('--dry')

if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
  console.error('用法：node scripts/add-domain.mjs --id=wake --label="风电场尾流与流场调控" [--flag="journal of fluid mechanics,physics of fluids"]')
  process.exit(1)
}
if (!label) {
  console.error('缺少 --label="显示名称"')
  process.exit(1)
}
if (['power', 'wake'].includes(id) && !flag('force')) {
  console.error(`方向 ${id} 已存在；确实要覆盖模板文件请加 --force`)
  process.exit(1)
}

const registryPath = join(DATA, 'domains.json')
const registry = existsSync(registryPath)
  ? JSON.parse(readFileSync(registryPath, 'utf8'))
  : { schema: 1, default: 'power', domains: [] }
const area = resolveArea(DATA, id)

// 模板：默认拿默认方向的 sources.json，改掉方向名与旗舰刊
const templatePath = template ? resolve(template) : resolveArea(DATA, from).sourcesPath
if (!existsSync(templatePath)) {
  console.error(`模板不存在：${templatePath}`)
  process.exit(1)
}
const sources = JSON.parse(readFileSync(templatePath, 'utf8'))
sources.domain = id
sources.note = `${label}：查询词、方向词、优先期刊都在这里改，不需要改代码。`
if (flagships.length) sources.flagship = { ...(sources.flagship || {}), field: flagships }

const registryEntry = {
  id,
  label,
  short,
  subtitle: flag('subtitle', sources.note || label),
  sections: { field: flag('field', '专业前沿'), algo: flag('algo', '算法进展') },
  note: flag('note', ''),
}

console.log(`方向 ${id} → ${area.dir}`)
console.log(`  模板      ${templatePath}`)
console.log(`  旗舰刊    ${flagships.length ? flagships.join(' / ') : '(未设置)'}`)
console.log(`  显示名称  ${label}（短名 ${short}）`)
if (dry) {
  console.log('\n--dry：不落盘。将要写入的注册表条目：')
  console.log(JSON.stringify(registryEntry, null, 2))
  process.exit(0)
}

mkdirSync(join(area.dir, 'issues'), { recursive: true })
writeFileSync(join(area.dir, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`, 'utf8')
if (!existsSync(area.indexPath)) {
  writeFileSync(
    area.indexPath,
    `${JSON.stringify(
      {
        schema: 1,
        title: `每周文献速递 · ${short}`,
        subtitle: registryEntry.subtitle,
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
}

const existing = registry.domains.findIndex((entry) => entry.id === id)
if (existing >= 0) registry.domains[existing] = registryEntry
else registry.domains.push(registryEntry)
registry.schema = registry.schema || 1
registry.default = registry.default || 'power'
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')

console.log('\n已写入：')
console.log(`  ${join(area.dir, 'sources.json')}`)
console.log(`  ${area.indexPath}`)
console.log(`  ${registryPath}`)
console.log('\n下一步：')
console.log(`  node scripts/update-weekly.mjs --domain=${id} --since=2024-11-01   # 第一次先回溯一批`)
console.log(`  node scripts/build-standalone.mjs && node scripts/build-standalone.mjs --site`)
console.log(`  界面上顶部「方向」下拉里就能看到「${label}」`)
console.log(`  （注册表里的方向数：${listDomains(DATA).domains.length}）`)
