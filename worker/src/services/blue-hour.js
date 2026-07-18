const SunCalc = require('suncalc');

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function formatClock(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function findEveningAngle(date, latitude, longitude, targetAngle) {
  const start = Date.parse(`${date}T12:00:00+08:00`);
  const end = start + 15 * 60 * 60_000;
  const step = 5 * 60_000;
  let previousTime = start;
  let previousAltitude = SunCalc.getPosition(new Date(start), latitude, longitude).altitude;

  for (let time = start + step; time <= end; time += step) {
    const altitude = SunCalc.getPosition(new Date(time), latitude, longitude).altitude;
    if (previousAltitude > targetAngle && altitude <= targetAngle) {
      let lower = previousTime;
      let upper = time;
      for (let iteration = 0; iteration < 18; iteration += 1) {
        const middle = Math.round((lower + upper) / 2);
        const middleAltitude = SunCalc.getPosition(new Date(middle), latitude, longitude).altitude;
        if (middleAltitude > targetAngle) lower = middle;
        else upper = middle;
      }
      return new Date(upper);
    }
    previousTime = time;
    previousAltitude = altitude;
  }
  return null;
}

function getBlueHourTimes(date, latitude, longitude) {
  const startAt = findEveningAngle(date, latitude, longitude, -4);
  const endAt = findEveningAngle(date, latitude, longitude, -8);
  if (!startAt || !endAt || endAt <= startAt) return null;
  const midpointAt = new Date((startAt.getTime() + endAt.getTime()) / 2);
  return {
    start: formatClock(startAt),
    end: formatClock(endAt),
    midpoint: formatClock(midpointAt),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    durationMinutes: Math.round((endAt - startAt) / 60_000),
  };
}

function getBlueHourLabel(score) {
  if (score >= 80) return '极致深蓝';
  if (score >= 60) return '清透蓝调';
  if (score >= 40) return '柔和暮蓝';
  return '灰蓝有限';
}

function calculateBlueHourScore(weather = {}) {
  const visibilityKm = Number(weather.visibility);
  const fallbackCloud = [weather.cloudLow, weather.cloudMid, weather.cloudHigh]
    .filter(Number.isFinite)
    .reduce((maximum, value) => Math.max(maximum, value), 0);
  const cloudCover = Number.isFinite(weather.cloudTotal) ? weather.cloudTotal : fallbackCloud;
  const visibilityPoints = clamp(visibilityKm / 24, 0, 1) * 70;
  const cloudPoints = (1 - clamp(cloudCover) / 100) * 30;
  const score = Math.round(clamp(visibilityPoints + cloudPoints));
  return {
    score,
    label: getBlueHourLabel(score),
    components: {
      visibilityPoints: Math.round(visibilityPoints),
      cloudPoints: Math.round(cloudPoints),
      visibilityKm: Number.isFinite(visibilityKm) ? visibilityKm : null,
      cloudCover: Number.isFinite(cloudCover) ? cloudCover : null,
    },
  };
}

function buildBlueHour({ date, latitude, longitude, weather, airQuality = {}, spotId }) {
  const times = getBlueHourTimes(date, latitude, longitude);
  if (!times) return { available: false, message: '蓝调时刻暂不可用' };
  const quality = calculateBlueHourScore(weather);
  const aqi = Number.isFinite(Number(airQuality.aqi)) ? Number(airQuality.aqi) : null;
  const airQualityHint = aqi === null
    ? '空气质量数据暂缺'
    : aqi <= 50 ? '空气清洁，深蓝层次更清晰' : aqi <= 100 ? '空气散射适中，适合冷暖对比' : '空气浑浊可能削弱深蓝层次';
  const isWaitan = spotId === 'waitan';

  return {
    available: true,
    date,
    ...times,
    score: quality.score,
    label: quality.label,
    components: quality.components,
    aqi,
    airQualityHint,
    advice: isWaitan
      ? `今晚 ${times.start} 进入蓝调，建议拍摄外滩全景与金色灯光，白平衡调至 3800K。`
      : `今晚 ${times.start} 进入蓝调，建议利用湖面与沿岸灯光拍摄冷暖对比，白平衡调至 3600K。`,
    camera: {
      aperture: 'f/8',
      shutter: '2–8s',
      iso: 'ISO 100',
      whiteBalance: isWaitan ? '3800K' : '3600K',
    },
    source: 'suncalc-2.0.1',
  };
}

module.exports = {
  buildBlueHour,
  calculateBlueHourScore,
  findEveningAngle,
  getBlueHourTimes,
};
