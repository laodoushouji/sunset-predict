# P1 站长平台验证 + sitemap 提交 SOP

> 前置：P0 已落地（19 城原创指南 + JSON-LD FAQ + sitemap `<lastmod>`）。
> 本步目标：让 Google / Bing / 百度能验证站点所有权，并主动提交 `sitemap.xml`。

---

## 0. 你最终要提交的核心网址

| 项目 | 网址 |
|------|------|
| 站点根域 | `https://sunsetpredict.cloud/` |
| **sitemap（提交用）** | `https://sunsetpredict.cloud/sitemap.xml` |

---

## 1. 拿到两个验证 Token（必须你本人操作）

代码里 `server.mjs` 已读取 `GOOGLE_SITE_VERIFICATION` / `BAIDU_SITE_VERIFICATION`，
`seo.js` 的 `verificationTags()` 会在每个页面 `<head>` 注入对应 `<meta>`。
你只需去两个平台各取一段 `content` 值，发回给我即可。

### 1.1 Google Search Console
- 打开：https://search.google.com/search-console
- 左上角下拉 → **添加资源** → 选「网址前缀」→ 填 `https://sunsetpredict.cloud/` → 继续
- 验证方式选 **HTML 标记** → 复制
  `<meta name="google-site-verification" content="XXXX">` 里的 `XXXX`
- 把 `XXXX` 发我（即 `GOOGLE_SITE_VERIFICATION` 的值）

### 1.2 百度搜索资源平台
- 打开：https://ziyuan.baidu.com/site
- 站点管理 → **添加网站** → 主域 `sunsetpredict.cloud` → 验证方式选 **HTML 标签验证** → 复制
  `<meta name="baidu-site-verification" content="YYYY">` 里的 `YYYY`
- 把 `YYYY` 发我（即 `BAIDU_SITE_VERIFICATION` 的值）

> 百度对新站、无 ICP 备案的域名收录更慢，属正常现象，提交后可耐心等 1–4 周。

---

## 2. 把 Token 接进部署（我来做）

你发回 `XXXX` / `YYYY` 后，我会在服务器上的部署 env 文件
（`/root/sunset-predict-v2.env`，即 deploy 用的 staging env）写入：

```bash
GOOGLE_SITE_VERIFICATION=XXXX
BAIDU_SITE_VERIFICATION=YYYY
```

`remote-deploy.sh` 会把它移到 `/root/sunset-predict-v2/.env`，
systemd service 的 `EnvironmentFile` 在下次启动时加载进 node 进程。

> 轻量生效方式：**无需全量重部署**，`systemctl restart sunset-predict` 即可让 meta 生效
> （env 在进程启动时读取）。部署脚本末尾已加断言：若配置了 token 会自动
> `curl` 首页与 `/spots/hongkong` 校验 `<meta>` 是否出现，没配则明确告警。

---

## 3. 提交 sitemap（必须你本人操作，因需登录账号）

### 3.1 Google
- GSC 左侧 **站点地图** → 添加 `https://sunsetpredict.cloud/sitemap.xml` → 提交
- 状态变为「成功」即代表 Google 已读取 38 条 URL

### 3.2 Bing
- 打开：https://www.bing.com/webmasters
- 可点「**从 Google Search Console 导入**」一步到位；或手动添加站点后提交
  `https://sunsetpredict.cloud/sitemap.xml`

### 3.3 百度
- 百度搜索资源平台 → 数据引入 → **链接提交** → 自动提交（sitemap）
  → 添加 `https://sunsetpredict.cloud/sitemap.xml`

---

## 4. 验证是否真的生效（线上自查）

部署 + 提交后，任意浏览器/命令行确认 meta 已出现：

```bash
curl -s https://sunsetpredict.cloud/ | grep -o 'name="google-site-verification"'
curl -s https://sunsetpredict.cloud/ | grep -o 'name="baidu-site-verification"'
curl -s https://sunsetpredict.cloud/sitemap.xml | grep -c '<loc>'
```

---

## 5. 还差什么（不在本步范围）

- **统计埋点**：当前未见 GA4 / 百度统计，提交后应尽快接入，否则无法量化自然流量。
- **站外权重**：新站无外链，建议小红书 / 摄影论坛带链（P2）。
