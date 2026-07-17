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
  const days = dates.map((date, index) => ({ date, quality: 50 + index, photographyAdvice: `${spot}-${index}` }));
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
});
