const net = require('node:net');
const geoip = require('fast-geoip');
const { FORECAST_SPOTS } = require('./cities');

const CORE_SPOTS = {
  xihu: {
    spot: 'xihu',
    spotName: '杭州西湖',
    location: '杭州 · 西湖',
    target: { lat: 30.25, lon: 120.15 },
  },
  waitan: {
    spot: 'waitan',
    spotName: '上海外滩',
    location: '上海 · 黄浦 / 浦东',
    target: { lat: 31.24, lon: 121.49 },
  },
};

const NEARBY_SPOTS = [
  ...Object.values(CORE_SPOTS),
  ...Object.values(FORECAST_SPOTS),
].map(({ spot, spotName, location, target }) => ({
  spot,
  spotName,
  location,
  target,
}));

function normalizeIp(value) {
  const candidate = String(value || '').trim().replace(/^\[|\]$/g, '');
  if (candidate.startsWith('::ffff:')) return candidate.slice(7);
  return net.isIP(candidate) ? candidate : null;
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1';
}

function isPublicIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (version === 6) {
    const value = ip.toLowerCase();
    return !(
      value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      /^fe[89ab]/.test(value)
    );
  }
  return false;
}

function clientIpFromRequest(request) {
  const remoteAddress = normalizeIp(request.socket?.remoteAddress);
  if (!isLoopback(remoteAddress)) return isPublicIp(remoteAddress) ? remoteAddress : null;

  const realIp = normalizeIp(request.headers['x-real-ip']);
  if (realIp && isPublicIp(realIp)) return realIp;

  const forwardedIp = String(request.headers['x-forwarded-for'] || '')
    .split(',')
    .map(normalizeIp)
    .find(isPublicIp);
  return forwardedIp || null;
}

function distanceKm(origin, target) {
  const radians = Math.PI / 180;
  const dLat = (target.lat - origin.lat) * radians;
  const dLon = (target.lon - origin.lon) * radians;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(origin.lat * radians) *
    Math.cos(target.lat * radians) *
    Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function nearestSpotForCoordinates(latitude, longitude, spots = NEARBY_SPOTS) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const origin = { lat: latitude, lon: longitude };
  return spots.reduce((nearest, spot) => {
    const distance = distanceKm(origin, spot.target);
    if (nearest && nearest.distanceKm <= distance) return nearest;
    return {
      spot: spot.spot,
      spotName: spot.spotName,
      location: spot.location,
      distanceKm: Math.round(distance),
    };
  }, null);
}

async function findNearestSpotByIp(ip, lookup = geoip.lookup) {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp || !isPublicIp(normalizedIp)) return null;

  const result = await lookup(normalizedIp);
  const latitude = result?.ll?.[0];
  const longitude = result?.ll?.[1];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const nearestSpot = nearestSpotForCoordinates(latitude, longitude);
  if (!nearestSpot) return null;

  return {
    available: true,
    accuracy: 'city',
    nearestSpot,
  };
}

module.exports = {
  NEARBY_SPOTS,
  clientIpFromRequest,
  distanceKm,
  findNearestSpotByIp,
  isPublicIp,
  nearestSpotForCoordinates,
  normalizeIp,
};
