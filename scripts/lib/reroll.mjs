// "换一批"：按当前方向从"等级排好序的候选池"里取下一批新文献，做成新的一期。
//
// 关键改动：老做法是 searchLiterature(limit:10, offset) 一页页往后翻，
// 翻到第 2、3 批时同一关键词的弱池子已经见底，质量自然一批比一批差。
// 现在先按方向建一个"按等级排序"的深池（写盘缓存 12 小时），
// 每批都从池子里按 rank 顺序取还没收录过的，所以第 1 批和第 5 批是同一档次。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadJournals } from './metrics.mjs'
import { resolveArea } from './domains.mjs'
import { curateItem } from './deepseek.mjs'
import { summarizeSection } from './summary.mjs'
import {
  DEFAULT_DATA_DIR,
  fillAbstracts,
  finaliseItem,
  matchesQuery,
  pickBatch,
  pickDiverse,
  rerollPool,
  seenFromIssues,
} from './pool.mjs'

const DEFAULT_QUERIES = {
  field: ['wind power forecasting', 'photovoltaic power forecasting'],
  algo: ['time series forecasting', 'time series foundation model'],
}

/** 这个方向自己的检索词（sources.json 的 scopus.queries / arxiv.field）。 */
function domainQueries(area, section) {
  let cfg = {}
  try {
    cfg = JSON.parse(readFileSync(area.sourcesPath, 'utf8'))
  } catch {
    return []
  }
  const fromScopus = (cfg.scopus?.queries?.[section] || []).map((query) => String(query).replace(/"/g, '').trim())
  const fromArxiv = (cfg.arxiv?.[section] || []).map((query) => String(query).trim())
  const merged = [...new Set([...fromScopus, ...fromArxiv])].filter(Boolean)
  return merged.slice(0, 4)
}

function isoLocal(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00+08:00`
}

/**
 * @param {{dataDir?: string, domain?: string, section?: 'field'|'algo', apiKey?: string, llmKey?: string,
 *          query?: string, count?: number, years?: number, refresh?: boolean}} options
 * @returns {Promise<{issueId: string, count: number, pool: object, summary?: string}>}
 */
export async function rerollBatch({
  dataDir = DEFAULT_DATA_DIR,
  domain,
  section = 'field',
  apiKey,
  llmKey,
  query,
  count = 8,
  years = 4,
  refresh = false,
} = {}) {
  const area = resolveArea(dataDir, domain)
  const indexPath = area.indexPath
  if (!existsSync(indexPath)) throw new Error(`「${area.entry.label}」还没有数据目录，先跑一次 scripts/add-domain.mjs`)
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const journals = loadJournals(area.journalsPath)

  const { ids: seenIds, titles: seenTitles } = seenFromIssues(area)

  // 检索词必须用**这个方向自己的**配置。早先这里写死了功率预测的两个词，
  // 所以新建方向的「换一批」抓回来还是功率预测的论文。
  const ownQueries = domainQueries(area, section)
  const queries = query ? [query] : ownQueries.length ? ownQueries : DEFAULT_QUERIES[section] || DEFAULT_QUERIES.field
  if (refresh) {
    try {
      const { rmSync } = await import('node:fs')
      rmSync(join(area.dir, '.pool'), { recursive: true, force: true })
    } catch {
      /* 删不掉就继续用旧池 */
    }
  }
  const { items: pool, stats } = await rerollPool({ section, apiKey, area, years, queries })

  let candidates = pickBatch(pool, {
    count: count * 4,
    excludeIds: seenIds,
    excludeTitles: seenTitles,
  })
  if (!candidates.length) {
    throw new Error('候选池里已经没有未收录的文献了：换个方向或等下一轮抓取后再试')
  }
  // 摘要现补（Elsevier/IEEE 在 Crossref 里不给摘要，Scopus META_ABS 才有）
  await fillAbstracts(candidates, { apiKey, want: Math.min(candidates.length, count * 3) })
  // 补完摘要再按检索词判一次相关度，滤掉"词面命中"的噪声；命中任一方向词即可
  const strict = candidates.filter(
    (item) =>
      (item.abstractEn || '').length >= 120 && queries.some((query_) => matchesQuery(item, query_)),
  )
  // 同一批里同一本刊最多 3 篇（否则尾流方向的「换一批」会变成一整页 Physics of Fluids）
  let picked = pickDiverse(strict, { count, venueCap: 3 })
  if (!picked.length) {
    const fallback = candidates.filter((item) => (item.abstractEn || '').length >= 120)
    picked = pickDiverse(fallback, { count, venueCap: 3 })
  }
  if (!picked.length) picked = candidates.slice(0, Math.min(count, candidates.length))

  if (!picked.length) throw new Error('这一批没能取到摘要，换一批再试')

  // 和每周更新同一套整理：中英双语 + 技术点 + 引用 + 分区
  if (llmKey) {
    let cursor = 0
    const workers = Array.from({ length: Math.min(4, picked.length) }, async () => {
      while (cursor < picked.length) {
        const item = picked[cursor]
        cursor += 1
        if (!item.abstractEn || item.abstractEn.length < 80) continue
        try {
          const { fields } = await curateItem(llmKey, item)
          item.titleZh = fields.titleZh || item.titleZh
          item.abstractZh = fields.abstractZh || item.abstractZh
          item.keyPoints = fields.keyPoints || []
          item.relevance = fields.relevance || ''
          if (fields.keywords?.length) item.keywords = fields.keywords
          item.tags = fields.tags || []
        } catch {
          item.needsCuration = true
        }
      }
    })
    await Promise.all(workers)
  }

  // 方向旗舰刊一起传：不然重算 rank 会把池子里判好的「领域顶刊」降成 JCR Q1
  const flagship = (() => {
    try {
      return JSON.parse(readFileSync(area.sourcesPath, 'utf8')).flagship?.[section] || []
    } catch {
      return []
    }
  })()
  picked = picked.map((item) => finaliseItem(item, { journals, section, flagship }))
  picked.sort(
    (a, b) => (a.rank || 99) - (b.rank || 99) || String(b.date).localeCompare(String(a.date)),
  )

  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const issuesDir = area.issuesDir
  mkdirSync(issuesDir, { recursive: true })
  let suffix = 1
  let issueId = `${stamp}-b${suffix}`
  while (existsSync(join(issuesDir, `${issueId}.json`))) {
    suffix += 1
    issueId = `${stamp}-b${suffix}`
  }

  const dates = picked.map((item) => String(item.date)).filter(Boolean).sort()
  let summary = ''
  if (llmKey) {
    try {
      summary = await summarizeSection(section, picked, llmKey, { topic: queries.join(' / ') })
    } catch {
      summary = ''
    }
  }

  const tierCount = picked.reduce((acc, item) => {
    const key = item.tierLabel || '其他'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const remaining = pickBatch(pool, {
    count: 999,
    excludeIds: new Set([...seenIds, ...picked.map((item) => String(item.id).toLowerCase())]),
    excludeTitles: new Set([...seenTitles, ...picked.map((item) => String(item.title).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ''))]),
  }).length

  const issue = {
    id: issueId,
    domain: area.id,
    label: `换一批 · ${now.getMonth() + 1}-${String(now.getDate()).padStart(2, '0')} 第 ${suffix} 批`,
    week: null,
    year: now.getFullYear(),
    range: [dates[0] || '', dates[dates.length - 1] || ''],
    mode: 'batch',
    generatedAt: isoLocal(now),
    generatedBy: 'reroll',
    note: `按「${queries.join(' / ')}」从等级池（${pool.length} 条候选）里取下一批：${Object.entries(tierCount)
      .map(([tier, n]) => `${tier} ${n}`)
      .join(' · ')}。上一批仍保留在历史期号里。`,
    counts: { field: section === 'field' ? picked.length : 0, algo: section === 'algo' ? picked.length : 0, figures: 0 },
    sections: {
      field: {
        title: area.entry.sections?.field || '专业前沿',
        subtitle: area.entry.subtitle || '功率预测 · 气象预报 · 雷达流场重构',
        ...(section === 'field' && summary ? { summary } : {}),
        items: section === 'field' ? picked : [],
      },
      algo: {
        title: area.entry.sections?.algo || '算法进展',
        subtitle: '大模型 · 时序预测',
        ...(section === 'algo' && summary ? { summary } : {}),
        items: section === 'algo' ? picked : [],
      },
    },
  }
  writeFileSync(join(issuesDir, `${issueId}.json`), `${JSON.stringify(issue, null, 2)}\n`, 'utf8')

  const entry = {
    id: issueId,
    label: issue.label,
    range: issue.range,
    mode: 'batch',
    updatedAt: issue.generatedAt,
    counts: issue.counts,
    note: issue.note,
  }
  index.issues = [entry, ...(index.issues || [])]
  index.current = issueId
  index.updatedAt = issue.generatedAt
  index.domain = area.id
  if (!index.title) index.title = `每周文献速递 · ${area.entry.short || area.entry.label}`
  if (!index.subtitle) index.subtitle = area.entry.subtitle || ''
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')

  return {
    issueId,
    domain: area.id,
    domainLabel: area.entry.label,
    count: picked.length,
    summary,
    tiers: tierCount,
    pool: { size: pool.length, remaining, cached: Boolean(stats?.cached), queries },
  }
}
