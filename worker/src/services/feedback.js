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
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function addMinutes(time, amount) {
  const match = /^(\d{2}):(\d{2})$/.exec(time || '');
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]) + amount;
  return {
    minutes,
    label: `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
  };
}

function feedbackAvailability(date, prediction, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return { open: false, reason: '日期无效', code: 'INVALID_DATE' };
  }
  const clock = shanghaiClock(now);
  if (date < clock.date) return { open: true, reason: '', code: 'OPEN' };
  if (date > clock.date) return { open: false, reason: '未来日期暂不能反馈', code: 'FUTURE_DATE' };

  const sunset = prediction?.sunTimes?.sunset || prediction?.lightsOn || '19:00';
  const opensAt = addMinutes(sunset, 20);
  if (!opensAt) return { open: false, reason: '日落时间不足', code: 'SUNSET_UNAVAILABLE' };
  if (clock.minutes < opensAt.minutes) {
    return {
      open: false,
      reason: `今晚 ${opensAt.label} 后开放`,
      code: 'NOT_OPEN_YET',
      opensAt: opensAt.label,
    };
  }
  return { open: true, reason: '', code: 'OPEN', opensAt: opensAt.label };
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
  return {
    spot,
    date,
    clientId,
    observed: input.observed,
    actualQuality,
    actualQualityLabel: input.observed ? QUALITY_LEVELS.get(actualQuality) : '未观测到',
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
  try {
    await fs.access(file);
    updated = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const record = {
    schemaVersion: 1,
    responseKey,
    respondentHash,
    spot: normalized.spot,
    date: normalized.date,
    observed: normalized.observed,
    actualQuality: normalized.actualQuality,
    actualQualityLabel: normalized.actualQualityLabel,
    prediction: predictionSnapshot(prediction),
    recordedAt: recordedAt.toISOString(),
  };
  await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o640 });
  await fs.rename(temporary, file);
  return { updated, record };
}

module.exports = {
  FEEDBACK_SPOTS,
  QUALITY_LEVELS,
  FeedbackError,
  feedbackAvailability,
  findPredictionInTimeline,
  normalizeFeedbackPayload,
  predictionSnapshot,
  saveFeedback,
  shanghaiClock,
};
