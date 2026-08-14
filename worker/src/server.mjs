import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getXihuPrediction } = require('./services/xihu');
const { getShanghaiPrediction } = require('./services/shanghai');
const { CITY_ALIASES, CITY_SPOTS, FORECAST_SPOTS, PROVINCE_SPOTS, getAllCityPredictions } = require('./services/cities');
const { SatelliteNowcast } = require('./services/satellite');
const { clientIpFromRequest, findNearestSpotByIp } = require('./services/nearby');
const { buildForecastBootstrap, injectForecastBootstrap, shanghaiDate } = require('./services/frontend-bootstrap');
const { createMemoryCache } = require('./services/memory-cache');
const {
  buildSpotConfig,
  injectSeoDocument,
  spotSlugFromPath,
} = require('./services/seo');
const { buildTimeline, loadHistoryDay } = require('./services/timeline');
const {
  FeedbackError,
  feedbackAvailability,
  findPredictionInTimeline,
  getFeedbackStats,
  loadFeedbackMessages,
  loadFeedbackPhoto,
  loadTopPhotos,
  normalizeFeedbackPayload,
  paginateFeedbackMessages,
  saveFeedback,
} = require('./services/feedback');
const { getAdvertiserConfig, setAdvertiserConfig } = require('./services/advertisers');

const PORT = Number(process.env.PORT || 3001);
const APP_ROOT = process.env.APP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FRONTEND_ROOT = path.join(APP_ROOT, 'frontend');
const HISTORY_ROOT = process.env.HISTORY_ROOT || path.join(APP_ROOT, 'data/history');
const FEEDBACK_ROOT = process.env.FEEDBACK_ROOT || path.join(APP_ROOT, 'data/feedback');
const CACHE_ROOT = process.env.CACHE_ROOT || path.join(APP_ROOT, 'data/cache');
const REGIONAL_CACHE_FILE = path.join(CACHE_ROOT, 'regional-latest.json');
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = createMemoryCache(CACHE_TTL_MS);
const feedbackCache = createMemoryCache(30 * 1000);
const SEO_SPOTS = buildSpotConfig(CITY_SPOTS, PROVINCE_SPOTS);
const FEEDBACK_ORIGINS = new Set([
  'https://sunsetpredict.cloud',
  'https://glowsunset.cn',
  'https://www.glowsunset.cn',
]);

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/credits', ['credits.html', 'text/html; charset=utf-8']],
  ['/credits/', ['credits.html', 'text/html; charset=utf-8']],
  ['/about', ['about.html', 'text/html; charset=utf-8']],
  ['/about/', ['about.html', 'text/html; charset=utf-8']],
  ['/robots.txt', ['robots.txt', 'text/plain; charset=utf-8']],
  ['/llms.txt', ['llms.txt', 'text/plain; charset=utf-8']],
  ['/sitemap.xml', ['sitemap.xml', 'application/xml; charset=utf-8']],
  ['/google644a617b7e117520.html', ['google644a617b7e117520.html', 'text/html; charset=utf-8']],
  ['/css/styles.css', ['css/styles.css', 'text/css; charset=utf-8']],
  ['/js/app.js', ['js/app.js', 'text/javascript; charset=utf-8']],
  ['/assets/xihu-sunset.webp', ['assets/xihu-sunset.webp', 'image/webp']],
  ['/assets/waitan-sunset.webp', ['assets/waitan-sunset.webp', 'image/webp']],
  ['/assets/city-generic-sunset.webp', ['assets/city-generic-sunset.webp', 'image/webp']],
  ['/assets/city-beijing.webp', ['assets/city-beijing.webp', 'image/webp']],
  ['/assets/city-erhai.webp', ['assets/city-erhai.webp', 'image/webp']],
  ['/assets/city-chongqing.webp', ['assets/city-chongqing.webp', 'image/webp']],
  ['/assets/city-xiamen.webp', ['assets/city-xiamen.webp', 'image/webp']],
  ['/assets/city-qingdao.webp', ['assets/city-qingdao.webp', 'image/webp']],
  ['/assets/city-chengdu.webp', ['assets/city-chengdu.webp', 'image/webp']],
  ['/assets/city-shenzhen.webp', ['assets/city-shenzhen.webp', 'image/webp']],
  ['/assets/city-huangshan.webp', ['assets/city-huangshan.webp', 'image/webp']],
  ['/assets/city-guangzhou.webp', ['assets/city-guangzhou.webp', 'image/webp']],
  ['/assets/city-wuhan.webp', ['assets/city-wuhan.webp', 'image/webp']],
  ['/assets/city-sanya.webp', ['assets/city-sanya.webp', 'image/webp']],
  ['/assets/city-xian.webp', ['assets/city-xian.webp', 'image/webp']],
  ['/assets/city-nanjing.webp', ['assets/city-nanjing.webp', 'image/webp']],
  ['/assets/city-xiapu.webp', ['assets/city-xiapu.webp', 'image/webp']],
  ['/assets/city-wuxi.webp', ['assets/city-wuxi.webp', 'image/webp']],
  ['/assets/city-hongkong.webp', ['assets/city-hongkong.webp', 'image/webp']],
  ['/assets/city-dunhuang.webp', ['assets/city-dunhuang.webp', 'image/webp']],
  ['/assets/business.jpg', ['assets/business.jpg', 'image/jpeg']],
  ['/assets/wechat-pay.jpg', ['assets/wechat-pay.jpg', 'image/jpeg']],
  ['/wechat-pay.jpg', ['assets/wechat-pay.jpg', 'image/jpeg']],
]);
for (const slug of Object.keys(PROVINCE_SPOTS)) {
  STATIC_FILES.set(`/assets/city-${slug}.webp`, [`assets/city-${slug}.webp`, 'image/webp']);
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function sendJson(response, status, data) {
  send(response, status, JSON.stringify(data), {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
}

function sendPrivateJson(response, status, data) {
  send(response, status, JSON.stringify(data), {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
}

async function readJsonBody(request, maxBytes = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new FeedbackError('请求内容过大', 413, 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new FeedbackError('JSON 格式无效');
  }
}

async function cached(key, loader) {
  return cache.get(key, loader);
}

// 卫星实况 nowcast (Himawari 真彩): SATELLITE_NOWCAST=off 可禁用; 失败自动降级为纯预报
const satelliteNowcast = process.env.SATELLITE_NOWCAST === 'off' ? null : new SatelliteNowcast();
if (satelliteNowcast) satelliteNowcast.start();

const loadRegionalSpots = () => getAllCityPredictions({
  cacheFile: REGIONAL_CACHE_FILE,
  satellite: satelliteNowcast,
});

async function loadTimeline() {
  const [xihu, waitan, regional] = await Promise.all([
    cached('xihu', () => getXihuPrediction()),
    cached('waitan', () => getShanghaiPrediction()),
    cached('regional-spots', loadRegionalSpots),
  ]);
  return buildTimeline(xihu, waitan, regional, HISTORY_ROOT);
}

// 最近站点仅后台可见：前台已不展示，页面访问时把访客的城市级最近站点
// 异步写入服务端日志（journalctl 可查），不阻塞响应，失败静默。
function logNearbySpot(request, requestPath) {
  const clientIp = clientIpFromRequest(request);
  if (!clientIp) return;
  findNearestSpotByIp(clientIp)
    .then(nearby => {
      const spot = nearby?.nearestSpot;
      if (!spot) return;
      console.info(`[nearby] path=${requestPath} 最近站点=${spot.spotName} 距离≈${spot.distanceKm}km`);
    })
    .catch(() => {});
}

async function serveStatic(requestPath, response, request) {
  const spotSlug = spotSlugFromPath(requestPath, SEO_SPOTS);
  const entry = STATIC_FILES.get(requestPath) || (spotSlug ? ['index.html', 'text/html; charset=utf-8'] : null);
  if (!entry) {
    // 通用前端文件兜底：服务 FRONTEND_ROOT 下未在 STATIC_FILES 显式注册的文件（如 /css/fonts.css、/assets/fonts/*.woff2）。
    // 仅对非 /api 路径、且文件真实存在于 FRONTEND_ROOT 内（带路径穿越保护）时返回，缺失则最终 404。
    // 置于 STATIC_FILES 判断之后，确保 sitemap.xml 等已注册资源仍走其声明的 content-type。
    if (!requestPath.startsWith('/api/')) {
      const filePath = path.join(FRONTEND_ROOT, requestPath);
      const resolved = path.resolve(filePath);
      const rootResolved = path.resolve(FRONTEND_ROOT);
      if (resolved === rootResolved || resolved.startsWith(rootResolved + path.sep)) {
        try {
          const body = await fs.readFile(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const contentType = ({'.woff2':'font/woff2','.woff':'font/woff','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.html':'text/html; charset=utf-8','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'}[ext] || 'application/octet-stream');
          send(response, 200, body, {
            'content-type': contentType,
            'cache-control': 'public, max-age=86400',
            ...(String(contentType).startsWith('text/') || ext === '.xml' ? { 'content-language': 'zh-CN' } : {}),
          });
          return true;
        } catch {
          // 文件不存在，最终 404
        }
      }
    }
    return false;
  }
  const [relativePath, contentType] = entry;
  let body = await fs.readFile(path.join(FRONTEND_ROOT, relativePath));
  const servesApp = requestPath === '/' || Boolean(spotSlug);
  if (servesApp) {
    if (request) logNearbySpot(request, requestPath);
    const today = shanghaiDate();
    const day = await loadHistoryDay(HISTORY_ROOT, today);
    // SEO 照片墙：地点页附带该站历史高分实拍（SQLite）；查询失败不阻塞页面渲染
    let topPhotos = [];
    if (spotSlug) {
      try {
        topPhotos = loadTopPhotos(FEEDBACK_ROOT, spotSlug, 9);
      } catch (error) {
        console.warn(`[seo] 照片墙查询失败 spot=${spotSlug}:`, error.message);
      }
    }
    body = injectForecastBootstrap(body.toString('utf8'), buildForecastBootstrap(day, today));
    body = injectSeoDocument(body, {
      citySpots: CITY_SPOTS,
      provinceSpots: PROVINCE_SPOTS,
      slug: spotSlug,
      day,
      photos: topPhotos,
      googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION,
      baiduSiteVerification: process.env.BAIDU_SITE_VERIFICATION,
    });
  }
  send(response, 200, body, {
    'content-type': contentType,
    ...(contentType.startsWith('text/html') ? { 'content-language': 'zh-CN' } : {}),
    'cache-control': servesApp ? 'no-cache' : 'public, max-age=86400',
  });
  return true;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  try {
    if (request.method === 'OPTIONS') {
      send(response, 204, '', {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      return;
    }

    if (request.method === 'POST' && (url.pathname === '/api/feedback' || url.pathname === '/api/feedback/')) {
      const origin = request.headers.origin;
      if (origin && !FEEDBACK_ORIGINS.has(origin)) {
        sendPrivateJson(response, 403, { error: '来源无效', code: 'INVALID_ORIGIN' });
        return;
      }
      try {
        const rawPayload = await readJsonBody(request, 2 * 1024 * 1024);
        const payload = normalizeFeedbackPayload(rawPayload);
        const timeline = await cached('timeline', loadTimeline);
        const prediction = findPredictionInTimeline(timeline, payload.spot, payload.date);
        if (!prediction) throw new FeedbackError('该站点日期没有可校准预测', 404, 'PREDICTION_NOT_FOUND');
        const availability = feedbackAvailability(payload.date, prediction);
        if (!availability.open) {
          throw new FeedbackError(availability.reason, 409, availability.code);
        }
        const saved = await saveFeedback(FEEDBACK_ROOT, rawPayload, prediction);
        feedbackCache.delete(payload.spot);
        sendPrivateJson(response, 200, {
          ok: true,
          updated: saved.updated,
          photoSaved: Boolean(saved.record.photo),
          commentSaved: Boolean(saved.record.comment),
          recordedAt: saved.record.recordedAt,
          message: '留言已发布。',
        });
      } catch (error) {
        if (error instanceof FeedbackError) {
          sendPrivateJson(response, error.status, { error: error.message, code: error.code });
          return;
        }
        throw error;
      }
      return;
    }

    if (
      url.pathname === '/api/advertisers' ||
      url.pathname === '/api/advertisers/'
    ) {
      if (request.method === 'GET') {
        sendJson(response, 200, getAdvertiserConfig());
        return;
      }
      if (request.method === 'POST') {
        if (!process.env.ADMIN_TOKEN) {
          sendPrivateJson(response, 503, {
            error: '服务端未配置 ADMIN_TOKEN',
            code: 'ADMIN_DISABLED',
          });
          return;
        }
        if (request.headers['x-admin-token'] !== process.env.ADMIN_TOKEN) {
          sendPrivateJson(response, 403, {
            error: '管理员令牌无效',
            code: 'INVALID_ADMIN_TOKEN',
          });
          return;
        }
        try {
          const raw = await readJsonBody(request, 16 * 1024);
          const result = setAdvertiserConfig(undefined, raw && raw.payload);
          sendJson(response, 200, {
            ok: true,
            updatedAt: result.updatedAt,
            data: result.data,
          });
        } catch (error) {
          if (error instanceof FeedbackError) throw error;
          sendPrivateJson(response, 400, {
            error: error.message || '参数无效',
            code: 'INVALID_PAYLOAD',
          });
        }
        return;
      }
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const feedbackPhotoMatch = url.pathname.match(/^\/api\/feedback\/photo\/(\d{4}-\d{2}-\d{2})\/([a-f0-9]{64}\.(?:jpg|png|webp))$/);
    if (feedbackPhotoMatch) {
      const photo = await loadFeedbackPhoto(FEEDBACK_ROOT, feedbackPhotoMatch[1], feedbackPhotoMatch[2]);
      send(response, 200, photo.body, {
        'content-type': photo.contentType,
        'cache-control': 'public, max-age=300',
      });
      return;
    }

    if (url.pathname === '/api/feedback/stats' || url.pathname === '/api/feedback/stats/') {
      sendJson(response, 200, { stats: getFeedbackStats(FEEDBACK_ROOT) });
      return;
    }

    // GEO 爬虫统计：读独立 nginx 日志，仅聚合计数（不返回原始行/IP）
    if (url.pathname === '/api/geo-stats' || url.pathname === '/api/geo-stats/') {
      sendJson(response, 200, await getGeoStats());
      return;
    }

    if (url.pathname === '/api/feedback' || url.pathname === '/api/feedback/') {
      const spot = String(url.searchParams.get('spot') || '');
      const messages = await feedbackCache.get(spot, () => loadFeedbackMessages(FEEDBACK_ROOT, spot));
      sendJson(response, 200, {
        spot,
        ...paginateFeedbackMessages(messages, url.searchParams.get('cursor'), url.searchParams.get('limit')),
      });
      return;
    }

    if (url.pathname === '/health') {
      sendJson(response, 200, { ok: true, services: ['xihu-v3', 'waitan-v4', 'regional-v3', 'qweather-weather-v1', 'blue-hour-v1', 'timeline-v2', 'feedback-v3', 'frontend-bootstrap-v1', 'nearby-ip-city-v1'] });
      return;
    }

    if (url.pathname === '/api/nearby' || url.pathname === '/api/nearby/') {
      const clientIp = clientIpFromRequest(request);
      const nearby = clientIp ? await findNearestSpotByIp(clientIp) : null;
      sendPrivateJson(response, 200, nearby || {
        available: false,
        accuracy: 'unknown',
        nearestSpot: null,
      });
      return;
    }

    if (url.pathname === '/api/timeline' || url.pathname === '/api/timeline/') {
      sendJson(response, 200, await cached('timeline', loadTimeline));
      return;
    }

    if (url.pathname === '/sunset' || url.pathname === '/sunset/') {
      sendJson(response, 200, await cached('xihu', () => getXihuPrediction()));
      return;
    }

    if (
      url.pathname === '/api/spot/waitan' ||
      url.pathname === '/api/spot/waitan/' ||
      url.pathname === '/sunset/waitan'
    ) {
      sendJson(response, 200, await cached('waitan', () => getShanghaiPrediction()));
      return;
    }

    if (url.pathname === '/api/spots' || url.pathname === '/api/spots/') {
      sendJson(response, 200, await cached('regional-spots', loadRegionalSpots));
      return;
    }

    const cityMatch = url.pathname.match(/^\/api\/spot\/([a-z-]+)\/?$/);
    if (cityMatch && (FORECAST_SPOTS[cityMatch[1]] || CITY_ALIASES[cityMatch[1]])) {
      const slug = CITY_ALIASES[cityMatch[1]] || cityMatch[1];
      const regional = await cached('regional-spots', loadRegionalSpots);
      const prediction = regional.spots.find(spot => spot.spot === slug);
      if (!prediction) throw new Error(`站点数据缺失: ${slug}`);
      sendJson(response, 200, prediction);
      return;
    }

    if (await serveStatic(url.pathname, response, request)) return;
    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    if (error instanceof FeedbackError) {
      sendPrivateJson(response, error.status, { error: error.message, code: error.code });
      return;
    }
    sendJson(response, 502, { error: 'Prediction service unavailable', detail: error.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Sunset Predict listening on 127.0.0.1:${PORT}`);
});

const historyTimer = setInterval(() => {
  cache.delete('timeline');
  loadTimeline().catch(error => console.error(`Timeline snapshot failed: ${error.message}`));
}, 6 * 60 * 60 * 1000);
historyTimer.unref();

function shutdown() {
  clearInterval(historyTimer);
  if (satelliteNowcast) satelliteNowcast.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}

// GEO 爬虫监控：读取本站的独立 nginx 访问日志，仅返回聚合计数（不泄露原始行/IP）。
// 日志由 sunset.conf 的 access_log 指令生成；本地开发/测试环境文件不存在时返回 available:false。
const GEO_LOG_FILE = '/var/log/nginx/sunsetpredict.access.log';
const GEO_CRAWLERS = {
  GPTBot: /GPTBot/i,
  ClaudeBot: /ClaudeBot/i,
  PerplexityBot: /PerplexityBot/i,
  'Google-Extended': /Google-Extended/i,
  'ChatGPT-User': /ChatGPT-User/i,
  CCBot: /CCBot/i,
  Bytespider: /Bytespider/i,
  Applebot: /Applebot/i,
  DuckDuckBot: /DuckDuckBot/i,
  Bingbot: /Bingbot/i,
  YandexBot: /YandexBot/i,
};

let geoStatsCache = { ts: 0, data: null };
const GEO_CACHE_TTL = 5 * 60 * 1000;

async function getGeoStats() {
  const now = Date.now();
  if (geoStatsCache.data && now - geoStatsCache.ts < GEO_CACHE_TTL) return geoStatsCache.data;
  const result = {
    logFile: GEO_LOG_FILE,
    available: false,
    totalRequests: 0,
    aiCrawlers: Object.fromEntries(Object.keys(GEO_CRAWLERS).map(k => [k, 0])),
    llmsTxt: { total: 0, byAi: Object.fromEntries(Object.keys(GEO_CRAWLERS).map(k => [k, 0])) },
  };
  try {
    const content = await fs.readFile(GEO_LOG_FILE, 'utf8');
    result.available = true;
    const lines = content.split('\n');
    result.totalRequests = lines.length - 1;
    const isLlms = line => /"[A-Z]+\s\/llms\.txt[^\"]*\sHTTP/.test(line);
    for (const line of lines) {
      if (!line) continue;
      let matched = null;
      for (const name of Object.keys(GEO_CRAWLERS)) {
        if (GEO_CRAWLERS[name].test(line)) { matched = name; break; }
      }
      if (!matched) continue;
      result.aiCrawlers[matched] += 1;
      if (isLlms(line)) result.llmsTxt.byAi[matched] += 1;
      if (isLlms(line)) result.llmsTxt.total += 1;
    }
  } catch (error) {
    result.error = error.code || String(error.message);
  }
  geoStatsCache = { ts: now, data: result };
  return result;
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
