const {
  calculateSunsetScore,
  getQualityLabel,
  predictColor,
} = require('./prediction');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  fetchJson,
  findHourIndex,
  getForecastDates,
  valueAt,
} = require('./shanghai');
const {
  buildSunsetWindow,
  sampleRemote,
  sampleWeather,
} = require('./sunset-window');
const { buildBlueHour, getBlueHourTimes } = require('./blue-hour');
const { fetchQWeatherHourly, mergeQWeather, qweatherConfig } = require('./qweather');

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
  guangzhou: {
    spot: 'guangzhou',
    spotName: '广州塔 / 海心桥',
    location: '广东 · 广州',
    target: { lat: 23.109, lon: 113.319 },
    window: { name: '肇庆窗口', distanceKm: 100 },
    bestSpot: { name: '海心桥', desc: '广州塔、珠江与城市晚霞同框' },
    hook: '广州塔金光与珠江蓝调预报',
    traits: ['water', 'city', 'glass'],
  },
  wuhan: {
    spot: 'wuhan',
    spotName: '武汉黄鹤楼 / 长江大桥',
    location: '湖北 · 武汉',
    target: { lat: 30.544, lon: 114.302 },
    window: { name: '仙桃窗口', distanceKm: 100 },
    bestSpot: { name: '黄鹤楼西爽亭', desc: '黄鹤楼、长江大桥与城市天际线同框' },
    hook: '黄鹤楼金顶与长江落日预报',
    traits: ['water', 'city'],
  },
  sanya: {
    spot: 'sanya',
    spotName: '三亚椰梦长廊',
    location: '海南 · 三亚',
    target: { lat: 18.267, lon: 109.489 },
    window: { name: '南海窗口', distanceKm: 100 },
    bestSpot: { name: '椰梦长廊', desc: '椰林剪影、海面落日与晚霞同框' },
    hook: '椰梦长廊橘子海预报',
    traits: ['water'],
  },
  xian: {
    spot: 'xian',
    spotName: '西安城墙 / 永宁门',
    location: '陕西 · 西安',
    target: { lat: 34.253, lon: 108.946 },
    window: { name: '周至窗口', distanceKm: 80 },
    bestSpot: { name: '永宁门城墙', desc: '城楼、古城墙与落日余晖同框' },
    hook: '古城墙金色余晖预报',
    traits: ['city'],
  },
  nanjing: {
    spot: 'nanjing',
    spotName: '南京玄武湖',
    location: '江苏 · 南京',
    target: { lat: 32.067, lon: 118.806 },
    window: { name: '滁州窗口', distanceKm: 100 },
    bestSpot: { name: '玄武湖环洲', desc: '湖面、城墙与紫金山暮色同框' },
    hook: '玄武湖落日与城市蓝调预报',
    traits: ['water', 'city'],
  },
  xiapu: {
    spot: 'xiapu',
    spotName: '霞浦东壁村',
    location: '福建 · 宁德',
    target: { lat: 26.789, lon: 119.678 },
    window: { name: '内陆山地窗口', distanceKm: 60 },
    bestSpot: { name: '东壁村观景台', desc: '滩涂纹理、渔排与海湾落日同框' },
    hook: '滩涂光影与海湾晚霞预报',
    traits: ['water', 'mountain'],
  },
  wuxi: {
    spot: 'wuxi',
    spotName: '无锡鼋头渚 / 太湖',
    location: '江苏 · 无锡',
    target: { lat: 31.523, lon: 120.218 },
    window: { name: '宜兴窗口', distanceKm: 100 },
    bestSpot: { name: '鼋头渚长春桥', desc: '太湖水面、远山与落日余晖同框' },
    hook: '太湖落日与水面铺霞预报',
    traits: ['water'],
  },
  hongkong: {
    spot: 'hongkong',
    spotName: '香港维多利亚港',
    location: '香港 · 维多利亚港',
    target: { lat: 22.294, lon: 114.169 },
    window: { name: '大屿山 / 珠江口窗口', distanceKm: 100 },
    bestSpot: { name: '西九文化区海滨', desc: '维港天际线、海面反光与城市蓝调同框' },
    hook: '维港晚霞与城市亮灯预报',
    traits: ['water', 'city', 'glass'],
  },
  dunhuang: {
    spot: 'dunhuang',
    spotName: '敦煌鸣沙山月牙泉',
    location: '甘肃 · 敦煌',
    target: { lat: 40.08744, lon: 94.66944 },
    window: { name: '阿克塞 / 西戈壁窗口', distanceKm: 100 },
    bestSpot: { name: '鸣沙山山脊', desc: '俯拍月牙泉、沙丘纹理与驼队剪影' },
    hook: '沙山落日 · 沙尘与剪影参数',
    traits: ['desert'],
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
  const points = Array.isArray(point) ? point : [point];
  const latitudes = points.map(item => item.lat).join(',');
  const longitudes = points.map(item => item.lon).join(',');
  const daily = includeDaily ? '&daily=sunrise,sunset' : '';
  const past = includePast ? '&past_hours=24' : '';
  return `https://api.open-meteo.com/v1/forecast?latitude=${latitudes}&longitude=${longitudes}&hourly=${fields}${daily}${past}&wind_speed_unit=ms&timezone=Asia%2FShanghai&forecast_days=3`;
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
    cloudTotal: valueAt(payload, 'cloud_cover', index),
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

// 卫星实况保守修正: 仅当葵花真彩观测与数值预报的远程低云分歧超过阈值时,
// 按 预报60% / 卫星40% 加权融合 (预报为主, 卫星纠偏), 其余情况只记录不修正。
const SATELLITE_DISAGREE_THRESHOLD = 15; // 分歧阈值 (百分点)
const SATELLITE_BLEND_WEIGHT = 0.4;      // 卫星观测权重

function applySatelliteWindow(westernWeather, satWindow) {
  if (!satWindow || !satWindow.usable || !Number.isFinite(satWindow.cloudCover)
    || !Number.isFinite(westernWeather?.cloudLow)) {
    return { westernWeather, satellite: null };
  }
  const forecast = westernWeather.cloudLow;
  const observed = satWindow.cloudCover;
  const satellite = {
    source: 'himawari-truecolor',
    cloudCover: observed,
    forecastCloudLow: forecast,
    azimuthDeg: satWindow.azimuthDeg ?? null,
    observedAt: satWindow.observedAt instanceof Date
      ? satWindow.observedAt.toISOString()
      : satWindow.observedAt ?? null,
    minutesBeforeSunset: satWindow.minutesBeforeSunset ?? null,
    applied: false,
  };
  if (Math.abs(observed - forecast) <= SATELLITE_DISAGREE_THRESHOLD) {
    return { westernWeather, satellite };
  }
  const blended = Math.round(forecast * (1 - SATELLITE_BLEND_WEIGHT) + observed * SATELLITE_BLEND_WEIGHT);
  satellite.applied = true;
  satellite.blendedCloudLow = blended;
  return { westernWeather: { ...westernWeather, cloudLow: blended }, satellite };
}

function predictRegionalSpot(config, weather, westernWeather, context = {}) {
  const satResult = applySatelliteWindow(westernWeather, context.satelliteWindow);
  const effectiveWestern = satResult.westernWeather;
  const model = calculateSunsetScore(config.spot, weather, effectiveWestern, context);
  const status = windowStatus(effectiveWestern);
  const corrections = satResult.satellite?.applied
    ? [...model.corrections, {
      item: '卫星实况修正',
      value: `远程低云 ${satResult.satellite.forecastCloudLow}%→${satResult.satellite.blendedCloudLow}%`,
      desc: `葵花卫星真彩观测西方窗口云量${satResult.satellite.cloudCover}%，与预报分歧大，按预报60%/卫星40%加权`,
    }]
    : model.corrections;

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
    confidence: satResult.satellite?.applied ? 'high' : (westernWeather ? 'medium' : 'low'),
    satellite: satResult.satellite,
    metrics: {
      cloudLow: weather.cloudLow,
      cloudMid: weather.cloudMid,
      cloudHigh: weather.cloudHigh,
      visibilityKm: weather.visibility,
      windowTransparency: Number.isFinite(effectiveWestern?.cloudLow)
        ? Math.max(0, 100 - effectiveWestern.cloudLow)
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
    corrections,
    components: model.components,
    modelInputs: model.inputs,
    dataAvailability: model.dataAvailability,
    timeOffsetMinutes: model.timeOffsetMinutes,
    afterglowDecay: model.afterglowDecay,
    modelVersion: model.modelVersion,
    source: `${config.spot}-model-v3`,
  };
}

// 从 SatelliteNowcast 实例安全获取站点西方窗口实况 (失败或未配置一律返回 null, 不影响主链路)
function satelliteWindowFor(satellite, config) {
  if (!satellite || typeof satellite.getWindowForSite !== 'function') return null;
  try {
    return satellite.getWindowForSite(config.target.lat, config.target.lon);
  } catch {
    return null;
  }
}

async function getCityPrediction(slug, options = {}) {
  const resolvedSlug = CITY_ALIASES[slug] || slug;
  const config = FORECAST_SPOTS[resolvedSlug];
  if (!config) throw new Error(`未知站点: ${slug}`);

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const windowDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const windowPoint = resolveWindowPoint(config, windowDate);
  const targetFields = 'temperature_2m,relative_humidity_2m,visibility,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m,pressure_msl,relative_humidity_925hPa,relative_humidity_700hPa,relative_humidity_250hPa,wind_speed_700hPa,precipitation_probability,precipitation,rain,weather_code';
  const windowFields = 'cloud_cover_low,visibility';
  let qweatherConfigured = false;
  if (config.useQWeather !== false) {
    try {
      qweatherConfigured = Boolean(qweatherConfig(options));
    } catch {
      qweatherConfigured = true;
    }
  }
  const [targetPayload, windowPayload, qweatherResult] = await Promise.all([
    fetchJson(forecastUrl(config.target, targetFields, true, true), fetchImpl, options.timeoutMs, options.retryOptions),
    fetchJson(forecastUrl(windowPoint, windowFields), fetchImpl, options.timeoutMs, options.retryOptions),
    config.useQWeather === false
      ? Promise.resolve({ value: null })
      : fetchQWeatherHourly(config.target, { ...options, fetchImpl })
        .then(value => ({ value }))
        .catch(() => ({ value: null })),
  ]);
  return buildCityPrediction(config, targetPayload, windowPayload, windowPoint, {
    ...options,
    qweatherConfigured,
    qweatherPayload: qweatherResult.value,
    satelliteConfigured: Boolean(options.satellite),
    satelliteWindow: satelliteWindowFor(options.satellite, config),
  });
}

function buildCityPrediction(config, targetPayload, windowPayload, windowPoint, options = {}) {
  const dates = targetPayload?.daily?.time?.slice(0, 3) || getForecastDates(targetPayload);
  const predictions = dates.map((date, dateIndex) => {
    const hour = targetHour(targetPayload, date);
    const sunTimes = getSunTimes(targetPayload, date);
    const localTime = `${date}T${sunTimes?.sunset || `${String(hour).padStart(2, '0')}:00`}`;
    const weather = mergeQWeather(parseTarget(targetPayload, date, hour), options.qweatherPayload, localTime);
    const westernWeather = parseWindow(windowPayload, date, hour);
    if (!weather) return null;
    const blueHourTimes = getBlueHourTimes(date, config.target.lat, config.target.lon);
    const blueHourWeather = blueHourTimes
      ? sampleWeather(targetPayload, `${date}T${blueHourTimes.midpoint}`, 'interpolated-from-hourly') || weather
      : null;
    return {
      date,
      sunTimes,
      blueHour: blueHourWeather
        ? buildBlueHour({
          date,
          latitude: config.target.lat,
          longitude: config.target.lon,
          weather: blueHourWeather,
          spotId: config.spot,
        })
        : { available: false, message: '蓝调气象数据不足' },
      sunsetWindow: sunTimes
        ? buildSunsetWindow({
          date,
          sunset: sunTimes.sunset,
          resolution: 'interpolated-from-hourly',
          slowAfterglow: ['qingdao', 'huangshan'].includes(config.spot),
          evaluateNode(localTime) {
            const nodeWeather = mergeQWeather(
              sampleWeather(targetPayload, localTime, 'interpolated-from-hourly'),
              options.qweatherPayload,
              localTime
            );
            const nodeWindow = sampleRemote(windowPayload, localTime);
            if (![nodeWeather?.cloudHigh, nodeWeather?.cloudMid, nodeWeather?.cloudLow, nodeWeather?.visibility, nodeWindow?.cloudLow].every(Number.isFinite)) {
              return null;
            }
            const node = predictRegionalSpot(config, nodeWeather, nodeWindow, {
              windowPoint,
              typhoonNearby: options.typhoonNearby ?? null,
            });
            return {
              quality: node.quality,
              probability: node.probability,
              weather: node.weather,
              corrections: node.corrections,
              metrics: {
                cloudHigh: nodeWeather.cloudHigh,
                cloudMid: nodeWeather.cloudMid,
                cloudLow: nodeWeather.cloudLow,
                humidity925: nodeWeather.lowLevelHumidity,
                visibilityKm: nodeWeather.visibility,
                remoteLowCloud: nodeWindow.cloudLow,
                windowTransparency: 100 - nodeWindow.cloudLow,
              },
            };
          },
        })
        : { available: false, message: '趋势数据不足', timeline: [] },
      ...predictRegionalSpot(config, weather, westernWeather, {
        windowPoint,
        typhoonNearby: options.typhoonNearby ?? null,
        // 卫星实况仅用于今天的主预测 (观测时效只覆盖当日日落前窗口)
        satelliteWindow: dateIndex === 0 ? options.satelliteWindow ?? null : null,
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
    forecast: predictions.map(({ date, rawQuality, quality, probability, probabilityLabel, label, color, verdict, weather, blueHour }) => ({
      date, rawQuality, quality, probability, probabilityLabel, label, color, verdict, weather, blueHour,
    })),
    sourceStatus: {
      openMeteo: 'connected',
      westernWindow: 'connected',
      qweather: !options.qweatherConfigured
        ? 'not-configured'
        : options.qweatherPayload ? 'connected' : 'unavailable',
      satellite: !options.satelliteConfigured
        ? 'not-configured'
        : options.satelliteWindow?.usable ? 'connected' : 'unavailable',
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

function normalizeBatchPayload(payload, expectedLength) {
  const items = Array.isArray(payload) ? payload : [payload];
  if (items.length !== expectedLength) throw new Error(`批量气象数据数量异常: ${items.length}/${expectedLength}`);
  return items;
}

async function readRegionalCache(cacheFile) {
  if (!cacheFile) return null;
  try {
    const payload = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    if (payload?.spots?.length !== Object.keys(FORECAST_SPOTS).length) return null;
    if (payload.spots.some(spot => !Number.isFinite(spot.quality) || spot.error)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function writeRegionalCache(cacheFile, payload) {
  if (!cacheFile) return;
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  const temporaryFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(payload));
  await fs.rename(temporaryFile, cacheFile);
}

function staleRegionalCache(payload, error) {
  return {
    ...payload,
    cacheStatus: 'stale',
    fallbackAt: new Date().toISOString(),
    fallbackReason: error.message,
    spots: payload.spots.map(spot => ({
      ...spot,
      sourceStatus: { ...spot.sourceStatus, openMeteo: 'stale-cache', westernWindow: 'stale-cache' },
      statusText: '最近成功预测 · 上游恢复中',
    })),
  };
}

async function allSettledWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function getAllCityPredictions(options = {}) {
  const entries = Object.keys(FORECAST_SPOTS);
  const configs = entries.map(slug => FORECAST_SPOTS[slug]);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const windowDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const windowPoints = configs.map(config => resolveWindowPoint(config, windowDate));
  const targetFields = 'temperature_2m,relative_humidity_2m,visibility,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m,pressure_msl,relative_humidity_925hPa,relative_humidity_700hPa,relative_humidity_250hPa,wind_speed_700hPa,precipitation_probability,precipitation,rain,weather_code';
  const windowFields = 'cloud_cover_low,visibility';
  let qweatherConfigured = false;
  try {
    qweatherConfigured = Boolean(qweatherConfig(options));
  } catch {
    qweatherConfigured = true;
  }

  try {
    const [targetBatch, windowBatch, qweatherResults] = await Promise.all([
      fetchJson(forecastUrl(configs.map(config => config.target), targetFields, true, true), fetchImpl, options.timeoutMs, options.retryOptions),
      fetchJson(forecastUrl(windowPoints, windowFields), fetchImpl, options.timeoutMs, options.retryOptions),
      allSettledWithConcurrency(
        configs.filter(config => config.useQWeather !== false),
        5,
        config => fetchQWeatherHourly(config.target, { ...options, fetchImpl })
      ),
    ]);
    const targetPayloads = normalizeBatchPayload(targetBatch, entries.length);
    const windowPayloads = normalizeBatchPayload(windowBatch, entries.length);
    const result = {
      spots: configs.map((config, index) => {
        const qweatherIndex = configs
          .slice(0, index)
          .filter(item => item.useQWeather !== false).length;
        const qweatherResult = config.useQWeather === false ? null : qweatherResults[qweatherIndex];
        return buildCityPrediction(
          config,
          targetPayloads[index],
          windowPayloads[index],
          windowPoints[index],
          {
            ...options,
            qweatherConfigured: config.useQWeather === false ? false : qweatherConfigured,
            qweatherPayload: qweatherResult?.status === 'fulfilled' ? qweatherResult.value : null,
            satelliteConfigured: Boolean(options.satellite),
            satelliteWindow: satelliteWindowFor(options.satellite, config),
          }
        );
      }),
      fetchedAt: new Date().toISOString(),
      cacheStatus: 'live',
    };
    await writeRegionalCache(options.cacheFile, result).catch(() => {});
    return result;
  } catch (error) {
    const cached = await readRegionalCache(options.cacheFile);
    if (cached) return staleRegionalCache(cached, error);
    throw error;
  }
}

// 省份热门落日点：复用全国站通用物理模型与 Open-Meteo 数据。
// 为避免全国聚合接口额外并发 18 次 QWeather 请求，这批站点使用 Open-Meteo weather_code
// 与降水字段展示天气；评分、成功率、蓝调和日落窗口均与原全国站保持一致。
const PROVINCE_SPOTS = {
  'caoyuan-tianlu': {
    spot: 'caoyuan-tianlu',
    spotName: '张家口草原天路',
    location: '河北 · 张家口',
    target: { lat: 41.18, lon: 114.73 },
    window: { name: '张家口西方高原草坡窗口', distanceKm: 100 },
    bestSpot: { name: '草原天路风车矩阵段', desc: '风车群与草坡作前景，西方云霞铺天' },
    hook: '风车矩阵与高原落日预报',
    traits: ['mountain'],
    useQWeather: false,
  },
  hukou: {
    spot: 'hukou',
    spotName: '吉县壶口瀑布',
    location: '山西 · 临汾',
    target: { lat: 36.13, lon: 110.45 },
    window: { name: '晋陕峡谷西岸黄河窗口', distanceKm: 80 },
    bestSpot: { name: '壶口山西侧观瀑台', desc: '黄河落差与落日水雾同框，常现彩虹' },
    hook: '黄河水雾与峡谷落日预报',
    traits: ['water', 'mountain'],
    useQWeather: false,
  },
  longmen: {
    spot: 'longmen',
    spotName: '洛阳龙门石窟',
    location: '河南 · 洛阳',
    target: { lat: 34.56, lon: 112.48 },
    window: { name: '伊河西岸窗口', distanceKm: 80 },
    bestSpot: { name: '西山石窟滨水步道', desc: '石窟剪影与伊河晚霞倒影同框' },
    hook: '石窟剪影与伊河晚霞预报',
    traits: ['water', 'city'],
    useQWeather: false,
  },
  'haerbin-song': {
    spot: 'haerbin-song',
    spotName: '哈尔滨松花江铁路桥',
    location: '黑龙江 · 哈尔滨',
    target: { lat: 45.77, lon: 126.62 },
    window: { name: '松花江西向江面窗口', distanceKm: 100 },
    bestSpot: { name: '中东铁路桥（老江桥）', desc: '城市江景落日，钢铁桥架作前景' },
    hook: '老江桥剪影与松花江落日预报',
    traits: ['water', 'city'],
    useQWeather: false,
  },
  wusongdao: {
    spot: 'wusongdao',
    spotName: '吉林雾凇岛',
    location: '吉林 · 吉林市',
    target: { lat: 44.96, lon: 126.63 },
    window: { name: '松花江北岸西向窗口', distanceKm: 100 },
    bestSpot: { name: '雾凇岛乌拉街江段', desc: '界江与村落剪影，秋冬落日清冽' },
    hook: '雾凇江面与清冽落日预报',
    traits: ['water'],
    useQWeather: false,
  },
  yalu: {
    spot: 'yalu',
    spotName: '丹东鸭绿江断桥',
    location: '辽宁 · 丹东',
    target: { lat: 40.11, lon: 124.39 },
    window: { name: '鸭绿江西向界河窗口', distanceKm: 100 },
    bestSpot: { name: '鸭绿江断桥观景台', desc: '中朝界河落日，断桥钢架剪影辨识度强' },
    hook: '断桥剪影与界河落日预报',
    traits: ['water', 'city'],
    useQWeather: false,
  },
  hengshan: {
    spot: 'hengshan',
    spotName: '衡山祝融峰',
    location: '湖南 · 衡阳',
    target: { lat: 27.30, lon: 112.74 },
    window: { name: '南岳西岭窗口', distanceKm: 60 },
    bestSpot: { name: '祝融峰顶观日台', desc: '湖南第一观日落云海地，峰林被染红' },
    hook: '祝融峰云海与峰林晚霞预报',
    traits: ['mountain'],
    useQWeather: false,
  },
  lushan: {
    spot: 'lushan',
    spotName: '庐山含鄱口',
    location: '江西 · 九江',
    target: { lat: 29.53, lon: 116.03 },
    window: { name: '鄱阳湖北向湖口窗口', distanceKm: 80 },
    bestSpot: { name: '含鄱口望鄱亭', desc: '鄱阳湖落日，江湖一览，江西经典机位' },
    hook: '鄱阳湖落日与山湖云霞预报',
    traits: ['mountain', 'water'],
    useQWeather: false,
  },
  fanjing: {
    spot: 'fanjing',
    spotName: '铜仁梵净山',
    location: '贵州 · 铜仁',
    target: { lat: 27.90, lon: 108.69 },
    window: { name: '黔东武陵山西坡窗口', distanceKm: 60 },
    bestSpot: { name: '红云金顶观景台', desc: '云海日落 + 蘑菇石剪影，贵州最网红' },
    hook: '红云金顶与武陵云海预报',
    traits: ['mountain'],
    useQWeather: false,
  },
  namtso: {
    spot: 'namtso',
    spotName: '当雄纳木错',
    location: '西藏 · 拉萨',
    target: { lat: 30.72, lon: 90.60 },
    window: { name: '念青唐古拉西向圣湖窗口', distanceKm: 100 },
    bestSpot: { name: '纳木错扎西半岛', desc: '圣湖落日，雪峰映湖，三大圣湖之首' },
    hook: '圣湖倒影与雪峰落日预报',
    traits: ['water', 'mountain'],
    useQWeather: false,
  },
  heimahe: {
    spot: 'heimahe',
    spotName: '青海湖黑马河',
    location: '青海 · 海南州',
    target: { lat: 36.58, lon: 99.78 },
    window: { name: '青海湖西岸窗口', distanceKm: 100 },
    bestSpot: { name: '黑马河乡湖滨', desc: '湖面正面落日，青海最经典看日落地' },
    hook: '青海湖正面落日与水面铺霞预报',
    traits: ['water'],
    useQWeather: false,
  },
  ejina: {
    spot: 'ejina',
    spotName: '额济纳胡杨林',
    location: '内蒙古 · 阿拉善',
    target: { lat: 41.96, lon: 101.07 },
    window: { name: '巴丹吉林西缘荒漠窗口', distanceKm: 100 },
    bestSpot: { name: '额济纳二道桥胡杨林', desc: '金秋胡杨落日，现象级网红（窗口仅十几天）' },
    hook: '胡杨金秋与荒漠落日预报',
    traits: ['desert'],
    useQWeather: false,
  },
  xiangbishan: {
    spot: 'xiangbishan',
    spotName: '桂林象鼻山',
    location: '广西 · 桂林',
    target: { lat: 25.27, lon: 110.29 },
    window: { name: '漓江西向城徽窗口', distanceKm: 60 },
    bestSpot: { name: '象鼻山滨水观景道', desc: '漓江落日 + 城徽剪影，广西代表画面' },
    hook: '象鼻山剪影与漓江晚霞预报',
    traits: ['water', 'mountain'],
    useQWeather: false,
  },
  helanshan: {
    spot: 'helanshan',
    spotName: '贺兰山岩画',
    location: '宁夏 · 银川',
    target: { lat: 38.49, lon: 105.97 },
    window: { name: '贺兰山西麓山影窗口', distanceKm: 50 },
    bestSpot: { name: '贺兰山岩画遗址区', desc: '山影落日，岩画作前景，苍茫感强' },
    hook: '贺兰山影与荒漠落日预报',
    traits: ['mountain', 'desert'],
    useQWeather: false,
  },
  kanas: {
    spot: 'kanas',
    spotName: '喀纳斯神仙湾',
    location: '新疆 · 阿勒泰',
    target: { lat: 48.73, lon: 87.02 },
    window: { name: '阿尔泰西向河湾窗口', distanceKm: 80 },
    bestSpot: { name: '喀纳斯神仙湾木栈道', desc: '晨雾/晚霞双绝，河湾镜面，新疆顶流' },
    hook: '神仙湾镜面与阿尔泰晚霞预报',
    traits: ['water', 'mountain'],
    useQWeather: false,
  },
  taipei: {
    spot: 'taipei',
    spotName: '台北象山',
    location: '台湾 · 台北',
    target: { lat: 25.03, lon: 121.57 },
    window: { name: '台北盆地西向天际线窗口', distanceKm: 100 },
    bestSpot: { name: '象山六巨石/摄影平台', desc: '城市天际线落日，台湾最经典机位' },
    hook: '台北天际线与象山蓝调预报',
    traits: ['city', 'mountain'],
    useQWeather: false,
  },
  'tianjin-wudadao': {
    spot: 'tianjin-wudadao',
    spotName: '天津五大道',
    location: '天津 · 和平区',
    target: { lat: 39.12, lon: 117.20 },
    window: { name: '海河以西洋楼窗口', distanceKm: 100 },
    bestSpot: { name: '五大道睦南道梧桐区', desc: '洋楼梧桐晚霞，小红书热门落日机位' },
    hook: '洋楼梧桐与城市晚霞预报',
    traits: ['city'],
    useQWeather: false,
  },
  coloane: {
    spot: 'coloane',
    spotName: '澳门路环黑沙',
    location: '澳门 · 路环',
    target: { lat: 22.12, lon: 113.56 },
    window: { name: '路环西向海岸窗口', distanceKm: 100 },
    bestSpot: { name: '黑沙海滩西岸', desc: '离岛海滩落日，澳门少有的自然落日地' },
    hook: '黑沙海岸与离岛落日预报',
    traits: ['water'],
    useQWeather: false,
  },
};

const FORECAST_SPOTS = Object.freeze({
  ...CITY_SPOTS,
  ...PROVINCE_SPOTS,
});

module.exports = {
  CITY_ALIASES,
  CITY_SPOTS,
  FORECAST_SPOTS,
  PROVINCE_SPOTS,
  applySatelliteWindow,
  calculateSunsetAzimuth,
  destinationPoint,
  forecastUrl,
  buildCityPrediction,
  getAllCityPredictions,
  getCityPrediction,
  getSunTimes,
  parseTarget,
  parseWindow,
  predictRegionalSpot,
  resolveWindowPoint,
};
