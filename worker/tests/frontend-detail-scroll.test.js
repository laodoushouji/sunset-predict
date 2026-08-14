const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/css/styles.css'), 'utf8');

test('关闭详情抽屉后恢复打开前的首页滚动位置', () => {
  const cityCardBinding = app.match(/document\.querySelectorAll\('\.city-card'\)[\s\S]*?\n  \}\);/)?.[0] || '';
  assert.match(cityCardBinding, /event\.preventDefault\(\)/);
  assert.match(cityCardBinding, /openDetail\(card\.dataset\.spot, \{ source: 'card' \}\)/);
  assert.match(app, /detailPageScrollY = window\.scrollY \|\| window\.pageYOffset \|\| 0/);
  assert.match(app, /lockDetailPageScroll\(\)/);
  assert.match(app, /unlockDetailPageScroll\(\)/);
  assert.match(app, /window\.scrollTo\(0, restoreY\)/);
  assert.match(css, /body\.detail-open \{[\s\S]*?position: fixed;[\s\S]*?top: var\(--detail-scroll-offset, 0\)/);
});
