# 条目数据规范（item schema）

每周速递的每一条文献都必须满足本规范。目标是**可核验**：标题、作者、期刊、年份、DOI、摘要必须来自检索到的真实来源，不得编造。

## 1. 选题范围

### field（专业前沿）
- 风电/光伏功率预测（短期、超短期、概率/区间预测、场站级、爬坡事件）
- 气象预报 / 数值天气预报（NWP）后处理、降尺度、集合预报、AI 气象大模型（Pangu-Weather、GraphCast、FuXi 类）
- 雷达数据流场重构 / 机舱雷达 / 激光雷达（LiDAR）测风、来流反演、数据同化、空间流场重构
- 相邻方向：风资源评估、尾流、极端天气对新能源的影响

### algo（算法进展）
- 大模型（LLM / VLM / 多模态、Agent、推理、RAG、长上下文、评测）
- 时序预测（Transformer/Mamba/状态空间、基础模型 TimesFM/Chronos/Moirai、概率预测、缺失值、迁移）
- 相邻方向：图神经网络、扩散模型、持续学习、可解释性

## 2. 期刊与级别要求

优先（按此顺序）：中国电机工程学报、电力系统自动化、中国电力、可再生能源、Renewable Energy、Energy、Applied Energy、Energy Conversion and Management、IEEE 系列（TSTE / TPS / TSG / TPWRS / TIM / TNNLS / TKDE）、Nature、Science、Wind Energy、Green Energy（含 Green Energy & Environment、Advances in Applied Energy 等近似刊）。

其它期刊也可，但级别必须达到 **SCI / EI / 中文核心** 之一；预印本（arXiv）只在不属于以上三类时作为补充，且 `level` 标 `PREPRINT`，并且**不能**作为唯一来源。

## 3. 字段（严格）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✔ | 唯一键，优先 DOI（`10.xxxx/yyyy`），无 DOI 用 `arxiv:2405.12345` |
| `title` | string | ✔ | 英文题名，逐字来自来源 |
| `titleZh` | string | ✔ | 中文题名（忠实翻译；中文期刊则填原标题） |
| `authors` | string[] | ✔ | ≤ 8 位，超过则第 8 位后加 `"et al."` |
| `venue` | string | ✔ | 期刊全名，逐字 |
| `venueShort` | string | ✔ | 短名（用于徽标，≤ 14 字符） |
| `publisher` | string |  | Elsevier / IEEE / MDPI / Springer / 《中国电机工程学报》社… |
| `year` | number | ✔ | 出版年 |
| `date` | string | ✔ | `YYYY-MM-DD`（在线发表日或期刊期次日） |
| `level` | string | ✔ | `SCI` / `EI` / `中文核心` / `PREPRINT` |
| `impactNote` | string |  | 如 `JCR Q1 · IF 10.1`；无把握就不填 |
| `citation` | string | ✔ | GB/T 7714 风格一行：`作者 A, 作者 B, 作者 C. 题名[J]. 期刊, 年, 卷(期): 页码.` |
| `doi` | string |  | DOI |
| `links` | `{label,url}[]` | ✔ | 1–3 条，`label` ∈ {DOI, 原文, PDF, 预印本, 数据} |
| `keywords` | string[] | ✔ | 3–6 个中文关键词 |
| `abstractEn` | string | ✔ | 英文摘要，逐字（去掉 JATS/HTML 标签，合并空白） |
| `abstractZh` | string | ✔ | 中文摘要；英文文献为**忠实翻译**，中文期刊为原文摘要 |
| `abstractZhSource` | string | ✔ | `译` 或 `原文` |
| `keyPoints` | string[] | ✔ | 3–5 条关键技术点，中文，每条 ≤ 60 字，说清"做了什么、怎么做的、效果如何" |
| `figures` | `{file,caption,source,license}[]` |  | 0–2 条；`file` 为 `data/assets/fig/` 下的文件名 |
| `relevance` | string | ✔ | 一句话：与我们方向（功率预测 / 气象预报 / 雷达流场重构）的关系 |
| `tags` | string[] | ✔ | 1–3 个，取自：功率预测、气象预报、雷达流场重构、大模型、时序预测、多模态、图学习、概率预测 |
| `section` | string | ✔ | `field` 或 `algo` |

## 4. 配图规则

- 只在图片**公开可下载**时配图：MDPI（CC BY）、Nature/Science 开放获取、arXiv 论文中的插图、期刊官方 HTML 里的 figure 原图。
- 下载到 `data/assets/fig/<slug>.png|jpg`，单张 ≥ 20 KB 且能通过视觉核对确实是正文图（不是期刊 logo / 广告）。
- `caption` 写中文图注（可译自原文）；`source` 写 `原文 Fig. 3` 之类；`license` 写 `CC BY 4.0` / `© 期刊（合理引用）`。
- 拿不到就留空数组，**绝不伪造**配图或图注。

## 5. 去重

- 以 `id`（DOI/arXiv）为准；同一文献的不同版本只保留正式发表版。
- 已出现在历史 issue 里的条目不得在新 issue 重复。

## 6. 输出文件

- 专业前沿：`D:\deepseek\dsh-weekly-paper\_incoming\field.json`
- 算法进展：`D:\deepseek\dsh-weekly-paper\_incoming\algo.json`

文件内容为 `{ "items": [ ... ] }`，每条都必须带上上面的全部必填字段。
