// Scopus 检索 + 摘要（走 Elsevier API key）。
//
// 为什么用 Scopus 而不是各刊自己的网站：Scopus 的收录覆盖了
//   Elsevier 四刊（Applied Energy / Renewable Energy / Energy / ECM）、
//   IEEE Xplore（TSTE / TSG / TPS …），
//   以及中文核心（中国电机工程学报 10.13334/…、电力系统自动化 10.7500/…），
// 而且它对每一条都存了逐字摘要，`view=META_ABS` 一次就够。
const BASE = 'https://api.elsevier.com'
const UA = { 'User-Agent': 'dsh-weekly-paper/0.3', Accept: 'application/json' }

function pick(list) {
  return Array.isArray(list) ? list[0] : list
}

async function callJson(url, timeout = 25000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, { headers: UA, signal: controller.signal })
    // 响应头里带着配额（x-ratelimit-*），顺手记一笔，方便 `node scripts/usage.mjs` 汇总
    try {
      const { recordElsevierCall } = await import('./usage.mjs')
      recordElsevierCall(res.headers)
    } catch {
      /* 记账失败不影响抓取 */
    }
    const text = await res.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
    return { status: res.status, body, text }
  } catch (error) {
    // 超时/断线不要把整轮更新带崩：返回一个可判定的状态让调用方跳过这一条
    return { status: 0, body: undefined, text: String(error?.message || error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Scopus 文献检索。
 * @param {{apiKey: string, query: string, count?: number, start?: number}} options
 * @returns {Promise<{total: number, entries: Array<object>}>}
 */
export async function scopusSearch({ apiKey, query, count = 25, start = 0 }) {
  const url =
    `${BASE}/content/search/scopus?query=${encodeURIComponent(query)}` +
    `&count=${Math.min(count, 25)}&start=${start}&apiKey=${encodeURIComponent(apiKey)}`
  const { status, body, text } = await callJson(url)
  if (status !== 200 || !body) {
    return { total: 0, entries: [], error: `HTTP ${status} ${text.slice(0, 120)}` }
  }
  const results = body['search-results'] || {}
  const entries = (results.entry || [])
    .map((entry) => ({
      eid: entry.eid,
      doi: (entry['prism:doi'] || '').toLowerCase(),
      title: entry['dc:title'] || '',
      venue: entry['prism:publicationName'] || '',
      issn: entry['prism:issn'] || '',
      date: (entry['prism:coverDate'] || '').slice(0, 10),
      aggregationType: entry['prism:aggregationType'] || '',
      scopusId: (entry.eid || '').replace('2-s2.0-', ''),
      creators: entry['dc:creator'] || '',
    }))
    .filter((entry) => entry.title)
  return { total: Number(results['opensearch:totalResults'] || entries.length), entries }
}

/**
 * 取单篇的逐字摘要（META_ABS 视图，返回体 ~8KB 而不是 200KB）。
 * @param {{apiKey: string, doi?: string, scopusId?: string}} options
 * @returns {Promise<object|undefined>}
 */
export async function scopusAbstract({ apiKey, doi, scopusId }) {
  const path = doi ? `doi/${encodeURIComponent(doi)}` : `scopus_id/${scopusId}`
  const url = `${BASE}/content/abstract/${path}?view=META_ABS&apiKey=${encodeURIComponent(apiKey)}`
  const { status, body } = await callJson(url)
  if (status !== 200 || !body) return undefined
  const response = body['abstracts-retrieval-response']
  const coredata = response?.coredata
  if (!coredata) return undefined

  const creators = response?.authors?.author || []
  const authorList = Array.isArray(creators) ? creators : [creators]
  const authors = authorList
    .map((author) => {
      const preferred = pick(author['preferred-name'])
      const surname = preferred?.['ce:surname'] || author['ce:surname'] || ''
      const initials = preferred?.['ce:initials'] || author['ce:initials'] || ''
      if (surname) return `${surname} ${initials}`.trim()
      return author['ce:indexed-name'] || ''
    })
    .filter(Boolean)

  const description = coredata['dc:description']
  const abstract = typeof description === 'string' ? description : description?.['$'] || ''

  return {
    doi: (coredata['prism:doi'] || doi || '').toLowerCase(),
    title: coredata['dc:title'] || '',
    abstract,
    venue: pick(coredata['prism:publicationName']) || '',
    volume: coredata['prism:volume'] || '',
    issue: coredata['prism:issueIdentifier'] || '',
    pages: coredata['prism:pageRange'] || '',
    date: (coredata['prism:coverDate'] || '').slice(0, 10),
    issn: coredata['prism:issn'] || '',
    aggregationType: coredata['prism:aggregationType'] || '',
    authors,
    openaccess: coredata['openaccess'] === '1' || coredata['openaccess'] === 1,
  }
}

/** 按 PUBYEAR 粗筛 + 本地按 coverDate 精筛，构造 Scopus 查询串。 */
export function buildQuery(terms, fromDate, untilDate, extra = '') {
  const fromYear = Number(String(fromDate).slice(0, 4))
  const yearFilter = `PUBYEAR > ${fromYear - 1}`
  const topic = terms.map((term) => `TITLE-ABS-KEY(${term})`).join(' OR ')
  const parts = [topic ? `(${topic})` : '', yearFilter]
  if (extra) parts.push(extra)
  return parts.filter(Boolean).join(' AND ')
}
