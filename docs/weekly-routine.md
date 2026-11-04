# 每周更新例行流程（给助手看）

有两条路：

- **自动**：Windows 计划任务 `DSH Weekly Paper Digest` 每周一 08:00 跑 `scripts/update-weekly.mjs`，抓取 + DeepSeek 整理 + 写新一期 + 重建独立版，日志在 `data/logs/`。
- **人工复核**：助手跑一遍并逐条核对（质量更高，Elsevier/中文刊的替代路径也要人工试）。

下面是人工复核流程；自动跑完也可以按这个表检查一遍。

触发方式：用户说「更新文献周报」，或 `data/update-requests.json` 里有未处理请求。

## 0. 先看自动跑的结果

```
data/logs/update-YYYY-MM-DD.log   最近一次自动更新做了什么
data/index.json                   当前期与覆盖范围
```

自动更新只从"能拿到逐字摘要"的源里选（Crossref 部分出版社 / arXiv / 配置里的 20 个刊）。
如果它这一期偏少或偏杂，人工补一轮再覆盖那一期。

## 1. 先读状态，别重复

```
data/index.json      → coverage.nextWindowFrom / coverage.coveredFrom / current
data/issues/*.json   → 已收录条目的 id（DOI / arXiv 号）全集 = 去重黑名单
```

首轮做过近三年回溯（`coverage.backfillFrom = 2023-11-01`），之后每期只取
`start = 上一期 coverage.to` 之后**在线首发**的文献。

## 2. 检索窗口与关键词

- 窗口：`start` → 今天。若距上期超过 4 周，按自然周拆成多期补齐。
- 专业：wind/solar power forecasting、NWP downscaling、weather regime、lidar/radar
  wind measurement、flow field reconstruction、ramp event、probabilistic forecasting
- 算法：time series foundation model、Mamba/state space、LLM agent、multimodal、
  test-time adaptation、probabilistic/quantile forecasting、GNN for forecasting

## 3. 期刊优先级

中国电机工程学报 > 电力系统自动化 > 中国电力 > 可再生能源 >
Renewable Energy / Energy / Applied Energy / ECM > IEEE(TSTE/TPS/TSG/TPWRS) >
Nature / Science / Wind Energy / Green Energy > 其它 SCI/EI/中文核心。

## 4. 核验（不可跳过）

- 元数据一律过 Crossref：`https://api.crossref.org/works/<DOI>?mailto=...`，标题、刊名、
  在线首发日以它为准。**注意 Elsevier/IEEE 的 Crossref 日期可能只到"期次日"**，
  要再用 OpenAlex `publication_date` 复核在线首发日，否则会把老文当新文。
- 摘要必须逐字：Crossref `abstract`（去 JATS 标签）→ OpenAlex
  `abstract_inverted_index` 还原 → 期刊页。三者都拿不到就**换一篇**，不许自写英文摘要。
- 遇到"预印本 vs 正式版"疑似同一工作时，标题相似度只是必要条件，
  必须再核作者名单；不同作者即为两项工作（踩过一次坑）。
- 配图只从 CC BY / 开放获取直链下载，`≥ 20KB`，肉眼确认是正文插图。

## 5. 落盘

1. 写 `data/issues/<年>-W<周>.json`（结构照现有文件，`mode` 用 `incremental`）
2. 更新 `data/index.json`：把新期号放 `issues[0]`、`current` 指向它、
   `coverage.totalItems` / `figures` / `to` / `nextWindowFrom` 同步
3. `node scripts/validate.mjs` 必须 0 error
4. 有配图就复制到 `data/assets/fig/`，文件名 `<field|algo>-<doi去斜杠>-1.png`

## 6. 汇报时必须说明的缺口

- Elsevier 四刊（Applied Energy / Renewable Energy / Energy / ECM）Crossref 无摘要，
  ScienceDirect 需要机构 IP 或 Elsevier API key 才拿得到 → 要么换刊，要么如实说没覆盖。
- 中文核心期刊（中国电机工程学报、电力系统自动化）在 Crossref 无记录，
  需要 CNKI 或期刊官网可达才能补。
- 配图拿不到就留空，界面上会显示"配图"数量为 0，不摆占位图。
