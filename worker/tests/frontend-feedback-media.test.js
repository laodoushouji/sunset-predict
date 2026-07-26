const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend/css/styles.css'), 'utf8');
const nginx = fs.readFileSync(path.join(root, 'deploy/sunset.conf'), 'utf8');

test('实况反馈提供单图上传、预览、移除与300字评论', () => {
  assert.match(html, /id="feedback-photo"[^>]+accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /id="feedback-photo-preview"/);
  assert.match(html, /id="feedback-photo-remove"/);
  assert.match(html, /id="feedback-comment" maxlength="300"/);
  assert.match(styles, /\.feedback-photo-preview/);
  assert.match(styles, /#feedback-comment/);
});

test('浏览器压缩照片、移除EXIF并只向业务接口提交内容', () => {
  assert.match(app, /async function compressFeedbackPhoto/);
  assert.match(app, /canvas\.toBlob\(/);
  assert.match(app, /FEEDBACK_MAX_PHOTO_BYTES = 1_200_000/);
  assert.match(app, /payload\.photo = \{ dataUrl: feedbackDraft\.photoDataUrl \}/);
  assert.doesNotMatch(app, /trackUmamiEvent\([^)]*(comment|photoDataUrl|actualQuality|observed)/);
});

test('上传链路允许压缩后的JSON体积但仍限制请求上限', () => {
  assert.match(nginx, /client_max_body_size 2m;/);
  assert.match(app, /仅支持 JPEG、PNG 或 WebP 图片/);
});
