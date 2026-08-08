function qweatherConfig(options = {}) {
  const environment = typeof process !== 'undefined' ? process.env : {};
  const host = options.qweatherHost || environment.QWEATHER_API_HOST;
  const apiKey = options.qweatherApiKey || environment.QWEATHER_API_KEY || environment.QWEATHER_KEY || environment.HEWEATHER_KEY;
  if (!host || !apiKey) return null;

  const normalizedHost = String(host).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!/^[a-z0-9.-]+\.qweatherapi\.com$/i.test(normalizedHost)) {
    throw new Error('QWEATHER_API_HOST 无效');
  }
  return { host: normalizedHost, apiKey };
}

async function fetchQWeatherHourly(point, options = {}) {
  const config = qweatherConfig(options);
  if (!config) return null;

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const url = new URL(`https://${config.host}/v7/weather/72h`);
  url.searchParams.set('location', `${Number(point.lon).toFixed(2)},${Number(point.lat).toFixed(2)}`);
  url.searchParams.set('lang', 'zh');
  url.searchParams.set('unit', 'm');

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.qweatherTimeoutMs || 8000);
    try {
      const response = await fetchImpl(url, {
        headers: { 'X-QW-Api-Key': config.apiKey },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`QWeather HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.code !== '200' || !Array.isArray(payload.hourly)) {
        throw new Error(`QWeather API ${payload?.code || 'invalid-response'}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function sampleQWeather(payload, localTime) {
  const target = Date.parse(`${localTime}:00+08:00`);
  if (!Number.isFinite(target)) return null;

  let nearest = null;
  let nearestDifference = Infinity;
  for (const item of payload?.hourly || []) {
    const timestamp = Date.parse(item.fxTime);
    const difference = Math.abs(timestamp - target);
    if (difference < nearestDifference) {
      nearest = item;
      nearestDifference = difference;
    }
  }
  if (!nearest || nearestDifference > 90 * 60 * 1000) return null;

  const numberOrNull = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return {
    text: nearest.text || null,
    icon: nearest.icon || null,
    precipitationRate: numberOrNull(nearest.precip),
    precipitationProbability: numberOrNull(nearest.pop),
    forecastTime: nearest.fxTime || null,
  };
}

function mergeQWeather(weather, payload, localTime) {
  if (!weather || !payload) return weather;
  const qweather = sampleQWeather(payload, localTime);
  if (!qweather) return weather;

  return {
    ...weather,
    precipitation: qweather.precipitationRate ?? weather.precipitation,
    precipitationRate: qweather.precipitationRate ?? weather.precipitationRate,
    precipitationProbability: qweather.precipitationProbability ?? weather.precipitationProbability,
    weatherText: qweather.text,
    weatherIcon: qweather.icon,
    weatherProvider: 'qweather',
    weatherForecastTime: qweather.forecastTime,
  };
}

module.exports = {
  fetchQWeatherHourly,
  mergeQWeather,
  qweatherConfig,
  sampleQWeather,
};
