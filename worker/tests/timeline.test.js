const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  addDays,
  buildLiveDays,
  buildTimeline,
  loadHistoryDay,
  saveHistoryDay,
} = require('../src/services/timeline');

function prediction(spot, dates) {
  const days = dates.map((date, index) => ({
    spot,
    date,
    rawQuality: 50 + index,
    quality: 50 + index,
    probability: 60 - index,
    grade: 'FAIR',
    metrics: { cloudHigh: 50, cloudMid: 40, visibilityKm: 20 },
    modelInputs: { cloudHigh: 50, cloudMid: 40, visibilityKm: 20, remoteWindow: { cloudLow: 20 } },
    components: { canvasPoints: 38, filterPoints: 16, sceneBonus: 0 },
    corrections: [],
    photographyAdvice: `${spot}-${index}`,
    source: `${spot}-model-v3`,
  }));
  return { spot, days, forecast: days.map(({ date, quality }) => ({ date, quality })) };
}

test('统一时间线为西湖、外滩与全国站点选择同一天', () => {
  const dates = ['2026-07-17', '2026-07-18', '2026-07-19'];
  const days = buildLiveDays(
    prediction('xihu', dates),
    prediction('waitan', dates),
    { spots: [prediction('beijing', dates), prediction('erhai', dates)] }
  );

  assert.equal(days.length, 3);
  assert.equal(days[1].offset, 1);
  assert.equal(days[1].xihu.date, '2026-07-18');
  assert.equal(days[1].waitan.quality, 51);
  assert.equal(days[1].spots.every(spot => spot.date === '2026-07-18'), true);
});

test('历史快照跨请求保存，并作为昨天插入时间线', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sunset-timeline-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dates = ['2026-07-17', '2026-07-18', '2026-07-19'];
  const yesterdayDate = addDays(dates[0], -1);
  const yesterday = {
    date: yesterdayDate,
    xihu: { spot: 'xihu', date: yesterdayDate, quality: 44 },
    waitan: { spot: 'waitan', date: yesterdayDate, quality: 38 },
    spots: [],
    capturedAt: '2026-07-16T12:00:00.000Z',
  };
  await saveHistoryDay(root, yesterday);

  const result = await buildTimeline(
    prediction('xihu', dates),
    prediction('waitan', dates),
    { spots: [prediction('beijing', dates)] },
    root
  );
  const savedToday = await loadHistoryDay(root, dates[0]);

  assert.equal(result.historyAvailable, true);
  assert.equal(result.minOffset, -1);
  assert.deepEqual(result.days.map(day => day.offset), [-1, 0, 1, 2]);
  assert.equal(result.days[0].recorded, true);
  assert.equal(savedToday.date, dates[0]);
  assert.equal(savedToday.recorded, true);
  assert.equal(savedToday.schemaVersion, 2);
  assert.equal(savedToday.modelVersion, 'quality-v3');
  assert.equal(savedToday.calibration.xihu.inputs.metrics.cloudHigh, 50);
  assert.equal(savedToday.calibration.xihu.inputs.model.remoteWindow.cloudLow, 20);
  assert.equal(savedToday.calibration.xihu.outputs.rawQuality, 50);
  assert.equal(savedToday.calibration.xihu.outputs.quality, 50);
  assert.deepEqual(savedToday.calibration.xihu.adjustments, []);
});

test('旧版历史快照没有校准结构时仍可读取', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sunset-timeline-legacy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const date = '2026-07-16';
  await fs.writeFile(path.join(root, `${date}.json`), JSON.stringify({ date, recorded: true }));

  const saved = await loadHistoryDay(root, date);
  assert.equal(saved.date, date);
  assert.equal(saved.calibration, undefined);
});
