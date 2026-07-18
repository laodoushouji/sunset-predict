const TARGET_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'visibility',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'wind_speed_10m',
  'wind_direction_10m',
  'pressure_msl',
  'relative_humidity_925hPa',
  'relative_humidity_700hPa',
  'relative_humidity_250hPa',
  'wind_speed_700hPa',
  'precipitation_probability',
  'precipitation',
  'rain',
  'weather_code',
];

const REMOTE_FIELDS = [
  'cloud_cover_low',
  'visibility',
  'relative_humidity_850hPa',
  'relative_humidity_250hPa',
];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function timestamp(localIso) {
  return Date.parse(`${localIso}:00Z`);
}

function formatLocal(value) {
  return new Date(value).toISOString().slice(0, 16);
}

function formatClock(value) {
  return new Date(value).toISOString().slice(11, 16);
}

function clockTimestamp(date, clock) {
  return timestamp(`${date}T${clock}`);
}

function addClockMinutes(date, clock, amount) {
  return formatClock(clockTimestamp(date, clock) + amount * 60_000);
}

function buildWindowTimes(date, sunset) {
  const sunsetAt = clockTimestamp(date, sunset);
  const start = Math.floor((sunsetAt - 120 * 60_000) / (30 * 60_000)) * 30 * 60_000;
  const end = Math.floor((sunsetAt + 30 * 60_000) / (30 * 60_000)) * 30 * 60_000;
  const times = [];
  for (let value = start; value <= end && times.length < 6; value += 30 * 60_000) {
    times.push(formatLocal(value));
  }
  return times;
}

function sampleHourly(payload, targetTime, fields = TARGET_FIELDS) {
  const times = payload?.hourly?.time || [];
  const target = timestamp(targetTime);
  const exactIndex = times.indexOf(targetTime);
  if (exactIndex >= 0) {
    return Object.fromEntries(fields.map(field => [field,
      Number.isFinite(payload.hourly?.[field]?.[exactIndex]) ? payload.hourly[field][exactIndex] : null]));
  }

  const nextIndex = times.findIndex(time => timestamp(time) > target);
  const previousIndex = nextIndex - 1;
  if (previousIndex < 0 || nextIndex < 0) return null;
  const previousTime = timestamp(times[previousIndex]);
  const nextTime = timestamp(times[nextIndex]);
  if (target <= previousTime || target >= nextTime || nextTime - previousTime > 60 * 60_000) return null;
  const ratio = (target - previousTime) / (nextTime - previousTime);

  return Object.fromEntries(fields.map(field => {
    const previous = payload.hourly?.[field]?.[previousIndex];
    const next = payload.hourly?.[field]?.[nextIndex];
    if (!Number.isFinite(previous) || !Number.isFinite(next)) return [field, null];
    if (field === 'weather_code') return [field, ratio <= 0.5 ? previous : next];
    return [field, Math.round((previous + (next - previous) * ratio) * 100) / 100];
  }));
}

function sampleNative15(payload, targetTime, fields = TARGET_FIELDS) {
  const times = payload?.minutely_15?.time || [];
  const target = timestamp(targetTime);
  let index = -1;
  let difference = Infinity;
  times.forEach((time, candidate) => {
    const current = Math.abs(timestamp(time) - target);
    if (current < difference) {
      difference = current;
      index = candidate;
    }
  });
  if (index < 0 || difference > 8 * 60_000) return null;
  return Object.fromEntries(fields.map(field => [field,
    Number.isFinite(payload.minutely_15?.[field]?.[index]) ? payload.minutely_15[field][index] : null]));
}

function mapWeather(sample, resolution) {
  if (!sample) return null;
  const precipitation = sample.precipitation;
  const rain = sample.rain;
  const rateMultiplier = resolution === 'native-15m' ? 4 : 1;
  return {
    temperature: sample.temperature_2m,
    humidity: sample.relative_humidity_2m,
    visibility: Number.isFinite(sample.visibility) ? sample.visibility / 1000 : null,
    cloudTotal: sample.cloud_cover,
    cloudLow: sample.cloud_cover_low,
    cloudMid: sample.cloud_cover_mid,
    cloudHigh: sample.cloud_cover_high,
    windSpeed: sample.wind_speed_10m,
    windDirection: sample.wind_direction_10m,
    pressure: sample.pressure_msl,
    lowLevelHumidity: sample.relative_humidity_925hPa,
    humidity700: sample.relative_humidity_700hPa,
    humidity250: sample.relative_humidity_250hPa,
    windSpeed700: sample.wind_speed_700hPa,
    precipitation,
    precipitationRate: Number.isFinite(precipitation) ? precipitation * rateMultiplier : null,
    precipitationProbability: sample.precipitation_probability,
    rain,
    rainRate: Number.isFinite(rain) ? rain * rateMultiplier : null,
    weatherCode: sample.weather_code,
  };
}

function sampleWeather(payload, targetTime, resolution) {
  if (resolution === 'native-15m') {
    const native = sampleNative15(payload, targetTime);
    if (!native) return null;
    const hourly = sampleHourly(payload, targetTime) || {};
    return mapWeather(Object.fromEntries(TARGET_FIELDS.map(field => [field,
      Number.isFinite(native[field]) ? native[field] : hourly[field]])), resolution);
  }
  return mapWeather(sampleHourly(payload, targetTime), resolution);
}

function sampleRemote(payload, targetTime) {
  const sample = sampleHourly(payload, targetTime, REMOTE_FIELDS);
  if (!sample) return null;
  return {
    cloudLow: sample.cloud_cover_low,
    visibility: Number.isFinite(sample.visibility) ? sample.visibility / 1000 : null,
    humidity850: sample.relative_humidity_850hPa,
    humidity250: sample.relative_humidity_250hPa,
  };
}

function sunlightFactor(relativeMinutes, slowAfterglow = false) {
  const points = [
    [-120, 0.45],
    [-90, 0.65],
    [-60, 0.85],
    [-30, 1],
    [0, 1],
    [30, slowAfterglow ? 0.75 : 0.65],
  ];
  if (relativeMinutes <= -120) return points[0][1];
  if (relativeMinutes >= 30) return points[points.length - 1][1];
  const nextIndex = points.findIndex(([minutes]) => minutes >= relativeMinutes);
  const [nextMinutes, nextValue] = points[nextIndex];
  const [previousMinutes, previousValue] = points[nextIndex - 1];
  const ratio = (relativeMinutes - previousMinutes) / (nextMinutes - previousMinutes);
  return previousValue + (nextValue - previousValue) * ratio;
}

function enforceHardRules(node) {
  if (!node || !Number.isFinite(node.quality) || !Number.isFinite(node.probability)) return node;
  let quality = node.quality;
  let probability = node.probability;
  const metrics = node.metrics || {};
  const correctionNames = new Set((node.corrections || []).map(item => item.item));
  if (node.weather?.blocksSunset) {
    quality = 0;
    probability = 0;
  }
  if (metrics.cloudHigh < 10) quality = Math.min(quality, 30);
  if (metrics.remoteLowCloud > 80) probability = Math.min(probability, 9);
  if (correctionNames.has('身在雾中') || correctionNames.has('低云雾中')) probability = 0;
  if (metrics.cloudLow > 95 || metrics.humidity925 > 95) {
    probability = Math.min(probability, node.originalProbability);
  }
  return { ...node, quality: Math.round(clamp(quality)), probability: Math.round(clamp(probability)) };
}

function buildSunsetWindow({
  date,
  sunset,
  effectiveOffsetMinutes = 0,
  resolution,
  slowAfterglow = false,
  evaluateNode,
}) {
  if (!date || !sunset || typeof evaluateNode !== 'function') {
    return { available: false, message: '趋势数据不足', sunset: sunset || null, effectiveSunset: null, peakTime: null, timeline: [] };
  }
  const effectiveSunset = addClockMinutes(date, sunset, effectiveOffsetMinutes);
  const effectiveAt = clockTimestamp(date, effectiveSunset);
  const times = buildWindowTimes(date, sunset);
  const nodes = times.map(localTime => {
    const evaluated = evaluateNode(localTime);
    const time = localTime.slice(11, 16);
    if (!evaluated || !Number.isFinite(evaluated.quality) || !Number.isFinite(evaluated.probability)) {
      return { time, quality: null, probability: null, status: '数据不足', resolution };
    }
    const metrics = evaluated.metrics || {};
    return {
      time,
      quality: evaluated.quality,
      probability: evaluated.probability,
      originalProbability: evaluated.probability,
      weather: evaluated.weather || {},
      corrections: evaluated.corrections || [],
      metrics: {
        cloudHigh: metrics.cloudHigh,
        cloudMid: metrics.cloudMid,
        cloudLow: metrics.cloudLow,
        humidity925: metrics.humidity925,
        visibilityKm: metrics.visibilityKm,
        remoteLowCloud: metrics.remoteLowCloud,
        windowTransparency: metrics.windowTransparency,
      },
      resolution,
      relativeMinutes: Math.round((timestamp(localTime) - effectiveAt) / 60_000),
    };
  });

  const smoothed = nodes.map((node, index) => {
    if (!Number.isFinite(node.quality) || index === 0 || index === nodes.length - 1) return enforceHardRules(node);
    const previous = nodes[index - 1];
    const next = nodes[index + 1];
    if (![previous.quality, previous.probability, next.quality, next.probability].every(Number.isFinite)) {
      return enforceHardRules(node);
    }
    return enforceHardRules({
      ...node,
      quality: previous.quality * 0.25 + node.quality * 0.5 + next.quality * 0.25,
      probability: previous.probability * 0.25 + node.probability * 0.5 + next.probability * 0.25,
    });
  });

  const valid = smoothed.filter(node => Number.isFinite(node.quality) && Number.isFinite(node.probability));
  const available = valid.length >= 3;
  if (!available) {
    return {
      available: false,
      message: '趋势数据不足',
      sunset,
      effectiveSunset,
      peakTime: null,
      recommendedArrival: null,
      recommendedLeave: null,
      timeline: smoothed.map(({ originalProbability, relativeMinutes, weather, corrections, ...node }) => node),
    };
  }

  valid.forEach(node => {
    node.opportunityIndex = node.quality * node.probability / 100 * sunlightFactor(node.relativeMinutes, slowAfterglow);
  });
  const peak = valid.reduce((best, node) => node.opportunityIndex > best.opportunityIndex ? node : best);
  const peakOpportunity = peak.opportunityIndex || 1;
  smoothed.forEach(node => {
    if (!Number.isFinite(node.quality)) return;
    if (node === peak) node.status = '峰值';
    else if (node.relativeMinutes > 0) node.status = '余晖';
    else if (node.opportunityIndex / peakOpportunity >= 0.8) node.status = '推荐';
    else if (node.opportunityIndex / peakOpportunity >= 0.6) node.status = '渐亮';
    else if (node.opportunityIndex / peakOpportunity >= 0.35) node.status = '可候';
    else node.status = '等待';
  });

  let arrivalLead = null;
  let arrivalNote = '不建议专程前往';
  if (peak.quality >= 60 && peak.probability >= 60) {
    arrivalLead = 45;
    arrivalNote = '建议提前45分钟到达';
  } else if (peak.quality >= 60) {
    arrivalLead = 30;
    arrivalNote = '附近可赌 · 建议提前30分钟到达';
  } else if (peak.probability >= 60) {
    arrivalLead = 25;
    arrivalNote = '适合清透落日 · 建议提前25分钟到达';
  }

  const highCloud = Number(peak.metrics.cloudHigh) || 0;
  let leaveOffset = highCloud >= 60 ? 30 : highCloud >= 40 ? 20 : 10;
  if (slowAfterglow) leaveOffset += 10;

  return {
    available: true,
    message: null,
    sunset,
    effectiveSunset,
    peakTime: peak.time,
    recommendedArrival: arrivalLead === null ? null : addClockMinutes(date, peak.time, -arrivalLead),
    arrivalNote,
    recommendedLeave: addClockMinutes(date, sunset, leaveOffset),
    timeline: smoothed.map(({ originalProbability, relativeMinutes, opportunityIndex, weather, corrections, ...node }) => node),
  };
}

module.exports = {
  TARGET_FIELDS,
  REMOTE_FIELDS,
  addClockMinutes,
  buildSunsetWindow,
  buildWindowTimes,
  sampleHourly,
  sampleNative15,
  sampleRemote,
  sampleWeather,
  sunlightFactor,
};
