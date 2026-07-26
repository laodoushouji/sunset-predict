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
  rawQuality: 68,
  quality: 68,
  probability: 43,
  grade: 'GREAT',
  weather: { label: '晴', kind: 'clear' },
  components: { canvasPoints: 50, filterPoints: 15 },
  metrics: { cloudHigh: 62, cloudLow: 18 },
  modelInputs: { cloudHigh: 62, visibilityKm: 24, remoteWindow: { cloudLow: 18 } },
  modelVersion: 'quality-v3',
  source: 'xihu-model-v3',
  sunTimes: { sunset: '19:05' },
};

test('反馈载荷要求站点、日期、匿名标识与实际质量完整', () => {
  const normalized = normalizeFeedbackPayload({
    spot: 'xihu',
    date: '2026-07-17',
    clientId: 'anonymous_client_123456',
    observed: true,
    actualQuality: 80,
    comment: '断桥方向出现了十分钟粉紫色。',
    photo: {
      dataUrl: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`,
    },
  });

  assert.equal(normalized.actualQualityLabel, '很棒');
  assert.equal(normalized.comment, '断桥方向出现了十分钟粉紫色。');
  assert.equal(normalized.photo.mimeType, 'image/jpeg');
  assert.throws(
    () => normalizeFeedbackPayload({ ...normalized, clientId: 'short' }),
    FeedbackError
  );
  assert.throws(
    () => normalizeFeedbackPayload({ ...normalized, actualQuality: 73 }),
    /请选择实际质量/
  );
  assert.throws(
    () => normalizeFeedbackPayload({ ...normalized, comment: '晚'.repeat(301) }),
    /评论请控制在 300 字以内/
  );
  assert.throws(
    () => normalizeFeedbackPayload({
      ...normalized,
      photo: { dataUrl: `data:image/png;base64,${Buffer.from('not-a-png').toString('base64')}` },
    }),
    /图片内容与格式不一致/
  );
});

test('反馈在今天和历史日期始终开放，未来日期不可提交', () => {
  const before = new Date('2026-07-17T11:24:00.000Z');

  assert.equal(feedbackAvailability('2026-07-16', prediction, before).open, true);
  assert.equal(feedbackAvailability('2026-07-18', prediction, before).code, 'FUTURE_DATE');
  assert.equal(feedbackAvailability('2026-07-17', prediction, before).open, true);
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
  assert.equal(saved.prediction.rawQuality, 68);
  assert.equal(saved.prediction.probability, 43);
  assert.equal(saved.prediction.inputs.cloudHigh, 62);
  assert.equal(saved.prediction.modelVersion, 'quality-v3');
  assert.equal(saved.clientId, undefined);
  assert.equal(saved.ip, undefined);
  assert.match(saved.respondentHash, /^[a-f0-9]{64}$/);
});

test('实况照片独立保存且更新时可保留或移除', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sunset-feedback-photo-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = {
    spot: 'xihu',
    date: '2026-07-17',
    clientId: 'anonymous_client_123456',
    observed: true,
    actualQuality: 80,
    comment: '湖面反光很明显。',
    photo: {
      dataUrl: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`,
    },
  };

  const first = await saveFeedback(root, base, prediction);
  const recordFile = path.join(root, base.date, `${first.record.responseKey}.json`);
  const firstRecord = JSON.parse(await fs.readFile(recordFile, 'utf8'));
  const photoFile = path.join(root, firstRecord.photo.file);

  assert.equal(firstRecord.schemaVersion, 2);
  assert.equal(firstRecord.comment, '湖面反光很明显。');
  assert.equal(firstRecord.photo.mimeType, 'image/jpeg');
  assert.equal(firstRecord.photo.dataUrl, undefined);
  assert.deepEqual([...await fs.readFile(photoFile)], [0xff, 0xd8, 0xff, 0xd9]);

  await saveFeedback(root, { ...base, photo: undefined, comment: '余晖持续约十五分钟。' }, prediction);
  const keptRecord = JSON.parse(await fs.readFile(recordFile, 'utf8'));
  assert.equal(keptRecord.photo.file, firstRecord.photo.file);
  assert.equal(keptRecord.comment, '余晖持续约十五分钟。');

  await saveFeedback(root, { ...base, photo: undefined, removePhoto: true }, prediction);
  const removedRecord = JSON.parse(await fs.readFile(recordFile, 'utf8'));
  assert.equal(removedRecord.photo, null);
  await assert.rejects(fs.access(photoFile), { code: 'ENOENT' });
});
