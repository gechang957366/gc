#!/usr/bin/env node
// 链接健康检查：把每条文献的 links 逐个请求一遍，结果写回 issue JSON 的
// `linkCheck` 字段（界面会在坏链上显示「⚠ 链接暂不可达」）。
//
//   node scripts/check-links.mjs [--data-dir=data] [--only=2026-W45] [--timeout=12000]
//
// 为什么需要它：中文期刊站（如 aeps-info.com）会抽风、Elsevier 会挡爬虫，
// 与其让用户点了没反应，不如把"上次检查不可达"直接标在卡片上。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : fallback
}
const DATA = resolve(flag('--data-dir', join(ROOT, 'data')))
const ONLY = flag('--only')
const TIMEOUT = Number(flag('--timeout', '6000'))
const CONCURRENCY = Math.max(1, Number(flag('--concurrency', '8')))
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

const DEFINITIVE_ERRORS = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|UND_ERR_SOCKET|EPROTO|ERR_TLS/

/** DOI 链接不走出版商页面（bot 墙会误判）：先查 Crossref，404 再回落到 doi.org 解析。 */
async function probeDoi(doi) {
  const started = Date.now()
  const withTimeout = async (url, init) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    const res = await withTimeout(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=linkcheck@example.com`,
      { headers: { 'User-Agent': UA } },
    )
    res.body?.cancel?.()
    if (res.ok) return { kind: 'ok', status: res.status, via: 'crossref', ms: Date.now() - started }
    if (res.status !== 404) return { kind: 'blocked', status: res.status, via: 'crossref', ms: Date.now() - started }
  } catch {
    /* 走下一步 */
  }
  // 中文 DOI（如 10.7500/…）多不在 Crossref，改用 doi.org 是否重定向来判断
  try {
    const res = await withTimeout(`https://doi.org/${encodeURIComponent(doi)}`, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'User-Agent': UA },
    })
    res.body?.cancel?.()
    const status = res.status
    const kind = status >= 300 && status < 400 ? 'ok' : status === 404 ? 'broken' : 'blocked'
    return { kind, status, via: 'doi.org', ms: Date.now() - started }
  } catch (error) {
    const message = (error.cause && (error.cause.code || error.cause.message)) || error.name
    return { kind: 'unknown', error: message, via: 'doi.org', ms: Date.now() - started }
  }
}

async function probe(url) {
  const started = Date.now()
  const doiMatch = /^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i.exec(url)
  if (doiMatch) return probeDoi(doiMatch[1])

  const attempt = async (method) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT)
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': UA, Accept: '*/*', Connection: 'close' },
      })
      if (method === 'HEAD') res.body?.cancel?.()
      return { status: res.status, finalUrl: res.url }
    } finally {
      clearTimeout(timer)
    }
  }

  const classify = (status) => {
    if (status >= 200 && status < 400) return 'ok'
    if ([401, 403, 405, 429, 202, 406].includes(status)) return 'blocked' // 反爬/需要浏览器会话
    return 'broken'
  }

  try {
    const head = await attempt('HEAD')
    const kind = classify(head.status)
    if (kind !== 'broken') return { kind, status: head.status, ms: Date.now() - started }
    const get = await attempt('GET')
    return { kind: classify(get.status), status: get.status, ms: Date.now() - started }
  } catch (error) {
    const message = (error.cause && (error.cause.code || error.cause.message)) || error.name || 'fetch failed'
    if (DEFINITIVE_ERRORS.test(message)) return { kind: 'broken', error: message, ms: Date.now() - started }
    try {
      const get = await attempt('GET')
      return { kind: classify(get.status), status: get.status, ms: Date.now() - started }
    } catch (error2) {
      const message2 = (error2.cause && (error2.cause.code || error2.cause.message)) || error2.name || 'fetch failed'
      return {
        kind: DEFINITIVE_ERRORS.test(message2) ? 'broken' : 'unknown',
        error: message2,
        ms: Date.now() - started,
      }
    }
  }
}

/** 简易并发池：同时最多 N 个探测。 */
async function pool(tasks, worker) {
  const results = new Array(tasks.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(tasks[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

const issuesDir = join(DATA, 'issues')
if (!existsSync(issuesDir)) {
  console.error(`找不到 ${issuesDir}`)
  process.exit(1)
}

const files = readdirSync(issuesDir)
  .filter((name) => name.endsWith('.json'))
  .filter((name) => (ONLY ? name.includes(ONLY) : true))

let checkedItems = 0
let badItems = 0
const now = new Date().toISOString()

// 先把所有待检查的条目摊平，再用并发池跑，最后统一写回
const jobs = []
const loaded = new Map()
for (const file of files) {
  const path = join(issuesDir, file)
  const issue = JSON.parse(readFileSync(path, 'utf8'))
  loaded.set(file, issue)
  for (const section of Object.values(issue.sections || {})) {
    for (const item of section.items || []) {
      const links = (Array.isArray(item.links) ? item.links : []).filter((link) => /^https?:/i.test(link.url || ''))
      if (links.length === 0) continue
      jobs.push({ file, issueId: issue.id, item, links })
    }
  }
}

await pool(jobs, async (job) => {
  const results = []
  for (const link of job.links) {
    results.push({ label: link.label, url: link.url, ...(await probe(link.url)) })
  }
  const hasOk = results.some((entry) => entry.kind === 'ok')
  const hasBroken = results.some((entry) => entry.kind === 'broken')
  // 只有"所有链接都明确失败"才算坏链；被 bot 墙挡住 / 超时只记 unknown
  const ok = hasOk || (!hasBroken && results.some((entry) => entry.kind === 'blocked'))
  job.item.linkCheck = {
    at: now.slice(0, 10),
    ok,
    warn: !hasOk && hasBroken,
    results: results.map(({ label, kind, status, error, via }) => ({
      label,
      kind,
      ...(status !== undefined ? { status } : {}),
      ...(via ? { via } : {}),
      ...(error ? { error } : {}),
    })),
  }
  checkedItems += 1
  if (!ok) {
    badItems += 1
    console.log(
      `✗ ${job.issueId} ${job.item.id}: ${results.map((r) => `${r.label}=${r.kind}${r.status ? ':' + r.status : ''}${r.error ? '(' + r.error + ')' : ''}`).join(', ')}`,
    )
  }
})

for (const [file, issue] of loaded) {
  writeFileSync(join(issuesDir, file), `${JSON.stringify(issue, null, 2)}\n`, 'utf8')
}

console.log(`\n检查了 ${checkedItems} 条文献的链接，其中 ${badItems} 条全部不可达（已标记 linkCheck.ok=false）`)
