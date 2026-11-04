#!/usr/bin/env node
// 一次性配置：问你要 GitHub token，验证权限，写进 data/.github-token 和 data/publish.json，
// 然后立刻发布一次。之后再也不用管 token——本地一有写数据的动作会自动推送。
//
//   node scripts/setup-github.mjs                     # 交互式
//   node scripts/setup-github.mjs --repo=user/repo     # 连仓库一起传参
//   node scripts/setup-github.mjs --token=xxx          # 不想被问（会留在命令历史里，不推荐）
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import {
  DEFAULT_DATA_DIR,
  publishPaths,
  publishToGitHub,
  readPublishConfig,
  readToken,
  verifyToken,
  writePublishConfig,
  writeToken,
} from './lib/publish.mjs'

const flagValue = (name, fallback = '') => {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const DATA = flagValue('data-dir', DEFAULT_DATA_DIR)
const current = readPublishConfig(DATA)

function ask(question, { hidden = false } = {}) {
  // 非交互终端（管道/重定向）时退化成一普通的 readline，输入会显示出来
  if (hidden && !process.stdin.isTTY) hidden = false
  if (!hidden) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      rl.question(question, (answer) => {
        rl.close()
        resolve(String(answer || '').trim())
      })
    })
  }
  // 隐藏输入：手动读字符，不把 token 打到屏幕上
  return new Promise((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    stdin.resume()
    if (stdin.setRawMode) stdin.setRawMode(true)
    let value = ''
    const finish = (result) => {
      if (stdin.setRawMode) stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      process.stdout.write('\n')
      resolve(result.trim())
    }
    const onData = (buffer) => {
      for (const ch of String(buffer)) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish(value)
        if (ch === '\u0003') {
          if (stdin.setRawMode) stdin.setRawMode(false)
          process.stdout.write('\n已取消\n')
          process.exit(1)
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += ch
      }
    }
    stdin.on('data', onData)
  })
}

console.log('=== 一次性配置：把速递发布到 GitHub ===\n')
console.log('需要一个 GitHub token（只存本机 data/.github-token，不会进仓库）：')
console.log('  1. 打开 https://github.com/settings/tokens')
console.log('  2. 选 Fine-grained tokens → Generate new token')
console.log('     · Repository access：Only select repositories → 选你的仓库')
console.log('     · Permissions：Contents = Read and write，Pages = Read and write')
console.log('     · Expiration：7 天就够（过期后功能照常用，只是不再自动推送）')
console.log('  3. 生成后复制那串 github_pat_…\n')
console.log('（也可以用 classic token，勾 repo 一项即可）\n')

const repo =
  flagValue('repo', current.repo) ||
  (await ask('仓库（owner/repo，回车用 gechang957366/gc）：')) ||
  'gechang957366/gc'
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error(`仓库格式不对：${repo}（要写成 owner/repo）`)
  process.exit(1)
}

let token = flagValue('token', '') || process.env.GITHUB_TOKEN || readToken(DATA)
if (!token) {
  token = await ask('粘贴 token（输入时不显示）：', { hidden: true })
} else {
  console.log(`已有 token（…${token.slice(-4)}），直接复用`)
}
if (!token) {
  console.error('没拿到 token，退出。')
  process.exit(1)
}

console.log('\n验证 token …')
const who = await verifyToken(token, repo)
if (!who.ok) {
  console.error(`✗ ${who.error}`)
  process.exit(1)
}
console.log(`✓ 身份 ${who.login} · 仓库 ${who.repo}${who.canPush ? ' · 有写权限' : ' · ⚠ 没有写权限（检查 Contents: Read and write）'}`)
if (who.private) console.log('⚠ 这是私有仓库：GitHub Pages 需要付费计划才能对外访问')

writeToken(DATA, token)
const config = writePublishConfig(DATA, {
  enabled: true,
  repo,
  branch: flagValue('branch', who.defaultBranch || current.branch || 'main'),
  pagesBranch: flagValue('pages-branch', current.pagesBranch || 'gh-pages'),
  autoPush: true,
})
console.log(`✓ token 已保存到 ${publishPaths(DATA).tokenPath}`)
console.log(`✓ 配置已写入 ${publishPaths(DATA).configPath}：源码分支 ${config.branch}，站点分支 ${config.pagesBranch}，自动推送开启`)

console.log('\n开始首次发布（第一次要上传全部文件，几十秒）…')
const result = await publishToGitHub({ dataDir: DATA, reason: 'first-setup', throwOnError: true })
for (const [branch, info] of Object.entries(result.branches || {})) {
  console.log(`· ${branch}：上传 ${info.uploaded} 个，复用 ${info.reused} 个（commit ${String(info.sha || '').slice(0, 7)}）`)
}
console.log(`\n✓ 仓库：https://github.com/${repo}`)
if (result.pagesUrl) {
  console.log(`✓ 网址：${result.pagesUrl}`)
  console.log('  （第一次开启 Pages 需要 1–2 分钟构建；之后每次本地改数据都会自动更新，约 30 秒生效）')
} else {
  console.log('！没能自动开启 Pages，手动点一下：仓库 → Settings → Pages → Source 选 gh-pages / (root)')
  console.log('  之后每次推送都会自动跟随。')
}
console.log('\n以后不用再跑这个脚本：点「换一批」、删期号、新建方向、每周自动更新，都会自动推上去。')
console.log(`日志：${publishPaths(DATA).logPath}`)
if (!existsSync(publishPaths(DATA).configPath)) console.log('（提示：配置文件没写成功？检查 data 目录权限）')
