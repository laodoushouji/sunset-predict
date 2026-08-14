const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NEARBY_SPOTS,
  clientIpFromRequest,
  findNearestSpotByIp,
  isPublicIp,
  nearestSpotForCoordinates,
  normalizeIp,
} = require('../src/services/nearby');

test('附近站点包含西湖、外滩和全部 35 个预测站点', () => {
  assert.equal(NEARBY_SPOTS.length, 37);
  assert.deepEqual(
    NEARBY_SPOTS.map(spot => spot.spot),
    [
      'xihu', 'waitan', 'beijing', 'erhai', 'chongqing', 'xiamen', 'qingdao',
      'chengdu', 'shenzhen', 'huangshan', 'guangzhou', 'wuhan', 'sanya',
      'xian', 'nanjing', 'xiapu', 'wuxi', 'hongkong', 'dunhuang',
      'caoyuan-tianlu', 'hukou', 'longmen', 'haerbin-song', 'wusongdao', 'yalu',
      'hengshan', 'lushan', 'fanjing', 'namtso', 'heimahe', 'ejina',
      'xiangbishan', 'helanshan', 'kanas', 'taipei', 'tianjin-wudadao', 'coloane',
    ]
  );
});

test('坐标距离选择最近的已开通站点', () => {
  const result = nearestSpotForCoordinates(30.29, 120.17);
  assert.equal(result.spot, 'xihu');
  assert.ok(result.distanceKm < 10);
});

test('只信任来自本机 Nginx 的真实 IP 请求头', () => {
  const proxied = clientIpFromRequest({
    socket: { remoteAddress: '::ffff:127.0.0.1' },
    headers: {
      'x-real-ip': '223.5.5.5',
      'x-forwarded-for': '198.51.100.2',
    },
  });
  const direct = clientIpFromRequest({
    socket: { remoteAddress: '8.8.8.8' },
    headers: { 'x-real-ip': '223.5.5.5' },
  });

  assert.equal(proxied, '223.5.5.5');
  assert.equal(direct, '8.8.8.8');
  assert.equal(normalizeIp('::ffff:223.5.5.5'), '223.5.5.5');
});

test('内网和本机地址不会进入定位库', () => {
  assert.equal(isPublicIp('127.0.0.1'), false);
  assert.equal(isPublicIp('10.0.0.8'), false);
  assert.equal(isPublicIp('192.168.1.8'), false);
  assert.equal(isPublicIp('223.5.5.5'), true);
  assert.equal(clientIpFromRequest({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-real-ip': '192.168.1.8' },
  }), null);
});

test('IP 定位响应不包含原始 IP', async () => {
  const result = await findNearestSpotByIp('223.5.5.5', async () => ({
    country: 'CN',
    region: 'ZJ',
    city: 'Hangzhou',
    ll: [30.29, 120.17],
  }));

  assert.equal(result.available, true);
  assert.equal(result.accuracy, 'city');
  assert.equal(result.nearestSpot.spot, 'xihu');
  assert.equal(Object.hasOwn(result, 'ip'), false);
  assert.equal(Object.hasOwn(result, 'city'), false);
});

test('定位库无坐标时安全降级', async () => {
  const result = await findNearestSpotByIp('223.5.5.5', async () => null);
  assert.equal(result, null);
});
