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
  for (const eventName of [
    'spot-card-click',
    'spot-card-exit',
    'spot-card-fast-exit',
    'detail-open',
    'detail-close',
    'detail-page-exit',
    'date-change',
    'timeline-node-open',
    'message-more',
    'feedback-photo-select',
    'feedback-submit',
    'share-open',
    'share-complete',
    'share-save',
    'support-open',
    'partner-open',
  ]) {
    assert.match(app, new RegExp(`'${eventName}'`));
  }
  const trackerBody = app.match(/function trackUmamiEvent[\s\S]*?\n}/)?.[0] || '';
  assert.equal((app.match(/window\.umami\.track/g) || []).length, 1);
  assert.match(app, /window\.umami\.track\(eventName, \{ spot: safeSpot \}\)/);
  assert.doesNotMatch(trackerBody, /observed|actualQuality|clientId|weather|quality|probability|feedbackDraft/);
  assert.doesNotMatch(app, /window\.umami\.identify/);
});

test('地点详情区分卡片点击、主动关闭与离站退出', () => {
  assert.match(app, /openDetail\('xihu', \{ source: 'card' \}\)/);
  assert.match(app, /openDetail\('waitan', \{ source: 'card' \}\)/);
  assert.match(app, /\.city-card'\)\.forEach\(card => \{[\s\S]*?trackUmamiEvent\('spot-card-click', card\.dataset\.spot\)/);
  assert.match(app, /window\.addEventListener\('pagehide', trackDetailPageExit\)/);
  assert.match(app, /event\?\.persisted/);
  assert.match(app, /trackUmamiEvent\('detail-close', closingSpot\)/);
  assert.match(app, /trackUmamiEvent\('spot-card-exit', activeDetailSpot\)/);
  assert.match(app, /Date\.now\(\) - detailOpenedAt < DETAIL_FAST_EXIT_MS/);
});

test('分享、时间轴和留言行为只关联当前站点', () => {
  assert.match(app, /trackUmamiEvent\('share-open', activeDetailSpot\)/);
  assert.match(app, /trackUmamiEvent\('share-complete', activeDetailSpot\)/);
  assert.match(app, /trackUmamiEvent\('share-save', activeDetailSpot\)/);
  assert.match(app, /trackUmamiEvent\('timeline-node-open', activeDetailSpot\)/);
  assert.match(app, /trackUmamiEvent\('message-more', feedbackMessages\.spot\)/);
  assert.match(app, /trackUmamiEvent\('feedback-photo-select', feedbackDraft\.spot\)/);
});
