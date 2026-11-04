# dsh-weekly-paper · 每周文献速递

一个**顶部下拉菜单**式的周报工具，两种跑法：

| 形态 | 位置 | 需要 DSH 吗 | 更新方式 |
|---|---|---|---|
| **插件版** | DSH Web 界面顶部（`shell.overlay` 槽位） | 需要 | 数据文件热生效；每周任务自动抓 |
| **独立版** | `standalone/index.html`，双击即开 | **不需要** | 单个 HTML，随数据一起重新生成 |

两条线共用同一份数据（`data/`）和同一份界面代码（`client/client.js`）。

- **专业前沿**：风电/光伏功率预测、气象预报与降尺度、雷达/激光雷达测风与流场重构
- **算法进展**：大模型、时序预测 —— **优先计算机顶会**（NeurIPS / ICML / ICLR / KDD / ACL / EMNLP / CVPR…）

每条给出：GB/T 7714 引用、中文摘要、英文摘要、（顶会的）CCF 级别或**中科院分区 + JCR 分区 + 影响因子**、访问链接、关键技术点、原文配图（能拿到开放获取图时）。

## 三块功能

### ① 每周速递（默认视图）

按上面两个方向自动抓的新文献。顶部「本期概述」默认折叠，点开是这一期的整体综述 **+ 本期参考文献列表（按 GB/T 7714 编号列出）**——综述讲趋势，文献以参考文献形式罗列。

页签右侧那个输入框是**在本期内过滤**（不联网）；再右边的「文献检索」按钮才是**现场去数据库搜**。

- **收藏**：每张卡片日期旁边有个「收藏」按钮，点一下进收藏夹（存在本机 localStorage）；页签栏第三个「收藏 N」就是收藏夹视图。
- **换一批**：页签栏的「换一批」按当前方向从**等级池**里取下一批 8 篇、整理成新的一期，**当前这批自动保留成一个历史期号**（下拉里能看到），等价于多了一周。池子按期刊等级排好序、缓存 12 小时，所以第 1 批和第 5 批是同一档次（详见下面「候选池」）。
- **删掉某一期**：底部期号胶囊后面有个 ×，点了确认就删（文件 + 索引一起删，不能恢复）；删的是当前期会自动切到最新的一期。

### ② 文献检索（类似谷歌学术）

点「文献检索」→ 输入关键词（中英文都行）→ 后端走 **Scopus + 优先期刊定向 + arXiv 顶会** 现场检索，结果卡片样式与速递一致，**同样带中科院分区 / JCR / 影响因子**。

- **排序和别人不一样的地方**：先按期刊等级（顶刊 → 中科院1区 Top → CCF-A → Q1 → 2区 → …），同档次内再按相关度。所以第一页就是"和你方向同水平"的那一批，而不是 Scopus 相关度前排里混着书系与 Q3 刊的那批。
- **检索结果和速递完全同构**：中英双语题名/摘要、GB/T 7714 引用、3-5 条技术要点、期刊分区与影响因子、链接、原文配图（Scopus/arXiv 取得到的都给）——后端拿到结果后会现场跑一遍和每周更新同一套整理流程（4 并发，8 条约 20 秒）
- 中文词自动转英文再搜：内置术语表（尾流控制 → wake control、功率预测 → power forecasting…），没命中就让 DeepSeek 翻一句；实在翻不出来会直接说"这个词没法直接搜"，不会给你一页空结果
- 每条结果可一键复制 **GB/T 7714 / BibTeX / RIS / APA**（复制走 Clipboard API，失败自动退回 execCommand，再不行弹可选中的文本框，不会出现"显示已复制但没复制"）
- 顶部还能「导出全部 BibTeX / RIS」（下载文件）
- 依赖后端：插件版、以及 `start.cmd` 启动的在线版都支持；纯静态托管（无后端）会提示不可用

### 候选池：检索与「换一批」共用的取数逻辑（`scripts/lib/pool.mjs`）

老实现是一条 `TITLE-ABS-KEY("wind power forecasting")` 打天下。实测同一个词，Scopus 按相关度回的前 25 条是
`Electric Power Systems Research(10) / Expert Systems with Applications(3) / Lecture Notes in Computer Science(5) / Applied Soft Computing(4)`
——**一本优先期刊都没有**。这就是"额外搜出来的、换一批换出来的明显差一档"的根因。

现在改成三条互补的路子并排跑，取完先按等级排序：

| 路子 | 查询长什么样 | 作用 |
|---|---|---|
| Scopus 期刊定向 | `TITLE-ABS-KEY("…") AND (ISSN(0306-2619) OR ISSN(0960-1481) …) AND PUBYEAR > 2021` | 同一个词，前 25 条变成 Applied Energy(10) / Energy(8) / Renewable Energy(3) / ECM(1) / IEEE TSTE(2) / TSG(1) |
| Crossref 期刊定向 | `works?query.bibliographic=…&filter=issn:A,issn:B,…&rows=100` | 补 Elsevier/Wiley/AMS/EGU 的期次与卷页；摘要缺的用 Scopus `META_ABS` 补 |
| arXiv 顶会 | `(co:NeurIPS OR co:ICML …) AND (abs:time OR abs:series)` | 用 comment 里的"已被录用"判定，算法侧第一页直接是 KDD/ICDE/NeurIPS 的正式论文 |

三道闸门：① `sources.json` 的 `exclude`（把 stock market / covid 这类挡掉）；② 方向词 `core`（把 sleep–wake、metasurface control 这种词面命中挡掉，池子够用时才收紧）；③ 补完摘要后按 `matchesQuery()` 再判一次相关度（标题+摘要要覆盖检索词，3 个词以上允许漏 1 个）。**宁可少给几条，也不拿不相关的凑数。**

- ISSN 名单来自 `sources.json` 点名的刊 + `journals.json` 里 1/2 区、Q1/Q2、CCF-A 的刊（最多 26 个）
- 有 `flagship` 的方向会**再单独拉一路旗舰刊**（Scopus `ISSN(...)` + Crossref），否则 JFM/POF 在尾流方向会被 Applied Energy/Energy 这类大刊挤掉——实测同一个词「wake steering」，加与不加旗舰刊这一路，JFM/POF 的命中是 0 vs 40+
- 检索池内存缓存 20 分钟（翻页/换一批复用同一池）；「换一批」的池按方向落盘缓存 12 小时到 `<方向目录>/.pool/`
- **换一批用的是"这个方向自己的"检索词**（`sources.json` 的 `scopus.queries` + `arxiv.field`），不是写死的功率预测词；池子缓存在 `<方向目录>/.pool/`，文件名带检索词指纹——改了关键词，旧池子自动失效，不会继续拿上一版关键词抓的那批。
- 同一篇被两条路命中时按 DOI 去重；勘误/撤稿/社论（Corrigendum / Erratum / Retraction / Editorial…）直接丢掉。
- 每批 8 篇、预印本最多 1 篇、同一本刊最多 3 篇（`pickDiverse`，避免一整页同一本刊；候选不够时才放宽）；实测「风电功率预测」池 227 条、取 3 批仍是清一色中科院1区 Top。

### ③ 本期概述（已自动化）

```powershell
node scripts/summarize-issue.mjs --issue=2026-W46    # 手动补跑某一期
```

**每周自动更新会顺带生成**（`update-weekly.mjs` 内置，`--no-summary` 可关）。概述写在 `issue.sections.<section>.summary`，界面默认折叠，展开状态记在 localStorage。

## 换研究方向（方向下拉 / 自己新建）

顶部标题下面有一行「方向」：**下拉切换、右边「＋ 新建方向」自己加、选中非默认方向时还有「编辑」**。切换只影响"看哪一批数据"，检索、换一批、期号历史、概述全都跟着切。默认方向永远是 `data/` 根目录那套历史数据，切回去就是原来的样子。

**新建方向时你填的东西**（都写进该方向的 `sources.json`，之后随时能再改）：

- **方向名称 / 短名** —— 界面显示用；目录名从名称或第一个关键词自动取（纯中文名会用关键词，例如 `energy-storage`）
- **检索关键词** —— 芯片式输入：打字出现建议（来自现有方向用过的词 + 领域词），回车或点建议加入；必填
- **优先期刊** —— 搜索式选择：输入刊名/ISSN/"fluid mech" 这类模糊词就出建议，候选里直接标 **分区 / JCR / IF**；点一下变成芯片；表里没有的刊可以回车当"自定义刊名"加入（ISSN 由后端先查 `journals.json`、再问 Crossref 自动补）
- **领域旗舰刊** —— 每本期刊芯片左边有个 ☆，点成 ★ 就是旗舰刊：排到最前面、徽标写「领域顶刊」（中科院大类分区可能只有 2 区，但在本方向就是顶刊；真实分区/JCR/IF 照样显示）
- **专业侧栏目名**（可选）—— 例如「尾流与流场」，不填就是「专业前沿」
- **设为默认** —— 勾上之后下次打开就是这个方向（也可随时取消）

「编辑」打开时会**回填已保存**的关键词、期刊、旗舰刊（不是空白），所以能直接看到"存进去了什么"、就地增删。

> **没填优先期刊也可以**：这时只按关键词检索，不会再去套"分区表里所有热门刊"的 ISSN 过滤——否则新方向（比如 wind farm wake）会被能源/电力类大刊带偏，搜出来还是功率预测那批。建议还是加 3-5 本领域刊，效果最好。

建好之后点「换一批」就按新方向抓第一批（约 30 秒）；也可以命令行跑
`node scripts/update-weekly.mjs --domain=<id> --since=2024-11-01` 做一次完整回溯。
「编辑」里还能改关键词 / 优先期刊 / 旗舰刊 / 名称，或者把这个方向删掉（默认方向不能删，得先把别的设为默认）。

**表单是一个铺满窗口的大弹窗**（860px 宽、超过就内部滚动），不是塞在面板里——插件的面板只有 500 多像素，内联一行行填很难受。弹窗挂在面板**外面**渲染，这样面板的 `backdrop-filter` / `overflow:hidden` 不会把弹窗挤窄或裁掉；`Esc` 先关弹窗（不会连带关掉整个面板）。

**删除是两步确认**：点「删除这个方向」只会进入确认态（按钮变成「确认删除（不可恢复）」，旁边多一个「算了」），再点一次才真删。刻意没用 `window.confirm`——嵌在别的界面里时它可能被静默拦掉，点了像没反应。

> **写完方向要重启一次后端**：方向接口是宿主半的代码，`POST /api/domains` 只在 v3 后端里。
> 旧后端会把 POST 当成 GET 一样返回列表（HTTP 200），看着"成功"其实什么都没写。
> 现在前端会看 `GET /api/domains` 返回的 `version`：不是 3 就在弹窗里红字提示"后端是旧版本，重启 dsh web"并把创建/删除按钮禁用，不会再让你以为存上了。
> 本地版是关掉黑窗口、重新双击 `start.cmd`。

内置的两个方向：

| | 默认方向 `power` | 尾流 `wake`（现成例子） |
|---|---|---|
| 数据放哪 | `data/index.json` + `data/issues/` | `data/domains/wake/index.json` + `data/domains/wake/issues/` |
| 检索配置 | `data/sources.json` | `data/domains/wake/sources.json` |
| 优先期刊 | Applied Energy、Renewable Energy、Energy、ECM、IEEE TSTE/TSG/TPS… | **JFM、Physics of Fluids、Physical Review Fluids、JWEIA、JFS** + WES、Wind Energy、Renewable Energy |
| 旗舰刊（排到最前的） | Nature/Science 与其子刊 | 上面那 5 本流体刊 |
| 栏目名 | 专业前沿 / 算法进展 | 尾流与流场 / 算法进展 |
| 期刊分区数据 | 共用 `data/journals.json`（一份总表） | 同一份 |

- 方向注册表是 `data/domains.json`（id / 显示名 / 短名 / 副标题 / 栏目名）；未知 id 一律回落到默认方向，不会报错也不会写坏数据。
- 默认方向的数据**永远在 `data/` 根下**，其他方向在 `data/domains/<id>/`；静态站点切方向时按这条规则拼路径，所以「切回功率预测」不会去请求一个不存在的目录（早先踩过：切回去白屏）。
- 页面模式（独立版/本地版）不记住上次选择，每次打开都是默认方向；想直接进某个方向用 `?domain=<id>`（切换时地址栏会自动更新）。
- 「领域顶刊」的判定来自各自 `sources.json` 里的 `flagship.field`——中科院大类分区不等于领域地位（JFM 大类是工程技术 2 区，但在尾流/流体方向它就是顶刊），所以排序把旗舰刊直接排到 rank 0，徽标写「领域顶刊」，同时仍然显示真实的中科院分区 / JCR / IF。

### 命令行加方向（等价做法）

```powershell
node scripts/add-domain.mjs --id=wake --label="风电场尾流与流场调控" --short=尾流 `
  --from=power --flag="journal of fluid mechanics,physics of fluids,physical review fluids"

node scripts/update-weekly.mjs --domain=wake --since=2024-11-01   # 第一次回溯一批
node scripts/build-standalone.mjs && node scripts/build-standalone.mjs --site
```

之后 `sources.json` 里的 `scopus.queries`、`core`、`journals`、`flagship` 直接改就能调范围，不用碰代码。
每个方向也可以单独跑每周更新（`--domain=<id>`），互不影响。

## 三种用法

### 1) 插件版（DSH Web）

```powershell
dsh plugin --profile web add link:D:\deepseek\dsh-weekly-paper
```

或手动挂载（web profile 的 patch 文件是 live 监听的）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: dsh-weekly-paper
      name: dsh-weekly-paper
```

刷新页面后，窗口顶部出现胶囊：`📖 每周文献速递 · 2026-W45 · 专业 5 · 算法 5`。

- **可拖动**：按住胶囊拖到任意位置，位置记在 localStorage；**双击胶囊回到默认位置**
- 点开是面板：期号下拉 / 两个页签 / 搜索 / 条目展开 / 配图灯箱；`Esc` 或点空白关闭
- 面板会自动判断上下方向并在屏幕内收边，不会被裁掉

### 2) 独立版（不依赖 DSH）

```powershell
node scripts/build-standalone.mjs           # → standalone/index.html（单文件快照）
node scripts/build-standalone.mjs --site    # → standalone-site/（在线版，页面读同目录 data/）
```

**单文件版** `standalone/index.html`：React、界面代码、全部数据、配图引用都内联在这一个文件里（约 268 KB），双击就能看。⚠️ 它是**静态快照**——你发出去的副本不会自己更新，每次数据变了要重新生成并重发。

**整页布局**：独立版和在线版都不再是"点胶囊弹下拉"，而是：

- 顶部只有一枚 logo 和标题（不再有可拖动按钮、也没有关闭按钮）
- 内容直接铺满窗口：**单列**，最大宽度 1240px 居中（不管屏幕多宽都不分栏，长文更好读）
- **字体：Times New Roman + 宋体**（`"Times New Roman","SimSun","宋体",serif`），正文 16px（≈ 小四），
  标题 20px、中文题名 16.5px、引用 13.5px、要点 15.5px、元信息 13px
- 底色用教学平台那套浅蓝灰 `#f4f7fc` + 白色卡片，长看不刺眼

**在线版** `standalone-site/`：页面不内联数据，打开时读同目录的 `data/index.json` 与 `data/issues/*.json`。所以把整个目录放到任意静态服务器（Nginx / IIS / GitHub Pages / 对象存储）或局域网共享后，**只替换 data/ 目录，别人刷新页面就是新一期**，不用重发文件。

#### 一键启动（内网共享）

桌面上已经放了一个 **「每周文献速递」** 快捷方式，双击即可：

它做的事：检查数据有没有更新 → 需要就重建在线版 → 起静态服务器 → 打印本机地址和"发给同事的地址" → 自动打开浏览器。

等价的命令行方式：

```powershell
双击 D:\deepseek\dsh-weekly-paper\start.cmd      # 就这一件事
# 或者
node scripts\lan-server.mjs 8099                 # 指定端口
```

启动后窗口里会打印类似：

```
  本机打开   http://127.0.0.1:8099/
  发给同事   http://192.168.1.23:8099/    ← 复制这个（已自动复制到剪贴板）
  当前数据   回溯精选 · 近三年顶级 · 15 篇
  停止服务   在这个窗口按 Ctrl+C，或直接关掉窗口
```

几个要点：

- **端口被占会自动往后找**（8099 → 8100 → …）
- 第一次启动**Windows 防火墙会弹窗，选「允许访问」**；否则同事连不上
- 如果只检测到公网 IP（比如校园网直接分配公网地址），脚本会提示"同一网段可试"，并建议直接发单文件
- 桌面快捷方式重装/搬家后重建：`powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1`（`-Remove` 删掉）

每周自动更新跑完之后，`standalone/` 和 `standalone-site/` 都会被自动重建；服务器不用重启，同事刷新页面即可。

| 版本 | 双击可看 | 别人能自动更新 | 适合 |
|---|---|---|---|
| `standalone/index.html` | ✅ | ❌ 快照 | 微信/邮件发单文件，离线看 |
| `standalone-site/` + `start.cmd` | 一键启动 | ✅ 换 data/ 即可 | 内网发布、挂到静态托管 |

### 3) 每周自动更新（不需要你输入指令）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\schedule-weekly.ps1        # 注册：每周一 08:00
powershell -ExecutionPolicy Bypass -File scripts\schedule-weekly.ps1 -Uninstall
schtasks /query /tn "DSH Weekly Paper Digest" /v /fo list                   # 查看
schtasks /run  /tn "DSH Weekly Paper Digest"                                # 立刻跑一次
```

任务干的事（`scripts/update-weekly.mjs`）：

1. 读 `data/index.json` 的 `coverage.nextWindowFrom` 与已收录 DOI（去重）
2. 抓 Crossref（配置里的 20 个刊，带摘要才收）+ arXiv（关键词 + 会议录用识别）
3. 相关性打分：核心词必须命中、领域闸门、误命中黑名单、会议/时效加权
4. 调 DeepSeek 把英文文献整理成中文卡片（题名 / 摘要 / 3-5 条技术点 / 与方向的关系 / 关键词 / 标签）
5. 写 `data/issues/<年>-W<周>.json`、更新 `index.json`、重建独立版
6. 日志落在 `data/logs/update-YYYY-MM-DD.log`

手动跑法：

```powershell
node scripts/update-weekly.mjs                  # 正常（默认方向）
node scripts/update-weekly.mjs --domain=wake --since=2024-11-01   # 只更新尾流方向
node scripts/update-weekly.mjs --dry-run        # 只看选中了什么，不落盘
node scripts/update-weekly.mjs --since=2026-10-01
node scripts/update-weekly.mjs --no-curate      # 不调模型，只存英文
node scripts/update-weekly.mjs --rebuild        # 只重建独立版
```

> 想每周把所有方向都更新一遍：在计划任务里串两条命令即可
> （`node scripts/update-weekly.mjs` 然后 `node scripts/update-weekly.mjs --domain=wake`）。

## 怎么分享给别人（四种方式，按省事程度排）

**给同事看的说明文档**：`docs/使用说明.html`（可打印/转发，推荐）与 `docs/使用说明.md`（可编辑）。
`pack.mjs` 会把这两份自动放进每个压缩包，并在 `dist/使用说明.html` 留一份，方便你直接发。

一条命令打包，产物都在 `dist/`：

```powershell
node scripts/pack.mjs --target=all --with-node     # 四种一起出；--with-node 只在 portable 包里塞 node.exe
node scripts/pack.mjs --target=single              # 只出单文件版
```

| 方式 | 产物 | 对方要做什么 | 代价 / 限制 |
|---|---|---|---|
| **① 单文件版** | `dist/weekly-paper-single-<日期>.zip`（约 2 MB） | 解压 → 双击 `index.html` | 零安装、离线可用；**只读快照**：没有换一批/删除/现场检索，每周要重新发 |
| **② 免安装本地版** | `dist/weekly-paper-portable-<日期>.zip`（带 node 约 39 MB） | 解压 → 双击 `start.cmd` | 自带 `node.exe`，对方**不用装 Node**；有换一批/删除/检索（检索要自己的 Elsevier key）；本机跑，别人打不开 |
| **③ 静态网站** | `dist/weekly-paper-site-<日期>.zip` | 丢到 GitHub Pages / nginx / 腾讯云 COS，发个网址 | 一个链接给一群人最省事；纯静态，没有后端（换一批/检索不可用）；仓库里已带 `.github/workflows/pages.yml`，push 就自动发布 |
| **④ 插件版** | `dist/dsh-weekly-paper-<版本>.zip`，或 `npm pack` 出的 `.tgz` | `dsh plugin --profile web add …` | 对方得用 DSH；能跟着他自己的周更/方向配置走 |

### ① 单文件版：发给不用电脑技术的人

解压出来是 `index.html` + `assets/fig/`，双击就能看，断网也能看。每周更新后重新打一次包发过去即可。

### ② 免安装本地版：对方也要能"换一批 / 检索"

包里带了 `node.exe`、`scripts/`、预构建好的页面和 `data/`，双击 `start.cmd` 起服务并自动开浏览器。
对方要用**现场检索**得自己配一个 Elsevier key（`data\.elsevier-key` 一行，或环境变量 `ELSEVIER_API_KEY`）——
包里**故意不带你的 key**。

### ③ 静态网站：一个链接发给一群人

```powershell
node scripts/build-standalone.mjs --site      # 只重建 standalone-site/
# GitHub Pages（推荐，仓库里已经有 workflow）：
#   Settings → Pages → Source 选 "GitHub Actions"，之后 push 就自动发布
# 或者手动推一个 gh-pages 分支：
git subtree push --prefix standalone-site origin gh-pages
```

纯静态托管没有后端，「换一批 / 删除期号 / 现场检索」会被自动隐藏（页面会提示"当前是静态托管，只能浏览"）；
浏览、切方向、回看历史期号、收藏、复制引用、导出 BibTeX/RIS 都正常。`data/` 里不含任何密钥，可以公开。

### ③+ 自动发布到 GitHub（本地一改数据就推上去，关机别人也能看）

不用装 git、不用敲 git 命令，走 GitHub REST API：

```powershell
node scripts/setup-github.mjs          # 一次性：粘贴 token（不回显），之后就再也不用了
```

它会验证权限 → 写入 `data/.github-token` 与 `data/publish.json` → 立刻发布一次：
**`main` 放源码+数据**（别人可 `dsh plugin add git+https://github.com/<你>/<仓库>.git`），
**`gh-pages` 放构建好的静态站点**（自动开 Pages，给出 `https://<你>.github.io/<仓库>/`）。

之后**只要本地产生新数据就自动推**：点「换一批」、删期号、新建/删除方向、每周自动更新，全都会触发（后台跑，失败不打扰，1.5 秒内多次操作只推一次）。
增量推送：用内容哈希比对，一次「换一批」通常只上传 2–5 个文件；`data/published.json` 记着已推过的 blob，可随时删掉强制全量。

```powershell
node scripts/publish-github.mjs              # 手动推一次（有变化才推）
node scripts/publish-github.mjs --force      # 忽略哈希，全量重推
node scripts/publish-github.mjs --dry        # 只列清单，不发请求
```

token 权限只要 **Contents: Read and write** 和 **Pages: Read and write**，建议 7 天过期（过期后本地功能照常用，只是不再自动推送，重新跑一次 setup 即可）。
推送日志在 `data/logs/publish.log`；`data/.github-token`、`data/published.json` 都已进 `.gitignore` / `.npmignore`，不会泄露。

### ④ 插件版：给也在用 DSH 的人

最方便是 GitHub：

```powershell
# 你这边（用 dist/dsh-weekly-paper-<版本>/ 或在仓库根目录）
git init && git add -A && git commit -m "weekly paper digest"
git remote add origin https://github.com/<user>/dsh-weekly-paper.git && git push -u origin main

# 对方那边
dsh plugin --profile web add git+https://github.com/<user>/dsh-weekly-paper.git
# 或      dsh plugin --profile web add github:<user>/dsh-weekly-paper
# 重启 dsh web 即可
```

只想给一个压缩包（对方不用 GitHub）：

```powershell
npm pack                              # → dsh-weekly-paper-0.1.0.tgz
# 对方：dsh plugin --profile web add ./dsh-weekly-paper-0.1.0.tgz
```

注意：
- **密钥永远不要提交**：根目录的 `.gitignore` / `.npmignore` 已经排掉 `data/.elsevier-key`、`data/logs/`、`data/.pool/`、`dist/`；`pack.mjs` 打包时也会主动剔除。
- 对方没有 DeepSeek key 时只在插件里显示英文（`--no-curate` 那种状态），不会崩。
- 想让数据从零开始（不暴露你读过什么）：`node scripts/pack.mjs --target=site --clean`，会生成一份"空骨架"（只留方向配置与期刊表）。

## API 配额与费用

```powershell
node scripts/usage.mjs            # 实时查一次 Elsevier 配额 + DeepSeek 余额 + 本地记账
node scripts/usage.mjs --no-live  # 只看上次记账，不花配额
```

**Elsevier（Scopus / ScienceDirect API）** —— 有硬配额，写在响应头 `x-ratelimit-*` 里：

| | 值 |
|---|---|
| 额度 | **20,000 次 / 周**（按 API key 算，免费学术 key 的标准额度；机构 key 可能更高） |
| 窗口 | 7 天滚动，响应头里有 `x-ratelimit-reset`（北京时间） |
| 消耗 | 一次 Scopus 检索 = 1 次；取一条 `META_ABS` 摘要 = 1 次 |

实测一次操作的消耗：**每周自动更新（一个方向）≈ 50 次**、**网页「换一批」≈ 32 次**、**现场检索 ≈ 15–40 次**。
所以 20,000/周 大约够 **600 次「换一批」** 或 **400 次现场检索** + 每周自动更新，正常用很难打满。

**DeepSeek** —— 没有次数配额，按 token 预付费扣；余额见 `scripts/usage.mjs`（或者 `curl https://api.deepseek.com/user/balance`）。
实测整理一条文献约 1,000 tokens（一轮 16 条约 17,000 tokens），单价很低。

### 谁在花你的额度？

| 你把什么给别人 | 对方看到的内容 | 花谁的额度 |
|---|---|---|
| 单文件版 / 静态站点 zip（快照） | 你发出去时的数据 | **不花**——纯静态，不发请求 |
| 免安装本地版 zip | 包里的数据 + 可用检索/换一批 | **他花他的**：包里不含你的 key，他要用检索得自己配 |
| 局域网分享（同一 WiFi 打开你的 8099） | 你机器上的实时数据 | **花你的**：请求打到你机器，用你的 key（DeepSeek 也是你的余额） |
| 插件版（对方装在他自己的 DSH 上） | 他仓库里的数据 | **他花他的**：key 在各自机器上 |
| 把 `data/.elsevier-key` 直接发给别人 | — | **共用同一份额度**：20,000/周 是两个人在抢，不建议 |

要点：**换一批 / 现场检索 / 每周自动更新** 这三个动作才会消耗额度；**浏览、切方向、看历史期号、收藏** 全在本地，不花任何配额。
记账文件是 `data/.api-usage.json`（已加进 `.gitignore` / `.npmignore`，不会被提交或打包）。

## 数据在哪

```
data/
  domains.json             方向注册表（默认方向 + 其他方向的显示名）
  index.json               期号索引（当前期、覆盖范围、每期条目数）
  issues/2026-W45.json     某一期的全部条目
  domains/wake/            其他方向自己的 index.json + issues/ + sources.json
  journals.json            期刊等级库：中科院分区 / JCR 分区 / 影响因子（含来源链接，所有方向共用）
  sources.json             自动更新配置：抓哪些刊、搜什么词、打分权重、黑名单
  assets/fig/*.png         原文配图
  logs/update-*.log        自动更新日志
  update-requests.json     面板上"请求更新"按钮写进来的请求
  .pool/*.json             「换一批」的候选池缓存（12 小时，可随时删）
```

改 `data/*.json` 后**刷新页面即生效**（宿主每次请求都会 stat 文件），不用重启、不用重新打包。

单条文献的字段见 [`docs/item-schema.md`](docs/item-schema.md)；每周人工复核的流程见 [`docs/weekly-routine.md`](docs/weekly-routine.md)。

## 期刊等级数据

`data/journals.json` 收录 32 种刊，字段：

```json
{
  "name": "Renewable Energy", "issn": "0960-1481",
  "cas": { "zone": "1区", "top": true, "major": "工程技术", "year": "2025" },
  "jcr": { "quartile": "Q1", "year": "2025" },
  "if": 9.1,
  "source": "https://www.letpub.com.cn/…"
}
```

口径：**中科院分区 = 2025 年 3 月升级版大类分区**；**JCR / IF = 2025 版**。多个来源交叉核对过（letpub / ai4paper / 期刊官网），逐条带来源链接。中文核心期刊没有中科院分区，用 `cn` 字段记收录信息（北大核心 / EI / CSCD）。

## 接口（插件版宿主半）

所有接口都接受 `domain=<id>`（GET 用查询串、POST 用 body 里的 `domain`）；不传就是默认方向，传了不存在的方向也回落到默认。

| 路由 | 说明 |
|---|---|
| `GET /dsh-weekly-paper/api/domains` | 方向列表 + 弹窗用的"智能填充"目录（`journals` 41 本带分区/IF、`suggest` 关键词）；`?detail=<id>` 回填该方向的配置 |
| `POST /dsh-weekly-paper/api/domains` | 新建 / 修改 / 删除方向：`{action:'create'\|'update'\|'delete', …}` |
| `GET /dsh-weekly-paper/api/index?domain=wake` | 期号索引（可按方向取） |
| `GET /dsh-weekly-paper/api/issue?id=2026-W45&domain=wake` | 某一期内容 |
| `GET /dsh-weekly-paper/api/state` | 覆盖范围 / 待处理更新请求 |
| `GET /dsh-weekly-paper/api/diag` | 自检：浏览器半是否进了 boot graph、bundle 路径与大小 |
| `GET /dsh-weekly-paper/api/health` | 能力探测（检索 / 换一批 / 删期号 / 有没有 Elsevier key），局域网版同名 |
| `POST /dsh-weekly-paper/api/reroll` | 换一批：`{section, domain}` |
| `POST /dsh-weekly-paper/api/issue-delete` | 删某一期：`{id, domain}` |
| `POST /dsh-weekly-paper/api/update-request` | 记录一次更新请求 |
| `GET /dsh-weekly-paper/assets/fig/xxx.png` | 配图静态文件 |

> 「换一批」「删除这一期」「文献检索」都要走后端现算。单文件版（`standalone/index.html`，数据内联在 HTML 里）没有后端，
> 页面上不会显示这三个按钮；局域网版/插件版才有。

## 常见问题

**删除期号时提示 `删除失败：Failed to execute 'json' on 'Response': Unexpected end of JSON input`**

已在客户端修掉：局域网版页面把 `/api/issue-delete`、`/api/reroll` 误判成「读取某一期」，重写成了 `data/issues/.json`，
于是 POST 到一个不存在的静态文件、拿到非 JSON 响应。现在改成按路由段精确匹配（`splitApiPath`），
并且所有后端调用统一走 `callApi`——后端没起或版本旧时会直接说"后端没响应/接口未启用，重启 dsh web 或双击 start.cmd"。

如果你还看到这个报错：先 **Ctrl+F5 强制刷新**页面（页面文件是从磁盘现读的，刷新即拿到新 JS）；
仍不行就关掉那个黑窗口，重新双击 `每周文献速递` 快捷方式。

## 分级与排序（`scripts/lib/rank.mjs`）

每条文献都会算一个 `rank`（越小越靠前）和 `tierLabel`，数据里存好、界面也按它再排一次：

| 场景 | 排序阶梯 |
|---|---|
| **算法进展** | CCF-A 会议(0) → CCF-B 会议/Findings(1) → 顶刊 Nature/Science 及其子刊(4) → 中科院 1 区(5) → JCR Q1(6) → 2 区/Q2(7) → 其他 SCI(8) → EI/中文核心(9) → 预印本(11) |
| **专业前沿** | 顶刊 Nature/Science(0) → 中科院 1 区 Top(1) → CCF-A 会议(1) → JCR Q1(2) → 2 区/Q2(3) → 其他 SCI(4) → EI/中文核心(5) → 预印本(7) |

### 顶会怎么认（不是"arXiv 上的都算顶会"）

`update-weekly.mjs` 用 arXiv 的 **`co:`（comment）字段**直接搜"已被 XXX 2026 录用"的论文，再用 `detectAcceptance()` 严格判定：

- ✅ 认：`Accepted to NeurIPS 2026`、`Published in EMNLP 2026`、`ICML 2026 (Oral)`、`main conference`、`camera-ready`
- ❌ 不认：含 `workshop` / `symposium` / `Findings of` / `submitted to` / `under review` / `preprint` / `journal extension` / `extended version` / `demo track` / `tutorial` 的一律降级或丢弃

每期算法侧还有两个闸门：Scopus 期刊论文最多 2 条、纯预印本最多 2 条，避免把顶会位置挤掉。时序/预测方向的论文额外 +8 分，同级之内优先出现。

### 人工重排

```powershell
node scripts/rebuild-rank.mjs      # 重算所有期号的 rank + 按等级重排（分区数据更新后跑一次）
```

### 合并多期 / 只留顶级

```powershell
# 把现有各期合并成一期"回溯精选"，只留 顶刊 + 中科院1区/Top + CCF-A，并删除被合并的旧期号
node scripts/merge-issues.mjs --id=2026-BACKFILL --label="回溯精选 · 近三年顶级" --keep=top --delete=all

# 保留范围更宽（额外含 CCF-B / JCR Q1 / 2区），或全留
... --keep=top+
... --keep=all
```

合并时默认还会做**方向相关性过滤**（`--domain=1`，可用 `--domain=0` 关掉）：算法侧如果摘要里完全不出现 time series / forecast / wind / power / energy / load / weather 等词，即使它是 CCF-A 也不留（顶刊除外）——避免"多智能体说服/视觉检索"这类和功率预测无关的顶会论文占版面。

合并前的旧期号文件会被删除，但合并脚本不会动 `_backup_issues/`（如果之前备份过）。

## 数据来源与边界

- **能拿到逐字摘要的才收**：Crossref（MDPI / EGU / AMS / Wiley / Springer / Nature / PLOS）、arXiv、ACL Anthology、《电力系统自动化》官网 `aeps-info.com`；Elsevier 四刊与 IEEE 走 Scopus `META_ABS` 取逐字摘要（下面的三条补齐路径）。
- **拿不到就不写**：三条路都取不到摘要的条目会**跳过**而不是编造摘要。

### 三条补齐路径

| 路径 | 覆盖 | 状态 |
|---|---|---|
| **Elsevier API key + Scopus**（已接入） | Applied Energy / Renewable Energy / Energy / ECM、IEEE TSTE/TSG/TPS、中国电机工程学报、电力系统自动化、电网技术…… | ✅ 自动更新已启用：Scopus 检索 + `view=META_ABS` 取逐字摘要 |
| **题录导入**（WoS / 知网 / 万方 / ScienceDirect / IEEE Xplore / Scopus） | 任何你能登录的库 | ✅ `node scripts/import-ris.mjs 导出文件 --issue=2026-W46` |
| **arXiv 兜底** | IEEE/会议论文的预印本 | ✅ 自动更新一直在跑 |

#### Elsevier API key 怎么配

1. 去 [dev.elsevier.com](https://dev.elsevier.com) 免费注册（Academic/Researcher），拿到 key；
2. 三种放法，优先级从高到低：
   - 环境变量 `ELSEVIER_API_KEY`
   - 命令行 `--elsevier-key=xxxx`
   - **密钥文件 `data/.elsevier-key`**（推荐，计划任务不用配环境变量；已加进 `data/.gitignore`）

有了 key 之后 `update-weekly.mjs` 会自动多跑一路 `collectScopus`：

- **主题检索**：`TITLE-ABS-KEY("wind power forecasting" OR …)`，不限期刊；
- **定向检索**：按 `SRCTITLE(...)` 单独点名 Applied Energy / Renewable Energy / Energy / ECM / IEEE TSTE / TSG / TPS / 电机工程学报 / 电力系统自动化 / 电网技术；
- **摘要**：`/content/abstract/doi/<doi>?view=META_ABS`（返回 ~8KB，逐字 `dc:description`）；
- **日期口径**：Scopus 的 `prism:coverDate` 是"期次封面日"，Elsevier 常常排到明年某期，所以在线首发但排期在未来的条目，界面显示抓取日、卡片 tooltip 里写真实期次，引用里的年份仍用期次年。

> 实测：一个免费 key 就能覆盖 Elsevier 四刊 + IEEE + 主要中文核心，单次运行约 60 次 API 调用、20 条摘要。

#### IEEE 和知网有类似 API 吗

| 库 | 有官方 API 吗 | 实测 | 建议 |
|---|---|---|---|
| **IEEE Xplore** | 有：IEEE Xplore Metadata API（developer.ieee.org 申请 key） | 无 key 访问 `ieeexploreapi.ieee.org` 返回 **403 "Developer Inactive"**；网页版是 202 机器人壳 | **不需要**：Scopus 已经能取到 IEEE 的逐字摘要（实测 TSTE 那篇 1358 字符）。真要接也行，给我 IEEE key 我就加一路 |
| **知网 CNKI** | 没有公开 API（只有面向机构的"知网开放平台"，要签约） | kns.cnki.net 有人机验证；oversea.cnki.net 检索接口 404 | 用**导出导入**；另外 Scopus 覆盖了电机工程学报 / 电力系统自动化 / 电网技术，能拿英文题名+摘要 |
| **万方 / 维普** | 无公开 API | 万方是 SPA、维普 412 | 同上传导导入 |

### 题录导入格式

`import-ris.mjs` 自动识别（实测都通）：

| 来源 | 导出选项 | 识别为 |
|---|---|---|
| Web of Science | Plain text file / Tab-delimited / RIS | `wos-plain` / `wos-tsv` / `ris` |
| 知网 CNKI | EndNote / RefWorks / NoteExpress | `endnote` / `refworks` / `ris` |
| 万方 | EndNote / RefWorks / NoteExpress | 同上 |
| ScienceDirect / IEEE Xplore | Export citation → RIS | `ris` |
| Scopus | RIS / Plain text | `ris` / `wos-plain` |

WoS 的记录里**自带 Abstract**，所以这条路能一次性补齐 Elsevier / IEEE / 中文核心的摘要；中文库导出的摘要是中文，会被识别成"原文摘要"而不是翻译。

### Web of Science 能不能直接抓

不能程序化抓，原因不是网络而是**身份**：

- `www.webofscience.com` 域名可达（VPN 后 200），但返回的是 2.7 KB 的空壳 SPA，条目内容要机构订阅的会话（校园 IP 或登录）才由 JS 拉回来；
- `api.clarivate.com`（WoS Starter API）→ 401，需要自己申请 key；
- 匿名可用的替代库也都堵死：Scopus 重定向死循环、Dimensions 202 空壳、Lens 人机验证、Semantic Scholar 202、百度学术 403 安全验证。

所以正确姿势是「你登录导出 → 我导入」。如果以后拿到 WoS Starter API key，可以再把它接成自动更新的一路。

### 链接健康检查

```powershell
node scripts/check-links.mjs                 # 检查所有期号的链接，写回 linkCheck 字段
node scripts/check-links.mjs --only=2026-W45 --timeout=6000 --concurrency=10
```

DOI 链接用 Crossref（404 时回落 doi.org 解析）判定，不按出版商页面的 bot 墙误判；被 Cloudflare/403 挡住的记为「需浏览器」，只有 DNS 失败、连接重置、404 这类明确故障才标「链接暂不可达」，界面上会显示红色提示。

### 当前实测（2026-11-04，VPN 已开）

| 站点 | 结果 |
|---|---|
| `aeps-info.com`（电力系统自动化） | 断续可用，会重置连接；**http、不带 www** |
| `pcsee.org`（中国电机工程学报） | DNS 不解析 |
| CSEE 期刊门户 `epjournal.csee.org.cn` | 可达但为 Vue 单页，HTML 里没有摘要 |
| 知网 / 维普 / 万方 | 验证码 / 412 / SPA，自动化不可用 |
| ScienceDirect | 403（Cloudflare 人机验证，VPN 也过不去） |
| IEEE Xplore | 202 空响应（反爬） |
| Google Scholar | 可达但 429 限流 |
| X-MOL | 人机验证页 |

## 改代码后怎么生效

- 只改 `data/*.json`：刷新页面。
- 改 `lib/index.js`（宿主半）：必须重启 `dsh web`（新增/改路由）。
- 改 `client/client.js`（浏览器半）：`node scripts/build-standalone.mjs && node scripts/build-standalone.mjs --site` 重建两份独立版；
  插件版刷新页面即可，若还加载旧 bundle 就重启 `dsh web`。
- 改 `scripts/lan-server.mjs`（局域网版后端）：关掉黑窗口、重新双击 `每周文献速递`（`start.cmd`）。
