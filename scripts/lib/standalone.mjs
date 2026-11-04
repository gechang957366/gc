// 生成独立版 HTML 的核心逻辑（CLI 与自动更新脚本共用）。
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listDomains, resolveArea } from './domains.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = resolve(HERE, '..', '..')

/** 读某个方向的 index + issues（默认方向就在 data 根下）。 */
function readArea(rootDataDir, domainId) {
  const area = resolveArea(rootDataDir, domainId)
  const issues = {}
  if (existsSync(area.issuesDir)) {
    for (const name of readdirSync(area.issuesDir).filter((file) => file.endsWith('.json'))) {
      issues[name.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(area.issuesDir, name), 'utf8'))
    }
  }
  let index
  try {
    index = JSON.parse(readFileSync(area.indexPath, 'utf8'))
  } catch {
    index = { issues: [], current: null }
  }
  return { area, index, issues }
}

/** 所有方向的数据；默认方向排第一。 */
function readAllAreas(rootDataDir) {
  const { default: def, domains } = listDomains(rootDataDir)
  const out = []
  for (const entry of domains) {
    const area = resolveArea(rootDataDir, entry.id)
    const hasData = existsSync(area.indexPath)
    if (!hasData && entry.id !== def) continue
    out.push({ entry, ...readArea(rootDataDir, entry.id) })
  }
  return { default: def, domains, areas: out }
}

/**
 * 把 data/ 下的期号数据 + 浏览器半 + React(UMD) 打成一个可双击打开的 HTML。
 * @param {{ dataDir?: string, outDir?: string, light?: boolean }} [options]
 */
export function buildStandalone(options = {}) {
  const root = PACKAGE_ROOT
  const dataDir = resolve(options.dataDir ?? join(root, 'data'))
  const outDir = resolve(options.outDir ?? join(root, 'standalone'))
  const vendorDir = join(root, 'preview', 'vendor')

  const index = JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8'))
  const issues = {}
  const issuesDir = join(dataDir, 'issues')
  for (const name of readdirSync(issuesDir).filter((file) => file.endsWith('.json'))) {
    issues[name.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(issuesDir, name), 'utf8'))
  }
  // 其他方向的数据也一起内联，单文件版同样能切方向
  const all = readAllAreas(dataDir)
  const domainData = {}
  for (const item of all.areas) {
    domainData[item.entry.id] = { index: item.index, issues: item.issues }
  }
  if (!domainData[all.default]) domainData[all.default] = { index, issues }

  const client = readFileSync(join(root, 'client', 'client.js'), 'utf8')
  const reactUmd = readFileSync(join(vendorDir, 'react.production.min.js'), 'utf8')
  const reactDomUmd = readFileSync(join(vendorDir, 'react-dom.production.min.js'), 'utf8')

  const figSource = join(dataDir, 'assets', 'fig')
  const figTarget = join(outDir, 'assets', 'fig')
  mkdirSync(figTarget, { recursive: true })
  // 只复制"有条目引用"的配图，避免把已删期号的旧图一起带走
  const referenced = new Set()
  for (const issue of Object.values(issues)) {
    for (const section of Object.values(issue.sections || {})) {
      for (const item of section.items || []) {
        for (const figure of item.figures || []) {
          if (figure?.file) referenced.add(figure.file.replace(/^fig\//, ''))
        }
      }
    }
  }
  let copied = 0
  if (existsSync(figSource)) {
    for (const name of readdirSync(figSource)) {
      if (!referenced.has(name)) continue
      const from = join(figSource, name)
      if (!statSync(from).isFile()) continue
      copyFileSync(from, join(figTarget, name))
      copied += 1
    }
  }

  const shell = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:#f4f7fc;color:#101c2b;
  font-family:ui-sans-serif,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  overflow:hidden}
body.light{background:radial-gradient(1100px 520px at 50% -12%,rgba(56,189,248,.18),transparent 70%),#f2f4f7;color:#1f2328}
.hint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);font-size:12px;color:#7b8797;
  display:flex;gap:8px;align-items:center;pointer-events:none;user-select:none}
.center-note{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.center-note p{font-size:13px;color:#7b8797;opacity:.85;margin:0}
`

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>每周文献速递 · 独立版 ${index.current || ''}</title>
<style>${shell}</style>
</head>
<body>
<div id="app"></div>
<script>${reactUmd}</script>
<script>${reactDomUmd}</script>
<script>window.__DWP_MODE__ = 'page'; window.__WEEKLY_PAPER_DATA__ = ${JSON.stringify({
    index,
    issues,
    domains: domainData,
    domainsList: all.domains.filter((entry) => domainData[entry.id]),
    defaultDomain: all.default,
  })}; window.__WEEKLY_PAPER_DOMAINS__ = ${JSON.stringify(
    all.domains.filter((entry) => domainData[entry.id]),
  )}; window.__DEFAULT_DOMAIN__ = ${JSON.stringify(all.default)}; window.__WEEKLY_PAPER_API_BASE__ = '.';</script>
<script>
(function () {
  const params = new URLSearchParams(location.search);
  if (params.get('tab') === 'algo') window.__DWP_PREVIEW_TAB__ = 'algo';
  if (params.get('issue')) window.__DWP_PREVIEW_ISSUE__ = params.get('issue');
  if (params.get('domain')) window.__DWP_PREVIEW_DOMAIN__ = params.get('domain');
})();
</script>
<script>window.__ModuleLoader__ = { load(reg) { window.__dwpReg = reg } };</script>
<script>${client}</script>
<script>
(function () {
  const React = window.React;
  const registry = [];
  const ctx = {
    slots: {
      inject(_name, fn) { return fn(); },
      register(_options, component) { registry.push(component); return () => {}; },
    },
  };
  const mod = window.__dwpReg.factory(() => React);
  mod.apply(ctx);
  const Root = registry[0];
  if (!Root) throw new Error('weekly-paper: no component registered');
  ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(Root));
})();
</script>
</body>
</html>
`

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.html'), html, 'utf8')
  writeFileSync(
    join(outDir, 'README.txt'),
    [
      '每周文献速递 · 独立版',
      '',
      '双击 index.html 就能看，不需要 DeepSeek Harness，也不需要开服务器。',
      '整页布局：顶部只留 logo，内容铺满窗口；窗口变窄会自动变成单列。',
      `配图 ${copied} 张在 assets/fig 下，拷贝时请把整个 standalone 目录一起带走。`,
      '',
      '数据每次更新后重新生成：node scripts/build-standalone.mjs',
    ].join('\n'),
    'utf8',
  )

  return {
    path: join(outDir, 'index.html'),
    bytes: statSync(join(outDir, 'index.html')).size,
    issues: Object.keys(issues).length,
    figures: copied,
  }
}

/**
 * 生成"可托管静态站点"：页面不内联数据，而是 fetch 同目录下的 data/。
 * 放到任意静态服务器（或局域网共享）后，只要替换 data/ 内容，别人刷新就能看到新一期。
 * @param {{ dataDir?: string, outDir?: string, light?: boolean }} [options]
 */
export function buildSite(options = {}) {
  const root = PACKAGE_ROOT
  const dataDir = resolve(options.dataDir ?? join(root, 'data'))
  const outDir = resolve(options.outDir ?? join(root, 'standalone-site'))
  const vendorDir = join(root, 'preview', 'vendor')

  const index = JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8'))
  const issuesDir = join(dataDir, 'issues')
  const issueFiles = readdirSync(issuesDir).filter((file) => file.endsWith('.json'))

  const client = readFileSync(join(root, 'client', 'client.js'), 'utf8')
  const reactUmd = readFileSync(join(vendorDir, 'react.production.min.js'), 'utf8')
  const reactDomUmd = readFileSync(join(vendorDir, 'react-dom.production.min.js'), 'utf8')

  // 复制数据
  const dataOut = join(outDir, 'data')
  const issuesOut = join(dataOut, 'issues')
  rmSync(dataOut, { recursive: true, force: true })
  mkdirSync(issuesOut, { recursive: true })
  copyFileSync(join(dataDir, 'index.json'), join(dataOut, 'index.json'))
  for (const file of issueFiles) copyFileSync(join(issuesDir, file), join(issuesOut, file))

  // 其它方向：data/domains/<id>/{index.json,issues/*}，以及方向注册表
  const all = readAllAreas(dataDir)
  let domainIssues = 0
  if (all.domains.length > 1) {
    const domainsOut = join(dataOut, 'domains')
    mkdirSync(domainsOut, { recursive: true })
    const registryPath = join(dataDir, 'domains.json')
    if (existsSync(registryPath)) copyFileSync(registryPath, join(dataOut, 'domains.json'))
    for (const item of all.areas) {
      if (item.area.isDefault) continue
      const dir = join(domainsOut, item.entry.id)
      mkdirSync(join(dir, 'issues'), { recursive: true })
      writeFileSync(join(dir, 'index.json'), `${JSON.stringify(item.index, null, 2)}\n`, 'utf8')
      for (const [id, issue] of Object.entries(item.issues)) {
        writeFileSync(join(dir, 'issues', `${id}.json`), `${JSON.stringify(issue, null, 2)}\n`, 'utf8')
        domainIssues += 1
      }
    }
  } else {
    // 只有一个方向时也放一份注册表，前端据此显示方向名
    const registryPath = join(dataDir, 'domains.json')
    if (existsSync(registryPath)) copyFileSync(registryPath, join(dataOut, 'domains.json'))
  }

  // 复制被引用的配图
  const referenced = new Set()
  for (const file of issueFiles) {
    const issue = JSON.parse(readFileSync(join(issuesDir, file), 'utf8'))
    for (const section of Object.values(issue.sections || {})) {
      for (const item of section.items || []) {
        for (const figure of item.figures || []) {
          if (figure?.file) referenced.add(figure.file.replace(/^fig\//, ''))
        }
      }
    }
  }
  const figTarget = join(outDir, 'assets', 'fig')
  mkdirSync(figTarget, { recursive: true })
  const figSource = join(dataDir, 'assets', 'fig')
  let copied = 0
  if (existsSync(figSource)) {
    for (const name of readdirSync(figSource)) {
      if (!referenced.has(name)) continue
      const from = join(figSource, name)
      if (!statSync(from).isFile()) continue
      copyFileSync(from, join(figTarget, name))
      copied += 1
    }
  }

  const shell = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:#f4f7fc;color:#101c2b;
  font-family:ui-sans-serif,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  overflow:hidden}
body.light{background:radial-gradient(1100px 520px at 50% -12%,rgba(56,189,248,.18),transparent 70%),#f2f4f7;color:#1f2328}
.hint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);font-size:12px;color:#7b8797;
  display:flex;gap:8px;align-items:center;pointer-events:none;user-select:none}
.center-note{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.center-note p{font-size:13px;color:#7b8797;opacity:.85;margin:0}
`

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>每周文献速递 · 在线版</title>
<style>${shell}</style>
</head>
<body>
<div id="app"></div>
<script>${reactUmd}</script>
<script>${reactDomUmd}</script>
<script>
window.__DWP_MODE__ = 'page';
window.__DWP_STATIC__ = '.';
window.__WEEKLY_PAPER_API_BASE__ = '.';
window.__DEFAULT_DOMAIN__ = ${JSON.stringify(all.default)};
(function () {
  const params = new URLSearchParams(location.search);
  if (params.get('tab') === 'algo') window.__DWP_PREVIEW_TAB__ = 'algo';
  if (params.get('issue')) window.__DWP_PREVIEW_ISSUE__ = params.get('issue');
  if (params.get('domain')) window.__DWP_PREVIEW_DOMAIN__ = params.get('domain');
})();
</script>
<script>window.__ModuleLoader__ = { load(reg) { window.__dwpReg = reg } };</script>
<script>${client}</script>
<script>
(function () {
  const React = window.React;
  const registry = [];
  const ctx = {
    slots: {
      inject(_name, fn) { return fn(); },
      register(_options, component) { registry.push(component); return () => {}; },
    },
  };
  const mod = window.__dwpReg.factory(() => React);
  mod.apply(ctx);
  const Root = registry[0];
  if (!Root) throw new Error('weekly-paper: no component registered');
  ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(Root));
})();
</script>
</body>
</html>
`

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.html'), html, 'utf8')

  // 附一个最小静态服务器，方便局域网分享
  writeFileSync(
    join(outDir, 'serve.mjs'),
    `// 局域网静态服务器：node serve.mjs [端口]
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.argv[2] || 8099)
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' }

createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  let path = decodeURIComponent(url.pathname)
  if (path === '/' || path === '') path = '/index.html'
  const target = resolve(ROOT, '.' + normalize(path))
  if (!target.startsWith(ROOT) || !existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404')
    return
  }
  const body = readFileSync(target)
  res.writeHead(200, {
    'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}).listen(PORT, '0.0.0.0', () => {
  console.log('每周文献速递（在线版）已启动：')
  console.log('  本机     http://127.0.0.1:' + PORT + '/')
  console.log('  局域网   把本机 IP 发给同事，端口 ' + PORT)
  console.log('更新数据：替换 data/ 下的文件后刷新页面即可，不用重启')
})
`,
    'utf8',
  )

  writeFileSync(
    join(outDir, 'README.txt'),
    [
      '每周文献速递 · 在线版（可托管 / 可局域网分享）',
      '',
      '整页布局（顶部只有 logo，内容铺满页面）。',
      '和单文件独立版的区别：这个版本的页面不内联数据，而是打开时去读同目录的 data/。',
      '所以只要替换 data/index.json 与 data/issues/*.json，别人刷新页面就能看到新一期。',
      '',
      '用法一：本机/局域网',
      '  node serve.mjs            # 默认 8099 端口，然后访问 http://127.0.0.1:8099/',
      '  同事访问 http://<你的内网IP>:8099/',
      '',
      '用法二：丢到任意静态服务器（Nginx / IIS / GitHub Pages / 对象存储）',
      '  把整个目录上传即可，入口 index.html。',
      '',
      '更新：在插件目录跑 node scripts/build-standalone.mjs --site，再把新目录覆盖上去。',
    ].join('\n'),
    'utf8',
  )

  return {
    path: join(outDir, 'index.html'),
    bytes: statSync(join(outDir, 'index.html')).size,
    issues: issueFiles.length,
    figures: copied,
  }
}
