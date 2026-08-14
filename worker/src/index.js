const { getShanghaiPrediction } = require('./services/shanghai');
const { CITY_ALIASES, FORECAST_SPOTS, getAllCityPredictions, getCityPrediction } = require('./services/cities');

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=600',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function handleRequest(request, env = {}) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...JSON_HEADERS,
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }

  if (request.method === 'GET' && (url.pathname === '/api/spot/waitan' || url.pathname === '/sunset/waitan')) {
    try {
      const prediction = await getShanghaiPrediction({
        waqiToken: env.WAQI_TOKEN,
        fetchImpl: env.fetch || globalThis.fetch,
      });
      return json(prediction);
    } catch (error) {
      return json({ error: '上海预测数据暂时不可用', detail: error.message }, 502);
    }
  }

  if (request.method === 'GET' && (url.pathname === '/api/spots' || url.pathname === '/api/spots/')) {
    try {
      return json(await getAllCityPredictions({ fetchImpl: env.fetch || globalThis.fetch }));
    } catch (error) {
      return json({ error: '全国站点数据暂时不可用', detail: error.message }, 502);
    }
  }

  const cityMatch = url.pathname.match(/^\/api\/spot\/([a-z-]+)\/?$/);
  if (request.method === 'GET' && cityMatch && (FORECAST_SPOTS[cityMatch[1]] || CITY_ALIASES[cityMatch[1]])) {
    try {
      return json(await getCityPrediction(cityMatch[1], { fetchImpl: env.fetch || globalThis.fetch }));
    } catch (error) {
      return json({ error: '站点预测数据暂时不可用', detail: error.message }, 502);
    }
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, services: ['waitan-v3', 'regional-v2'] });
  }

  return json({ error: 'Not found' }, 404);
}

if (typeof addEventListener === 'function') {
  addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request, globalThis));
  });
}

module.exports = { handleRequest };
