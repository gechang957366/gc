// API 用量记账：Elsevier 的配额写在响应头里（x-ratelimit-*），DeepSeek 按 token 计费。
//
// 记到 <data>/.api-usage.json，`node scripts/usage.mjs` 会读它并汇总。
// 所有写操作都必须"不能抛错"——记账失败绝不能影响正常抓取。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_DATA_DIR = join(HERE, '..', '..', 'data')

let lastWriteAt = 0
const WRITE_INTERVAL = 4000

function today() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function usagePath(dataDir) {
  return join(resolve(dataDir || DEFAULT_DATA_DIR), '.api-usage.json')
}

/** 读用量文件（不存在就返回空骨架）。 */
export function readUsage(dataDir) {
  const path = usagePath(dataDir)
  let raw = {}
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    raw = {}
  }
  return {
    elsevier: {
      limit: Number(raw.elsevier?.limit) || 0,
      remaining: Number(raw.elsevier?.remaining) || 0,
      resetAt: raw.elsevier?.resetAt || '',
      observedAt: raw.elsevier?.observedAt || '',
      day: raw.elsevier?.day || '',
      callsToday: Number(raw.elsevier?.callsToday) || 0,
      callsTotal: Number(raw.elsevier?.callsTotal) || 0,
    },
    deepseek: {
      day: raw.deepseek?.day || '',
      callsToday: Number(raw.deepseek?.callsToday) || 0,
      callsTotal: Number(raw.deepseek?.callsTotal) || 0,
      tokensToday: Number(raw.deepseek?.tokensToday) || 0,
      tokensTotal: Number(raw.deepseek?.tokensTotal) || 0,
    },
    updatedAt: raw.updatedAt || '',
  }
}

function bumpDay(section) {
  const stamp = today()
  if (section.day !== stamp) {
    section.day = stamp
    section.callsToday = 0
    if ('tokensToday' in section) section.tokensToday = 0
  }
}

function save(usage, dataDir, force = false) {
  const now = Date.now()
  if (!force && now - lastWriteAt < WRITE_INTERVAL) return
  lastWriteAt = now
  try {
    const path = usagePath(dataDir)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ ...usage, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  } catch {
    /* 记账失败不影响主流程 */
  }
}

/** 记一次 Elsevier 调用，并顺手把响应头里的配额存下来。 */
export function recordElsevierCall(headers, dataDir) {
  try {
    const usage = readUsage(dataDir)
    const section = usage.elsevier
    bumpDay(section)
    section.callsToday += 1
    section.callsTotal += 1
    if (headers && typeof headers.get === 'function') {
      const limit = Number(headers.get('x-ratelimit-limit'))
      const remaining = Number(headers.get('x-ratelimit-remaining'))
      const reset = Number(headers.get('x-ratelimit-reset'))
      if (Number.isFinite(limit) && limit > 0) section.limit = limit
      if (Number.isFinite(remaining)) section.remaining = remaining
      if (Number.isFinite(reset) && reset > 0) section.resetAt = new Date(reset * 1000).toISOString()
      section.observedAt = new Date().toISOString()
    }
    save(usage, dataDir)
  } catch {
    /* ignore */
  }
}

/** 记一次 DeepSeek 调用（有 token 数就一起记）。 */
export function recordDeepSeekCall({ tokens = 0, dataDir } = {}) {
  try {
    const usage = readUsage(dataDir)
    const section = usage.deepseek
    bumpDay(section)
    section.callsToday += 1
    section.callsTotal += 1
    if (tokens > 0) {
      section.tokensToday += tokens
      section.tokensTotal += tokens
    }
    save(usage, dataDir)
  } catch {
    /* ignore */
  }
}

/** 直接用一次最轻的 Scopus 请求读当前配额（会消耗 1 次配额）。 */
export async function probeElsevierQuota(apiKey, dataDir) {
  if (!apiKey) return undefined
  try {
    const url =
      'https://api.elsevier.com/content/search/scopus?query=' +
      encodeURIComponent('DOI(10.1016/j.energy.2024.130000)') +
      `&count=1&apiKey=${encodeURIComponent(apiKey)}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    const limit = Number(res.headers.get('x-ratelimit-limit'))
    const remaining = Number(res.headers.get('x-ratelimit-remaining'))
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    const quota = {
      status: res.status,
      limit: Number.isFinite(limit) ? limit : 0,
      remaining: Number.isFinite(remaining) ? remaining : 0,
      resetAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : '',
    }
    recordElsevierCall(res.headers, dataDir)
    return quota
  } catch {
    return undefined
  }
}

/** DeepSeek 余额（不消耗 token）。 */
export async function probeDeepSeekBalance(apiKey) {
  if (!apiKey) return undefined
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!res.ok) return { status: res.status }
    const body = await res.json()
    const cny = (body.balance_infos || []).find((item) => String(item.currency).toUpperCase() === 'CNY') || (body.balance_infos || [])[0]
    return {
      status: res.status,
      available: Boolean(body.is_available),
      currency: cny?.currency || 'CNY',
      total: cny?.total_balance,
      toppedUp: cny?.topped_up_balance,
      granted: cny?.granted_balance,
    }
  } catch {
    return undefined
  }
}

/** 找到可用的 Elsevier key（与抓取脚本同一套查找顺序）。 */
export function readElsevierKeyFrom(dataDir) {
  if (process.env.ELSEVIER_API_KEY) return process.env.ELSEVIER_API_KEY.trim()
  for (const path of [join(resolve(dataDir || DEFAULT_DATA_DIR), '.elsevier-key'), join(resolve(dataDir || DEFAULT_DATA_DIR), '..', '.elsevier-key')]) {
    try {
      if (existsSync(path)) {
        const value = readFileSync(path, 'utf8').trim()
        if (value) return value
      }
    } catch {
      /* ignore */
    }
  }
  return ''
}
