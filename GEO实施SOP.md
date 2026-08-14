# GEO 实施 SOP（Generative Engine Optimization）

> 适用站点：sunsetpredict.cloud（晚霞 / 火烧云预测 + 城市落地页 + 摄影指南）
> 版本：2026-08-13
> 目标：让 ChatGPT / Perplexity / Gemini / Claude 等生成式引擎在回答相关问题时**引用并提及**本站点。

---

## 0. 什么是 GEO（一句话）

SEO 争的是「搜索结果排名」；**GEO 争的是「AI 回答里的引用与提及」**。

生成式引擎不排序十个蓝链，而是实时（或基于训练语料）抓取最权威、最结构化、最直接的内容来组织答案。GEO 就是让本站点成为那个「被采信的来源」。

Princeton GEO 论文（arXiv 2311.09735）实证：加入**引用、统计数字、权威语气、清晰术语、简洁直给**的内容，被 AI 引用率显著提升（部分场景 +40%）。

---

## 1. 现状评估（sunsetpredict.cloud）

| 检查项 | 现状 | GEO 影响 |
|---|---|---|
| `robots.txt` | `User-agent: * Allow: /`（仅禁 `/api/ /sunset /health`） | ✅ GPTBot/ClaudeBot/PerplexityBot/Google-Extended 全部放行，无爬虫门槛 |
| `llms.txt` | **404（缺失）** | ❌ 最高性价比缺口，P0 必做 |
| 结构化数据 | 已实现 `FAQPage` JSON-LD | ✅ 已是机器可读 Q&A，需扩展 |
| 城市/省份落地页 | 19 城 + 18 省 `/spots/*` | ✅ 天然匹配长尾问题（"杭州今晚有晚霞吗"） |
| 原创数据 | 每日晚霞/火烧云概率预测 | ✅ AI 最爱引用的独家数据集 |
| 每日新鲜度 | 数据每日更新 | ✅ "今日/实时"是 AI 偏好信号 |
| 站长验证 | GSC / 百度 / Bing 均已验证 | ✅ 间接提升实体可信度 |
| sitemap 提交 | 仅 Bing 有少量收录；GSC/百度未提交 | ⚠️ 影响传统收录，间接影响 AI 取源 |

**结论**：技术门槛已达标，核心短板是 `llms.txt` 缺失 + 内容未针对「直给答案/实体定义」改造 + 外部权威引用不足。

---

## 2. 实施路线（按优先级）

### P0 — 立即可做（1 天内）

#### 2.1 创建 `llms.txt`（根目录）
AI 爬虫专用的站点地图，用 Markdown 声明站点定位与核心入口。

```
# Sunset Predict 晚霞预测

> 提供中国城市晚霞与火烧云概率预测、最佳观测时段及摄影指南的站点。

## 核心页面
- 首页（实时预测）: https://sunsetpredict.cloud/
- 城市晚霞预测（共 19 城，如武汉）: https://sunsetpredict.cloud/spots/wuhan
- 省份摄影指南（共 18 省，如西湖）: https://sunsetpredict.cloud/spots/xihu
- 方法论 / 预测原理（待建）: https://sunsetpredict.cloud/about

## 数据说明
- 预测基于气象数据与大气光学模型，输出每日晚霞/火烧云出现概率与推荐观测时间窗。
- 数据每日更新，覆盖中国主要城市。
```

部署位置：放到 `frontend/llms.txt`，随前端静态资源发布（已在 `serveStatic` 兜底范围内，无需单独注册）。

#### 2.2 确认 robots 放行 AI 爬虫
当前已 `Allow: /`，无需改动。若将来收紧，务必保留：
```
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /
```
（也可不单独写，依赖通配 `*` 即可；显式写出更稳妥、便于审计。）

---

### P1 — 内容层改造（1–2 周）

#### 2.3 每城/省页加「直给答案」段落
AI 抓取偏好**先结论后展开**。在城市页 `<header>` 注入 2–3 句直给文案，例如：

> 武汉今晚晚霞概率 **72%**，最佳观测时段 **18:40–19:10**，推荐观测点：东湖绿道。
> 火烧云出现概率 **35%**，若发生多在日落后 10–20 分钟。

实现：在 `seo.js` 的 `renderSpotLanding` 顶部加「今日直给摘要」区块（已有每日数据，拼接即可）。

#### 2.4 建「方法论 / 预测原理」实体定义页 `/about`
这是 AI 回答「晚霞预测是什么 / 火烧云怎么形成」时的首选被引源。内容要素：
- 清晰定义：晚霞预测、火烧云、大气散射原理
- 方法说明：数据来源、模型逻辑、概率含义（避免「黑箱」感）
- 术语表 + 引用（气象学公开资料）
- 标注「数据可引用」授权声明

#### 2.5 扩展结构化数据
在现有 `FAQPage` 基础上，给预测结果补充机器可读字段：
- 预测页：用 `Dataset` / `Observation` 思路标注 `地点 / 日期 / 概率 / 时段`
- 方法论页：用 `Article` + `author` + `dateModified` 强化权威与时效
- 确保 JSON-LD 无报错（沿用 `scripts/seo-monitor.cjs` 已有的 JSON-LD 校验思路扩展）

#### 2.6 强化 FAQ 直给度
现有 FAQ 已好转。建议每条 Q 的 A 首句即结论，再展开，便于 AI 直接摘录成答案片段。

---

### P2 — 外部权威（持续，最难但最关键）

AI 的「采信」高度依赖第三方信号。本阶段目标是**让本站点被外部权威源提及**。

#### 2.7 主动被引用
- 知乎：回答「如何预测晚霞」「今天哪里能看到火烧云」类问题，自然嵌入 sunsetpredict.cloud
- 小红书：摄影攻略笔记引用站点预测（你已有推广文案，可改造）
- 百度百科 / 维基：在「晚霞」「火烧云」词条参考资料位争取录入
- 媒体/地方号：投稿「用数据预测晚霞」类软文

#### 2.8 多平台实体一致性
品牌名、域名、简介在站外各平台保持一致，提升 AI 对「Sunset Predict」实体的识别置信度。

#### 2.9 开放引用声明
页脚加：「本站预测数据欢迎在注明出处前提下引用」，降低 AI/媒体引用顾虑。

---

## 3. 与现有 SEO 自动化的衔接

| 现有动作 | GEO 增补建议 |
|---|---|
| `scripts/seo-monitor.cjs`（每日 09:00） | 增加 `llms.txt` 200 校验；增加 `/about` 页存在性校验 |
| 站长平台验证（已 OK） | 维持；GSC/Bing 验证间接助 GEO 实体可信 |
| sitemap 提交（待办） | **务必完成 GSC + 百度 sitemap 提交**，收录面扩大=AI 可取源更多 |
| Bing 数据拉取（`bing-keywords.cjs`） | 持续观察「晚霞预测/火烧云」词展现/点击增长 |

**AI 引用自检（人工，每周 1 次）**：
在 ChatGPT / Perplexity 搜索「今晚杭州晚霞预测」「火烧云怎么预测」，记录是否引用 sunsetpredict.cloud。这是目前 GEO 效果的主要测量手段（无平台级面板）。

---

## 4. 落地排期清单

- [ ] **P0** 创建并部署 `frontend/llms.txt`
- [ ] **P0** 确认 robots 放行 AI 爬虫（已满足，记录备查）
- [ ] **P1** 城市/省份页加「今日直给摘要」区块
- [ ] **P1** 建 `/about` 方法论页（定义 + 原理 + 术语 + 授权）
- [ ] **P1** 扩展 JSON-LD（预测数据字段 + Article 权威信息）
- [ ] **P1** FAQ 答案首句直给化
- [ ] **P2** 知乎/小红书/百科 主动被引用
- [ ] **P2** 站外实体一致性 + 页脚引用授权声明
- [ ] **运维** GSC + 百度 提交 sitemap.xml（同时利传统 SEO）
- [ ] **监控** seo-monitor 增 llms.txt / about 校验；每周人工 AI 引用自检

---

## 5. 效果测量口径

| 维度 | 指标 | 工具 |
|---|---|---|
| 技术可达 | llms.txt / robots / 结构化数据 正常 | `seo-monitor.cjs` |
| AI 引用 | ChatGPT/Perplexity 回答提及率 | 人工周检（记录截图/链接） |
| 间接流量 | 长尾词展现/点击 | Bing WMC（`bing-keywords.cjs`）、GSC |
| 收录面 | 城市/省份页被索引数 | GSC 覆盖率、Bing Page Stats |

> 注：GEO 暂无统一平台面板，测量以「人工 AI 引用自检 + 传统搜索数据间接印证」为主。

---

## 6. 参考
- Princeton GEO 论文：arXiv 2311.09735《GEO: Generative Engine Optimization》
- llms.txt 规范（由 Jeremy Howard / Hugging Face 提出）
- 现有站点资产：`frontend/`、`worker/src/services/seo.js`、`scripts/seo-monitor.cjs`、`scripts/bing-keywords.cjs`
