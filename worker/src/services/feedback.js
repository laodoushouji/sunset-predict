const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const {
  getFeedbackRow,
  saveFeedbackRow,
  listFeedbackMessages,
  listTopPhotos,
  getFeedbackStats,
} = require('./feedback-db');
const { FORECAST_SPOTS } = require('./cities');

const FEEDBACK_SPOTS = new Set(['xihu', 'waitan', ...Object.keys(FORECAST_SPOTS)]);
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

// 统一压缩为 WebP 并剥离 EXIF（重编码会丢弃原图 GPS/机型等敏感元数据）。
// 失败（如非法图片字节）时降级为原图，保证提交不因此中断。
const OPTIMIZED_PHOTO_WIDTH = 1600;
const OPTIMIZED_PHOTO_QUALITY = 80;

async function optimizePhoto(photo) {
  try {
    const output = await sharp(photo.bytes, { failOn: 'none', limitInputPixels: false })
      .rotate()
      .resize({ withoutEnlargement: true, fit: 'inside', width: OPTIMIZED_PHOTO_WIDTH })
      .webp({ quality: OPTIMIZED_PHOTO_QUALITY, effort: 4 })
      .toBuffer();
    if (output && output.length) {
      return { mimeType: 'image/webp', extension: 'webp', bytes: output };
    }
  } catch {
    // 降级为原图
  }
  return { mimeType: photo.mimeType, extension: photo.extension, bytes: photo.bytes };
}

function normalizeFeedbackPayload(input = {}) {
  const spot = String(input.spot || '');
  const date = String(input.date || '');
  const clientId = String(input.clientId || '');
  if (!FEEDBACK_SPOTS.has(spot)) throw new FeedbackError('站点无效');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new FeedbackError('日期无效');
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(clientId)) throw new FeedbackError('匿名标识无效');
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
  await fs.mkdir(directory, { recursive: true, mode: 0o750 });

  const previous = getFeedbackRow(root, responseKey);
  const updated = Boolean(previous);

  let photo = previous?.photo_file
    ? {
        file: previous.photo_file,
        mimeType: previous.photo_mime,
        size: previous.photo_size,
        sha256: previous.photo_sha256,
      }
    : null;

  if (normalized.photoAction === 'replace') {
    const optimized = await optimizePhoto(normalized.photo);
    const imageDirectory = path.join(directory, 'images');
    const imageFile = path.join(imageDirectory, `${responseKey}.${optimized.extension}`);
    await fs.mkdir(imageDirectory, { recursive: true, mode: 0o750 });
    await fs.writeFile(imageFile, optimized.bytes, { mode: 0o640 });
    photo = {
      file: path.relative(root, imageFile),
      mimeType: optimized.mimeType,
      size: optimized.bytes.length,
      sha256: crypto.createHash('sha256').update(optimized.bytes).digest('hex'),
    };
  } else if (normalized.photoAction === 'remove') {
    photo = null;
  }
  if (!normalized.comment && !photo) {
    throw new FeedbackError('请上传照片或填写评论');
  }

  const legacyGroundTruth = previous?.observed != null
    ? {
        observed: Boolean(previous.observed),
        actualQuality: previous.actual_quality,
        actualQualityLabel: previous.actual_quality_label,
      }
    : null;

  const record = {
    schemaVersion: 3,
    kind: 'spot-message',
    responseKey,
    respondentHash,
    spot: normalized.spot,
    date: normalized.date,
    comment: normalized.comment,
    photo,
    legacyGroundTruth,
    prediction: predictionSnapshot(prediction),
    recordedAt: recordedAt.toISOString(),
  };

  saveFeedbackRow(root, {
    response_key: responseKey,
    respondent_hash: respondentHash,
    spot: normalized.spot,
    date: normalized.date,
    comment: normalized.comment,
    photo_file: photo?.file ?? null,
    photo_mime: photo?.mimeType ?? null,
    photo_size: photo?.size ?? null,
    photo_sha256: photo?.sha256 ?? null,
    observed: previous?.observed ?? null,
    actual_quality: previous?.actual_quality ?? null,
    actual_quality_label: previous?.actual_quality_label ?? null,
    raw_quality: prediction ? (Number.isFinite(prediction.rawQuality) ? prediction.rawQuality : prediction.quality) : null,
    quality: prediction ? prediction.quality : null,
    probability: prediction ? prediction.probability : null,
    grade: prediction ? prediction.grade : null,
    model_version: prediction ? (prediction.modelVersion || null) : null,
    source: prediction ? (prediction.source || null) : null,
    prediction_json: JSON.stringify(predictionSnapshot(prediction)),
    recorded_at: record.recordedAt,
    schema_version: 3,
  });

  const previousPhoto = previous?.photo_file;
  if (previousPhoto && previousPhoto !== photo?.file) {
    const candidate = path.resolve(root, previousPhoto);
    if (candidate.startsWith(`${path.resolve(root)}${path.sep}`)) {
      await fs.rm(candidate, { force: true });
    }
  }
  return { updated, record };
}

function publicPhotoUrl(photo) {
  const match = String(photo?.file || '').match(/^(\d{4}-\d{2}-\d{2})\/images\/([a-f0-9]{64}\.(?:jpg|png|webp))$/);
  return match ? `/api/feedback/photo/${match[1]}/${match[2]}` : null;
}

async function loadFeedbackMessages(root, spot) {
  if (!FEEDBACK_SPOTS.has(spot)) throw new FeedbackError('站点无效');
  const rows = listFeedbackMessages(root, spot);
  return rows.map(row => ({
    id: row.response_key,
    spot: row.spot,
    date: row.date,
    comment: String(row.comment || '').slice(0, MAX_COMMENT_LENGTH),
    photoUrl: publicPhotoUrl({ file: row.photo_file }),
    recordedAt: row.recorded_at,
  }));
}

// SEO 落地页照片墙：历史高分实拍（优先用户实拍评分，回退模型质量分）。
// 同步查询（better-sqlite3），SSR 直接调用；异常由调用方兜底为空数组。
function loadTopPhotos(root, spot, limit = 9) {
  if (!FEEDBACK_SPOTS.has(spot)) return [];
  return listTopPhotos(root, spot, limit)
    .map(row => ({
      photoUrl: publicPhotoUrl({ file: row.photo_file }),
      comment: String(row.comment || '').slice(0, MAX_COMMENT_LENGTH),
      date: row.date,
      score: Number.isFinite(row.score) ? Math.round(row.score) : null,
    }))
    .filter(item => item.photoUrl);
}

function paginateFeedbackMessages(messages, cursor, requestedLimit) {
  const offset = /^\d+$/.test(String(cursor || '0')) ? Number(cursor || 0) : 0;
  const limit = Math.min(50, Math.max(1, Number(requestedLimit) || 20));
  const items = messages.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    total: messages.length,
    nextCursor: nextOffset < messages.length ? String(nextOffset) : null,
  };
}

async function loadFeedbackPhoto(root, date, filename) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
      !/^[a-f0-9]{64}\.(jpg|png|webp)$/.test(filename || '')) {
    throw new FeedbackError('图片地址无效', 404, 'PHOTO_NOT_FOUND');
  }
  const extension = path.extname(filename).slice(1);
  try {
    return {
      body: await fs.readFile(path.join(root, date, 'images', filename)),
      contentType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
    };
  } catch (error) {
    if (error.code === 'ENOENT') throw new FeedbackError('图片不存在', 404, 'PHOTO_NOT_FOUND');
    throw error;
  }
}

module.exports = {
  FEEDBACK_SPOTS,
  MAX_COMMENT_LENGTH,
  MAX_PHOTO_BYTES,
  FeedbackError,
  feedbackAvailability,
  findPredictionInTimeline,
  getFeedbackStats,
  loadFeedbackMessages,
  loadFeedbackPhoto,
  loadTopPhotos,
  normalizeFeedbackPayload,
  normalizePhoto,
  optimizePhoto,
  paginateFeedbackMessages,
  predictionSnapshot,
  saveFeedback,
  shanghaiClock,
};
