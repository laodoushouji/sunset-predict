/**
 * Sunset Predict - Core Prediction Engine
 * 通用5因子模型 + 景区专属修正插件
 */

// ============================================
// 1. 通用预测模型 (5-Factor Base Model)
// ============================================

const SCORE_PLUGIN_CONFIG = {
  generic: { visibilityFullKm: 24 },
  xihu: { visibilityFullKm: 24 },
  waitan: { visibilityFullKm: 24 },
  beijing: { visibilityFullKm: 24 },
  jingshan: { visibilityFullKm: 24 },
  erhai: { visibilityFullKm: 24 },
  huangshan: { visibilityFullKm: 24 },
  chongqing: { visibilityFullKm: 15 },
  xiamen: { visibilityFullKm: 24 },
  qingdao: { visibilityFullKm: 24 },
  chengdu: { visibilityFullKm: 12 },
  shenzhen: { visibilityFullKm: 24 },
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeVisibility(visibility, fullScoreKm = 24) {
  if (!Number.isFinite(visibility) || visibility <= 5) return 0;
  if (visibility >= fullScoreKm) return 1;
  return (visibility - 5) / (fullScoreKm - 5);
}

function isSoutheastWind(direction) {
  return Number.isFinite(direction) && direction >= 112.5 && direction <= 157.5;
}

function getWeatherMeta(weather = {}) {
  const precipitationRate = [weather.precipitationRate, weather.rainRate, weather.precipitation, weather.rain]
    .find(Number.isFinite);
  const precipitationProbability = Number.isFinite(weather.precipitationProbability)
    ? Math.round(clamp(weather.precipitationProbability))
    : null;
  const weatherCode = Number.isFinite(Number(weather.weatherCode)) ? Number(weather.weatherCode) : null;
  const rainCodes = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
  const mediumRainCodes = new Set([63, 81]);
  const heavyRainCodes = new Set([65, 67, 82]);
  const snowCodes = new Set([71, 73, 75, 77, 85, 86]);
  const mediumSnowCodes = new Set([73]);
  const heavySnowCodes = new Set([75, 77, 86]);
  const thunderCodes = new Set([95, 96, 99]);
  const rate = Number.isFinite(precipitationRate) ? Math.max(0, precipitationRate) : null;

  let label = '天气待更新';
  let kind = 'unknown';
  if (thunderCodes.has(weatherCode)) {
    label = '雷雨';
    kind = 'thunder';
  } else if ((rate !== null && rate >= 7.6) || heavyRainCodes.has(weatherCode)) {
    label = '大雨';
    kind = 'rain-heavy';
  } else if ((rate !== null && rate >= 2.5) || mediumRainCodes.has(weatherCode)) {
    label = '中雨';
    kind = 'rain-medium';
  } else if ((rate !== null && rate >= 0.1) || rainCodes.has(weatherCode)) {
    label = '小雨';
    kind = 'rain-light';
  } else if (heavySnowCodes.has(weatherCode)) {
    label = '大雪';
    kind = 'snow-heavy';
  } else if (mediumSnowCodes.has(weatherCode)) {
    label = '中雪';
    kind = 'snow-medium';
  } else if (snowCodes.has(weatherCode)) {
    label = '小雪';
    kind = 'snow-light';
  } else if ([45, 48].includes(weatherCode)) {
    label = '雾';
    kind = 'fog';
  } else if (weatherCode === 3) {
    label = '阴';
    kind = 'overcast';
  } else if ([1, 2].includes(weatherCode)) {
    label = '多云';
    kind = 'cloudy';
  } else if (weatherCode === 0) {
    label = '晴';
    kind = 'clear';
  }

  return {
    label,
    kind,
    weatherCode,
    precipitationRateMmH: rate,
    precipitationProbability,
    isPrecipitating: kind.startsWith('rain-') || kind.startsWith('snow-') || kind === 'thunder',
    blocksSunset: ['rain-medium', 'rain-heavy', 'snow-medium', 'snow-heavy', 'thunder'].includes(kind),
  };
}

function getScoreGrade(score) {
  if (score >= 85) return 'FIRE';
  if (score >= 60) return 'GREAT';
  if (score >= 30) return 'FAIR';
  if (score > 0) return 'CLEAR';
  return 'NONE';
}

function getProbabilityMeta(probability) {
  if (probability >= 80) return { level: 'high', label: '极易观测' };
  if (probability >= 60) return { level: 'medium', label: '较易观测' };
  if (probability >= 30) return { level: 'uncertain', label: '存在变数' };
  return { level: 'low', label: '光线可能受阻' };
}

function getVerdict(score, probability) {
  const highQuality = score >= 60;
  const highProbability = probability >= 60;
  if (highQuality && highProbability) {
    return '【爆燃预警】今晚具备高质量晚霞条件，且西方窗口通透，建议提前出发。';
  }
  if (highQuality) {
    return '【极致但危险】高空画布很好，但远方光路存在遮挡，这是一场值得评估的赌博。';
  }
  if (highProbability) {
    return '【清透落日】观测条件很好，但中高云画布偏弱，更适合拍简洁的“咸蛋黄”落日。';
  }
  return '【建议休息】画布或进光条件不足，今天不值得专程折腾。';
}

function canvasPoints(coverage) {
  const base = clamp(coverage) * 0.8;
  if (coverage <= 85) return base;
  const thicknessFactor = Math.max(0.4, 1 - 0.6 * ((coverage - 85) / 15));
  return base * thicknessFactor;
}

function calibrateQuality(rawQuality) {
  return Math.round(clamp(rawQuality));
}

function windowProbability(cloudLow) {
  if (!Number.isFinite(cloudLow)) return 50;
  if (cloudLow <= 20) return 100 - cloudLow * 0.5;
  if (cloudLow <= 80) return 90 - ((cloudLow - 20) / 60) * 80;
  return Math.max(0, 10 - (cloudLow - 80) * 0.5);
}

/**
 * 通用物理评分 + 站点插件。
 * @param {string} spotId
 * @param {Object} weather 本地画布气象
 * @param {Object|null} remoteWeather 日落方向远程窗口气象
 * @param {Object} context 空气质量、台风路径等可选数据
 */
function calculateSunsetScore(spotId, weather, remoteWeather = null, context = {}) {
  weather = {
    ...weather,
    cloudHigh: weather.cloudHigh ?? weather.high_cloud,
    cloudMid: weather.cloudMid ?? weather.mid_cloud,
    cloudLow: weather.cloudLow ?? weather.low_cloud,
  };
  remoteWeather = remoteWeather ? {
    ...remoteWeather,
    cloudLow: remoteWeather.cloudLow ?? remoteWeather.low_cloud,
  } : null;
  const normalizedSpotId = spotId === 'jingshan' ? 'beijing' : spotId;
  const config = SCORE_PLUGIN_CONFIG[normalizedSpotId] || SCORE_PLUGIN_CONFIG.generic;
  const corrections = [];
  const dataAvailability = {};
  let effectiveVisibility = weather.visibility;
  let colorOverride = null;
  let probabilityMultiplier = 1;
  let probabilityCap = 100;
  let score = 0;
  let sceneBonus = 0;
  let qualityAdjustment = 0;

  const addSceneBonus = (requested, item, desc) => {
    const awarded = Math.max(0, Math.min(requested, 10 - sceneBonus));
    if (awarded <= 0) return;
    sceneBonus += awarded;
    score += awarded;
    corrections.push({ item, value: `+${awarded}`, desc });
  };
  const adjustQuality = (points, item, desc) => {
    qualityAdjustment += points;
    score += points;
    corrections.push({ item, value: points > 0 ? `+${points}` : String(points), desc });
  };

  if (normalizedSpotId === 'qingdao' && isSoutheastWind(weather.windDirection)) {
    effectiveVisibility *= 0.85;
    corrections.push({ item: '东南风海滨霾', value: '能见度 -15%', desc: '海上来风增加近地层模糊系数' });
  }

  const canvasCoverage = clamp((weather.cloudHigh || 0) * 0.7 + (weather.cloudMid || 0) * 0.3);
  const canvas = canvasPoints(canvasCoverage);
  if (Number.isFinite(remoteWeather?.cloudLow)) {
    dataAvailability.remoteWindow = 'connected';
    if (remoteWeather.cloudLow > 20) corrections.push({
      item: '远程窗口阻断',
      value: `几率 ${Math.round(windowProbability(remoteWeather.cloudLow))}%`,
      desc: `日落方向低云${remoteWeather.cloudLow}%，光源受阻`,
    });
  } else {
    dataAvailability.remoteWindow = 'unavailable';
  }

  const visibilityNorm = normalizeVisibility(effectiveVisibility, config.visibilityFullKm);
  let filter = 20 * visibilityNorm;
  if (weather.humidity250 >= 70 && weather.humidity250 <= 85) {
    filter = Math.min(20, filter + 1);
    corrections.push({ item: '薄卷云滤镜', value: '+1', desc: `250hPa 湿度${weather.humidity250}%，利于细腻着色` });
  } else if (weather.humidity250 > 95) {
    filter = Math.max(0, filter - 5);
    corrections.push({ item: '高空厚云', value: '-5', desc: `250hPa 湿度${weather.humidity250}%，高云可能偏厚` });
  }
  score = canvas + filter;

  const lowLevelHumidity = weather.lowLevelHumidity ?? weather.humidity;
  let localObservation = 100 - clamp(weather.cloudLow || 0);
  if (lowLevelHumidity > 95) {
    localObservation = Math.min(localObservation, 10);
    corrections.push({ item: '本地低云雾', value: '几率 ≤10%', desc: `低层湿度${lowLevelHumidity}%，观测视线可能被遮挡` });
  } else if (lowLevelHumidity > 90) {
    localObservation = Math.min(localObservation, 30);
  } else if (lowLevelHumidity > 85) {
    localObservation = Math.min(localObservation, 60);
  }
  const remoteWindow = windowProbability(remoteWeather?.cloudLow);
  let probability = remoteWindow * 0.8 + localObservation * 0.2;

  if (normalizedSpotId === 'xihu') {
    addSceneBonus(2, '湖面镜像', '西湖水面提供固定反射加成');
  }

  if (normalizedSpotId === 'waitan') {
    if (remoteWeather?.cloudLow < 10) {
      probability = Math.max(probability, 92);
      corrections.push({ item: '150km 远程破窗', value: '几率 ≥92%', desc: '苏州/无锡/常州方向低云少，进光路径通透' });
    }
    if (context.airQuality?.aqi >= 30 && context.airQuality.aqi <= 80) {
      adjustQuality(2, '气溶胶散射', `AQI ${context.airQuality.aqi}，适量颗粒物增强粉紫散射`);
      colorOverride = { label: '赛博粉紫', hint: 'purple', desc: '适量颗粒物增强粉紫散射' };
    } else if (context.airQuality?.aqi > 120) {
      adjustQuality(-3, '空气污染消光', `AQI ${context.airQuality.aqi}，灰霾削弱色彩与对比度`);
    }
    if (weather.visibility > 30) {
      addSceneBonus(2, '陆家嘴金光', '能见度超过30km，建筑与浦江反射条件优秀');
    }
    if (remoteWeather?.humidity850 > 95) {
      adjustQuality(-3, '850hPa 高湿', `远程窗口湿度${remoteWeather.humidity850}%，灰霾消光风险高`);
    }
  }

  if (normalizedSpotId === 'beijing') {
    if (remoteWeather?.cloudLow > 40) {
      probabilityCap = 20;
      corrections.push({ item: '门头沟山云', value: '几率 ≤20%', desc: '正西山云超过40%，紫禁城进光受阻' });
    }
    if (weather.humidity < 30) {
      addSceneBonus(3, '北方干燥', `湿度${weather.humidity}%，色彩倾向金橙`);
      colorOverride = { label: '通透金橙', hint: 'gold', desc: '北方干燥空气增强金橙色直射光' };
    }
  }

  if (normalizedSpotId === 'erhai') {
    if (remoteWeather?.cloudLow > 60) {
      probabilityCap = 10;
      corrections.push({ item: '苍山近程阻断', value: '几率 ≤10%', desc: '15km 苍山窗口低云超过60%' });
    }
    addSceneBonus(4, '高海拔补偿', '洱海高海拔增强色彩饱和度');
    colorOverride = { label: '干热深红', hint: 'deep-red', desc: '高海拔紫外线与低水汽增强深红饱和度' };
  }

  if (normalizedSpotId === 'huangshan') {
    const hasCloudBaseHeight = Number.isFinite(weather.cloudBaseHeight);
    const hasPressureLevelProxy = Number.isFinite(weather.lowLevelHumidity) &&
      Number.isFinite(weather.humidity700) && Number.isFinite(weather.cloudLow);
    dataAvailability.cloudBaseHeight = hasCloudBaseHeight
      ? 'connected'
      : hasPressureLevelProxy ? 'pressure-level-proxy' : 'unavailable';

    if (hasCloudBaseHeight) {
      if (weather.cloudBaseHeight >= 1000 && weather.cloudBaseHeight <= 1500) {
        addSceneBonus(8, '云海日落', `云底高度${weather.cloudBaseHeight}m，处于理想云海区间`);
      } else if (weather.cloudBaseHeight > 1600) {
        probabilityCap = 0;
        corrections.push({ item: '身在雾中', value: '几率 0%', desc: `云底高度${weather.cloudBaseHeight}m，高于1600m` });
      }
    } else if (hasPressureLevelProxy) {
      if (weather.lowLevelHumidity > 95 && weather.humidity700 < 30) {
        addSceneBonus(
          8,
          '压力层云海',
          `925hPa 湿度${weather.lowLevelHumidity}%，700hPa 湿度${weather.humidity700}%，低空饱和且高空干燥`
        );
      } else if (weather.lowLevelHumidity > 95 && weather.cloudLow >= 50) {
        probabilityCap = 0;
        corrections.push({
          item: '低云雾中',
          value: '几率 0%',
          desc: `925hPa 湿度${weather.lowLevelHumidity}%且低云${weather.cloudLow}%，判定身在低云或雾中`,
        });
      }
    }
    if (weather.windSpeed700 > 12) {
      adjustQuality(-4, '高空风速过强', `700hPa 风速${weather.windSpeed700}m/s，晚霞稳定性下降`);
    }
  }

  if (normalizedSpotId === 'chongqing') {
    if (weather.humidity > 90) {
      probabilityMultiplier *= 0.7;
      corrections.push({ item: '雾都高湿消光', value: '几率 ×0.7', desc: `湿度${weather.humidity}%，雾气吸收颜色` });
    }
    addSceneBonus(2, '两江反射', '两江交汇水面提供固定倒影加成');
  }

  if (normalizedSpotId === 'xiamen') {
    dataAvailability.lowLevelHumidity = Number.isFinite(weather.lowLevelHumidity) ? 'connected' : 'unavailable';
    dataAvailability.pressureTrend24h = Number.isFinite(weather.pressureTrend24h) ? 'connected' : 'unavailable';
    dataAvailability.typhoonTrack = typeof context.typhoonNearby === 'boolean' ? 'connected' : 'unavailable';
    if (weather.lowLevelHumidity >= 95) {
      colorOverride = { label: '灰蒙蒙', hint: 'haze', desc: '925hPa 低层湿度饱和，存在海雾消光' };
      probabilityMultiplier *= 0.5;
      corrections.push({ item: '海雾', value: '灰蒙蒙', desc: `低层湿度${weather.lowLevelHumidity}%，色彩被海雾削弱` });
    }
    if (context.typhoonNearby === true && weather.pressureTrend24h > 0) {
      addSceneBonus(8, '台风外围下沉气流', '台风路径接近且24小时气压回升');
      probability += 10;
    }
  }

  if (normalizedSpotId === 'qingdao' && weather.cloudHigh > 60) {
    corrections.push({ item: '海面余晖延迟', value: '慢衰减', desc: '日落后10分钟高云仍可维持反光' });
  }

  if (normalizedSpotId === 'chengdu') {
    if (remoteWeather?.cloudLow < 10) {
      probability = Math.max(probability, 95);
      corrections.push({ item: '150km 盆地破窗', value: '几率 ≥95%', desc: '雅安/贡嘎方向低云少，远端光线可穿入盆地' });
    }
    if (weather.humidity > 75 && weather.visibility > 10) {
      colorOverride = { label: '浪漫粉紫', hint: 'purple', desc: '高湿但通透，气溶胶散射增强粉紫色' };
      corrections.push({ item: '盆地粉紫散射', value: '粉紫色', desc: `湿度${weather.humidity}%且能见度${weather.visibility}km` });
    }
  }

  if (normalizedSpotId === 'shenzhen') {
    dataAvailability.pressureTrend24h = Number.isFinite(weather.pressureTrend24h) ? 'connected' : 'unavailable';
    dataAvailability.typhoonTrack = typeof context.typhoonNearby === 'boolean' ? 'connected' : 'unavailable';
    if (remoteWeather?.cloudLow <= 20) {
      addSceneBonus(3, '建筑金光', '日落方向通透，深圳湾摩天楼具备反光条件');
      probability = Math.max(probability, 90);
    }
    if (context.typhoonNearby === true && weather.pressureTrend24h > 0 && weather.visibility >= config.visibilityFullKm) {
      addSceneBonus(8, '台风外围下沉气流', '台风路径接近、气压回升且极度通透');
      probability += 10;
    }
    if (isSoutheastWind(weather.windDirection) && weather.humidity > 90) {
      probabilityMultiplier *= 0.6;
      colorOverride = { label: '灰蒙蒙', hint: 'haze', desc: '东南海风叠加高湿，海雾消光明显' };
      corrections.push({ item: '深圳湾海雾', value: '几率 ×0.6', desc: `东南风且湿度${weather.humidity}%` });
    }
  }

  const weatherMeta = getWeatherMeta(weather);
  const precipitationProbability = Number.isFinite(weatherMeta.precipitationProbability)
    ? `，降水概率${weatherMeta.precipitationProbability}%`
    : '';
  if (weatherMeta.kind === 'overcast' && score > 59) {
    score = 59;
    corrections.push({
      item: '阴天厚云上限',
      value: '≤59',
      desc: '天气代码判定为阴，厚云幕下不进入高质量晚霞等级',
    });
  }
  if (weatherMeta.blocksSunset) {
    score = 0;
    probabilityCap = 0;
    corrections.push({
      item: weatherMeta.kind.startsWith('snow-') ? '降雪阻断' : '降雨阻断',
      value: '评分与几率 0',
      desc: `日落窗口${weatherMeta.label}${Number.isFinite(weatherMeta.precipitationRateMmH) ? ` ${weatherMeta.precipitationRateMmH.toFixed(1)}mm/h` : ''}${precipitationProbability}`,
    });
  } else if (weatherMeta.isPrecipitating) {
    probabilityCap = Math.min(probabilityCap, 10);
    corrections.push({
      item: weatherMeta.kind.startsWith('snow-') ? '小雪遮挡' : '小雨遮挡',
      value: '几率 ≤10%',
      desc: `日落窗口${weatherMeta.label}${precipitationProbability}`,
    });
  }

  if (Number.isFinite(weather.cloudHigh) && weather.cloudHigh < 10) {
    score = Math.min(score, 30);
    corrections.push({ item: '晴空无云上限', value: '≤30', desc: `高云仅${weather.cloudHigh}%，缺少晚霞画布` });
  }

  if (Number.isFinite(remoteWeather?.cloudLow) && remoteWeather.cloudLow > 80) probabilityCap = Math.min(probabilityCap, 9);
  probability = Math.round(clamp(Math.min(probability * probabilityMultiplier, probabilityCap)));
  const rawQuality = Math.round(clamp(score));
  const quality = calibrateQuality(rawQuality);
  const probabilityMeta = getProbabilityMeta(probability);
  const thicknessFactor = canvasCoverage <= 85
    ? 1
    : Math.max(0.4, 1 - 0.6 * ((canvasCoverage - 85) / 15));
  return {
    score: quality,
    rawQuality,
    quality,
    probability,
    probabilityLevel: probabilityMeta.level,
    probabilityLabel: probabilityMeta.label,
    verdict: getVerdict(quality, probability),
    grade: getScoreGrade(quality),
    baseScore: Math.round(canvas + filter),
    components: {
      canvasCoverage: Math.round(canvasCoverage),
      canvasPoints: Math.round(canvas),
      thicknessFactor: Math.round(thicknessFactor * 100) / 100,
      filterPoints: Math.round(filter),
      sceneBonus,
      qualityAdjustment,
      rawQuality,
      quality,
      canvas: Math.round(canvas),
      filter: Math.round(filter),
      visibility: Math.round(visibilityNorm * 100),
      windowLight: Math.round(remoteWindow),
      localObservation: Math.round(localObservation),
    },
    weather: weatherMeta,
    inputs: {
      cloudHigh: weather.cloudHigh,
      cloudMid: weather.cloudMid,
      cloudLow: weather.cloudLow,
      visibilityKm: weather.visibility,
      effectiveVisibilityKm: Math.round(effectiveVisibility * 10) / 10,
      humidity: weather.humidity,
      humidity925: weather.lowLevelHumidity,
      humidity700: weather.humidity700,
      humidity250: weather.humidity250,
      windSpeed700: weather.windSpeed700,
      windDirection: weather.windDirection,
      pressureTrend24h: weather.pressureTrend24h,
      precipitationRateMmH: weatherMeta.precipitationRateMmH,
      precipitationProbability: weatherMeta.precipitationProbability,
      weatherCode: weatherMeta.weatherCode,
      remoteWindow: remoteWeather ? {
        cloudLow: remoteWeather.cloudLow,
        visibilityKm: remoteWeather.visibility,
        humidity850: remoteWeather.humidity850,
      } : null,
    },
    colorOverride,
    corrections,
    dataAvailability,
    modelVersion: 'quality-v3',
    timeOffsetMinutes: normalizedSpotId === 'xihu' ? -15 : 0,
    afterglowDecay: normalizedSpotId === 'qingdao' && weather.cloudHigh > 60 ? 'slow' : 'normal',
  };
}

/**
 * 通用5因子预测
 * @param {Object} data - 气象数据
 * @param {number} data.cloudHigh - 高云量 (0-100)
 * @param {number} data.cloudMid - 中云量 (0-100)
 * @param {number} data.cloudLow - 低云量 (0-100)
 * @param {number} data.visibility - 能见度 (km)
 * @param {number} data.humidity - 相对湿度 (%)
 * @returns {number} 质量分数 0-100
 */
function basePrediction(data) {
  return calculateSunsetScore('generic', data).score;
}

// ============================================
// 3. 色彩倾向预测
// ============================================

/**
 * 基于能见度、AQI、湿度预测晚霞色彩倾向
 * @param {number} visibility - 能见度 km
 * @param {number} humidity - 湿度 %
 * @param {number} aqi - 空气质量指数 (可选)
 * @returns {{ label: string, hint: string }}
 */
function predictColor(visibility, humidity, aqi = null) {
  if (aqi && aqi > 150) {
    return { label: '灰蒙蒙', hint: 'haze', desc: '空气污染重，光线被散射吸收' };
  }
  if (visibility > 20 && (!aqi || aqi < 50)) {
    return { label: '通透金橙', hint: 'gold', desc: '空气极净，散射少，金色直射为主' };
  }
  if (visibility > 15 && humidity > 70) {
    return { label: '浪漫粉紫', hint: 'purple', desc: '高空湿度高，瑞利散射增强紫粉色' };
  }
  if (visibility > 10 && humidity < 40) {
    return { label: '干热深红', hint: 'deep-red', desc: '低湿度大气，米氏散射弱，短持续时间' };
  }
  if (humidity > 85) {
    return { label: '银灰雾霭', hint: 'silver', desc: '湿度饱和，雾化消光严重' };
  }
  return { label: '标准暖色', hint: 'warm', desc: '典型暖色调晚霞' };
}

// ============================================
// 4. 景区专属算法: 西湖 (Xihu)
// ============================================

const XIHU_CONFIG = {
  name: '西湖',
  nameEn: 'West Lake',
  spot: 'xihu',
  lat: 30.25,
  lon: 120.15,
  qweatherLocation: '101210101', // 杭州
  // 西方窗口参考点
  windows: [
    { name: '临安', lat: 30.24, lon: 119.75, weight: 1 },  // 正西约38km
    { name: '富阳', lat: 30.05, lon: 119.95, weight: 0.4 },  // 辅窗口，西南50km
  ],
  // 最佳拍摄点
  spots: [
    { name: '雷峰夕照', threshold: 70, desc: '西向开阔，日落正对，最佳构图' },
    { name: '断桥残雪', threshold: 50, desc: '北向视角，拍天空反射到湖面' },
    { name: '苏堤春晓', threshold: 30, desc: '长堤视角，云层分层清晰可见' },
  ],
};

/**
 * 西湖专属预测
 * @param {Object} xihuWeather - 西湖气象数据
 * @param {Object} windowWeathers - 西方窗口气象数据 { linan: {}, fuyang: {} }
 * @param {Object} airQuality - 可选空气质量 { aqi, pm25, available }
 * @returns {Object} 完整预测结果
 */
function predictXihu(xihuWeather, windowWeathers, airQuality = {}) {
  const model = calculateSunsetScore('xihu', xihuWeather, windowWeathers?.['临安'], { airQuality });
  const color = model.colorOverride || predictColor(xihuWeather.visibility, xihuWeather.humidity, airQuality.aqi);
  const bestSpot = XIHU_CONFIG.spots
    .filter(s => model.score >= s.threshold)
    [0] || { name: '碰碰运气', desc: '今天条件一般，可以散散步' };
  const alpenglow = xihuWeather.cloudHigh > 70
    ? { available: true, desc: '高云量大，太阳下山后仍有10-15分钟反青光，适合长曝光' }
    : { available: false, desc: '' };

  return {
    rawQuality: model.rawQuality,
    quality: model.quality,
    probability: model.probability,
    probabilityLevel: model.probabilityLevel,
    probabilityLabel: model.probabilityLabel,
    verdict: model.verdict,
    grade: model.grade,
    baseScore: model.baseScore,
    label: getQualityLabel(model.score),
    color,
    weather: model.weather,
    confidence: windowWeathers?.['临安'] ? 'medium' : 'low',
    alpenglow,
    bestSpot,
    corrections: model.corrections,
    components: model.components,
    modelInputs: model.inputs,
    dataAvailability: model.dataAvailability,
    timeOffsetMinutes: model.timeOffsetMinutes,
    airQuality: {
      available: airQuality.available !== false,
      aqi: Number.isFinite(Number(airQuality.aqi)) ? Number(airQuality.aqi) : null,
      pm25: Number.isFinite(Number(airQuality.pm25)) ? Number(airQuality.pm25) : null,
    },
    modelVersion: model.modelVersion,
    source: 'xihu-model-v3',
  };
}

// ============================================
// 5. 景区专属算法: 上海外滩 (Waitan V2.5)
// ============================================

const WAITAN_CONFIG = {
  name: '上海外滩',
  nameEn: 'The Bund',
  spot: 'waitan',
  location: '上海 · 黄浦/浦东',
  lat: 31.24,
  lon: 121.49,
  windows: [
    { name: '青浦窗口', lat: 31.15, lon: 121.12, weight: 0.35 },
    { name: '苏州窗口', lat: 31.24, lon: 119.92, weight: 0.65 },
  ],
  spots: [
    {
      name: '浦东滨江大道',
      azimuth_range: '280-310',
      reason: '看落日余晖洒满万国建筑博览群',
    },
    {
      name: '北外滩魔都矩阵',
      azimuth_range: 'all',
      reason: '三件套与老外滩同框的城市机位',
    },
  ],
};

function getWindowStatus(weather) {
  if (!weather || !Number.isFinite(weather.cloudLow)) return 'UNKNOWN';
  if (weather.cloudLow > 60) return 'BLOCKED';
  if (weather.cloudLow < 20 && (!Number.isFinite(weather.visibility) || weather.visibility > 10)) return 'CLEAR';
  return 'MIXED';
}

/**
 * 上海外滩专属预测。
 * @param {Object} waitanWeather 外滩头顶画布数据
 * @param {Object} windowWeathers { 青浦窗口, 苏州窗口 }
 * @param {Object} airQuality { aqi, pm25 }
 */
function predictWaitan(waitanWeather, windowWeathers = {}, airQuality = {}) {
  const farWeather = windowWeathers['苏州窗口'] || null;
  const model = calculateSunsetScore('waitan', waitanWeather, farWeather, { airQuality });
  const windows = WAITAN_CONFIG.windows.map(win => {
    const weather = windowWeathers[win.name];
    const status = getWindowStatus(weather);
    return { name: win.name, lat: win.lat, lon: win.lon, status };
  });
  const reflectionAvailable = waitanWeather.visibility > 30 && getWindowStatus(farWeather) === 'CLEAR';
  const color = model.colorOverride || predictColor(waitanWeather.visibility, waitanWeather.humidity, airQuality.aqi);

  const month = new Date().getMonth() + 1;
  const lightsOn = month >= 4 && month <= 10 ? '19:00' : '18:00';
  const shootingTime = lightsOn === '19:00' ? '19:05' : '18:05';

  return {
    spot: WAITAN_CONFIG.spot,
    spotName: WAITAN_CONFIG.name,
    location: WAITAN_CONFIG.location,
    rawQuality: model.rawQuality,
    quality: model.quality,
    probability: model.probability,
    probabilityLevel: model.probabilityLevel,
    probabilityLabel: model.probabilityLabel,
    verdict: model.verdict,
    grade: model.grade,
    baseScore: model.baseScore,
    label: getQualityLabel(model.score),
    color,
    weather: model.weather,
    confidence: airQuality.available === false ? 'medium' : 'high',
    metrics: {
      cloudLow: waitanWeather.cloudLow,
      cloudMid: waitanWeather.cloudMid,
      cloudHigh: waitanWeather.cloudHigh,
      visibilityKm: waitanWeather.visibility,
      windowTransparency: Number.isFinite(farWeather?.cloudLow)
        ? Math.max(0, 100 - farWeather.cloudLow)
        : null,
      humidity250: waitanWeather.humidity250,
      precipitationMm: waitanWeather.precipitation,
      precipitationRateMmH: waitanWeather.precipitationRate,
      precipitationProbability: waitanWeather.precipitationProbability,
      weatherCode: waitanWeather.weatherCode,
    },
    windows: [
      ...windows,
      { name: '本地画布', lat: WAITAN_CONFIG.lat, lon: WAITAN_CONFIG.lon, status: getWindowStatus(waitanWeather) },
    ],
    best_spots: WAITAN_CONFIG.spots,
    bestSpot: {
      name: WAITAN_CONFIG.spots[0].name,
      desc: WAITAN_CONFIG.spots[0].reason,
    },
    alpenglow: {
      available: reflectionAvailable,
      desc: reflectionAvailable ? '西方能见度超过30km，三件套玻璃幕墙可能出现二次反射' : '',
    },
    lightsOn,
    photographyAdvice: `今日建议等到 ${shootingTime}，利用晚霞余晖拍摄蓝调时刻与外滩亮灯瞬间。`,
    corrections: model.corrections,
    components: model.components,
    modelInputs: model.inputs,
    dataAvailability: model.dataAvailability,
    airQuality: {
      available: airQuality.available !== false,
      aqi: Number.isFinite(Number(airQuality.aqi)) ? Number(airQuality.aqi) : null,
      pm25: Number.isFinite(Number(airQuality.pm25)) ? Number(airQuality.pm25) : null,
    },
    modelVersion: model.modelVersion,
    source: 'waitan-model-v4',
  };
}

/**
 * 质量等级标签
 */
function getQualityLabel(score) {
  const grade = getScoreGrade(score);
  const labels = {
    FIRE: { zh: '绝美', en: 'Fire' },
    GREAT: { zh: '很棒', en: 'Great' },
    FAIR: { zh: '不错', en: 'Fair' },
    CLEAR: { zh: '平淡', en: 'Clear' },
    NONE: { zh: '无望', en: 'None' },
  };
  return labels[grade];
}

// ============================================
// 6. 多源交叉验证 (QWeather vs Open-Meteo)
// ============================================

/**
 * 融合多源预测结果
 * @param {Object} qweatherResult - QWeather 数据的预测结果
 * @param {Object|null} openMeteoGFS - Open-Meteo GFS 模型的预测结果
 * @param {Object|null} openMeteoECMWF - Open-Meteo ECMWF 模型的预测结果
 * @returns {{ quality: number, confidence: string, sources: Array }}
 */
function ensemblePrediction(qweatherResult, openMeteoGFS, openMeteoECMWF) {
  const scores = [qweatherResult];
  const sources = [{ name: 'QWeather', score: qweatherResult, weight: 0.50 }];

  if (openMeteoGFS !== null) {
    scores.push(openMeteoGFS);
    sources.push({ name: 'Open-Meteo GFS', score: openMeteoGFS, weight: 0.25 });
  }
  if (openMeteoECMWF !== null) {
    scores.push(openMeteoECMWF);
    sources.push({ name: 'Open-Meteo ECMWF', score: openMeteoECMWF, weight: 0.25 });
  }

  // 加权平均
  let weightedSum = 0;
  let totalWeight = 0;
  sources.forEach(s => {
    weightedSum += s.score * s.weight;
    totalWeight += s.weight;
  });
  const ensembleScore = Math.round(weightedSum / totalWeight);

  // 计算一致性 → 置信度
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);

  let confidence;
  if (stdDev < 5) confidence = 'high';
  else if (stdDev < 15) confidence = 'medium';
  else confidence = 'low';

  return {
    quality: ensembleScore,
    confidence,
    sources,
    label: getQualityLabel(ensembleScore),
  };
}

// ============================================
// 7. 日出/日落时间计算 (简化天文算法)
// ============================================

/**
 * 计算指定经纬度的日出日落时间（简化版）
 * 基于 NOAA Solar Calculator 简化算法
 * @param {number} lat - 纬度
 * @param {number} lon - 经度
 * @param {Date} date - 日期
 * @param {number} timezone - 时区偏移 (小时，中国=8)
 * @returns {{ sunrise: string, sunset: string, solarNoon: string, dayLength: number }}
 */
function calcSunTimes(lat, lon, date, timezone = 8) {
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);

  // 太阳赤纬角 (度)
  const declination = 23.45 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81));

  // 时角 (弧度)
  const latRad = lat * Math.PI / 180;
  const declRad = declination * Math.PI / 180;
  const cosHourAngle = (-Math.sin(latRad) * Math.sin(declRad)) /
    (Math.cos(latRad) * Math.cos(declRad));

  // 极昼/极夜检查
  if (cosHourAngle > 1) return { sunrise: '极夜', sunset: '极夜', solarNoon: '', dayLength: 0 };
  if (cosHourAngle < -1) return { sunrise: '极昼', sunset: '极昼', solarNoon: '', dayLength: 24 * 60 };

  const hourAngle = Math.acos(cosHourAngle) * 180 / Math.PI;

  // 日出日落时间 (UTC 分钟)
  const solarNoonUTC = 720 - 4 * lon - timezone * 60 + Math.floor(dayOfYear * 1.0033); // 简化均时差
  const sunriseUTC = solarNoonUTC - hourAngle * 4;
  const sunsetUTC = solarNoonUTC + hourAngle * 4;

  const formatTime = (minutes) => {
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const sunrise = formatTime(sunriseUTC);
  const sunset = formatTime(sunsetUTC);

  return {
    sunrise,
    sunset,
    solarNoon: formatTime(solarNoonUTC),
    dayLength: Math.round(sunsetUTC - sunriseUTC),
  };
}

// ============================================
// Exports (Node.js / Worker 环境)
// ============================================
if (typeof module !== 'undefined') {
  module.exports = {
    calculateSunsetScore,
    basePrediction,
    predictXihu,
    XIHU_CONFIG,
    predictWaitan,
    WAITAN_CONFIG,
    predictColor,
    getQualityLabel,
    ensemblePrediction,
    calcSunTimes,
    getScoreGrade,
    getWeatherMeta,
    normalizeVisibility,
    calibrateQuality,
  };
}
