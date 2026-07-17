const {
  calculateSunsetScore,
  getQualityLabel,
  predictColor,
} = require('./prediction');
const {
  fetchJson,
  findHourIndex,
  getForecastDates,
  valueAt,
} = require('./shanghai');

const CITY_SPOTS = {
  beijing: {
    spot: 'beijing',
    spotName: '北京景山 / 故宫',
    location: '北京 · 东城',
    target: { lat: 39.92, lon: 116.40 },
    window: { name: '门头沟窗口', distanceKm: 50 },
    bestSpot: { name: '景山万春亭', desc: '俯拍故宫中轴线与黄琉璃瓦晚霞' },
    hook: '故宫全景烧霞预警 · 延时摄影参数',
    traits: ['city'],
  },
  erhai: {
    spot: 'erhai',
    spotName: '大理洱海',
    location: '云南 · 大理',
    target: { lat: 25.65, lon: 100.22 },
    window: { name: '苍山窗口', distanceKm: 15 },
    bestSpot: { name: '龙龛码头', desc: '水面开阔，适合橘子海与倒影构图' },
    hook: '龙龛码头 / 磻溪村 S 弯机位建议',
    traits: ['water'],
  },
  chongqing: {
    spot: 'chongqing',
    spotName: '重庆来福士 / 南山',
    location: '重庆 · 渝中',
    target: { lat: 29.56, lon: 106.58 },
    window: { name: '永川窗口', distanceKm: 100 },
    bestSpot: { name: '南山一棵树', desc: '俯瞰两江与来福士城市天际线' },
    hook: '千厮门大桥亮灯同步预报',
    traits: ['city', 'glass'],
  },
  xiamen: {
    spot: 'xiamen',
    spotName: '厦门黄厝沙滩',
    location: '福建 · 厦门',
    target: { lat: 24.44, lon: 118.16 },
    window: { name: '漳州窗口', distanceKm: 100 },
    bestSpot: { name: '黄厝海滩', desc: '环岛路海岸线与橘子海经典构图' },
    hook: '最美环岛路落日点位',
    traits: ['water'],
  },
  qingdao: {
    spot: 'qingdao',
    spotName: '青岛栈桥 / 五四广场',
    location: '山东 · 青岛',
    target: { lat: 36.06, lon: 120.32 },
    window: { name: '潍坊窗口', distanceKm: 100 },
    bestSpot: { name: '栈桥回澜阁', desc: '城市海岸线与回澜阁剪影同框' },
    hook: '海上回澜阁绝美日落',
    traits: ['water'],
  },
  chengdu: {
    spot: 'chengdu',
    spotName: '成都金融城双塔',
    location: '四川 · 成都',
    target: { lat: 30.58, lon: 104.06 },
    window: { name: '雅安 / 贡嘎窗口', distanceKm: 150 },
    bestSpot: { name: '交子公园', desc: '捕捉双塔玻璃幕墙与晚霞反光' },
    hook: '交子公园双塔反光点预报',
    traits: ['city', 'glass'],
  },
  shenzhen: {
    spot: 'shenzhen',
    spotName: '深圳人才公园 / 深圳湾',
    location: '广东 · 深圳',
    target: { lat: 22.51, lon: 113.94 },
    window: { name: '中山窗口', distanceKm: 100 },
    bestSpot: { name: '人才公园星光桥', desc: '后海天际线、湖面倒影与蓝调同框' },
    hook: '后海摩天楼蓝调预警',
    traits: ['water', 'city', 'glass'],
  },
  huangshan: {
    spot: 'huangshan',
    spotName: '黄山光明顶',
    location: '安徽 · 黄山',
    target: { lat: 30.13, lon: 118.15 },
    window: { name: '池州窗口', distanceKm: 100 },
    bestSpot: { name: '光明顶', desc: '云海、群峰剪影与落日同框' },
    hook: '云海 + 落日双重预测',
    traits: ['mountain'],
  },
};

const CITY_ALIASES = { jingshan: 'beijing' };

function calculateSunsetAzimuth(dateString, latitude) {
  const [year, month, day] = dateString.split('-').map(Number);
  const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);
  const radians = Math.PI / 180;
  const declination = 23.44 * Math.sin((2 * Math.PI / 365) * (284 + dayOfYear));
  const ratio = Math.sin(declination * radians) / Math.cos(latitude * radians);
  return 360 - Math.acos(Math.max(-1, Math.min(1, ratio))) / radians;
}

function destinationPoint(origin, bearing, distanceKm) {
  const angularDistance = distanceKm / 6371;
  const radians = Math.PI / 180;
  const latitude = origin.lat * radians;
  const longitude = origin.lon * radians;
  const direction = bearing * radians;
  const lat = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
    Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(direction)
  );
  const lon = longitude + Math.atan2(
    Math.sin(direction) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(lat)
  );
  return {
    lat: Math.round((lat / radians) * 10000) / 10000,
    lon: Math.round((lon / radians) * 10000) / 10000,
  };
}

function resolveWindowPoint(config, date) {
  const azimuth = calculateSunsetAzimuth(date, config.target.lat);
  return {
    ...config.window,
    ...destinationPoint(config.target, azimuth, config.window.distanceKm),
    azimuth: Math.round(azimuth * 10) / 10,
  };
}

function forecastUrl(point, fields, includeDaily = false, includePast = false) {
  const daily = includeDaily ? '&daily=sunrise,sunset' : '';
  const past = includePast ? '&past_hours=24' : '';
  return `https://api.open-meteo.com/v1/forecast?latitude=${point.lat}&longitude=${point.lon}&hourly=${fields}${daily}${past}&wind_speed_unit=ms&timezone=Asia%2FShanghai&forecast_days=3`;
}

function getSunTimes(payload, date) {
  const index = payload?.daily?.time?.indexOf(date) ?? -1;
  if (index < 0) return null;
  const sunrise = payload.daily.sunrise?.[index];
  const sunset = payload.daily.sunset?.[index];
  if (!sunrise || !sunset) return null;

  const minutes = value => {
    const [hour, minute] = value.slice(11, 16).split(':').map(Number);
    return hour * 60 + minute;
  };

  return {
    sunrise: sunrise.slice(11, 16),
    sunset: sunset.slice(11, 16),
    dayLength: minutes(sunset) - minutes(sunrise),
  };
}

function targetHour(payload, date) {
  const index = payload?.daily?.time?.indexOf(date) ?? -1;
  const sunset = index >= 0 ? payload.daily.sunset?.[index] : null;
  return sunset ? Number(sunset.slice(11, 13)) : 18;
}

function parseTarget(payload, date, hour) {
  const index = findHourIndex(payload, date, hour);
  if (index < 0) return null;
  const pressure = valueAt(payload, 'pressure_msl', index);
  const pressure24hAgo = index >= 24 ? valueAt(payload, 'pressure_msl', index - 24) : null;
  const precipitation = valueAt(payload, 'precipitation', index);
  const rain = valueAt(payload, 'rain', index);
  return {
    temperature: valueAt(payload, 'temperature_2m', index),
    humidity: valueAt(payload, 'relative_humidity_2m', index),
    visibility: (valueAt(payload, 'visibility', index) || 0) / 1000,
    cloudLow: valueAt(payload, 'cloud_cover_low', index),
    cloudMid: valueAt(payload, 'cloud_cover_mid', index),
    cloudHigh: valueAt(payload, 'cloud_cover_high', index),
    windSpeed: valueAt(payload, 'wind_speed_10m', index),
    windDirection: valueAt(payload, 'wind_direction_10m', index),
    lowLevelHumidity: valueAt(payload, 'relative_humidity_925hPa', index),
    humidity250: valueAt(payload, 'relative_humidity_250hPa', index),
    humidity700: valueAt(payload, 'relative_humidity_700hPa', index),
    windSpeed700: valueAt(payload, 'wind_speed_700hPa', index),
    pressure,
    pressureTrend24h: Number.isFinite(pressure) && Number.isFinite(pressure24hAgo)
      ? Math.round((pressure - pressure24hAgo) * 10) / 10
      : null,
    cloudBaseHeight: null,
    precipitation,
    precipitationRate: precipitation,
    precipitationProbability: valueAt(payload, 'precipitation_probability', index),
    rain,
    rainRate: rain,
    weatherCode: valueAt(payload, 'weather_code', index),
  };
}

function parseWindow(payload, date, hour) {
  const index = findHourIndex(payload, date, hour);
  if (index < 0) return null;
  return {
    cloudLow: valueAt(payload, 'cloud_cover_low', index),
    visibility: (valueAt(payload, 'visibility', index) || 0) / 1000,
  };
}

function windowStatus(weather) {
  if (!weather || !Number.isFinite(weather.cloudLow)) return 'UNKNOWN';
  if (weather.cloudLow > 60) return 'BLOCKED';
  if (weather.cloudLow < 20 && weather.visibility > 10) return 'CLEAR';
  return 'MIXED';
}

function predictRegionalSpot(config, weather, westernWeather, context = {}) {
  const model = calculateSunsetScore(config.spot, weather, westernWeather, context);
  const status = windowStatus(westernWeather);

  return {
    spot: config.spot,
    spotName: config.spotName,
    location: config.location,
    rawQuality: model.rawQuality,
    quality: model.quality,
    probability: model.probability,
    probabilityLevel: model.probabilityLevel,
    probabilityLabel: model.probabilityLabel,
    verdict: model.verdict,
    grade: model.grade,
    baseScore: model.baseScore,
    label: getQualityLabel(model.score),
    color: model.colorOverride || predictColor(weather.visibility, weather.humidity),
    weather: model.weather,
    confidence: westernWeather ? 'medium' : 'low',
    metrics: {
      cloudLow: weather.cloudLow,
      cloudMid: weather.cloudMid,
      cloudHigh: weather.cloudHigh,
      visibilityKm: weather.visibility,
      windowTransparency: Number.isFinite(westernWeather?.cloudLow)
        ? Math.max(0, 100 - westernWeather.cloudLow)
        : null,
      humidity250: weather.humidity250,
      precipitationMm: weather.precipitation,
      precipitationRateMmH: weather.precipitationRate,
      precipitationProbability: weather.precipitationProbability,
      weatherCode: weather.weatherCode,
    },
    windows: [
      { ...config.window, ...context.windowPoint, status },
      { name: '本地画布', ...config.target, status: windowStatus(weather) },
    ],
    bestSpot: config.bestSpot,
    photographyAdvice: config.hook,
    corrections: model.corrections,
    components: model.components,
    modelInputs: model.inputs,
    dataAvailability: model.dataAvailability,
    timeOffsetMinutes: model.timeOffsetMinutes,
    afterglowDecay: model.afterglowDecay,
    modelVersion: model.modelVersion,
    source: `${config.spot}-model-v3`,
  };
}

async function getCityPrediction(slug, options = {}) {
  const resolvedSlug = CITY_ALIASES[slug] || slug;
  const config = CITY_SPOTS[resolvedSlug];
  if (!config) throw new Error(`未知站点: ${slug}`);

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const windowDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const windowPoint = resolveWindowPoint(config, windowDate);
  const targetFields = 'temperature_2m,relative_humidity_2m,visibility,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m,pressure_msl,relative_humidity_925hPa,relative_humidity_700hPa,relative_humidity_250hPa,wind_speed_700hPa,precipitation_probability,precipitation,rain,weather_code';
  const windowFields = 'cloud_cover_low,visibility';
  const [targetPayload, windowPayload] = await Promise.all([
    fetchJson(forecastUrl(config.target, targetFields, true, true), fetchImpl),
    fetchJson(forecastUrl(windowPoint, windowFields), fetchImpl),
  ]);
  const dates = targetPayload?.daily?.time?.slice(0, 3) || getForecastDates(targetPayload);
  const predictions = dates.map(date => {
    const hour = targetHour(targetPayload, date);
    const weather = parseTarget(targetPayload, date, hour);
    const westernWeather = parseWindow(windowPayload, date, hour);
    if (!weather) return null;
    return {
      date,
      sunTimes: getSunTimes(targetPayload, date),
      ...predictRegionalSpot(config, weather, westernWeather, {
        windowPoint,
        typhoonNearby: options.typhoonNearby ?? null,
      }),
    };
  }).filter(Boolean);

  if (!predictions.length) throw new Error(`${config.spotName}没有可用小时数据`);
  const [today] = predictions;
  return {
    ...today,
    target: config.target,
    window: windowPoint,
    days: predictions,
    forecast: predictions.map(({ date, rawQuality, quality, probability, probabilityLabel, label, color, verdict, weather }) => ({
      date, rawQuality, quality, probability, probabilityLabel, label, color, verdict, weather,
    })),
    sourceStatus: {
      openMeteo: 'connected',
      westernWindow: 'connected',
      precipitation: predictions.some(prediction => Number.isFinite(prediction.metrics.precipitationRateMmH))
        ? 'connected'
        : 'unavailable',
      cloudBaseHeight: config.spot === 'huangshan'
        ? today.dataAvailability.cloudBaseHeight
        : 'not-required',
      typhoonTrack: ['xiamen', 'shenzhen'].includes(config.spot) ? 'unavailable' : 'not-required',
    },
    fetchedAt: new Date().toISOString(),
    statusText: `实时预测 · ${config.spot}-model-v3`,
  };
}

async function getAllCityPredictions(options = {}) {
  const entries = Object.keys(CITY_SPOTS);
  const results = [];
  for (let index = 0; index < entries.length; index += 2) {
    const batch = entries.slice(index, index + 2);
    results.push(...await Promise.allSettled(batch.map(slug => getCityPrediction(slug, options))));
  }
  for (let index = 0; index < results.length; index += 1) {
    if (results[index].status === 'fulfilled') continue;
    results[index] = await getCityPrediction(entries[index], options)
      .then(value => ({ status: 'fulfilled', value }))
      .catch(reason => ({ status: 'rejected', reason }));
  }
  return {
    spots: results.map((result, index) => result.status === 'fulfilled'
      ? result.value
      : { spot: entries[index], spotName: CITY_SPOTS[entries[index]].spotName, error: result.reason.message }),
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = {
  CITY_ALIASES,
  CITY_SPOTS,
  calculateSunsetAzimuth,
  destinationPoint,
  forecastUrl,
  getAllCityPredictions,
  getCityPrediction,
  getSunTimes,
  parseTarget,
  parseWindow,
  predictRegionalSpot,
  resolveWindowPoint,
};
