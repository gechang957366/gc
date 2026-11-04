// 期刊等级解析：把 data/journals.json 里的分区/影响因子映射到单条文献上。
//
// 用法：
//   import { loadJournals, metricsFor } from './lib/metrics.mjs'
//   const journals = loadJournals('data/journals.json')
//   item.metrics = metricsFor(journals, item.venue, item.venueShort)
import { readFileSync, existsSync } from 'node:fs'

/** 常见缩写 → 期刊全名（小写，仅保留字母数字）。 */
const ALIASES = {
  applenergy: 'applied energy',
  renewenergy: 'renewable energy',
  renewenerg: 'renewable energy',
  energyconversmanag: 'energy conversion and management',
  energyconversionandmanagement: 'energy conversion and management',
  ieeetste: 'ieee transactions on sustainable energy',
  ieeetransonsustainableenergy: 'ieee transactions on sustainable energy',
  ieeetsg: 'ieee transactions on smart grid',
  ieeetransonsmartgrid: 'ieee transactions on smart grid',
  ieeetps: 'ieee transactions on power systems',
  ieeetransonpowersystems: 'ieee transactions on power systems',
  ieeetec: 'ieee transactions on energy conversion',
  ieeetpd: 'ieee transactions on power delivery',
  ieeetkde: 'ieee transactions on knowledge and data engineering',
  ieeetpami: 'ieee transactions on pattern analysis and machine intelligence',
  windenergysci: 'wind energy science',
  windenergy: 'wind energy',
  monwearev: 'monthly weather review',
  monthlyweatherreview: 'monthly weather review',
  remotesens: 'remote sensing',
  atmosmeastech: 'atmospheric measurement techniques',
  geoscimodeldev: 'geoscientific model development',
  natcommun: 'nature communications',
  natmachintell: 'nature machine intelligence',
  natureresearch: 'nature',
  scirep: 'scientific reports',
  plosone: 'plos one',
  jmachlearnres: 'journal of machine learning research',
  jmlr: 'journal of machine learning research',
  advatmosssci: 'advances in atmospheric sciences',
  jrenewablesustainenergy: 'journal of renewable and sustainable energy',
  chinamotorengineering: '中国电机工程学报',
  automationofelectricpowersystems: '电力系统自动化',
  chinaelectricpower: '中国电力',
  renewableenergyresources: '可再生能源',
}

export function normalizeName(value) {
  if (typeof value !== 'string') return ''
  return value
    .toLowerCase()
    .replace(/[（(].*?[)）]/g, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
}

/** 读 data/journals.json；文件不存在时返回空表（界面只是少几个标签）。 */
export function loadJournals(path) {
  if (!path || !existsSync(path)) return []
  try {
    const body = JSON.parse(readFileSync(path, 'utf8'))
    const list = Array.isArray(body) ? body : body.journals ?? []
    return list.filter((entry) => entry && entry.name)
  } catch {
    return []
  }
}

function indexJournals(journals) {
  const byName = new Map()
  for (const entry of journals) {
    byName.set(normalizeName(entry.name), entry)
    if (entry.issn) byName.set(String(entry.issn).replace(/[^0-9xX]/g, ''), entry)
  }
  return byName
}

/**
 * 为一条文献找期刊等级。
 * @param {Array} journals - loadJournals 的返回值
 * @param {string} venue - 期刊全名
 * @param {string} [venueShort] - 短名/缩写
 * @returns {{cas?: object, jcr?: object, if?: number, ccf?: string, source?: string}|undefined}
 */
export function metricsFor(journals, venue, venueShort) {
  if (!Array.isArray(journals) || journals.length === 0) return undefined
  const byName = indexJournals(journals)
  const candidates = [venue, venueShort].filter(Boolean)
  for (const candidate of candidates) {
    const key = normalizeName(candidate)
    const direct = byName.get(key) ?? (ALIASES[key] ? byName.get(normalizeName(ALIASES[key])) : undefined)
    if (direct) return pick(direct)
  }
  // 退化：只拿**期刊全名**做包含匹配。
  // 短名会被截断（"Renewable and"），拿它做模糊匹配会把
  // Renewable and Sustainable Energy Reviews 错配成 Journal of Renewable and Sustainable Energy。
  const full = normalizeName(venue)
  if (full.length >= 8) {
    for (const entry of journals) {
      const entryKey = normalizeName(entry.name)
      if (entryKey === full) return pick(entry)
      if (entryKey.length >= 10 && (full.includes(entryKey) || entryKey.includes(full))) return pick(entry)
    }
  }
  return undefined
}

function pick(entry) {
  const metrics = {}
  if (entry.cas && entry.cas.zone) metrics.cas = entry.cas
  if (entry.jcr && entry.jcr.quartile) metrics.jcr = entry.jcr
  if (typeof entry.if === 'number') metrics.if = entry.if
  if (entry.ccf) metrics.ccf = entry.ccf
  if (entry.cn) metrics.cn = entry.cn
  if (entry.source) metrics.source = entry.source
  if (Object.keys(metrics).length === 0) return undefined
  return metrics
}
