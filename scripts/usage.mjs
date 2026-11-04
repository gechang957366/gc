#!/usr/bin/env node
// 看 API 用量与配额：
//
//   node scripts/usage.mjs            # 本地记账 + 实时查一次 Elsevier 配额 + DeepSeek 余额
//   node scripts/usage.mjs --no-live  # 只看本地记账，不花配额
//
// Elsevier 的配额（20,000 次/周）是**按 API key 记的**：
//   · 你自己跑更新 / 在网页上点「换一批」「检索」→ 花你的
//   · 局域网同事打开你的链接点「换一批」「检索」→ 请求打到你的机器，还是花你的
//   · 把单文件版 / 免安装本地版 / 静态站点发给别人 → 他们看的是快照，不花你的；
//     他们自己点换一批时用的是他们自己配的 key（包里不含你的 key）
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolveApiKey } from './lib/deepseek.mjs'
import { probeDeepSeekBalance, probeElsevierQuota, readElsevierKeyFrom, readUsage } from './lib/usage.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const hasFlag = (name) => process.argv.includes(`--${name}`)
const flagValue = (name, fallback = '') => {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const DATA = resolve(flagValue('data-dir', join(ROOT, 'data')))
const LIVE = !hasFlag('no-live')

const usageBefore = readUsage(DATA)
const apiKey = readElsevierKeyFrom(DATA)
const llmKey = resolveApiKey()

const fmtTime = (iso) => {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

console.log('=== Elsevier（Scopus / ScienceDirect API）===')
let limitShown = usageBefore.elsevier.limit || 20000
let remainingShown = usageBefore.elsevier.remaining
if (!apiKey) {
  console.log('  没有配置 key（data/.elsevier-key 或环境变量 ELSEVIER_API_KEY）')
} else {
  const quota = LIVE ? await probeElsevierQuota(apiKey, DATA) : undefined
  // 实时查询会写一笔账，所以要重新读
  const usage = readUsage(DATA)
  limitShown = quota?.limit || usage.elsevier.limit || 20000
  remainingShown = Number.isFinite(quota?.remaining) && quota.remaining > 0 ? quota.remaining : usage.elsevier.remaining
  const used = Number.isFinite(remainingShown) && remainingShown >= 0 ? limitShown - remainingShown : undefined
  const resetAt = quota?.resetAt || usage.elsevier.resetAt
  console.log(`  配额上限：${limitShown.toLocaleString()} 次 / 周（按 API key 算）`)
  if (Number.isFinite(used)) {
    console.log(`  本周已用：${used.toLocaleString()} 次 · 剩 ${remainingShown.toLocaleString()} 次`)
  } else {
    console.log('  本周已用：未知（加 --no-live 时只能用上次记账值）')
  }
  console.log(`  配额重置：${fmtTime(resetAt)}（北京时间）`)
  if (quota) console.log('  数据来源：刚查的实时配额（这次查询本身也占 1 次）')
  else if (usage.elsevier.observedAt) console.log(`  数据来源：上次记账（${fmtTime(usage.elsevier.observedAt)}）`)
  console.log(`  本地计数：今天 ${usage.elsevier.callsToday} 次 · 累计 ${usage.elsevier.callsTotal} 次（从本功能上线开始计）`)
}

console.log('\n=== DeepSeek（整理中文摘要 / 生成概述）===')
const usageAfter = readUsage(DATA)
if (!llmKey) {
  console.log('  没有配置 key（data/.credentials.yaml 或环境变量 DEEPSEEK_API_KEY）')
} else {
  const balance = await probeDeepSeekBalance(llmKey)
  if (balance && balance.status === 200) {
    const total = Number(balance.total)
    console.log(`  余额：${balance.currency} ${Number.isFinite(total) ? total.toFixed(2) : balance.total}（可用：${balance.available ? '是' : '否'}）`)
    console.log('  计费：按 token 扣费，没有"次数配额"，余额用完才会失败')
  } else {
    console.log(`  余额：查询失败（HTTP ${balance?.status ?? '网络不可达'}）`)
  }
  console.log(
    `  本地计数：今天 ${usageAfter.deepseek.callsToday} 次 / ${usageAfter.deepseek.tokensToday.toLocaleString()} tokens · 累计 ${usageAfter.deepseek.callsTotal} 次 / ${usageAfter.deepseek.tokensTotal.toLocaleString()} tokens（从本功能上线开始计）`,
  )
}

const perBatch = 32
const remainingForBatches = Number.isFinite(remainingShown) ? remainingShown : limitShown
console.log('\n=== 一次操作大概花多少（Elsevier 次数，按实测）===')
console.log('  每周自动更新（一个方向）        ≈ 50 次（Scopus 检索 ~20 + 摘要 ~24 + 零星校验）')
console.log(`  网页「换一批」                  ≈ ${perBatch} 次（4 个检索词 × 2~3 条查询 + 20 多条摘要）`)
console.log('  网页「现场检索」                ≈ 15–40 次（关键词池 + 结果补摘要）')
console.log(`  按剩余 ${remainingForBatches.toLocaleString()} 次算：还能点约 ${Math.max(0, Math.floor(remainingForBatches / perBatch)).toLocaleString()} 次「换一批」`)

console.log('\n记账文件：' + join(DATA, '.api-usage.json'))
console.log('提醒：key 不要发给别人，也别提交到 git（仓库已忽略 data/.elsevier-key）。')
