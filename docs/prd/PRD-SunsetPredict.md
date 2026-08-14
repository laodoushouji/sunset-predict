# Sunset Predict 晚霞预测平台 — 产品需求文档 (PRD)

> **文档性质**：反写 PRD（As-Is）。本文档基于截至 **2026-08-13** 线上已部署代码库的真实实现整理，作为后续需求与功能调整的**单一事实源**。
> **工作流铁律**：任何功能新增 / 调整，**先在此文件提出变更（新增章节或修订条目）→ 评审 → 再落地代码**。代码实现以本文档为权威基线，文档与代码不一致时以本文档为准（并触发代码修正）。
> **状态标记**：`[已实现]` = 线上已部署；`[规划]` = 已设计但未落地；`[待定]` = 方向明确待细化。

---

## 0. 产品定位

**一句话**：面向摄影爱好者的中国城市晚霞 / 火烧云**拍摄决策**平台——把"今天该不该去拍晚霞、去哪拍、几点拍、怎么拍"变成可量化、可引用的预测。

**核心价值主张**：
- 把主观的"晚霞好不好看"转化为 **质量分 (0–100) + 观测成功率 (%)** 双指标。
- 给出**具体时间窗口**（日落 / 蓝调时刻）与**相机参数建议**（快门、光圈、ISO、白平衡）。
- 数据**每小时滚动更新**，日落前 2 小时置信度最高。

**目标用户**：风光 / 城市摄影爱好者、小红书 / 知乎摄影内容创作者、同城摄影社群。

**GEO 定位**（2026-08 起）：不仅做传统 SEO（搜索引擎排名），同时做 GEO（Generative Engine Optimization）——让 ChatGPT / Perplexity / Claude / Gemini 在回答"今晚杭州晚霞预测""有哪些专业晚霞预测工具"时**引用并提及本站**。

---

## 1. 系统架构

### 1.1 技术栈 `[已实现]`
| 层 | 技术 | 说明 |
|---|---|---|
| 运行时 | Node.js (原生 `http` 模块，无框架) | `worker/src/server.mjs` 为唯一在线后端入口 |
| 预测计算 | Node.js 纯函数 | `worker/src/services/prediction.js`，模型 `quality-v3.1` |
| 地理/天文 | SunCalc 2.0.1 | 日落方位角、太阳高度角、蓝调窗口 |
| 数据存储 | SQLite (`better-sqlite3`, WAL) | 实况反馈 `feedback.db`、历史快照 `history.db` |
| 数据源 | Open-Meteo (云量/能见度/高层湿度格点) + QWeather (降水/天气现象，主源) | 多源融合，QWeather 权重 50% |
| 前端 | 单页 `index.html` + SSR 注水 | `injectSeoDocument()` 把动态内容注入 `<!-- SPOT_LANDING -->` 占位 |
| SEO/GEO | 服务端渲染 JSON-LD + `llms.txt` + `robots.txt` | `worker/src/services/seo.js` |
| 部署 | ECS（阿里云节点）+ Nginx 反向代理 + 全站 HTTPS | `deploy/remote-deploy.sh` → `/root/sunset-predict-v2` |
| 进程托管 | systemd `sunset-predict.service` | 监听 3001，nginx 代理至 3003 |

### 1.2 请求分发 `[已实现]`
`server.mjs` 按路径分发：
- `/` 首页（19 城聚合卡片 + 沉浸式 Hero）
- `/spots/:slug` 城市/省份落地页（SSR，37 个地点）
- `/credits` 版权与致谢
- `/llms.txt` `/robots.txt` `/sitemap.xml` 静态/半静态资源
- `/api/*` 反馈提交、健康检查的 API 前缀（其余前缀 namespace 隔离）
- 通用兜底：尝试直接读 `frontend/<path>` 静态文件

### 1.3 部署链路 `[已实现]`
1. 本地 `tar` 打包（排除 `node_modules`/`.git`/`.env`）。
2. `scp` 至 ECS `/root/sunset-predict-v2.tar.gz`。
3. `remote-deploy.sh`：解压 → 恢复 `.env`（从 `/root/sunset-predict-v2.env` staging）→ 跑测试 → 重启 systemd。
4. 环境变量源：`/root/sunset-predict-v2/.env`（部署前复制为 staging env），含 `QWEATHER_*`、`BAIDU_SITE_VERIFICATION`、`GOOGLE_SITE_VERIFICATION`、`BING_WMC_KEY` 等。
5. **部署铁律**：任何改动必须先本地跑通 `node --check` + 相关测试 + `npm test` 全绿，再上传部署；绝不跳过本地验证。

---

## 2. 核心功能需求

### 2.1 晚霞预测引擎 `[已实现]`
- **输入**：城市地理坐标 + 当日气象格点（Open-Meteo）+ 降水/天气现象（QWeather）。
- **双轨输出**（Quality V3 模型 `quality-v3.1`）：
  - `quality`（晚霞质量分 0–100）：基于中高云量、大气光学厚度、`250hPa` 高空湿度，衡量色彩爆发潜力。
  - `probability`（观测成功率 %）：基于远端与本地低云屏蔽率，衡量景观是否被遮挡。
- **蓝调时刻计算** `[已实现]`：SunCalc 2.0.1 按太阳高度角 `-4°` 至 `-8°` 求窗口，输出 `blueHour.times.start/end` 与 `advice`（相机参数建议：快门/光圈/ISO/白平衡）。
- **气象阻断（熔断）** `[已实现]`：实时监测小时级降水，中雨及以上天气自动熔断，`quality` 与 `probability` 清零。
- **更新频率** `[已实现]`：气象数据每小时滚动更新；支持今日实时与未来两日预测（`forecast_days=3`）。
- **多地点覆盖** `[已实现]`：19 个城市站 + 18 个省份摄影指南 = **37 个地点**（`FORECAST_SPOTS`），含杭州西湖、上海外滩、北京、大理、重庆、深圳、成都、武汉等。

### 2.2 前端呈现 `[已实现]`
- **首页**：19 城聚合预报卡片 + 沉浸式 Hero（由 `weekly_picks` 表驱动）。
- **城市/省份落地页** `/spots/:slug`：
  - 标题区（spotName + 一句话描述）
  - **AI 直给摘要块** `id="ai-summary"` `[已实现, GEO P1]`：可见的一句话简报，先结论后展开（质量分/成功率/最佳窗口/摄影建议），供 AI 爬虫直接引用。
  - 今日实时卡片（质量分/成功率/蓝调时间）
  - 摄影指南（来自 `CITY_GUIDES[slug]`，含 FAQ、机位、交通）
  - FAQ 区块（首句直给式文案）
- **版权页** `/credits`：数据来源与致谢。

### 2.3 实况反馈闭环 `[已实现]`
- 用户可在落地页提交实拍反馈（含评分、照片、是否观测到晚霞）。
- 数据落 `feedback.db`（`feedback-db.js`，WAL 模式）。
- 历史高分实拍用于前端"实况画廊"展示，作为预测准确度校准参考。
- 反馈数据同时写入 `prediction_json` 便于回溯模型版本。

### 2.4 SEO / GEO 资产 `[已实现/部分]`
| 资产 | 状态 | 说明 |
|---|---|---|
| `robots.txt` | `[已实现]` | 显式 `Allow` GPTBot/ClaudeBot/PerplexityBot/Google-Extended；禁 `/api` `/health` |
| `llms.txt` | `[已实现]` | 含 Capabilities + Data Specifications + 技术栈，面向 AI 爬虫的站点地图 |
| JSON-LD | `[部分]` | 已有 WebSite/WebPage/FAQPage/TouristAttraction/Breadcrumb/ItemList；**缺预测数据字段 + Article 权威信息** `[规划]` |
| 城市页 ai-summary | `[已实现]` | 见 2.2 |
| FAQ 直给化 | `[已实现]` | 文案首句即结论 |
| `/about` 方法论页 | `[规划]` | 实体定义 + 原理（瑞利散射/大气折射）+ 术语表 + 引用授权，待建 |
| 页脚引用授权声明 | `[部分]` | llms.txt 已有，全站页脚/可见区尚未显式标注 |

---

## 3. 非功能需求

### 3.1 性能 `[已实现]`
- 纯 Node 原生 http，无重框架；SQLite 句柄按目录缓存。
- 静态资源经 Nginx 缓存。

### 3.2 可观测性 `[已实现]`
- `/api/health` 健康检查（self-check 覆盖：气象源可达、预测非空、熔断逻辑、反馈库可读写）。
- 监控脚本 `scripts/seo-monitor.cjs`：逐页校验 title/canonical/JSON-LD + `llms.txt` 硬检查 + `/about` 建议项。
- `scripts/bing-keywords.cjs`：通过 Bing WMC API 拉取站长数据（需 `BING_WMC_KEY`）。

### 3.3 安全 `[已实现]`
- `.env` 不进 git，部署 tar 排除。
- 反馈接口做 respondent_hash、photo_sha256 防重与完整性校验。
- API 前缀 namespace 隔离，避免与前端路由冲突。

---

## 4. 待办 / 规划功能（基于当前 GEO 路线）

### 4.1 P1（高优先级，代码可落地）
- **`/about` 方法论页** `[已实现]`：2026-08-14 上线 `frontend/about.html`（静态实体定义页，含定义"晚霞预测"、Quality V3 双维度、术语表火烧云/蓝调时刻/瑞利散射、引用授权声明；nginx 已加 `/about` 代理 location；页内 JSON-LD 含 WebPage/Article/Organization）。
- **JSON-LD 扩展** `[已实现]`：2026-08-14 落地页 JSON-LD 新增 `Dataset`（variableMeasured: 晚霞质量分/观测成功率 + additionalProperty: 最佳观测窗口）+ `Article`（author/publisher/datePublished/dateModified）+ `Organization`（#org）；`day` 经 `injectSeoDocument → buildSeoHead → buildStructuredData` 透传，预测缺失时自动跳过。
- **页脚引用授权声明** `[已实现]`：2026-08-14 在 `index.html` 全站页脚加 `.footer__cite`（"欢迎在注明出处前提下引用…详见引用授权"），并在 `credits.html` 加同款声明，均链向 `/about`。

### 4.2 P2（运营驱动，需人工）
- **站外主动被引用** `[待定]`：知乎/小红书/百度百科回答中自然提及本站。
- **商户 AI 引用增值** `[待定]`：落地页注入商户实体（咖啡/民宿/器材），让 AI 学习"商户—晚霞观赏"关联，可向商户售"AI 引用优化服务"。
- **AI 引用周检** `[待定]`：每周在 ChatGPT/Perplexity 搜"今晚杭州晚霞预测"核验是否被引用。

### 4.3 运维（需人工平台操作）
- **GSC + 百度搜索资源平台提交 sitemap.xml** `[待定]`：验证已 OK，缺主动提交以拓宽收录面（19 城 + 18 省页在 Bing/Google/百度均未充分收录）。

---

## 5. 基于 PRD 的变更工作流

1. **提变更**：在本文件新增/修订章节，标注 `[规划]`→`[已实现]` 状态流转，记录动机与验收标准。
2. **评审**：变更须经确认（用户 review PRD diff）。
3. **落地代码**：严格按 PRD 条目实现；涉及预测算法/数据模型的改动须同步更新 `prediction.js` / `cities.js` / `seo.js` 并保持测试通过。
4. **验证**：本地 `node --check` + `npm test` 全绿 → 部署 → `seo-monitor.cjs` 复核 → 线上 curl 抽检关键资产（llms.txt/robots.txt/ai-summary/新页面）。
5. **回流**：实现后将对应 PRD 条目标记为 `[已实现]`，保持文档与代码一致。

---

## 6. 参考资产
- 预测核心：`worker/src/services/prediction.js`, `cities.js`, `blue-hour.js`
- 渲染/SEO：`worker/src/services/seo.js`, `city-guides.js`
- 数据层：`worker/src/services/feedback-db.js`, `history.js`
- 部署：`deploy/remote-deploy.sh`, `deploy/sunset.conf`(nginx), `deploy/sunset-predict.service`
- 监控：`scripts/seo-monitor.cjs`, `scripts/bing-keywords.cjs`, `scripts/gen-sitemap.cjs`
- GEO 文档：`GEO实施SOP.md`（配套实施手册）
