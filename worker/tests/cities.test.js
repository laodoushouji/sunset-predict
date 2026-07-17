const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  CITY_SPOTS,
  getAllCityPredictions,
  getCityPrediction,
  predictRegionalSpot,
  resolveWindowPoint,
} = require('../src/services/cities');
const { handleRequest } = require('../src/index');

function targetPayload() {
  return {
    hourly: {
      time: ['2026-07-17T19:00', '2026-07-18T19:00', '2026-07-19T19:00'],
      temperature_2m: [27, 27, 27],
      relative_humidity_2m: [68, 68, 68],
      visibility: [24000, 24000, 24000],
      cloud_cover_low: [8, 8, 8],
      cloud_cover_mid: [42, 42, 42],
      cloud_cover_high: [62, 62, 62],
      wind_speed_10m: [4, 4, 4],
      wind_direction_10m: [270, 270, 270],
      pressure_msl: [1010, 1011, 1012],
      relative_humidity_925hPa: [96, 96, 96],
      relative_humidity_700hPa: [25, 25, 25],
      relative_humidity_250hPa: [78, 78, 78],
      wind_speed_700hPa: [5, 5, 5],
      precipitation_probability: [12, 12, 12],
      precipitation: [0, 0, 0],
      rain: [0, 0, 0],
      weather_code: [1, 1, 1],
    },
    daily: {
      time: ['2026-07-17', '2026-07-18', '2026-07-19'],
      sunrise: ['2026-07-17T05:00', '2026-07-18T05:01', '2026-07-19T05:02'],
      sunset: ['2026-07-17T19:00', '2026-07-18T19:00', '2026-07-19T19:00'],
    },
  };
}

function windowPayload() {
  return {
    hourly: {
      time: ['2026-07-17T19:00', '2026-07-18T19:00', '2026-07-19T19:00'],
      cloud_cover_low: [6, 6, 6],
      visibility: [26000, 26000, 26000],
    },
  };
}

function createFetch() {
  return async url => {
    const payload = url.includes('&daily=') ? targetPayload() : windowPayload();
    const locations = new URL(url).searchParams.get('latitude').split(',').length;
    return new Response(JSON.stringify(locations > 1 ? Array(locations).fill(payload) : payload), { status: 200 });
  };
}

test('配置包含 8 个新增摄影站点', () => {
  assert.deepEqual(Object.keys(CITY_SPOTS), [
    'beijing', 'erhai', 'chongqing', 'xiamen',
    'qingdao', 'chengdu', 'shenzhen', 'huangshan',
  ]);
});

test('通用模型应用西方窗口和站点摄影钩子', () => {
  const result = predictRegionalSpot(
    CITY_SPOTS.shenzhen,
    { cloudHigh: 62, cloudMid: 42, cloudLow: 8, visibility: 24, humidity: 68 },
    { cloudLow: 6, visibility: 26 }
  );

  assert.equal(result.spot, 'shenzhen');
  assert.equal(result.windows[0].status, 'CLEAR');
  assert.match(result.photographyAdvice, /蓝调预警/);
  assert.ok(result.probability >= 90);
  assert.equal(typeof result.verdict, 'string');
});

test('单站数据服务返回三日预测与日落时间', async () => {
  const result = await getCityPrediction('beijing', { fetchImpl: createFetch() });

  assert.equal(result.spot, 'beijing');
  assert.equal(result.forecast.length, 3);
  assert.equal(result.days.length, 3);
  assert.equal(result.sunTimes.sunset, '19:00');
  assert.equal(result.sourceStatus.westernWindow, 'connected');
  assert.equal(typeof result.quality, 'number');
  assert.equal(typeof result.rawQuality, 'number');
  assert.equal(result.quality, result.rawQuality);
  assert.equal(typeof result.probability, 'number');
  assert.deepEqual(result.metrics, {
    cloudLow: 8,
    cloudMid: 42,
    cloudHigh: 62,
    visibilityKm: 24,
    windowTransparency: 94,
    humidity250: 78,
    precipitationMm: 0,
    precipitationRateMmH: 0,
    precipitationProbability: 12,
    weatherCode: 1,
  });
  assert.equal(result.weather.label, '多云');
  assert.equal(result.sourceStatus.precipitation, 'connected');
});

test('黄山数据服务将925/700hPa湿度作为云底代理', async () => {
  const result = await getCityPrediction('huangshan', { fetchImpl: createFetch() });

  assert.equal(result.dataAvailability.cloudBaseHeight, 'pressure-level-proxy');
  assert.equal(result.sourceStatus.cloudBaseHeight, 'pressure-level-proxy');
  assert.ok(result.corrections.some(item => item.item === '压力层云海'));
});

test('成都远程窗口按日落方位角布置在150km外', () => {
  const point = resolveWindowPoint(CITY_SPOTS.chengdu, '2026-07-17');
  const radians = Math.PI / 180;
  const dLat = (point.lat - CITY_SPOTS.chengdu.target.lat) * radians;
  const dLon = (point.lon - CITY_SPOTS.chengdu.target.lon) * radians;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(CITY_SPOTS.chengdu.target.lat * radians) * Math.cos(point.lat * radians) * Math.sin(dLon / 2) ** 2;
  const distance = 6371 * 2 * Math.asin(Math.sqrt(a));
  assert.ok(Math.abs(distance - 150) < 0.1);
});

test('jingshan API 别名复用北京景山模型', async () => {
  const result = await getCityPrediction('jingshan', { fetchImpl: createFetch() });
  assert.equal(result.spot, 'beijing');
  assert.equal(result.source, 'beijing-model-v3');
});

test('聚合服务返回全部 8 个站点', async () => {
  let requests = 0;
  const fetchImpl = async url => {
    requests += 1;
    return createFetch()(url);
  };
  const result = await getAllCityPredictions({ fetchImpl });

  assert.equal(result.spots.length, 8);
  assert.equal(requests, 2);
  assert.equal(result.spots.every(item => typeof item.quality === 'number'), true);
  assert.equal(result.spots.every(item => typeof item.rawQuality === 'number'), true);
  assert.equal(result.spots.every(item => typeof item.probability === 'number'), true);
  assert.equal(result.spots.every(item => Number.isFinite(item.metrics?.windowTransparency)), true);
  assert.equal(result.spots.every(item => item.weather?.label === '多云'), true);
});

test('全国站上游失败时返回完整的最近成功快照', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sunset-regional-'));
  const cacheFile = path.join(directory, 'latest.json');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const live = await getAllCityPredictions({ fetchImpl: createFetch(), cacheFile });
  const fallback = await getAllCityPredictions({
    fetchImpl: async () => new Response('{}', { status: 503 }),
    cacheFile,
    retryOptions: { attempts: 1, baseDelayMs: 0 },
  });

  assert.equal(live.cacheStatus, 'live');
  assert.equal(fallback.cacheStatus, 'stale');
  assert.equal(fallback.spots.length, 8);
  assert.equal(fallback.spots.every(item => typeof item.quality === 'number' && !item.error), true);
  assert.equal(fallback.spots.every(item => item.sourceStatus.openMeteo === 'stale-cache'), true);
});

test('Worker 路由返回北京站预测', async () => {
  const response = await handleRequest(
    new Request('https://sunsetpredict.cloud/api/spot/beijing'),
    { fetch: createFetch() }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.spot, 'beijing');
  assert.equal(body.forecast.length, 3);
});
