const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  FeedbackError,
  feedbackAvailability,
  findPredictionInTimeline,
  loadFeedbackMessages,
  loadFeedbackPhoto,
  normalizeFeedbackPayload,
  optimizePhoto,
  paginateFeedbackMessages,
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

test('地区留言只要求站点、日期、匿名标识并接受照片与评论', () => {
  const normalized = normalizeFeedbackPayload({
    spot: 'xihu',
    date: '2026-07-17',
    clientId: 'anonymous_client_123456',
    comment: '断桥方向出现了十分钟粉紫色。',
    photo: {
      dataUrl: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`,
    },
  });

  assert.equal(normalized.comment, '断桥方向出现了十分钟粉紫色。');
  assert.equal(normalized.photo.mimeType, 'image/jpeg');
  assert.throws(
    () => normalizeFeedbackPayload({ ...normalized, clientId: 'short' }),
    FeedbackError
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

test('新增省份站点与敦煌复用地区留言能力', () => {
  for (const spot of ['hukou', 'dunhuang']) {
    const normalized = normalizeFeedbackPayload({
      spot,
      date: '2026-07-17',
      clientId: 'anonymous_client_123456',
      comment: '现场光线记录。',
    });
    assert.equal(normalized.spot, spot);
  }
  assert.throws(
    () => normalizeFeedbackPayload({
      spot: 'not-open',
      date: '2026-07-17',
      clientId: 'anonymous_client_123456',
      comment: '无效站点。',
    }),
    /站点无效/
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

test('同设备同站点同日期更新同一条匿名留言', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sunset-feedback-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = {
    spot: 'xihu',
    date: '2026-07-17',
    clientId: 'anonymous_client_123456',
    comment: '第一条现场留言。',
  };
  const { getFeedbackRow } = require('../src/services/feedback-db');
  const respondentHash = crypto.createHash('sha256').update(base.clientId).digest('hex');
  const responseKey = crypto.createHash('sha256')
    .update(`${respondentHash}:${base.spot}:${base.date}`)
    .digest('hex');

  const first = await saveFeedback(root, base, prediction, new Date('2026-07-17T12:00:00.000Z'));
  const second = await saveFeedback(
    root,
    { ...base, comment: '更新后的现场留言。' },
    prediction,
    new Date('2026-07-17T12:05:00.000Z')
  );
  const saved = getFeedbackRow(root, responseKey);

  assert.equal(first.updated, false);
  assert.equal(second.updated, true);
  assert.equal(saved.comment, '更新后的现场留言。');
  const snap = JSON.parse(saved.prediction_json);
  assert.equal(snap.quality, 68);
  assert.equal(snap.rawQuality, 68);
  assert.equal(snap.probability, 43);
  assert.equal(snap.inputs.cloudHigh, 62);
  assert.equal(snap.modelVersion, 'quality-v3');
  assert.equal(second.record.clientId, undefined);
  assert.equal(second.record.ip, undefined);
  assert.match(second.record.respondentHash, /^[a-f0-9]{64}$/);
});

test('实况照片独立保存且更新时可保留或移除', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sunset-feedback-photo-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = {
    spot: 'xihu',
    date: '2026-07-17',
    clientId: 'anonymous_client_123456',
    comment: '湖面反光很明显。',
    photo: {
      dataUrl: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`,
    },
  };
  const { getFeedbackRow } = require('../src/services/feedback-db');
  const respondentHash = crypto.createHash('sha256').update(base.clientId).digest('hex');
  const responseKey = crypto.createHash('sha256')
    .update(`${respondentHash}:${base.spot}:${base.date}`)
    .digest('hex');

  const first = await saveFeedback(root, base, prediction);
  const firstRecord = getFeedbackRow(root, responseKey);
  const photoFile = path.join(root, firstRecord.photo_file);

  assert.equal(firstRecord.schema_version, 3);
  assert.equal(firstRecord.comment, '湖面反光很明显。');
  assert.equal(firstRecord.photo_mime, 'image/jpeg');
  // 4 字节假图无法被 sharp 解码，降级为原图存储
  assert.deepEqual([...await fs.readFile(photoFile)], [0xff, 0xd8, 0xff, 0xd9]);

  await saveFeedback(root, { ...base, photo: undefined, comment: '余晖持续约十五分钟。' }, prediction);
  const keptRecord = getFeedbackRow(root, responseKey);
  assert.equal(keptRecord.photo_file, firstRecord.photo_file);
  assert.equal(keptRecord.comment, '余晖持续约十五分钟。');

  await saveFeedback(root, { ...base, photo: undefined, removePhoto: true }, prediction);
  const removedRecord = getFeedbackRow(root, responseKey);
  assert.equal(removedRecord.photo_file, null);
  await assert.rejects(fs.access(photoFile), { code: 'ENOENT' });
});

test('空留言不能发布，旧版观测真值在更新留言时被保留', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sunset-feedback-legacy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const payload = {
    spot: 'xihu',
    date: '2026-07-17',
    clientId: 'anonymous_client_123456',
    comment: '后来补充的留言。',
  };
  const respondentHash = crypto.createHash('sha256').update(payload.clientId).digest('hex');
  const responseKey = crypto.createHash('sha256')
    .update(`${respondentHash}:${payload.spot}:${payload.date}`)
    .digest('hex');
  const { saveFeedbackRow } = require('../src/services/feedback-db');
  // 旧版观测真值直接写入 SQLite，模拟迁移后的历史行
  saveFeedbackRow(root, {
    response_key: responseKey,
    respondent_hash: respondentHash,
    spot: payload.spot,
    date: payload.date,
    comment: '',
    photo_file: null,
    photo_mime: null,
    photo_size: null,
    photo_sha256: null,
    observed: 1,
    actual_quality: 80,
    actual_quality_label: '很棒',
    raw_quality: null,
    quality: null,
    probability: null,
    grade: null,
    model_version: null,
    source: null,
    prediction_json: null,
    recorded_at: '2026-07-17T12:00:00.000Z',
    schema_version: 3,
  });

  const saved = await saveFeedback(root, payload, prediction);
  assert.deepEqual(saved.record.legacyGroundTruth, {
    observed: true,
    actualQuality: 80,
    actualQualityLabel: '很棒',
  });
  await assert.rejects(
    saveFeedback(root, { ...payload, clientId: 'another_client_123456', comment: '' }, prediction),
    /请上传照片或填写评论/
  );
});

test('按地区读取跨日期留言并分页，公开数据不包含匿名哈希或预测详情', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sunset-feedback-list-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await saveFeedback(root, {
    spot: 'xihu',
    date: '2026-07-16',
    clientId: 'anonymous_client_111111',
    comment: '前一天的留言。',
  }, prediction, new Date('2026-07-16T12:00:00.000Z'));
  const latest = await saveFeedback(root, {
    spot: 'xihu',
    date: '2026-07-17',
    clientId: 'anonymous_client_222222',
    comment: '今天的留言。',
    photo: {
      dataUrl: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`,
    },
  }, prediction, new Date('2026-07-17T12:00:00.000Z'));
  await saveFeedback(root, {
    spot: 'waitan',
    date: '2026-07-17',
    clientId: 'anonymous_client_333333',
    comment: '外滩留言。',
  }, prediction);

  const messages = await loadFeedbackMessages(root, 'xihu');
  const firstPage = paginateFeedbackMessages(messages, null, 1);
  const secondPage = paginateFeedbackMessages(messages, firstPage.nextCursor, 1);
  const photo = await loadFeedbackPhoto(
    root,
    latest.record.date,
    path.basename(latest.record.photo.file),
  );

  assert.equal(messages.length, 2);
  assert.equal(firstPage.items[0].comment, '今天的留言。');
  assert.match(firstPage.items[0].photoUrl, /^\/api\/feedback\/photo\//);
  assert.equal(firstPage.items[0].respondentHash, undefined);
  assert.equal(firstPage.items[0].prediction, undefined);
  assert.equal(secondPage.items[0].comment, '前一天的留言。');
  assert.equal(secondPage.nextCursor, null);
  assert.equal(photo.contentType, 'image/jpeg');
  assert.deepEqual([...photo.body], [0xff, 0xd8, 0xff, 0xd9]);
});

test('真实图片在落盘前被压缩为 WebP 并剥离 EXIF', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC', 'base64');
  const optimized = await optimizePhoto({ mimeType: 'image/png', extension: 'png', bytes: png });
  assert.equal(optimized.mimeType, 'image/webp');
  assert.equal(optimized.extension, 'webp');
  assert.ok(optimized.bytes.length > 0);
  assert.equal(optimized.bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(optimized.bytes.subarray(8, 12).toString('ascii'), 'WEBP');
});
