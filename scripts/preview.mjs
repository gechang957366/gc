#!/usr/bin/env node
// 把 client/client.js 装进一个模拟的 DSH 外壳里，生成 preview/index.html，
// 用于在没有服务器的情况下检查视觉效果（再用 headless Chrome 截图）。
//
//   node scripts/preview.mjs [数据文件] [输出文件]
//
// 数据文件默认 preview/sample.json，格式见 preview/sample.json：
//   { index: <与 /api/index 同构>, issues: { "<id>": <issue> } }
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const dataArg = resolve(ROOT, process.argv[2] ?? 'data')
const outPath = resolve(ROOT, process.argv[3] ?? 'preview/index.html')

// 支持两种输入：一个数据目录（含 index.json + issues/*.json），或一个
// { index, issues } 的 JSON 文件（preview/sample.json 那种形态）。
let data
if (existsSync(dataArg) && statSync(dataArg).isDirectory()) {
  const issues = {}
  const issuesDir = join(dataArg, 'issues')
  for (const name of readdirSync(issuesDir).filter((file) => file.endsWith('.json'))) {
    issues[name.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(issuesDir, name), 'utf8'))
  }
  data = { index: JSON.parse(readFileSync(join(dataArg, 'index.json'), 'utf8')), issues }
  process.chdir(ROOT)
} else {
  data = JSON.parse(readFileSync(dataArg, 'utf8'))
}
const client = readFileSync(join(ROOT, 'client', 'client.js'), 'utf8')

// 把数据里引用的配图复制到 preview/assets 下（相对路径 ./assets/...）
const previewAssets = join(ROOT, 'preview', 'assets')
const figDirs = [join(ROOT, 'data', 'assets', 'fig'), join(dirname(dataArg), 'assets', 'fig')]
for (const issue of Object.values(data.issues ?? {})) {
  for (const section of Object.values(issue.sections ?? {})) {
    for (const item of section.items ?? []) {
      for (const fig of item.figures ?? []) {
        if (!fig?.file) continue
        const rel = fig.file.replace(/^fig\//, '')
        const target = join(previewAssets, 'fig', rel)
        mkdirSync(dirname(target), { recursive: true })
        for (const source of figDirs) {
          const candidate = join(source, rel)
          if (existsSync(candidate)) {
            copyFileSync(candidate, target)
            break
          }
        }
      }
    }
  }
}

const frameCss = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%}
body{background:#0a0e13;color:#e6edf3;font-family:ui-sans-serif,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;overflow:hidden}
.mock{display:flex;height:100vh}
.mock-side{width:280px;flex:0 0 280px;background:#0d1219;border-right:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;padding:12px 10px}
.mock-brand{display:flex;align-items:center;gap:9px;padding:6px 8px 14px;font-size:13.5px;font-weight:650}
.mock-logo{width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,#38bdf8,#a78bfa)}
.mock-new{margin:0 6px 12px;height:32px;border-radius:9px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);display:flex;align-items:center;gap:7px;padding:0 10px;font-size:12.5px;color:#c8d3e0}
.mock-row{display:flex;align-items:center;gap:8px;height:30px;padding:0 9px;border-radius:8px;font-size:12.5px;color:#9aa7b4}
.mock-row.on{background:rgba(56,189,248,.1);color:#e6edf3}
.mock-dot{width:6px;height:6px;border-radius:50%;background:#475569}
.mock-side-foot{margin-top:auto;display:flex;align-items:center;gap:8px;padding:8px;font-size:12px;color:#8b98a6}
.mock-main{flex:1;min-width:0;display:flex;flex-direction:column;background:radial-gradient(1200px 500px at 50% -10%,rgba(56,189,248,.06),transparent 70%)}
.mock-head{height:56px;flex:0 0 56px;display:flex;align-items:center;gap:10px;padding:0 20px;border-bottom:1px solid rgba(255,255,255,.06)}
.mock-title{font-size:13.5px;font-weight:650}
.mock-sub{font-size:11.5px;color:#7d8b99}
.mock-acts{margin-left:auto;display:flex;gap:8px}
.mock-ico{width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
.mock-chat{flex:1;overflow:hidden;padding:26px 22px;display:flex;flex-direction:column;gap:16px;max-width:900px;margin:0 auto;width:100%}
.mock-msg{display:flex;gap:10px;font-size:13px;line-height:1.7;color:#b7c2ce}
.mock-av{width:26px;height:26px;border-radius:8px;flex:0 0 26px;background:#1b2430;border:1px solid rgba(255,255,255,.08)}
.mock-msg.user .mock-bubble{background:rgba(56,189,248,.09);border:1px solid rgba(56,189,248,.18);border-radius:12px;padding:10px 13px;color:#dce6f2}
.mock-bubble{flex:1;min-width:0}
.mock-composer{margin:0 auto 18px;width:min(900px,calc(100% - 44px));border:1px solid rgba(255,255,255,.09);border-radius:14px;background:#0f151c;padding:12px 14px;color:#6f7d8b;font-size:12.5px;display:flex;align-items:center;gap:8px}
.mock-caret{width:1px;height:14px;background:#58a6ff;animation:blink 1.1s steps(2) infinite}
@keyframes blink{50%{opacity:0}}
`

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>每周文献速递 · 预览</title>
<style>${frameCss}</style>
</head>
<body data-ds-dark-theme>
<div class="mock">
  <aside class="mock-side">
    <div class="mock-brand"><span class="mock-logo"></span>DeepSeek Harness</div>
    <div class="mock-new">＋ 新会话</div>
    <div class="mock-row on"><span class="mock-dot"></span>每周文献速递 · 视觉预览</div>
    <div class="mock-row"><span class="mock-dot"></span>机舱雷达来流重构</div>
    <div class="mock-row"><span class="mock-dot"></span>多源异构测风数据融合</div>
    <div class="mock-row"><span class="mock-dot"></span>功率预测方案改稿</div>
    <div class="mock-side-foot"><span class="mock-dot"></span>工作区 D:\\deepseek</div>
  </aside>
  <main class="mock-main">
    <header class="mock-head">
      <div>
        <div class="mock-title">每周文献速递 · 视觉预览</div>
        <div class="mock-sub">deepseek / session-26371fdd</div>
      </div>
      <div class="mock-acts"><span class="mock-ico"></span><span class="mock-ico"></span><span class="mock-ico"></span></div>
    </header>
    <div class="mock-chat">
      <div class="mock-msg user"><span class="mock-av"></span><div class="mock-bubble">帮我做个插件，形式最好是桌面上方有个下拉菜单的那种，功能是每周帮我搜集两部分内容……</div></div>
      <div class="mock-msg"><span class="mock-av"></span><div class="mock-bubble">已经挂到 shell.overlay 槽位上了：顶部胶囊 → 点开是本周速递，专业前沿 / 算法进展两个页签，历史期号可以下拉切换。</div></div>
      <div class="mock-msg"><span class="mock-av"></span><div class="mock-bubble">数据来自 data/index.json 与 data/issues/*.json，改完文件刷新页面就生效，不用重新打包。</div></div>
    </div>
    <div class="mock-composer"><span class="mock-caret"></span>给 DeepSeek 发消息…</div>
  </main>
</div>
<div id="app"></div>
<script src="vendor/react.js"></script>
<script src="vendor/react-dom.js"></script>
<script>window.__WEEKLY_PAPER_DATA__ = ${JSON.stringify(data)}; window.__WEEKLY_PAPER_API_BASE__ = '.';</script>
<script>
window.__ModuleLoader__ = { load(reg) { window.__dwpReg = reg } };
</script>
<script>${client}</script>
<script>
(function () {
  const React = window.React;
  const ReactDOM = window.ReactDOM;
  const registry = [];
  const ctx = {
    slots: {
      inject(_name, fn) { return fn(); },
      register(_options, component) { registry.push(component); return () => {}; },
    },
  };
  const params = new URLSearchParams(location.search);
  if (params.get('pos')) {
    const [x, y] = params.get('pos').split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      try { window.localStorage.setItem('dwp:pos', JSON.stringify({ x, y })); } catch { /* ignore */ }
    }
  }
  if (params.get('theme') === 'light') {
    document.body.removeAttribute('data-ds-dark-theme');
    if (params.get('bare') === '1') {
      document.body.style.background = '#f2f4f7';
      const mock = document.querySelector('.mock');
      if (mock) mock.style.display = 'none';
    }
  }
  const data = window.__WEEKLY_PAPER_DATA__;
  const presetIssue = params.get('issue') || (data.index && data.index.current);
  const presetTab = params.get('tab') === 'algo' ? 'algo' : 'field';
  const issue = data.issues && data.issues[presetIssue];
  const firstItem = issue && issue.sections && issue.sections[presetTab] && issue.sections[presetTab].items
    ? issue.sections[presetTab].items[Number(params.get('card') || 0)]
    : undefined;

  window.__DWP_PREVIEW_OPEN__ = params.get('open') === '1';
  window.__DWP_PREVIEW_TAB__ = params.get('tab') === 'algo' ? 'algo' : undefined;
  window.__DWP_PREVIEW_ISSUE__ = params.get('issue') || undefined;
  window.__DWP_PREVIEW_EXPAND__ = params.get('expand') === '1' && firstItem ? [firstItem.id] : [];

  const mod = window.__dwpReg.factory(() => React);
  mod.apply(ctx);
  const Root = registry[0];
  ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(Root));
  document.documentElement.setAttribute('data-ready', '1');
})();
</script>
</body>
</html>
`

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, html, 'utf8')
console.log(`preview written: ${outPath}`)
