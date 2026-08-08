const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CITY_SPOTS } = require('../src/services/cities');
const { CITY_GUIDES, TOP_SPOTS } = require('../src/services/city-guides');
const {
  REGIONAL_ORDER,
  buildSeoHead,
  buildSpotConfig,
  injectSeoDocument,
  spotSlugFromPath,
} = require('../src/services/seo');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'frontend/sitemap.xml'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8');
const spotConfig = buildSpotConfig(CITY_SPOTS);

test('首页输出 canonical、社交摘要与 19 个地点结构化列表', () => {
  const head = buildSeoHead(spotConfig);
  assert.match(head, /rel="canonical" href="https:\/\/sunsetpredict\.cloud\/"/);
  assert.match(head, /max-image-preview:large/);
  assert.match(head, /property="og:image"/);
  const json = JSON.parse(head.match(/type="application\/ld\+json">(.+)<\/script>/)[1]);
  const list = json['@graph'].find(item => item['@type'] === 'ItemList');
  assert.equal(list.numberOfItems, 19);
  assert.equal(list.itemListElement[0].url, 'https://sunsetpredict.cloud/spots/xihu');
});

test('地点页拥有唯一标题、canonical、正文与安全的站长验证标签', () => {
  const output = injectSeoDocument(html, {
    citySpots: CITY_SPOTS,
    slug: 'hongkong',
    day: {
      spots: [{ spot: 'hongkong', quality: 68, probability: 72 }],
    },
    googleSiteVerification: 'google-token',
    baiduSiteVerification: 'baidu-token',
  });
  assert.match(output, /<title>香港维多利亚港晚霞预测/);
  assert.match(output, /rel="canonical" href="https:\/\/sunsetpredict\.cloud\/spots\/hongkong"/);
  assert.match(output, /name="google-site-verification" content="google-token"/);
  assert.match(output, /name="baidu-site-verification" content="baidu-token"/);
  assert.match(output, /香港维多利亚港晚霞预测与摄影指南/);
  assert.match(output, /今日模型质量 68 分，观测成功率 72%/);
});

test('服务端首屏直接输出全国站点链接，前端仍使用原双列卡片', () => {
  const output = injectSeoDocument(html, { citySpots: CITY_SPOTS });
  assert.equal((output.match(/class="city-card city-card--/g) || []).length, 17);
  for (const slug of REGIONAL_ORDER) {
    assert.match(output, new RegExp(`href="/spots/${slug}"`));
  }
  assert.match(app, /function detailSpotFromPath/);
  assert.match(app, /href="\/spots\/\$\{spot\.slug\}"/);
});

test('地点路径只接受已开通站点', () => {
  assert.equal(spotSlugFromPath('/spots/xihu', spotConfig), 'xihu');
  assert.equal(spotSlugFromPath('/spots/hongkong/', spotConfig), 'hongkong');
  assert.equal(spotSlugFromPath('/spots/unknown', spotConfig), null);
});

test('19 个站点均有机位 Top3 结构化内容且与指南城市一一对应', () => {
  const slugs = Object.keys(CITY_GUIDES);
  assert.equal(slugs.length, 19);
  for (const slug of slugs) {
    const spots = TOP_SPOTS[slug];
    assert.ok(Array.isArray(spots) && spots.length === 3, `${slug} 应有 3 个机位`);
    for (const item of spots) {
      assert.ok(item.name && item.reason, `${slug} 机位需含 name 与 reason`);
    }
  }
});

test('地点页输出今日概率块、机位排名列表与 ItemList JSON-LD', () => {
  const output = injectSeoDocument(html, {
    citySpots: CITY_SPOTS,
    slug: 'xihu',
    day: { xihu: { quality: 81, probability: 66 } },
  });
  assert.match(output, /杭州西湖今日晚霞概率/);
  assert.match(output, /<strong>66%<\/strong> 观测成功率/);
  assert.match(output, /杭州西湖最佳摄影机位排名/);
  assert.match(output, /<ol class="spot-landing__rank">/);
  assert.match(output, /苏堤跨虹桥/);
  const json = JSON.parse(output.match(/id="seo-structured-data" type="application\/ld\+json">(.+?)<\/script>/)[1]);
  const rankList = json['@graph'].find(
    item => item['@type'] === 'ItemList' && String(item['@id'] || '').includes('#top-spots'),
  );
  assert.equal(rankList.numberOfItems, 3);
  assert.equal(rankList.itemListElement[0].name, '苏堤跨虹桥');
});

test('地点页照片墙渲染 SQLite 高分实拍，无照片时不输出该区块', () => {
  const photos = [
    {
      photoUrl: '/api/feedback/photo/2026-07-20/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
      comment: '火烧云爆了',
      date: '2026-07-20',
      score: 88,
    },
  ];
  const withPhotos = injectSeoDocument(html, { citySpots: CITY_SPOTS, slug: 'xihu', photos });
  assert.match(withPhotos, /杭州西湖历史高分实拍/);
  assert.match(withPhotos, /alt="杭州西湖晚霞实拍 2026-07-20，质量分 88"/);
  assert.match(withPhotos, /loading="lazy"/);
  assert.match(withPhotos, /2026-07-20 · 88 分 · 火烧云爆了/);

  const withoutPhotos = injectSeoDocument(html, { citySpots: CITY_SPOTS, slug: 'xihu' });
  assert.doesNotMatch(withoutPhotos, /历史高分实拍/);
});

test('站点地图只提交首页与 19 个 canonical 地点页', () => {
  assert.equal((sitemap.match(/<loc>/g) || []).length, 20);
  assert.doesNotMatch(sitemap, /\/credits<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/sunsetpredict\.cloud\/spots\/xihu<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/sunsetpredict\.cloud\/spots\/dunhuang<\/loc>/);
});
