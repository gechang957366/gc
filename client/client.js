// dsh-weekly-paper — browser half.
//
// 挂在 `shell.overlay` 槽位上的"桌面顶部下拉菜单"：一个常驻胶囊按钮，点开后
// 是本周论文速递面板（专业前沿 / 算法进展两个页签，支持历史期号回看、搜索、
// 中文+英文摘要、关键技术点、配图灯箱）。
//
// 数据来自宿主半的路由：/dsh-weekly-paper/api/{index,issue,state,update-request}
// 以及 /dsh-weekly-paper/assets/*。预览脚本会把同一份数据塞进
// window.__WEEKLY_PAPER_DATA__，于是 fetch 走内存分支（见 resolveJson）。
window.__ModuleLoader__.load({ id: "dsh-weekly-paper", factory: (require) => {
  const react = require("react");
  const h = react.createElement;
  const module = { exports: {} };
  const exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

  const NS = "dsh-weekly-paper";
  const API_BASE =
    (typeof window !== "undefined" && window.__WEEKLY_PAPER_API_BASE__) || "/dsh-weekly-paper";

  /** 整页模式：独立版 / 在线版用它，界面直接铺满页面，不再需要胶囊和下拉。 */
  const PAGE_MODE = typeof window !== "undefined" && window.__DWP_MODE__ === "page";
  const STYLE_ID = "dwp-style";

  const TAGS = {
    field: { label: "专业前沿", accent: "#38bdf8", soft: "rgba(56,189,248,.14)" },
    algo: { label: "算法进展", accent: "#a78bfa", soft: "rgba(167,139,250,.16)" },
  };

  const LEVEL_STYLE = {
    SCI: { bg: "rgba(56,189,248,.14)", fg: "#7dd3fc", bd: "rgba(56,189,248,.28)" },
    EI: { bg: "rgba(250,204,21,.13)", fg: "#facc15", bd: "rgba(250,204,21,.3)" },
    "中文核心": { bg: "rgba(248,113,113,.13)", fg: "#fca5a5", bd: "rgba(248,113,113,.28)" },
    "CCF-A": { bg: "rgba(167,139,250,.16)", fg: "#c4b5fd", bd: "rgba(167,139,250,.32)" },
    "CCF-B": { bg: "rgba(52,211,153,.14)", fg: "#6ee7b7", bd: "rgba(52,211,153,.3)" },
    PREPRINT: { bg: "rgba(148,163,184,.14)", fg: "#cbd5e1", bd: "rgba(148,163,184,.28)" },
  };

  const CAS_STYLE = {
    "1区": { bg: "rgba(248,113,113,.14)", fg: "#fca5a5", bd: "rgba(248,113,113,.3)" },
    "2区": { bg: "rgba(251,146,60,.14)", fg: "#fdba74", bd: "rgba(251,146,60,.3)" },
    "3区": { bg: "rgba(148,163,184,.14)", fg: "#cbd5e1", bd: "rgba(148,163,184,.28)" },
    "4区": { bg: "rgba(100,116,139,.14)", fg: "#94a3b8", bd: "rgba(100,116,139,.3)" },
  };

  // ---------------------------------------------------------------- styles --
  const CSS = `
.dwp-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000;
  font-family:ui-sans-serif,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.dwp-anchor{position:fixed;pointer-events:auto;display:flex;flex-direction:column;align-items:center;
  transition:box-shadow .15s}
.dwp-anchor[data-dragging="1"]{cursor:grabbing;user-select:none}
.dwp-anchor[data-dragging="1"] .dwp-pill{cursor:grabbing;transform:none}
.dwp-root{--dwp-fg:#1f2328;--dwp-fg-dim:#5b6673;--dwp-fg-faint:#8a949f;
  --dwp-surface:rgba(255,255,255,.97);--dwp-surface-2:rgba(248,250,252,.98);--dwp-line:rgba(15,23,42,.12);
  --dwp-line-soft:rgba(15,23,42,.07);--dwp-chip:rgba(15,23,42,.045);--dwp-code:#334155;
  --dwp-shadow:0 24px 60px rgba(15,23,42,.18),0 2px 8px rgba(15,23,42,.08);--dwp-glow:rgba(56,189,248,.35)}
body[data-ds-dark-theme] .dwp-root{--dwp-fg:#e6edf3;--dwp-fg-dim:#9aa7b4;--dwp-fg-faint:#6b7785;
  --dwp-surface:rgba(22,27,34,.94);--dwp-surface-2:rgba(13,17,22,.96);--dwp-line:rgba(255,255,255,.09);
  --dwp-line-soft:rgba(255,255,255,.055);--dwp-chip:rgba(255,255,255,.045);--dwp-code:#c9d5e1;
  --dwp-shadow:0 26px 70px rgba(0,0,0,.55),0 2px 10px rgba(0,0,0,.35)}


.dwp-pill{display:flex;align-items:center;gap:9px;height:36px;padding:0 13px 0 11px;
  border-radius:999px;border:1px solid var(--dwp-line);background:var(--dwp-surface);color:var(--dwp-fg);
  box-shadow:0 8px 26px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.05);cursor:pointer;
  backdrop-filter:blur(16px) saturate(1.25);-webkit-backdrop-filter:blur(16px) saturate(1.25);
  font-size:12.5px;font-weight:600;letter-spacing:.01em;transition:border-color .16s,transform .16s,box-shadow .16s}
.dwp-pill:hover{border-color:rgba(120,200,255,.5);transform:translateY(-1px);box-shadow:0 10px 30px rgba(0,0,0,.35)}
.dwp-pill[data-open="1"]{border-color:rgba(120,200,255,.55)}
.dwp-pill-ico{display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;
  background:linear-gradient(135deg,rgba(56,189,248,.9),rgba(167,139,250,.9));color:#08131d}
.dwp-pill-sep{width:1px;height:14px;background:var(--dwp-line)}
.dwp-pill-issue{font-variant-numeric:tabular-nums;font-weight:600;color:var(--dwp-fg)}
.dwp-pill-count{font-weight:500;color:var(--dwp-fg-dim);font-variant-numeric:tabular-nums}
.dwp-chev{transition:transform .18s;color:var(--dwp-fg-faint);display:flex}
.dwp-pill[data-open="1"] .dwp-chev{transform:rotate(180deg)}
.dwp-dot{width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 0 0 rgba(52,211,153,.6);animation:dwp-pulse 2.4s infinite}
@keyframes dwp-pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.55)}70%{box-shadow:0 0 0 7px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}

.dwp-panel{position:fixed;display:flex;flex-direction:column;
  height:min(76vh,820px);min-height:360px;border-radius:16px;border:1px solid var(--dwp-line);background:var(--dwp-surface);
  box-shadow:var(--dwp-shadow);backdrop-filter:blur(22px) saturate(1.3);-webkit-backdrop-filter:blur(22px) saturate(1.3);
  overflow:hidden;animation:dwp-in .16s ease-out;color:var(--dwp-fg)}
@keyframes dwp-in{from{opacity:0;transform:translateY(-6px) scale(.995)}to{opacity:1;transform:none}}

.dwp-head{display:flex;align-items:center;gap:12px;padding:13px 15px 12px;border-bottom:1px solid var(--dwp-line-soft);
  background:linear-gradient(180deg,rgba(56,189,248,.06),transparent 90%)}
.dwp-head-main{min-width:0;flex:1}
.dwp-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;letter-spacing:.01em}
.dwp-sub{margin-top:3px;font-size:11.5px;color:var(--dwp-fg-dim);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dwp-sub-sep{width:3px;height:3px;border-radius:50%;background:var(--dwp-fg-faint)}
.dwp-head-acts{display:flex;align-items:center;gap:6px}
.dwp-select{appearance:none;-webkit-appearance:none;height:28px;padding:0 26px 0 10px;border-radius:8px;
  border:1px solid var(--dwp-line);background:var(--dwp-chip);color:var(--dwp-fg);font-size:12px;font-weight:600;
  cursor:pointer;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238a949f' stroke-width='3'><path d='M6 9l6 6 6-6'/></svg>");
  background-repeat:no-repeat;background-position:right 8px center}
.dwp-select:focus{outline:none;border-color:rgba(120,200,255,.55)}
.dwp-iconbtn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;
  border:1px solid var(--dwp-line);background:var(--dwp-chip);color:var(--dwp-fg-dim);cursor:pointer;transition:.15s}
.dwp-iconbtn:hover{color:var(--dwp-fg);border-color:rgba(120,200,255,.45);background:rgba(56,189,248,.1)}
.dwp-iconbtn[disabled]{opacity:.45;cursor:default}

.dwp-bar{display:flex;align-items:center;gap:8px;padding:9px 15px;border-bottom:1px solid var(--dwp-line-soft);
  background:var(--dwp-surface-2)}
.dwp-tab{display:flex;align-items:center;gap:7px;height:29px;padding:0 12px;border-radius:8px;border:1px solid transparent;
  background:transparent;color:var(--dwp-fg-dim);font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
.dwp-tab:hover{color:var(--dwp-fg);background:var(--dwp-chip)}
.dwp-tab[data-on="1"]{color:var(--dwp-fg);background:var(--dwp-chip);border-color:var(--dwp-line)}
.dwp-tab-n{font-size:10.5px;font-weight:700;padding:1px 5px;border-radius:999px;background:var(--dwp-line);
  color:var(--dwp-fg-dim);font-variant-numeric:tabular-nums}
.dwp-tab[data-on="1"] .dwp-tab-n{color:var(--dwp-fg)}
.dwp-tab-dot{width:6px;height:6px;border-radius:50%}
.dwp-spacer{flex:1}
.dwp-search{display:flex;align-items:center;gap:6px;height:29px;padding:0 9px;border-radius:8px;
  border:1px solid var(--dwp-line);background:var(--dwp-chip);color:var(--dwp-fg-faint);min-width:150px}
.dwp-search input{border:0;background:transparent;color:var(--dwp-fg);font-size:12px;outline:none;width:100%;
  font-family:inherit}
.dwp-search input::placeholder{color:var(--dwp-fg-faint)}

.dwp-body{overflow-y:auto;overscroll-behavior:contain;padding:12px 14px 14px;scrollbar-width:thin}
.dwp-body::-webkit-scrollbar{width:9px}
.dwp-body::-webkit-scrollbar-thumb{background:rgba(148,163,184,.28);border-radius:99px;border:2px solid transparent;
  background-clip:padding-box}
.dwp-body::-webkit-scrollbar-thumb:hover{background:rgba(148,163,184,.5);background-clip:padding-box}

.dwp-card{position:relative;border:1px solid var(--dwp-line-soft);border-radius:12px;padding:12px 14px 11px 16px;
  background:linear-gradient(180deg,var(--dwp-chip),transparent 60%);transition:border-color .15s,background .15s}
.dwp-card+.dwp-card{margin-top:10px}
.dwp-card:hover{border-color:var(--dwp-line)}
.dwp-card::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;
  background:var(--dwp-accent,#38bdf8);opacity:.85}
.dwp-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:11px;color:var(--dwp-fg-dim)}
.dwp-venue{font-weight:700;color:var(--dwp-accent,#38bdf8);letter-spacing:.01em}
.dwp-venue-full{color:var(--dwp-fg-faint);font-weight:500}
.dwp-badge{padding:1px 6px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.02em;border:1px solid}
.dwp-metric{padding:1px 6px;border-radius:5px;font-size:10px;font-weight:600;letter-spacing:.01em;
  border:1px solid var(--dwp-line-soft);background:var(--dwp-chip);color:var(--dwp-fg-dim);white-space:nowrap}
.dwp-metric[data-kind="cas"]{font-variant-numeric:tabular-nums}
.dwp-metric[data-kind="if"]{font-variant-numeric:tabular-nums}
.dwp-date{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--dwp-fg-faint)}
.dwp-jump{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:5px;
  border:1px solid var(--dwp-line-soft);color:var(--dwp-fg-faint);text-decoration:none;transition:.15s;
  font-size:10.5px;font-weight:650;white-space:nowrap}
a.dwp-h3{color:inherit;text-decoration:none}
a.dwp-h3:hover{text-decoration:underline;text-underline-offset:2px;text-decoration-color:var(--dwp-accent,#38bdf8)}
.dwp-jump:hover{color:var(--dwp-accent,#38bdf8);border-color:var(--dwp-accent,#38bdf8);background:var(--dwp-soft)}
.dwp-h3{margin:7px 0 0;font-size:14.5px;line-height:1.45;font-weight:650;letter-spacing:.005em;color:var(--dwp-fg)}
.dwp-zh{margin:3px 0 0;font-size:12.5px;line-height:1.5;color:var(--dwp-fg-dim)}
.dwp-cite{display:flex;align-items:flex-start;gap:7px;margin:8px 0 0;padding:6px 8px;border-radius:7px;
  background:var(--dwp-chip);border:1px solid var(--dwp-line-soft);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;line-height:1.55;color:var(--dwp-code)}
.dwp-cite-txt{flex:1;min-width:0;word-break:break-word}
.dwp-copy{flex:0 0 auto;border:0;background:transparent;color:var(--dwp-fg-faint);cursor:pointer;padding:0 2px;
  font-size:10.5px;font-family:inherit;font-weight:600}
.dwp-copy:hover{color:var(--dwp-accent,#38bdf8)}
.dwp-kw{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}
.dwp-kw span{font-size:10.5px;padding:1.5px 7px;border-radius:999px;background:var(--dwp-chip);
  border:1px solid var(--dwp-line-soft);color:var(--dwp-fg-dim)}
.dwp-abs{margin:8px 0 0;font-size:12.5px;line-height:1.72;color:var(--dwp-fg-dim)}
.dwp-abs[data-clamp="1"]{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dwp-more{display:flex;align-items:center;gap:12px;margin-top:9px;font-size:11.5px;color:var(--dwp-fg-faint)}
.dwp-more button{display:flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--dwp-accent,#38bdf8);
  font-size:11.5px;font-weight:650;cursor:pointer;padding:0;font-family:inherit}
.dwp-more button:hover{text-decoration:underline}
.dwp-more .dwp-count-ico{color:var(--dwp-fg-faint);display:flex;align-items:center;gap:4px}

.dwp-detail{margin-top:10px;border-top:1px dashed var(--dwp-line);padding-top:10px}
.dwp-block{margin-top:10px}
.dwp-block:first-child{margin-top:0}
.dwp-block-h{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.02em;
  text-transform:uppercase;color:var(--dwp-fg-faint);margin-bottom:5px}
.dwp-block-h::after{content:"";flex:1;height:1px;background:var(--dwp-line-soft)}
.dwp-absfull{font-size:12.5px;line-height:1.78;color:var(--dwp-fg)}
.dwp-absfull[data-lang="en"]{font-family:ui-serif,Georgia,"Times New Roman",serif;font-size:12.5px;line-height:1.72;
  color:var(--dwp-fg-dim)}
.dwp-kp{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.dwp-kp li{position:relative;padding-left:18px;font-size:12.5px;line-height:1.68;color:var(--dwp-fg)}
.dwp-kp li::before{content:"";position:absolute;left:4px;top:8px;width:6px;height:6px;border-radius:2px;
  background:var(--dwp-accent,#38bdf8);opacity:.9;transform:rotate(45deg)}
.dwp-figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:9px}
.dwp-fig{border:1px solid var(--dwp-line-soft);border-radius:9px;overflow:hidden;background:rgba(0,0,0,.18);cursor:zoom-in}
.dwp-fig img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;transition:transform .25s}
.dwp-fig:hover img{transform:scale(1.03)}
.dwp-fig figcaption{padding:6px 8px;font-size:10.5px;line-height:1.5;color:var(--dwp-fg-faint)}
.dwp-links{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
.dwp-link{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:7px;
  border:1px solid var(--dwp-line);background:var(--dwp-chip);color:var(--dwp-fg);font-size:11.5px;font-weight:600;
  text-decoration:none;transition:.15s}
.dwp-link:hover{border-color:var(--dwp-accent,#38bdf8);color:var(--dwp-accent,#38bdf8);background:var(--dwp-soft)}

.dwp-foot{display:flex;align-items:center;gap:10px;padding:9px 15px;border-top:1px solid var(--dwp-line-soft);
  background:var(--dwp-surface-2);font-size:11px;color:var(--dwp-fg-faint)}
.dwp-foot b{color:var(--dwp-fg-dim);font-weight:600}
.dwp-ghost{display:inline-flex;align-items:center;gap:6px;height:27px;padding:0 11px;border-radius:7px;
  border:1px solid var(--dwp-line);background:var(--dwp-chip);color:var(--dwp-fg-dim);font-size:11.5px;
  font-weight:600;cursor:pointer;font-family:inherit;transition:.15s}
.dwp-ghost:hover{color:var(--dwp-fg);border-color:rgba(120,200,255,.45)}
.dwp-ghost[data-busy="1"]{opacity:.6;cursor:progress}
.dwp-chip{height:22px;padding:0 8px;border-radius:6px;border:1px solid transparent;background:var(--dwp-chip);
  color:var(--dwp-fg-dim);font-size:10.5px;font-weight:700;cursor:pointer;font-family:inherit;
  font-variant-numeric:tabular-nums;transition:.15s}
.dwp-chip:hover{color:var(--dwp-fg);border-color:var(--dwp-line)}
.dwp-chip[data-on="1"]{color:var(--dwp-accent,#38bdf8);border-color:var(--dwp-line);background:transparent}

.dwp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  padding:44px 20px;text-align:center;color:var(--dwp-fg-dim);font-size:12.5px}
.dwp-empty b{font-size:13.5px;color:var(--dwp-fg)}
.dwp-skel{height:78px;border-radius:11px;border:1px solid var(--dwp-line-soft);
  background:linear-gradient(90deg,var(--dwp-chip) 25%,rgba(148,163,184,.12) 37%,var(--dwp-chip) 63%);
  background-size:400% 100%;animation:dwp-sh 1.3s ease infinite}
.dwp-skel+.dwp-skel{margin-top:10px}
@keyframes dwp-sh{0%{background-position:100% 50%}100%{background-position:0 50%}}

/* ── 本期概述（默认折叠）──────────────────────────────────────────────── */
.dwp-summary{grid-column:1 / -1;margin-bottom:10px;border:1px solid var(--dwp-line-soft);border-radius:11px;
  background:var(--dwp-chip)}
.dwp-summary-head{display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;border:0;border-radius:10px;background:transparent;
  color:var(--dwp-fg);font:inherit;font-size:12.5px;font-weight:650;cursor:pointer;text-align:left}
.dwp-summary-head:hover{background:var(--dwp-soft)}
.dwp-summary-ico{display:flex;align-items:center;color:var(--dwp-accent,#38bdf8)}
.dwp-summary-count{margin-left:auto;font-size:11px;font-weight:600;color:var(--dwp-fg-faint);
  font-variant-numeric:tabular-nums}
.dwp-summary-chev{display:flex;align-items:center;color:var(--dwp-fg-faint);transition:transform .18s}
.dwp-summary[data-open="1"] .dwp-summary-chev{transform:rotate(180deg)}
.dwp-summary-body{margin:0;padding:0 12px 12px;font-size:12.5px;line-height:1.8;color:var(--dwp-fg-dim)}
.dwp-summary-text{margin:0}
.dwp-refs{margin-top:10px;padding-top:9px;border-top:1px dashed var(--dwp-line-soft)}
.dwp-refs-h{font-size:11px;font-weight:700;letter-spacing:.02em;color:var(--dwp-fg-faint);margin-bottom:6px}
.dwp-refs ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px}
.dwp-refs li{font-size:11.5px;line-height:1.7;color:var(--dwp-fg-faint)}
.dwp-panel-page .dwp-refs{margin-top:14px;padding-top:12px}
.dwp-panel-page .dwp-refs-h{font-size:12.5px}
.dwp-panel-page .dwp-refs li{font-size:13.5px;line-height:1.75}
/* ── 文献检索视图 ─────────────────────────────────────────────────────── */
.dwp-tab-search{gap:5px}
.dwp-searchbody{display:flex;flex-direction:column;gap:10px}
.dwp-searchbox{display:flex;gap:8px;align-items:center}
.dwp-searchbox input{flex:1;height:36px;padding:0 12px;border-radius:9px;border:1px solid var(--dwp-line);
  background:var(--dwp-surface);color:var(--dwp-fg);font-size:13.5px;font-family:inherit;outline:none}
.dwp-searchbox input:focus{border-color:rgba(11,79,158,.45);box-shadow:0 0 0 3px rgba(11,79,158,.08)}
.dwp-searchgo{height:36px;padding:0 18px;border-radius:9px;border:1px solid #0b4f9e;background:#0b4f9e;color:#fff;
  font-size:13.5px;font-weight:650;cursor:pointer;font-family:inherit}
.dwp-searchgo[disabled]{opacity:.6;cursor:progress}
.dwp-presets{display:flex;gap:6px;flex-wrap:wrap}
.dwp-presets .dwp-chip{height:26px;font-size:12px;padding:0 10px}
.dwp-searchmeta{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--dwp-fg-faint)}
.dwp-searchmeta-acts{margin-left:auto;display:flex;gap:6px}
.dwp-domain{display:inline-flex;align-items:center;gap:6px;margin-top:7px;padding:2px 8px 2px 9px;
  border:1px solid var(--dwp-line);border-radius:6px;background:#fff;color:var(--dwp-fg-soft);
  font-size:11.5px;line-height:1.6;cursor:pointer;max-width:100%}
.dwp-domain:hover{border-color:var(--dwp-accent,#38bdf8)}
.dwp-domain-k{color:var(--dwp-fg-faint);flex:0 0 auto}
.dwp-domain-sel{appearance:none;-webkit-appearance:none;border:0;background:transparent;color:inherit;
  font:inherit;padding:0 14px 0 0;max-width:320px;text-overflow:ellipsis;cursor:pointer;outline:none}
.dwp-domain svg{flex:0 0 auto;margin-left:-12px;pointer-events:none;opacity:.65}
.dwp-domainrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px}
.dwp-domainrow .dwp-domain{margin-top:0}
.dwp-domain-new,.dwp-domain-edit{height:24px;font-size:11.5px;padding:0 9px}
.dwp-panel-page .dwp-domain-new,.dwp-panel-page .dwp-domain-edit{height:28px;font-size:13px}
/* 新建/编辑方向的大弹窗：插件面板只有 500 多像素，表单必须浮到页面中央 */
.dwp-modal{position:fixed;inset:0;z-index:2147483150;display:flex;align-items:center;justify-content:center;
  padding:24px;background:rgba(6,12,20,.55);backdrop-filter:blur(4px)}
.dwp-modal-card{width:min(860px,94vw);max-height:88vh;display:flex;flex-direction:column;gap:10px;
  padding:18px 20px 16px;border-radius:12px;background:var(--dwp-surface,#fff);
  box-shadow:0 24px 60px rgba(4,12,24,.28);border:1px solid var(--dwp-line);overflow:auto}
.dwp-modal-head{display:flex;align-items:center;gap:10px;font-size:15px;color:var(--dwp-fg)}
.dwp-modal-head b{flex:1 1 auto}
.dwp-modal-sub{color:var(--dwp-fg-faint);font-size:12px;line-height:1.55;margin-top:-4px}
.dwp-modal-foot{display:flex;align-items:center;gap:8px;margin-top:4px;padding-top:10px;
  border-top:1px solid var(--dwp-line-soft)}
.dwp-modal-foot .dwp-ghost{height:32px;font-size:13px;padding:0 14px}
.dwp-modal-foot .dwp-primary{background:var(--dwp-accent,#38bdf8);border-color:transparent;color:#04222f;font-weight:600}
.dwp-modal-foot .dwp-danger{color:#c0392b;border-color:rgba(192,57,43,.35)}
.dwp-modal-foot .dwp-danger-solid{background:#c0392b;border-color:transparent;color:#fff;font-weight:600}
.dwp-modal-warn{background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.3);color:#b91c1c;
  border-radius:7px;padding:8px 10px;font-size:12px;line-height:1.55}
/* 关键词 / 期刊的「芯片 + 搜索补全」 */
.dwp-pick{display:flex;flex-direction:column;gap:6px}
.dwp-pick-label{color:var(--dwp-fg-faint);font-size:12px}
.dwp-pick-chips{display:flex;flex-wrap:wrap;gap:6px}
.dwp-pick-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;
  border:1px solid var(--dwp-line);border-radius:999px;padding:3px 8px 3px 10px;
  background:var(--dwp-surface-2,#f8fafc);font-size:12px;color:var(--dwp-fg-soft)}
.dwp-pick-chip[data-flag="1"]{border-color:rgba(56,189,248,.55);background:rgba(56,189,248,.12);color:#0b6a98}
.dwp-pick-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px}
.dwp-pick-issn{color:var(--dwp-fg-faint);font-size:11px}
.dwp-pick-star,.dwp-pick-x{border:0;background:transparent;cursor:pointer;padding:0;font:inherit;
  line-height:1;color:var(--dwp-fg-faint)}
.dwp-pick-star{font-size:12px}
.dwp-pick-star:hover,.dwp-pick-x:hover{color:#0b6a98}
.dwp-pick-x{font-size:14px}
.dwp-pick-box{position:relative}
.dwp-pick-box input{width:100%}
.dwp-pick-list{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5;max-height:240px;overflow:auto;
  background:var(--dwp-surface,#fff);border:1px solid var(--dwp-line);border-radius:8px;
  box-shadow:0 12px 28px rgba(15,23,42,.14);padding:4px}
.dwp-pick-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;
  cursor:pointer;padding:6px 8px;border-radius:6px;font:inherit;font-size:12.5px;color:var(--dwp-fg)}
.dwp-pick-item:hover{background:var(--dwp-chip,rgba(15,23,42,.05))}
.dwp-pick-item-name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dwp-pick-item em{font-style:normal;color:var(--dwp-fg-faint);font-size:11px}
.dwp-pick-item i{font-style:normal;color:#0b6a98;font-size:11px;background:rgba(56,189,248,.12);
  border-radius:5px;padding:1px 5px}
.dwp-pick-add{display:block;width:100%;text-align:left;border:0;background:transparent;cursor:pointer;
  padding:6px 8px;border-radius:6px;font:inherit;font-size:12.5px;color:#0b6a98}
.dwp-pick-add:hover{background:rgba(56,189,248,.12)}
.dwp-dform-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
.dwp-dform-grid label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--dwp-fg-soft)}
.dwp-dform-grid label > span{color:var(--dwp-fg-faint)}
.dwp-dform-grid input:not([type="checkbox"]),.dwp-dform-grid textarea{
  border:1px solid var(--dwp-line);border-radius:7px;padding:8px 10px;font:inherit;font-size:13px;
  color:var(--dwp-fg);background:var(--dwp-bg-soft,#fbfdff);outline:none;width:100%}
.dwp-dform-grid input:focus,.dwp-dform-grid textarea:focus{border-color:var(--dwp-accent,#38bdf8)}
.dwp-dform-grid textarea{resize:vertical;line-height:1.55;font-family:inherit}
.dwp-dform-wide{grid-column:1 / -1}
.dwp-dform-check{flex-direction:row !important;align-items:center;gap:6px;grid-column:1 / -1;font-size:12.5px}
.dwp-dform-check input{width:auto}
@media (max-width:700px){
  .dwp-modal{padding:10px}
  .dwp-modal-card{padding:14px 14px 12px}
  .dwp-dform-grid{grid-template-columns:1fr}
}
.dwp-tierrow{display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center}
.dwp-tierrow i{font-style:normal;padding:1px 6px;border-radius:5px;background:rgba(56,189,248,.12);
  color:#2b7fb5;font-size:11px;line-height:1.5}
.dwp-export{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:10px;padding-top:9px;
  border-top:1px dashed var(--dwp-line-soft)}
.dwp-export-label{font-size:11.5px;color:var(--dwp-fg-faint);font-weight:600}
.dwp-export-btn{height:24px;padding:0 9px;border-radius:6px;border:1px solid var(--dwp-line);background:var(--dwp-chip);
  color:var(--dwp-fg-dim);font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:.15s}
.dwp-export-btn:hover{color:var(--dwp-fg);border-color:#8fb3d9}
.dwp-export-btn[data-copied="1"]{color:#0b7a52;border-color:#8ed3b7;background:#eefaf4}
.dwp-fav{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:5px;
  border:1px solid var(--dwp-line-soft);background:transparent;color:var(--dwp-fg-faint);
  font-size:10.5px;font-weight:650;cursor:pointer;font-family:inherit;transition:.15s}
.dwp-fav:hover{color:#b8860b;border-color:#e2c56b}
.dwp-fav[data-on="1"]{color:#b8860b;border-color:#e2c56b;background:rgba(226,197,107,.14)}
.dwp-reroll{height:28px}
.dwp-panel-page .dwp-fav{height:24px;font-size:12.5px;padding:0 9px}
.dwp-panel-page .dwp-reroll{height:32px;font-size:13px}
.dwp-tab-fav{gap:5px}
.dwp-chip-wrap{display:inline-flex;align-items:center;gap:2px}
.dwp-chip-wrap .dwp-chip-x{display:none;width:18px;height:18px;border-radius:5px;border:0;background:transparent;
  color:var(--dwp-fg-faint);font-size:13px;line-height:1;cursor:pointer;padding:0;font-family:inherit}
.dwp-chip-wrap:hover .dwp-chip-x{display:inline-block}
.dwp-chip-x:hover{color:#c0392b;background:rgba(192,57,43,.12)}
.dwp-warn{color:#b45309;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.34);
  border-radius:6px;padding:2px 8px;font-size:11.5px;line-height:1.5;max-width:420px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.dwp-panel-page .dwp-searchbox input{height:40px;font-size:15px}
.dwp-panel-page .dwp-searchgo{height:40px;font-size:15px;padding:0 22px}
.dwp-panel-page .dwp-presets .dwp-chip{height:30px;font-size:13.5px}
.dwp-panel-page .dwp-searchmeta{font-size:13px}
.dwp-panel-page .dwp-export-btn{height:28px;font-size:13px}
.dwp-panel-page .dwp-export-label{font-size:12.5px}
.dwp-panel-page .dwp-warn{font-size:13px;max-width:560px}

.dwp-lightbox{position:fixed;inset:0;z-index:2147483100;background:rgba(4,8,12,.82);backdrop-filter:blur(6px);
  display:flex;align-items:center;justify-content:center;padding:38px;cursor:zoom-out}
.dwp-lightbox figure{margin:0;max-width:min(1200px,92vw);max-height:88vh;display:flex;flex-direction:column;gap:10px}
.dwp-lightbox img{max-width:100%;max-height:76vh;object-fit:contain;border-radius:10px;background:#0b1117;
  box-shadow:0 30px 80px rgba(0,0,0,.6)}
.dwp-lightbox figcaption{font-size:12px;line-height:1.6;color:#cbd5e1;text-align:center}
.dwp-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:34px;z-index:2147483200;
  padding:9px 16px;border-radius:999px;background:rgba(15,23,42,.94);color:#e2e8f0;font-size:12.5px;
  border:1px solid rgba(148,163,184,.3);box-shadow:0 12px 40px rgba(0,0,0,.45);animation:dwp-in .18s ease-out}

/* ── 整页模式（独立版 / 在线版）：没有胶囊、没有下拉，内容直接铺满 ───────── */
.dwp-root.dwp-page{--dwp-fg:#101c2b;--dwp-fg-dim:#37485e;--dwp-fg-faint:#6f8098;
  --dwp-surface:#ffffff;--dwp-surface-2:#f8fafd;--dwp-line:#e2e9f3;--dwp-line-soft:#eef3fa;
  --dwp-chip:#f3f7fc;--dwp-code:#22405f;
  --dwp-shadow:0 10px 30px rgba(11,42,84,.09)}
.dwp-logo{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;
  background:linear-gradient(135deg,#0b4f9e,#12a08c);color:#fff;box-shadow:0 2px 6px rgba(11,79,158,.25)}
.dwp-panel-page{position:fixed;inset:0;width:100%;height:100vh;height:100dvh;max-height:none;min-height:0;
  border:0;border-radius:0;box-shadow:none;background:#f4f7fc;backdrop-filter:none;-webkit-backdrop-filter:none;
  animation:none;display:flex;flex-direction:column}
.dwp-panel-page .dwp-head{background:#fff;padding:14px 22px;border-bottom:1px solid var(--dwp-line);
  background-image:none;flex:0 0 auto}
.dwp-panel-page .dwp-title{font-size:16px;gap:10px}
.dwp-panel-page .dwp-sub{font-size:12px;margin-top:4px}
.dwp-panel-page .dwp-bar{background:#fff;padding:10px 22px;border-bottom:1px solid var(--dwp-line);flex:0 0 auto}
.dwp-panel-page .dwp-body{flex:1 1 auto;padding:16px 22px 22px;background:#f4f7fc;
  display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,640px),1fr));gap:14px;align-content:start}
.dwp-panel-page .dwp-card{margin:0;background:#fff;border-color:var(--dwp-line);
  box-shadow:0 1px 2px rgba(11,42,84,.04)}
.dwp-panel-page .dwp-card+.dwp-card{margin-top:0}
.dwp-panel-page .dwp-card:hover{border-color:#cbd8e9;box-shadow:0 2px 10px rgba(11,42,84,.07)}
.dwp-panel-page .dwp-foot{background:#fff;padding:10px 22px;border-top:1px solid var(--dwp-line);flex:0 0 auto}
.dwp-panel-page .dwp-cite{background:#f7fafd;border-color:#e8eff8}
.dwp-panel-page .dwp-kw span{background:#f3f7fc}
.dwp-panel-page .dwp-empty{grid-column:1 / -1}
@media (max-width:720px){
  .dwp-panel-page .dwp-head,.dwp-panel-page .dwp-bar,.dwp-panel-page .dwp-body,.dwp-panel-page .dwp-foot{padding-left:14px;padding-right:14px}
  .dwp-panel-page .dwp-search{min-width:110px}
}

/* ── 整页模式的排版：宋体 + Times New Roman，单列，正文按"小四"（16px） ───── */
.dwp-panel-page,
.dwp-panel-page button,
.dwp-panel-page input,
.dwp-panel-page select{
  font-family:"Times New Roman","SimSun","宋体","Songti SC","Times",serif}
.dwp-panel-page .dwp-body{grid-template-columns:minmax(0,1240px);justify-content:center}
.dwp-panel-page .dwp-head{padding:16px 24px 14px}
.dwp-panel-page .dwp-title{font-size:21px;gap:10px}
.dwp-panel-page .dwp-sub{font-size:14px;margin-top:5px;gap:9px}
.dwp-panel-page .dwp-bar{padding:11px 24px}
.dwp-panel-page .dwp-tab{font-size:15px;height:34px;padding:0 14px}
.dwp-panel-page .dwp-tab-n{font-size:12px;padding:1px 7px}
.dwp-panel-page .dwp-search{height:34px;min-width:220px;padding:0 11px}
.dwp-panel-page .dwp-search input{font-size:14.5px}
.dwp-panel-page .dwp-select{height:32px;font-size:14px;padding:0 28px 0 11px}
.dwp-panel-page .dwp-iconbtn{width:32px;height:32px}
.dwp-panel-page .dwp-card{padding:16px 20px 15px 22px}
.dwp-panel-page .dwp-meta{font-size:13px;gap:8px}
.dwp-panel-page .dwp-badge{font-size:11.5px;padding:2px 7px}
.dwp-panel-page .dwp-metric{font-size:11.5px;padding:2px 7px}
.dwp-panel-page .dwp-date{font-size:13px}
.dwp-panel-page .dwp-jump{height:24px;font-size:12px;padding:0 9px}
.dwp-panel-page .dwp-h3{font-size:20px;line-height:1.42;margin-top:9px}
.dwp-panel-page .dwp-zh{font-size:16.5px;line-height:1.62;margin-top:5px}
.dwp-panel-page .dwp-cite{font-size:13.5px;line-height:1.62;padding:8px 10px;margin-top:10px}
.dwp-panel-page .dwp-copy{font-size:12.5px}
.dwp-panel-page .dwp-kw{margin-top:10px;gap:6px}
.dwp-panel-page .dwp-kw span{font-size:13px;padding:2px 9px}
.dwp-panel-page .dwp-abs{font-size:16px;line-height:1.85;margin-top:10px}
.dwp-panel-page .dwp-more{margin-top:11px;font-size:13.5px;gap:14px}
.dwp-panel-page .dwp-more button{font-size:13.5px}
.dwp-panel-page .dwp-detail{margin-top:12px;padding-top:12px}
.dwp-panel-page .dwp-block{margin-top:14px}
.dwp-panel-page .dwp-block-h{font-size:12.5px;margin-bottom:7px}
.dwp-panel-page .dwp-absfull{font-size:16px;line-height:1.9}
.dwp-panel-page .dwp-absfull[data-lang="en"]{font-size:15.5px;line-height:1.8}
.dwp-panel-page .dwp-kp{gap:8px}
.dwp-panel-page .dwp-kp li{font-size:15.5px;line-height:1.85;padding-left:20px}
.dwp-panel-page .dwp-fig figcaption{font-size:12.5px;padding:7px 9px}
.dwp-panel-page .dwp-links{margin-top:12px;gap:8px}
.dwp-panel-page .dwp-link{height:30px;font-size:13.5px;padding:0 12px}
.dwp-panel-page .dwp-foot{font-size:13px;padding:11px 24px}
.dwp-panel-page .dwp-ghost{height:30px;font-size:13px;padding:0 12px}
.dwp-panel-page .dwp-chip{height:26px;font-size:12px;padding:0 9px}
.dwp-panel-page .dwp-summary{margin-bottom:14px;background:#fff;border-color:var(--dwp-line);box-shadow:0 1px 2px rgba(11,42,84,.04)}
.dwp-panel-page .dwp-summary-head{font-size:15.5px;padding:12px 16px}
.dwp-panel-page .dwp-summary-count{font-size:13px}
.dwp-panel-page .dwp-summary-body{font-size:16px;line-height:1.9;padding:0 18px 16px}
.dwp-panel-page .dwp-empty{font-size:15px}
`;

  function ensureStyle() {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;
    const node = document.createElement("style");
    node.id = STYLE_ID;
    node.textContent = CSS;
    document.head.appendChild(node);
  }

  // ------------------------------------------------------------------ data --
  const issueCache = new Map();

  function previewData() {
    const glob = typeof window !== "undefined" ? window.__WEEKLY_PAPER_DATA__ : undefined;
    return glob && typeof glob === "object" ? glob : undefined;
  }

  /**
   * 静态站点模式（`node scripts/build-standalone.mjs --site` 生成的那种）：
   * 页面不再内联数据，而是从同目录 data/ 下拉 JSON，所以换个数据文件就能更新。
   */
  function staticBase() {
    if (typeof window === "undefined") return undefined;
    const value = window.__DWP_STATIC__;
    return typeof value === "string" && value ? value.replace(/\/$/, "") : undefined;
  }

  /**
   * 把 "…/api/issue?id=x" 拆成路由段 "/api/issue" + 查询串 "?id=x"。
   * 必须按段精确比较：早先用 includes("/api/issue") 会把 /api/issue-delete
   * 也认成"取某一期"，静态站点下就被改写成 data/issues/.json 而报 JSON 解析错。
   */
  function splitApiPath(path) {
    const text = String(path || "");
    const at = text.indexOf("/api/");
    if (at < 0) return { route: "", search: "" };
    const tail = text.slice(at);
    const q = tail.indexOf("?");
    return {
      route: q < 0 ? tail.replace(/\/+$/, "") : tail.slice(0, q),
      search: q < 0 ? "" : tail.slice(q),
    };
  }

  /**
   * 默认方向的数据放在 data/ 根下（历史位置），其他方向在 data/domains/<id>/。
   * 静态站点拼接路径时必须知道"谁是默认"，否则切到默认方向会去请求
   * data/domains/power/index.json（不存在）——本地版切回功率预测白屏就是这个原因。
   */
  let DEFAULT_DOMAIN = (typeof window !== "undefined" && window.__DEFAULT_DOMAIN__) || "power";

  function staticUrl(path) {
    const base = staticBase();
    if (!base) return undefined;
    const { route, search } = splitApiPath(path);
    const domain = new URL("http://x" + (search || "")).searchParams.get("domain");
    const isDefault = !domain || domain === DEFAULT_DOMAIN;
    const prefix = isDefault ? `${base}/data` : `${base}/data/domains/${encodeURIComponent(domain)}`;
    if (route === "/api/domains") return `${base}/data/domains.json`;
    if (route === "/api/index") return `${prefix}/index.json`;
    if (route === "/api/issue") {
      const id = new URL("http://x" + search).searchParams.get("id");
      return `${prefix}/issues/${encodeURIComponent(id || "")}.json`;
    }
    // 这些是站点后端现算的接口，原样转给 lan-server
    if (route === "/api/search") return `${base}${route}${search}`;
    if (route === "/api/health" || route === "/api/reroll" || route === "/api/issue-delete") {
      return `${base}${route}`;
    }
    return undefined;
  }

  /** 单文件版把数据内联在 window 上（含各方向的数据副本）。 */
  function previewBag(domain) {
    const preview = previewData();
    if (!preview) return undefined;
    if (domain && preview.domains && preview.domains[domain]) return preview.domains[domain];
    return preview;
  }

  /**
   * 有没有可用后端（能现场检索 / 换一批 / 删期号）：
   * 单文件版把数据内联在 HTML 里，纯静态、没有后端；插件版和局域网版都有。
   */
  function hasBackend() {
    return !previewData();
  }

  async function fetchJson(path, domain) {
    const { route, search } = splitApiPath(path);
    const bag = previewBag(domain);
    if (bag) {
      if (route === "/api/index") return bag.index;
      if (route === "/api/issue") {
        const id = new URL("http://x" + search).searchParams.get("id");
        const issue = bag.issues && bag.issues[id];
        if (!issue) throw new Error("issue not found: " + id);
        return { ok: true, issue };
      }
      if (route === "/api/state") return { ok: true, coverage: (bag.index || {}).coverage || {} };
    }
    const url = staticUrl(path) || path;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  /**
   * 调后端接口并安全解析：区分"接口不存在（旧版本后端/没重启）"和真正的业务错误，
   * 避免直接抛 "Unexpected end of JSON input" 这种看不懂的报错。
   */
  async function callApi(path, init) {
    // 只有 GET 才走静态文件映射：POST（换一批、删期号、写方向）必须打真正的后端路由，
    // 否则静态站点下会 POST 到一个 JSON 文件上。
    const method = String((init && init.method) || "GET").toUpperCase();
    const url = (method === "GET" ? staticUrl(path) : undefined) || path;
    let res;
    try {
      res = await fetch(url, init);
    } catch (error) {
      throw new Error("连不上后端（" + String((error && error.message) || error) + "）");
    }
    const text = await res.text();
    if (!text) {
      throw new Error(`接口未启用（HTTP ${res.status}）——后端还是旧版本，重启 dsh web 或 start.cmd 后重试`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`接口返回的不是 JSON（HTTP ${res.status}）——多半是旧版本后端，重启后重试`);
    }
    if (!res.ok || data.ok === false) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    return data;
  }

  /** 方向（研究领域）相关：切换方向时所有请求都带上 domain。 */
  function domainQuery(domain) {
    return domain ? "domain=" + encodeURIComponent(domain) : "";
  }

  async function loadIndex(domain) {
    const q = domainQuery(domain);
    const body = await fetchJson(API_BASE + "/api/index" + (q ? "?" + q : ""), domain);
    if (!body || body.ok === false) throw new Error((body && body.error) || "索引读取失败");
    return body;
  }

  async function loadIssue(id, domain) {
    const key = `${domain || ""}|${id}`;
    if (issueCache.has(key)) return issueCache.get(key);
    const q = domainQuery(domain);
    const body = await fetchJson(
      API_BASE + "/api/issue?id=" + encodeURIComponent(id) + (q ? "&" + q : ""),
      domain,
    );
    if (!body || body.ok === false) throw new Error((body && body.error) || "期号读取失败");
    // 插件接口把期号包在 { ok, issue } 里；静态站点直接返回期号 JSON
    const issue = body.issue || body;
    if (!issue || !issue.sections) throw new Error((body && body.error) || "期号内容为空");
    issueCache.set(key, issue);
    return issue;
  }

  /** 方向接口的版本：3 = 支持新建/修改/删除。旧后端只有只读的列表。 */
  let DOMAIN_API_VERSION = 0;

  /** 方向列表：插件/局域网版问后端，单文件版读内联的那份。 */
  async function loadDomains() {
    const inline =
      typeof window !== "undefined" && Array.isArray(window.__WEEKLY_PAPER_DOMAINS__)
        ? window.__WEEKLY_PAPER_DOMAINS__
        : undefined;
    if (inline && inline.length) {
      const preview = previewData();
      const def = (preview && preview.defaultDomain) || inline[0].id;
      DEFAULT_DOMAIN = def;
      DOMAIN_API_VERSION = 0; // 单文件版没有写能力
      return { default: def, domains: inline, version: 0, journals: [], suggest: { queries: [], keywords: [] } };
    }
    // 先问后端（插件宿主 / 局域网服务器）：它会带 version，能判断能不能写方向
    try {
      const res = await fetch(API_BASE + "/api/domains", { cache: "no-store" });
      if (res.ok) {
        const body = await res.json();
        if (body && Array.isArray(body.domains) && body.domains.length) {
          const def = body.default || body.domains[0].id;
          DEFAULT_DOMAIN = def;
          DOMAIN_API_VERSION = Number(body.version) || 0;
          return {
            default: def,
            domains: body.domains,
            version: DOMAIN_API_VERSION,
            journals: Array.isArray(body.journals) ? body.journals : [],
            suggest: body.suggest && typeof body.suggest === "object" ? body.suggest : { queries: [], keywords: [] },
          };
        }
      }
    } catch {
      /* 没有后端就往下走静态文件 */
    }
    // 纯静态托管：读 data/domains.json（只读，不能新建方向）
    try {
      const url = staticUrl(API_BASE + "/api/domains");
      if (url) {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          if (body && Array.isArray(body.domains) && body.domains.length) {
            const def = body.default || body.domains[0].id;
            DEFAULT_DOMAIN = def;
            DOMAIN_API_VERSION = Number(body.version) || 0;
            return {
              default: def,
              domains: body.domains,
              version: DOMAIN_API_VERSION,
              journals: [],
              suggest: { queries: [], keywords: [] },
            };
          }
        }
      }
    } catch {
      /* 静态文件也没有就退化成单方向 */
    }
    return {
      default: DEFAULT_DOMAIN,
      domains: [{ id: DEFAULT_DOMAIN, label: "功率预测 · 气象 · 雷达流场", short: "功率预测", subtitle: "" }],
      version: DOMAIN_API_VERSION,
      journals: [],
      suggest: { queries: [], keywords: [] },
    };
  }

  /** 编辑弹窗回填：拿这个方向当前生效的关键词 / 期刊 / 旗舰刊。 */
  async function loadDomainDetail(id) {
    const res = await fetch(`${API_BASE}/api/domains?detail=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return undefined;
    const body = await res.json();
    return body && body.detail ? body.detail : undefined;
  }

  /** 新建 / 修改 / 删除方向：直接写 data/domains/ 与 domains.json。 */
  async function saveDomain(payload) {
    const data = await callApi(`${API_BASE}/api/domains`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // 旧版后端没有这个 POST 分支：它会当成 GET 一样返回列表（200 + 没有 action），
    // 表面"成功"其实什么都没写。这里必须显式识别出来。
    if (!data || (!data.action && !data.entry && payload.action !== "delete")) {
      throw new Error("后端还是旧版本（没有写方向的能力）：重启 dsh web / 重开本地版窗口后再试");
    }
    if (payload.action === "delete" && (!data.action || data.removed === undefined)) {
      throw new Error("后端还是旧版本（删不了方向）：重启 dsh web / 重开本地版窗口后再试");
    }
    return data;
  }

  // --------------------------------------------------------------- helpers --
  /** 补全列表：按输入过滤，排除已选的（期刊额外支持 ISSN / 缩写模糊匹配）。 */
  function pickMatches(pool, input, selected = [], fuzzy = false) {
    const needle = String(input || "").trim().toLowerCase();
    if (!needle) return [];
    const taken = new Set(selected.map((item) => String(item).toLowerCase()));
    const scored = [];
    for (const raw of pool) {
      const text = String(raw || "");
      if (!text) continue;
      const key = text.toLowerCase();
      if (taken.has(key)) continue;
      let score = 0;
      if (key === needle) score = 100;
      else if (key.startsWith(needle)) score = 80;
      else if (key.includes(needle)) score = 60;
      else if (fuzzy && fuzzyHit(key, needle)) score = 40;
      if (!score) continue;
      scored.push({ text, score, length: key.length });
    }
    scored.sort((a, b) => b.score - a.score || a.length - b.length);
    return scored.map((item) => item.text);
  }

  /** 期刊缩写/乱序匹配："jfm" → "Journal of Fluid Mechanics"，"fluid mech" 也算。 */
  function fuzzyHit(text, needle) {
    const initials = text
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join("")
    if (initials.includes(needle)) return true
    const words = needle.split(/\s+/).filter(Boolean)
    return words.length > 1 && words.every((word) => text.includes(word))
  }
  function fmtDate(value) {
    if (typeof value !== "string" || value.length < 10) return value || "";
    return value.slice(0, 10);
  }

  /** 引用格式：GB/T 7714 / BibTeX / RIS / APA。 */
  function bibtexKey(item) {
    const first = (item.authors && item.authors[0]) || "anon";
    const surname = String(first).split(/[ ,]/)[0].replace(/[^A-Za-z\u4e00-\u9fa5]/g, "");
    return `${(surname || "anon").toLowerCase()}${item.year || ""}${String(item.title || "").split(/\s+/)[0]?.replace(/[^A-Za-z]/g, "").slice(0, 4) || ""}`;
  }

  function formatCitation(item, style) {
    if (style === "gb") return item.citation || "";
    if (style === "bib") {
      const type = item.kind === "conference" ? "inproceedings" : item.kind === "preprint" ? "misc" : "article";
      const fields = [
        `title = {${item.title || ""}}`,
        `author = {${(item.authors || []).join(" and ")}}`,
        `${type === "article" ? "journal" : type === "inproceedings" ? "booktitle" : "howpublished"} = {${item.venue || ""}}`,
        `year = {${item.year || ""}}`,
      ];
      if (item.volume) fields.push(`volume = {${item.volume}}`);
      if (item.issue) fields.push(`number = {${item.issue}}`);
      if (item.pages) fields.push(`pages = {${item.pages}}`);
      if (item.doi) fields.push(`doi = {${item.doi}}`);
      if (item.arxivId) fields.push(`eprint = {${item.arxivId}}`);
      return `@${type}{${bibtexKey(item)},\n  ${fields.join(",\n  ")}\n}`;
    }
    if (style === "ris") {
      const lines = [`TY  - ${item.kind === "conference" ? "CPAPER" : item.kind === "preprint" ? "GEN" : "JOUR"}`];
      for (const author of item.authors || []) lines.push(`AU  - ${author}`);
      lines.push(`TI  - ${item.title || ""}`);
      if (item.venue) lines.push(`JO  - ${item.venue}`);
      if (item.year) lines.push(`PY  - ${item.year}`);
      if (item.volume) lines.push(`VL  - ${item.volume}`);
      if (item.issue) lines.push(`IS  - ${item.issue}`);
      if (item.pages) lines.push(`SP  - ${item.pages}`);
      if (item.doi) lines.push(`DO  - ${item.doi}`);
      if (item.abstractEn) lines.push(`AB  - ${item.abstractEn}`);
      if (item.links && item.links[0]) lines.push(`UR  - ${item.links[0].url}`);
      lines.push("ER  - ");
      return lines.join("\n");
    }
    if (style === "apa") {
      const authors = (item.authors || [])
        .map((name) => {
          const parts = String(name).split(" ");
          if (parts.length === 1) return name;
          const family = parts.slice(-1)[0];
          const initials = parts.slice(0, -1).map((p) => `${p[0]}.`).join(" ");
          return `${family}, ${initials}`;
        })
        .join(", ");
      return `${authors} (${item.year || "n.d."}). ${item.title}. ${item.venue}${item.volume ? `, ${item.volume}` : ""}${item.issue ? `(${item.issue})` : ""}${item.pages ? `, ${item.pages}` : ""}.${item.doi ? ` https://doi.org/${item.doi}` : ""}`;
    }
    return item.citation || "";
  }

  /**
   * 复制到剪贴板。优先 Clipboard API（需要 https/localhost 安全上下文），
   * 失败再退回 execCommand；两条都不行就弹一个可选中的兜底层，避免"显示已复制其实没复制"。
   * @returns {Promise<boolean>}
   */
  async function copyText(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* 权限被拒或非安全上下文，走兜底 */
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      if (ok) return true;
    } catch {
      /* 继续兜底 */
    }
    try {
      window.prompt("浏览器不允许自动复制，请按 Ctrl+C 复制下面的内容：", text);
    } catch {
      /* ignore */
    }
    return false;
  }

  // ------------------------------------------------------------ 收藏夹 --
  const FAV_KEY = "dwp:favs";

  function readFavs() {
    try {
      const raw = window.localStorage.getItem(FAV_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeFavs(favs) {
    try {
      window.localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    } catch {
      /* 存不下就算了 */
    }
  }

  function downloadFile(name, text, mime) {
    try {
      const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    } catch {
      return false;
    }
  }

  function levelBadge(level) {
    if (!level) return null;
    const style = LEVEL_STYLE[level] || LEVEL_STYLE.PREPRINT;
    return h(
      "span",
      {
        className: "dwp-badge",
        style: { background: style.bg, color: style.fg, borderColor: style.bd },
        title: "文献级别",
      },
      level,
    );
  }

  function Icon({ name, size = 14, stroke = 1.9 }) {
    const paths = {
      book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z M4 18.5A2.5 2.5 0 0 1 6.5 16H19",
      chev: "M6 9l6 6 6-6",
      close: "M6 6l12 12M18 6L6 18",
      refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
      search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 17-4.3-4.3",
      link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
      image: "M4 5h16v14H4z M4 15l4.5-4.5L13 15l3-3 4 4 M9 9.5a1 1 0 1 0 0-.01",
      spark: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z",
      download: "M12 4v10m0 0 4-4m-4 4-4-4M5 19h14",
      history: "M12 8v4l3 2M4 12a8 8 0 1 1 3 6.2M4 20v-5h5",
      copy: "M9 9h9v11H9z M6 15H4V4h11v2",
      star: "M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.6 9.7l5.8-.8L12 3.6Z",
    };
    return h(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: stroke,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      },
      h("path", { d: paths[name] || paths.spark }),
    );
  }

  // 预览脚手架（scripts/preview.mjs）用这几个全局变量直接指定初始状态，
  // 正式运行时它们都不存在，取默认值。
  function previewFlag(name, fallback) {
    if (typeof window === "undefined") return fallback;
    const value = window[name];
    return value === undefined ? fallback : value;
  }

  // -------------------------------------------------------------- components --
  function useDigest() {
    const [state, setState] = react.useState({
      status: "loading",
      index: null,
      issue: null,
      issueId: null,
      error: null,
      refreshing: false,
    });
    // ── 研究方向 ────────────────────────────────────────────────────────
    const [domains, setDomains] = react.useState(() => {
      const preset = previewFlag("__DWP_PREVIEW_DOMAINS__", null);
      return Array.isArray(preset) && preset.length
        ? { default: preset[0].id, domains: preset }
        : { default: null, domains: [] };
    });
    const [domain, setDomainState] = react.useState(() => {
      const preset = previewFlag("__DWP_PREVIEW_DOMAIN__", null);
      if (preset) return preset;
      // 页面模式（独立版/本地版）不记住上次选择：每次打开都从默认方向开始，
      // 想直接进某个方向用 ?domain=<id>。插件版才记在 localStorage 里。
      if (PAGE_MODE) return "";
      try {
        return window.localStorage.getItem("dwp:domain") || "";
      } catch {
        return "";
      }
    });

    /** 没选过方向就用后端的默认方向；选了不存在的方向也回落到默认。 */
    const effectiveDomain = react.useMemo(() => {
      if (!domains.domains.length) return domain || undefined;
      const known = domains.domains.some((entry) => entry.id === domain);
      return known ? domain : domains.default;
    }, [domain, domains]);

    const domainInfo = react.useMemo(() => {
      const found = domains.domains.find((entry) => entry.id === effectiveDomain);
      return found || domains.domains[0] || null;
    }, [domains, effectiveDomain]);

    // 用 ref 保存最新的方向列表：新建方向后要立刻能切过去，
    // 而 switchDomain 的闭包里拿到的是上一轮的 state。
    const domainsRef = react.useRef(domains);
    react.useEffect(() => {
      domainsRef.current = domains;
    }, [domains]);

    const load = react.useCallback(
      async (wantId, wantDomain) => {
        const useDomain = wantDomain === undefined ? effectiveDomain : wantDomain;
        try {
          const index = await loadIndex(useDomain);
          const target = wantId || index.current || (index.issues && index.issues[0] && index.issues[0].id);
          if (!target) {
            // 新方向还没有任何一期：界面显示空状态，不报错
            setState((prev) => ({ ...prev, status: "ready", index, issue: null, issueId: null, error: null }));
            return;
          }
          const issue = await loadIssue(target, useDomain);
          setState((prev) => ({ ...prev, status: "ready", index, issue, issueId: target, error: null }));
        } catch (error) {
          setState((prev) => ({
            ...prev,
            status: prev.issue ? "ready" : "error",
            error: String((error && error.message) || error),
          }));
        }
      },
      [effectiveDomain],
    );

    react.useEffect(() => {
      ensureStyle();
      let alive = true;
      (async () => {
        const list = await loadDomains();
        if (!alive) return;
        setDomains(list);
        let wanted = domain;
        try {
          const urlDomain = new URLSearchParams(
            typeof location !== "undefined" ? location.search : "",
          ).get("domain");
          if (urlDomain) wanted = urlDomain;
        } catch {
          /* ignore */
        }
        const stored = wanted && list.domains.some((entry) => entry.id === wanted) ? wanted : list.default;
        setDomainState(stored);
        void load(previewFlag("__DWP_PREVIEW_ISSUE__", undefined), stored);
      })();
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** 切换方向：清掉期号缓存、重读索引，并把选择记在 localStorage / 地址栏。 */
    const switchDomain = react.useCallback(
      async (next) => {
        const target = String(next || "").trim();
        if (!target) return;
        setDomainState(target);
        if (!PAGE_MODE) {
          try {
            window.localStorage.setItem("dwp:domain", target);
          } catch {
            /* ignore */
          }
        } else {
          // 页面模式：把方向写进地址栏，刷新还能停在同一个方向
          try {
            const url = new URL(window.location.href);
            if (target === domainsRef.current.default) url.searchParams.delete("domain");
            else url.searchParams.set("domain", target);
            window.history.replaceState(null, "", url.toString());
          } catch {
            /* ignore */
          }
        }
        issueCache.clear();
        setState((prev) => ({ ...prev, status: prev.issue ? "stale" : "loading", issue: null, issueId: null }));
        await load(undefined, target);
      },
      [load],
    );

    /** 重新读一遍方向列表（新建/删除方向后调用）。 */
    const reloadDomains = react.useCallback(async () => {
      const list = await loadDomains();
      domainsRef.current = list; // 立刻生效，别等 setState 下一轮
      setDomains(list);
      return list;
    }, []);

    const selectIssue = react.useCallback(
      async (id) => {
        if (!id) return;
        setState((prev) => ({ ...prev, status: prev.issue ? "stale" : "loading" }));
        try {
          const issue = await loadIssue(id, effectiveDomain);
          setState((prev) => ({ ...prev, status: "ready", issue, issueId: id, error: null }));
        } catch (error) {
          setState((prev) => ({ ...prev, status: prev.issue ? "ready" : "error", error: String(error.message || error) }));
        }
      },
      [effectiveDomain],
    );

    const refresh = react.useCallback(async () => {
      setState((prev) => ({ ...prev, refreshing: true }));
      issueCache.clear();
      try {
        await fetch(API_BASE + "/api/reload", { method: "GET", cache: "no-store" }).catch(() => undefined);
      } catch {
        /* ignore */
      }
      await load(state.issueId, effectiveDomain);
      setState((prev) => ({ ...prev, refreshing: false }));
    }, [load, state.issueId, effectiveDomain]);

    return {
      state,
      selectIssue,
      refresh,
      reload: load,
      domain: effectiveDomain,
      domainInfo,
      domains: domains.domains,
      defaultDomain: domains.default,
      domainApiVersion: domains.version || 0,
      catalog: {
        journals: domains.journals || [],
        suggest: domains.suggest || { queries: [], keywords: [] },
      },
      switchDomain,
      reloadDomains,
    };
  }

  function ItemCard({ item, accent, showExport, isFav, onToggleFav }) {
    const [open, setOpen] = react.useState(() => {
      const list = previewFlag("__DWP_PREVIEW_EXPAND__", []);
      return Array.isArray(list) && list.includes(item.id);
    });
    const [copied, setCopied] = react.useState(false);
    const [copiedStyle, setCopiedStyle] = react.useState('');
    const figures = Array.isArray(item.figures) ? item.figures.filter((fig) => fig && fig.file) : [];
    const links = Array.isArray(item.links) ? item.links : [];
    const keyPoints = Array.isArray(item.keyPoints) ? item.keyPoints : [];
    const metrics = item.metrics || {};
    const cas = metrics.cas || {};
    const casStyle = cas.zone ? CAS_STYLE[cas.zone] : undefined;
    const jcr = metrics.jcr || {};
    const impact = typeof metrics.if === "number" ? metrics.if : undefined;
    const linkCheck = item.linkCheck && typeof item.linkCheck === "object" ? item.linkCheck : undefined;

    const copyCitation = async () => {
      const text = item.citation || "";
      const ok = await copyText(text);
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    };

    return h(
      "article",
      { className: "dwp-card", style: { "--dwp-accent": accent, "--dwp-soft": TAGS[item.section] ? TAGS[item.section].soft : "rgba(56,189,248,.12)" } },
      h(
        "div",
        { className: "dwp-meta" },
        // 期刊只显示全名（缩写不可靠，两种版式都不再展示）
        h("span", { className: "dwp-venue", title: item.venue || undefined }, item.venue || item.venueShort || "—"),
        levelBadge(item.level),
        cas.zone
          ? h(
              "span",
              {
                className: "dwp-badge",
                "data-kind": "cas",
                style: {
                  background: (casStyle || {}).bg || "rgba(148,163,184,.14)",
                  color: (casStyle || {}).fg || "#cbd5e1",
                  borderColor: (casStyle || {}).bd || "rgba(148,163,184,.28)",
                },
                title:
                  "中科院分区" +
                  (cas.year ? "（" + cas.year + " 年版）" : "") +
                  (cas.major ? " · " + cas.major : "") +
                  (cas.top ? " · Top 期刊" : ""),
              },
              "中科院 " + cas.zone + (cas.top ? " Top" : ""),
            )
          : null,
        jcr.quartile || impact !== undefined
          ? h(
              "span",
              {
                className: "dwp-metric",
                "data-kind": "if",
                title: "JCR" + (jcr.year ? "（" + jcr.year + " 年版）" : "") + " · 影响因子",
              },
              [jcr.quartile, impact !== undefined ? "IF " + impact : null].filter(Boolean).join(" · "),
            )
          : null,
        item.year ? h("span", null, String(item.year)) : null,
        h("span", { className: "dwp-date" }, fmtDate(item.date)),
        onToggleFav
          ? h(
              "button",
              {
                type: "button",
                className: "dwp-fav",
                "data-on": isFav ? "1" : "0",
                title: isFav ? "取消收藏" : "收藏，之后可在「收藏夹」里看",
                onClick: (event) => {
                  event.stopPropagation();
                  onToggleFav(item);
                },
              },
              h(Icon, { name: "star", size: 11 }),
              isFav ? "已收藏" : "收藏",
            )
          : null,
        links.length
          ? h(
              "a",
              {
                className: "dwp-jump",
                href: links[0].url,
                target: "_blank",
                rel: "noreferrer noopener",
                title: "在新标签页打开" + (links[0].label || "原文"),
                onClick: (event) => event.stopPropagation(),
              },
              Icon({ name: "link", size: 11 }),
              h("span", null, links[0].label || "原文"),
            )
          : null,
        linkCheck && linkCheck.ok === false
          ? h(
              "span",
              {
                className: "dwp-metric",
                "data-kind": "warn",
                style: { color: "#fca5a5", borderColor: "rgba(248,113,113,.35)", background: "rgba(248,113,113,.12)" },
                title: "链接健康检查：最近一次（" + (linkCheck.at || "—") + "）全部链接都不可达；可能是站点抽风或需要校内/VPN 直连",
              },
              "⚠ 链接暂不可达",
            )
          : null,
      ),
      links.length
        ? h(
            "a",
            {
              className: "dwp-h3",
              href: links[0].url,
              target: "_blank",
              rel: "noreferrer noopener",
              title: "在新标签页打开" + (links[0].label || "原文"),
              onClick: (event) => event.stopPropagation(),
            },
            item.title || "(无标题)",
          )
        : h("h3", { className: "dwp-h3" }, item.title || "(无标题)"),
      item.titleZh ? h("p", { className: "dwp-zh" }, item.titleZh) : null,
      item.citation
        ? h(
            "div",
            { className: "dwp-cite" },
            h("span", { className: "dwp-cite-txt" }, item.citation),
            h(
              "button",
              { type: "button", className: "dwp-copy", onClick: copyCitation, title: "复制引用" },
              copied ? "已复制" : "复制",
            ),
          )
        : null,
      Array.isArray(item.keywords) && item.keywords.length
        ? h("div", { className: "dwp-kw" }, item.keywords.map((kw, i) => h("span", { key: i }, kw)))
        : null,
      open || !item.abstractZh
        ? null
        : h("p", { className: "dwp-abs", "data-clamp": "1" }, item.abstractZh),
      h(
        "div",
        { className: "dwp-more" },
        h(
          "button",
          { type: "button", onClick: () => setOpen(!open) },
          open ? "收起" : "摘要、要点与配图",
          h(Icon, { name: "chev", size: 12, stroke: 2.4 }),
        ),
        figures.length
          ? h("span", { className: "dwp-count-ico" }, h(Icon, { name: "image", size: 12 }), String(figures.length))
          : null,
        links.length
          ? h("span", { className: "dwp-count-ico" }, h(Icon, { name: "link", size: 12 }), String(links.length))
          : null,
        item.abstractZhSource ? h("span", { style: { marginLeft: "auto" } }, "摘要来源：" + item.abstractZhSource) : null,
      ),
      open
        ? h(
            "div",
            { className: "dwp-detail" },
            item.abstractZh
              ? h(
                  "div",
                  { className: "dwp-block" },
                  h("div", { className: "dwp-block-h" }, "中文摘要"),
                  h("div", { className: "dwp-absfull" }, item.abstractZh),
                )
              : null,
            item.abstractEn
              ? h(
                  "div",
                  { className: "dwp-block" },
                  h("div", { className: "dwp-block-h" }, "Abstract"),
                  h("div", { className: "dwp-absfull", "data-lang": "en" }, item.abstractEn),
                )
              : null,
            keyPoints.length
              ? h(
                  "div",
                  { className: "dwp-block" },
                  h("div", { className: "dwp-block-h" }, "关键技术点"),
                  h("ul", { className: "dwp-kp" }, keyPoints.map((point, i) => h("li", { key: i }, point))),
                )
              : null,
            figures.length
              ? h(
                  "div",
                  { className: "dwp-block" },
                  h("div", { className: "dwp-block-h" }, "配图"),
                  h(
                    "div",
                    { className: "dwp-figs" },
                    figures.map((fig, i) =>
                      h(
                        "figure",
                        {
                          key: i,
                          className: "dwp-fig",
                          onClick: () => {
                            if (typeof window !== "undefined") window.__dwpLightbox = { src: API_BASE + "/assets/" + fig.file, caption: fig.caption };
                            window.dispatchEvent(new CustomEvent("dwp:lightbox"));
                          },
                          title: "点击放大",
                        },
                        h("img", { src: API_BASE + "/assets/" + fig.file, alt: fig.caption || "", loading: "lazy" }),
                        h(
                          "figcaption",
                          null,
                          [fig.caption, fig.source, fig.license].filter(Boolean).join(" · "),
                        ),
                      ),
                    ),
                  ),
                )
              : null,
            links.length
              ? h(
                  "div",
                  { className: "dwp-links" },
                  links.map((link, i) =>
                    h(
                      "a",
                      {
                        key: i,
                        className: "dwp-link",
                        href: link.url,
                        target: "_blank",
                        rel: "noreferrer noopener",
                      },
                      h(Icon, { name: link.label === "PDF" ? "download" : "link", size: 12 }),
                      link.label || "链接",
                    ),
                  ),
                )
              : null,
          )
        : null,
      showExport
        ? h(
            "div",
            { className: "dwp-export" },
            h("span", { className: "dwp-export-label" }, "导出引用"),
            [
              ["GB/T 7714", "gb"],
              ["BibTeX", "bib"],
              ["RIS", "ris"],
              ["APA", "apa"],
            ].map(([label, style]) =>
              h(
                "button",
                {
                  key: style,
                  type: "button",
                  className: "dwp-export-btn",
                  "data-copied": copiedStyle === style ? "1" : "0",
                  onClick: async () => {
                    const ok = await copyText(formatCitation(item, style));
                    if (!ok) return;
                    setCopiedStyle(style);
                    setTimeout(() => setCopiedStyle(""), 1400);
                  },
                },
                copiedStyle === style ? "已复制" : label,
              ),
            ),
          )
        : null,
    );
  }

  function DigestPanel({ digest, onClose, style, pageMode }) {
    const { state, selectIssue, refresh } = digest;
    const issue = state.issue;
    const index = state.index;
    const domain = digest.domain;
    const domainList = digest.domains || [];
    const domainInfo = digest.domainInfo || null;
    const domainLabelText = domainInfo ? domainInfo.short || domainInfo.label || "" : "";
    const sectionTitles = {
      field: (issue && issue.sections && issue.sections.field && issue.sections.field.title) || TAGS.field.label,
      algo: (issue && issue.sections && issue.sections.algo && issue.sections.algo.title) || TAGS.algo.label,
    };
    const [tab, setTab] = react.useState(() => {
      const preset = previewFlag("__DWP_PREVIEW_TAB__", null);
      if (preset === "field" || preset === "algo") return preset;
      try {
        return window.localStorage.getItem("dwp:tab") || "field";
      } catch {
        return "field";
      }
    });
    const [query, setQuery] = react.useState("");
    const [toast, setToast] = react.useState("");
    const [requesting, setRequesting] = react.useState(false);
    // ── 新建 / 编辑方向（表单状态；null 表示没打开）──────────────────────
    const [domainForm, setDomainForm] = react.useState(null);
    const [domainBusy, setDomainBusy] = react.useState(false);
    const [domainConfirmDelete, setDomainConfirmDelete] = react.useState(false);
    const domainWritable = (digest.domainApiVersion || 0) >= 3;

    // 弹窗打开时 Esc 先关弹窗（不让它连带关掉整个面板）
    react.useEffect(() => {
      if (!domainForm) return undefined;
      const onKey = (event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        if (!domainBusy) setDomainForm(null);
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }, [domainForm, domainBusy]);

    // ── 文献检索（像谷歌学术那样按关键词现搜）────────────────────────────
    const initialParams = (() => {
      try {
        return new URLSearchParams(typeof location !== "undefined" ? location.search : "");
      } catch {
        return new URLSearchParams();
      }
    })();
    const [searchView, setSearchView] = react.useState(initialParams.get("view") === "search");
    const [sq, setSq] = react.useState(initialParams.get("q") || "");
    const [results, setResults] = react.useState(null);
    const [searchMeta, setSearchMeta] = react.useState(null);
    const [searchErr, setSearchErr] = react.useState("");
    const [searching, setSearching] = react.useState(false);
    const [searchOffset, setSearchOffset] = react.useState(0);
    const [searchSummary, setSearchSummary] = react.useState("");
    const [rerolling, setRerolling] = react.useState(false);
    const [favs, setFavs] = react.useState(() => readFavs());

    // 后端能力探测：
    // · 单文件版（数据内联）压根没有后端 → 相关按钮不显示
    // · 静态托管（GitHub Pages / 纯静态服务器）有页面但没接口 → 只能浏览，"换一批/检索/建方向"都关掉
    // · 插件/本地版后端版本旧（没有 /api/health）→ 按钮照旧可点，底部提示重启，点了给看得懂的报错
    const backend = react.useMemo(() => hasBackend(), []);
    const isStaticHost = react.useMemo(() => Boolean(staticBase()), []);
    const [caps, setCaps] = react.useState(null); // null=探测中 true=可用 false=探测失败
    react.useEffect(() => {
      if (!backend) return undefined;
      let alive = true;
      callApi(`${API_BASE}/api/health`, { cache: "no-store" })
        .then(() => alive && setCaps(true))
        .catch(() => alive && setCaps(false));
      return () => {
        alive = false;
      };
    }, [backend]);
    const staticOnly = isStaticHost && caps === false; // 纯静态托管：没有后端接口
    const canMutate = backend && !staticOnly;
    const PRESETS = ["尾流控制", "风电功率预测", "数值天气预报", "雷达流场重构", "大模型 时序预测", "概率预测"];

    const toggleFav = react.useCallback((item) => {
      setFavs((prev) => {
        const next = { ...prev };
        const key = String(item.id);
        if (next[key]) delete next[key];
        else next[key] = { ...item, savedAt: Date.now() };
        writeFavs(next);
        return next;
      });
    }, []);
    const favList = Object.values(favs).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    const runSearch = react.useCallback(
      async (raw, nextOffset) => {
        const text = String(raw === undefined ? sq : raw).trim();
        if (!text) return;
        const offset = Number(nextOffset) || 0;
        setSq(text);
        setSearchOffset(offset);
        setSearching(true);
        setSearchErr("");
        const path = `${API_BASE}/api/search?q=${encodeURIComponent(text)}&limit=10&offset=${offset}${
          domain ? "&domain=" + encodeURIComponent(domain) : ""
        }`;
        try {
          const data = await callApi(path, { cache: "no-store" });
          setResults(data.items || []);
          setSearchMeta(data.meta || null);
          setSearchSummary(typeof data.summary === "string" ? data.summary : "");
          if (data.meta && data.meta.error) setSearchErr(data.meta.error);
        } catch (error) {
          setResults([]);
          setSearchMeta(null);
          setSearchSummary("");
          setSearchErr(String((error && error.message) || error));
        } finally {
          setSearching(false);
        }
      },
      [sq],
    );

    // ?view=search&q=xxx 直接进检索并跑一次（方便分享链接/截图）
    react.useEffect(() => {
      if (searchView && sq && results === null) runSearch(sq);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const pickTab = (next) => {
      setTab(next);
      try {
        window.localStorage.setItem("dwp:tab", next);
      } catch {
        /* ignore */
      }
    };

    const sections = (issue && issue.sections) || {};
    const fieldItems = (sections.field && sections.field.items) || [];
    const algoItems = (sections.algo && sections.algo.items) || [];
    const byRank = (a, b) => {
      const rankA = typeof a.rank === "number" ? a.rank : 99;
      const rankB = typeof b.rank === "number" ? b.rank : 99;
      if (rankA !== rankB) return rankA - rankB;
      return String(b.date || "").localeCompare(String(a.date || ""));
    };
    const baseItems = tab === "fav" ? favList : tab === "field" ? fieldItems : algoItems;
    const items = tab === "fav" ? baseItems : [...baseItems].sort(byRank);
    const allItems = fieldItems.concat(algoItems);
    const figureCount = allItems.reduce(
      (sum, entry) => sum + ((entry.figures && entry.figures.length) || 0),
      0,
    );

    const filtered = react.useMemo(() => {
      const needle = query.trim().toLowerCase();
      if (!needle) return items;
      return items.filter((item) => {
        const haystack = [
          item.title,
          item.titleZh,
          item.venue,
          item.venueShort,
          (item.keywords || []).join(" "),
          (item.tags || []).join(" "),
          item.abstractZh,
          item.abstractEn,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      });
    }, [items, query]);

    const issues = (index && index.issues) || [];
    const coverage = (index && index.coverage) || {};
    const modeLabel = issue && issue.mode === "backfill" ? "回溯扫描" : "本周新增";

    const requestUpdate = async () => {
      setRequesting(true);
      try {
        const body = await callApi(API_BASE + "/api/update-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: "from top-bar dropdown" }),
        });
        setToast(body && body.hint ? body.hint : "已记录更新请求");
      } catch {
        setToast("记录失败：请直接在对话里说「更新文献周报」");
      }
      setRequesting(false);
      setTimeout(() => setToast(""), 4200);
    };

    // 删除某一期（换一批里没价值的批次可以直接删掉）
    const removeIssue = async (entry) => {
      const label = entry.label || entry.id;
      try {
        if (typeof window !== "undefined" && typeof window.confirm === "function") {
          if (!window.confirm(`确定删除「${label}」？文件和索引会一起删掉，不能恢复。`)) return;
        }
      } catch {
        /* confirm 不可用就直接删 */
      }
      const path = `${API_BASE}/api/issue-delete`;
      setToast("正在删除…");
      try {
        const data = await callApi(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: entry.id, domain }),
        });
        issueCache.clear();
        if (digest.reload) await digest.reload(data.current);
        setToast(`已删除 ${entry.id}（剩 ${data.remaining} 期）`);
      } catch (error) {
        setToast("删除失败：" + String((error && error.message) || error));
      }
      setTimeout(() => setToast(""), 4200);
    };

    // 新建 / 编辑 / 删除方向：关键词与期刊都用"芯片 + 搜索补全"的方式填，
    // 避免手打刊名出错，也让「编辑」能回填已保存的内容（不然像没保存）。
    const catalog = digest.catalog || { journals: [], suggest: { queries: [], keywords: [] } };
    const emptyForm = {
      mode: "create",
      id: "",
      label: "",
      short: "",
      queries: [],
      journals: [],
      fieldTitle: "",
      setDefault: false,
      queryInput: "",
      journalInput: "",
      loading: false,
      hint: "关键词必填。期刊可以搜（带分区/IF），也可以在输入框里回车添加自定义刊名；★ 标记的是领域旗舰刊。",
    };

    const openDomainForm = async (mode) => {
      setDomainConfirmDelete(false);
      if (mode === "edit" && domainInfo) {
        const base = {
          ...emptyForm,
          mode: "edit",
          id: domainInfo.id,
          label: domainInfo.label || "",
          short: domainInfo.short || "",
          fieldTitle: (domainInfo.sections && domainInfo.sections.field) || "",
          setDefault: domainInfo.id === digest.defaultDomain,
          loading: true,
          hint: "这里显示的是已保存的配置，改完点「保存修改」；留空不会清空已有内容。",
        };
        setDomainForm(base);
        try {
          const detail = await loadDomainDetail(domainInfo.id);
          if (detail) {
            const flagships = new Set((detail.flagship || []).map((name) => String(name).toLowerCase()));
            setDomainForm((prev) =>
              !prev || prev.mode !== "edit" || prev.id !== domainInfo.id
                ? prev
                : {
                    ...prev,
                    loading: false,
                    queries: Array.isArray(detail.queries) ? detail.queries : [],
                    journals: (detail.journals || []).map((journal) => ({
                      name: journal.name,
                      issn: journal.issn || "",
                      flagship: flagships.has(String(journal.name).toLowerCase()),
                    })),
                    fieldTitle: (detail.sections && detail.sections.field) || prev.fieldTitle,
                  },
            );
          } else {
            setDomainForm((prev) => (prev ? { ...prev, loading: false } : prev));
          }
        } catch {
          setDomainForm((prev) => (prev ? { ...prev, loading: false } : prev));
        }
        return;
      }
      setDomainForm({ ...emptyForm });
    };

    const addQuery = (value) => {
      const text = String(value || "").trim().replace(/^["']|["']$/g, "");
      if (!text) return;
      setDomainForm((prev) => {
        if (!prev) return prev;
        if (prev.queries.some((item) => item.toLowerCase() === text.toLowerCase())) return { ...prev, queryInput: "" };
        return { ...prev, queries: [...prev.queries, text].slice(0, 12), queryInput: "" };
      });
    };
    const removeQuery = (value) => {
      setDomainForm((prev) => (prev ? { ...prev, queries: prev.queries.filter((item) => item !== value) } : prev));
    };
    const addJournal = (journal) => {
      const name = String((journal && journal.name) || "").trim();
      if (!name) return;
      setDomainForm((prev) => {
        if (!prev) return prev;
        if (prev.journals.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
          return { ...prev, journalInput: "" };
        }
        return {
          ...prev,
          journals: [...prev.journals, { name, issn: journal.issn || "", flagship: false }],
          journalInput: "",
        };
      });
    };
    const removeJournal = (name) => {
      setDomainForm((prev) => (prev ? { ...prev, journals: prev.journals.filter((item) => item.name !== name) } : prev));
    };
    const toggleFlagship = (name) => {
      setDomainForm((prev) =>
        prev
          ? {
              ...prev,
              journals: prev.journals.map((item) =>
                item.name === name ? { ...item, flagship: !item.flagship } : item,
              ),
            }
          : prev,
      );
    };

    const submitDomainForm = async () => {
      if (!domainForm || domainBusy) return;
      const queryList = domainForm.queries.map((item) => String(item).trim()).filter(Boolean);
      const journalList = domainForm.journals
        .filter((item) => String(item.name || "").trim())
        .map((item) => ({ name: String(item.name).trim(), ...(item.issn ? { issn: item.issn } : {}) }));
      const flagshipList = domainForm.journals.filter((item) => item.flagship).map((item) => item.name);
      const payload =
        domainForm.mode === "create"
          ? {
              action: "create",
              label: domainForm.label.trim(),
              short: domainForm.short.trim(),
              queries: queryList,
              journals: journalList,
              flagship: flagshipList,
              sections: domainForm.fieldTitle.trim() ? { field: domainForm.fieldTitle.trim() } : undefined,
              setDefault: Boolean(domainForm.setDefault),
            }
          : {
              action: "update",
              id: domainForm.id,
              label: domainForm.label.trim() || undefined,
              short: domainForm.short.trim() || undefined,
              ...(queryList.length ? { queries: queryList } : {}),
              ...(journalList.length ? { journals: journalList } : {}),
              flagship: flagshipList,
              setDefault: Boolean(domainForm.setDefault),
            };
      if (!payload.label) {
        setToast("方向名称不能为空");
        setTimeout(() => setToast(""), 2600);
        return;
      }
      if (payload.action === "create" && !queryList.length) {
        setToast("至少加一个检索关键词（在关键词框里输入后回车或点建议项）");
        setTimeout(() => setToast(""), 3200);
        return;
      }
      setDomainBusy(true);
      try {
        const data = await saveDomain(payload);
        const list = await digest.reloadDomains();
        setDomainForm(null);
        const target = (data.entry && data.entry.id) || domainForm.id;
        if (target) await digest.switchDomain(target);
        const missing = Array.isArray(data.missingIssn) ? data.missingIssn : [];
        const note = missing.length ? `；没查到 ISSN：${missing.slice(0, 2).join("、")}` : "";
        setToast(
          (payload.action === "create" ? "已创建方向：" : "已更新方向：") +
            (data.entry ? data.entry.label : payload.label) +
            `（关键词 ${queryList.length} · 期刊 ${journalList.length} · 旗舰刊 ${flagshipList.length}）${note}`,
        );
      } catch (error) {
        setToast("保存失败：" + String((error && error.message) || error));
      } finally {
        setDomainBusy(false);
        setTimeout(() => setToast(""), 6500);
      }
    };

    const removeDomain = async () => {
      if (!domainForm || domainBusy || domainForm.mode !== "edit") return;
      const label = domainForm.label || domainForm.id;
      // 不用 window.confirm：嵌在别的界面里时它可能被静默拦掉，点了像没反应。
      if (!domainConfirmDelete) {
        setDomainConfirmDelete(true);
        setToast(`再点一次「确认删除」就会删掉「${label}」及其所有期号（不可恢复）`);
        setTimeout(() => setToast(""), 5000);
        return;
      }
      setDomainBusy(true);
      try {
        const data = await saveDomain({ action: "delete", id: domainForm.id });
        await digest.reloadDomains();
        setDomainForm(null);
        setDomainConfirmDelete(false);
        await digest.switchDomain(digest.defaultDomain);
        setToast(
          `已删除方向「${label}」${data.removed === false ? "（注册表已删，目录未清干净）" : ""}，已切回默认方向`,
        );
      } catch (error) {
        setToast("删除方向失败：" + String((error && error.message) || error));
      } finally {
        setDomainBusy(false);
        setTimeout(() => setToast(""), 5000);
      }
    };

    // 换一批：让后端按当前方向现场再抓一批，写成新的一期（旧的留在历史期号里）
    const reroll = async () => {
      if (rerolling) return;
      setRerolling(true);
      setToast("正在按当前方向再抓一批，约 20-40 秒…");
      const path = `${API_BASE}/api/reroll`;
      try {
        const data = await callApi(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: tab === "algo" ? "algo" : "field", domain }),
        });
        issueCache.clear();
        if (digest.reload) await digest.reload(data.issueId);
        const tierText = data.tiers
          ? Object.entries(data.tiers)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map(([tier, n]) => `${tier} ${n}`)
              .join(" · ")
          : "";
        const poolText = data.pool && typeof data.pool.remaining === "number" ? `，池内还剩 ${data.pool.remaining} 条同档候选` : "";
        setToast(`已生成新的一批（${data.count} 篇${tierText ? "：" + tierText : ""}${poolText}）`);
      } catch (error) {
        setToast("换一批失败：" + String((error && error.message) || error));
      } finally {
        setRerolling(false);
        setTimeout(() => setToast(""), 5000);
      }
    };

    const header = h(
      "div",
      { className: "dwp-head" },
      h(
        "div",
        { className: "dwp-head-main" },
        h(
          "div",
          { className: "dwp-title" },
          pageMode
            ? h("span", { className: "dwp-logo" }, h(Icon, { name: "book", size: 15, stroke: 2.2 }))
            : h(Icon, { name: "spark", size: 15 }),
          (index && index.title) || "每周论文速递",
          issue && issue.week
            ? h(
                "span",
                {
                  className: "dwp-badge",
                  style: { background: TAGS[tab].soft, color: TAGS[tab].accent, borderColor: "transparent" },
                },
                modeLabel,
              )
            : null,
        ),
        h(
          "div",
          { className: "dwp-sub" },
          issue
            ? h("span", null, (index && index.subtitle) || "功率预测 · 气象预报 · 雷达流场重构")
            : h("span", null, state.status === "ready" ? domainLabelText || "还没有数据" : "正在加载…"),
          issue && allItems.length ? h("span", { className: "dwp-sub-sep" }) : null,
          issue && allItems.length ? h("span", null, "本期 " + String(allItems.length) + " 篇") : null,
          issue && figureCount ? h("span", { className: "dwp-sub-sep" }) : null,
          issue && figureCount ? h("span", null, "配图 " + String(figureCount) + " 张") : null,
          issue && issue.range ? h("span", { className: "dwp-sub-sep" }) : null,
          issue && issue.range ? h("span", null, issue.range[0] + " → " + issue.range[1]) : null,
          issue && issue.generatedAt ? h("span", { className: "dwp-sub-sep" }) : null,
          issue && issue.generatedAt
            ? h("span", null, "更新于 " + fmtDate(issue.generatedAt) + " " + String(issue.generatedAt).slice(11, 16))
            : null,
        ),
        h(
          "div",
          { className: "dwp-domainrow" },
          domainList.length
            ? h(
                "label",
                { className: "dwp-domain", title: "切换研究方向：期号、检索、换一批都会跟着切" },
                h("span", { className: "dwp-domain-k" }, "方向"),
                h(
                  "select",
                  {
                    className: "dwp-domain-sel",
                    value: domain || "",
                    onChange: (event) => digest.switchDomain(event.target.value),
                  },
                  domainList.map((entry) =>
                    h(
                      "option",
                      { key: entry.id, value: entry.id },
                      (entry.label || entry.short || entry.id) +
                        (entry.id === digest.defaultDomain ? "（默认）" : ""),
                    ),
                  ),
                ),
                h(Icon, { name: "chev", size: 11 }),
              )
            : null,
          canMutate
            ? h(
                "button",
                {
                  type: "button",
                  className: "dwp-ghost dwp-domain-new",
                  title: "新建一个研究方向：自己填关键词和优先期刊",
                  onClick: () => openDomainForm("create"),
                },
                "＋ 新建方向",
              )
            : null,
          canMutate && domainInfo && domain !== digest.defaultDomain
            ? [
                h(
                  "button",
                  {
                    key: "edit",
                    type: "button",
                    className: "dwp-ghost dwp-domain-edit",
                    title: "改这个方向的关键词 / 优先期刊 / 旗舰刊",
                    onClick: () => openDomainForm("edit"),
                  },
                  "编辑",
                ),
              ]
            : null,
        ),
      ),
      h(
        "div",
        { className: "dwp-head-acts" },
        issues.length > 1
          ? h(
              "select",
              {
                className: "dwp-select",
                value: state.issueId || "",
                onChange: (event) => selectIssue(event.target.value),
                title: "切换历史期号",
              },
              issues.map((entry) =>
                h(
                  "option",
                  { key: entry.id, value: entry.id },
                  (entry.label || entry.id) + (entry.id === (index && index.current) ? "（最新）" : ""),
                ),
              ),
            )
          : null,
        h(
          "button",
          {
            type: "button",
            className: "dwp-iconbtn",
            title: "刷新数据",
            disabled: state.refreshing,
            onClick: () => refresh(),
          },
          h(Icon, { name: "refresh", size: 13 }),
        ),
        pageMode
          ? null
          : h(
              "button",
              { type: "button", className: "dwp-iconbtn", title: "关闭 (Esc)", onClick: onClose },
              h(Icon, { name: "close", size: 13 }),
            ),
      ),
    );

    const bar = h(
      "div",
      { className: "dwp-bar" },
      h(
        "button",
        { type: "button", className: "dwp-tab", "data-on": tab === "field" ? "1" : "0", onClick: () => pickTab("field") },
        h("span", { className: "dwp-tab-dot", style: { background: TAGS.field.accent } }),
        sectionTitles.field,
        h("span", { className: "dwp-tab-n" }, String(fieldItems.length)),
      ),
      h(
        "button",
        { type: "button", className: "dwp-tab", "data-on": tab === "algo" ? "1" : "0", onClick: () => pickTab("algo") },
        h("span", { className: "dwp-tab-dot", style: { background: TAGS.algo.accent } }),
        sectionTitles.algo,
        h("span", { className: "dwp-tab-n" }, String(algoItems.length)),
      ),
      h(
        "button",
        {
          type: "button",
          className: "dwp-tab dwp-tab-fav",
          "data-on": tab === "fav" ? "1" : "0",
          onClick: () => {
            setSearchView(false);
            pickTab("fav");
          },
          title: "收藏夹（存在本机浏览器里）",
        },
        h(Icon, { name: "star", size: 12 }),
        "收藏",
        h("span", { className: "dwp-tab-n" }, String(favList.length)),
      ),
      h("span", { className: "dwp-spacer" }),
      !searchView && tab !== "fav" && canMutate
        ? h(
            "button",
            {
              type: "button",
              className: "dwp-ghost dwp-reroll",
              "data-busy": rerolling ? "1" : "0",
              onClick: () => reroll(),
              title: "按当前方向再抓一批（当前这批会保留成历史期号）",
            },
            h(Icon, { name: "refresh", size: 12 }),
            rerolling ? "抓取中…" : "换一批",
          )
        : null,
      h(
        "label",
        { className: "dwp-search" },
        h(Icon, { name: "search", size: 12 }),
        h("input", {
          value: query,
          placeholder: "过滤本期",
          onChange: (event) => setQuery(event.target.value),
        }),
      ),
      canMutate || searchView
        ? h(
            "button",
            {
              type: "button",
              className: "dwp-tab dwp-tab-search",
              "data-on": searchView ? "1" : "0",
              onClick: () => {
                const next = !searchView;
                setSearchView(next);
                if (next && results === null && !searching) runSearch(sq || "");
              },
              title: "按关键词现场检索文献（Scopus + arXiv）",
            },
            h(Icon, { name: "search", size: 13 }),
            searchView ? "返回本期" : "文献检索",
          )
        : null,
    );

    // 本期概述（默认折叠）
    const sectionData = tab === "fav" ? {} : (issue && issue.sections && issue.sections[tab]) || {};
    const sectionSummary = typeof sectionData.summary === "string" ? sectionData.summary.trim() : "";
    const [summaryOpen, setSummaryOpen] = react.useState(() => {
      if (initialParams.get("summary") === "1") return true;
      try {
        return window.localStorage.getItem("dwp:summary") === "1";
      } catch {
        return false;
      }
    });
    const toggleSummary = () => {
      setSummaryOpen((prev) => {
        const next = !prev;
        try {
          window.localStorage.setItem("dwp:summary", next ? "1" : "0");
        } catch {
          /* ignore */
        }
        return next;
      });
    };
    const summaryBlock = sectionSummary
      ? h(
          "div",
          { className: "dwp-summary", "data-open": summaryOpen ? "1" : "0" },
          h(
            "button",
            { type: "button", className: "dwp-summary-head", onClick: toggleSummary },
            h("span", { className: "dwp-summary-ico" }, h(Icon, { name: "spark", size: 13 })),
            h("span", null, tab === "field" ? sectionTitles.field + " · 本期概述" : sectionTitles.algo + " · 本期概述"),
            h("span", { className: "dwp-summary-count" }, String(items.length) + " 篇"),
            h("span", { className: "dwp-summary-chev" }, h(Icon, { name: "chev", size: 12, stroke: 2.4 })),
          ),
          summaryOpen
            ? h(
                "div",
                { className: "dwp-summary-body" },
                h("p", { className: "dwp-summary-text" }, sectionSummary),
                items.length
                  ? h(
                      "div",
                      { className: "dwp-refs" },
                      h("div", { className: "dwp-refs-h" }, `本期参考文献（${items.length} 篇）`),
                      h(
                        "ol",
                        null,
                        items.map((entry) =>
                          h("li", { key: entry.id, title: entry.title || "" }, entry.citation || entry.title || ""),
                        ),
                      ),
                    )
                  : null,
              )
            : null,
        )
      : null;

    // ── 检索视图的正文 ──────────────────────────────────────────────────
    const searchBody = h(
      "div",
      { className: "dwp-body dwp-searchbody" },
      h(
        "div",
        { className: "dwp-searchbox" },
        h("input", {
          value: sq,
          placeholder: "输入关键词检索（中英文都行），例如 尾流控制 / wake steering / 大模型 时序预测",
          onChange: (event) => setSq(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter") runSearch();
          },
        }),
        h(
          "button",
          { type: "button", className: "dwp-searchgo", disabled: searching, onClick: () => runSearch() },
          searching ? "检索中…" : "检索",
        ),
      ),
      h(
        "div",
        { className: "dwp-presets" },
        PRESETS.map((text) =>
          h(
            "button",
            { key: text, type: "button", className: "dwp-chip", onClick: () => runSearch(text) },
            text,
          ),
        ),
      ),
      searchMeta
        ? h(
            "div",
            { className: "dwp-searchmeta" },
            h("span", null, `「${searchMeta.query}」`),
            h("span", null, "→ " + (searchMeta.queryEn || "")),
            h("span", null, searchMeta.total + " 条"),
            searchMeta.poolSize ? h("span", null, `候选池 ${searchMeta.poolSize} 条`) : null,
            searchMeta.tiers
              ? h(
                  "span",
                  { className: "dwp-tierrow" },
                  Object.entries(searchMeta.tiers)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([tier, count]) => h("i", { key: tier }, `${tier} ${count}`)),
                )
              : null,
            h("span", null, searchMeta.ms + " ms"),
            h("span", null, "来源 " + (searchMeta.sources || []).join(" + ")),
            results && results.length
              ? h(
                  "span",
                  { className: "dwp-searchmeta-acts" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dwp-ghost",
                      onClick: () => runSearch(sq, searchMeta.nextOffset || searchOffset + 10),
                      title: "同档候选里看下一页（结果按期刊等级排序，不是随机换）",
                    },
                    h(Icon, { name: "refresh", size: 12 }),
                    "换一批",
                  ),
                  h(
                    "button",
                    { type: "button", className: "dwp-ghost", onClick: () => downloadFile("weekly-paper.bib", results.map((it) => formatCitation(it, "bib")).join("\n\n"), "text/plain;charset=utf-8") },
                    "导出全部 BibTeX",
                  ),
                  h(
                    "button",
                    { type: "button", className: "dwp-ghost", onClick: () => downloadFile("weekly-paper.ris", results.map((it) => formatCitation(it, "ris")).join("\n\n"), "application/x-research-info-systems") },
                    "导出全部 RIS",
                  ),
                )
              : null,
          )
        : null,
      searchSummary
        ? h(
            "div",
            { className: "dwp-summary", "data-open": summaryOpen ? "1" : "0" },
            h(
              "button",
              { type: "button", className: "dwp-summary-head", onClick: toggleSummary },
              h("span", { className: "dwp-summary-ico" }, h(Icon, { name: "spark", size: 13 })),
              h("span", null, "检索结果 · 概述"),
              h("span", { className: "dwp-summary-count" }, (results ? results.length : 0) + " 篇"),
              h("span", { className: "dwp-summary-chev" }, h(Icon, { name: "chev", size: 12, stroke: 2.4 })),
            ),
            summaryOpen
              ? h(
                  "div",
                  { className: "dwp-summary-body" },
                  h("p", { className: "dwp-summary-text" }, searchSummary),
                  results && results.length
                    ? h(
                        "div",
                        { className: "dwp-refs" },
                        h("div", { className: "dwp-refs-h" }, `参考文献（${results.length} 篇）`),
                        h(
                          "ol",
                          null,
                          results.map((entry) =>
                            h("li", { key: entry.id }, entry.citation || entry.title || ""),
                          ),
                        ),
                      )
                    : null,
                )
              : null,
          )
        : null,
      searching
        ? h("div", null, h("div", { className: "dwp-skel" }), h("div", { className: "dwp-skel" }))
        : searchErr
          ? h(
              "div",
              { className: "dwp-empty" },
              h("b", null, /翻成英文/.test(searchErr) ? "这个词没法直接搜" : "现场检索没跑起来"),
              h("span", null, searchErr),
              h(
                "span",
                { style: { fontSize: 12 } },
                /翻成英文/.test(searchErr)
                  ? "可以直接用英文术语，例如 wake steering / radar wind measurement / time series forecasting。"
                  : "换一批、检索都需要后端：插件版重启 dsh web，本地版双击 start.cmd；纯静态托管不支持。",
              ),
            )
          : results === null
            ? h(
                "div",
                { className: "dwp-empty" },
                h("b", null, "输入关键词开始检索"),
                h("span", null, "先按期刊等级、再按相关度排：优先出你关注的 1 区刊、顶刊与 CCF-A 会议。"),
              )
            : results.length === 0
              ? h(
                  "div",
                  { className: "dwp-empty" },
                  h("b", null, "没有找到相关文献"),
                  h("span", null, "换个更通用的词试试，比如把“尾流协同控制”改成“尾流控制”；也可以直接用英文术语。"),
                )
              : results.map((item) =>
                  h(ItemCard, {
                    key: item.id,
                    item,
                    accent: (TAGS[item.section] || TAGS.field).accent,
                    showExport: true,
                    isFav: Boolean(favs[String(item.id)]),
                    onToggleFav: toggleFav,
                  }),
                ),
    );

    let body;
    if (searchView) {
      body = searchBody;
    } else if (state.status === "loading") {
      body = h(
        "div",
        { className: "dwp-body" },
        h("div", { className: "dwp-skel" }),
        h("div", { className: "dwp-skel" }),
        h("div", { className: "dwp-skel" }),
      );
    } else if (state.status === "error") {
      body = h(
        "div",
        { className: "dwp-body" },
        h(
          "div",
          { className: "dwp-empty" },
          h("b", null, "暂时读不到周报数据"),
          h("span", null, state.error || "未知错误"),
          h("span", { style: { fontSize: 11 } }, "数据目录应与插件同目录：dsh-weekly-paper/data"),
        ),
      );
    } else if (!issue) {
      // 新方向还没有任何一期：给一次明确的"生成第一批"入口
      body = h(
        "div",
        { className: "dwp-body" },
        h(
          "div",
          { className: "dwp-empty" },
          h("b", null, `「${domainInfo ? domainInfo.label : domainLabelText || "这个方向"}」还没有文献`),
          h(
            "span",
            null,
            canMutate
              ? "点上面的「换一批」就会按这个方向抓第一批（约 30 秒）。"
              : "这个方向还没有数据，切回默认方向看看。",
          ),
        ),
      );
    } else if (!items.length) {
      body = h(
        "div",
        { className: "dwp-body" },
        summaryBlock,
        h(
          "div",
          { className: "dwp-empty" },
          h(
            "b",
            null,
            tab === "fav"
              ? "收藏夹是空的"
              : tab === "field"
                ? `本期${sectionTitles.field}还没有条目`
                : `本期${sectionTitles.algo}还没有条目`,
          ),
          h(
            "span",
            null,
            tab === "fav"
              ? "点任意条目右上角的「收藏」，之后就能在这里集中看。"
              : `点上面的「换一批」按「${domainLabelText || "当前方向"}」抓一批，或直接说一句「更新文献速报」。`,
          ),
        ),
      );
    } else {
      body = h(
        "div",
        { className: "dwp-body" },
        summaryBlock,
        filtered.length === 0
          ? h("div", { className: "dwp-empty" }, h("b", null, "没有匹配的条目"), h("span", null, "换个关键词试试"))
          : filtered.map((item) =>
              h(ItemCard, {
                key: item.id,
                item,
                accent: (TAGS[item.section] || TAGS.field).accent,
                isFav: Boolean(favs[String(item.id)]),
                onToggleFav: toggleFav,
              }),
            ),
      );
    }

    const foot = h(
      "div",
      { className: "dwp-foot" },
      h(Icon, { name: "history", size: 12 }),
      coverage && coverage.backfillFrom
        ? h("span", null, "回溯覆盖 ", h("b", null, coverage.backfillFrom), " 至今 · 共 ", h("b", null, String(coverage.totalItems || "")), " 篇")
        : h("span", null, "每周自动汇总 · 历史期号可回看"),
      issues.length > 1 ? h("span", { className: "dwp-sub-sep", style: { margin: "0 2px" } }) : null,
      issues.length > 1
        ? issues.slice(0, 8).map((entry) =>
            h(
              "span",
              { key: entry.id, className: "dwp-chip-wrap" },
              h(
                "button",
                {
                  type: "button",
                  className: "dwp-chip",
                  "data-on": entry.id === state.issueId ? "1" : "0",
                  style: { "--dwp-accent": TAGS[tab].accent },
                  title: (entry.label || entry.id) + "（点击回看）",
                  onClick: () => selectIssue(entry.id),
                },
                String(entry.id).replace(/^\d{4}-/, ""),
              ),
              canMutate
                ? h(
                    "button",
                    {
                      type: "button",
                      className: "dwp-chip-x",
                      title: "删除这一期（文件和索引一起删，不能恢复）",
                      onClick: (event) => {
                        event.stopPropagation();
                        removeIssue(entry);
                      },
                    },
                    "×",
                  )
                : null,
            ),
          )
        : null,
      caps === false
        ? h(
            "span",
            {
              className: "dwp-warn",
              title: staticOnly ? "纯静态托管没有后端接口" : "换一批、删期号、现场检索都需要后端服务",
            },
            staticOnly
              ? "当前是静态托管（GitHub Pages 等）：只能浏览；换一批 / 检索 / 新建方向要用本地版或局域网版"
              : "后端没响应能力探测：换一批 / 删除 / 检索可能失败，重启 dsh web 或重新双击 start.cmd 即可恢复",
          )
        : null,
      h("span", { className: "dwp-spacer", style: { flex: 1 } }),
      pageMode
        ? h(
            "button",
            {
              type: "button",
              className: "dwp-ghost",
              "data-busy": state.refreshing ? "1" : "0",
              onClick: () => refresh(),
              title: "重新读取数据",
            },
            h(Icon, { name: "refresh", size: 12 }),
            "刷新",
          )
        : h(
            "button",
            {
              type: "button",
              className: "dwp-ghost",
              "data-busy": requesting ? "1" : "0",
              onClick: requestUpdate,
              title: "记录一次更新请求，助手下一轮会处理",
            },
            h(Icon, { name: "refresh", size: 12 }),
            "请求更新",
          ),
    );

    // ── 新建 / 编辑方向：大弹窗（插件端面板只有 500 多像素，内联表单太挤）──
    const domainFormBlock = domainForm
      ? h(
          "div",
          {
            className: "dwp-modal",
            onMouseDown: (event) => event.stopPropagation(),
            onClick: (event) => {
              if (event.target === event.currentTarget && !domainBusy) setDomainForm(null);
            },
          },
          h(
            "div",
            { className: "dwp-modal-card", role: "dialog", "aria-modal": "true" },
            h(
              "div",
              { className: "dwp-modal-head" },
              h("b", null, domainForm.mode === "create" ? "新建研究方向" : `编辑方向：${domainForm.label || domainForm.id}`),
              h(
                "button",
                {
                  type: "button",
                  className: "dwp-iconbtn",
                  title: "关闭 (Esc)",
                  onClick: () => setDomainForm(null),
                },
                h(Icon, { name: "close", size: 13 }),
              ),
            ),
            h("div", { className: "dwp-modal-sub" }, domainForm.hint || ""),
            !domainWritable
              ? h(
                  "div",
                  { className: "dwp-modal-warn" },
                  "后端是旧版本（只会读方向，不能写）：请重启 dsh web（本地版则关掉黑窗口重新双击 start.cmd）后再试。",
                )
              : null,
            h(
              "div",
              { className: "dwp-dform-grid" },
              h(
                "label",
                null,
                h("span", null, "方向名称"),
                h("input", {
                  value: domainForm.label,
                  autoFocus: true,
                  placeholder: "例如：风电场尾流与流场调控",
                  onChange: (event) => setDomainForm({ ...domainForm, label: event.target.value }),
                }),
              ),
              h(
                "label",
                null,
                h("span", null, "短名（显示用）"),
                h("input", {
                  value: domainForm.short,
                  placeholder: "例如：尾流",
                  onChange: (event) => setDomainForm({ ...domainForm, short: event.target.value }),
                }),
              ),
              // 关键词：芯片 + 建议
              h(
                "div",
                { className: "dwp-dform-wide dwp-pick" },
                h("span", { className: "dwp-pick-label" }, `检索关键词（必填，已加 ${domainForm.queries.length} 个）`),
                domainForm.queries.length
                  ? h(
                      "div",
                      { className: "dwp-pick-chips" },
                      domainForm.queries.map((query) =>
                        h(
                          "span",
                          { key: query, className: "dwp-pick-chip" },
                          query,
                          h(
                            "button",
                            {
                              type: "button",
                              className: "dwp-pick-x",
                              title: "移除",
                              onClick: () => removeQuery(query),
                            },
                            "×",
                          ),
                        ),
                      ),
                    )
                  : null,
                h(
                  "div",
                  { className: "dwp-pick-box" },
                  h("input", {
                    value: domainForm.queryInput,
                    placeholder: "输入关键词（回车加入），例如 wind farm wake / 储能调度",
                    onChange: (event) => setDomainForm({ ...domainForm, queryInput: event.target.value }),
                    onKeyDown: (event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      addQuery(domainForm.queryInput);
                    },
                  }),
                  domainForm.queryInput.trim()
                    ? h(
                        "div",
                        { className: "dwp-pick-list" },
                        h(
                          "button",
                          {
                            type: "button",
                            className: "dwp-pick-add",
                            onClick: () => addQuery(domainForm.queryInput),
                          },
                          `＋ 添加「${domainForm.queryInput.trim()}」`,
                        ),
                        pickMatches([
                          ...(catalog.suggest.queries || []),
                          ...(catalog.suggest.keywords || []),
                        ], domainForm.queryInput, domainForm.queries)
                          .slice(0, 6)
                          .map((text) =>
                            h(
                              "button",
                              { key: text, type: "button", className: "dwp-pick-item", onClick: () => addQuery(text) },
                              text,
                            ),
                          ),
                      )
                    : null,
                ),
              ),
              // 优先期刊：搜索 + 芯片 + ★ 旗舰刊
              h(
                "div",
                { className: "dwp-dform-wide dwp-pick" },
                h(
                  "span",
                  { className: "dwp-pick-label" },
                  `优先期刊（已加 ${domainForm.journals.length} 本 · 旗艦 ${domainForm.journals.filter((item) => item.flagship).length} 本）`,
                ),
                domainForm.journals.length
                  ? h(
                      "div",
                      { className: "dwp-pick-chips" },
                      domainForm.journals.map((journal) =>
                        h(
                          "span",
                          {
                            key: journal.name,
                            className: "dwp-pick-chip",
                            "data-flag": journal.flagship ? "1" : "0",
                          },
                          h(
                            "button",
                            {
                              type: "button",
                              className: "dwp-pick-star",
                              title: journal.flagship ? "取消领域旗舰刊" : "设为领域旗舰刊（排最前，标「领域顶刊」）",
                              onClick: () => toggleFlagship(journal.name),
                            },
                            journal.flagship ? "★" : "☆",
                          ),
                          h("span", { className: "dwp-pick-name" }, journal.name),
                          journal.issn ? h("span", { className: "dwp-pick-issn" }, journal.issn) : null,
                          h(
                            "button",
                            {
                              type: "button",
                              className: "dwp-pick-x",
                              title: "移除",
                              onClick: () => removeJournal(journal.name),
                            },
                            "×",
                          ),
                        ),
                      ),
                    )
                  : null,
                h(
                  "div",
                  { className: "dwp-pick-box" },
                  h("input", {
                    value: domainForm.journalInput,
                    placeholder: "搜期刊（刊名或 ISSN），回车把输入当作自定义刊名加入",
                    onChange: (event) => setDomainForm({ ...domainForm, journalInput: event.target.value }),
                    onKeyDown: (event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      const text = domainForm.journalInput.trim();
                      if (!text) return;
                      const exact = (catalog.journals || []).find(
                        (journal) => String(journal.name).toLowerCase() === text.toLowerCase(),
                      );
                      addJournal(exact || { name: text });
                    },
                  }),
                  domainForm.journalInput.trim()
                    ? h(
                        "div",
                        { className: "dwp-pick-list" },
                        pickMatches(
                          (catalog.journals || []).map((journal) => journal.name),
                          domainForm.journalInput,
                          domainForm.journals.map((item) => item.name),
                          true,
                        )
                          .slice(0, 8)
                          .map((name) => {
                            const journal = (catalog.journals || []).find((item) => item.name === name) || { name }
                            const tags = [
                              journal.zone,
                              journal.quartile,
                              typeof journal.iff === "number" ? `IF ${journal.iff}` : "",
                            ].filter(Boolean)
                            return h(
                              "button",
                              {
                                key: name,
                                type: "button",
                                className: "dwp-pick-item",
                                onClick: () => addJournal(journal),
                              },
                              h("span", { className: "dwp-pick-item-name" }, name),
                              journal.issn ? h("em", null, journal.issn) : null,
                              tags.length ? h("i", null, tags.join(" · ")) : null,
                            )
                          }),
                        (catalog.journals || []).some(
                          (journal) =>
                            String(journal.name).toLowerCase() === domainForm.journalInput.trim().toLowerCase(),
                        )
                          ? null
                          : h(
                              "button",
                              {
                                type: "button",
                                className: "dwp-pick-add",
                                onClick: () => addJournal({ name: domainForm.journalInput.trim() }),
                              },
                              `＋ 用自定义刊名「${domainForm.journalInput.trim()}」`,
                            ),
                      )
                    : null,
                ),
              ),
              h(
                "label",
                null,
                h("span", null, "专业侧栏目名（可选）"),
                h("input", {
                  value: domainForm.fieldTitle,
                  placeholder: "专业前沿 / 尾流与流场 …",
                  onChange: (event) => setDomainForm({ ...domainForm, fieldTitle: event.target.value }),
                }),
              ),
              h(
                "label",
                { className: "dwp-dform-check" },
                h("input", {
                  type: "checkbox",
                  checked: Boolean(domainForm.setDefault),
                  onChange: (event) => setDomainForm({ ...domainForm, setDefault: event.target.checked }),
                }),
                h("span", null, "把这个方向设为默认（下次打开就是这个方向）"),
              ),
            ),
            h(
              "div",
              { className: "dwp-modal-foot" },
              domainForm.mode === "edit"
                ? h(
                    "button",
                    {
                      type: "button",
                      className: domainConfirmDelete ? "dwp-ghost dwp-danger-solid" : "dwp-ghost dwp-danger",
                      onClick: () => removeDomain(),
                      disabled: domainBusy || !domainWritable,
                    },
                    domainConfirmDelete ? "确认删除（不可恢复）" : "删除这个方向",
                  )
                : null,
              domainConfirmDelete
                ? h(
                    "button",
                    { type: "button", className: "dwp-ghost", onClick: () => setDomainConfirmDelete(false) },
                    "算了",
                  )
                : null,
              h("span", { className: "dwp-spacer", style: { flex: 1 } }),
              h(
                "button",
                { type: "button", className: "dwp-ghost", onClick: () => setDomainForm(null), disabled: domainBusy },
                "取消",
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "dwp-ghost dwp-primary",
                  onClick: () => submitDomainForm(),
                  disabled: domainBusy || !domainWritable,
                },
                domainBusy ? "保存中…" : domainForm.mode === "create" ? "创建方向" : "保存修改",
              ),
            ),
          ),
        )
      : null;

    return h(
      react.Fragment,
      null,
      h(
        "div",
        {
          className: pageMode ? "dwp-panel dwp-panel-page" : "dwp-panel",
          style: pageMode ? undefined : style,
          onMouseDown: (event) => event.stopPropagation(),
        },
        header,
        bar,
        body,
        foot,
      ),
      // 弹窗必须挂到面板**外面**：.dwp-panel 有 backdrop-filter + overflow:hidden，
      // 会把 position:fixed 的子元素限制在面板里并裁掉。挂到 anchor 这一层就能真正铺满窗口。
      domainFormBlock,
      toast ? h("div", { className: "dwp-toast" }, toast) : null,
    );
  }

  function Lightbox() {
    const [state, setState] = react.useState(null);
    react.useEffect(() => {
      const handler = () => {
        const next = typeof window !== "undefined" ? window.__dwpLightbox : null;
        setState(next || null);
      };
      window.addEventListener("dwp:lightbox", handler);
      return () => window.removeEventListener("dwp:lightbox", handler);
    }, []);
    if (!state) return null;
    return h(
      "div",
      { className: "dwp-lightbox", onClick: () => setState(null) },
      h(
        "figure",
        null,
        h("img", { src: state.src, alt: state.caption || "" }),
        state.caption ? h("figcaption", null, state.caption) : null,
      ),
    );
  }

  const POS_KEY = "dwp:pos";
  const PILL_HEIGHT = 36;

  function readPos() {
    try {
      const raw = window.localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (typeof value?.x === "number" && typeof value?.y === "number") return value;
    } catch {
      /* ignore */
    }
    return null;
  }

  function writePos(pos) {
    try {
      if (pos) window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
      else window.localStorage.removeItem(POS_KEY);
    } catch {
      /* ignore */
    }
  }

  function clampPos(x, y, size) {
    const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
    const vh = typeof window === "undefined" ? 900 : window.innerHeight;
    const w = (size && size.width) || 280;
    const h = (size && size.height) || PILL_HEIGHT;
    return {
      x: Math.min(Math.max(8, x), Math.max(8, vw - w - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, vh - h - 8)),
    };
  }

  function panelGeometry(anchor, pillSize) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(1000, vw - 26);
    const maxHeight = Math.max(320, Math.min(vh * 0.76, 820));
    const pillH = pillSize.height || PILL_HEIGHT;
    const centerX = anchor.x + (pillSize.width || 280) / 2;
    const left = Math.min(Math.max(8, centerX - width / 2), Math.max(8, vw - width - 8));
    const belowTop = anchor.y + pillH + 8;
    const spaceBelow = vh - belowTop - 8;
    const spaceAbove = anchor.y - 16;
    if (spaceBelow >= 320 || spaceBelow >= spaceAbove) {
      const height = Math.min(maxHeight, Math.max(240, spaceBelow));
      return { left, top: belowTop, width, height };
    }
    const height = Math.min(maxHeight, Math.max(240, spaceAbove));
    return { left, top: Math.max(8, anchor.y - 8 - height), width, height };
  }

  function TopBar() {
    const [open, setOpen] = react.useState(() => previewFlag("__DWP_PREVIEW_OPEN__", false) === true);
    const digest = useDigest();
    const wrapRef = react.useRef(null);
    const pillRef = react.useRef(null);
    const issue = digest.state.issue;
    const [pos, setPos] = react.useState(() => readPos());
    const [dragging, setDragging] = react.useState(false);
    const dragRef = react.useRef(null);
    const suppressClick = react.useRef(false);
    const [pillSize, setPillSize] = react.useState({ width: 280, height: PILL_HEIGHT });
    const [viewport, setViewport] = react.useState(() =>
      typeof window === "undefined" ? { w: 1440, h: 900 } : { w: window.innerWidth, h: window.innerHeight },
    );
    const [seen, setSeen] = react.useState(() => {
      try {
        return window.localStorage.getItem("dwp:seen");
      } catch {
        return null;
      }
    });

    // 整页模式：直接铺满，不需要胶囊 / 下拉 / 拖动
    if (PAGE_MODE) {
      return h(
        "div",
        { className: "dwp-root dwp-page" },
        h(DigestPanel, { digest, onClose: () => {}, pageMode: true }),
        h(Lightbox, null),
      );
    }

    // 量一次胶囊尺寸（用于居中与边界钳制）
    react.useLayoutEffect(() => {
      const node = pillRef.current;
      if (!node) return;
      const measure = () => {
        const rect = node.getBoundingClientRect();
        if (rect.width && rect.height) setPillSize({ width: rect.width, height: rect.height });
      };
      measure();
      if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
      }
      return undefined;
    }, []);

    react.useEffect(() => {
      const onResize = () => {
        setViewport({ w: window.innerWidth, h: window.innerHeight });
        setPos((current) => (current ? clampPos(current.x, current.y, pillSize) : current));
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, [pillSize]);

    react.useEffect(() => {
      if (!open || !issue) return;
      const token = String(issue.generatedAt || issue.id || "");
      try {
        window.localStorage.setItem("dwp:seen", token);
      } catch {
        /* ignore */
      }
      if (token && token !== seen) setSeen(token);
    }, [open, issue, seen]);

    const hasNew = !!(issue && !open && issue.generatedAt && seen !== String(issue.generatedAt));
    const fieldCount = (issue && issue.sections && issue.sections.field && issue.sections.field.items.length) || 0;
    const algoCount = (issue && issue.sections && issue.sections.algo && issue.sections.algo.items.length) || 0;

    react.useEffect(() => {
      if (!open) return undefined;
      const onKey = (event) => {
        if (event.key === "Escape") setOpen(false);
      };
      const onDown = (event) => {
        const node = wrapRef.current;
        if (node && node.contains(event.target)) return;
        const panel = document.querySelector(".dwp-panel");
        if (panel && panel.contains(event.target)) return;
        setOpen(false);
      };
      window.addEventListener("keydown", onKey);
      window.addEventListener("mousedown", onDown, true);
      return () => {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("mousedown", onDown, true);
      };
    }, [open]);

    // ---- 拖动 -------------------------------------------------------------
    const beginDrag = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const node = wrapRef.current;
      const rect = node ? node.getBoundingClientRect() : { left: 0, top: 0, width: pillSize.width };
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: pos ? pos.x : rect.left,
        originY: pos ? pos.y : rect.top,
        moved: false,
        width: rect.width || pillSize.width,
      };
      const onMove = (moveEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = moveEvent.clientX - drag.startX;
        const dy = moveEvent.clientY - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        drag.moved = true;
        setDragging(true);
        const next = clampPos(drag.originX + dx, drag.originY + dy, pillSize);
        setPos(next);
      };
      const onUp = () => {
        const drag = dragRef.current;
        dragRef.current = null;
        setDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (drag && drag.moved) {
          suppressClick.current = true;
          setOpen(false);
          setPos((current) => {
            writePos(current);
            return current;
          });
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };

    const resetPos = () => {
      writePos(null);
      setPos(null);
    };

    const effectivePos = pos || {
      x: Math.max(8, (viewport.w - pillSize.width) / 2),
      y: 9,
    };

    const anchorStyle = { left: effectivePos.x + "px", top: effectivePos.y + "px" };

    const panelStyle = open ? panelGeometry(effectivePos, pillSize) : undefined;

    return h(
      "div",
      { className: "dwp-root" },
      h(
        "div",
        { className: "dwp-layer", onMouseDown: (event) => event.stopPropagation() },
        h(
          "div",
          {
            className: "dwp-anchor",
            ref: wrapRef,
            "data-dragging": dragging ? "1" : "0",
            style: anchorStyle,
            onDoubleClick: resetPos,
            title: pos ? "拖动可移动位置 · 双击回到默认位置" : "按住可拖动",
          },
          h(
            "button",
            {
              type: "button",
              className: "dwp-pill",
              "data-open": open ? "1" : "0",
              ref: pillRef,
              onPointerDown: (event) => {
                event.preventDefault();
                beginDrag(event);
              },
              onClick: () => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                setOpen(!open);
              },
              title: "每周论文速递（可拖动）",
            },
            h("span", { className: "dwp-pill-ico" }, h(Icon, { name: "book", size: 12, stroke: 2.2 })),
            h("span", null, "每周文献速递"),
            hasNew ? h("span", { className: "dwp-dot", title: "有新一期内容" }) : null,
            h("span", { className: "dwp-pill-sep" }),
            h("span", { className: "dwp-pill-issue" }, issue ? issue.id : "加载中"),
            h(
              "span",
              { className: "dwp-pill-count" },
              "专业 " + String(fieldCount) + " · 算法 " + String(algoCount),
            ),
            h("span", { className: "dwp-chev" }, h(Icon, { name: "chev", size: 13, stroke: 2.2 })),
          ),
          open ? h(DigestPanel, { digest, onClose: () => setOpen(false), style: panelStyle }) : null,
        ),
      ),
      h(Lightbox, null),
    );
  }

  /** 渲染兜底：周报出错时只让胶囊消失，不牵连整个界面。 */
  class Boundary extends react.Component {
    constructor(props) {
      super(props);
      this.state = { failed: false };
    }
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(error) {
      try {
        console.warn("[weekly-paper] render failed", error);
      } catch {
        /* ignore */
      }
    }
    render() {
      return this.state.failed ? null : this.props.children;
    }
  }

  function SafeTopBar() {
    return h(Boundary, null, h(TopBar));
  }

  function apply(ctx) {
    try {
      ensureStyle();
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          { name: "shell.overlay", id: "weekly-paper", order: 40, label: "每周文献速递" },
          SafeTopBar,
        ),
      );
    } catch (error) {
      try {
        console.warn("[weekly-paper] mount failed", error);
      } catch {
        /* ignore */
      }
    }
  }

  exports.name = "dsh-weekly-paper";
  exports.inject = ["slots"];
  exports.apply = apply;
  exports.TopBar = TopBar;
  return module.exports;
}});
