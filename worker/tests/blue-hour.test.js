const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBlueHour,
  calculateBlueHourScore,
  getBlueHourTimes,
} = require('../src/services/blue-hour');

test('SunCalc 按太阳高度 -4° 到 -8° 计算西湖蓝调窗口', () => {
  const times = getBlueHourTimes('2026-07-18', 30.25, 120.15);
  assert.equal(times.start, '19:20');
  assert.equal(times.end, '19:41');
  assert.ok(times.durationMinutes >= 15 && times.durationMinutes <= 25);
});

test('蓝调质量严格使用能见度70%与总云量30%', () => {
  assert.equal(calculateBlueHourScore({ visibility: 24, cloudTotal: 0 }).score, 100);
  assert.equal(calculateBlueHourScore({ visibility: 12, cloudTotal: 50 }).score, 50);
  assert.equal(calculateBlueHourScore({ visibility: 0, cloudTotal: 100 }).score, 0);
});

test('外滩蓝调输出时间、质量、AQI提示与城市摄影参数', () => {
  const result = buildBlueHour({
    date: '2026-07-18',
    latitude: 31.24,
    longitude: 121.49,
    weather: { visibility: 20, cloudTotal: 20 },
    airQuality: { aqi: 42 },
    spotId: 'waitan',
  });
  assert.equal(result.available, true);
  assert.equal(result.source, 'suncalc-2.0.1');
  assert.equal(result.camera.whiteBalance, '3800K');
  assert.match(result.advice, /外滩全景与金色灯光/);
  assert.match(result.airQualityHint, /空气清洁/);
});
