const { CITY_GUIDES, RELATED, TOP_SPOTS } = require('./city-guides');

const SITE_URL = 'https://sunsetpredict.cloud';
const SITE_NAME = 'Sunset Predict';
const HOME_TITLE = '晚霞预测 - 今日火烧云概率与摄影指南 | Sunset Predict';
const HOME_DESCRIPTION = '专业提供全国 19 城（杭州西湖、上海外滩、北京故宫、香港维港、敦煌鸣沙山等）晚霞、火烧云精准预测。结合 250hPa 高空湿度与格点气象算法，为摄影师提供机位建议与参数指导。';
const REGIONAL_ORDER = [
  'beijing',
  'shenzhen',
  'guangzhou',
  'hongkong',
  'dunhuang',
  'erhai',
  'chongqing',
  'xiamen',
  'qingdao',
  'chengdu',
  'huangshan',
  'wuhan',
  'sanya',
  'xian',
  'nanjing',
  'xiapu',
  'wuxi',
];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildSpotConfig(citySpots) {
  const fixed = {
    xihu: {
      spot: 'xihu',
      spotName: '杭州西湖',
      location: '杭州 · 西湖',
      target: { lat: 30.25, lon: 120.15 },
      window: { name: '临安西方窗口' },
      bestSpot: { name: '断桥、苏堤与长桥公园' },
      image: 'xihu-sunset.webp',
    },
    waitan: {
      spot: 'waitan',
      spotName: '上海外滩',
      location: '上海 · 黄浦江',
      target: { lat: 31.24, lon: 121.49 },
      window: { name: '苏州、无锡西方窗口' },
      bestSpot: { name: '浦东滨江大道与北外滩' },
      image: 'waitan-sunset.webp',
    },
  };
  for (const [slug, config] of Object.entries(citySpots)) {
    fixed[slug] = {
      ...config,
      image: `city-${slug}.webp`,
    };
  }
  return fixed;
}

function spotPath(slug) {
  return `/spots/${slug}`;
}

function spotSlugFromPath(pathname, spotConfig) {
  const match = String(pathname).match(/^\/spots\/([a-z-]+)\/?$/);
  return match && spotConfig[match[1]] ? match[1] : null;
}

function spotDescription(config) {
  return `查看${config.spotName}今日晚霞质量分、观测成功率、日落与蓝调时刻。结合中高云、能见度和${config.window.name}，提供${config.bestSpot.name}摄影建议与相机参数。`;
}

function predictionForSpot(day, slug) {
  if (!day) return null;
  if (slug === 'xihu' || slug === 'waitan') return day[slug] || null;
  return day.spots?.find(item => item.spot === slug) || null;
}

function serializeJsonLd(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function buildStructuredData(spotConfig, slug = null) {
  const website = {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: `${SITE_URL}/`,
    name: SITE_NAME,
    alternateName: '晚霞预测',
    description: HOME_DESCRIPTION,
    inLanguage: 'zh-CN',
  };

  if (!slug) {
    const orderedSlugs = ['xihu', 'waitan', ...REGIONAL_ORDER];
    return {
      '@context': 'https://schema.org',
      '@graph': [
        website,
        {
          '@type': 'WebPage',
          '@id': `${SITE_URL}/#webpage`,
          url: `${SITE_URL}/`,
          name: HOME_TITLE,
          description: HOME_DESCRIPTION,
          isPartOf: { '@id': website['@id'] },
          inLanguage: 'zh-CN',
        },
        {
          '@type': 'ItemList',
          name: '全国晚霞摄影预测地点',
          numberOfItems: orderedSlugs.length,
          itemListElement: orderedSlugs.map((spotSlug, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: `${spotConfig[spotSlug].spotName}晚霞预测`,
            url: `${SITE_URL}${spotPath(spotSlug)}`,
          })),
        },
      ],
    };
  }

  const config = spotConfig[slug];
  const canonical = `${SITE_URL}${spotPath(slug)}`;
  const description = spotDescription(config);
  const placeId = `${canonical}#place`;
  const graph = [
    website,
    {
      '@type': 'WebPage',
      '@id': `${canonical}#webpage`,
      url: canonical,
      name: `${config.spotName}晚霞预测与摄影指南`,
      description,
      isPartOf: { '@id': website['@id'] },
      about: { '@id': placeId },
      primaryImageOfPage: `${SITE_URL}/assets/${config.image}`,
      inLanguage: 'zh-CN',
    },
    {
      '@type': 'TouristAttraction',
      '@id': placeId,
      name: config.spotName,
      description,
      image: `${SITE_URL}/assets/${config.image}`,
      geo: {
        '@type': 'GeoCoordinates',
        latitude: config.target.lat,
        longitude: config.target.lon,
      },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: '晚霞预测',
          item: `${SITE_URL}/`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: config.spotName,
          item: canonical,
        },
      ],
    },
  ];
  const topSpots = TOP_SPOTS[slug];
  if (Array.isArray(topSpots) && topSpots.length) {
    graph.push({
      '@type': 'ItemList',
      '@id': `${canonical}#top-spots`,
      name: `${config.spotName}最佳摄影机位排名`,
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      numberOfItems: topSpots.length,
      itemListElement: topSpots.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        description: item.reason,
      })),
    });
  }
  const guide = CITY_GUIDES[slug];
  if (guide && Array.isArray(guide.faq) && guide.faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      mainEntity: guide.faq.map(item => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.a,
        },
      })),
    });
  }
  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}

function verificationTags(options = {}) {
  return [
    options.googleSiteVerification
      ? `<meta name="google-site-verification" content="${escapeHtml(options.googleSiteVerification.trim())}">`
      : '',
    options.baiduSiteVerification
      ? `<meta name="baidu-site-verification" content="${escapeHtml(options.baiduSiteVerification.trim())}">`
      : '',
  ].filter(Boolean).join('\n  ');
}

function buildSeoHead(spotConfig, slug = null, options = {}) {
  const config = slug ? spotConfig[slug] : null;
  const title = config
    ? `${config.spotName}晚霞预测 - 今日火烧云概率与摄影指南 | Sunset Predict`
    : HOME_TITLE;
  const description = config ? spotDescription(config) : HOME_DESCRIPTION;
  const canonical = config ? `${SITE_URL}${spotPath(slug)}` : `${SITE_URL}/`;
  const image = config ? `${SITE_URL}/assets/${config.image}` : `${SITE_URL}/assets/xihu-sunset.webp`;
  const verification = verificationTags(options);
  return [
    '<!-- SEO_HEAD_START -->',
    '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">',
    `<meta name="description" content="${escapeHtml(description)}">`,
    '<meta name="keywords" content="晚霞预测, 火烧云预报, 日落时间, 蓝调时刻, 摄影机位, 天气摄影">',
    `<link rel="canonical" href="${canonical}">`,
    '<meta property="og:locale" content="zh_CN">',
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:alt" content="${escapeHtml(config ? `${config.spotName}晚霞摄影景观` : '杭州西湖晚霞摄影景观')}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${image}">`,
    verification,
    `<title>${escapeHtml(title)}</title>`,
    `<script id="seo-structured-data" type="application/ld+json">${serializeJsonLd(buildStructuredData(spotConfig, slug))}</script>`,
    '<!-- SEO_HEAD_END -->',
  ].filter(Boolean).join('\n  ');
}

function renderSpotLanding(spotConfig, slug, day, photos = []) {
  if (!slug) return '';
  const config = spotConfig[slug];
  const guide = CITY_GUIDES[slug];
  const prediction = predictionForSpot(day, slug);
  const hasLive = Number.isFinite(prediction?.quality) && Number.isFinite(prediction?.probability);
  const liveSummary = hasLive
    ? `今日模型质量 ${Math.round(prediction.quality)} 分，观测成功率 ${Math.round(prediction.probability)}%。`
    : '今日质量分与观测成功率正在更新。';

  // 今日晚霞概率醒目块：直接回答"XX今日晚霞概率"搜索意图
  const todayHtml = `
      <div class="spot-landing__live" role="status">
        <h3 class="spot-landing__live-title">${escapeHtml(config.spotName)}今日晚霞概率</h3>
        ${hasLive
          ? `<p class="spot-landing__live-numbers"><strong>${Math.round(prediction.probability)}%</strong> 观测成功率 · 质量分 <strong>${Math.round(prediction.quality)}</strong>/100</p>`
          : '<p class="spot-landing__live-numbers">今日数据更新中，请稍后刷新查看。</p>'}
        <p class="spot-landing__today">${escapeHtml(liveSummary)}分数由 250hPa 高空湿度、中高云量与能见度格点模型实时计算，每小时更新。</p>
      </div>`;

  // 机位 Top3 有序列表：结构化排名内容，与 JSON-LD ItemList 一一对应
  const topSpots = TOP_SPOTS[slug] || [];
  const topSpotsHtml = topSpots.length
    ? `
      <section class="spot-landing__top-spots" aria-labelledby="top-spots-title-${escapeHtml(slug)}">
        <h3 id="top-spots-title-${escapeHtml(slug)}">${escapeHtml(config.spotName)}最佳摄影机位排名</h3>
        <ol class="spot-landing__rank">
          ${topSpots.map(item => `<li><strong>${escapeHtml(item.name)}</strong> — ${escapeHtml(item.reason)}</li>`).join('\n          ')}
        </ol>
      </section>`
    : '';

  // 历史高分照片墙：来自 SQLite 反馈实拍（UGC 原创图片，服务端直出供抓取）
  const photoWallHtml = Array.isArray(photos) && photos.length
    ? `
      <section class="spot-landing__gallery" aria-labelledby="gallery-title-${escapeHtml(slug)}">
        <h3 id="gallery-title-${escapeHtml(slug)}">${escapeHtml(config.spotName)}历史高分实拍</h3>
        <div class="spot-landing__gallery-grid">
          ${photos.map(photo => `<figure class="spot-landing__gallery-item">
            <img src="${escapeHtml(photo.photoUrl)}" alt="${escapeHtml(`${config.spotName}晚霞实拍 ${photo.date}${Number.isFinite(photo.score) ? `，质量分 ${photo.score}` : ''}`)}" loading="lazy" decoding="async" width="320" height="240">
            <figcaption>${escapeHtml(photo.date)}${Number.isFinite(photo.score) ? ` · ${photo.score} 分` : ''}${photo.comment ? ` · ${escapeHtml(photo.comment.slice(0, 40))}` : ''}</figcaption>
          </figure>`).join('\n          ')}
        </div>
      </section>`
    : '';

  const guideHtml = guide ? `
      <details class="seo-guide">
        <summary>${escapeHtml(config.spotName)}摄影指南与常见问题</summary>
        <div class="seo-guide__body">
          <section class="seo-guide__section">
            <h3>地理与晚霞成因</h3>
            <p>${escapeHtml(guide.geography)}</p>
          </section>
          <section class="seo-guide__section">
            <h3>最佳机位详解</h3>
            <p>${escapeHtml(guide.bestSpot)}</p>
          </section>
          <section class="seo-guide__section">
            <h3>最佳季节与时段</h3>
            <p>${escapeHtml(guide.season)}</p>
          </section>
          <section class="seo-guide__section">
            <h3>拍摄参数与构图</h3>
            <p>${escapeHtml(guide.tips)}</p>
          </section>
          <section class="seo-guide__section">
            <h3>交通与到达</h3>
            <p>${escapeHtml(guide.transport)}</p>
          </section>
          <section class="seo-guide__section">
            <h3>常见问题</h3>
            <dl class="seo-guide__faq">
              ${guide.faq.map(item => `<dt>${escapeHtml(item.q)}</dt><dd>${escapeHtml(item.a)}</dd>`).join('')}
            </dl>
          </section>
        </div>
      </details>` : '';

  const relatedLinks = (RELATED[slug] || [])
    .map(other => {
      const name = spotConfig[other] ? spotConfig[other].spotName : other;
      return `<a href="/spots/${other}">${escapeHtml(name)}晚霞预测</a>`;
    })
    .join('');

  const relatedHtml = relatedLinks
    ? `<nav class="seo-guide__links" aria-label="相关城市晚霞预测">
        <span class="seo-guide__links-title">相关城市晚霞预测：</span>${relatedLinks}
      </nav>`
    : '';

  return `
    <section class="spot-landing glass-panel" aria-labelledby="spot-landing-title">
      <span class="spot-landing__eyebrow">Local sunset forecast</span>
      <h2 id="spot-landing-title">${escapeHtml(config.spotName)}晚霞预测与摄影指南</h2>
      <p>${escapeHtml(spotDescription(config))}</p>
      ${todayHtml}
      ${topSpotsHtml}
      ${photoWallHtml}
      <a href="/">查看全国 19 个晚霞摄影站</a>
      ${guideHtml}
      ${relatedHtml}
    </section>`;
}

function renderRegionalFallbackCards(citySpots) {
  return REGIONAL_ORDER.map(slug => {
    const spot = citySpots[slug];
    return `
        <a
          class="city-card city-card--${slug}"
          id="city-${slug}"
          data-spot="${slug}"
          href="${spotPath(slug)}"
          aria-expanded="false"
          aria-controls="detail-panel"
          aria-label="${escapeHtml(spot.spotName)}晚霞预测，点击展开摄影指南"
        >
          <img class="city-card__image" src="/assets/city-${slug}.webp?v=20260726-city-images-v11" alt="${escapeHtml(spot.spotName)}标志性晚霞摄影景观" loading="lazy" decoding="async">
          <div class="city-card__content">
            <div class="city-card__top">
              <p class="city-card__city">${escapeHtml(spot.location)}</p>
              <h3 class="city-card__name">${escapeHtml(spot.spotName)}</h3>
              <span class="city-card__weather weather-badge unknown">天气更新中</span>
              <span class="city-card__chance probability-pill"><i data-lucide="shield" aria-hidden="true"></i><span>几率：--</span></span>
            </div>
            <div class="city-card__prediction">
              <div class="city-card__score-row"><span class="city-card__score">--</span><span class="city-card__unit">/ 100</span></div>
              <div class="city-card__grade">连接实时模型</div>
              <div class="city-card__blue-hour" hidden><i data-lucide="moon-star" aria-hidden="true"></i><span>蓝调 --:--–--:--</span></div>
              <div class="city-card__progress"><span></span></div>
            </div>
            <div class="city-card__footer">
              <span class="city-card__spot"><i data-lucide="map-pin" aria-hidden="true"></i>${escapeHtml(spot.hook)}</span>
              <span class="city-card__status">试运行</span>
            </div>
          </div>
        </a>`;
  }).join('');
}

function injectSeoDocument(html, { citySpots, slug = null, day = null, photos = [], ...options }) {
  const spotConfig = buildSpotConfig(citySpots);
  return html
    .replace(/<!-- SEO_HEAD_START -->[\s\S]*?<!-- SEO_HEAD_END -->/, buildSeoHead(spotConfig, slug, options))
    .replace('<!-- SPOT_LANDING -->', renderSpotLanding(spotConfig, slug, day, photos))
    .replace(
      '<div class="city-grid" id="regional-grid" aria-live="polite"></div>',
      `<div class="city-grid" id="regional-grid" aria-live="polite">${renderRegionalFallbackCards(citySpots)}\n      </div>`,
    );
}

module.exports = {
  HOME_DESCRIPTION,
  HOME_TITLE,
  REGIONAL_ORDER,
  SITE_URL,
  buildSeoHead,
  buildSpotConfig,
  buildStructuredData,
  injectSeoDocument,
  renderRegionalFallbackCards,
  renderSpotLanding,
  spotPath,
  spotSlugFromPath,
};
