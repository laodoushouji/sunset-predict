#!/usr/bin/env node
/**
 * 向百度搜索资源平台「普通收录 → API 提交（主动推送）」推送 sitemap 里的全部 URL。
 * 主动推送的收录权重高于纯 sitemap，建议每次发版后跑一次。
 *
 * 使用前：
 *   1. 在 https://ziyuan.baidu.com 添加并验证站点 sunsetpredict.cloud
 *   2. 资源提交 → 普通收录 → API 提交，复制准入密钥（token）
 *   3. 运行：
 *        BAIDU_PUSH_TOKEN="你的token" node scripts/baidu-push.cjs
 *      或者把 token 写进 .env（BAIDU_PUSH_TOKEN=...）
 *
 * 接口（2026-08-05 从平台复制，已验证格式）：
 *   POST http://data.zz.baidu.com/urls?site=https://sunsetpredict.cloud&token=TOKEN
 *   Body: text/plain，每行一条 URL
 *   返回: { success, remain, not_same_site[], not_valid[] }
 *
 * 注意：配额当日有效、不可累计；site 必须与平台验证的站点完全一致（含 https://）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const SITE = process.env.BAIDU_PUSH_SITE || 'https://sunsetpredict.cloud';
// 兜底 token：来自平台「普通收录 → API 提交」页面（2026-08-05）。
// 优先用环境变量 BAIDU_PUSH_TOKEN，避免把密钥硬编码进仓库。
const TOKEN = process.env.BAIDU_PUSH_TOKEN || 'FBmcToVRmc4rqWQE';

const SITEMAP_PATH = path.join(__dirname, '..', 'frontend', 'sitemap.xml');
const ENDPOINT = 'http://data.zz.baidu.com/urls';

function readUrlsFromSitemap() {
  const xml = fs.readFileSync(SITEMAP_PATH, 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (locs.length === 0) throw new Error(`在 ${SITEMAP_PATH} 中未找到 <loc> 链接`);
  return locs;
}

function push(urls) {
  return new Promise((resolve, reject) => {
    const u = new URL(ENDPOINT);
    u.searchParams.set('site', SITE);
    u.searchParams.set('token', TOKEN);
    const body = urls.join('\n');

    const req = http.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('返回非 JSON（百度通常在 token/site 不匹配时返回文本）: ' + data.slice(0, 300)));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  if (TOKEN === 'FBmcToVRmc4rqWQE' && !process.env.BAIDU_PUSH_TOKEN) {
    console.error('ℹ️  使用的是脚本内置兜底 token（来自平台页面）。建议改设环境变量 BAIDU_PUSH_TOKEN 以避免密钥入库。');
  }
  let urls;
  try {
    urls = readUrlsFromSitemap();
  } catch (e) {
    console.error('❌ 读取 sitemap 失败：', e.message);
    process.exit(1);
  }
  console.log(`📡 向百度主动推送 ${urls.length} 个 URL（site=${SITE}）`);
  urls.forEach((u, i) => console.log(`   ${i + 1}. ${u}`));

  try {
    const r = await push(urls);
    console.log('\n✅ 百度返回：');
    console.log(`   成功推送: ${r.success ?? 0}`);
    console.log(`   当日剩余配额: ${r.remain ?? '未知'}`);
    if (Array.isArray(r.not_same_site) && r.not_same_site.length)
      console.log(`   ⚠️  非本站点(已忽略): ${r.not_same_site.join(', ')}`);
    if (Array.isArray(r.not_valid) && r.not_valid.length)
      console.log(`   ⚠️  不合法URL: ${r.not_valid.join(', ')}`);
    if ((r.success ?? 0) > 0) {
      console.log('\n💡 推送成功不代表立即收录。百度对新站/无备案域名收录较慢，1–2 周后再看平台「索引量 / 流量与关键词」。');
      console.log('   建议同时在「普通收录 → sitemap」里提交 https://sunsetpredict.cloud/sitemap.xml 作为补充。');
    }
  } catch (e) {
    console.error('❌ 推送失败：', e.message);
    console.error('   检查：token 是否正确、site 是否与平台验证站点一致（含 https://）。');
    process.exit(1);
  }
})();
