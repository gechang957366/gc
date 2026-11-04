// dsh-weekly-paper — host half.
//
// Serves the weekly literature digest (issues + figure assets + a small
// state endpoint) over the DSH web server so the browser half can render
// without bundling data into the client bundle:
//
//   GET  /dsh-weekly-paper/api/index            → 期号索引（含当前期与覆盖范围）
//   GET  /dsh-weekly-paper/api/issue?id=...     → 某一期的完整内容
//   GET  /dsh-weekly-paper/api/state            → 覆盖范围 / 更新请求 / 数据健康度
//   POST /dsh-weekly-paper/api/update-request   → 记录一次"想更新"的请求，供 agent 下轮处理
//   GET  /dsh-weekly-paper/assets/<path>        → data/assets 下的配图等静态文件
//
// 数据全部是工作区里的 JSON 文件（data/index.json + data/issues/*.json），
// 所以更新内容不需要重启、不需要重新打包：改文件、刷新页面即可。

import { readFile, stat } from 'node:fs/promises'
import { createReadStream, readFileSync } from 'node:fs'
import { dirname, join, normalize, resolve, sep, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureAreaFiles, listDomains, resolveArea } from '../scripts/lib/domains.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Package root (…/dsh-weekly-paper). */
export const PACKAGE_ROOT = resolve(HERE, '..')
/** Default data directory: <pkg>/data. */
export const DEFAULT_DATA_DIR = join(PACKAGE_ROOT, 'data')

/** Route prefix owned by this plugin. */
export const ROUTE_BASE = '/dsh-weekly-paper'

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.css': 'text/css; charset=utf-8',
}

export const inject = []

/**
 * Tiny mtime-aware cache: editors rewrite JSON files while the server runs, so
 * every read stats the file first and only re-parses when it moved.
 */
function createFileCache() {
  const entries = new Map()
  return {
    async readJson(path) {
      let info
      try {
        info = await stat(path)
      } catch (error) {
        if (error.code === 'ENOENT') return undefined
        throw error
      }
      const cached = entries.get(path)
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.value
      const value = JSON.parse(await readFile(path, 'utf8'))
      entries.set(path, { mtimeMs: info.mtimeMs, size: info.size, value })
      return value
    },
    invalidate() {
      entries.clear()
    },
  }
}

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

async function readBody(req, limitBytes = 64 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limitBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw new Error('request body is not valid JSON')
  }
}

/** Keep asset reads inside <data>/assets, even with encoded traversal. */
function safeAssetPath(assetsDir, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  const normalized = normalize(decoded).replace(/^([/\\])+/, '')
  if (normalized === '' || normalized.startsWith('..') || normalized.includes(`..${sep}`)) return undefined
  const target = resolve(assetsDir, normalized)
  const root = resolve(assetsDir)
  if (target !== root && !target.startsWith(root + sep)) return undefined
  return target
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ dataDir?: string }} [config]
 */
export function apply(ctx, config = {}) {
  const dataDir = resolve(config.dataDir ?? DEFAULT_DATA_DIR)
  const issuesDir = join(dataDir, 'issues')
  const assetsDir = join(dataDir, 'assets')
  const indexPath = join(dataDir, 'index.json')
  const requestsPath = join(dataDir, 'update-requests.json')
  const cache = createFileCache()

  /** 方向 → 数据位置。未知方向自动回落到默认方向，不会 404。 */
  function areaFor(domainId) {
    return ensureAreaFiles(resolveArea(dataDir, domainId))
  }

  /** 本地写了数据就顺手推到 GitHub（后台跑、失败不打扰）。没配 token/仓库时是空操作。 */
  function autoPublish(reason) {
    import('../scripts/lib/publish.mjs')
      .then((mod) => mod.publishInBackground(reason, { dataDir }))
      .catch(() => undefined)
  }

  /**
   * 弹窗里"智能填充"用的目录：期刊清单（带分区/IF）+ 现有方向用过的关键词。
   * 只在需要时算一次，进程内缓存 30 秒。
   */
  let catalogCache = { at: 0, value: undefined }
  async function loadCatalog() {
    if (catalogCache.value && Date.now() - catalogCache.at < 30000) return catalogCache.value
    const domains = await import('../scripts/lib/domains.mjs')
    const journals = []
    try {
      const raw = JSON.parse(readFileSync(join(dataDir, 'journals.json'), 'utf8'))
      for (const journal of Array.isArray(raw) ? raw : raw.journals || []) {
        if (!journal?.name) continue
        journals.push({
          name: journal.name,
          issn: journal.issn || undefined,
          zone: journal.cas?.zone || undefined,
          quartile: journal.jcr?.quartile || undefined,
          iff: typeof journal.if === 'number' ? journal.if : undefined,
        })
      }
    } catch {
      /* 没有分区表就只有关键词建议 */
    }
    const queries = new Set()
    const keywords = new Set()
    for (const entry of domains.listDomains(dataDir).domains) {
      const sources = domains.readDomainSources(domains.resolveArea(dataDir, entry.id))
      for (const query of sources.scopus?.queries?.field || []) queries.add(String(query).replace(/"/g, ''))
      for (const query of sources.arxiv?.field || []) queries.add(String(query))
      for (const word of sources.core?.field || []) keywords.add(String(word))
    }
    const value = {
      journals: journals.sort((a, b) => String(a.name).localeCompare(String(b.name))),
      suggest: { queries: [...queries].slice(0, 120), keywords: [...keywords].slice(0, 120) },
    }
    catalogCache = { at: Date.now(), value }
    return value
  }

  /** Elsevier API key：环境变量优先，其次 data/.elsevier-key 文件。 */
  function readElsevierKey() {
    if (process.env.ELSEVIER_API_KEY) return process.env.ELSEVIER_API_KEY.trim()
    try {
      return readFileSync(join(dataDir, '.elsevier-key'), 'utf8').trim()
    } catch {
      return ''
    }
  }

  const log = {
    info: (...args) => {
      try {
        ctx.logger?.info?.(...args)
      } catch {
        /* ignore */
      }
    },
    warn: (...args) => {
      try {
        ctx.logger?.warn?.(...args)
      } catch {
        /* ignore */
      }
    },
  }

  /** Normalized issue index: tolerate a bare array or a partial index file. */
  async function loadIndex(area) {
    const raw = (await cache.readJson(area.indexPath)) ?? {}
    const issues = Array.isArray(raw) ? raw : Array.isArray(raw.issues) ? raw.issues : []
    const current =
      (typeof raw.current === 'string' && raw.current) ||
      issues[0]?.id ||
      (issues.length > 0 ? issues[0].id : undefined)
    return {
      schema: raw.schema ?? 1,
      title: raw.title ?? `每周文献速递 · ${area.entry.short ?? area.entry.label}`,
      subtitle: raw.subtitle ?? area.entry.subtitle ?? '功率预测 · 气象预报 · 雷达流场重构 / 大模型 · 时序预测',
      updatedAt: raw.updatedAt ?? null,
      coverage: raw.coverage ?? {},
      current,
      issues,
      domain: area.id,
      domainLabel: area.entry.label,
    }
  }

  async function loadIssue(area, id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id)) return undefined
    return cache.readJson(join(area.issuesDir, `${id}.json`))
  }

  async function loadRequests() {
    const raw = (await cache.readJson(requestsPath)) ?? []
    return Array.isArray(raw) ? raw : Array.isArray(raw.requests) ? raw.requests : []
  }

  async function recordRequest(note) {
    const existing = await loadRequests()
    const next = [
      ...existing,
      {
        at: new Date().toISOString(),
        note: typeof note === 'string' ? note.slice(0, 500) : '',
        handled: false,
      },
    ].slice(-50)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(requestsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    cache.invalidate()
    return next
  }

  ctx.inject(['webServer'], (scope) => {
    const server = scope.webServer

    // 方向列表：界面上的"方向"下拉从这里来；POST 用来新建 / 修改 / 删除方向
    server.register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/domains`,
      handler: async (req, res) => {
        if (req.method === 'POST') {
          let body
          try {
            body = await readBody(req)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
            return
          }
          const action = body.action === 'update' || body.action === 'delete' ? body.action : 'create'
          try {
            const domains = await import('../scripts/lib/domains.mjs')
            let result
            if (action === 'delete') {
              result = domains.deleteDomain(dataDir, String(body.id || ''))
            } else if (action === 'update') {
              result = await domains.updateDomain(dataDir, String(body.id || ''), body)
            } else {
              result = await domains.createDomain(dataDir, body)
            }
            cache.invalidate()
            const list = domains.listDomains(dataDir)
            autoPublish(`domain-${action}`)
            sendJson(res, 200, { ok: true, action, ...result, ...list })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
          }
          return
        }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const detailId = url.searchParams.get('detail')
          const { default: def, domains } = listDomains(dataDir)
          const catalog = await loadCatalog()
          if (detailId) {
            const domainsApi = await import('../scripts/lib/domains.mjs')
            sendJson(res, 200, {
              ok: true,
              version: 3,
              default: def,
              domains,
              ...catalog,
              detail: domainsApi.domainDetail(dataDir, detailId),
            })
            return
          }
          // version 3 = 支持 POST 新建/修改/删除；前端据此判断要不要提示"重启 dsh web"
          sendJson(res, 200, { ok: true, version: 3, default: def, domains, ...catalog })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    server.register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/index`,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' })
          res.end()
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const area = areaFor(url.searchParams.get('domain') ?? undefined)
        try {
          const index = await loadIndex(area)
          sendJson(res, 200, { ok: true, dataDir: area.dir, ...index })
        } catch (error) {
          log.warn(`[weekly-paper] index read failed: ${error?.message ?? error}`)
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error), dataDir: area.dir })
        }
      },
    })

    server.register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/issue`,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' })
          res.end()
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        const area = areaFor(url.searchParams.get('domain') ?? undefined)
        try {
          const index = await loadIndex(area)
          const issue = await loadIssue(area, id)
          if (!issue) {
            sendJson(res, 404, { ok: false, error: `issue not found: ${id}`, current: index.current })
            return
          }
          sendJson(res, 200, { ok: true, issue })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    server.register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/state`,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' })
          res.end()
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const area = areaFor(url.searchParams.get('domain') ?? undefined)
        try {
          const index = await loadIndex(area)
          const requests = await loadRequests()
          sendJson(res, 200, {
            ok: true,
            updatedAt: index.updatedAt,
            current: index.current,
            coverage: index.coverage,
            pendingUpdateRequests: requests.filter((entry) => entry && entry.handled !== true).length,
            requests: requests.slice(-5),
            domain: area.id,
            dataDir: area.dir,
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    server.register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/update-request`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' })
          res.end()
          return
        }
        try {
          const body = await readBody(req)
          const requests = await recordRequest(body.note)
          sendJson(res, 200, {
            ok: true,
            total: requests.length,
            hint: '已记录更新请求：在对话里说一句「更新文献周报」即可让助手拉取新增文献。',
          })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    server.register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/reload`,
      handler: async (req, res) => {
        cache.invalidate()
        sendJson(res, 200, { ok: true })
      },
    })

    // 能力探测：前端据此判断"现场检索/换一批"能不能用（旧版后端没有这个路由）
    server.register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/health`,
      handler: async (req, res) => {
        sendJson(res, 200, {
          ok: true,
          version: 3,
          search: true,
          reroll: true,
          deleteIssue: true,
          domains: true,
          hasKey: Boolean(readElsevierKey()),
        })
      },
    })

    // 换一批：按当前方向现场再抓一批，写成新的一期（旧的保留在历史期号里）
    server.register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/reroll`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' })
          res.end()
          return
        }
        try {
          const body = await readBody(req).catch(() => ({}))
          const section = body.section === 'algo' ? 'algo' : 'field'
          const area = areaFor(body.domain)
          const { rerollBatch } = await import('../scripts/lib/reroll.mjs')
          const { resolveApiKey } = await import('../scripts/lib/deepseek.mjs')
          const result = await rerollBatch({
            dataDir,
            domain: area.id,
            section,
            apiKey: readElsevierKey(),
            llmKey: resolveApiKey(),
            count: 8,
          })
          cache.invalidate()
          autoPublish(`reroll-${area.id}`)
          sendJson(res, 200, { ok: true, ...result })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // 文献检索（像谷歌学术那样按关键词现搜）：Scopus + arXiv
    server.register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/search`,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' })
          res.end()
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const query = url.searchParams.get('q') || ''
        const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 10, 20))
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
        const area = areaFor(url.searchParams.get('domain') ?? undefined)
        try {
          const apiKey = readElsevierKey()
          const { searchLiterature } = await import('../scripts/lib/search.mjs')
          const { loadJournals } = await import('../scripts/lib/metrics.mjs')
          const { resolveApiKey } = await import('../scripts/lib/deepseek.mjs')
          const journals = loadJournals(area.journalsPath)
          const result = await searchLiterature({
            query,
            limit,
            offset,
            apiKey,
            llmKey: resolveApiKey(),
            journals,
            dataDir,
            domain: area.id,
          })
          sendJson(res, 200, { ok: true, ...result, hasKey: Boolean(apiKey) })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // 删除某一期（换一批里没价值的批次可以直接删掉）
    server.register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/issue-delete`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' })
          res.end()
          return
        }
        try {
          const body = await readBody(req).catch(() => ({}))
          const id = typeof body.id === 'string' ? body.id : ''
          const area = areaFor(body.domain)
          const { deleteIssue } = await import('../scripts/lib/issues.mjs')
          const result = deleteIssue({ dataDir: area.dir, id })
          if (!result.ok) {
            sendJson(res, 400, result)
            return
          }
          cache.invalidate()
          // 顺手把独立版重建一下，避免本地打开的还是旧数据
          try {
            const { buildStandalone } = await import('../scripts/lib/standalone.mjs')
            buildStandalone({ dataDir })
          } catch {
            /* 重建失败不影响删除 */
          }
          autoPublish(`issue-delete-${area.id}`)
          sendJson(res, 200, result)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })

    // 自检：确认浏览器半是否已被 client-modules 抓进 boot graph、打包文件在哪。
    // 排查"顶部胶囊不出现"时第一步就查这个。
    server.register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/diag`,
      handler: async (req, res) => {
        const id = 'dsh-weekly-paper'
        const registry = ctx.get ? ctx.get('clientModules') : undefined
        let row
        let clientPath
        let bundle
        try {
          const graph = registry?.graph?.()
          row = graph?.entries?.find?.((entry) => entry.id === id)
          clientPath = registry?.clientPath?.(id)
          if (clientPath) {
            const info = await stat(clientPath)
            bundle = { path: clientPath, bytes: info.size, mtime: new Date(info.mtimeMs).toISOString() }
          }
        } catch (error) {
          row = { error: String(error?.message ?? error) }
        }
        sendJson(res, 200, {
          ok: true,
          hasRegistry: Boolean(registry),
          row: row ?? null,
          bundle: bundle ?? null,
          dataDir,
          packageRoot: PACKAGE_ROOT,
        })
      },
    })

    server.register({
      kind: 'prefix',
      path: `${ROUTE_BASE}/assets`,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const relative = url.pathname.slice(`${ROUTE_BASE}/assets`.length)
        const target = safeAssetPath(assetsDir, relative)
        if (!target) {
          res.writeHead(400)
          res.end('bad path')
          return
        }
        let info
        try {
          info = await stat(target)
        } catch {
          info = undefined
        }
        if (!info || !info.isFile()) {
          res.writeHead(404)
          res.end('not found')
          return
        }
        res.writeHead(200, {
          'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': info.size,
          'Cache-Control': 'public, max-age=300',
        })
        createReadStream(target).pipe(res)
      },
    })

    log.info(`[weekly-paper] serving ${ROUTE_BASE} from ${dataDir}`)
  })
}
