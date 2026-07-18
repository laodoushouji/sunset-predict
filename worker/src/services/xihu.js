const { predictXihu, XIHU_CONFIG } = require('./prediction');
const {
  fetchJson,
  getForecastDates,
  findHourIndex,
  valueAt,
  getTargetHour,
  parseAirQuality,
} = require('./shanghai');
const {
  buildSunsetWindow,
  sampleRemote,
  sampleWeather,
} = require('./sunset-window');
const { fetchQWeatherHourly, mergeQWeather, qweatherConfig } = require('./qweather');

const XIHU_API = {
  target: 'https://api.open-meteo.com/v1/forecast?latitude=30.25&longitude=120.15&hourly=temperature_2m,relative_humidity_2m,visibility,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,relative_humidity_925hPa,relative_humidity_250hPa,precipitation_probability,precipitation,rain,weather_code&minutely_15=temperature_2m,relative_humidity_2m,visibility,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,precipitation,rain,weather_code&forecast_minutely_15=288&daily=sunrise,sunset&wind_speed_unit=ms&timezone=Asia%2FShanghai&forecast_days=3',
  linan: 'https://api.open-meteo.com/v1/forecast?latitude=30.24&longitude=119.75&hourly=cloud_cover_low,visibility&timezone=Asia%2FShanghai&forecast_days=3',
  fuyang: 'https://api.open-meteo.com/v1/forecast?latitude=30.05&longitude=119.95&hourly=cloud_cover_low,visibility&timezone=Asia%2FShanghai&forecast_days=3',
  airQuality: token => `https://api.waqi.info/feed/hangzhou/?token=${encodeURIComponent(token)}`,
};

function subtractMinutes(localIso, minutes) {
  const [date, time] = localIso.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute - minutes))
    .toISOString().slice(0, 16);
}

function parseTargetAtSunsetOffset(payload, date, offsetMinutes = -15) {
  const dailyIndex = payload?.daily?.time?.indexOf(date) ?? -1;
  const sunset = dailyIndex >= 0 ? payload.daily.sunset?.[dailyIndex] : null;
  const targetTime = sunset ? subtractMinutes(sunset, Math.abs(offsetMinutes)) : null;
  const targetTimestamp = targetTime ? Date.parse(`${targetTime}:00Z`) : NaN;
  const times = payload?.minutely_15?.time || [];
  let index = -1;
  let smallestDifference = Infinity;
  times.forEach((time, candidateIndex) => {
    const difference = Math.abs(Date.parse(`${time}:00Z`) - targetTimestamp);
    if (difference < smallestDifference) {
      smallestDifference = difference;
      index = candidateIndex;
    }
  });
  if (smallestDifference > 8 * 60 * 1000) index = -1;
  if (index < 0) return null;

  const value = field => {
    const item = payload?.minutely_15?.[field]?.[index];
    return Number.isFinite(item) ? item : null;
  };
  const precipitation = value('precipitation');
  const rain = value('rain');
  return {
    temperature: value('temperature_2m'),
    humidity: value('relative_humidity_2m'),
    visibility: (value('visibility') || 0) / 1000,
    cloudLow: value('cloud_cover_low'),
    cloudMid: value('cloud_cover_mid'),
    cloudHigh: value('cloud_cover_high'),
    windSpeed: value('wind_speed_10m'),
    precipitation,
    precipitationRate: Number.isFinite(precipitation) ? precipitation * 4 : null,
    rain,
    rainRate: Number.isFinite(rain) ? rain * 4 : null,
    weatherCode: value('weather_code'),
  };
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
    windSpeed: valueAt(payload, 'wind_speed_10m', index),
    lowLevelHumidity: valueAt(payload, 'relative_humidity_925hPa', index),
    humidity250: valueAt(payload, 'relative_humidity_250hPa', index),
    precipitation,
    precipitationRate: Number.isFinite(precipitation) ? precipitation : null,
    precipitationProbability: valueAt(payload, 'precipitation_probability', index),
    rain,
    rainRate: Number.isFinite(rain) ? rain : null,
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

function getSunTimes(payload, date) {
  const index = payload?.daily?.time?.indexOf(date) ?? -1;
  if (index < 0) return null;
  const sunrise = payload.daily.sunrise?.[index];
  const sunset = payload.daily.sunset?.[index];
  if (!sunrise || !sunset) return null;

  return {
    sunrise: sunrise.slice(11, 16),
    sunset: sunset.slice(11, 16),
    dayLength: Math.round((new Date(sunset) - new Date(sunrise)) / 60000),
  };
}

function buildXihuSunsetWindow(date, sunset, targetPayload, linanPayload, fuyangPayload, airQuality, qweatherPayload = null) {
  return buildSunsetWindow({
    date,
    sunset,
    effectiveOffsetMinutes: -15,
    resolution: 'native-15m',
    evaluateNode(localTime) {
      const weather = mergeQWeather(
        sampleWeather(targetPayload, localTime, 'native-15m'),
        qweatherPayload,
        localTime
      );
      const linan = sampleRemote(linanPayload, localTime);
      const fuyang = sampleRemote(fuyangPayload, localTime);
      if (![weather?.cloudHigh, weather?.cloudMid, weather?.cloudLow, weather?.visibility, linan?.cloudLow].every(Number.isFinite)) {
        return null;
      }
      const model = predictXihu(weather, { '临安': linan, '富阳': fuyang }, airQuality);
      return {
        quality: model.quality,
        probability: model.probability,
        weather: model.weather,
        corrections: model.corrections,
        metrics: {
          cloudHigh: weather.cloudHigh,
          cloudMid: weather.cloudMid,
          cloudLow: weather.cloudLow,
          humidity925: weather.lowLevelHumidity,
          visibilityKm: weather.visibility,
          remoteLowCloud: linan.cloudLow,
          windowTransparency: 100 - linan.cloudLow,
        },
      };
    },
  });
}

async function getXihuData(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const waqiToken = options.waqiToken || (typeof process !== 'undefined' ? process.env.WAQI_TOKEN : undefined);
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  let qweatherConfigured = false;
  try {
    qweatherConfigured = Boolean(qweatherConfig(options));
  } catch {
    qweatherConfigured = true;
  }
  const results = await Promise.allSettled([
    fetchJson(XIHU_API.target, fetchImpl),
    fetchJson(XIHU_API.linan, fetchImpl),
    fetchJson(XIHU_API.fuyang, fetchImpl),
    waqiToken ? fetchJson(XIHU_API.airQuality(waqiToken), fetchImpl) : Promise.resolve(null),
    fetchQWeatherHourly({ lat: XIHU_CONFIG.lat, lon: XIHU_CONFIG.lon }, { ...options, fetchImpl }),
  ]);
  const [targetResult, linanResult, fuyangResult, airResult, qweatherResult] = results;
  if (targetResult.status === 'rejected') throw new Error(`西湖主数据获取失败: ${targetResult.reason.message}`);

  const targetPayload = targetResult.value;
  const linanPayload = linanResult.status === 'fulfilled' ? linanResult.value : null;
  const fuyangPayload = fuyangResult.status === 'fulfilled' ? fuyangResult.value : null;
  const airQuality = parseAirQuality(airResult.status === 'fulfilled' ? airResult.value : null);
  const qweatherPayload = qweatherResult.status === 'fulfilled' ? qweatherResult.value : null;
  const dates = getForecastDates(targetPayload);
  const snapshots = dates.map(date => {
    const dailyIndex = targetPayload?.daily?.time?.indexOf(date) ?? -1;
    const sunset = dailyIndex >= 0 ? targetPayload.daily.sunset?.[dailyIndex] : null;
    const hour = sunset ? Number(sunset.slice(11, 13)) : getTargetHour(date);
    const minutelyWeather = parseTargetAtSunsetOffset(targetPayload, date, -15);
    const hourlyWeather = parseTarget(targetPayload, date, hour);
    const effectiveTime = sunset ? subtractMinutes(sunset, 15) : `${date}T${String(hour).padStart(2, '0')}:00`;
    const openMeteoWeather = minutelyWeather
      ? {
        ...hourlyWeather,
        ...Object.fromEntries(Object.entries(minutelyWeather).filter(([, value]) => value !== null)),
      }
      : hourlyWeather;
    return {
      date,
      weather: mergeQWeather(openMeteoWeather, qweatherPayload, effectiveTime),
      dataResolution: minutelyWeather ? '15-minute-interpolated' : 'hourly-fallback',
      windows: {
        '临安': linanPayload ? parseWindow(linanPayload, date, hour) : null,
        '富阳': fuyangPayload ? parseWindow(fuyangPayload, date, hour) : null,
      },
      sunTimes: getSunTimes(targetPayload, date),
      sunsetWindow: sunset
        ? buildXihuSunsetWindow(date, sunset.slice(11, 16), targetPayload, linanPayload, fuyangPayload, airQuality, qweatherPayload)
        : { available: false, message: '趋势数据不足', timeline: [] },
    };
  }).filter(snapshot => snapshot.weather);

  return {
    snapshots,
    airQuality,
    sourceStatus: {
      openMeteo: 'connected',
      temporalResolution: snapshots[0]?.dataResolution || 'hourly-fallback',
      linanWindow: linanResult.status === 'fulfilled' ? 'connected' : 'unavailable',
      fuyangWindow: fuyangResult.status === 'fulfilled' ? 'connected' : 'unavailable',
      waqi: !waqiToken ? 'not-configured' : airQuality.available ? 'connected' : 'unavailable',
      qweather: !qweatherConfigured ? 'not-configured' : qweatherPayload ? 'connected' : 'unavailable',
      precipitation: snapshots.some(snapshot => Number.isFinite(snapshot.weather.precipitationRate))
        ? 'connected'
        : 'unavailable',
    },
    fetchedAt: new Date().toISOString(),
  };
}

async function getXihuPrediction(options = {}) {
  const data = await getXihuData(options);
  if (!data.snapshots.length) throw new Error('西湖预报中没有可用小时数据');

  const predictions = data.snapshots.map(snapshot => ({
    date: snapshot.date,
    sunTimes: snapshot.sunTimes,
    dataResolution: snapshot.dataResolution,
    sunsetWindow: snapshot.sunsetWindow,
    metrics: {
      cloudLow: snapshot.weather.cloudLow,
      cloudMid: snapshot.weather.cloudMid,
      cloudHigh: snapshot.weather.cloudHigh,
      visibilityKm: snapshot.weather.visibility,
      windowTransparency: Number.isFinite(snapshot.windows['临安']?.cloudLow)
        ? Math.max(0, 100 - snapshot.windows['临安'].cloudLow)
        : null,
      humidity250: snapshot.weather.humidity250,
      precipitationMm: snapshot.weather.precipitation,
      precipitationRateMmH: snapshot.weather.precipitationRate,
      precipitationProbability: snapshot.weather.precipitationProbability,
      weatherCode: snapshot.weather.weatherCode,
    },
    ...predictXihu(snapshot.weather, snapshot.windows, data.airQuality),
  }));
  const [today] = predictions;

  return {
    spot: XIHU_CONFIG.spot,
    spotName: XIHU_CONFIG.name,
    ...today,
    days: predictions,
    forecast: predictions.map(({ date, rawQuality, quality, probability, probabilityLabel, label, color, verdict, weather }) => ({
      date, rawQuality, quality, probability, probabilityLabel, label, color, verdict, weather,
    })),
    sourceStatus: data.sourceStatus,
    fetchedAt: data.fetchedAt,
  };
}

module.exports = {
  XIHU_API,
  getXihuData,
  getXihuPrediction,
  getSunTimes,
  buildXihuSunsetWindow,
  parseTargetAtSunsetOffset,
};
