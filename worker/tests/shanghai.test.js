const test = require('node:test');
const assert = require('node:assert/strict');

const { predictWaitan } = require('../src/services/prediction');
const { getShanghaiPrediction } = require('../src/services/shanghai');
const { handleRequest } = require('../src/index');

function hourlyPayload(fields) {
  return {
    hourly: {
      time: ['2026-07-17T19:00', '2026-07-18T19:00', '2026-07-19T19:00'],
      ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, [value, value, value]])),
    },
  };
}

function createFetch() {
  const target = hourlyPayload({
    temperature_2m: 31,
    relative_humidity_2m: 72,
    visibility: 28000,
    cloud_cover_low: 8,
    cloud_cover_mid: 42,
    cloud_cover_high: 62,
    relative_humidity_925hPa: 76,
    relative_humidity_250hPa: 78,
    precipitation_probability: 16,
    precipitation: 0,
    rain: 0,
    weather_code: 1,
  });
  const near = hourlyPayload({ cloud_cover_low: 6, visibility: 22000 });
  const far = hourlyPayload({
    cloud_cover_low: 9,
    visibility: 30000,
    relative_humidity_850hPa: 76,
    relative_humidity_250hPa: 68,
  });
  const air = { status: 'ok', data: { aqi: 52, iaqi: { pm25: { v: 45 } } } };

  return async url => {
    let payload;
    if (url.includes('api.waqi.info')) payload = air;
    else if (url.includes('latitude=31.24')) payload = target;
    else if (url.includes('latitude=31.15')) payload = near;
    else payload = far;
    return new Response(JSON.stringify(payload), { status: 200 });
  };
}

test('外滩模型输出完整站点地图与城市摄影修正', () => {
  const result = predictWaitan(
    {
      cloudHigh: 62, cloudMid: 42, cloudLow: 8, visibility: 32, humidity: 72,
      precipitation: 0, precipitationRate: 0, precipitationProbability: 16, rain: 0, rainRate: 0, weatherCode: 1,
    },
    {
      '青浦窗口': { cloudLow: 6, visibility: 22 },
      '苏州窗口': { cloudLow: 9, visibility: 30, humidity850: 76 },
    },
    { available: true, aqi: 52, pm25: 45 }
  );

  assert.equal(result.spot, 'waitan');
  assert.equal(result.spotName, '上海外滩');
  assert.equal(result.color.label, '赛博粉紫');
  assert.equal(result.alpenglow.available, true);
  assert.equal(result.windows.find(item => item.name === '苏州窗口').status, 'CLEAR');
  assert.equal(result.best_spots.length, 2);
  assert.match(result.photographyAdvice, /外滩亮灯瞬间/);
  assert.equal(typeof result.probability, 'number');
  assert.deepEqual(result.metrics, {
    cloudLow: 8,
    cloudMid: 42,
    cloudHigh: 62,
    visibilityKm: 32,
    windowTransparency: 91,
    humidity250: undefined,
    precipitationMm: 0,
    precipitationRateMmH: 0,
    precipitationProbability: 16,
    weatherCode: 1,
  });
  assert.equal(result.weather.label, '多云');
});

test('850hPa 极高湿会强制扣除通透分', () => {
  const weather = { cloudHigh: 62, cloudMid: 42, cloudLow: 8, visibility: 18, humidity: 78 };
  const clear = predictWaitan(weather, {
    '青浦窗口': { cloudLow: 10, visibility: 18 },
    '苏州窗口': { cloudLow: 12, visibility: 18, humidity850: 80 },
  });
  const humid = predictWaitan(weather, {
    '青浦窗口': { cloudLow: 10, visibility: 18 },
    '苏州窗口': { cloudLow: 12, visibility: 18, humidity850: 98 },
  });

  assert.ok(humid.quality < clear.quality);
  assert.ok(humid.corrections.some(item => item.item === '850hPa 高湿'));
});

test('数据服务并行解析三日预报和 WAQI', async () => {
  const result = await getShanghaiPrediction({ fetchImpl: createFetch(), waqiToken: 'test-token' });

  assert.equal(result.quality > 0, true);
  assert.equal(result.forecast.length, 3);
  assert.equal(result.days.length, 3);
  assert.equal(typeof result.probability, 'number');
  assert.equal(result.sourceStatus.ecmwf, 'connected');
  assert.equal(result.sourceStatus.waqi, 'connected');
  assert.equal(result.sourceStatus.precipitation, 'connected');
  assert.equal(result.weather.label, '多云');
  assert.equal(result.statusText, '上海站 · Beta');
});

test('WAQI 未配置时气象预测正常降级', async () => {
  const result = await getShanghaiPrediction({ fetchImpl: createFetch() });

  assert.equal(result.airQuality.available, false);
  assert.equal(result.sourceStatus.waqi, 'not-configured');
  assert.equal(result.confidence, 'medium');
});

test('Worker 路由返回外滩预测 JSON', async () => {
  const response = await handleRequest(
    new Request('https://sunsetpredict.cloud/api/spot/waitan'),
    { WAQI_TOKEN: 'test-token', fetch: createFetch() }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.spot, 'waitan');
});
