// 发布到 GitHub（main 放源码+数据，gh-pages 放构建好的静态站点）。
//
// 设计目标：本地一产生新数据（换一批 / 删期号 / 新建方向 / 每周自动更新），
// 就自动把变化推上去，这样自己电脑关机了别人也能看。
//
// 关键做法：
// · token 放 data/.github-token（或环境变量 GITHUB_TOKEN），永不进仓库；
// · 用内容哈希 + 已发布 blob 的 sha 做增量：一次「换一批」通常只上传 2–4 个文件；
// · 合并触发：短时间内多次写数据只推一次（debounce），失败不打扰用户；
// · 所有对外入口都吞异常——推送失败绝不能让本地功能报错。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSite } from './standalone.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = resolve(HERE, '..', '..')
export const DEFAULT_DATA_DIR = join(PACKAGE_ROOT, 'data')

const API = 'https://api.github.com'
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'standalone',
  'standalone-site',
  '_run',
  '_incoming',
  '_backup_issues',
  '.backup',
  '.pool',
  'logs',
  'preview-shots',
])
const SKIP_FILES = new Set([
  '.elsevier-key',
  '.github-token',
  '.api-usage.json',
  'update-requests.json',
  'published.json',
  'nul',
  'desktop.ini',
  '.DS_Store',
])
const ALLOW_DOTFILES = new Set(['.gitignore', '.npmignore', '.nojekyll'])
const TEXT_EXT = /\.(json|md|mjs|js|cjs|ts|yml|yaml|txt|html|htm|css|cmd|bat|ps1|sh|gitignore|npmignore|csv|svg)$/i

// ----------------------------------------------------------------- 配置 ----
export function publishPaths(dataDir = DEFAULT_DATA_DIR) {
  const dir = resolve(dataDir)
  return {
    dataDir: dir,
    tokenPath: join(dir, '.github-token'),
    configPath: join(dir, 'publish.json'),
    statePath: join(dir, 'published.json'),
    logPath: join(dir, 'logs', 'publish.log'),
  }
}

export function readPublishConfig(dataDir = DEFAULT_DATA_DIR) {
  const { configPath } = publishPaths(dataDir)
  let raw = {}
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    raw = {}
  }
  return {
    enabled: raw.enabled !== false,
    repo: raw.repo || '',
    branch: raw.branch || 'main',
    pagesBranch: raw.pagesBranch || 'gh-pages',
    autoPush: raw.autoPush !== false,
  }
}

export function writePublishConfig(dataDir, patch) {
  const { configPath } = publishPaths(dataDir)
  const next = { ...readPublishConfig(dataDir), ...patch }
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

export function readToken(dataDir = DEFAULT_DATA_DIR) {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim()
  const { tokenPath } = publishPaths(dataDir)
  try {
    const value = readFileSync(tokenPath, 'utf8').trim()
    if (value) return value
  } catch {
    /* 没有就没有 */
  }
  return ''
}

export function writeToken(dataDir, token) {
  const { tokenPath } = publishPaths(dataDir)
  mkdirSync(dirname(tokenPath), { recursive: true })
  writeFileSync(tokenPath, `${String(token).trim()}\n`, 'utf8')
  return tokenPath
}

function readState(dataDir) {
  const { statePath } = publishPaths(dataDir)
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function writeState(dataDir, state) {
  const { statePath } = publishPaths(dataDir)
  try {
    mkdirSync(dirname(statePath), { recursive: true })
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    /* ignore */
  }
}

function logLine(dataDir, message) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const line = `[${stamp}] ${message}`
  try {
    const { logPath } = publishPaths(dataDir)
    mkdirSync(dirname(logPath), { recursive: true })
    writeFileSync(logPath, `${line}\n`, { flag: 'a', encoding: 'utf8' })
  } catch {
    /* ignore */
  }
  return line
}

// ------------------------------------------------------------- 文件清单 ----
function walk(dir, base, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && !ALLOW_DOTFILES.has(entry.name)) continue
    const full = join(dir, entry.name)
    const rel = relative(base, full).split(sep).join('/')
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(full, base, out)
      continue
    }
    if (SKIP_FILES.has(entry.name)) continue
    if (/\.(zip|tgz|log)$/i.test(entry.name)) continue
    out.push({ path: rel, abs: full, size: statSync(full).size })
  }
  return out
}

/** 源码树：插件本体 + 数据 + 文档 + 构建独立版要用的 React UMD */
export function collectSourceFiles(root = PACKAGE_ROOT) {
  const out = []
  const picks = ['lib', 'client', 'scripts', 'docs', 'data', 'preview/vendor']
  for (const pick of picks) {
    const full = join(root, pick)
    if (!existsSync(full)) continue
    const before = out.length
    walk(full, full, out)
    for (let i = before; i < out.length; i += 1) out[i] = { ...out[i], path: `${pick}/${out[i].path}` }
  }
  for (const name of ['package.json', 'cordis.patch.yml', 'README.md', 'start.cmd', '.gitignore', '.npmignore']) {
    const full = join(root, name)
    if (existsSync(full) && statSync(full).isFile()) out.push({ path: name, abs: full, size: statSync(full).size })
  }
  return out
}

/** 站点树：先把 standalone-site 重建，再连同使用说明一起收 */
export function collectSiteFiles(root = PACKAGE_ROOT, dataDir = DEFAULT_DATA_DIR) {
  try {
    buildSite({ dataDir })
  } catch {
    /* 构建失败就用现有的 */
  }
  const siteRoot = join(root, 'standalone-site')
  const out = []
  if (existsSync(siteRoot)) walk(siteRoot, siteRoot, out)
  for (const name of ['使用说明.html', '使用说明.md']) {
    const full = join(root, 'docs', name)
    if (existsSync(full)) out.push({ path: name, abs: full, size: statSync(full).size })
  }
  out.push({ path: '.nojekyll', abs: '', size: 0 })
  return out
}

// ---------------------------------------------------------------- GitHub ----
async function api(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'User-Agent': 'dsh-weekly-paper',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }
  return { status: res.status, ok: res.ok, body }
}

function hashOf(file) {
  const content = existsSync(file.abs) ? readFileSync(file.abs) : Buffer.from('')
  return createHash('sha1').update(content).digest('hex')
}

async function uploadBlob(token, repo, file, hash) {
  const content = existsSync(file.abs) ? readFileSync(file.abs) : Buffer.from('')
  const isText = TEXT_EXT.test(file.path) || file.path === '.nojekyll'
  const res = await api(token, `/repos/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify(
      isText
        ? { content: content.toString('utf8'), encoding: 'utf-8' }
        : { content: content.toString('base64'), encoding: 'base64' },
    ),
  })
  if (!res.ok) throw new Error(`上传 ${file.path} 失败：${res.status} ${JSON.stringify(res.body).slice(0, 160)}`)
  return res.body.sha
}

async function getBranchHead(token, repo, branch) {
  const res = await api(token, `/repos/${repo}/git/ref/heads/${branch}`)
  // 空仓库会返回 409 "Git Repository is empty."，等同于"还没有这个分支"
  if (res.status === 404 || res.status === 409) return undefined
  if (!res.ok) throw new Error(`读分支 ${branch} 失败：${res.status}`)
  return res.body.object.sha
}

/**
 * 空仓库（一次提交都没有）不能用 Git Data API 建 blob（会 409 「Git Repository is empty」），
 * 先用 Contents API 放一个占位文件把首次提交建出来，后面的整树提交会把它替换掉。
 */
async function bootstrapEmptyRepo(token, repo, branch) {
  const put = await api(token, `/repos/${repo}/contents/.gitkeep`, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'chore: init repo (weekly digest bootstrap)',
      content: Buffer.from('').toString('base64'),
      branch,
    }),
  })
  if (!put.ok) {
    // 可能是 branch 不存在（默认分支名不同）：退一步，不指定 branch 让它落到默认分支
    const fallback = await api(token, `/repos/${repo}/contents/.gitkeep`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'chore: init repo (weekly digest bootstrap)',
        content: Buffer.from('').toString('base64'),
      }),
    })
    if (!fallback.ok) {
      throw new Error(`初始化空仓库失败：${fallback.status} ${JSON.stringify(fallback.body).slice(0, 200)}`)
    }
  }
  return getBranchHead(token, repo, branch)
}

/**
 * 把一个文件清单推成一次提交（增量：哈希没变就复用上次的 blob sha）。
 * @returns {Promise<{sha?: string, uploaded: number, reused: number, skipped?: boolean}>}
 */
async function pushTree({ token, repo, branch, files, message, dataDir, dry }) {
  const state = readState(dataDir)
  const branchState = state.branches?.[branch]?.files || {}
  const hashes = files.map((file) => ({ file, hash: hashOf(file) }))
  const toUpload = hashes.filter((item) => branchState[item.file.path]?.hash !== item.hash)
  const reused = hashes.length - toUpload.length

  if (!toUpload.length) return { uploaded: 0, reused, skipped: true }
  if (dry) {
    return {
      uploaded: toUpload.length,
      reused,
      plan: toUpload.map((item) => item.file.path),
      skipped: false,
    }
  }

  const nextBranchState = {}
  const entries = []
  let uploaded = 0
  let parent = await getBranchHead(token, repo, branch)
  // 空仓库先垫一次提交，否则 blob 接口会 409
  if (!parent) {
    parent = await bootstrapEmptyRepo(token, repo, branch)
    if (!parent) throw new Error('仓库是空的，且初始化失败（检查 token 是否有 Contents 写权限）')
  }
  const queue = [...toUpload]
  const pendingReuse = hashes.filter((item) => branchState[item.file.path]?.hash === item.hash)

  for (const item of pendingReuse) {
    nextBranchState[item.file.path] = { hash: item.hash, sha: branchState[item.file.path].sha }
    entries.push({ path: item.file.path, mode: '100644', type: 'blob', sha: branchState[item.file.path].sha })
  }
  let cursor = 0
  const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (cursor < queue.length) {
      const item = queue[cursor]
      cursor += 1
      const sha = await uploadBlob(token, repo, item.file, item.hash)
      uploaded += 1
      nextBranchState[item.file.path] = { hash: item.hash, sha }
      entries.push({ path: item.file.path, mode: '100644', type: 'blob', sha })
    }
  })
  await Promise.all(workers)

  const treeRes = await api(token, `/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree: entries }),
  })
  if (!treeRes.ok) throw new Error(`建 tree 失败：${treeRes.status} ${JSON.stringify(treeRes.body).slice(0, 200)}`)

  const commitRes = await api(token, `/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: treeRes.body.sha, parents: parent ? [parent] : [] }),
  })
  if (!commitRes.ok) throw new Error(`建 commit 失败：${commitRes.status} ${JSON.stringify(commitRes.body).slice(0, 200)}`)

  const refRes = parent
    ? await api(token, `/repos/${repo}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commitRes.body.sha, force: false }),
      })
    : await api(token, `/repos/${repo}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitRes.body.sha }),
      })
  if (!refRes.ok) throw new Error(`更新分支失败：${refRes.status} ${JSON.stringify(refRes.body).slice(0, 200)}`)

  const nextState = readState(dataDir)
  nextState.repo = repo
  nextState.lastAt = new Date().toISOString()
  nextState.branches = { ...(nextState.branches || {}) }
  nextState.branches[branch] = { files: nextBranchState, sha: commitRes.body.sha }
  writeState(dataDir, nextState)
  return { sha: commitRes.body.sha, uploaded, reused, skipped: false }
}

async function ensurePages(token, repo, pagesBranch) {
  const info = await api(token, `/repos/${repo}/pages`)
  if (info.ok) {
    if ((info.body.source || {}).branch === pagesBranch) return info.body.html_url
    const put = await api(token, `/repos/${repo}/pages`, {
      method: 'PUT',
      body: JSON.stringify({ source: { branch: pagesBranch, path: '/' } }),
    })
    return put.ok ? put.body.html_url : undefined
  }
  if (info.status === 404) {
    const create = await api(token, `/repos/${repo}/pages`, {
      method: 'POST',
      body: JSON.stringify({ source: { branch: pagesBranch, path: '/' } }),
    })
    return create.ok ? create.body.html_url : undefined
  }
  return undefined
}

// -------------------------------------------------------------- 对外入口 ----
let debounceTimer
let running = false
let queued
let lastResult

/**
 * 推一次（源码 + 站点）。会自动合并短时间内的多次调用。
 * @param {{reason?: string, dataDir?: string, root?: string, dry?: boolean, force?: boolean,
 *          sourceOnly?: boolean, siteOnly?: boolean, throwOnError?: boolean}} options
 */
export async function publishToGitHub(options = {}) {
  const dataDir = options.dataDir ? resolve(options.dataDir) : DEFAULT_DATA_DIR
  const root = options.root ? resolve(options.root) : PACKAGE_ROOT
  const config = readPublishConfig(dataDir)
  if (!config.enabled || !config.repo) {
    return { skipped: true, reason: 'not-configured' }
  }
  const token = options.token || readToken(dataDir)
  if (!token) return { skipped: true, reason: 'no-token' }

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const message = `${options.message || 'weekly digest'} · ${options.reason || 'update'}（${stamp}）`
  const result = { repo: config.repo, branches: {}, at: stamp }

  try {
    if (!options.siteOnly) {
      const files = collectSourceFiles(root)
      result.branches[config.branch] = await pushTree({
        token,
        repo: config.repo,
        branch: config.branch,
        files,
        message: `${message} [source]`,
        dataDir,
        dry: options.dry,
      })
    }
    if (!options.sourceOnly) {
      const files = collectSiteFiles(root, dataDir)
      result.branches[config.pagesBranch] = await pushTree({
        token,
        repo: config.repo,
        branch: config.pagesBranch,
        files,
        message: `${message} [site]`,
        dataDir,
        dry: options.dry,
      })
      if (!options.dry) {
        const url = await ensurePages(token, config.repo, config.pagesBranch)
        if (url) result.pagesUrl = url
      }
    }
    result.ok = true
    if (!options.dry) {
      logLine(
        dataDir,
        `push ok · ${config.repo} · ${Object.entries(result.branches)
          .map(([branch, info]) => `${branch}:${info.skipped ? '无变化' : `+${info.uploaded}/复用${info.reused}`}`)
          .join(' ')}`,
      )
    }
    lastResult = result
    return result
  } catch (error) {
    result.ok = false
    result.error = String(error?.message || error)
    logLine(dataDir, `push failed · ${result.error}`)
    if (options.throwOnError) throw error
    return result
  }
}

/** 后台触发：不等待、不抛错、1.5 秒内多次调用只推一次。 */
export function publishInBackground(reason = 'update', options = {}) {
  const dataDir = options.dataDir ? resolve(options.dataDir) : DEFAULT_DATA_DIR
  const config = readPublishConfig(dataDir)
  if (!config.enabled || !config.repo || !config.autoPush) return
  if (!readToken(dataDir)) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined
    if (running) {
      queued = { reason, options }
      return
    }
    running = true
    publishToGitHub({ ...options, reason })
      .catch(() => undefined)
      .finally(() => {
        running = false
        if (queued) {
          const next = queued
          queued = undefined
          publishInBackground(next.reason, next.options)
        }
      })
  }, 1500)
  if (debounceTimer.unref) debounceTimer.unref()
}

export function lastPublishResult() {
  return lastResult
}

export async function verifyToken(token, repo) {
  const me = await api(token, '/user')
  if (!me.ok) return { ok: false, status: me.status, error: `token 无效（HTTP ${me.status}）` }
  const target = await api(token, `/repos/${repo}`)
  if (target.status === 404) return { ok: false, status: 404, error: `token 看不到仓库 ${repo}（权限没勾对，或仓库名写错了）` }
  if (!target.ok) return { ok: false, status: target.status, error: `读仓库失败（HTTP ${target.status}）` }
  const canPush = Boolean(target.body.permissions?.push) || target.body.permissions?.admin === true
  return {
    ok: true,
    login: me.body.login,
    repo: target.body.full_name,
    private: Boolean(target.body.private),
    canPush,
    defaultBranch: target.body.default_branch,
  }
}
