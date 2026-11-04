// 文献等级：把"会议录用 / 顶刊 / 1区 / Q1 …"统一成一个可排序的 rank。
//
// rank 越小越靠前。会议（算法侧）> Nature/Science > 中科院 1 区/Q1 > 2 区/Q2 > 其他 SCI > EI/中文核心 > 预印本。

/** 会议别名 → 规范名 + CCF 等级。 */
export const CONFERENCES = {
  neurips: { label: 'NeurIPS', ccf: 'A', aliases: ['neurips', 'nips', 'neural information processing systems'] },
  icml: { label: 'ICML', ccf: 'A', aliases: ['icml', 'international conference on machine learning'] },
  iclr: { label: 'ICLR', ccf: 'A', aliases: ['iclr', 'international conference on learning representations'] },
  cvpr: { label: 'CVPR', ccf: 'A', aliases: ['cvpr', 'computer vision and pattern recognition'] },
  iccv: { label: 'ICCV', ccf: 'A', aliases: ['iccv', 'international conference on computer vision'] },
  acl: { label: 'ACL', ccf: 'A', aliases: ['acl', 'association for computational linguistics'] },
  kdd: { label: 'KDD', ccf: 'A', aliases: ['kdd', 'knowledge discovery and data mining', 'sigkdd'] },
  aaai: { label: 'AAAI', ccf: 'A', aliases: ['aaai'] },
  ijcai: { label: 'IJCAI', ccf: 'A', aliases: ['ijcai'] },
  www: { label: 'WWW', ccf: 'A', aliases: ['www', 'the web conference', 'world wide web conference'] },
  sigir: { label: 'SIGIR', ccf: 'A', aliases: ['sigir'] },
  vldb: { label: 'VLDB', ccf: 'A', aliases: ['vldb', 'very large data bases'] },
  sigmod: { label: 'SIGMOD', ccf: 'A', aliases: ['sigmod'] },
  icde: { label: 'ICDE', ccf: 'A', aliases: ['icde'] },
  emnlp: { label: 'EMNLP', ccf: 'B', aliases: ['emnlp', 'empirical methods in natural language processing'] },
  naacl: { label: 'NAACL', ccf: 'B', aliases: ['naacl'] },
  eccv: { label: 'ECCV', ccf: 'B', aliases: ['eccv', 'european conference on computer vision'] },
  cikm: { label: 'CIKM', ccf: 'B', aliases: ['cikm'] },
  wsdm: { label: 'WSDM', ccf: 'B', aliases: ['wsdm'] },
  icdm: { label: 'ICDM', ccf: 'B', aliases: ['icdm'] },
  coling: { label: 'COLING', ccf: 'B', aliases: ['coling'] },
}

/** 会议论文时"降级"的信号：workshop / 投稿中 / 期刊扩展版。 */
const NEGATIVE = [
  /workshop/i,
  /\bsymposium\b/i,
  /findings of/i,
  /submitted (to|for)/i,
  /under review/i,
  /in submission/i,
  /preprint/i,
  /journal extension/i,
  /extended version/i,
  /doctoral consortium/i,
  /demo track/i,
  /\btutorial\b/i,
  /\bposter\b/i,
]

/** 明确"已录用"的信号。 */
const POSITIVE = [
  /accepted (to|at|by|in)/i,
  /to appear (in|at)/i,
  /published (in|at|by)/i,
  /appear(ing)? (in|at)/i,
  /\b(oral|spotlight)\b/i,
  /main conference/i,
  /camera[- ]ready/i,
  /proceedings of/i,
]

/**
 * 从 arXiv 的 comment/journal_ref 里判断"是否被顶会录用"。
 * @param {string} comment - arXiv comment 字段
 * @param {string} [journalRef] - arXiv journal_ref 字段
 * @param {string} [venueHint] - 查询时用的会议名（命中别人的 comment 时兜底）
 * @returns {{key: string, label: string, ccf: string, year: number, kind: 'conf'|'findings'} | undefined}
 */
export function detectAcceptance(comment, journalRef, venueHint) {
  const text = `${comment || ''} ${journalRef || ''}`.trim()
  if (!text) return undefined
  const lower = text.toLowerCase()
  const isFindings = /findings of/i.test(text)
  // workshop / 投稿中 / 扩展版 一律不算
  for (const pattern of NEGATIVE) {
    if (pattern.test(text) && !(isFindings && /findings of/i.test(pattern.source))) return undefined
  }
  for (const [key, info] of Object.entries(CONFERENCES)) {
    const hit = info.aliases.some((alias) => lower.includes(alias))
    if (!hit) continue
    // 命中会议名还要有"录用"语气，或者明确带年份的直接写法（如 "CVPR 2026"）
    const explicit = new RegExp(`${info.label}\\s*20\\d{2}`, 'i').test(text) || /20\d{2}/.test(text)
    const positive = POSITIVE.some((pattern) => pattern.test(text))
    if (!positive && !explicit) continue
    const yearMatch = text.match(/(20\d{2})/)
    const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear()
    return {
      key,
      label: `${info.label} ${year}`,
      ccf: isFindings ? 'B' : info.ccf,
      year,
      kind: isFindings ? 'findings' : 'conf',
    }
  }
  // 只有 hint 命中、comment 里没写全称时也认
  if (venueHint) {
    const hintKey = Object.keys(CONFERENCES).find((key) => CONFERENCES[key].label.toLowerCase() === venueHint.toLowerCase())
    if (hintKey && POSITIVE.some((pattern) => pattern.test(text))) {
      const info = CONFERENCES[hintKey]
      const yearMatch = text.match(/(20\d{2})/) || (venueHint.match(/(20\d{2})/) ? [venueHint.match(/(20\d{2})/)[0]] : [])
      const year = yearMatch ? Number(yearMatch[0]) : new Date().getFullYear()
      return { key: hintKey, label: `${info.label} ${year}`, ccf: info.ccf, year, kind: 'conf' }
    }
  }
  return undefined
}

const TOP_JOURNALS = /^(nature|science|nature (energy|communications|machine intelligence|climate change|sustainability|water)|science advances|cell|joule|pnas)$/i

/**
 * 领域旗舰刊命中判定：每个方向可以在自己的 sources.json 里写 flagship.field
 * （例如尾流方向的 JFM / POF / PRF / JWEIA / JFS）。中科院大类分区不等于领域地位，
 * 这些刊在本方向就该排到最前面。
 * @param {{venue?: string, venueShort?: string}} item
 * @param {string[]} list - 小写的刊物名片段
 */
export function flagshipHit(item, list) {
  if (!Array.isArray(list) || !list.length) return false
  const venue = String(item.venue || '').toLowerCase()
  const short = String(item.venueShort || '').toLowerCase()
  return list.some((word) => {
    const needle = String(word || '').toLowerCase().trim()
    if (!needle) return false
    return venue.includes(needle) || (short !== '' && short.includes(needle))
  })
}

/**
 * 计算排序层级。
 * @param {{section?: string, level?: string, venue?: string, venueShort?: string, metrics?: object}} item
 * @param {{flagship?: string[]}} [options]
 * @returns {{rank: number, tierLabel: string}}
 */
export function rankOf(item, options = {}) {
  // 领域旗舰刊：直接排到最前，徽标写「领域顶刊」
  if (flagshipHit(item, options.flagship)) return { rank: 0, tierLabel: '领域顶刊' }
  const section = item.section === 'algo' ? 'algo' : 'field'
  const level = String(item.level || '').toUpperCase()
  const venue = String(item.venue || '').trim()
  const metrics = item.metrics || {}
  const casZone = metrics.cas && metrics.cas.zone ? String(metrics.cas.zone) : ''
  const casTop = Boolean(metrics.cas && metrics.cas.top)
  const jcr = metrics.jcr && metrics.jcr.quartile ? String(metrics.jcr.quartile).toUpperCase() : ''
  const isTopJournal = TOP_JOURNALS.test(venue.replace(/\s*\(.*?\)\s*$/, ''))

  // 期刊细分（0 最高）
  let journalTier
  let journalLabel
  if (isTopJournal) {
    journalTier = 0
    journalLabel = '顶刊'
  } else if (casZone === '1区' || casTop) {
    journalTier = 1
    journalLabel = `中科院1区${casTop ? ' Top' : ''}`
  } else if (jcr === 'Q1') {
    journalTier = 2
    journalLabel = 'JCR Q1'
  } else if (casZone === '2区' || jcr === 'Q2') {
    journalTier = 3
    journalLabel = casZone === '2区' ? '中科院2区' : 'JCR Q2'
  } else if (level === 'SCI') {
    journalTier = 4
    journalLabel = casZone ? `中科院${casZone}` : jcr ? `JCR ${jcr}` : 'SCI'
  } else if (level === 'EI' || level === '中文核心') {
    journalTier = 5
    journalLabel = level === 'EI' ? 'EI' : '中文核心'
  } else {
    journalTier = 7
    journalLabel = '预印本'
  }

  // 会议层级（CCF-A / CCF-B）
  const confTier = level === 'CCF-A' ? 0 : level === 'CCF-B' ? 1 : undefined

  // 算法侧：CCF-A/B 会议(0/1) → 顶刊(4) → 1区(5) → Q1(6) → … → 预印本
  // 专业侧：顶刊(0) → 1区(1) → CCF-A 会议(1) → 2区(2) → Q1(2) → 其他 SCI(3) → EI/核心(4) → 预印本(6)
  if (section === 'algo') {
    const rank = confTier !== undefined ? confTier : 4 + journalTier
    return { rank, tierLabel: confTier !== undefined ? level : journalLabel }
  }
  const rank =
    journalTier === 0
      ? 0
      : journalTier === 1
        ? 1
        : confTier === 0
          ? 1
          : confTier === 1
            ? 2
            : journalTier === 2
              ? 2
              : journalTier === 3
                ? 3
                : journalTier === 4
                  ? 4
                  : journalTier === 5
                    ? 5
                    : 7
  // 会议论文（CCF-A/B）在专业侧也可能压过普通 SCI，此时徽标要写 CCF-A，不能沿用它没有的期刊分区
  const tierLabel = journalLabel === '预印本' && confTier !== undefined ? level : journalLabel
  return { rank, tierLabel }
}
