// 文献检索：给定关键词，走「优先期刊定向 + arXiv 顶会」的候选池，返回和速递条目同构的对象。
//
// 插件宿主的 /api/search 与在线版的局域网服务器都用这一份。
// 取数与排序在 lib/pool.mjs 里（先按等级、同等级再按相关度），
// 所以检索结果的第一页和每周精选是同一档次，而不是 Scopus 相关度前排的随机来源。
import { metricsFor, loadJournals } from './metrics.mjs'
import { resolveArea } from './domains.mjs'
import { buildCitation } from './citation.mjs'
import { curateItem } from './deepseek.mjs'
import { summarizeSection } from './summary.mjs'
import {
  DEFAULT_DATA_DIR,
  buildPool,
  fillAbstracts,
  finaliseItem,
  loadPoolSources,
  matchesQuery,
  searchPool,
} from './pool.mjs'

const MIN_ABSTRACT = 120

/** 常见中文检索词 → 英文（Scopus / arXiv 都按英文索引，中文直接查是 0 结果）。 */
const GLOSSARY = new Map([
  ['尾流控制', 'wake control'],
  ['尾流', 'wind turbine wake'],
  ['功率预测', 'power forecasting'],
  ['风电功率预测', 'wind power forecasting'],
  ['光伏功率预测', 'photovoltaic power forecasting'],
  ['超短期预测', 'ultra-short-term forecasting'],
  ['气象预报', 'weather forecasting'],
  ['数值天气预报', 'numerical weather prediction'],
  ['降尺度', 'downscaling'],
  ['雷达', 'radar'],
  ['激光雷达', 'lidar'],
  ['流场重构', 'flow field reconstruction'],
  ['测风', 'wind measurement'],
  ['爬坡事件', 'ramp event'],
  ['概率预测', 'probabilistic forecasting'],
  ['大模型', 'large language model'],
  ['时序预测', 'time series forecasting'],
  ['时序基础模型', 'time series foundation model'],
  ['多模态', 'multimodal'],
  ['图神经网络', 'graph neural network'],
  ['强化学习', 'reinforcement learning'],
  ['储能', 'energy storage'],
  ['风电场', 'wind farm'],
  ['数据同化', 'data assimilation'],
  ['资料同化', 'data assimilation'],
  ['集合预报', 'ensemble forecasting'],
  ['深度学习', 'deep learning'],
  ['注意力机制', 'attention mechanism'],
  ['雷达流场重构', 'radar flow field reconstruction'],
  ['雷达测风', 'radar wind measurement'],
  ['测风塔', 'meteorological mast wind measurement'],
  ['激光测风', 'lidar wind measurement'],
  ['尾流模型', 'wake model'],
  ['尾流效应', 'wake effect'],
  ['风电场尾流', 'wind farm wake'],
  ['尾流协同', 'wake coordination'],
  ['偏航控制', 'yaw control'],
  ['短期预测', 'short-term forecasting'],
  ['中长期预测', 'medium-term forecasting'],
  ['新能源功率预测', 'renewable power forecasting'],
  ['光伏出力预测', 'photovoltaic power forecasting'],
  ['功率曲线', 'power curve'],
  ['弃风', 'wind curtailment'],
  ['储能调度', 'energy storage dispatch'],
  ['负荷预测', 'load forecasting'],
  ['时序大模型', 'time series foundation model'],
  ['扩散模型', 'diffusion model'],
  ['混合专家', 'mixture of experts'],
  ['状态空间模型', 'state space model'],
  ['迁移学习', 'transfer learning'],
  ['小样本', 'few-shot learning'],
  ['可解释性', 'interpretability'],
  ['智能体', 'agent'],
  ['多智能体', 'multi-agent'],
])

/**
 * 把检索词变成英文（Scopus / arXiv 只认英文）。
 * 先查内置术语表，查不到再用 DeepSeek 翻一句（没有 key 就原样返回）。
 */
export async function normalizeQuery(query, llmKey) {
  const raw = String(query || '').trim()
  if (!raw) return { queryEn: '', translated: false, source: 'empty' }
  if (!/[\u4e00-\u9fa5]/.test(raw)) return { queryEn: raw, translated: false, source: 'as-is' }

  const glossaryHit = GLOSSARY.get(raw) || GLOSSARY.get(raw.replace(/\s+/g, ''))
  if (glossaryHit) return { queryEn: glossaryHit, translated: true, source: 'glossary' }

  if (llmKey) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmKey}` },
        body: JSON.stringify({
          model: process.env.DWP_MODEL || 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content:
                '把用户给的中文检索词翻译成适合在 Scopus/arXiv 上检索的英文术语，只输出英文短语本身，不要解释、不要引号。',
            },
            { role: 'user', content: raw },
          ],
          temperature: 0,
          max_tokens: 40,
        }),
      })
      if (res.ok) {
        const body = await res.json()
        const text = String(body?.choices?.[0]?.message?.content || '')
          .replace(/["'\n]/g, ' ')
          .trim()
        if (text && /[a-zA-Z]/.test(text)) return { queryEn: text, translated: true, source: 'llm' }
      }
    } catch {
      /* 翻译失败就原样查 */
    }
  }
  return { queryEn: raw, translated: false, source: 'fallback' }
}

function tierHistogram(items) {
  const out = {}
  for (const item of items) {
    const key = item.tierLabel || '其他'
    out[key] = (out[key] || 0) + 1
  }
  return out
}

/**
 * 从池子头部按顺序往后取，凑够 limit 条"摘要齐 + 相关"的结果。
 * 返回 cursor = 已经看到池子的第几条，下一页从这儿接着看（不会重复、也不跳条）。
 * 最多补 40 条摘要，避免一个奇怪的关键词把 Scopus 配额刷光。
 */
async function pickRelevant(pool, { offset = 0, limit = 10, apiKey, query }) {
  const out = []
  let cursor = offset
  let budget = 40
  while (out.length < limit && cursor < pool.length && budget > 0) {
    const size = Math.max(6, Math.min(pool.length - cursor, limit * 2, budget))
    const chunk = pool.slice(cursor, cursor + size)
    await fillAbstracts(chunk, { apiKey, want: chunk.length })
    let consumed = 0
    for (const item of chunk) {
      consumed += 1
      if (!item.abstractEn || item.abstractEn.length < MIN_ABSTRACT) continue
      if (!matchesQuery(item, query)) continue
      out.push(item)
      if (out.length >= limit) break
    }
    cursor += consumed
    budget -= chunk.length
  }
  return { items: out, cursor }
}

/**
 * 综合检索。
 * @param {{query: string, limit?: number, offset?: number, apiKey?: string, llmKey?: string,
 *          journals?: object[], dataDir?: string, years?: number, skipCurate?: boolean}} options
 * @returns {Promise<{items: object[], summary?: string, meta: object}>}
 */
export async function searchLiterature({
  query,
  limit = 12,
  offset = 0,
  apiKey,
  llmKey,
  journals,
  dataDir = DEFAULT_DATA_DIR,
  domain,
  years = 5,
  section,
  skipCurate = false,
} = {}) {
  const original = String(query || '').trim()
  if (!original) return { items: [], summary: '', meta: { query: '', total: 0 } }
  const started = Date.now()
  const area = resolveArea(dataDir, domain)
  const { queryEn, translated, source: translationSource } = await normalizeQuery(original, llmKey)
  const q = String(queryEn || original).replace(/["']/g, ' ').replace(/\s+/g, ' ').trim()
  // Scopus / arXiv 都按英文索引：中文没翻出来就别白跑一趟，直接给个明确提示
  if (/[\u4e00-\u9fa5]/.test(q) && !/[a-zA-Z]{3}/.test(q)) {
    return {
      items: [],
      summary: '',
      meta: {
        query: original,
        queryEn: q,
        translated,
        translationSource,
        total: 0,
        ms: Date.now() - started,
        error: `「${original}」没能翻成英文检索词（Scopus / arXiv 只认英文）。换个说法，或用里面的英文术语再搜，例如 wake steering / radar wind measurement。`,
      },
    }
  }
  const pickedSection =
    section === 'algo' || section === 'field'
      ? section
      : /time series|language model|foundation model|llm|transformer|agent|neural|diffusion|benchmark/i.test(q)
        ? 'algo'
        : 'field'

  // 池子按"等级优先"排好序；翻页时复用同一池子（20 分钟缓存）
  const { items: pool, stats } = await searchPool({
    query: q,
    section: pickedSection,
    apiKey,
    dataDir,
    domain: area.id,
    years,
  })

  const journalList = Array.isArray(journals) && journals.length
    ? journals
    : loadJournals(area.journalsPath)

  // 方向自己的旗舰刊（JFM/POF…）要一起传下去，否则重算 rank 会把「领域顶刊」降成 JCR Q1
  const { cfg: domainCfg } = loadPoolSources(area)
  const flagship = domainCfg.flagship?.[pickedSection] || []

  // 按等级顺序往后扫，补摘要 → 判相关度 → 够 limit 条就停。
  // 宁可少给几条，也不拿不相关的凑数（凑数正是"质量差"的来源）。
  const { items: picked, cursor } = await pickRelevant(pool, { offset, limit, apiKey, query: q })
  const items = picked.map((item) =>
    finaliseItem({ ...item }, { journals: journalList, section: pickedSection, flagship }),
  )

  // 和速递一个样子：中文题名/摘要、关键技术点、GB/T 引用、期刊分区
  if (llmKey && !skipCurate) {
    let cursor = 0
    const workers = Array.from({ length: Math.min(4, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor]
        cursor += 1
        if (!item.abstractEn || item.abstractEn.length < 80) continue
        try {
          const { fields } = await curateItem(llmKey, item)
          item.titleZh = fields.titleZh || item.titleZh
          item.abstractZh = fields.abstractZh || item.abstractZh
          item.keyPoints = fields.keyPoints || []
          item.relevance = fields.relevance || ''
          if (fields.keywords && fields.keywords.length) item.keywords = fields.keywords
          item.tags = fields.tags || []
        } catch {
          item.needsCuration = true
        }
      }
    })
    await Promise.all(workers)
  }

  // 检索结果也给一段概述（和速递一致，但不写"共同面对的核心问题"那种概括句）
  let summary = ''
  if (llmKey && items.length >= 2) {
    try {
      summary = await summarizeSection('search', items, llmKey, { topic: original })
    } catch {
      summary = ''
    }
  }

  return {
    items,
    summary,
    meta: {
      query: original,
      queryEn: q,
      translated,
      translationSource,
      domain: area.id,
      total: items.length,
      poolSize: pool.length,
      offset,
      nextOffset: cursor,
      exhausted: cursor >= pool.length,
      tiers: tierHistogram(pool.slice(0, 60)),
      sources: stats
        ? Object.entries({
            scopus: stats.scopus,
            crossref: stats.crossref,
            arxiv: (stats.arxiv || 0) + (stats.arxivConf || 0),
          })
            .filter(([, count]) => count > 0)
            .map(([name]) => name)
        : [],
      stats: stats
        ? { scopus: stats.scopus, crossref: stats.crossref, arxiv: stats.arxiv, arxivConf: stats.arxivConf, kept: stats.kept, issns: stats.issns }
        : undefined,
      ms: Date.now() - started,
    },
  }
}

export { buildPool, fillAbstracts, loadPoolSources, metricsFor }
