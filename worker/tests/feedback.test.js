const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  FeedbackError,
  feedbackAvailability,
  findPredictionInTimeline,
  normalizeFeedbackPayload,
  saveFeedback,
} = require('../src/services/feedback');

const prediction = {
  spot: 'xihu',
  date: '2026-07-17',
  quality: 68,
  probability: 43,
  grade: 'GREAT',
  weather: { label: '晴', kind: 'clear' },
  components: { canvasPoints: 50, filterPoints: 15 },
  metrics: { cloudHigh: 62, cloudLow: 18 },
  source: 'xihu-model-v2',
  sunTimes: { sunset: '19:05' },
};

test('反馈载荷要求站点、日期、匿名标识与实际质量完整', () => {
  const normalized = normalizeFeedbackPayload({
    spot: 'xihu',
    date: '2026-07-17',
    clientId: 'anonymous_client_123456',
    observed: true,
    actualQuality: 80,
  });

  assert.equal(normalized.actualQualityLabel, '很棒');
  assert.throws(
    () => normalizeFeedbackPayload({ ...normalized, clientId: 'short' }),
    FeedbackError
  );
  assert.throws(
    () => normalizeFeedbackPayload({ ...normalized, actualQuality: 73 }),
    /请选择实际质量/
  );
});

test('反馈只在历史日期或今日日落二十分钟后开放', () => {
  const before = new Date('2026-07-17T11:24:00.000Z');
  const after = new Date('2026-07-17T11:26:00.000Z');

  assert.equal(feedbackAvailability('2026-07-16', prediction, before).open, true);
  assert.equal(feedbackAvailability('2026-07-18', prediction, before).code, 'FUTURE_DATE');
  assert.equal(feedbackAvailability('2026-07-17', prediction, before).code, 'NOT_OPEN_YET');
  assert.equal(feedbackAvailability('2026-07-17', prediction, after).open, true);
});

test('时间线按站点和日期绑定反馈对应预测', () => {
  const timeline = {
    days: [{
      date: '2026-07-17',
      xihu: prediction,
      waitan: { ...prediction, spot: 'waitan' },
      spots: [{ ...prediction, spot: 'beijing' }],
    }],
  };

  assert.equal(findPredictionInTimeline(timeline, 'xihu', '2026-07-17').quality, 68);
  assert.equal(findPredictionInTimeline(timeline, 'beijing', '2026-07-17').spot, 'beijing');
  assert.equal(findPredictionInTimeline(timeline, 'erhai', '2026-07-17'), undefined);
});

test('同设备同站点同日期更新同一条匿名真值记录', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sunset-feedback-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = {
    spot: 'xihu',
    date: '2026-07-17',
    clientId: 'anonymous_client_123456',
    observed: true,
    actualQuality: 60,
  };

  const first = await saveFeedback(root, base, prediction, new Date('2026-07-17T12:00:00.000Z'));
  const second = await saveFeedback(
    root,
    { ...base, actualQuality: 95 },
    prediction,
    new Date('2026-07-17T12:05:00.000Z')
  );
  const files = await fs.readdir(path.join(root, base.date));
  const saved = JSON.parse(await fs.readFile(path.join(root, base.date, files[0]), 'utf8'));

  assert.equal(first.updated, false);
  assert.equal(second.updated, true);
  assert.equal(files.length, 1);
  assert.equal(saved.actualQuality, 95);
  assert.equal(saved.prediction.quality, 68);
  assert.equal(saved.prediction.probability, 43);
  assert.equal(saved.clientId, undefined);
  assert.equal(saved.ip, undefined);
  assert.match(saved.respondentHash, /^[a-f0-9]{64}$/);
});
