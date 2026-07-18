const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchQWeatherHourly,
  mergeQWeather,
  sampleQWeather,
} = require('../src/services/qweather');

function payload() {
  return {
    code: '200',
    hourly: [
      { fxTime: '2026-07-18T18:00+08:00', text: '多云', icon: '101', precip: '0.0', pop: '20' },
      { fxTime: '2026-07-18T19:00+08:00', text: '中雨', icon: '306', precip: '3.2', pop: '88' },
    ],
  };
}

test('QWeather 72小时接口使用专属 Host、坐标和请求头', async () => {
  let request;
  const result = await fetchQWeatherHourly(
    { lat: 30.25, lon: 120.15 },
    {
      qweatherHost: 'example.re.qweatherapi.com',
      qweatherApiKey: 'test-key',
      fetchImpl: async (url, options) => {
        request = { url: String(url), headers: options.headers };
        return new Response(JSON.stringify(payload()), { status: 200 });
      },
    }
  );

  assert.equal(result.code, '200');
  assert.match(request.url, /^https:\/\/example\.re\.qweatherapi\.com\/v7\/weather\/72h\?/);
  assert.match(request.url, /location=120\.15%2C30\.25/);
  assert.equal(request.headers['X-QW-Api-Key'], 'test-key');
});

test('QWeather 取最近日落小时并只覆盖天气现象字段', () => {
  const sampled = sampleQWeather(payload(), '2026-07-18T18:49');
  assert.equal(sampled.text, '中雨');
  assert.equal(sampled.precipitationRate, 3.2);

  const merged = mergeQWeather(
    { cloudHigh: 72, visibility: 21, weatherCode: 1, precipitationRate: 0 },
    payload(),
    '2026-07-18T18:49'
  );
  assert.equal(merged.cloudHigh, 72);
  assert.equal(merged.visibility, 21);
  assert.equal(merged.weatherText, '中雨');
  assert.equal(merged.precipitationRate, 3.2);
  assert.equal(merged.precipitationProbability, 88);
  assert.equal(merged.weatherProvider, 'qweather');
});
