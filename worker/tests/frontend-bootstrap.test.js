const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildForecastBootstrap,
  injectForecastBootstrap,
  shanghaiDate,
} = require('../src/services/frontend-bootstrap');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8');

test('上海日期不受服务器 UTC 日期边界影响', () => {
  assert.equal(shanghaiDate(new Date('2026-07-18T16:30:00Z')), '2026-07-19');
});

test('当天历史快照转换为只含今日的首屏数据', () => {
  const day = {
    date: '2026-07-19',
    offset: -1,
    recorded: true,
    capturedAt: '2026-07-19T02:00:00.000Z',
    xihu: { spot: 'xihu', quality: 42 },
    waitan: { spot: 'waitan', quality: 38 },
    spots: [{ spot: 'beijing', quality: 55 }],
    calibration: { shouldNotShip: true },
  };
  const result = buildForecastBootstrap(day, '2026-07-19');
  assert.equal(result.bootstrap, true);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].offset, 0);
  assert.equal(result.days[0].recorded, false);
  assert.equal(result.days[0].spots.length, 1);
  assert.equal('calibration' in result.days[0], false);
});

test('跨日旧快照不会注入首页', () => {
  assert.equal(buildForecastBootstrap({ date: '2026-07-18', xihu: {}, waitan: {} }, '2026-07-19'), null);
});

test('首屏 JSON 安全注入占位节点并由前端即时渲染', () => {
  const bootstrap = buildForecastBootstrap({
    date: '2026-07-19',
    xihu: { spot: 'xihu', note: '</script><script>alert(1)</script>' },
    waitan: { spot: 'waitan' },
    spots: [],
  }, '2026-07-19');
  const output = injectForecastBootstrap(html, bootstrap);
  assert.match(output, /id="forecast-bootstrap" type="application\/json">\{/);
  assert.doesNotMatch(output, /<\/script><script>alert/);
  assert.match(output, /\\u003c\/script>/);
  assert.match(app, /function readForecastBootstrap/);
  assert.match(app, /applyTimelinePayload\(bootstrap\)/);
  assert.match(app, /requestAnimationFrame\(openDetailFromUrl\)/);
});

test('首屏不再依赖同步 Tailwind 与 Lucide 加载', () => {
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com/);
  assert.match(html, /<script async src="https:\/\/unpkg\.com\/lucide@1\.25\.0/);
  assert.match(app, /window\.lucide\?\.createIcons\?\.\(\)/);
});
