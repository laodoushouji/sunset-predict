# Sunset Predict

面向晚霞摄影的多站点预测网站。当前覆盖杭州西湖、上海外滩、北京景山、大理洱海、重庆、厦门、青岛、成都、深圳和黄山，分别输出晚霞质量分与观测成功率。

生产地址：[https://sunsetpredict.cloud/](https://sunsetpredict.cloud/)

## 当前架构

- 前端：原生 HTML、CSS、JavaScript，Lucide Icons。
- 后端：Node.js HTTP 服务，监听 `127.0.0.1:3003`。
- 数据：Open-Meteo 提供云量、能见度等物理格点；QWeather 提供天气现象与小时降水；WAQI 空气质量可选。
- 附近站点：本地离线 GeoIP 数据仅在请求时解析城市级坐标，不把原始 IP 写入业务数据或接口响应。
- 摄影时间：SunCalc 2.0.1 按太阳高度 -4° 至 -8° 计算西湖与外滩蓝调窗口，并输出蓝调质量与相机参数。
- 部署：阿里云香港服务器，Nginx、systemd、HTTPS。
- 持久化：历史快照位于 `/var/lib/sunset-predict/history`，匿名实况反馈位于 `/var/lib/sunset-predict/feedback`，全国站最近成功快照位于 `/var/lib/sunset-predict/cache`。

## 本地开发

需要 Node.js 20 或更高版本（反馈存储使用 `better-sqlite3`、图像处理使用 `sharp`，均为原生模块）。

反馈数据现存储于 `<FEEDBACK_ROOT>/feedback.db`（SQLite 单文件，WAL 模式）。旧版按日期目录存放的 JSON 反馈可一次性迁移：

```bash
npm run migrate:feedback -- /path/to/feedback-root
```

```bash
# 环境变量
cp worker/.dev.vars.example .env
# 填写 QWeather 配置；WAQI_TOKEN 按需填写，禁止提交真实 Token

# 启动完整前后端
set -a
source .env
set +a
PORT=3001 APP_ROOT="$PWD" node worker/src/server.mjs
```

访问 `http://127.0.0.1:3001/`。静态文件和 API 都由同一个 Node 服务提供。

## 测试

```bash
node --check worker/src/server.mjs
node --check frontend/js/app.js
node --test worker/tests/*.test.js
```

## 主要接口

| 接口 | 说明 |
|---|---|
| `GET /sunset` | 西湖预测 |
| `GET /api/spot/waitan`、`/sunset/waitan` | 外滩预测 |
| `GET /api/spots` | 17 个全国站点聚合预测 |
| `GET /api/spot/:slug` | 单站预测，支持 `jingshan` → `beijing` 等别名 |
| `GET /api/timeline` | 昨天至后天的统一时间线 |
| `GET /api/nearby` | 根据访问 IP 返回城市级最近已开通站点 |
| `GET /api/feedback?spot=:slug&cursor=&limit=` | 按站点 cursor 分页读取历史照片与评论（SQLite） |
| `GET /api/feedback/stats` | 匿名反馈聚合统计（总数、带图数、平均质量分/成功率） |
| `POST /api/feedback` | 匿名发布站点照片或评论（照片经 sharp 压缩为 WebP） |
| `GET /api/feedback/photo/:date/:file` | 读取留言照片 |
| `GET /health` | 服务健康检查 |

## 环境变量

| 名称 | 用途 |
|---|---|
| `QWEATHER_API_HOST` | QWeather 控制台分配的专属 API Host，不含协议 |
| `QWEATHER_API_KEY` | QWeather API Key；兼容读取 `QWEATHER_KEY`、`HEWEATHER_KEY` |
| `WAQI_TOKEN` | WAQI 空气质量接口 Token，可选 |
| `PORT` | Node 监听端口，本地默认 3001，生产为 3003 |
| `APP_ROOT` | 项目根目录 |
| `HISTORY_ROOT` | 历史快照目录 |
| `FEEDBACK_ROOT` | 匿名地区留言目录 |
| `CACHE_ROOT` | 全国站最近成功快照目录 |

`.env` 已被 Git 忽略。Token 不得写入前端、源码、测试输出或提交记录。

## 生产部署

生产发布使用 `deploy/remote-deploy.sh`。脚本会备份当前发布目录、Nginx 和 systemd 配置，运行语法检查与测试，重启服务并验证首页、API、图片、二维码及 HTTPS；任一步失败会自动回滚。

部署前必须确认：

1. 本地测试全部通过。
2. `.env` 只通过安全通道上传，不进入发布压缩包或 Git。
3. 历史和反馈目录保留在发布目录之外。
4. 线上 `/health`、`/sunset`、`/api/timeline` 与首页均通过验证。

## 商业模式

当前为「内容 + 赞赏 + 合作位」三件套，尚无广告后台或系统化变现。详细状态见 [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md) §4.9 与 §8。

| 模块 | 现状 | 说明 |
|---|---|---|
| 微信赞赏 | 已完成 | 文案为"为浪漫续航"，只保留微信，置于页面 `<footer>` 最下方 |
| 商业合作位 | 部分完成 | 合作二维码（`business.jpg`）与卡片已上线，合作方向：咖啡、住宿、器材租赁、摄影服务 |
| 广告后台 | 未完成 | 前端有 `advertiserData` 占位逻辑，但无后台管理、定向投放或数据统计 |
| AdSense / 展示广告 | 未启动 | 需先补齐 `/privacy`、`/about`、`/contact` 三页并绑定 Search Console 提交 sitemap |

收入路径：

1. **C 端打赏**：微信赞赏，已跑通。
2. **B 端合作位**：本地商户 / 摄影服务商广告卡，前端占位已就位，缺投放与统计系统。
3. **未来可选**：AdSense 等展示广告，待隐私 / 关于 / 联系页与站点收录等基础设施补齐后再评估。

P2 产品化债项：将 `advertiserData` 从前端占位变量升级为按城市配置的后端数据，提供投放与统计能力。

## 进一步说明

- 完整需求与项目状态见 [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md)。
- 图片版权说明见线上 `/credits` 页面。
- 城市级 IP 定位使用 MaxMind GeoLite Data，并在 `/credits` 页面保留数据归属说明；升级依赖时需同步更新离线数据库。
