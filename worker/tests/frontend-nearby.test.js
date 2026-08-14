const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend/css/styles.css'), 'utf8');

test('前台不展示最近站点入口，后端保留 nearby 能力与日志', () => {
  const server = fs.readFileSync(path.join(root, 'worker/src/server.mjs'), 'utf8');
  assert.doesNotMatch(html, /nearby-spot/);
  assert.doesNotMatch(html, /离你最近的已开通站点/);
  assert.doesNotMatch(script, /NEARBY_API_URL|fetchNearbySpot|openNearbySpot|nearbySpot/);
  assert.doesNotMatch(styles, /\.nearby-spot/);
  assert.doesNotMatch(script, /navigator\.geolocation/);
  assert.match(server, /url\.pathname === '\/api\/nearby'/);
  assert.match(server, /function logNearbySpot\(/);
  assert.match(server, /\[nearby\] path=/);
});

test('全国站点保持手机双列布局', () => {
  assert.match(styles, /\.city-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.equal((script.match(/\{ slug: '[a-z-]+'/g) || []).length, 35);
  for (const slug of ['guangzhou', 'wuhan', 'sanya', 'xian', 'nanjing', 'xiapu', 'wuxi', 'hongkong', 'dunhuang']) {
    assert.match(script, new RegExp(`slug: '${slug}'`));
    assert.match(styles, new RegExp(`\\.city-card--${slug}`));
  }
});

test('香港站点与新版城市图片使用可刷新缓存地址', () => {
  assert.match(html, /js\/app\.js\?v=20260811-spot-search-v59/);
  assert.match(script, /city-\$\{spot\.slug\}\.webp\?v=20260810-province-live-v12/);
  assert.match(script, /slug: 'hongkong'/);
});

test('全国摄影站优先展示景山、深圳、广州与香港', () => {
  const regionalList = script.match(/const REGIONAL_SPOTS = \[([\s\S]*?)\n\];/)?.[1] || '';
  const slugs = [...regionalList.matchAll(/slug: '([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(slugs.slice(0, 4), ['beijing', 'shenzhen', 'guangzhou', 'hongkong']);
  assert.equal(slugs[4], 'dunhuang');
});

test('主页面所有景区卡片提供简洁蓝调时间', () => {
  assert.match(html, /css\/styles\.css\?v=20260811-spot-search-v59/);
  assert.match(html, /id="xihu-blue-hour"/);
  assert.match(html, /id="waitan-blue-hour"/);
  assert.match(script, /class="city-card__blue-hour"/);
  assert.match(script, /renderBlueHourBrief\(card\.querySelector\('\.city-card__blue-hour'\), data\)/);
  assert.match(script, /蓝调 \$\{blueHour\.start\}–\$\{blueHour\.end\}/);
  assert.match(script, /const hasBlueHour = Boolean\(data\.blueHour\?\.available\)/);
});

test('全国站详情显示完整蓝调质量模块', () => {
  assert.match(html, /id="blue-hour-section"/);
  assert.match(script, /function renderBlueHour\(data\)/);
  assert.match(script, /if \(!blueHour\?\.available\)/);
  assert.doesNotMatch(script, /\['xihu', 'waitan'\]\.includes\(spotId\)/);
});
