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

const SPOT_BLUE_HOUR_GUIDES = {
  xihu: { scene: '湖面与沿岸灯光', whiteBalance: '3600K' },
  waitan: { scene: '外滩全景与金色灯光', whiteBalance: '3800K' },
  beijing: { scene: '故宫金瓦、城楼与城市灯光', whiteBalance: '3800K' },
  erhai: { scene: '苍山剪影与洱海倒影', whiteBalance: '3600K' },
  chongqing: { scene: '两江灯火与来福士天际线', whiteBalance: '3800K' },
  xiamen: { scene: '海岸余光与沿岸灯火', whiteBalance: '3600K' },
  qingdao: { scene: '海面、栈桥与城市灯光', whiteBalance: '3600K' },
  chengdu: { scene: '金融城双塔亮灯与城市深蓝', whiteBalance: '3800K' },
  shenzhen: { scene: '后海楼群与湾区灯光', whiteBalance: '3800K' },
  huangshan: { scene: '群峰剪影与深蓝天空层次', whiteBalance: '3500K' },
  guangzhou: { scene: '广州塔与珠江灯光', whiteBalance: '3800K' },
  wuhan: { scene: '黄鹤楼与长江大桥灯光', whiteBalance: '3800K' },
  sanya: { scene: '椰林剪影与海面暮蓝', whiteBalance: '3600K' },
  xian: { scene: '古城墙灯光与深蓝天空', whiteBalance: '3800K' },
  nanjing: { scene: '玄武湖倒影与南京天际线', whiteBalance: '3600K' },
  xiapu: { scene: '滩涂线条与渔排灯火', whiteBalance: '3600K' },
  wuxi: { scene: '太湖水面与远山剪影', whiteBalance: '3600K' },
  hongkong: { scene: '维港天际线与金色灯火', whiteBalance: '3800K' },
  dunhuang: { scene: '月牙泉灯影与沙丘剪影', whiteBalance: '3600K' },
};

function buildBlueHour({ date, latitude, longitude, weather, airQuality = {}, spotId }) {
  const times = getBlueHourTimes(date, latitude, longitude);
  if (!times) return { available: false, message: '蓝调时刻暂不可用' };
  const quality = calculateBlueHourScore(weather);
  const aqi = Number.isFinite(Number(airQuality.aqi)) ? Number(airQuality.aqi) : null;
  const airQualityHint = aqi === null
    ? '空气质量数据暂缺'
    : aqi <= 50 ? '空气清洁，深蓝层次更清晰' : aqi <= 100 ? '空气散射适中，适合冷暖对比' : '空气浑浊可能削弱深蓝层次';
  const guide = SPOT_BLUE_HOUR_GUIDES[spotId] || SPOT_BLUE_HOUR_GUIDES.xihu;

  return {
    available: true,
    date,
    ...times,
    score: quality.score,
    label: quality.label,
    components: quality.components,
    aqi,
    airQualityHint,
    advice: `今晚 ${times.start} 进入蓝调，建议利用${guide.scene}拍摄冷暖对比，白平衡调至 ${guide.whiteBalance}。`,
    camera: {
      aperture: 'f/8',
      shutter: '2–8s',
      iso: 'ISO 100',
      whiteBalance: guide.whiteBalance,
    },
    source: 'suncalc-2.0.1',
  };
}

module.exports = {
  SPOT_BLUE_HOUR_GUIDES,
  buildBlueHour,
  calculateBlueHourScore,
  findEveningAngle,
  getBlueHourTimes,
};
