const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8');

test('Umami 自动记录页面访问但排除查询参数与详情哈希', () => {
  assert.match(html, /src="\/umami\/script\.js"/);
  assert.match(html, /data-website-id="[a-f0-9-]{36}"/);
  assert.match(html, /data-domains="sunsetpredict\.cloud"/);
  assert.match(html, /data-exclude-search="true"/);
  assert.match(html, /data-exclude-hash="true"/);
  assert.match(html, /data-do-not-track="true"/);
});

test('Umami 业务事件只发送固定事件名和站点', () => {
  for (const eventName of ['detail-open', 'date-change', 'feedback-submit', 'support-open', 'partner-open']) {
    assert.match(app, new RegExp(`'${eventName}'`));
  }
  const trackerBody = app.match(/function trackUmamiEvent[\s\S]*?\n}/)?.[0] || '';
  assert.equal((app.match(/window\.umami\.track/g) || []).length, 1);
  assert.match(app, /window\.umami\.track\(eventName, \{ spot: safeSpot \}\)/);
  assert.doesNotMatch(trackerBody, /observed|actualQuality|clientId|weather|quality|probability|feedbackDraft/);
  assert.doesNotMatch(app, /window\.umami\.identify/);
});
