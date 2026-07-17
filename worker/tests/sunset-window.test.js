const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSunsetWindow,
  buildWindowTimes,
  sampleHourly,
} = require('../src/services/sunset-window');

test('日落窗口对齐为最多六个整点或半点节点', () => {
  assert.deepEqual(buildWindowTimes('2026-07-17', '19:04'), [
    '2026-07-17T17:00',
    '2026-07-17T17:30',
    '2026-07-17T18:00',
    '2026-07-17T18:30',
    '2026-07-17T19:00',
    '2026-07-17T19:30',
  ]);
});

test('小时数据使用线性插值，缺少前后节点时返回 null', () => {
  const payload = {
    hourly: {
      time: ['2026-07-17T18:00', '2026-07-17T19:00'],
      cloud_cover_high: [60, 80],
      visibility: [18000, 22000],
    },
  };

  assert.deepEqual(sampleHourly(payload, '2026-07-17T18:30', ['cloud_cover_high', 'visibility']), {
    cloud_cover_high: 70,
    visibility: 20000,
  });
  assert.equal(sampleHourly(payload, '2026-07-17T17:30', ['cloud_cover_high']), null);
  assert.equal(sampleHourly(payload, '2026-07-17T19:30', ['cloud_cover_high']), null);
});

test('每个节点独立评分并生成峰值、到达与离开建议', () => {
  const qualities = [35, 48, 62, 76, 95, 68];
  const probabilities = [45, 55, 64, 68, 90, 70];
  let index = 0;
  const result = buildSunsetWindow({
    date: '2026-07-17',
    sunset: '19:04',
    effectiveOffsetMinutes: -15,
    resolution: 'native-15m',
    evaluateNode: () => {
      const node = {
        quality: qualities[index],
        probability: probabilities[index],
        weather: { blocksSunset: false },
        corrections: [],
        metrics: {
          cloudHigh: index === 4 ? 72 : 55,
          cloudLow: 18,
          visibilityKm: 21,
          windowTransparency: 83,
          remoteLowCloud: 17,
        },
      };
      index += 1;
      return node;
    },
  });

  assert.equal(result.timeline.length, 6);
  assert.equal(result.effectiveSunset, '18:49');
  assert.equal(result.peakTime, '19:00');
  assert.equal(result.recommendedArrival, '18:15');
  assert.equal(result.recommendedLeave, '19:34');
  assert.equal(result.timeline.find(node => node.time === '19:00').status, '峰值');
  assert.equal(result.timeline.every(node => node.resolution === 'native-15m'), true);
  assert.equal(result.timeline.some(node => 'opportunityIndex' in node), false);
});

test('平滑后重新执行云墙、雾中与高云不足强制规则', () => {
  let index = 0;
  const result = buildSunsetWindow({
    date: '2026-07-17',
    sunset: '19:00',
    resolution: 'interpolated-from-hourly',
    evaluateNode: () => {
      const node = {
        quality: 80,
        probability: 80,
        weather: { blocksSunset: false },
        corrections: [],
        metrics: { cloudHigh: 70, cloudLow: 10, remoteLowCloud: 10, visibilityKm: 20, windowTransparency: 90 },
      };
      if (index === 2) {
        node.metrics.cloudHigh = 5;
        node.metrics.remoteLowCloud = 90;
      }
      if (index === 3) {
        node.probability = 0;
        node.corrections = [{ item: '身在雾中', value: '几率 0' }];
      }
      if (index === 4) node.weather.blocksSunset = true;
      index += 1;
      return node;
    },
  });

  assert.ok(result.timeline[2].quality <= 30);
  assert.ok(result.timeline[2].probability <= 9);
  assert.equal(result.timeline[3].probability, 0);
  assert.equal(result.timeline[4].quality, 0);
  assert.equal(result.timeline[4].probability, 0);
});

test('有效节点不足时明确返回趋势数据不足', () => {
  let index = 0;
  const result = buildSunsetWindow({
    date: '2026-07-17',
    sunset: '19:00',
    resolution: 'interpolated-from-hourly',
    evaluateNode: () => index++ < 2
      ? { quality: 40, probability: 50, weather: {}, corrections: [], metrics: { cloudHigh: 40, cloudLow: 20, remoteLowCloud: 20 } }
      : null,
  });

  assert.equal(result.available, false);
  assert.equal(result.message, '趋势数据不足');
  assert.equal(result.peakTime, null);
});
