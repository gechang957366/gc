// DeepSeek API 小客户端：把一条英文文献整理成中文卡片。
//
// 为了自动化：每周更新时用它做翻译 + 提炼技术点，不需要人在场。
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const API = 'https://api.deepseek.com/chat/completions'
const MODEL = process.env.DWP_MODEL || 'deepseek-chat'

/** 从环境变量或 DSH 凭据文件里取 key。 */
export function resolveApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  const candidates = [
    join(homedir(), '.dsh', '.credentials.yaml'),
    join(homedir(), '.deepseek', 'config.json'),
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const text = readFileSync(path, 'utf8')
      const match = text.match(/DEEPSEEK_API_KEY:\s*['"]?([A-Za-z0-9_\-]{16,})['"]?/)
      if (match) return match[1]
      const json = JSON.parse(text)
      const value = json?.DEEPSEEK_API_KEY || json?.apiKey
      if (typeof value === 'string' && value.length > 16) return value
    } catch {
      /* 换下一个来源 */
    }
  }
  return undefined
}

const SYSTEM = `你是新能源功率预测方向的研究者，负责把英文文献整理成中文速递卡片。
只输出 JSON，不要解释。字段：
- titleZh: 中文题名（忠实翻译，不要加修饰）
- abstractZh: 中文摘要（忠实翻译原文摘要，保留数字与结论，不要扩写）
- keyPoints: 3-5 条中文技术要点，每条 ≤60 字，说清"做了什么、怎么做的、效果如何"
- relevance: 一句话说明它和"风电/光伏功率预测、气象预报、雷达流场重构"的关系；无关就写它与大模型/时序预测方法的关系
- keywords: 3-6 个中文关键词
- tags: 1-3 个，只能取自 [功率预测, 气象预报, 雷达流场重构, 大模型, 时序预测, 多模态, 图学习, 概率预测]
数字必须来自摘要原文，不要编造。`

function buildUserPrompt(item) {
  return JSON.stringify(
    {
      title: item.title,
      venue: item.venue,
      year: item.year,
      abstract: item.abstractEn,
      hint: item.section === 'algo' ? '这是算法方向（大模型/时序预测）的论文' : '这是新能源/气象方向的应用论文',
    },
    null,
    1,
  )
}

async function callOnce(apiKey, item) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUserPrompt(item) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 1600,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`DeepSeek ${res.status}: ${body.slice(0, 200)}`)
  }
  const body = await res.json()
  const content = body?.choices?.[0]?.message?.content ?? ''
  const parsed = JSON.parse(content)
  const usage = body?.usage ?? {}
  // 记账（token 用量 + 调用次数），供 `node scripts/usage.mjs` 汇总
  try {
    const { recordDeepSeekCall } = await import('./usage.mjs')
    recordDeepSeekCall({ tokens: Number(usage.total_tokens) || 0 })
  } catch {
    /* 记账失败不影响整理 */
  }
  return { parsed, usage }
}

/**
 * 把一条文献补上中文标题/摘要/要点。
 * @param {string} apiKey
 * @param {object} item - 至少包含 title / abstractEn / venue / year / section
 * @returns {Promise<{fields: object, usage: object}>}
 */
export async function curateItem(apiKey, item) {
  if (!item.abstractEn || item.abstractEn.length < 80) {
    throw new Error('abstractEn 太短，跳过整理')
  }
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { parsed, usage } = await callOnce(apiKey, item)
      const fields = {
        titleZh: typeof parsed.titleZh === 'string' ? parsed.titleZh.trim() : '',
        abstractZh: typeof parsed.abstractZh === 'string' ? parsed.abstractZh.trim() : '',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter((x) => typeof x === 'string').slice(0, 5) : [],
        relevance: typeof parsed.relevance === 'string' ? parsed.relevance.trim() : '',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((x) => typeof x === 'string').slice(0, 6) : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((x) => typeof x === 'string').slice(0, 3) : [],
      }
      if (!fields.titleZh || !fields.abstractZh || fields.keyPoints.length < 2) {
        throw new Error('模型返回字段不完整')
      }
      return { fields, usage }
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)))
    }
  }
  throw lastError
}
