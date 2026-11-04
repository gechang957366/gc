#!/usr/bin/env node
// 打包成"能直接发给别人"的东西。
//
//   node scripts/pack.mjs --target=single      单文件版 → dist/..zip（双击即看，零依赖）
//   node scripts/pack.mjs --target=site        静态站点 → dist/..zip（丢到 GitHub Pages / nginx / COS）
//   node scripts/pack.mjs --target=portable    免安装本地版 → dist/..zip（自带 node.exe，双击 start.cmd）
//   node scripts/pack.mjs --target=plugin      插件源码包 → dist/..zip（给 GitHub / npm pack 用）
//   node scripts/pack.mjs --target=all --with-node
//
// 常用开关：
//   --with-node     portable 包里塞一份 node.exe（对方机器不用装 Node；包会大 ~80MB）
//   --clean         清掉个人数据（期号、收藏、key、日志、缓存），适合公开发布
//   --keep-data     --clean 的反面（默认就是保留期号，发同事看内容用）
//   --no-zip        只生成文件夹，不压缩
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { buildStandalone, buildSite } from './lib/standalone.mjs'
import { listDomains, resolveArea } from './lib/domains.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA = join(ROOT, 'data')

const flagValue = (name, fallback = '') => {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback // 跳过 "--" 和 "="
}
const hasFlag = (name) => process.argv.includes(`--${name}`)
const TARGETS = String(flagValue('target', 'single'))
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const OUT = resolve(flagValue('out', join(ROOT, 'dist')))
const WITH_NODE = hasFlag('with-node')
const CLEAN = hasFlag('clean') && !hasFlag('keep-data')
const NO_ZIP = hasFlag('no-zip')
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

const log = (message) => console.log(message)
const copy = (from, to) => {
  if (!existsSync(from)) return false
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
  return true
}
const writeText = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
}

/** 把 data/ 复制一份到目标位置；--clean 时抹掉期号与私人文件。 */
function copyData(targetDir, { keepIssues }) {
  mkdirSync(targetDir, { recursive: true })
  for (const name of ['sources.json', 'journals.json', 'domains.json']) {
    const from = join(DATA, name)
    if (existsSync(from)) cpSync(from, join(targetDir, name))
  }
  const figSrc = join(DATA, 'assets', 'fig')
  if (existsSync(figSrc) && keepIssues) copy(figSrc, join(targetDir, 'assets', 'fig'))

  const registry = existsSync(join(DATA, 'domains.json'))
    ? JSON.parse(readFileSync(join(DATA, 'domains.json'), 'utf8'))
    : { default: 'power', domains: [] }

  for (const entry of listDomains(DATA).domains) {
    const area = resolveArea(DATA, entry.id)
    const dest = area.isDefault ? targetDir : join(targetDir, 'domains', entry.id)
    mkdirSync(dest, { recursive: true })
    if (existsSync(area.sourcesPath)) cpSync(area.sourcesPath, join(dest, 'sources.json'))
    if (keepIssues) {
      if (existsSync(area.issuesDir)) copy(area.issuesDir, join(dest, 'issues'))
      if (existsSync(area.indexPath)) cpSync(area.indexPath, join(dest, 'index.json'))
      continue
    }
    // clean：只留一个空索引，别人拿到的是"干净的骨架"
    const empty = {
      schema: 1,
      title: `每周文献速递 · ${entry.short || entry.label}`,
      subtitle: entry.subtitle || '',
      domain: entry.id,
      updatedAt: null,
      current: null,
      coverage: {},
      issues: [],
    }
    writeText(join(dest, 'index.json'), JSON.stringify(empty, null, 2))
  }
  // 永远不带这些
  rmSync(join(targetDir, '.elsevier-key'), { force: true })
  rmSync(join(targetDir, 'logs'), { recursive: true, force: true })
  rmSync(join(targetDir, '.pool'), { recursive: true, force: true })
  const domainsDir = join(targetDir, 'domains')
  if (existsSync(domainsDir)) {
    for (const id of readdirSync(domainsDir, { withFileTypes: true })) {
      if (!id.isDirectory()) continue
      rmSync(join(domainsDir, id.name, '.pool'), { recursive: true, force: true })
    }
  }
  // 没有期刊分区表就补一份（别的方向的检索依赖它）
  if (!existsSync(join(targetDir, 'journals.json')) && existsSync(join(DATA, 'journals.json'))) {
    cpSync(join(DATA, 'journals.json'), join(targetDir, 'journals.json'))
  }
  const kept = registry.domains?.length || 0
  log(`  · 数据：${kept} 个方向${keepIssues ? '（含期号）' : '（已清空期号）'}，已剔除 key / 日志 / 池缓存`)
}

function dirSize(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size
  }
  return total
}

function zipDir(dir) {
  const zipPath = `${dir}.zip`
  rmSync(zipPath, { force: true })
  const isWindows = process.platform === 'win32'
  const result = isWindows
    ? spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -LiteralPath '${dir}' -DestinationPath '${zipPath}' -Force`], { stdio: 'inherit' })
    : spawnSync('zip', ['-qr', zipPath, basename(dir)], { cwd: dirname(dir), stdio: 'inherit' })
  if (result.status !== 0 || !existsSync(zipPath)) {
    log(`  ! 压缩失败（文件夹已经生成，可以自己压）：${dir}`)
    return undefined
  }
  return zipPath
}

/** 通用使用说明：每个包里都放一份（.html 可打印，.md 可改）。 */
function copyHandout(dir) {
  for (const name of ['使用说明.html', '使用说明.md']) {
    const from = join(ROOT, 'docs', name)
    if (existsSync(from)) cpSync(from, join(dir, name))
  }
}

function finish(name, dir, readme) {
  if (readme) writeText(join(dir, 'README-给同事.txt'), readme)
  copyHandout(dir)
  const mb = (dirSize(dir) / 1024 / 1024).toFixed(1)
  log(`  ✓ ${name} · ${mb} MB · ${dir}`)
  if (NO_ZIP) return
  const zipPath = zipDir(dir)
  if (zipPath) log(`  ✓ 压缩包：${zipPath}（${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB）`)
}

const README_SINGLE = `每周文献速递 · 单文件版
==============================

怎么用：解压后双击 index.html（用 Chrome / Edge 打开即可），不需要联网、不需要装任何东西。
整个目录可以一起拷进 U 盘 / 微信发出去。

看什么：
· 顶部「方向」下拉可以切换研究方向（默认方向 + 你收到的其他方向）
· 两个页签：专业前沿 / 算法进展；点卡片展开中文摘要与技术要点
· 期号下拉回看历史；本文献速递是静态快照，不会自动更新

这一份是「只读快照」：没有「换一批」「删除」「现场检索」——那些需要后端。
想要能检索/换一批的版本，用「免安装本地版」（双击 start.cmd）。
`

const README_SITE = `每周文献速递 · 静态站点
==============================

这个目录可以直接丢到任何静态托管：GitHub Pages / nginx / 腾讯云 COS / 内网 IIS。

用法一（本机看）：双击 serve.mjs 所在目录，命令行跑 node serve.mjs，然后开 http://127.0.0.1:8099/
用法二（对外）：整个目录上传即可，入口是 index.html。

· 页面打开时读同目录的 data/，所以以后更新只要替换 data/ 里的文件，别人刷新就是新一期
· 纯静态托管没有后端：「换一批」「删除期号」「现场检索」不可用（会提示）；要这些功能用「免安装本地版」
· 数据里不含任何密钥，可以公开
`

const README_PORTABLE = `每周文献速递 · 免安装本地版（Windows）
==============================

怎么用：解压后双击 start.cmd。
· 会自动开一个本地服务 + 打开浏览器；地址形如 http://127.0.0.1:8099/
· 想看纯静态快照：双击 standalone\\index.html
· 窗口别关（关了服务就停了）；关窗口 = 停止服务

需要 Node 吗？
· 如果这个包里带了 node.exe（文件夹里有），不需要装任何东西；
· 如果没有 node.exe，装一次 Node.js（https://nodejs.org/ ，一路下一步）即可。

能做什么：
· 浏览各方向文献、切换方向、回看历史期号、收藏
· 换一批 / 删除期号 / 现场检索：需要「现场检索」时还要一个 Elsevier API key
  （把 key 存成 data\\.elsevier-key 一行，或设环境变量 ELSEVIER_API_KEY）
· 每周自动更新不在这个包里（那是发件人机器上的计划任务）；拿到新版直接把 data\\ 覆盖过去就行

把 data\\ 覆盖过去 = 换数据；不用重新装。
`

const README_PLUGIN = `每周文献速递 · DSH 插件源码包
==============================

一、直接用本地目录安装
  dsh plugin --profile web add link:<解压后的绝对路径>

二、从 GitHub 安装（推荐发给别人）
  1) 把这个目录推到 GitHub 仓库（不要带 data/.elsevier-key、data/logs、data/.pool —— 已在 .gitignore）
  2) 对方执行：
       dsh plugin --profile web add git+https://github.com/<user>/<repo>.git
     或   dsh plugin --profile web add github:<user>/<repo>
  3) 重启 dsh web，页面顶部出现胶囊即可

三、用 npm 包发
  npm pack                     # 生成 dsh-weekly-paper-<version>.tgz
  # 对方：
  dsh plugin --profile web add ./dsh-weekly-paper-<version>.tgz

注意：
· 插件本身不含任何密钥；对方要用「现场检索 / 换一批」得自己配 Elsevier API key，
  要中文摘要与概述得配 DeepSeek key（没配就只存英文，功能不崩）。
· 想连数据一起给：把 data/ 一并提交（但先删掉 data/.elsevier-key、data/logs、data/.pool）。
`

function targetSingle() {
  log('· 单文件版（双击即看，零依赖）')
  const built = buildStandalone({ dataDir: CLEAN ? buildCleanData() : DATA })
  const dir = join(OUT, `weekly-paper-single-${STAMP}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  cpSync(built.path, join(dir, 'index.html'))
  if (existsSync(join(ROOT, 'standalone', 'assets'))) copy(join(ROOT, 'standalone', 'assets'), join(dir, 'assets'))
  finish('单文件版', dir, README_SINGLE)
}

function targetSite() {
  log('· 静态站点（可丢 GitHub Pages / nginx）')
  const dataDir = CLEAN ? buildCleanData() : DATA
  const built = buildSite({ dataDir })
  const dir = join(OUT, `weekly-paper-site-${STAMP}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const name of readdirSync(join(ROOT, 'standalone-site'))) {
    if (name === 'README-给同事.txt') continue
    copy(join(ROOT, 'standalone-site', name), join(dir, name))
  }
  if (!existsSync(join(dir, 'index.html'))) cpSync(built.path, join(dir, 'index.html'))
  finish('静态站点', dir, README_SITE)
}

function targetPortable() {
  log('· 免安装本地版（双击 start.cmd）')
  const dataDir = CLEAN ? buildCleanData() : DATA
  buildSite({ dataDir })
  buildStandalone({ dataDir })
  const dir = join(OUT, `weekly-paper-portable-${STAMP}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  // 运行所需的代码
  copy(join(ROOT, 'scripts'), join(dir, 'scripts'))
  rmSync(join(dir, 'scripts', 'make-shortcut.ps1'), { force: true })
  copy(join(ROOT, 'standalone-site'), join(dir, 'standalone-site'))
  copy(join(ROOT, 'standalone'), join(dir, 'standalone'))
  // 改了数据后 lan-server 会重建页面，重建要用到浏览器半和 React(UMD)
  copy(join(ROOT, 'client'), join(dir, 'client'))
  copy(join(ROOT, 'preview', 'vendor'), join(dir, 'preview', 'vendor'))
  copy(join(ROOT, 'start.cmd'), join(dir, 'start.cmd'))
  cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'))
  copyData(join(dir, 'data'), { keepIssues: !CLEAN })

  if (WITH_NODE) {
    const nodePath = process.execPath
    cpSync(nodePath, join(dir, 'node.exe'))
    log(`  · 已塞入 node.exe（${(statSync(nodePath).size / 1024 / 1024).toFixed(0)} MB，对方不用装 Node）`)
  }
  finish('免安装本地版', dir, README_PORTABLE)
}

function targetPlugin() {
  log('· 插件源码包（GitHub / npm pack）')
  const dir = join(OUT, `dsh-weekly-paper-${VERSION}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const name of ['lib', 'client', 'docs', 'scripts', 'cordis.patch.yml', 'package.json', 'README.md', 'start.cmd']) {
    copy(join(ROOT, name), join(dir, name))
  }
  // 推 GitHub 用的：忽略规则 + GitHub Pages 自动发布
  for (const name of ['.gitignore', '.npmignore']) {
    if (existsSync(join(ROOT, name))) cpSync(join(ROOT, name), join(dir, name))
  }
  copy(join(ROOT, '.github'), join(dir, '.github'))
  copyData(join(dir, 'data'), { keepIssues: true })
  finish('插件源码包', dir, README_PLUGIN)
}

/** --clean 时先把数据复制到临时目录再构建，避免动到自己的数据。 */
let cleanDir
function buildCleanData() {
  if (cleanDir) return cleanDir
  cleanDir = join(OUT, `.clean-data-${STAMP}`)
  rmSync(cleanDir, { recursive: true, force: true })
  copyData(cleanDir, { keepIssues: false })
  log(`  · 用"干净数据"构建：${cleanDir}`)
  return cleanDir
}

const handlers = { single: targetSingle, site: targetSite, portable: targetPortable, plugin: targetPlugin }
const wanted = TARGETS.includes('all') ? Object.keys(handlers) : TARGETS
const unknown = wanted.filter((name) => !handlers[name])
if (unknown.length) {
  console.error(`未知 --target：${unknown.join(', ')}（可用：single / site / portable / plugin / all）`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
log(`输出目录：${OUT}`)
for (const name of wanted) handlers[name]()
// 顶层也放一份，方便直接发给人看说明、不用解压
copyHandout(OUT)
if (cleanDir) rmSync(cleanDir, { recursive: true, force: true })
log('\n完成。发给别人时：非技术同事给 single 或 portable；要网址给 site；DSH 用户给 plugin。')
log('说明文档：dist/使用说明.html（可打印/转发）+ dist/使用说明.md')
