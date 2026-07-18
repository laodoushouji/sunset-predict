const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateSunsetScore,
  getScoreGrade,
  getWeatherMeta,
} = require('../src/services/prediction');
const { parseTargetAtSunsetOffset } = require('../src/services/xihu');

const baseWeather = {
  cloudHigh: 70,
  cloudMid: 50,
  cloudLow: 5,
  visibility: 24,
  humidity: 60,
  windDirection: 270,
  lowLevelHumidity: 70,
  humidity250: 78,
  humidity700: 50,
  windSpeed700: 5,
  pressureTrend24h: 2,
};

test('通用模型将品质与观测成功率分开，并保留晴空上限', () => {
  const clear = calculateSunsetScore('generic', baseWeather, { cloudLow: 5 });
  const localBlocked = calculateSunsetScore('generic', { ...baseWeather, cloudLow: 50 }, { cloudLow: 5 });
  const remoteBlocked = calculateSunsetScore('generic', baseWeather, { cloudLow: 85 });
  const emptySky = calculateSunsetScore('generic', { ...baseWeather, cloudHigh: 5, cloudMid: 80 }, { cloudLow: 5 });

  assert.equal(clear.components.canvasCoverage, 64);
  assert.equal(localBlocked.score, clear.score);
  assert.equal(remoteBlocked.score, clear.score);
  assert.ok(localBlocked.probability < clear.probability);
  assert.ok(remoteBlocked.probability < 10);
  assert.ok(emptySky.score <= 30);
  assert.match(clear.verdict, /爆燃预警/);
});

test('V3 画布分连续增长并对超过85%的厚云平滑降分', () => {
  const at40 = calculateSunsetScore('generic', { ...baseWeather, cloudHigh: 40, cloudMid: 40, humidity250: 90 });
  const at41 = calculateSunsetScore('generic', { ...baseWeather, cloudHigh: 41, cloudMid: 41, humidity250: 90 });
  const at70 = calculateSunsetScore('generic', { ...baseWeather, cloudHigh: 70, cloudMid: 70, humidity250: 90 });
  const at85 = calculateSunsetScore('generic', { ...baseWeather, cloudHigh: 85, cloudMid: 85, humidity250: 90 });
  const at100 = calculateSunsetScore('generic', { ...baseWeather, cloudHigh: 100, cloudMid: 100, humidity250: 90 });

  assert.equal(at40.components.canvasPoints, 32);
  assert.equal(at41.components.canvasPoints, 33);
  assert.equal(at70.components.canvasPoints, 56);
  assert.equal(at85.components.canvasPoints, 68);
  assert.equal(at100.components.canvasPoints, 32);
});

test('V3 能见度5km以下不再获得滤镜保底分', () => {
  const at5 = calculateSunsetScore('generic', { ...baseWeather, visibility: 5, humidity250: 90 });
  const at10 = calculateSunsetScore('generic', { ...baseWeather, visibility: 10, humidity250: 90 });
  const at24 = calculateSunsetScore('generic', { ...baseWeather, visibility: 24, humidity250: 90 });

  assert.equal(at5.components.filterPoints, 0);
  assert.equal(at10.components.filterPoints, 5);
  assert.equal(at24.components.filterPoints, 20);
});

test('V3 只使用固定景观加分且正向累计不超过10分', () => {
  const huangshan = calculateSunsetScore(
    'huangshan',
    { ...baseWeather, cloudBaseHeight: 1200 },
    { cloudLow: 5 }
  );
  const shenzhen = calculateSunsetScore(
    'shenzhen',
    baseWeather,
    { cloudLow: 5 },
    { typhoonNearby: true }
  );

  assert.equal(huangshan.components.sceneBonus, 8);
  assert.equal(shenzhen.components.sceneBonus, 10);
  assert.ok([huangshan, shenzhen].every(result => result.components.sceneBonus <= 10));
  assert.equal([huangshan, shenzhen].flatMap(result => result.corrections).some(item => /×1\./.test(item.value)), false);
});

test('V3 同时输出原始物理分与当前展示分', () => {
  const result = calculateSunsetScore('xihu', baseWeather, { cloudLow: 5 });
  assert.equal(Number.isInteger(result.rawQuality), true);
  assert.equal(result.quality, result.rawQuality);
  assert.equal(result.score, result.quality);
  assert.equal(result.components.rawQuality, result.rawQuality);
  assert.equal(result.components.quality, result.quality);
});

test('阴天厚云幕不得进入 GREAT 或 FIRE', () => {
  for (const spotId of ['xihu', 'waitan', 'beijing', 'erhai', 'chongqing', 'xiamen', 'qingdao', 'chengdu', 'shenzhen', 'huangshan']) {
    const result = calculateSunsetScore(
      spotId,
      { ...baseWeather, cloudHigh: 85, cloudMid: 85, weatherCode: 3 },
      { cloudLow: 5 }
    );
    assert.equal(result.weather.label, '阴');
    assert.ok(result.quality <= 59, `${spotId} 阴天质量分不应为 ${result.quality}`);
    assert.ok(['CLEAR', 'FAIR'].includes(result.grade));
    assert.ok(result.corrections.some(item => item.item === '阴天厚云上限'));
  }
});

test('等级边界返回 NONE/CLEAR/FAIR/GREAT/FIRE', () => {
  assert.equal(getScoreGrade(0), 'NONE');
  assert.equal(getScoreGrade(1), 'CLEAR');
  assert.equal(getScoreGrade(30), 'FAIR');
  assert.equal(getScoreGrade(60), 'GREAT');
  assert.equal(getScoreGrade(85), 'FIRE');
});

test('全站天气统一区分晴、小雨、中雨、大雨与雷雨', () => {
  assert.equal(getWeatherMeta({ weatherCode: 0, precipitationRate: 0 }).label, '晴');
  assert.equal(getWeatherMeta({ weatherCode: 80, precipitationRate: 0.4 }).label, '小雨');
  assert.equal(getWeatherMeta({ weatherCode: 63, precipitationRate: 3 }).label, '中雨');
  assert.equal(getWeatherMeta({ weatherCode: 65, precipitationRate: 8 }).label, '大雨');
  assert.equal(getWeatherMeta({ weatherCode: 95, precipitationRate: 1 }).label, '雷雨');
  assert.deepEqual(
    {
      label: getWeatherMeta({ weatherText: '中雨', weatherProvider: 'qweather', precipitationRate: 0 }).label,
      source: getWeatherMeta({ weatherText: '中雨', weatherProvider: 'qweather', precipitationRate: 0 }).source,
    },
    { label: '中雨', source: 'qweather' }
  );

  for (const spotId of ['xihu', 'waitan', 'beijing', 'erhai', 'chongqing', 'xiamen', 'qingdao', 'chengdu', 'shenzhen', 'huangshan']) {
    const rain = calculateSunsetScore(
      spotId,
      { ...baseWeather, weatherCode: 63, precipitationRate: 3 },
      { cloudLow: 5 }
    );
    assert.equal(rain.weather.label, '中雨');
    assert.equal(rain.score, 0);
    assert.equal(rain.probability, 0);
  }
});

test('西湖使用固定水面反射加分与提前15分钟标记', () => {
  const result = calculateSunsetScore('xihu', { ...baseWeather, humidity: 85 }, { cloudLow: 5 });
  assert.equal(result.timeOffsetMinutes, -15);
  assert.ok(result.corrections.some(item => item.item === '湖面镜像'));
  assert.equal(result.components.sceneBonus, 2);
});

test('西湖大雨将质量分与观测成功率归零，微雨只压低成功率', () => {
  const dry = calculateSunsetScore('xihu', { ...baseWeather, precipitationRate: 0, weatherCode: 2 }, { cloudLow: 5 });
  const overcast = calculateSunsetScore('xihu', { ...baseWeather, precipitationRate: 0, weatherCode: 3 }, { cloudLow: 5 });
  const drizzle = calculateSunsetScore(
    'xihu',
    { ...baseWeather, precipitationRate: 0.2, precipitationProbability: 75, weatherCode: 51 },
    { cloudLow: 5 }
  );
  const rain = calculateSunsetScore(
    'xihu',
    { ...baseWeather, precipitationRate: 0.6, precipitationProbability: 90, weatherCode: 63 },
    { cloudLow: 5 }
  );

  assert.equal(overcast.probability, dry.probability);
  assert.ok(overcast.score <= 59);
  assert.equal(drizzle.score, dry.score);
  assert.ok(drizzle.probability <= 10);
  assert.equal(rain.score, 0);
  assert.equal(rain.probability, 0);
  assert.ok(rain.corrections.some(item => item.item === '降雨阻断'));
});

test('西湖日落前15分钟选择最近插值网格', () => {
  const payload = {
    daily: { time: ['2026-07-17'], sunset: ['2026-07-17T19:03'] },
    minutely_15: {
      time: ['2026-07-17T18:30', '2026-07-17T18:45', '2026-07-17T19:00'],
      temperature_2m: [30, 29, 28],
      relative_humidity_2m: [70, 72, 74],
      visibility: [20000, 22000, 24000],
      cloud_cover_low: [8, 6, 4],
      cloud_cover_mid: [40, 42, 44],
      cloud_cover_high: [60, 62, 64],
      wind_speed_10m: [3, 4, 5],
      precipitation: [0, 0.2, 0.6],
      rain: [0, 0.1, 0.4],
      weather_code: [3, 51, 63],
    },
  };
  const weather = parseTargetAtSunsetOffset(payload, '2026-07-17');
  assert.equal(weather.cloudHigh, 62);
  assert.equal(weather.visibility, 22);
  assert.equal(weather.precipitationRate, 0.8);
  assert.equal(weather.rainRate, 0.4);
  assert.equal(weather.weatherCode, 51);
});

test('外滩远程破窗、AQI 粉紫与通透奖励', () => {
  const result = calculateSunsetScore(
    'waitan',
    { ...baseWeather, visibility: 32 },
    { cloudLow: 5, humidity850: 70 },
    { airQuality: { aqi: 70 } }
  );
  assert.equal(result.colorOverride.label, '赛博粉紫');
  assert.ok(result.corrections.some(item => item.item === '150km 远程破窗'));
  assert.ok(result.corrections.some(item => item.item === '陆家嘴金光'));
});

test('北京门头沟山云压低观测概率但保留高空品质，jingshan 别名生效', () => {
  const result = calculateSunsetScore('jingshan', { ...baseWeather, humidity: 25 }, { cloudLow: 45 });
  assert.ok(result.score > 0);
  assert.ok(result.probability <= 20);
  assert.equal(result.probabilityLabel, '光线可能受阻');
});

test('洱海苍山近程阻断只压低观测概率，高海拔仍增强品质', () => {
  const result = calculateSunsetScore('erhai', baseWeather, { cloudLow: 65 });
  assert.ok(result.score > 0);
  assert.ok(result.probability <= 10);
  assert.equal(result.colorOverride.label, '干热深红');
});

test('黄山使用925/700hPa代理识别云海、低云雾与高空风速', () => {
  const cloudSeaWeather = { ...baseWeather, cloudLow: 40, lowLevelHumidity: 96, humidity700: 25 };
  const cloudSea = calculateSunsetScore('huangshan', cloudSeaWeather, { cloudLow: 5 });
  const windy = calculateSunsetScore('huangshan', { ...cloudSeaWeather, windSpeed700: 15 }, { cloudLow: 5 });
  const fog = calculateSunsetScore(
    'huangshan',
    { ...baseWeather, cloudLow: 60, lowLevelHumidity: 96, humidity700: 50 },
    { cloudLow: 5 }
  );
  assert.ok(cloudSea.score > windy.score);
  assert.equal(cloudSea.dataAvailability.cloudBaseHeight, 'pressure-level-proxy');
  assert.ok(cloudSea.corrections.some(item => item.item === '压力层云海'));
  assert.equal(fog.probability, 0);
  assert.ok(fog.corrections.some(item => item.item === '低云雾中'));
});

test('黄山未来取得云底高度时优先使用直接观测', () => {
  const result = calculateSunsetScore(
    'huangshan',
    { ...baseWeather, cloudBaseHeight: 1200, lowLevelHumidity: 70, humidity700: 50 },
    { cloudLow: 5 }
  );
  assert.equal(result.dataAvailability.cloudBaseHeight, 'connected');
  assert.ok(result.corrections.some(item => item.item === '云海日落'));
});

test('重庆使用15km通透阈值并应用高湿与江面修正', () => {
  const result = calculateSunsetScore('chongqing', { ...baseWeather, visibility: 15, humidity: 92 }, { cloudLow: 5 });
  assert.ok(result.corrections.some(item => item.item === '雾都高湿消光'));
  assert.ok(result.corrections.some(item => item.item === '两江反射'));
});

test('厦门海雾锁色，台风路径缺失时不触发奖金', () => {
  const unavailable = calculateSunsetScore('xiamen', { ...baseWeather, lowLevelHumidity: 97 }, { cloudLow: 5 });
  const typhoon = calculateSunsetScore('xiamen', baseWeather, { cloudLow: 5 }, { typhoonNearby: true });
  assert.equal(unavailable.colorOverride.label, '灰蒙蒙');
  assert.equal(unavailable.dataAvailability.typhoonTrack, 'unavailable');
  assert.ok(typhoon.corrections.some(item => item.item === '台风外围下沉气流'));
  assert.ok(typhoon.probability > unavailable.probability);
});

test('青岛东南风降低通透度并延缓高云余晖衰减', () => {
  const southeast = calculateSunsetScore('qingdao', { ...baseWeather, windDirection: 135 }, { cloudLow: 5 });
  const west = calculateSunsetScore('qingdao', { ...baseWeather, windDirection: 270 }, { cloudLow: 5 });
  assert.ok(southeast.score < west.score);
  assert.equal(southeast.afterglowDecay, 'slow');
});

test('成都150km破窗提升观测概率并锁定浪漫粉紫', () => {
  const result = calculateSunsetScore('chengdu', { ...baseWeather, visibility: 12, humidity: 80 }, { cloudLow: 5 });
  assert.equal(result.colorOverride.label, '浪漫粉紫');
  assert.ok(result.probability >= 95);
  assert.ok(result.corrections.some(item => item.item === '150km 盆地破窗'));
});

test('深圳建筑金光、台风奖金与东南风海雾处罚', () => {
  const clear = calculateSunsetScore('shenzhen', baseWeather, { cloudLow: 5 }, { typhoonNearby: true });
  const fog = calculateSunsetScore(
    'shenzhen',
    { ...baseWeather, humidity: 95, windDirection: 135 },
    { cloudLow: 5 },
    { typhoonNearby: false }
  );
  assert.ok(clear.corrections.some(item => item.item === '建筑金光'));
  assert.ok(clear.corrections.some(item => item.item === '台风外围下沉气流'));
  assert.equal(fog.colorOverride.label, '灰蒙蒙');
  assert.ok(fog.probability < clear.probability);
});
