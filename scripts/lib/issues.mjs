// 期号维护：删除某一期（连同索引、覆盖范围重算）。插件宿主与局域网服务器共用。
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'

function isoLocal(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00+08:00`
}

/**
 * 删除一期：删文件、从 index 摘掉、必要时把 current 指到最新的一期，并重算覆盖统计。
 * @param {{dataDir: string, id: string}} options
 * @returns {{ok: boolean, removed?: string, current?: string, remaining?: number, error?: string}}
 */
export function deleteIssue({ dataDir, id }) {
  const indexPath = join(dataDir, 'index.json')
  if (!existsSync(indexPath)) return { ok: false, error: 'index.json 不存在' }
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return { ok: false, error: '期号不合法' }

  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const issues = Array.isArray(index.issues) ? [...index.issues] : []
  const position = issues.findIndex((entry) => entry.id === id)
  const issuePath = join(dataDir, 'issues', `${id}.json`)
  if (position === -1 && !existsSync(issuePath)) return { ok: false, error: `没有这一期：${id}` }

  if (existsSync(issuePath)) unlinkSync(issuePath)
  if (position !== -1) issues.splice(position, 1)

  // 重算覆盖范围（扫剩下的期号文件）
  const issuesDir = join(dataDir, 'issues')
  const files = existsSync(issuesDir) ? readdirSync(issuesDir).filter((name) => name.endsWith('.json')) : []
  let totalItems = 0
  let figures = 0
  let minDate = '9999-12-31'
  let maxDate = '0000-01-01'
  const summaries = []
  for (const file of files) {
    const issue = JSON.parse(readFileSync(join(issuesDir, file), 'utf8'))
    const items = Object.values(issue.sections || {}).flatMap((section) => section.items || [])
    const figCount = items.reduce((sum, item) => sum + (item.figures?.length || 0), 0)
    totalItems += items.length
    figures += figCount
    for (const item of items) {
      if (item.date && item.date < minDate) minDate = item.date
      if (item.date && item.date > maxDate) maxDate = item.date
    }
    summaries.push({
      id: issue.id,
      label: issue.label || issue.id,
      range: issue.range || [],
      mode: issue.mode || 'incremental',
      updatedAt: issue.generatedAt || isoLocal(),
      counts: {
        field: issue.sections?.field?.items?.length || 0,
        algo: issue.sections?.algo?.items?.length || 0,
        figures: figCount,
      },
      note: issue.note || '',
    })
  }
  summaries.sort((a, b) => String((b.range || [])[1] || '').localeCompare(String((a.range || [])[1] || '')))

  const current = issues.some((entry) => entry.id === index.current) && index.current !== id
    ? index.current
    : summaries[0]?.id

  const nextIndex = {
    ...index,
    updatedAt: isoLocal(),
    current,
    coverage: {
      ...(index.coverage || {}),
      totalItems,
      figures,
      ...(minDate !== '9999-12-31' ? { coveredFrom: minDate, to: maxDate } : {}),
    },
    issues: summaries,
  }
  writeFileSync(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, 'utf8')

  return { ok: true, removed: id, current, remaining: summaries.length }
}

/** 目录里所有期号的 id（调试用）。 */
export function listIssues(dataDir) {
  const issuesDir = join(dataDir, 'issues')
  if (!existsSync(issuesDir)) return []
  return readdirSync(issuesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ id: name.replace(/\.json$/, ''), size: statSync(join(issuesDir, name)).size }))
}
