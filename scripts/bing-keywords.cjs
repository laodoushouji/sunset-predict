#!/usr/bin/env node
/**
 * 拉取必应站长平台（Bing Webmaster Tools）数据，解搜索流量归因。
 *
 * 使用前：
 *   1. 登录 https://bing.com/webmasters/home （Microsoft 账号）
 *   2. 添加并验证站点 sunsetpredict.cloud（如未验证）
 *   3. ⚙️ 设置 → 复制 API Key
 *   4. 运行：BING_WMC_KEY="你的key" node scripts/bing-keywords.cjs
 *
 * 注意：Bing 数据延迟 1-3 天，当天的数据通常要 2-3 天后才完整。
 *
 * 正确的 API endpoint（2025 验证通过）：
 *   https://ssl.bing.com/webmaster/api.svc/json/{Method}?apikey=KEY&siteUrl=URL
 * 不是 api.bing.com/webmaster/v3.0/...（那是 404 的旧路径）。
 */
'use strict';

const https = require('https');
const { URL } = require('url');

const API_KEY = process.env.BING_WMC_KEY;
const SITE_URL = process.env.BING_WMC_SITE || 'https://sunsetpredict.cloud';

if (!API_KEY) {
  console.error('❌ 缺少 BING_WMC_KEY。');
  console.error('   去 https://bing.com/webmasters/home → ⚙️ 设置 → 复制 API Key');
  console.error('   然后运行: BING_WMC_KEY="xxxx" node scripts/bing-keywords.cjs');
  process.exit(1);
}

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json';

function fetchJson(method, params = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${BASE}/${method}`);
    u.searchParams.set('apikey', API_KEY);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { Accept: 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          const json = JSON.parse(body);
          if (json.ErrorCode !== undefined && json.ErrorCode !== 0) {
            reject(new Error(`Bing ErrorCode ${json.ErrorCode}: ${json.ErrorMessage || ''}`));
            return;
          }
          resolve(json.d || []);
        } catch { reject(new Error('返回非 JSON: ' + body.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

// 解析 .NET JSON 日期格式 /Date(1785481200000-0700)/
function parseDotNetDate(s) {
  if (!s) return '';
  const m = String(s).match(/\/Date\((\d+)/);
  return m ? new Date(parseInt(m[1], 10)).toISOString().slice(0, 10) : '';
}

(async () => {
  console.log(`📡 Bing Webmaster Tools 数据拉取`);
  console.log(`   站点: ${SITE_URL}\n`);

  // 1) 验证站点
  let sites;
  try {
    sites = await fetchJson('GetUserSites');
  } catch (e) {
    console.error('❌ API Key 无效或网络错误:', e.message);
    process.exit(1);
  }
  const mySite = sites.find((s) => s.Url && s.Url.replace(/\/$/, '') === SITE_URL.replace(/\/$/, ''));
  if (mySite) {
    console.log(`✅ 站点已验证: ${mySite.Url} (IsVerified: ${mySite.IsVerified})\n`);
  } else {
    console.log(`⚠️ 该账号下未找到 ${SITE_URL}，已注册站点:`);
    sites.forEach((s) => console.log(`   ${s.Url} (verified: ${s.IsVerified})`));
    console.log('');
  }

  // 2) 整体排名流量趋势
  console.log('═══ 整体搜索流量趋势 (GetRankAndTrafficStats) ═══');
  try {
    const trend = await fetchJson('GetRankAndTrafficStats', { siteUrl: SITE_URL });
    if (trend.length === 0) {
      console.log('   （暂无数据，站点可能刚验证）');
    } else {
      trend.sort((a, b) => parseDotNetDate(a.Date) < parseDotNetDate(b.Date) ? -1 : 1);
      console.log('   日期        展现   点击');
      trend.forEach((t) => {
        console.log(`   ${parseDotNetDate(t.Date)}  ${String(t.Impressions).padStart(5)}   ${String(t.Clicks).padStart(4)}`);
      });
      const ti = trend.reduce((s, t) => s + t.Impressions, 0);
      const tc = trend.reduce((s, t) => s + t.Clicks, 0);
      console.log(`   ────────────────────────`);
      console.log(`   合计        ${String(ti).padStart(5)}   ${String(tc).padStart(4)}  (CTR ${(tc / ti * 100).toFixed(1)}%)`);
    }
  } catch (e) { console.error('   拉取失败:', e.message); }
  console.log('');

  // 3) 收录页面
  console.log('═══ Bing 收录页面 (GetPageStats) ═══');
  try {
    const pages = await fetchJson('GetPageStats', { siteUrl: SITE_URL });
    console.log(`   收录页面数: ${pages.length}`);
    pages.sort((a, b) => b.Impressions - a.Impressions)
      .slice(0, 20)
      .forEach((p) => {
        console.log(`   ${String(p.Impressions).padStart(5)} 展现  ${String(p.Clicks).padStart(3)} 点击  ${p.Query}`);
      });
  } catch (e) { console.error('   拉取失败:', e.message); }
  console.log('');

  // 4) 关键词统计
  console.log('═══ 搜索关键词 (GetQueryStats) ═══');
  let queries = [];
  try {
    queries = await fetchJson('GetQueryStats', { siteUrl: SITE_URL });
  } catch (e) {
    console.error('   拉取失败:', e.message);
    process.exit(1);
  }

  if (queries.length === 0) {
    console.log('   ⚠️ 暂无关键词数据（站点刚验证或数据延迟）');
    process.exit(0);
  }

  const sorted = queries
    .map((q) => ({
      keyword: q.Query || '?',
      impressions: q.Impressions || 0,
      clicks: q.Clicks || 0,
      avgPos: q.AvgImpressionPosition || 0,
      date: parseDotNetDate(q.Date),
    }))
    .sort((a, b) => b.impressions - a.impressions);

  console.log(`   展现  点击  展位  日期        关键词`);
  sorted.forEach((q) => {
    console.log(`   ${String(q.impressions).padStart(4)}   ${String(q.clicks).padStart(3)}   ${String(q.avgPos).padStart(4)}  ${q.date.padEnd(12)} ${q.keyword}`);
  });

  const totalImp = sorted.reduce((s, q) => s + q.impressions, 0);
  const totalClicks = sorted.reduce((s, q) => s + q.clicks, 0);
  console.log(`   ────────────────────────────`);
  console.log(`   合计 ${totalImp} 展现 / ${totalClicks} 点击 / CTR ${(totalClicks / totalImp * 100).toFixed(1)}%`);

  // 按日期聚合
  const byDate = {};
  sorted.forEach((q) => {
    byDate[q.date] = byDate[q.date] || { imp: 0, clk: 0 };
    byDate[q.date].imp += q.impressions;
    byDate[q.date].clk += q.clicks;
  });
  console.log(`\n   按日期聚合:`);
  Object.entries(byDate).sort().forEach(([dt, v]) => {
    console.log(`   ${dt}  ${v.imp} 展现 / ${v.clk} 点击`);
  });

  // 哪些词排进前 5 但 CTR 低（优化机会）
  const opportunities = sorted.filter((q) => q.avgPos > 0 && q.avgPos <= 5 && q.clicks === 0);
  if (opportunities.length > 0) {
    console.log(`\n🎯 排名前 5 但零点击（标题/描述优化机会）:`);
    opportunities.forEach((q) => console.log(`   排位${q.avgPos}  "${q.keyword}"  (${q.impressions}展现)`));
  }

  console.log(`\n💡 数据延迟提示：Bing 站长数据通常滞后 1-3 天，`);
  console.log(`   今天（${new Date().toISOString().slice(0, 10)}）的数据要几天后才完整。`);
})();
