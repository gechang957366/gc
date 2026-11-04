#!/usr/bin/env node
// 内网共享：一键把"在线版"跑起来，同事用局域网地址就能看，数据更新后刷新即新一期。
//
//   双击 start.cmd（推荐）
//   或 node scripts/lan-server.mjs [端口]
//
// 做的事：① 数据有新就重建在线版 ② 起静态服务器 ③ 打印局域网地址 ④ 自动打开浏览器
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'
import { spawn } from 'node:child_process'
import { buildSite } from './lib/standalone.mjs'
import { searchLiterature } from './lib/search.mjs'
import { loadJournals } from './lib/metrics.mjs'
import { resolveApiKey } from './lib/deepseek.mjs'
import { rerollBatch } from './lib/reroll.mjs'
import { deleteIssue } from './lib/issues.mjs'
import { domainDetail, ensureAreaFiles, listDomains, resolveArea } from './lib/domains.mjs'
import { publishInBackground } from './lib/publish.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, 'standalone-site')
const DATA = join(ROOT, 'data')
const DATA_INDEX = join(DATA, 'index.json')
const START_PORT = Number(process.argv[2] || process.env.DWP_PORT || 8099)

/** 本地写了数据就顺手推到 GitHub（配了 token 才生效，失败不打扰）。 */
function autoPublish(reason) {
  try {
    publishInBackground(reason, { dataDir: DATA, root: ROOT })
  } catch {
    /* ignore */
  }
}

/** 方向 → 数据位置（未知方向回落到默认方向）。 */
function areaFor(domainId) {
  return ensureAreaFiles(resolveArea(DATA, domainId))
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

/** 数据比上次构建新，就重建在线版。 */
function ensureBuild() {
  const built = join(SITE, 'index.html')
  const builtAt = existsSync(built) ? statSync(built).mtimeMs : 0
  const dataAt = existsSync(DATA_INDEX) ? statSync(DATA_INDEX).mtimeMs : 0
  if (builtAt && dataAt <= builtAt) return
  console.log('· 检测到数据有更新，正在重建在线版…')
  try {
    const result = buildSite()
    console.log(`· 已重建：${(result.bytes / 1024).toFixed(0)} KB · ${result.issues} 期 · ${result.figures} 张配图`)
  } catch (error) {
    console.log(`! 重建失败（继续用旧版本）：${error.message}`)
  }
}

const isPrivate = (address) =>
  /^10\./.test(address) ||
  /^192\.168\./.test(address) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(address)

function lanAddresses() {
  const out = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const info of list || []) {
      if (info.family !== 'IPv4' || info.internal) continue
      if (/^(169\.254|127\.)/.test(info.address)) continue
      out.push({ name, address: info.address, private: isPrivate(info.address) })
    }
  }
  // 内网地址优先（192.168 > 10 > 172.16-31），公网地址排最后
  out.sort((a, b) => {
    const score = (item) =>
      !item.private ? 9 : /^192\.168\./.test(item.address) ? 0 : /^10\./.test(item.address) ? 1 : 2
    return score(a) - score(b)
  })
  return out
}

function copyToClipboard(text) {
  try {
    const child = spawn('clip.exe', [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    child.stdin.end(text)
  } catch {
    /* 剪贴板失败无所谓 */
  }
}

function openBrowser(url) {
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  } catch {
    /* 打不开就让用户自己点 */
  }
}

/** 端口被占就往后找。 */
function listenWithFallback(server, port, attemptsLeft = 12) {
  return new Promise((resolvePort, rejectPort) => {
    const onError = (error) => {
      if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
        server.removeListener('error', onError)
        resolvePort(listenWithFallback(server, port + 1, attemptsLeft - 1))
        return
      }
      rejectPort(error)
    }
    server.once('error', onError)
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', onError)
      resolvePort(port)
    })
  })
}

function handler(req, res) {
  let pathname
  let searchParams
  try {
    const parsed = new URL(req.url || '/', 'http://localhost')
    pathname = decodeURIComponent(parsed.pathname)
    searchParams = parsed.searchParams
  } catch {
    pathname = '/'
    searchParams = new URLSearchParams()
  }

  // 现场检索：/api/search?q=尾流控制&limit=10
  if (pathname === '/api/search') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('405')
      return
    }
    const query = searchParams.get('q') || ''
    const limit = Math.max(1, Math.min(Number(searchParams.get('limit')) || 10, 20))
    const offset = Math.max(0, Number(searchParams.get('offset')) || 0)
    let apiKey = process.env.ELSEVIER_API_KEY || ''
    if (!apiKey) {
      try {
        apiKey = readFileSync(join(ROOT, 'data', '.elsevier-key'), 'utf8').trim()
      } catch {
        apiKey = ''
      }
    }
    searchLiterature({
      query,
      limit,
      offset,
      apiKey,
      llmKey: resolveApiKey(),
      journals: loadJournals(join(DATA, 'journals.json')),
      dataDir: DATA,
      domain: areaFor(searchParams.get('domain')).id,
    })
      .then((result) => {
        const payload = Buffer.from(JSON.stringify({ ok: true, ...result, hasKey: Boolean(apiKey) }))
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': payload.length,
          'Cache-Control': 'no-store',
        })
        res.end(payload)
      })
      .catch((error) => {
        const payload = Buffer.from(JSON.stringify({ ok: false, error: String(error.message || error) }))
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length })
        res.end(payload)
      })
    return
  }

  // 方向列表（界面上的"方向"下拉）；POST = 新建 / 修改 / 删除方向
  if (pathname === '/api/domains') {
    const send = (status, body) => {
      const payload = Buffer.from(JSON.stringify(body))
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length,
        'Cache-Control': 'no-store',
      })
      res.end(payload)
    }
    if (req.method === 'POST') {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', async () => {
        let body = {}
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          send(400, { ok: false, error: '请求体不是合法 JSON' })
          return
        }
        const action = body.action === 'update' || body.action === 'delete' ? body.action : 'create'
        try {
          const domains = await import('./lib/domains.mjs')
          let result
          if (action === 'delete') result = domains.deleteDomain(DATA, String(body.id || ''))
          else if (action === 'update') result = await domains.updateDomain(DATA, String(body.id || ''), body)
          else result = await domains.createDomain(DATA, body)
          // 方向变了要重建在线版（新方向的空索引/数据目录要同步到 standalone-site/data）
          try {
            buildSite({ dataDir: DATA })
          } catch {
            /* 重建失败不影响返回 */
          }
          autoPublish(`domain-${action}`)
          send(200, { ok: true, action, ...result, ...listDomains(DATA) })
        } catch (error) {
          send(400, { ok: false, error: String(error?.message || error) })
        }
      })
      return
    }
    const { default: def, domains } = listDomains(DATA)
    // 弹窗"智能填充"用的目录：期刊清单（带分区/IF）+ 现有方向用过的关键词
    const journals = []
    try {
      const raw = JSON.parse(readFileSync(join(DATA, 'journals.json'), 'utf8'))
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
    const querySet = new Set()
    const keywordSet = new Set()
    for (const entry of domains) {
      const sourcesPath = join(resolveArea(DATA, entry.id).dir, 'sources.json')
      try {
        const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'))
        for (const query of sources.scopus?.queries?.field || []) querySet.add(String(query).replace(/"/g, ''))
        for (const query of sources.arxiv?.field || []) querySet.add(String(query))
        for (const word of sources.core?.field || []) keywordSet.add(String(word))
      } catch {
        /* 没有配置就跳过 */
      }
    }
    const payload = {
      ok: true,
      version: 3,
      default: def,
      domains,
      journals: journals.sort((a, b) => String(a.name).localeCompare(String(b.name))),
      suggest: { queries: [...querySet].slice(0, 120), keywords: [...keywordSet].slice(0, 120) },
    }
    const detailId = searchParams.get('detail')
    if (detailId) {
      try {
        payload.detail = domainDetail(DATA, detailId)
      } catch (error) {
        send(500, { ok: false, error: String(error?.message || error) })
        return
      }
    }
    send(200, payload)
    return
  }

  // 删除某一期
  if (pathname === '/api/issue-delete') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('405')
      return
    }
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      let id = ''
      let domain
      try {
        const parsed = JSON.parse(raw || '{}')
        id = String(parsed.id || '')
        domain = parsed.domain
      } catch {
        id = ''
      }
      const area = areaFor(domain)
      const result = deleteIssue({ dataDir: area.dir, id })
      if (result.ok) {
        try {
          buildSite({ dataDir: DATA })
        } catch {
          /* 同步失败不影响删除 */
        }
        autoPublish(`issue-delete-${area.id}`)
      }
      const payload = Buffer.from(JSON.stringify(result))
      res.writeHead(result.ok ? 200 : 400, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length,
        'Cache-Control': 'no-store',
      })
      res.end(payload)
    })
    return
  }
  // 能力探测：前端据此决定要不要显示"现场检索"
  if (pathname === '/api/health') {
    let hasKey = Boolean(process.env.ELSEVIER_API_KEY)
    if (!hasKey) {
      try {
        hasKey = readFileSync(join(ROOT, 'data', '.elsevier-key'), 'utf8').trim().length > 0
      } catch {
        hasKey = false
      }
    }
    const payload = Buffer.from(
      JSON.stringify({ ok: true, version: 3, search: true, reroll: true, deleteIssue: true, domains: true, hasKey }),
    )
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length })
    res.end(payload)
    return
  }

  // 换一批：现场再抓一批，写成新的一期
  if (pathname === '/api/reroll') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('405')
      return
    }
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      let section = 'field'
      let domain
      try {
        const parsed = JSON.parse(raw || '{}')
        section = parsed.section === 'algo' ? 'algo' : 'field'
        domain = parsed.domain
      } catch {
        /* 默认 field */
      }
      const area = areaFor(domain)
      let apiKey = process.env.ELSEVIER_API_KEY || ''
      if (!apiKey) {
        try {
          apiKey = readFileSync(join(DATA, '.elsevier-key'), 'utf8').trim()
        } catch {
          apiKey = ''
        }
      }
      rerollBatch({ dataDir: DATA, domain: area.id, section, apiKey, llmKey: resolveApiKey(), count: 8 })
        .then((result) => {
          // 换一批写进了 data/，要把在线版目录里的数据副本同步过去，页面刷新才能看到
          try {
            buildSite({ dataDir: DATA })
          } catch {
            /* 同步失败不影响返回 */
          }
          autoPublish(`reroll-${area.id}`)
          const payload = Buffer.from(JSON.stringify({ ok: true, ...result }))
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': payload.length,
            'Cache-Control': 'no-store',
          })
          res.end(payload)
        })
        .catch((error) => {
          const payload = Buffer.from(JSON.stringify({ ok: false, error: String(error.message || error) }))
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length })
          res.end(payload)
        })
    })
    return
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html'
  const target = resolve(SITE, `.${normalize(pathname)}`)
  if (!target.startsWith(SITE + sep) && target !== SITE) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('403')
    return
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<meta charset="utf-8"><h1>404</h1><p>没有这个文件。入口是 /index.html</p>')
    return
  }
  const body = readFileSync(target)
  res.writeHead(200, {
    'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    // 数据文件不缓存，保证同事刷新就能看到新一期
    'Cache-Control': /\/data\//.test(target) || /\.html$/.test(target) ? 'no-store' : 'public, max-age=600',
  })
  res.end(body)
}

async function main() {
  if (!existsSync(join(ROOT, 'data', 'index.json'))) {
    console.error(`找不到数据：${join(ROOT, 'data', 'index.json')}`)
    process.exit(1)
  }
  ensureBuild()

  const server = createServer(handler)
  const port = await listenWithFallback(server, START_PORT)
  const lan = lanAddresses()
  const localUrl = `http://127.0.0.1:${port}/`

  const index = JSON.parse(readFileSync(DATA_INDEX, 'utf8'))
  const issue = (index.issues || [])[0] || {}
  const primary = lan[0]
  const line = '─'.repeat(64)
  console.log('')
  console.log(line)
  console.log('  📚 每周文献速递 · 内网共享已启动')
  console.log(line)
  console.log(`  本机打开   ${localUrl}`)
  if (primary) {
    console.log(
      `  ${primary.private ? '发给同事  ' : '同事可试  '} http://${primary.address}:${port}/` +
        (primary.private ? '    ← 复制这个' : '    （公网地址，仅同一网段可访问）'),
    )
  }
  if (lan.length > 1) {
    for (const entry of lan.slice(1)) {
      console.log(`  备用地址   http://${entry.address}:${port}/   (${entry.name})`)
    }
  }
  console.log('')
  console.log(`  当前数据   ${issue.label || issue.id || '—'} · ${index.coverage?.totalItems ?? '?'} 篇 · 更新于 ${String(index.updatedAt || '').slice(0, 16).replace('T', ' ')}`)
  console.log(`  数据目录   ${join(ROOT, 'data')}`)
  console.log(`  停止服务   在这个窗口按 Ctrl+C，或直接关掉窗口`)
  console.log(line)
  if (primary && !primary.private) {
    console.log('  ⚠ 这台机器没有内网（192.168/10/172.16-31）地址，只有公网 IP。')
    console.log('     · 同事和你连同一校园网/办公网时，上面那个地址可能能开；')
    console.log('     · 打不开就别折腾了：把 standalone\\index.html 单文件直接发给他更省事。')
  } else {
    console.log('  提示：第一次启动 Windows 可能会弹防火墙提示，选「允许访问」；')
    console.log('        同事要和你连同一个局域网（同一个 WiFi / 同一个路由器）。')
  }
  console.log('  更新：每周自动更新跑完会自动重建；也可以随时重新双击 start.cmd。')
  console.log(line)
  console.log('')

  if (primary && primary.private) copyToClipboard(`http://${primary.address}:${port}/`)
  if (process.env.DWP_NO_OPEN !== '1') setTimeout(() => openBrowser(localUrl), 400)

  const shutdown = () => {
    console.log('\n服务已停止。')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 600)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error('启动失败：', error.message)
  process.exit(1)
})
