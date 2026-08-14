// 构建时生成 frontend/sitemap.xml，补上 <lastmod> 让爬虫判断新鲜度。
// 数据源与线上渲染一致：buildSpotConfig(CITY_SPOTS) 即 19 城 slug。
const fs = require('fs');
const path = require('path');
const { CITY_SPOTS, PROVINCE_SPOTS } = require('../worker/src/services/cities');
const { buildSpotConfig } = require('../worker/src/services/seo');

const SITE_URL = 'https://sunsetpredict.cloud';
const spotConfig = buildSpotConfig(CITY_SPOTS, PROVINCE_SPOTS);
const slugs = Object.keys(spotConfig); // 19 城
const lastmod = new Date().toISOString().slice(0, 10);

const url = (loc, priority) =>
  `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${priority}</priority>\n  </url>`;

const urls = [url(`${SITE_URL}/`, '1.0')]
  .concat(
    slugs.map(s => url(`${SITE_URL}/spots/${s}`, s === 'xihu' || s === 'waitan' ? '0.9' : (PROVINCE_SPOTS[s] ? '0.7' : '0.8')))
  )
  .join('\n');

const xml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

const out = path.resolve(__dirname, '../frontend/sitemap.xml');
fs.writeFileSync(out, xml);
console.log(`sitemap.xml 已生成：${slugs.length + 1} 条 URL，lastmod=${lastmod}`);
