/**
 * 上海外滩数据服务
 * Open-Meteo 无密钥；WAQI_TOKEN 必须通过运行时环境变量传入。
 */

const { predictWaitan, WAITAN_CONFIG } = require('./prediction');

const SHANGHAI_API = {
  target: 'https://api.open-meteo.com/v1/ecmwf?latitude=31.24&longitude=121.49&hourly=temperature_2m,relative_humidity_2m,visibility,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_925hPa,relative_humidity_250hPa,precipitation,rain,weather_code&timezone=Asia%2FShanghai&forecast_days=3',
  targetFallback: 'https://api.open-meteo.com/v1/forecast?latitude=31.24&longitude=121.49&hourly=temperature_2m,relative_humidity_2m,visibility,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_925hPa,relative_humidity_250hPa,precipitation_probability,precipitation,rain,weather_code&timezone=Asia%2FShanghai&forecast_days=3',
  nearWindow: 'https://api.open-meteo.com/v1/forecast?latitude=31.15&longitude=121.12&hourly=cloud_cover_low,visibility&models=gfs_seamless&timezone=Asia%2FShanghai&forecast_days=3',
  farWindow: 'https://api.open-meteo.com/v1/forecast?latitude=31.24&longitude=119.92&hourly=cloud_cover_low,visibility,relative_humidity_850hPa,relative_humidity_250hPa&models=gfs_seamless&timezone=Asia%2FShanghai&forecast_days=3',
  airQuality: token => `https://api.waqi.info/feed/shanghai/?token=${encodeURIComponent(token)}`,
};

async function fetchJson(url, fetchImpl, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function getForecastDates(payload) {
  const dates = [];
  for (const time of payload?.hourly?.time || []) {
    const date = time.slice(0, 10);
    if (!dates.includes(date)) dates.push(date);
    if (dates.length === 3) break;
  }
  return dates;
}

function mergeHourly(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;

  const hourly = { ...fallback.hourly, ...primary.hourly };
  for (const [field, fallbackValues] of Object.entries(fallback.hourly || {})) {
    const primaryValues = primary.hourly?.[field];
    if (!Array.isArray(fallbackValues) || !Array.isArray(primaryValues)) continue;
    hourly[field] = primaryValues.map((value, index) => value ?? fallbackValues[index] ?? null);
  }

  return { ...fallback, ...primary, hourly };
}

function findHourIndex(payload, date, hour) {
  const times = payload?.hourly?.time || [];
  const exact = times.indexOf(`${date}T${String(hour).padStart(2, '0')}:00`);
  if (exact >= 0) return exact;
  return times.findIndex(time => time.startsWith(date));
}

function valueAt(payload, field, index) {
  const value = payload?.hourly?.[field]?.[index];
  return Number.isFinite(value) ? value : null;
}

function parseTarget(payload, date, hour) {
  const index = findHourIndex(payload, date, hour);
  if (index < 0) return null;
  const precipitation = valueAt(payload, 'precipitation', index);
  const rain = valueAt(payload, 'rain', index);

  return {
    temperature: valueAt(payload, 'temperature_2m', index),
    humidity: valueAt(payload, 'relative_humidity_2m', index),
    visibility: (valueAt(payload, 'visibility', index) || 0) / 1000,
    cloudLow: valueAt(payload, 'cloud_cover_low', index),
    cloudMid: valueAt(payload, 'cloud_cover_mid', index),
    cloudHigh: valueAt(payload, 'cloud_cover_high', index),
    lowLevelHumidity: valueAt(payload, 'relative_humidity_925hPa', index),
    humidity250: valueAt(payload, 'relative_humidity_250hPa', index),
    precipitation,
    precipitationRate: precipitation,
    precipitationProbability: valueAt(payload, 'precipitation_probability', index),
    rain,
    rainRate: rain,
    weatherCode: valueAt(payload, 'weather_code', index),
  };
}

function parseWindow(payload, date, hour, includeHumidity = false) {
  const index = findHourIndex(payload, date, hour);
  if (index < 0) return null;

  const weather = {
    cloudLow: valueAt(payload, 'cloud_cover_low', index),
    visibility: (valueAt(payload, 'visibility', index) || 0) / 1000,
  };

  if (includeHumidity) {
    weather.humidity850 = valueAt(payload, 'relative_humidity_850hPa', index);
    weather.humidity250 = valueAt(payload, 'relative_humidity_250hPa', index);
  }

  return weather;
}

function parseAirQuality(payload) {
  if (!payload || payload.status !== 'ok') return { available: false, aqi: null, pm25: null };

  const aqi = Number(payload.data?.aqi);
  const pm25 = Number(payload.data?.iaqi?.pm25?.v);
  return {
    available: true,
    aqi: Number.isFinite(aqi) ? aqi : null,
    pm25: Number.isFinite(pm25) ? pm25 : null,
  };
}

function getTargetHour(date) {
  const month = Number(date.slice(5, 7));
  return month >= 4 && month <= 10 ? 19 : 18;
}

/**
 * 并行抓取上海三点气象和空气质量。
 * WAQI 失败或未配置 Token 时降级，不阻塞气象评分。
 */
async function getShanghaiData(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const waqiToken = options.waqiToken || (typeof process !== 'undefined' ? process.env.WAQI_TOKEN : undefined);
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const requests = [
    fetchJson(SHANGHAI_API.target, fetchImpl),
    fetchJson(SHANGHAI_API.nearWindow, fetchImpl),
    fetchJson(SHANGHAI_API.farWindow, fetchImpl),
    waqiToken
      ? fetchJson(SHANGHAI_API.airQuality(waqiToken), fetchImpl)
      : Promise.resolve(null),
  ];
  const [targetResult, nearResult, farResult, airResult] = await Promise.allSettled(requests);
  const fallbackResult = await fetchJson(SHANGHAI_API.targetFallback, fetchImpl)
    .then(value => ({ status: 'fulfilled', value }))
    .catch(reason => ({ status: 'rejected', reason }));

  if (targetResult.status === 'rejected' && fallbackResult.status === 'rejected') {
    throw new Error('上海主数据与回退数据均获取失败');
  }

  const targetPayload = mergeHourly(
    targetResult.status === 'fulfilled' ? targetResult.value : null,
    fallbackResult.status === 'fulfilled' ? fallbackResult.value : null
  );
  const nearPayload = nearResult.status === 'fulfilled' ? nearResult.value : null;
  const farPayload = farResult.status === 'fulfilled' ? farResult.value : null;
  const airPayload = airResult.status === 'fulfilled' ? airResult.value : null;
  const airQuality = parseAirQuality(airPayload);
  const dates = getForecastDates(targetPayload);

  const snapshots = dates.map(date => {
    const hour = getTargetHour(date);
    return {
      date,
      hour,
      weather: parseTarget(targetPayload, date, hour),
      windows: {
        '青浦窗口': nearPayload ? parseWindow(nearPayload, date, hour) : null,
        '苏州窗口': farPayload ? parseWindow(farPayload, date, hour, true) : null,
      },
    };
  }).filter(snapshot => snapshot.weather);

  return {
    spot: WAITAN_CONFIG.spot,
    snapshots,
    airQuality,
    sourceStatus: {
      ecmwf: targetResult.status === 'fulfilled' ? 'connected' : 'unavailable',
      bestMatchFallback: fallbackResult.status === 'fulfilled' ? 'connected' : 'unavailable',
      nearWindow: nearResult.status === 'fulfilled' ? 'connected' : 'unavailable',
      farWindow: farResult.status === 'fulfilled' ? 'connected' : 'unavailable',
      waqi: !waqiToken ? 'not-configured' : airQuality.available ? 'connected' : 'unavailable',
      precipitation: snapshots.some(snapshot => Number.isFinite(snapshot.weather.precipitationRate))
        ? 'connected'
        : 'unavailable',
    },
    fetchedAt: new Date().toISOString(),
  };
}

async function getShanghaiPrediction(options = {}) {
  const data = await getShanghaiData(options);
  if (!data.snapshots.length) throw new Error('上海预报中没有可用小时数据');

  const predictions = data.snapshots.map(snapshot => ({
    date: snapshot.date,
    ...predictWaitan(snapshot.weather, snapshot.windows, data.airQuality),
  }));
  const [today] = predictions;

  return {
    ...today,
    days: predictions,
    forecast: predictions.map(({ date, quality, probability, probabilityLabel, label, color, verdict, weather }) => ({
      date, quality, probability, probabilityLabel, label, color, verdict, weather,
    })),
    sourceStatus: data.sourceStatus,
    fetchedAt: data.fetchedAt,
    statusText: '上海站 · Beta',
  };
}

module.exports = {
  SHANGHAI_API,
  fetchJson,
  getForecastDates,
  findHourIndex,
  valueAt,
  getTargetHour,
  getShanghaiData,
  getShanghaiPrediction,
  parseAirQuality,
  mergeHourly,
  parseTarget,
  parseWindow,
};
