const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8');

test('详情抽屉提供分享长图入口与微信内保存预览', () => {
  assert.match(html, /id="detail-share"/);
  assert.match(html, /id="share-poster-modal"/);
  assert.match(html, /id="share-poster-preview"/);
  assert.match(html, /id="share-system-button"/);
  assert.match(html, /id="share-poster-download"/);
  assert.match(html, /微信内可长按图片保存/);
});

test('分享海报使用1080x1920同源景区图并包含核心摄影信息', () => {
  const posterBody = app.match(/async function createSharePoster[\s\S]*?\n}\n\nfunction prepareSharePoster/)?.[0] || '';
  assert.match(posterBody, /canvas\.width = 1080/);
  assert.match(posterBody, /canvas\.height = 1920/);
  assert.match(posterBody, /partnerImageForSpot\(spotId\)/);
  assert.match(posterBody, /data\.quality/);
  assert.match(posterBody, /data\.probability/);
  assert.match(posterBody, /posterBestSpot/);
  assert.match(posterBody, /cameraParametersForScore/);
  assert.match(posterBody, /PHYSICAL LAYERS/);
  assert.match(posterBody, /image\/jpeg/);
  assert.doesNotMatch(posterBody, /feedbackDraft|wechat-pay|business\.jpg/);
});

test('支持系统文件分享并在不支持时降级保存长图', () => {
  assert.match(app, /navigator\.canShare\(\{ files: \[file\] \}\)/);
  assert.match(app, /navigator\.share\(\{[\s\S]*?files: \[sharePosterFile\]/);
  assert.match(app, /getElementById\('share-poster-download'\)\.click\(\)/);
});
