import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getXihuPrediction } = require('./services/xihu');
const { getShanghaiPrediction } = require('./services/shanghai');
const { CITY_ALIASES, CITY_SPOTS, getAllCityPredictions } = require('./services/cities');
const { buildForecastBootstrap, injectForecastBootstrap, shanghaiDate } = require('./services/frontend-bootstrap');
const { createMemoryCache } = require('./services/memory-cache');
const { buildTimeline, loadHistoryDay } = require('./services/timeline');
const {
  FeedbackError,
  feedbackAvailability,
  findPredictionInTimeline,
  loadFeedbackMessages,
  loadFeedbackPhoto,
  normalizeFeedbackPayload,
  paginateFeedbackMessages,
  saveFeedback,
} = require('./services/feedback');

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

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/credits', ['credits.html', 'text/html; charset=utf-8']],
  ['/credits/', ['credits.html', 'text/html; charset=utf-8']],
  ['/robots.txt', ['robots.txt', 'text/plain; charset=utf-8']],
  ['/sitemap.xml', ['sitemap.xml', 'application/xml; charset=utf-8']],
  ['/css/styles.css', ['css/styles.css', 'text/css; charset=utf-8']],
  ['/js/app.js', ['js/app.js', 'text/javascript; charset=utf-8']],
  ['/assets/xihu-sunset.webp', ['assets/xihu-sunset.webp', 'image/webp']],
  ['/assets/waitan-sunset.webp', ['assets/waitan-sunset.webp', 'image/webp']],
  ['/assets/city-beijing.webp', ['assets/city-beijing.webp', 'image/webp']],
  ['/assets/city-erhai.webp', ['assets/city-erhai.webp', 'image/webp']],
  ['/assets/city-chongqing.webp', ['assets/city-chongqing.webp', 'image/webp']],
  ['/assets/city-xiamen.webp', ['assets/city-xiamen.webp', 'image/webp']],
  ['/assets/city-qingdao.webp', ['assets/city-qingdao.webp', 'image/webp']],
  ['/assets/city-chengdu.webp', ['assets/city-chengdu.webp', 'image/webp']],
  ['/assets/city-shenzhen.webp', ['assets/city-shenzhen.webp', 'image/webp']],
  ['/assets/city-huangshan.webp', ['assets/city-huangshan.webp', 'image/webp']],
  ['/assets/business.jpg', ['assets/business.jpg', 'image/jpeg']],
  ['/assets/wechat-pay.jpg', ['assets/wechat-pay.jpg', 'image/jpeg']],
  ['/wechat-pay.jpg', ['assets/wechat-pay.jpg', 'image/jpeg']],
]);

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

const loadRegionalSpots = () => getAllCityPredictions({ cacheFile: REGIONAL_CACHE_FILE });

async function loadTimeline() {
  const [xihu, waitan, regional] = await Promise.all([
    cached('xihu', () => getXihuPrediction()),
    cached('waitan', () => getShanghaiPrediction()),
    cached('regional-spots', loadRegionalSpots),
  ]);
  return buildTimeline(xihu, waitan, regional, HISTORY_ROOT);
}

async function serveStatic(requestPath, response) {
  const entry = STATIC_FILES.get(requestPath);
  if (!entry) return false;
  const [relativePath, contentType] = entry;
  let body = await fs.readFile(path.join(FRONTEND_ROOT, relativePath));
  if (requestPath === '/') {
    const today = shanghaiDate();
    const day = await loadHistoryDay(HISTORY_ROOT, today);
    body = injectForecastBootstrap(body.toString('utf8'), buildForecastBootstrap(day, today));
  }
  send(response, 200, body, {
    'content-type': contentType,
    'cache-control': requestPath === '/' ? 'no-cache' : 'public, max-age=86400',
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
      if (origin && origin !== 'https://sunsetpredict.cloud') {
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
      sendJson(response, 200, { ok: true, services: ['xihu-v3', 'waitan-v4', 'regional-v3', 'qweather-weather-v1', 'blue-hour-v1', 'timeline-v2', 'feedback-v3', 'frontend-bootstrap-v1'] });
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
    if (cityMatch && (CITY_SPOTS[cityMatch[1]] || CITY_ALIASES[cityMatch[1]])) {
      const slug = CITY_ALIASES[cityMatch[1]] || cityMatch[1];
      const regional = await cached('regional-spots', loadRegionalSpots);
      const prediction = regional.spots.find(spot => spot.spot === slug);
      if (!prediction) throw new Error(`站点数据缺失: ${slug}`);
      sendJson(response, 200, prediction);
      return;
    }

    if (await serveStatic(url.pathname, response)) return;
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
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
