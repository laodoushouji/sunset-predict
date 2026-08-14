const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend/css/styles.css'), 'utf8');

test('站点搜索在桌面常驻并可在手机端展开', () => {
  assert.match(html, /id="spot-search-toggle"/);
  assert.match(html, /id="spot-search-input"[^>]+type="search"/);
  assert.match(html, /id="spot-search-empty"[^>]+aria-live="polite"/);
  assert.match(html, /该站点暂未开通/);
  assert.match(styles, /\.spot-search__toggle\s*\{[\s\S]*?display:\s*none/);
  assert.match(styles, /@media \(max-width:\s*720px\)[\s\S]*?\.spot-search__toggle\s*\{[\s\S]*?display:\s*inline-flex/);
  assert.match(styles, /\.spot-search\.is-open\s+\.spot-search__field/);
});

test('站点搜索使用本地卡片索引并同时筛选全国与省份站点', () => {
  assert.match(script, /data-search="\$\{buildSpotSearchText\(spot\)\}"/);
  assert.match(script, /function filterSpotCards\(query\)/);
  assert.match(script, /document\.querySelectorAll\('\.city-card\[data-search\]'\)/);
  assert.match(script, /document\.getElementById\('regional-grid'\)/);
  assert.match(script, /document\.getElementById\('province-section'\)/);
  assert.match(script, /card\.hidden = !matches/);
  assert.match(script, /spotSearchEmpty\.hidden = matchedCount > 0 \|\| terms\.length === 0/);
});

test('清空站点搜索恢复卡片并保留原有双列顺序', () => {
  assert.match(script, /spotSearchClear\.addEventListener\('click'/);
  assert.match(script, /spotSearchInput\.value = ''/);
  assert.match(script, /filterSpotCards\(''\)/);
  assert.match(styles, /\.city-card\[hidden\][\s\S]*?display:\s*none/);
  assert.match(styles, /\.city-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});
