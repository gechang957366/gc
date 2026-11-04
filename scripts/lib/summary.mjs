// 生成"概述"：把一批条目喂给 DeepSeek，产出一段中文综述。
// summarize-issue.mjs（手动）、update-weekly.mjs（每周自动）、search.mjs（检索结果）共用。
const SECTION_LABEL = {
  field: '专业前沿（功率预测 / 气象预报 / 雷达流场重构）',
  algo: '算法进展（大模型 / 时序预测）',
  search: '主题检索结果',
}

const SECTION_HINT = {
  field: '写清这批文献用了哪几类方法（数据同化 / 气象信息融合 / 图网络 / 概率预测等）、技术差异与趋势。',
  algo: '写清这批文献在解决什么问题（不确定性刻画、计算效率、长上下文、分布漂移等）、方法脉络与相互差异。',
  search: '写清这批检索结果的方法脉络与相互差异，以及它们各自切入的角度。',
}

/**
 * @param {'field'|'algo'|'search'} sectionKey
 * @param {object[]} items
 * @param {string} apiKey - DeepSeek key
 * @param {{topic?: string}} [options]
 * @returns {Promise<string>}
 */
export async function summarizeSection(sectionKey, items, apiKey, options = {}) {
  if (!apiKey) throw new Error('缺少 DEEPSEEK_API_KEY')
  if (!Array.isArray(items) || items.length === 0) return ''

  const digest = items
    .slice(0, 14)
    .map((item, index) => {
      const points = (item.keyPoints || []).slice(0, 2).join('；')
      return `${index + 1}. ${item.titleZh || item.title}（${item.venue || ''}）${points ? '｜' + points : ''}`
    })
    .join('\n')

  const system = `你是新能源功率预测方向的研究者，正在给同事写一段文献导语。
硬性要求：
1) 中文，120-200 字，不分段、不列表、不用"第一/第二"。
2) **不要写"当前(这批/这些)研究共同面对的核心问题是……""当前……的关键在于……"这类概括性开场句**——那是对有限样本的推断，容易误导；直接从方法路径、技术选择与差异写起。
3) 不逐篇复述题目，不出现"本文""本期""以下几篇"，不写参考文献编号。
只输出这段话本身。${SECTION_HINT[sectionKey] || ''}`

  const topicLine = options.topic ? `检索主题：${options.topic}\n` : ''
  const user = `${topicLine}方向：${SECTION_LABEL[sectionKey] || sectionKey}\n共 ${items.length} 篇，清单如下：\n${digest}`

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.DWP_MODEL || 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      max_tokens: 700,
    }),
  })
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const body = await res.json()
  return String(body?.choices?.[0]?.message?.content || '').trim()
}
