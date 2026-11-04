#!/usr/bin/env node
// 生成"独立版"或"在线版"。
//
//   node scripts/build-standalone.mjs            # 单文件版：standalone/index.html（数据内联，双击即开）
//   node scripts/build-standalone.mjs --site     # 在线版：standalone-site/（页面读同目录 data/，可托管/局域网分享）
//   node scripts/build-standalone.mjs --light    # 浅色配色
//
// 单文件版：发给别人后是"快照"，对方不会自动更新（要发新的文件）。
// 在线版：把目录放到静态服务器/局域网共享，之后只替换 data/ 就行，对方刷新即更新。
import { buildStandalone, buildSite } from './lib/standalone.mjs'

const light = process.argv.includes('--light')
const site = process.argv.includes('--site')

if (site) {
  const result = buildSite({ light })
  console.log(
    `standalone-site/index.html 已生成：${(result.bytes / 1024).toFixed(0)} KB · 期号 ${result.issues} 个 · 配图 ${result.figures} 张`,
  )
  console.log('启动：cd standalone-site && node serve.mjs  →  http://127.0.0.1:8099/')
} else {
  const result = buildStandalone({ light })
  console.log(
    `standalone/index.html 已生成：${(result.bytes / 1024).toFixed(0)} KB · 期号 ${result.issues} 个 · 配图 ${result.figures} 张`,
  )
}
