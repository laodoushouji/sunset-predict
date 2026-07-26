const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const FEEDBACK_SPOTS = new Set([
  'xihu', 'waitan', 'beijing', 'erhai', 'chongqing',
  'xiamen', 'qingdao', 'chengdu', 'shenzhen', 'huangshan',
]);
const QUALITY_LEVELS = new Map([
  [20, '平淡'],
  [40, '微霞'],
  [60, '不错'],
  [80, '很棒'],
  [95, '爆燃'],
]);
const MAX_COMMENT_LENGTH = 300;
const MAX_PHOTO_BYTES = 1_200_000;
const PHOTO_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

class FeedbackError extends Error {
  constructor(message, status = 400, code = 'INVALID_FEEDBACK') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function shanghaiClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function feedbackAvailability(date, _prediction, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return { open: false, reason: '日期无效', code: 'INVALID_DATE' };
  }
  const clock = shanghaiClock(now);
  if (date > clock.date) return { open: false, reason: '未来日期暂不能反馈', code: 'FUTURE_DATE' };
  return { open: true, reason: '', code: 'OPEN' };
}

function photoSignatureMatches(mimeType, bytes) {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  return bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

function normalizePhoto(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || typeof input.dataUrl !== 'string') {
    throw new FeedbackError('图片数据无效');
  }
  const match = input.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/]+={0,2})$/);
  if (!match) throw new FeedbackError('仅支持 JPEG、PNG 或 WebP 图片');
  const bytes = Buffer.from(match[2], 'base64');
  const canonical = bytes.toString('base64').replace(/=+$/, '');
  if (!bytes.length || canonical !== match[2].replace(/=+$/, '')) {
    throw new FeedbackError('图片数据无效');
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new FeedbackError('图片请压缩至 1.2MB 以内', 413, 'PHOTO_TOO_LARGE');
  }
  if (!photoSignatureMatches(match[1], bytes)) {
    throw new FeedbackError('图片内容与格式不一致');
  }
  return {
    mimeType: match[1],
    extension: PHOTO_EXTENSIONS.get(match[1]),
    bytes,
  };
}

function normalizeFeedbackPayload(input = {}) {
  const spot = String(input.spot || '');
  const date = String(input.date || '');
  const clientId = String(input.clientId || '');
  if (!FEEDBACK_SPOTS.has(spot)) throw new FeedbackError('站点无效');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new FeedbackError('日期无效');
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(clientId)) throw new FeedbackError('匿名标识无效');
  if (typeof input.observed !== 'boolean') throw new FeedbackError('请选择今晚是否看到晚霞');

  const actualQuality = input.observed ? Number(input.actualQuality) : 0;
  if (input.observed && !QUALITY_LEVELS.has(actualQuality)) {
    throw new FeedbackError('请选择实际质量');
  }
  const comment = String(input.comment || '').replace(/\r\n?/g, '\n').trim();
  if (comment.length > MAX_COMMENT_LENGTH) {
    throw new FeedbackError(`评论请控制在 ${MAX_COMMENT_LENGTH} 字以内`);
  }
  if (input.removePhoto != null && typeof input.removePhoto !== 'boolean') {
    throw new FeedbackError('图片操作无效');
  }
  const photo = normalizePhoto(input.photo);
  if (photo && input.removePhoto) throw new FeedbackError('图片操作冲突');
  return {
    spot,
    date,
    clientId,
    observed: input.observed,
    actualQuality,
    actualQualityLabel: input.observed ? QUALITY_LEVELS.get(actualQuality) : '未观测到',
    comment,
    photo,
    photoAction: photo ? 'replace' : input.removePhoto ? 'remove' : 'keep',
  };
}

function findPredictionInTimeline(timeline, spot, date) {
  const day = timeline?.days?.find(item => item.date === date);
  if (!day) return null;
  if (spot === 'xihu') return day.xihu?.error ? null : day.xihu;
  if (spot === 'waitan') return day.waitan?.error ? null : day.waitan;
  const prediction = day.spots?.find(item => item.spot === spot);
  return prediction?.error ? null : prediction;
}

function predictionSnapshot(prediction) {
  return {
    rawQuality: Number.isFinite(prediction.rawQuality) ? prediction.rawQuality : prediction.quality,
    quality: prediction.quality,
    probability: prediction.probability,
    grade: prediction.grade,
    weather: prediction.weather || null,
    components: prediction.components || null,
    inputs: prediction.modelInputs || null,
    corrections: prediction.corrections || [],
    metrics: prediction.metrics || null,
    modelVersion: prediction.modelVersion || null,
    source: prediction.source || null,
  };
}

async function saveFeedback(root, payload, prediction, recordedAt = new Date()) {
  const normalized = normalizeFeedbackPayload(payload);
  const respondentHash = crypto.createHash('sha256').update(normalized.clientId).digest('hex');
  const responseKey = crypto.createHash('sha256')
    .update(`${respondentHash}:${normalized.spot}:${normalized.date}`)
    .digest('hex');
  const directory = path.join(root, normalized.date);
  const file = path.join(directory, `${responseKey}.json`);
  const temporary = `${file}.${process.pid}-${Date.now()}.tmp`;
  await fs.mkdir(directory, { recursive: true, mode: 0o750 });

  let updated = false;
  let previousRecord = null;
  try {
    previousRecord = JSON.parse(await fs.readFile(file, 'utf8'));
    updated = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let photo = previousRecord?.photo || null;
  if (normalized.photoAction === 'replace') {
    const imageDirectory = path.join(directory, 'images');
    const imageFile = path.join(imageDirectory, `${responseKey}.${normalized.photo.extension}`);
    const imageTemporary = `${imageFile}.${process.pid}-${Date.now()}.tmp`;
    await fs.mkdir(imageDirectory, { recursive: true, mode: 0o750 });
    await fs.writeFile(imageTemporary, normalized.photo.bytes, { mode: 0o640 });
    await fs.rename(imageTemporary, imageFile);
    photo = {
      file: path.relative(root, imageFile),
      mimeType: normalized.photo.mimeType,
      size: normalized.photo.bytes.length,
      sha256: crypto.createHash('sha256').update(normalized.photo.bytes).digest('hex'),
    };
  } else if (normalized.photoAction === 'remove') {
    photo = null;
  }

  const record = {
    schemaVersion: 2,
    responseKey,
    respondentHash,
    spot: normalized.spot,
    date: normalized.date,
    observed: normalized.observed,
    actualQuality: normalized.actualQuality,
    actualQualityLabel: normalized.actualQualityLabel,
    comment: normalized.comment,
    photo,
    prediction: predictionSnapshot(prediction),
    recordedAt: recordedAt.toISOString(),
  };
  await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o640 });
  await fs.rename(temporary, file);

  const previousPhoto = previousRecord?.photo?.file;
  if (previousPhoto && previousPhoto !== photo?.file) {
    const candidate = path.resolve(root, previousPhoto);
    if (candidate.startsWith(`${path.resolve(root)}${path.sep}`)) {
      await fs.rm(candidate, { force: true });
    }
  }
  return { updated, record };
}

module.exports = {
  FEEDBACK_SPOTS,
  QUALITY_LEVELS,
  MAX_COMMENT_LENGTH,
  MAX_PHOTO_BYTES,
  FeedbackError,
  feedbackAvailability,
  findPredictionInTimeline,
  normalizeFeedbackPayload,
  normalizePhoto,
  predictionSnapshot,
  saveFeedback,
  shanghaiClock,
};
