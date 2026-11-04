#!/usr/bin/env node
// 把速递发布到 GitHub：main 放源码+数据，gh-pages 放构建好的静态站点（开 Pages 给所有人看）。
//
//   # 第一次：交互式配置（token 不会回显、只写进 data/.github-token）
//   node scripts/setup-github.mjs
//
//   # 以后（也由本地写数据的动作自动触发）：
//   node scripts/publish-github.mjs                # 有变化才推
//   node scripts/publish-github.mjs --force        # 忽略哈希，重新推一遍
//   node scripts/publish-github.mjs --dry          # 只列将要上传的文件
//   node scripts/publish-github.mjs --source-only  # 只推源码（不重建站点）
//
// token 优先级：环境变量 GITHUB_TOKEN / GH_TOKEN > data/.github-token
// 需要的最小权限：Contents: Read and write、Pages: Read and write
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PACKAGE_ROOT,
  DEFAULT_DATA_DIR,
  collectSiteFiles,
  collectSourceFiles,
  publishPaths,
  publishToGitHub,
  readPublishConfig,
  readToken,
  verifyToken,
} from './lib/publish.mjs'

const hasFlag = (name) => process.argv.includes(`--${name}`)
const flagValue = (name, fallback = '') => {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const DATA = flagValue('data-dir', DEFAULT_DATA_DIR)
const config = readPublishConfig(DATA)
const repo = flagValue('repo', config.repo)
const token = readToken(DATA)
const dry = hasFlag('dry')
const force = hasFlag('force')

const log = (message) => console.log(message)

if (!repo) {
  console.error('还没配置仓库。先跑一次性配置：\n  node scripts/setup-github.mjs')
  process.exit(1)
}
if (!token && !dry) {
  console.error(
    `缺少 token。两种办法：\n  1) 跑一次交互配置：node scripts/setup-github.mjs（推荐，写进 ${publishPaths(DATA).tokenPath}）\n  2) 临时用环境变量：$env:GITHUB_TOKEN = "github_pat_xxx"`,
  )
  process.exit(1)
}

log(`仓库：https://github.com/${repo}${dry ? '（dry run，不发请求）' : ''}`)
log(`分支：源码 ${config.branch} · 站点 ${config.pagesBranch}`)

if (!dry) {
  const who = await verifyToken(token, repo)
  if (!who.ok) {
    console.error(`\n✗ ${who.error}`)
    process.exit(1)
  }
  log(`身份：${who.login}${who.canPush ? '' : '（这个 token 可能没有写权限）'}${who.private ? ' · 私有仓库（Pages 需付费计划）' : ''}`)
}

if (dry) {
  const source = hasFlag('site-only') ? [] : collectSourceFiles(PACKAGE_ROOT)
  const site = hasFlag('source-only') ? [] : collectSiteFiles(PACKAGE_ROOT, DATA)
  if (source.length) {
    log(`\n· 源码 ${source.length} 个文件 · ${(source.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(1)} MB`)
    for (const file of source.slice(0, 8)) log(`    ${file.path}`)
    if (source.length > 8) log(`    …… 共 ${source.length} 个`)
  }
  if (site.length) {
    log(`\n· 站点 ${site.length} 个文件 · ${(site.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(1)} MB`)
    for (const file of site.slice(0, 8)) log(`    ${file.path}`)
    if (site.length > 8) log(`    …… 共 ${site.length} 个`)
  }
  log('\n加 token 后重跑即可真正发布。')
  process.exit(0)
}

if (force && existsSync(publishPaths(DATA).statePath)) {
  // --force：把记录里"哪些已经推过"的哈希清掉，强制重传
  const { writeFileSync } = await import('node:fs')
  writeFileSync(publishPaths(DATA).statePath, `${JSON.stringify({ repo, branches: {} }, null, 2)}\n`, 'utf8')
  log('已清空发布记录（--force），本次会重新上传全部文件')
}

const result = await publishToGitHub({
  dataDir: DATA,
  root: PACKAGE_ROOT,
  reason: 'manual',
  sourceOnly: hasFlag('source-only'),
  siteOnly: hasFlag('site-only'),
  throwOnError: true,
})

for (const [branch, info] of Object.entries(result.branches || {})) {
  if (info.skipped) log(`· ${branch}：没有变化，跳过`)
  else log(`· ${branch}：上传 ${info.uploaded} 个文件，复用 ${info.reused} 个（commit ${String(info.sha).slice(0, 7)}）`)
}
if (result.pagesUrl) log(`\n网址：${result.pagesUrl}`)
log(`\n完成：https://github.com/${repo}`)
log(`插件安装（别人）：dsh plugin --profile web add git+https://github.com/${repo}.git`)
