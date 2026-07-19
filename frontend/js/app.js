/**
 * Sunset Predict — Frontend App v2
 * API fetch → render → interactions
 */

const API_URL = '/sunset?v=20260717-quality-probability-v1';
const WAITAN_API_URL = '/api/spot/waitan?v=20260717-quality-probability-v1';
const REGIONAL_API_URL = '/api/spots?v=20260717-quality-probability-v1';
const TIMELINE_API_URL = '/api/timeline?v=20260717-quality-probability-v1';
const FEEDBACK_API_URL = '/api/feedback';
let detailOpen = false;
let activeDetailSpot = null;
let currentData = null;
let waitanData = null;
const regionalData = new Map();
const scoreAnimations = new WeakMap();
let timelineDays = [];
let timelineToday = null;
let selectedDayIndex = 0;
let suppressClickUntil = 0;
let advertiserData = window.advertiserData || null;
let ephemeralFeedbackClientId = null;
let blueHourTimer = null;
let blueHourThemeTimer = null;
let sharePosterPromise = null;
let sharePosterKey = '';
let sharePosterFile = null;
let sharePosterUrl = '';
const feedbackDraft = {
  spot: null,
  date: null,
  data: null,
  open: false,
  reason: '',
  observed: null,
  actualQuality: null,
  submitted: false,
  submitting: false,
  error: '',
};
const FEEDBACK_QUALITY_LABELS = new Map([
  [20, '平淡'], [40, '微霞'], [60, '不错'], [80, '很棒'], [95, '爆燃'],
]);

async function fetchApi(url, timeoutMs) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await response.arrayBuffer().catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
    }
  }
  throw lastError;
}

const REGIONAL_SPOTS = [
  { slug: 'beijing', city: '北京 · Beijing', name: '景山 / 故宫', hook: '故宫全景烧霞预警' },
  { slug: 'erhai', city: '大理 · Dali', name: '洱海', hook: '龙龛码头机位建议' },
  { slug: 'chongqing', city: '重庆 · Chongqing', name: '来福士 / 南山', hook: '千厮门亮灯同步' },
  { slug: 'xiamen', city: '厦门 · Xiamen', name: '黄厝沙滩', hook: '环岛路落日点位' },
  { slug: 'qingdao', city: '青岛 · Qingdao', name: '栈桥 / 五四广场', hook: '回澜阁绝美日落' },
  { slug: 'chengdu', city: '成都 · Chengdu', name: '金融城双塔', hook: '双塔反光点预报' },
  { slug: 'shenzhen', city: '深圳 · Shenzhen', name: '人才公园 / 深圳湾', hook: '后海蓝调预警' },
  { slug: 'huangshan', city: '黄山 · Huangshan', name: '光明顶', hook: '云海 + 落日预测' },
];

const DETAIL_SPOTS = {
  xihu: { cardId: 'card-xihu', name: '杭州西湖', nameEn: 'Xihu' },
  waitan: { cardId: 'card-bund', name: '上海外滩', nameEn: 'The Bund' },
  ...Object.fromEntries(REGIONAL_SPOTS.map(spot => [spot.slug, {
    cardId: `city-${spot.slug}`,
    name: spot.name,
    nameEn: spot.city.split('·')[1]?.trim() || spot.slug,
  }])),
};

const UMAMI_EVENTS = new Set([
  'detail-open',
  'date-change',
  'feedback-submit',
  'support-open',
  'partner-open',
]);

function trackUmamiEvent(eventName, spot = 'all') {
  if (!UMAMI_EVENTS.has(eventName) || typeof window.umami?.track !== 'function') return;
  const safeSpot = spot === 'all' || Object.prototype.hasOwnProperty.call(DETAIL_SPOTS, spot) ? spot : 'all';
  window.umami.track(eventName, { spot: safeSpot });
}

const SCENIC_CAPTIONS = {
  xihu: {
    high: '湖面铺霞 · 浮光映红 · 西山染金',
    observable: '湖上落日 · 暮色清波 · 天水澄明',
    blocked: '西山云墙 · 霞光藏于山后',
  },
  waitan: {
    high: '城市燃霞 · 楼宇鎏金 · 浦江映红',
    observable: '清透天际线 · 金色落日 · 蓝调城市',
    blocked: '西方云墙 · 金光难以穿城',
  },
  beijing: {
    high: '宫阙披金 · 红墙映霞 · 紫禁暮色',
    observable: '长空澄澈 · 宫城落日 · 金瓦余晖',
    blocked: '西山云幕 · 紫禁城霞光隐没',
  },
  erhai: {
    high: '苍山燃霞 · 橘海浮光 · 天水染红',
    observable: '洱海落日 · 苍山剪影 · 湖面熔金',
    blocked: '苍山云墙 · 霞光被群峰截断',
  },
  chongqing: {
    high: '霞光穿城 · 两江映红 · 山城燃霞',
    observable: '江上落日 · 城市蓝调 · 暮色点灯',
    blocked: '雾幕锁城 · 霞光隐入江雾',
  },
  xiamen: {
    high: '橘海翻涌 · 海天燃霞 · 金光铺海',
    observable: '温柔橘海 · 清透海面 · 日落成诗',
    blocked: '海雾漫岸 · 霞光沉入云层',
  },
  qingdao: {
    high: '海天染霞 · 城市映红 · 金光漫岸',
    observable: '海上落日 · 长空清澈 · 蓝调将临',
    blocked: '海雾遮光 · 晚霞隐于海云',
  },
  chengdu: {
    high: '霞光穿盆地 · 双塔鎏金 · 西山映红',
    observable: '城市落日 · 双塔剪影 · 暮色温柔',
    blocked: '盆地云幕 · 西方光路闭合',
  },
  shenzhen: {
    high: '湾区燃霞 · 楼宇鎏金 · 海面映红',
    observable: '清透湾区 · 摩天楼落日 · 蓝调城市',
    blocked: '海雾锁湾 · 金光难抵楼群',
  },
  huangshan: {
    high: '云海流金 · 群峰浴霞 · 霞落云巅',
    observable: '峰顶落日 · 长空澄澈 · 群山剪影',
    blocked: '身在雾中 · 云幕封山 · 霞光无从抵达',
  },
};

// ============================================
// Grade tiers
// ============================================
const GRADE_MAP = [
  { min: 85, key: 'fire',   label: '绝美', en: 'Fire' },
  { min: 60, key: 'orange', label: '很棒', en: 'Great' },
  { min: 30, key: 'purple', label: '不错', en: 'Good' },
  { min: 1,  key: 'blue',   label: '平淡', en: 'Clear' },
  { min: 0,  key: 'blue',   label: '无望', en: 'None' },
];

const SCORE_COLOR_CLASSES = [...new Set(GRADE_MAP.map(grade => grade.key))];

function getGrade(score) {
  return GRADE_MAP.find(g => score >= g.min) || GRADE_MAP[GRADE_MAP.length - 1];
}

function getScenicCaption(spotId, score, probability) {
  const captions = SCENIC_CAPTIONS[spotId];
  if (!captions) return getGrade(score).label;
  const probabilityValue = Number(probability);
  if (Number.isFinite(probabilityValue) && probabilityValue < 60) return captions.blocked;
  return Number(score) >= 60 ? captions.high : captions.observable;
}

function applyScoreColor(score, elements, glow = null) {
  const grade = getGrade(score);
  elements.filter(Boolean).forEach(element => {
    element.classList.remove(...SCORE_COLOR_CLASSES);
    element.classList.add(grade.key);
  });
  if (glow) glow.classList.toggle('is-pulsing', score > 85);
  return grade;
}

function probabilityTier(probability) {
  if (probability >= 80) return { key: 'high', short: '高', label: '极易观测' };
  if (probability >= 60) return { key: 'medium', short: '中高', label: '较易观测' };
  if (probability >= 30) return { key: 'uncertain', short: '中', label: '存在变数' };
  return { key: 'low', short: '低', label: '光线可能受阻' };
}

function renderProbability(element, data, compact = false) {
  if (!element) return;
  const rawProbability = Number(data?.probability);
  element.classList.remove('high', 'medium', 'uncertain', 'low');
  if (!Number.isFinite(rawProbability)) {
    const textElement = element.querySelector('span');
    if (textElement) textElement.textContent = compact ? '几率：--' : '观测成功率 --';
    return;
  }
  const probability = Math.max(0, Math.min(100, rawProbability));
  const tier = probabilityTier(probability);
  element.classList.add(tier.key);
  const text = compact
    ? `几率：${tier.short} · ${probability}%`
    : `观测成功率 ${probability}% · ${data?.probabilityLabel || tier.label}`;
  const textElement = element.querySelector('span');
  if (textElement) textElement.textContent = text;
  else element.textContent = text;
}

const WEATHER_CLASSES = [
  'clear', 'cloudy', 'overcast', 'fog', 'rain-light', 'rain-medium', 'rain-heavy',
  'snow-light', 'snow-medium', 'snow-heavy', 'thunder', 'unknown',
];

function renderWeatherBadge(element, data) {
  if (!element) return;
  const weather = data?.weather || {};
  const kind = WEATHER_CLASSES.includes(weather.kind) ? weather.kind : 'unknown';
  element.classList.remove(...WEATHER_CLASSES);
  element.classList.add('weather-badge', kind);
  element.textContent = weather.label || '天气待更新';
  const details = [];
  if (weather.precipitationRateMmH !== null && weather.precipitationRateMmH !== undefined && Number.isFinite(Number(weather.precipitationRateMmH))) {
    details.push(`${Number(weather.precipitationRateMmH).toFixed(1)} mm/h`);
  }
  if (weather.precipitationProbability !== null && weather.precipitationProbability !== undefined && Number.isFinite(Number(weather.precipitationProbability))) {
    details.push(`降水概率 ${Math.round(Number(weather.precipitationProbability))}%`);
  }
  element.title = details.length ? `${element.textContent} · ${details.join(' · ')}` : element.textContent;
}

function renderWeatherDetails(data) {
  const weather = data?.weather || {};
  const label = weather.label || '天气数据不足';
  const rate = weather.precipitationRateMmH === null || weather.precipitationRateMmH === undefined
    ? NaN
    : Number(weather.precipitationRateMmH);
  const probability = weather.precipitationProbability === null || weather.precipitationProbability === undefined
    ? NaN
    : Number(weather.precipitationProbability);
  document.getElementById('weather-condition').textContent = label;
  document.getElementById('weather-precipitation').textContent = [
    Number.isFinite(rate) ? `${rate.toFixed(1)} mm/h` : null,
    Number.isFinite(probability) ? `降水概率 ${Math.round(probability)}%` : null,
  ].filter(Boolean).join(' · ') || (weather.isPrecipitating ? '降水强度待更新' : '当前无降水');
}

function applyObservationState(card, score, probability) {
  if (!Number.isFinite(Number(probability))) {
    card.classList.remove('is-blocked', 'is-burning');
    return;
  }
  probability = Number(probability);
  card.classList.toggle('is-blocked', probability < 30);
  card.classList.toggle('is-burning', score >= 60 && probability >= 70);
}

function getDayOfYear(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const current = Date.UTC(year, month - 1, day);
  const start = Date.UTC(year, 0, 0);
  return Math.floor((current - start) / 86400000);
}

function calculateSunsetAzimuth(dateString, latitude = 30.25) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || '')) return null;
  const dayOfYear = getDayOfYear(dateString);
  const radians = Math.PI / 180;
  const declination = 23.44 * Math.sin((2 * Math.PI / 365) * (284 + dayOfYear));
  const ratio = Math.sin(declination * radians) / Math.cos(latitude * radians);
  const sunsetAzimuth = 360 - Math.acos(Math.max(-1, Math.min(1, ratio))) / radians;
  return Math.round(sunsetAzimuth * 10) / 10;
}

function getDynamicBestSpot(dateString) {
  const azimuth = calculateSunsetAzimuth(dateString);
  if (azimuth === null) return null;
  if (azimuth > 290) return { label: '断桥残雪 · 北向视角', azimuth };
  if (azimuth > 275) return { label: '苏堤春晓 · 西北向视角', azimuth };
  if (azimuth > 260) return { label: '雷峰夕照 · 西向视角', azimuth };
  return { label: '长桥公园 · 西南向视角', azimuth };
}

// Confidence display
const CONF_MAP = {
  high:   '高 — 多源模型一致',
  medium: '中 — 模型间有分歧',
  low:    '低 — 分歧较大',
};

// ============================================
// Init
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  renderRegionalCards();
  lucide.createIcons();
  bindEvents();
  fetchTimeline().finally(() => requestAnimationFrame(openDetailFromHash));
});

// ============================================
// Event bindings
// ============================================
function bindEvents() {
  const xihuCard = document.getElementById('card-xihu');
  xihuCard.addEventListener('click', () => openDetail('xihu'));
  xihuCard.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDetail('xihu');
    }
  });

  document.getElementById('detail-overlay').addEventListener('click', () => closeDetail());
  document.getElementById('detail-close').addEventListener('click', () => closeDetail());
  document.getElementById('detail-share').addEventListener('click', openSharePoster);
  bindDetailDrag();
  window.addEventListener('hashchange', () => {
    const spotId = detailSpotFromHash();
    if (spotId) openDetail(spotId, { updateUrl: false, focus: false });
    else if (detailOpen) closeDetail({ updateUrl: false, focus: false });
  });

  const bundCard = document.getElementById('card-bund');
  bundCard.addEventListener('click', () => openDetail('waitan'));
  bundCard.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDetail('waitan');
    }
  });

  document.querySelectorAll('[data-feedback-observed]').forEach(button => {
    button.addEventListener('click', () => selectFeedbackObserved(button.dataset.feedbackObserved === 'true'));
  });
  document.querySelectorAll('[data-feedback-quality]').forEach(button => {
    button.addEventListener('click', () => selectFeedbackQuality(Number(button.dataset.feedbackQuality)));
  });
  document.getElementById('feedback-submit').addEventListener('click', submitObservationFeedback);

  const supportOpen = document.getElementById('wechat-support-open');
  const supportModal = document.getElementById('wechat-support-modal');
  const supportCloseButtons = supportModal.querySelectorAll('[data-support-close]');
  const partnerOpen = document.getElementById('partner-card-open');
  const partnerModal = document.getElementById('partner-modal');
  const partnerCloseButtons = partnerModal.querySelectorAll('[data-partner-close]');
  const shareModal = document.getElementById('share-poster-modal');
  const shareCloseButtons = shareModal.querySelectorAll('[data-share-close]');
  let supportTrigger = null;
  let partnerTrigger = null;

  const closeSupportModal = () => {
    supportModal.hidden = true;
    document.body.classList.remove('modal-open');
    supportTrigger?.focus();
  };

  supportOpen.addEventListener('click', () => {
    trackUmamiEvent('support-open');
    supportTrigger = document.activeElement;
    supportModal.hidden = false;
    document.body.classList.add('modal-open');
    supportModal.querySelector('.support-modal__close').focus();
  });
  supportCloseButtons.forEach(button => button.addEventListener('click', closeSupportModal));

  const closePartnerModal = () => {
    partnerModal.hidden = true;
    document.body.classList.remove('modal-open');
    partnerTrigger?.focus();
  };

  partnerOpen.addEventListener('click', () => {
    trackUmamiEvent('partner-open', activeDetailSpot);
    partnerTrigger = document.activeElement;
    partnerModal.hidden = false;
    document.body.classList.add('modal-open');
    partnerModal.querySelector('.support-modal__close').focus();
  });
  partnerCloseButtons.forEach(button => button.addEventListener('click', closePartnerModal));

  const closeShareModal = () => {
    shareModal.hidden = true;
    document.body.classList.remove('modal-open');
    document.getElementById('detail-share').focus();
  };

  shareCloseButtons.forEach(button => button.addEventListener('click', closeShareModal));
  document.getElementById('share-system-button').addEventListener('click', sharePreparedPoster);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !shareModal.hidden) closeShareModal();
    else if (event.key === 'Escape' && !partnerModal.hidden) closePartnerModal();
    else if (event.key === 'Escape' && !supportModal.hidden) closeSupportModal();
    else if (event.key === 'Escape' && detailOpen) closeDetail();
  });

  document.querySelectorAll('.city-card').forEach(card => {
    const openCityDetail = () => openDetail(card.dataset.spot);
    card.addEventListener('click', openCityDetail);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCityDetail();
      }
    });
  });

  document.getElementById('day-previous').addEventListener('click', () => changeDay(-1));
  document.getElementById('day-next').addEventListener('click', () => changeDay(1));
  bindSwipeNavigation();
}

function bindSwipeNavigation() {
  let startX = null;
  let startY = null;
  let startedAt = 0;

  const startSwipe = event => {
    if (event.isPrimary === false || document.body.classList.contains('modal-open')) return;
    if (event.clientX < 24 || event.clientX > window.innerWidth - 24) return;
    startX = event.clientX;
    startY = event.clientY;
    startedAt = Date.now();
  };

  const finishSwipe = event => {
    if (startX === null || event.isPrimary === false) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const duration = Date.now() - startedAt;
    startX = null;
    startY = null;
    if (duration > 900 || Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    suppressClickUntil = Date.now() + 450;
    changeDay(deltaX > 0 ? 1 : -1);
  };

  document.addEventListener('pointerdown', startSwipe, { passive: true });
  document.addEventListener('pointerup', finishSwipe, { passive: true });
  document.addEventListener('mousedown', startSwipe, { passive: true });
  document.addEventListener('mouseup', finishSwipe, { passive: true });
  document.addEventListener('touchstart', event => {
    if (event.touches.length === 1) startSwipe(event.touches[0]);
  }, { passive: true });
  document.addEventListener('touchend', event => {
    if (event.changedTouches.length) finishSwipe(event.changedTouches[0]);
  }, { passive: true });

  document.addEventListener('pointercancel', () => {
    startX = null;
    startY = null;
  }, { passive: true });

  document.addEventListener('click', event => {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

function relativeDayLabel(offset) {
  return ({ '-1': '昨天', 0: '今天', 1: '明天', 2: '后天' })[offset] || `${offset > 0 ? '+' : ''}${offset} 天`;
}

function formatShortDate(date) {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日`;
}

function timelineOffsetForDate(date) {
  if (!timelineToday || !date) return null;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${timelineToday}T00:00:00Z`)) / 86400000);
}

function updateDayNavigation(day) {
  const label = relativeDayLabel(day.offset);
  document.getElementById('day-label').textContent = label;
  document.getElementById('day-date').textContent = formatShortDate(day.date);
  document.getElementById('day-state').textContent = day.recorded ? '已保存预测' : day.offset === 0 ? '实时预测' : '未来预测';
  document.getElementById('hero-day-title').textContent = `${label}的天空，`;
  document.getElementById('day-previous').disabled = selectedDayIndex === 0;
  document.getElementById('day-next').disabled = selectedDayIndex === timelineDays.length - 1;
}

function renderTimelineDay(day, direction = null) {
  if (!day?.xihu || !day?.waitan) return;
  currentData = day.xihu;
  waitanData = day.waitan;
  regionalData.clear();
  renderToday(day.xihu);
  renderWaitan(day.waitan);
  (day.spots || []).forEach(renderRegionalSpot);
  updateTime(day.capturedAt);
  updateDayNavigation(day);

  if (direction) {
    const shell = document.querySelector('.page-shell');
    shell.classList.remove('day-shift-next', 'day-shift-previous');
    void shell.offsetWidth;
    shell.classList.add(direction > 0 ? 'day-shift-next' : 'day-shift-previous');
  }
}

function changeDay(direction) {
  const nextIndex = selectedDayIndex + direction;
  if (nextIndex < 0) {
    showToast('昨日记录将在服务器保存满一天后出现');
    return;
  }
  if (nextIndex >= timelineDays.length) {
    showToast('更远日期的模型数据尚未开放');
    return;
  }
  selectedDayIndex = nextIndex;
  renderTimelineDay(timelineDays[selectedDayIndex], direction);
  trackUmamiEvent('date-change');
}

async function fetchTimeline() {
  if (window.location.protocol === 'file:') {
    renderDemo();
    return;
  }

  try {
    const response = await fetchApi(TIMELINE_API_URL, 30000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const timeline = await response.json();
    timelineDays = timeline.days || [];
    timelineToday = timeline.today;
    selectedDayIndex = Math.max(0, timelineDays.findIndex(day => day.offset === 0));
    if (!timelineDays.length) throw new Error('时间线为空');
    renderTimelineDay(timelineDays[selectedDayIndex]);
  } catch (error) {
    console.info('[Sunset Predict] Timeline unavailable:', error.message);
    await Promise.all([fetchData(), fetchWaitanData(), fetchRegionalSpots()]);
  }
}

// ============================================
// Regional photography spots
// ============================================
function renderRegionalCards() {
  const grid = document.getElementById('regional-grid');
  grid.innerHTML = REGIONAL_SPOTS.map(spot => `
    <article
      class="city-card city-card--${spot.slug}"
      id="city-${spot.slug}"
      data-spot="${spot.slug}"
      role="button"
      tabindex="0"
      aria-expanded="false"
      aria-controls="detail-panel"
      aria-label="${spot.name}晚霞预测，点击展开摄影指南"
    >
      <img class="city-card__image" src="assets/city-${spot.slug}.webp?v=20260718-city-images-v3" alt="${spot.name}标志性晚霞摄影景观" loading="lazy" decoding="async">
      <div class="city-card__content">
        <div class="city-card__top">
          <p class="city-card__city">${spot.city}</p>
          <h3 class="city-card__name">${spot.name}</h3>
          <span class="city-card__weather weather-badge unknown">天气更新中</span>
          <span class="city-card__chance probability-pill"><i data-lucide="shield" aria-hidden="true"></i><span>几率：--</span></span>
        </div>
        <div class="city-card__prediction">
          <div class="city-card__score-row">
            <span class="city-card__score">--</span>
            <span class="city-card__unit">/ 100</span>
          </div>
          <div class="city-card__grade">连接实时模型</div>
          <div class="city-card__progress"><span></span></div>
        </div>
        <div class="city-card__footer">
          <span class="city-card__spot"><i data-lucide="map-pin" aria-hidden="true"></i>${spot.hook}</span>
          <span class="city-card__status">试运行</span>
        </div>
      </div>
    </article>
  `).join('');
}

async function fetchRegionalSpots() {
  if (window.location.protocol === 'file:') return;

  try {
    const response = await fetchApi(REGIONAL_API_URL, 20000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { spots = [] } = await response.json();
    spots.forEach(renderRegionalSpot);
  } catch (error) {
    console.info('[Sunset Predict] Regional spots unavailable:', error.message);
  }
}

function renderRegionalSpot(data) {
  const card = document.getElementById(`city-${data.spot}`);
  if (!card) return;

  if (data.error) {
    card.querySelector('.city-card__score').textContent = '--';
    card.querySelector('.city-card__grade').textContent = '暂未连接';
    renderProbability(card.querySelector('.city-card__chance'), {}, true);
    renderWeatherBadge(card.querySelector('.city-card__weather'), {});
    card.querySelector('.city-card__progress span').style.width = '0';
    regionalData.delete(data.spot);
    return;
  }

  const score = data.quality ?? 0;
  const scoreEl = card.querySelector('.city-card__score');
  const gradeEl = card.querySelector('.city-card__grade');
  const progress = card.querySelector('.city-card__progress span');
  const grade = applyScoreColor(score, [scoreEl, gradeEl, progress]);
  regionalData.set(data.spot, data);
  animateNumber(scoreEl, score);
  gradeEl.textContent = getScenicCaption(data.spot, score, data.probability);
  renderProbability(card.querySelector('.city-card__chance'), data, true);
  renderWeatherBadge(card.querySelector('.city-card__weather'), data);
  applyObservationState(card, score, data.probability);
  card.querySelector('.city-card__spot').lastChild.textContent = data.bestSpot?.name || data.photographyAdvice;
  requestAnimationFrame(() => { progress.style.width = `${score}%`; });
  card.classList.add('is-live');
  card.setAttribute('aria-label', `${data.spotName}${data.weather?.label || ''}，晚霞指数${score}分，观测成功率${data.probability ?? 0}%，点击展开摄影指南`);
}

// ============================================
// Shanghai / Waitan prediction
// ============================================
async function fetchWaitanData() {
  if (window.location.protocol === 'file:') return;

  try {
    const response = await fetchApi(WAITAN_API_URL, 8000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    waitanData = data;
    renderWaitan(data);
  } catch (error) {
    console.info('[Sunset Predict] Waitan model is tuning:', error.message);
  }
}

function renderWaitan(data) {
  const score = data.quality ?? 0;
  const scoreEl = document.getElementById('waitan-score-value');
  const gradeEl = document.getElementById('waitan-grade');
  const progressEl = document.getElementById('waitan-progress-fill');
  const grade = applyScoreColor(score, [scoreEl, gradeEl, progressEl]);

  animateNumber(scoreEl, score);
  gradeEl.textContent = getScenicCaption('waitan', score, data.probability);
  renderProbability(document.getElementById('waitan-probability'), data);
  renderWeatherBadge(document.getElementById('waitan-weather'), data);
  requestAnimationFrame(() => { progressEl.style.width = `${score}%`; });
  const card = document.getElementById('card-bund');
  card.classList.add('is-live');
  applyObservationState(card, score, data.probability);
  card.setAttribute('aria-label', `上海外滩${relativeDayLabel(timelineOffsetForDate(data.date) ?? 0)}${data.weather?.label || ''}，晚霞指数${score}分，观测成功率${data.probability ?? 0}%`);
}

// ============================================
// API fetch + demo fallback
// ============================================
async function fetchData() {
  try {
    const res = await fetchApi(API_URL, 6000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentData = data;
    renderToday(data);
    updateTime();
  } catch (err) {
    console.warn('[Sunset Predict] API unavailable, using demo data:', err.message);
    renderDemo();
  }
}

// ============================================
// Render today's main card
// ============================================
function cameraParametersForScore(score) {
  if (score >= 85) return { aperture: 'f/8', shutter: '1/4s', iso: '100', wb: '5800K' };
  if (score >= 60) return { aperture: 'f/8', shutter: '1/8s', iso: '100', wb: '5600K' };
  if (score >= 30) return { aperture: 'f/5.6', shutter: '1/15s', iso: '200', wb: '6000K' };
  return { aperture: 'f/8', shutter: '1/60s', iso: '100', wb: '5200K' };
}

function setMetricBar(fillId, value) {
  const fill = document.getElementById(fillId);
  const width = Math.max(0, Math.min(100, Number(value) || 0));
  requestAnimationFrame(() => { fill.style.width = `${width}%`; });
}

function renderDetailMetrics(data, score, grade, spotId) {
  const metrics = data.metrics || {};
  const metricNumber = value => value === null || value === undefined ? NaN : Number(value);
  const highCloud = metricNumber(metrics.cloudHigh ?? data.components?.cloudHigh);
  const midCloud = metricNumber(metrics.cloudMid ?? data.components?.cloudMid);
  const lowCloud = metricNumber(metrics.cloudLow ?? data.components?.cloudLow);
  const visibilityKm = metricNumber(metrics.visibilityKm ?? data.components?.visibilityKm);
  const windowTransparency = metricNumber(
    metrics.windowTransparency ?? data.components?.westernWindow ?? data.components?.windowLight
  );
  const sheetScore = document.getElementById('sheet-score');
  const sheetGrade = document.getElementById('sheet-grade');
  const params = cameraParametersForScore(score);

  applyScoreColor(score, [sheetScore, sheetGrade]);
  animateNumber(sheetScore, score);
  sheetGrade.textContent = getScenicCaption(spotId, score, data.probability);
  document.getElementById('camera-aperture').textContent = params.aperture;
  document.getElementById('camera-shutter').textContent = params.shutter;
  document.getElementById('camera-iso').textContent = params.iso;
  document.getElementById('camera-wb').textContent = params.wb;

  [
    ['high', highCloud],
    ['mid', midCloud],
    ['low', lowCloud],
  ].forEach(([layer, value]) => {
    document.getElementById(`cloud-${layer}-value`).textContent = Number.isFinite(value) ? `${Math.round(value)}%` : '--';
    setMetricBar(`cloud-${layer}-fill`, value);
  });

  const canvasValue = Number(data.components?.canvasCoverage ?? data.components?.canvas ?? highCloud);
  const lightValue = Number(data.components?.westernWindow ?? data.components?.windowLight ?? windowTransparency);
  document.getElementById('metric-high-cloud').textContent = Number.isFinite(canvasValue) ? `${Math.round(canvasValue)}%` : '--';
  document.getElementById('metric-visibility').textContent = Number.isFinite(visibilityKm) ? `${visibilityKm.toFixed(1)} km` : '--';
  document.getElementById('metric-window').textContent = Number.isFinite(lightValue) ? `${Math.round(lightValue)}%` : '--';
  setMetricBar('metric-high-cloud-fill', canvasValue);
  setMetricBar('metric-visibility-fill', Number.isFinite(visibilityKm) ? visibilityKm / 24 * 100 : 0);
  setMetricBar('metric-window-fill', lightValue);

  const highText = Number.isFinite(highCloud) ? `高云 ${Math.round(highCloud)}%` : '高云数据暂缺';
  const visibilityText = Number.isFinite(visibilityKm) ? `能见度 ${visibilityKm.toFixed(1)}km` : '能见度暂缺';
  const windowName = data.windows?.[0]?.name || '西方窗口';
  const windowText = Number.isFinite(windowTransparency) ? `${windowName}通透度 ${Math.round(windowTransparency)}%` : '窗口数据暂缺';
  document.getElementById('algorithm-commentary').textContent =
    `${highText} 与中云共同决定“画布”质量，${visibilityText} 是色彩滤镜；${windowText}，主要决定观测成功率，而不会把高空画布的品质混成同一个数字。`;

  const correctionNames = (data.corrections || []).map(item => item.item);
  const spotName = data.spotName || DETAIL_SPOTS[spotId]?.name || '这个机位';
  let note = `${spotName}今天不是只看云多不多，更要看高云能否被西侧斜射光真正点亮。`;
  if (score >= 85) note = '这种天我会提前到场，把机位留给天空。模型给出高分，但真正的惊喜通常发生在太阳落下后的十分钟。';
  else if (score >= 60) note = '条件已经值得认真等一场。别在太阳刚落山时收机器，高云往往会在蓝调前再亮一次。';
  else if (score < 30) note = '今天不建议为火烧云专程赶路。如果已经在附近，可以把注意力放到剪影、落日轮廓和城市蓝调。';
  if (correctionNames.includes('高湿消光')) note += ' 今天水汽偏重，我会稍微欠曝，保住高光里的颜色。';
  document.getElementById('author-note').textContent = note;
}

function detailDataForSpot(spotId) {
  if (spotId === 'xihu') return currentData;
  if (spotId === 'waitan') return waitanData;
  return regionalData.get(spotId) || null;
}

function detailSpotFromHash() {
  const match = window.location.hash.match(/^#!([a-z-]+)$/);
  return match && DETAIL_SPOTS[match[1]] ? match[1] : null;
}

function openDetailFromHash() {
  const spotId = detailSpotFromHash();
  if (spotId) openDetail(spotId, { updateUrl: false, focus: false });
}

function partnerImageForSpot(spotId) {
  if (spotId === 'xihu') return 'assets/xihu-sunset.webp';
  if (spotId === 'waitan') return 'assets/waitan-sunset.webp';
  return `assets/city-${spotId}.webp?v=20260718-city-images-v3`;
}

function sharePosterCacheKey(data, spotId) {
  return [spotId, data.date, data.quality ?? data.score, data.probability, data.capturedAt].join(':');
}

function posterRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawPosterPanel(ctx, x, y, width, height, radius = 32) {
  posterRoundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = 'rgba(18, 23, 36, 0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function posterTextLines(ctx, value, maxWidth, maxLines = 3) {
  const characters = [...String(value || '')];
  const lines = [];
  let line = '';
  let overflow = false;
  for (const character of characters) {
    const next = line + character;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = character;
      if (lines.length === maxLines) {
        overflow = true;
        break;
      }
    } else {
      line = next;
    }
  }
  if (!overflow && line && lines.length < maxLines) lines.push(line);
  if (overflow && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function drawPosterText(ctx, value, x, y, maxWidth, lineHeight, maxLines = 3) {
  const lines = posterTextLines(ctx, value, maxWidth, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function loadPosterImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('景区图片加载失败'));
    image.src = source;
  });
}

function drawPosterCover(ctx, image, x, y, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawPosterMetric(ctx, { label, value, ratio, color, x, y, width }) {
  ctx.fillStyle = 'rgba(255,255,255,0.58)';
  ctx.font = '500 26px "Noto Sans SC", sans-serif';
  ctx.fillText(label, x, y);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '700 30px Manrope, "Noto Sans SC", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(value, x + width, y - 2);
  ctx.textAlign = 'left';
  posterRoundRect(ctx, x, y + 48, width, 12, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fill();
  const fillWidth = width * Math.max(0, Math.min(1, ratio));
  if (fillWidth > 0) {
    posterRoundRect(ctx, x, y + 48, Math.max(12, fillWidth), 12, 6);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function posterBestSpot(data, spotId) {
  const dynamicSpot = spotId === 'xihu' ? getDynamicBestSpot(data.date) : null;
  if (dynamicSpot?.label) return dynamicSpot.label;
  if (data.bestSpot?.name) return `${data.bestSpot.name}${data.bestSpot.desc ? ` · ${data.bestSpot.desc}` : ''}`;
  return data.photographyAdvice || '机位建议整理中';
}

function posterWeather(data) {
  const weather = data.weather || {};
  const parts = [weather.label || '天气待更新'];
  const rate = Number(weather.precipitationRateMmH);
  const probability = Number(weather.precipitationProbability);
  if (Number.isFinite(rate)) parts.push(`${rate.toFixed(1)} mm/h`);
  if (Number.isFinite(probability)) parts.push(`降水 ${Math.round(probability)}%`);
  return parts.join(' · ');
}

function posterVerdict(data, spotId) {
  if (typeof data.verdict === 'string' && data.verdict.trim()) return data.verdict.trim();
  const quality = Number(data.quality ?? data.score ?? 0);
  const probability = Number(data.probability ?? 0);
  if (quality >= 60 && probability >= 60) return '今晚值得奔赴，画布与光路都已就位。';
  if (quality >= 60) return '好景藏在云后，画布优秀，但光线存在阻断。';
  if (probability >= 60) return '适合看一场清透落日，霞色不会太浓。';
  return `${getScenicCaption(spotId, quality, probability)}，今晚不建议专程前往。`;
}

async function createSharePoster(data, spotId) {
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  const quality = Math.round(Number(data.quality ?? data.score ?? 0));
  const rawProbability = Number(data.probability);
  const probability = Number.isFinite(rawProbability) ? Math.round(rawProbability) : null;
  const grade = getGrade(quality);
  const tier = probabilityTier(probability ?? 0);
  const meta = DETAIL_SPOTS[spotId];
  const params = cameraParametersForScore(quality);
  const metrics = data.metrics || {};
  const canvasCoverage = Number(data.components?.canvasCoverage ?? data.components?.canvas ?? metrics.cloudHigh);
  const visibilityKm = Number(metrics.visibilityKm ?? data.components?.visibilityKm);
  const westernWindow = Number(data.components?.westernWindow ?? data.components?.windowLight ?? metrics.windowTransparency);
  const scoreColor = { fire: '#ff7b55', orange: '#ffc06a', purple: '#d2a9ff', blue: '#9bc9ef' }[grade.key];
  const probabilityColor = probability >= 60 ? '#6edca0' : probability >= 30 ? '#efc36e' : '#9aa5b8';

  ctx.fillStyle = '#080b12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const image = await loadPosterImage(partnerImageForSpot(spotId));
    drawPosterCover(ctx, image, 0, 0, canvas.width, 720);
  } catch {}
  const photoShade = ctx.createLinearGradient(0, 0, 0, 760);
  photoShade.addColorStop(0, 'rgba(5, 8, 15, 0.08)');
  photoShade.addColorStop(0.46, 'rgba(7, 10, 18, 0.42)');
  photoShade.addColorStop(1, '#080b12');
  ctx.fillStyle = photoShade;
  ctx.fillRect(0, 0, canvas.width, 780);
  const sideShade = ctx.createLinearGradient(0, 0, canvas.width, 0);
  sideShade.addColorStop(0, 'rgba(5,8,14,0.5)');
  sideShade.addColorStop(0.7, 'rgba(5,8,14,0.04)');
  ctx.fillStyle = sideShade;
  ctx.fillRect(0, 0, canvas.width, 720);

  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '700 25px Manrope, sans-serif';
  ctx.fillText('SUNSET PREDICT · CLOUD', 72, 56);
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = '500 28px "Noto Sans SC", sans-serif';
  const posterDate = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short',
  }).format(new Date(`${data.date}T12:00:00+08:00`));
  ctx.fillText(`${posterDate} · 晚霞摄影指南`, 72, 118);
  ctx.fillStyle = '#fff';
  ctx.font = '600 70px "Noto Serif SC", serif';
  ctx.fillText(meta.name, 72, 170);

  ctx.font = '600 24px "Noto Sans SC", sans-serif';
  const weatherText = posterWeather(data);
  const weatherWidth = Math.min(600, ctx.measureText(weatherText).width + 44);
  posterRoundRect(ctx, 72, 270, weatherWidth, 52, 26);
  ctx.fillStyle = 'rgba(13,18,29,0.66)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillText(weatherText, 94, 282);

  ctx.fillStyle = scoreColor;
  ctx.font = '500 190px Manrope, sans-serif';
  ctx.fillText(String(quality), 66, 340);
  ctx.fillStyle = 'rgba(255,255,255,0.44)';
  ctx.font = '600 27px Manrope, sans-serif';
  ctx.fillText('/ 100 · QUALITY', 330, 494);

  drawPosterPanel(ctx, 620, 354, 388, 178, 28);
  ctx.fillStyle = probabilityColor;
  ctx.font = '600 78px Manrope, sans-serif';
  ctx.fillText(probability === null ? '--' : `${probability}%`, 654, 384);
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = '600 24px "Noto Sans SC", sans-serif';
  ctx.fillText(`观测成功率 · ${data.probabilityLabel || tier.label}`, 654, 478);

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '600 36px "Noto Serif SC", serif';
  drawPosterText(ctx, getScenicCaption(spotId, quality, probability), 72, 585, 936, 48, 2);

  drawPosterPanel(ctx, 48, 748, 984, 376);
  ctx.fillStyle = '#d5a98f';
  ctx.font = '700 22px Manrope, sans-serif';
  ctx.fillText('TONIGHT\'S PHOTO PLAN', 82, 782);
  ctx.fillStyle = 'rgba(255,255,255,0.48)';
  ctx.font = '600 23px "Noto Sans SC", sans-serif';
  ctx.fillText('建议机位', 82, 828);
  ctx.fillStyle = '#fff';
  ctx.font = '600 38px "Noto Serif SC", serif';
  drawPosterText(ctx, posterBestSpot(data, spotId), 82, 866, 916, 50, 2);
  const sunset = data.sunTimes?.sunset || '--:--';
  const blueHour = data.blueHour?.available ? ` · 蓝调 ${data.blueHour.start}–${data.blueHour.end}` : '';
  ctx.fillStyle = 'rgba(255,255,255,0.66)';
  ctx.font = '500 26px "Noto Sans SC", sans-serif';
  ctx.fillText(`日落 ${sunset}${blueHour}`, 82, 974);
  const arrival = data.sunsetWindow?.recommendedArrival
    ? `${data.sunsetWindow.recommendedArrival} 前到达 · 守候至 ${data.sunsetWindow.recommendedLeave || '--:--'}`
    : '不建议专程前往 · 可顺路守候';
  ctx.fillText(arrival, 82, 1016);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = '600 25px Manrope, "Noto Sans SC", sans-serif';
  ctx.fillText(`${params.aperture}   ${params.shutter}   ISO ${params.iso}   WB ${params.wb}`, 82, 1062);

  drawPosterPanel(ctx, 48, 1154, 984, 326);
  ctx.fillStyle = '#d5a98f';
  ctx.font = '700 22px Manrope, sans-serif';
  ctx.fillText('PHYSICAL LAYERS · 物理层拆解', 82, 1188);
  drawPosterMetric(ctx, {
    label: '画布 Canvas', value: Number.isFinite(canvasCoverage) ? `${Math.round(canvasCoverage)}%` : '--',
    ratio: Number.isFinite(canvasCoverage) ? canvasCoverage / 100 : 0, color: scoreColor, x: 82, y: 1242, width: 916,
  });
  drawPosterMetric(ctx, {
    label: '滤镜 Filter', value: Number.isFinite(visibilityKm) ? `${visibilityKm.toFixed(1)} km` : '--',
    ratio: Number.isFinite(visibilityKm) ? visibilityKm / 24 : 0, color: '#8fc3f4', x: 82, y: 1320, width: 916,
  });
  drawPosterMetric(ctx, {
    label: '光源 Light Path', value: Number.isFinite(westernWindow) ? `${Math.round(westernWindow)}%` : '--',
    ratio: Number.isFinite(westernWindow) ? westernWindow / 100 : 0, color: probabilityColor, x: 82, y: 1398, width: 916,
  });

  drawPosterPanel(ctx, 48, 1510, 984, 280);
  ctx.fillStyle = '#d5a98f';
  ctx.font = '700 22px Manrope, sans-serif';
  ctx.fillText('THE VERDICT · 今晚怎么判断', 82, 1544);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.font = '600 36px "Noto Serif SC", serif';
  drawPosterText(ctx, posterVerdict(data, spotId), 82, 1590, 916, 50, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.46)';
  ctx.font = '500 22px "Noto Sans SC", sans-serif';
  drawPosterText(ctx, '观测成功率基于西方云路与本地遮挡估算，后续将结合历史实拍持续校准。', 82, 1732, 916, 34, 2);

  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = '700 28px Manrope, sans-serif';
  ctx.fillText('sunsetpredict.cloud', 72, 1840);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '500 22px "Noto Sans SC", sans-serif';
  ctx.fillText('长按保存 · 分享给一起等晚霞的人', 1008, 1844);
  ctx.textAlign = 'left';

  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    value => value ? resolve(value) : reject(new Error('长图生成失败')),
    'image/jpeg',
    0.92,
  ));
  return {
    blob,
    fileName: `sunset-predict-${spotId}-${data.date}.jpg`,
    title: `${meta.name}${relativeDayLabel(timelineOffsetForDate(data.date) ?? 0)}晚霞摄影指南`,
  };
}

function prepareSharePoster(data, spotId) {
  const key = sharePosterCacheKey(data, spotId);
  if (sharePosterPromise && sharePosterKey === key) return sharePosterPromise;
  sharePosterKey = key;
  sharePosterPromise = createSharePoster(data, spotId).catch(error => {
    if (sharePosterKey === key) sharePosterPromise = null;
    throw error;
  });
  return sharePosterPromise;
}

function canSharePosterFile(file) {
  if (!file || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

async function openSharePoster() {
  const data = detailDataForSpot(activeDetailSpot);
  const button = document.getElementById('detail-share');
  const label = button.querySelector('span');
  if (!data || !activeDetailSpot || button.disabled) return;
  button.disabled = true;
  label.textContent = '生成中';
  try {
    const poster = await prepareSharePoster(data, activeDetailSpot);
    if (sharePosterUrl) URL.revokeObjectURL(sharePosterUrl);
    sharePosterUrl = URL.createObjectURL(poster.blob);
    sharePosterFile = typeof File === 'function'
      ? new File([poster.blob], poster.fileName, { type: poster.blob.type, lastModified: Date.now() })
      : null;
    const preview = document.getElementById('share-poster-preview');
    const download = document.getElementById('share-poster-download');
    const systemButton = document.getElementById('share-system-button');
    preview.src = sharePosterUrl;
    download.href = sharePosterUrl;
    download.download = poster.fileName;
    systemButton.querySelector('span').textContent = canSharePosterFile(sharePosterFile) ? '分享到应用' : '保存后分享';
    systemButton.dataset.shareTitle = poster.title;
    document.getElementById('share-poster-modal').hidden = false;
    document.body.classList.add('modal-open');
    systemButton.focus();
    setTimeout(() => lucide.createIcons(), 30);
  } catch (error) {
    showToast(error.message || '长图生成失败，请稍后重试');
  } finally {
    button.disabled = false;
    label.textContent = '分享长图';
  }
}

async function sharePreparedPoster() {
  const button = document.getElementById('share-system-button');
  if (canSharePosterFile(sharePosterFile)) {
    try {
      await navigator.share({
        files: [sharePosterFile],
        title: button.dataset.shareTitle || '晚霞摄影指南',
        text: '来自 sunsetpredict.cloud 的晚霞摄影指南',
      });
      showToast('已打开系统分享面板');
    } catch (error) {
      if (error.name !== 'AbortError') showToast('分享未完成，可先保存长图');
    }
    return;
  }
  document.getElementById('share-poster-download').click();
  showToast('长图已保存，可发送到微信、朋友圈或小红书');
}

function renderPartnerCard(data, spotId) {
  const card = document.getElementById('partner-card-open');
  const isRecruiting = !data;
  const image = document.getElementById('partner-card-image');
  image.src = data?.image || partnerImageForSpot(spotId);
  image.alt = data?.imageAlt || `${DETAIL_SPOTS[spotId]?.name || '当地'}晚霞与本地商业合作展示图`;
  document.getElementById('partner-card-title').textContent = data?.title || '一起做点与晚霞有关的事';
  document.getElementById('partner-card-description').textContent =
    data?.description || '寻找本地合作伙伴：咖啡/酒店/摄影。';
  document.getElementById('partner-card-badge').textContent = data?.badge || 'Partner';
  card.classList.toggle('is-recruiting', isRecruiting);
}

function renderSunsetWindow(data) {
  const sunsetWindow = data.sunsetWindow || {};
  const track = document.getElementById('sunset-window-track');
  const state = document.getElementById('sunset-window-state');
  const summary = document.getElementById('sunset-window-summary');
  const details = document.getElementById('sunset-window-details');
  const arrivalMeta = document.getElementById('arrival-meta');
  const offset = timelineOffsetForDate(data.date) ?? 0;
  const nodes = (sunsetWindow.timeline || []).slice(0, 6);
  const resolution = nodes.find(node => node.resolution)?.resolution;
  const resolutionLabel = resolution === 'native-15m' ? '15分钟数据' : '小时插值';

  document.getElementById('sunset-window-forecast').textContent = offset > 0
    ? `${relativeDayLabel(offset)}预报趋势`
    : offset < 0 ? '历史预测记录' : '今日趋势';
  document.getElementById('sunset-window-sunset').textContent = sunsetWindow.sunset
    ? `日落 ${sunsetWindow.sunset}${sunsetWindow.effectiveSunset && sunsetWindow.effectiveSunset !== sunsetWindow.sunset ? ` · 有效 ${sunsetWindow.effectiveSunset}` : ''}`
    : '日落 --';

  if (!sunsetWindow.available || nodes.filter(node => Number.isFinite(node.quality)).length < 3) {
    state.textContent = sunsetWindow.message || '趋势数据不足';
    track.innerHTML = '';
    summary.textContent = '关键时段数据不足，暂不生成峰值与出发建议。';
    details.textContent = '';
    arrivalMeta.textContent = '到达建议暂缺';
    return;
  }

  state.textContent = `${resolutionLabel} · Quality 与观测成功率逐节点计算`;
  track.innerHTML = nodes.map((node, index) => {
    const quality = Number.isFinite(node.quality) ? Math.round(node.quality) : '--';
    const probability = Number.isFinite(node.probability) ? `${Math.round(node.probability)}%` : '--';
    const active = node.time === sunsetWindow.peakTime ? ' is-active' : '';
    const disabled = Number.isFinite(node.quality) ? '' : ' disabled';
    return `<button class="sunset-window__node${active}" type="button" data-window-index="${index}"${disabled}>
      <span>${node.time || '--:--'}</span>
      <strong>${quality}</strong>
      <small>几率 ${probability}</small>
      <em>${node.status || '等待'}</em>
    </button>`;
  }).join('');

  const showNode = index => {
    const node = nodes[index];
    if (!node || !Number.isFinite(node.quality)) return;
    track.querySelectorAll('.sunset-window__node').forEach((button, buttonIndex) => {
      button.classList.toggle('is-active', buttonIndex === index);
    });
    const metrics = node.metrics || {};
    const value = (number, suffix = '%') => Number.isFinite(Number(number)) ? `${Math.round(Number(number))}${suffix}` : '--';
    details.textContent = `高云 ${value(metrics.cloudHigh)} · 低云 ${value(metrics.cloudLow)} · 西方光路 ${value(metrics.windowTransparency)} · 能见度 ${Number.isFinite(Number(metrics.visibilityKm)) ? `${Number(metrics.visibilityKm).toFixed(1)}km` : '--'}`;
  };
  track.querySelectorAll('.sunset-window__node').forEach(button => {
    button.addEventListener('click', () => showNode(Number(button.dataset.windowIndex)));
  });

  const peakIndex = Math.max(0, nodes.findIndex(node => node.time === sunsetWindow.peakTime));
  showNode(peakIndex);
  if (sunsetWindow.recommendedArrival) {
    const arrivalContext = sunsetWindow.arrivalNote?.startsWith('附近可赌')
      ? '附近可赌 · '
      : sunsetWindow.arrivalNote?.startsWith('适合拍摄清透落日') ? '适合拍摄清透落日 · ' : '';
    summary.textContent = `预计峰值 ${sunsetWindow.peakTime} · ${arrivalContext}建议 ${sunsetWindow.recommendedArrival} 前到达 · 守候至 ${sunsetWindow.recommendedLeave}`;
    arrivalMeta.textContent = `${sunsetWindow.recommendedArrival} 前到达`;
  } else {
    summary.textContent = `预计峰值 ${sunsetWindow.peakTime} · 不建议专程前往${sunsetWindow.recommendedLeave ? ` · 如在附近可守候至 ${sunsetWindow.recommendedLeave}` : ''}`;
    arrivalMeta.textContent = '不建议专程前往';
  }
}

function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

function scheduleBlueHourTheme(data) {
  if (blueHourThemeTimer) clearInterval(blueHourThemeTimer);
  const update = () => {
    const blueHour = data?.blueHour;
    const isToday = timelineOffsetForDate(data?.date) === 0;
    const now = Date.now();
    const active = isToday && blueHour?.available && now >= Date.parse(blueHour.startAt) && now <= Date.parse(blueHour.endAt);
    document.body.classList.toggle('blue-hour-active', Boolean(active));
  };
  update();
  blueHourThemeTimer = setInterval(update, 30_000);
}

function renderBlueHour(data, spotId) {
  if (blueHourTimer) {
    clearInterval(blueHourTimer);
    blueHourTimer = null;
  }
  const section = document.getElementById('blue-hour-section');
  const blueHour = data.blueHour;
  if (!['xihu', 'waitan'].includes(spotId) || !blueHour?.available) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  document.getElementById('blue-hour-score').textContent = Math.round(blueHour.score);
  document.getElementById('blue-hour-label').textContent = blueHour.label;
  document.getElementById('blue-hour-advice').textContent = blueHour.advice;
  document.getElementById('blue-hour-components').textContent = `能见度 ${Number.isFinite(blueHour.components?.visibilityKm) ? `${blueHour.components.visibilityKm.toFixed(1)}km` : '--'} · 总云量 ${Number.isFinite(blueHour.components?.cloudCover) ? `${Math.round(blueHour.components.cloudCover)}%` : '--'} · ${blueHour.airQualityHint}`;
  document.getElementById('blue-hour-params').textContent = `长曝光 ${blueHour.camera?.shutter || '2–8s'} · ${blueHour.camera?.iso || 'ISO 100'} · ${blueHour.camera?.aperture || 'f/8'} · 白平衡 ${blueHour.camera?.whiteBalance || '3600K'}`;
  requestAnimationFrame(() => {
    document.getElementById('blue-hour-fill').style.width = `${Math.max(0, Math.min(100, blueHour.score))}%`;
  });

  const countdown = document.getElementById('blue-hour-countdown');
  const update = () => {
    const offset = timelineOffsetForDate(data.date);
    if (offset !== 0) {
      countdown.textContent = `${relativeDayLabel(offset ?? 0)}蓝调窗口 · ${blueHour.start}–${blueHour.end}`;
      return;
    }
    const now = Date.now();
    const startAt = Date.parse(blueHour.startAt);
    const endAt = Date.parse(blueHour.endAt);
    const sunsetAt = data.sunTimes?.sunset ? Date.parse(`${data.date}T${data.sunTimes.sunset}:00+08:00`) : null;
    if (now < startAt) {
      const prefix = sunsetAt && now >= sunsetAt ? '晚霞已谢，极致蓝调倒计时' : '极致蓝调倒计时';
      countdown.textContent = `${prefix} ${formatCountdown(startAt - now)}`;
    } else if (now <= endAt) {
      countdown.textContent = `蓝调进行中 · 剩余 ${formatCountdown(endAt - now)}`;
      document.body.classList.add('blue-hour-active');
    } else {
      countdown.textContent = '今日蓝调已结束';
      document.body.classList.remove('blue-hour-active');
    }
  };
  update();
  if (timelineOffsetForDate(data.date) === 0) blueHourTimer = setInterval(update, 1000);
}

function feedbackStorageKey(spot, date) {
  return `sunset-feedback:${spot}:${date}`;
}

function getStoredFeedback(spot, date) {
  try {
    const value = JSON.parse(localStorage.getItem(feedbackStorageKey(spot, date)) || 'null');
    return value && typeof value.observed === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

function getFeedbackClientId() {
  if (ephemeralFeedbackClientId) return ephemeralFeedbackClientId;
  try {
    const stored = localStorage.getItem('sunset-feedback-client-id');
    if (/^[a-zA-Z0-9_-]{16,80}$/.test(stored || '')) return stored;
  } catch {}
  ephemeralFeedbackClientId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `anon_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem('sunset-feedback-client-id', ephemeralFeedbackClientId);
  } catch {}
  return ephemeralFeedbackClientId;
}

function feedbackAvailabilityFor(data) {
  const date = data?.date;
  if (!date) return { open: false, reason: '日期数据不足' };
  const clockParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const today = `${clockParts.year}-${clockParts.month}-${clockParts.day}`;
  if (date > today) return { open: false, reason: '未来日期暂不能反馈' };
  return { open: true, reason: '' };
}

function renderFeedbackDraft() {
  const quality = document.getElementById('feedback-quality');
  const submit = document.getElementById('feedback-submit');
  const status = document.getElementById('feedback-status');
  document.querySelectorAll('[data-feedback-observed]').forEach(button => {
    const selected = (button.dataset.feedbackObserved === 'true') === feedbackDraft.observed;
    button.classList.toggle('is-selected', feedbackDraft.observed !== null && selected);
    button.disabled = !feedbackDraft.open || feedbackDraft.submitting;
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  document.querySelectorAll('[data-feedback-quality]').forEach(button => {
    const selected = Number(button.dataset.feedbackQuality) === feedbackDraft.actualQuality;
    button.classList.toggle('is-selected', selected);
    button.disabled = !feedbackDraft.open || feedbackDraft.submitting;
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  quality.hidden = feedbackDraft.observed !== true;
  submit.disabled = !feedbackDraft.open || feedbackDraft.submitting || feedbackDraft.observed === null ||
    (feedbackDraft.observed === true && !FEEDBACK_QUALITY_LABELS.has(feedbackDraft.actualQuality));
  submit.textContent = feedbackDraft.submitting ? '正在记录…' : feedbackDraft.submitted ? '更新实况' : '提交实况';

  if (!feedbackDraft.open) status.textContent = feedbackDraft.reason;
  else if (feedbackDraft.error) status.textContent = feedbackDraft.error;
  else if (feedbackDraft.submitted) {
    const result = feedbackDraft.observed
      ? `看到了 · ${FEEDBACK_QUALITY_LABELS.get(feedbackDraft.actualQuality)}`
      : '没有看到晚霞';
    status.textContent = `已记录：${result}。你可以继续修改。`;
  } else if (feedbackDraft.observed === true && !feedbackDraft.actualQuality) status.textContent = '再选择今晚晚霞的实际质量。';
  else status.textContent = '选择真实结果后提交。';
}

function renderFeedbackPanel(data, spotId) {
  const availability = feedbackAvailabilityFor(data);
  const stored = getStoredFeedback(spotId, data.date);
  Object.assign(feedbackDraft, {
    spot: spotId,
    date: data.date,
    data,
    open: availability.open,
    reason: availability.reason,
    observed: stored?.observed ?? null,
    actualQuality: stored?.actualQuality ?? null,
    submitted: Boolean(stored),
    submitting: false,
    error: '',
  });
  renderFeedbackDraft();
}

function selectFeedbackObserved(observed) {
  if (!feedbackDraft.open || feedbackDraft.submitting) return;
  feedbackDraft.observed = observed;
  if (!observed) feedbackDraft.actualQuality = 0;
  if (observed && feedbackDraft.actualQuality === 0) feedbackDraft.actualQuality = null;
  feedbackDraft.submitted = false;
  feedbackDraft.error = '';
  renderFeedbackDraft();
}

function selectFeedbackQuality(actualQuality) {
  if (!feedbackDraft.open || feedbackDraft.submitting || !FEEDBACK_QUALITY_LABELS.has(actualQuality)) return;
  feedbackDraft.observed = true;
  feedbackDraft.actualQuality = actualQuality;
  feedbackDraft.submitted = false;
  feedbackDraft.error = '';
  renderFeedbackDraft();
}

async function submitObservationFeedback() {
  if (!feedbackDraft.open || feedbackDraft.submitting || feedbackDraft.observed === null) return;
  feedbackDraft.submitting = true;
  feedbackDraft.error = '';
  renderFeedbackDraft();
  try {
    const response = await fetch(FEEDBACK_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        spot: feedbackDraft.spot,
        date: feedbackDraft.date,
        clientId: getFeedbackClientId(),
        observed: feedbackDraft.observed,
        actualQuality: feedbackDraft.observed ? feedbackDraft.actualQuality : 0,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '实况提交失败');
    const stored = {
      observed: feedbackDraft.observed,
      actualQuality: feedbackDraft.actualQuality,
      recordedAt: result.recordedAt,
    };
    try {
      localStorage.setItem(feedbackStorageKey(feedbackDraft.spot, feedbackDraft.date), JSON.stringify(stored));
    } catch {}
    feedbackDraft.submitted = true;
    trackUmamiEvent('feedback-submit', feedbackDraft.spot);
    showToast(result.message || '实况已记录');
  } catch (error) {
    feedbackDraft.error = error.message;
  } finally {
    feedbackDraft.submitting = false;
    renderFeedbackDraft();
  }
}

function renderDetailContent(data, spotId) {
  const score = data.quality ?? data.score ?? 0;
  const grade = getGrade(score);
  const meta = DETAIL_SPOTS[spotId];
  const dayLabel = relativeDayLabel(timelineOffsetForDate(data.date) ?? 0);
  document.getElementById('guide-eyebrow').textContent = `${meta.nameEn} photography guide`;
  document.getElementById('guide-title').textContent = `${dayLabel} · ${meta.name}摄影指南`;
  document.getElementById('detail-overlay').setAttribute('aria-label', `关闭${meta.name}摄影指南`);
  renderPartnerCard(advertiserData, spotId);

  renderDetailMetrics(data, score, grade, spotId);
  renderSunsetWindow(data);
  renderBlueHour(data, spotId);
  renderWeatherDetails(data);
  renderFeedbackPanel(data, spotId);
  const bestSpot = spotId === 'xihu' ? getDynamicBestSpot(data.date) : null;
  const bestSpotText = bestSpot?.label || (data.bestSpot
    ? `${data.bestSpot.name} — ${data.bestSpot.desc || ''}`.replace(/ — $/, '')
    : data.photographyAdvice || '机位建议整理中');
  const bestSpotElement = document.getElementById('best-spot');
  bestSpotElement.textContent = bestSpotText;
  bestSpotElement.title = bestSpot?.azimuth ? `${dayLabel}日落方位角 ${bestSpot.azimuth}°` : '';

  const sunsetTime = data.sunTimes?.sunset || '--:--';
  const hasBlueHour = ['xihu', 'waitan'].includes(spotId) && data.blueHour?.available;
  const heroBlueHour = document.getElementById('hero-blue-hour');
  const timelineConnector = document.getElementById('light-timeline-connector');
  document.getElementById('sunset-time').textContent = sunsetTime;
  heroBlueHour.hidden = !hasBlueHour;
  timelineConnector.hidden = !hasBlueHour;
  if (hasBlueHour) {
    document.getElementById('hero-blue-hour-time').textContent = `${data.blueHour.start}–${data.blueHour.end}`;
  }
  document.getElementById('color-desc').textContent = data.color?.desc || data.color?.label || '--';
  document.getElementById('confidence').textContent = CONF_MAP[data.confidence] || data.confidence || '--';
  renderCorrections(data.corrections || []);

  const alpenglow = document.getElementById('alpenglow-hint');
  alpenglow.innerHTML = data.alpenglow?.available
    ? `<span class="alpenglow-badge"><i data-lucide="sparkles" style="width:12px;height:12px"></i> ${data.alpenglow.desc}</span>`
    : '';
  prepareSharePoster(data, spotId).catch(() => {});
  setTimeout(() => lucide.createIcons(), 60);
}

function renderToday(data) {
  const score = data.quality ?? data.score ?? 0;

  // Animate score number
  const scoreEl = document.getElementById('score-value');
  animateNumber(scoreEl, score);

  // Progress bar
  const fill = document.getElementById('progress-fill');
  const glow = document.getElementById('progress-glow');
  const progress = document.getElementById('progress-bar');
  const tag = document.getElementById('grade-tag');
  const grade = applyScoreColor(score, [scoreEl, tag, fill, glow], glow);
  requestAnimationFrame(() => {
    fill.style.width = score + '%';
    glow.style.left = score + '%';
    glow.style.opacity = '1';
    progress.setAttribute('aria-valuenow', score);
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    // Position glow at the fill end
    setTimeout(() => { glow.style.opacity = '0.6'; }, 1200);
  });

  // Grade chip
  tag.textContent = getScenicCaption('xihu', score, data.probability);
  renderProbability(document.getElementById('xihu-probability'), data);
  renderWeatherBadge(document.getElementById('xihu-day-status'), data);
  applyObservationState(document.getElementById('card-xihu'), score, data.probability);
  scheduleBlueHourTheme(data);

  document.getElementById('card-xihu').setAttribute(
    'aria-label',
    `西湖${relativeDayLabel(timelineOffsetForDate(data.date) ?? 0)}${data.weather?.label || ''}，晚霞指数${score}分，观测成功率${data.probability ?? 0}%，点击展开摄影指南`
  );

}

// ============================================
// Corrections chips
// ============================================
function renderCorrections(corrections) {
  const container = document.getElementById('corrections');
  if (!corrections.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = corrections.map(c => {
    const positive = c.value.startsWith('+');
    return `<span class="correction-chip ${positive ? 'positive' : 'negative'}">${c.item} ${c.value}</span>`;
  }).join('');
}

// ============================================
// Score number animation (easeOutExpo)
// ============================================
function animateNumber(el, target) {
  const duration = 900;
  const start = performance.now();
  const previous = scoreAnimations.get(el);
  if (previous) cancelAnimationFrame(previous);

  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    // easeOutExpo
    const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    el.textContent = Math.round(target * eased);
    if (t < 1) scoreAnimations.set(el, requestAnimationFrame(tick));
    else scoreAnimations.delete(el);
  }

  scoreAnimations.set(el, requestAnimationFrame(tick));
}

// ============================================
// Bottom sheet
// ============================================
function updateDetailUrl(open, spotId = activeDetailSpot) {
  const target = `${window.location.pathname}${window.location.search}${open && spotId ? `#!${spotId}` : ''}`;
  window.history.replaceState(window.history.state, '', target);
}

function resetDetailDragStyles() {
  const panel = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  panel.style.removeProperty('transition');
  panel.style.removeProperty('transform');
  overlay.style.removeProperty('opacity');
}

function openDetail(spotId = 'xihu', { updateUrl = true, focus = true } = {}) {
  const data = detailDataForSpot(spotId);
  const meta = DETAIL_SPOTS[spotId];
  if (!meta || !data) {
    showToast('该站点数据仍在连接，请稍后再试');
    return;
  }
  const panel = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  const hint = document.getElementById('expand-hint');
  const card = document.getElementById(meta.cardId);
  if (detailOpen && activeDetailSpot === spotId) return;
  if (activeDetailSpot && activeDetailSpot !== spotId) {
    document.getElementById(DETAIL_SPOTS[activeDetailSpot].cardId)?.setAttribute('aria-expanded', 'false');
  }
  activeDetailSpot = spotId;
  detailOpen = true;
  trackUmamiEvent('detail-open', spotId);
  resetDetailDragStyles();
  renderDetailContent(data, spotId);

  panel.removeAttribute('inert');
  panel.classList.add('open');
  overlay.classList.add('open');
  hint.classList.toggle('expanded', spotId === 'xihu');
  panel.setAttribute('aria-hidden', 'false');
  overlay.setAttribute('aria-hidden', 'false');
  card.setAttribute('aria-expanded', 'true');
  document.body.classList.add('detail-open');
  if (updateUrl) updateDetailUrl(true, spotId);
  if (focus) panel.focus({ preventScroll: true });
  setTimeout(() => lucide.createIcons(), 80);
}

function closeDetail({ updateUrl = true, focus = true } = {}) {
  if (!detailOpen) return;
  const panel = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  const hint = document.getElementById('expand-hint');
  const closingSpot = activeDetailSpot;
  const card = closingSpot ? document.getElementById(DETAIL_SPOTS[closingSpot].cardId) : null;
  detailOpen = false;
  resetDetailDragStyles();

  panel.classList.remove('open');
  overlay.classList.remove('open');
  hint.classList.remove('expanded');
  panel.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('aria-hidden', 'true');
  panel.setAttribute('inert', '');
  card?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('detail-open');
  if (updateUrl) updateDetailUrl(false);
  activeDetailSpot = null;
  if (focus) card?.focus({ preventScroll: true });
}

function bindDetailDrag() {
  const panel = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  const dragZone = document.getElementById('detail-drag-zone');
  const scroll = document.getElementById('detail-scroll');
  let startY = null;
  let currentDelta = 0;
  let touchStartY = null;

  dragZone.addEventListener('pointerdown', event => {
    if (!event.isPrimary) return;
    startY = event.clientY;
    currentDelta = 0;
    dragZone.setPointerCapture?.(event.pointerId);
  });

  dragZone.addEventListener('pointermove', event => {
    if (startY === null || !event.isPrimary) return;
    currentDelta = Math.max(0, event.clientY - startY);
    if (!currentDelta) return;
    panel.style.transition = 'none';
    panel.style.transform = `translate(-50%, ${currentDelta}px)`;
    overlay.style.opacity = String(Math.max(0, 1 - currentDelta / 360));
  });

  const finishDrag = () => {
    if (startY === null) return;
    const shouldClose = currentDelta > 96;
    startY = null;
    currentDelta = 0;
    if (shouldClose) closeDetail();
    else resetDetailDragStyles();
  };
  dragZone.addEventListener('pointerup', finishDrag);
  dragZone.addEventListener('pointercancel', finishDrag);

  panel.addEventListener('touchstart', event => {
    touchStartY = scroll.scrollTop <= 0 && event.touches.length === 1 ? event.touches[0].clientY : null;
  }, { passive: true });
  panel.addEventListener('touchend', event => {
    if (touchStartY === null || !event.changedTouches.length) return;
    const distance = event.changedTouches[0].clientY - touchStartY;
    touchStartY = null;
    if (distance > 110) closeDetail();
  }, { passive: true });
}

// ============================================
// Toast
// ============================================
function showToast(message, duration = 2800) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ============================================
// Update timestamp
// ============================================
function updateTime(timestamp = null) {
  const el = document.getElementById('update-time');
  const now = timestamp ? new Date(timestamp) : new Date();
  el.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// ============================================
// Demo data (API fallback)
// ============================================
function renderDemo() {
  const demo = {
    quality: 72,
    probability: 88,
    probabilityLabel: '极易观测',
    verdict: '【爆燃预警】今晚具备高质量晚霞条件，且西方窗口通透，建议提前出发。',
    label: { zh: '绚丽', en: 'Great' },
    color: { label: '通透金橙', hint: 'gold', desc: '空气极净，散射少，金色直射为主' },
    confidence: 'medium',
    alpenglow: { available: true, desc: '高云量大，下山后仍有10-15分钟反青光，适合长曝光' },
    bestSpot: { name: '雷峰夕照', desc: '西向开阔，日落正对，最佳构图' },
    corrections: [
      { item: '湖面反射', value: '+10%', desc: '湖面平静反射天空色彩' },
      { item: '临安窗口通透', value: '+18%', desc: '西方低云<10%，光线畅通' },
      { item: '高湿消光', value: '-5%', desc: '湿度82%，雾气削弱色彩' },
    ],
    sunTimes: { sunrise: '05:12', sunset: '19:05', dayLength: 893 },
    forecast: [
      { quality: 72 },
      { quality: 55 },
      { quality: 38 },
    ],
  };

  currentData = demo;
  renderToday(demo);
  updateTime();
  showToast('演示模式 — API 未连接', 3500);

  // Update live badge
  const badge = document.getElementById('live-badge');
  if (badge) {
    badge.style.color = 'var(--text-ghost)';
  }
}
