# Sunset Predict

面向晚霞摄影的多站点预测网站。当前覆盖杭州西湖、上海外滩、北京景山、大理洱海、重庆、厦门、青岛、成都、深圳和黄山，分别输出晚霞质量分与观测成功率。

生产地址：[https://sunsetpredict.cloud/](https://sunsetpredict.cloud/)

## 当前架构

- 前端：原生 HTML、CSS、JavaScript，Lucide Icons。
- 后端：Node.js HTTP 服务，监听 `127.0.0.1:3003`。
- 数据：Open-Meteo 气象格点，可选 WAQI 空气质量。
- 部署：阿里云香港服务器，Nginx、systemd、HTTPS。
- 持久化：历史快照位于 `/var/lib/sunset-predict/history`，匿名实况反馈位于 `/var/lib/sunset-predict/feedback`，全国站最近成功快照位于 `/var/lib/sunset-predict/cache`。

## 本地开发

需要 Node.js 18 或更高版本。

```bash
# 环境变量
cp worker/.dev.vars.example .env
# 按需填写 WAQI_TOKEN，禁止提交真实 Token

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
| `GET /api/spot/waitan` | 外滩预测 |
| `GET /api/spots` | 其余 8 个站点聚合预测 |
| `GET /api/spot/:slug` | 单站预测 |
| `GET /api/timeline` | 昨天至后天的统一时间线 |
| `POST /api/feedback` | 匿名提交是否看到晚霞与实际质量 |
| `GET /health` | 服务健康检查 |

## 环境变量

| 名称 | 用途 |
|---|---|
| `WAQI_TOKEN` | WAQI 空气质量接口 Token，可选 |
| `PORT` | Node 监听端口，本地默认 3001，生产为 3003 |
| `APP_ROOT` | 项目根目录 |
| `HISTORY_ROOT` | 历史快照目录 |
| `FEEDBACK_ROOT` | 匿名实况反馈目录 |
| `CACHE_ROOT` | 全国站最近成功快照目录 |

`.env` 已被 Git 忽略。Token 不得写入前端、源码、测试输出或提交记录。

## 生产部署

生产发布使用 `deploy/remote-deploy.sh`。脚本会备份当前发布目录、Nginx 和 systemd 配置，运行语法检查与测试，重启服务并验证首页、API、图片、二维码及 HTTPS；任一步失败会自动回滚。

部署前必须确认：

1. 本地测试全部通过。
2. `.env` 只通过安全通道上传，不进入发布压缩包或 Git。
3. 历史和反馈目录保留在发布目录之外。
4. 线上 `/health`、`/sunset`、`/api/timeline` 与首页均通过验证。

## 进一步说明

- 完整需求与项目状态见 [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md)。
- 图片版权说明见线上 `/credits` 页面。
