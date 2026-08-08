'use strict';
// 卫星实况 nowcast 数据服务 (Himawari-8/9, NICT)
// 用途: 日落前 0-3h 用真实云图修正「西方窗口」低云遮挡判断,
//       抓住「预报晴但飘来一朵积云」的误报,以及「预报云但实际通透」的漏报。
//
// 数据源: https://himawari.asia (NICT 公开实时影像, 免鉴权)
//   latest.json -> 最新帧文件名
//   瓦片: /img/D531106/{N}d/550/{Y}/{M}/{D}/{HHMMSS}_{x}_{y}.png
//   注: 瓦片实际为 RGBA (4 字节/像素), 读取必须按 stride=4。
//
// 当前实现 = 真彩(RGB)白天通道。判云阈值 CLOUD_LUM 为占位值,
// 生产使用前需结合 IR 亮温 + 海陆掩膜 + 实况反馈校准 (见文件末尾 TODO)。

const { PNG } = require('pngjs');
const SunCalc = require('suncalc');

const DOMAIN = 'https://himawari.asia';
const BASE = '/img/D531106';
const TILE = 550;
const SUB_LON = 140.69999938964844;          // 卫星星下点经度 (140.7E)
const R_EARTH = 6371;                         // km
const D_SAT = (6378.137 + 35786) / 6378.137; // 卫星距地心 / 地球半径 ≈ 6.6108
const A_EARTH = Math.asin(1 / D_SAT);        // 地球角半径 (rad)

// 真彩白天判云占位阈值 (亮度). 差分判云见 estimateCloudCover, 此值仅作 lowCloudFlag 兼容。
const CLOUD_LUM = 150;

// 差分判云参数
const DIFF_LUM_DELTA = 45;    // 高于晴空基线的最小亮度差
const DIFF_LUM_FLOOR = 140;   // 差分判云的绝对亮度下限
const DIFF_SAT_MAX = 0.28;    // 云像元最大饱和度 (云发白, 低饱和)
const ABS_LUM = 200;          // 绝对亮度判云 (整片厚云时差分失效的兜底)
const ABS_SAT_MAX = 0.35;

// 卫星观测可采信的时间门控 (相对日落, 分钟)
const USABLE_MIN_BEFORE_SUNSET = 45;   // 近日落真彩图变暗, 亮度判云失效
const USABLE_MAX_BEFORE_SUNSET = 210;  // 超过 3.5h 时效性差, 不用于修正

async function fetchBuffer(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

class SatelliteNowcast {
  constructor(opts = {}) {
    this.level = opts.level || 2;            // 2 -> 4 瓦片拼 1100x1100 全圆盘
    this.P = this.level * TILE;              // 全圆盘像素
    this.scale = (this.P / 2) / A_EARTH;     // px/rad
    this.cx = (this.P - 1) / 2;
    this.cy = (this.P - 1) / 2;
    this.refreshMs = opts.refreshMs || 10 * 60 * 1000;
    this.maxAgeMs = opts.maxAgeMs || 40 * 60 * 1000; // 数据新鲜度上限 (帧滞后10-20min + 刷新间隔)
    this.grid = null;                        // Buffer(P*P*3) RGB
    this.observedAt = null;
    this.frame = null;
    this.timer = null;
    this.fetching = null;
  }

  // 经纬度 -> 全圆盘像素 (球模型静止轨道投影)
  lonLatToPixel(lon, lat) {
    const D2R = Math.PI / 180;
    const dl = (lon - SUB_LON) * D2R;
    const phi = lat * D2R;
    const cl = Math.cos(phi), sl = Math.sin(phi);
    const cdl = Math.cos(dl), sdl = Math.sin(dl);
    const Vx = cl * sdl;
    const Vy = sl;
    const depth = D_SAT - cl * cdl;
    const thx = Math.atan2(Vx, depth);
    const thy = Math.atan2(Vy, depth);
    return [this.cx + thx * this.scale, this.cy - thy * this.scale];
  }

  // 从 (lat,lon) 沿方位角 azDeg(北顺时针) 走 distKm 得到新经纬度
  destPoint(lat, lon, azDeg, distKm) {
    const D2R = Math.PI / 180, R2D = 180 / Math.PI;
    const brng = azDeg * D2R;
    const lat1 = lat * D2R, lon1 = lon * D2R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distKm / R_EARTH) +
      Math.cos(lat1) * Math.sin(distKm / R_EARTH) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(distKm / R_EARTH) * Math.cos(lat1),
      Math.cos(distKm / R_EARTH) - Math.sin(lat1) * Math.sin(lat2));
    return [lat2 * R2D, lon2 * R2D];
  }

  async refresh() {
    if (this.fetching) return this.fetching;
    this.fetching = (async () => {
      const meta = JSON.parse((await fetchBuffer(`${DOMAIN}${BASE}/latest.json`)).toString('utf8'));
      const m = meta.file.match(/_(\d{8})_(\d{4})_/);
      const date = m[1], hhmm = m[2];
      const Y = date.slice(0, 4), Mo = date.slice(4, 6), Dt = date.slice(6, 8);
      const ts = hhmm + '00';
      const prod = `${this.level}d`;
      const url = (x, y) =>
        `${DOMAIN}${BASE}/${prod}/${TILE}/${Y}/${Mo}/${Dt}/${ts}_${x}_${y}.png`;
      const big = Buffer.alloc(this.P * this.P * 3);
      for (let x = 0; x < this.level; x++) {
        for (let y = 0; y < this.level; y++) {
          const buf = await fetchBuffer(url(x, y));
          const png = PNG.sync.read(buf);
          const ch = Math.round(png.data.length / (png.width * png.height)); // 4=RGBA
          for (let r = 0; r < TILE; r++) {
            for (let c = 0; c < TILE; c++) {
              const gi = ((y * TILE + r) * this.P + (x * TILE + c)) * 3;
              const si = (r * TILE + c) * ch;
              big[gi] = png.data[si];
              big[gi + 1] = png.data[si + 1];
              big[gi + 2] = png.data[si + 2];
            }
          }
        }
      }
      this.grid = big;
      // 帧的真实观测时间 (文件名中的 UTC), 而非抓取时间 —— 门控/新鲜度都以此为准
      this.observedAt = new Date(Date.UTC(+Y, +Mo - 1, +Dt, +hhmm.slice(0, 2), +hhmm.slice(2, 4)));
      this.frame = meta.file;
    })();
    try {
      await this.fetching;
    } finally {
      this.fetching = null;
    }
    return this.observedAt;
  }

  sample(lon, lat) {
    if (!this.grid) return null;
    const [col, row] = this.lonLatToPixel(lon, lat);
    const ci = Math.round(col), ri = Math.round(row);
    if (ci < 0 || ci >= this.P || ri < 0 || ri >= this.P) return { oob: true };
    const i = (ri * this.P + ci) * 3;
    const R = this.grid[i], G = this.grid[i + 1], B = this.grid[i + 2];
    return {
      R, G, B,
      lum: Math.round(0.299 * R + 0.587 * G + 0.114 * B),
      observedAt: this.observedAt,
    };
  }

  // 采样 (lon,lat) 周围 (2*half+1)^2 邻域像元, 返回 {lum, sat} 数组
  samplePatch(lon, lat, half = 1) {
    if (!this.grid) return [];
    const [col, row] = this.lonLatToPixel(lon, lat);
    const ci = Math.round(col), ri = Math.round(row);
    const out = [];
    for (let dr = -half; dr <= half; dr++) {
      for (let dc = -half; dc <= half; dc++) {
        const r = ri + dr, c = ci + dc;
        if (r < 0 || r >= this.P || c < 0 || c >= this.P) continue;
        const i = (r * this.P + c) * 3;
        const R = this.grid[i], G = this.grid[i + 1], B = this.grid[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        out.push({
          lum: 0.299 * R + 0.587 * G + 0.114 * B,
          sat: mx > 0 ? (mx - mn) / mx : 0, // 饱和度: 云发白 -> 低
        });
      }
    }
    return out;
  }

  // 差分判云: 沿日落方位角多点采样, 以各点邻域最暗四分位为该处地表晴空基线,
  // 「亮度显著高于基线 + 低饱和(发白)」的像元判为云。
  // 返回 cloudCover 0-100; 对海/陆背景差异鲁棒 (基线随地表自适应)。
  estimateCloudCover(lat, lon, azDeg, dists = [70, 130, 190]) {
    if (!this.grid) return null;
    let cloudy = 0, total = 0;
    for (const distKm of dists) {
      const [wlat, wlon] = this.destPoint(lat, lon, azDeg, distKm);
      const px = this.samplePatch(wlon, wlat, 1);
      if (!px.length) continue;
      const lums = px.map(p => p.lum).sort((a, b) => a - b);
      // 最暗四分位均值 = 该邻域地表晴空基线 (云是局部亮异常, 最暗像元近似无云地表)
      const q = Math.max(1, Math.floor(lums.length / 4));
      const baseline = lums.slice(0, q).reduce((s, v) => s + v, 0) / q;
      for (const p of px) {
        total += 1;
        const diffCloud = p.lum >= Math.max(DIFF_LUM_FLOOR, baseline + DIFF_LUM_DELTA) && p.sat <= DIFF_SAT_MAX;
        const absCloud = p.lum >= ABS_LUM && p.sat <= ABS_SAT_MAX; // 整片厚云: 基线本身被云抬高, 差分失效
        if (diffCloud || absCloud) cloudy += 1;
      }
    }
    if (!total) return null;
    return Math.round((cloudy / total) * 100);
  }

  // 西方窗口低云探测: 沿日落方位角 azDeg 走 distKm (默认 130km)
  // 返回原始观测, 是否采信由调用方结合「距日落<=3h」综合决定。
  getWindow(lat, lon, azDeg, distKm = 130) {
    if (!this.grid || !this.observedAt) return { available: false };
    const fresh = (Date.now() - this.observedAt.getTime()) <= this.maxAgeMs;
    const [wlat, wlon] = this.destPoint(lat, lon, azDeg, distKm);
    const s = this.sample(wlon, wlat);
    if (!s || s.oob) return { available: false, fresh };
    return {
      available: true,
      fresh,
      lum: s.lum,
      rgb: [s.R, s.G, s.B],
      observedAt: this.observedAt,
      lowCloudFlag: s.lum > CLOUD_LUM, // 占位阈值, 待校准
      data_source: 'himawari-truecolor',
    };
  }

  // 自动用 SunCalc 计算该站今日日落方位角, 差分判云 + 时间门控。
  // usable=true 才可用于修正预测: 数据新鲜 && 观测时间在日落前 45min~3.5h (白天真彩有效期)。
  getWindowForSite(lat, lon, distKm = 130, date = new Date()) {
    const az = sunsetAzimuthDeg(lat, lon, date);
    const w = this.getWindow(lat, lon, az, distKm);
    w.azimuthDeg = Math.round(az);
    w.usable = false;
    if (w.available && w.fresh && this.observedAt) {
      w.cloudCover = this.estimateCloudCover(lat, lon, az);
      const sunset = SunCalc.getTimes(date, lat, lon).sunset;
      const minutesBeforeSunset = (sunset.getTime() - this.observedAt.getTime()) / 60000;
      w.minutesBeforeSunset = Math.round(minutesBeforeSunset);
      w.usable = Number.isFinite(w.cloudCover)
        && minutesBeforeSunset >= USABLE_MIN_BEFORE_SUNSET
        && minutesBeforeSunset <= USABLE_MAX_BEFORE_SUNSET;
    }
    return w;
  }

  start() {
    this.refresh().catch((e) => console.error('[satellite] refresh failed:', e.message));
    this.timer = setInterval(() => {
      this.refresh().catch((e) => console.error('[satellite] refresh failed:', e.message));
    }, this.refreshMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// 计算某站给定日期的日落方位角 (北顺时针, 度)
function sunsetAzimuthDeg(lat, lon, date) {
  const t = SunCalc.getTimes(date, lat, lon);
  const pos = SunCalc.getPosition(t.sunset, lat, lon);
  let az = pos.azimuth;
  if (Math.abs(az) > 2 * Math.PI) az = az * Math.PI / 180; // 适配 suncalc 返回度数
  let deg = (az * 180 / Math.PI + 360) % 360;
  return deg;
}

module.exports = {
  SatelliteNowcast,
  SUB_LON,
  CLOUD_LUM,
  sunsetAzimuthDeg,
  USABLE_MIN_BEFORE_SUNSET,
  USABLE_MAX_BEFORE_SUNSET,
};
