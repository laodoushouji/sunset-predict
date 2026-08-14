// 监控 sunsetpredict.cloud 的 SEO 健康度（可抓取性 / 索引基础）。
// 不读取 GSC 内部数据（需站长登录），而是直接探测线上页面，
// 捕捉会导致 Google 展示次数下降的技术回归：
//   404、缺 canonical/JSON-LD、sitemap 漂移、GSC 验证文件失效。
// 用法：node scripts/seo-monitor.cjs  （SITE_URL 可用环境变量覆盖）
const SITE_URL = process.env.SITE_URL || 'https://sunsetpredict.cloud';
const VERIFICATION_FILE = 'google644a617b7e117520.html';
const EXPECTED_VERIFICATION = 'google-site-verification: google644a617b7e117520.html';

const checks = [];
const advisories = [];

async function get(pathname, timeout = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(SITE_URL + pathname, { redirect: 'manual', signal: controller.signal });
    const body = await res.text();
    return { status: res.status, body, ok: res.status >= 200 && res.status < 400 };
  } finally {
    clearTimeout(timer);
  }
}

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? 'OK  ' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

// 建议项：报告但不计入失败（用于 P1 待建能力，如 /about 实体定义页）
function recordAdvisory(name, pass, detail) {
  advisories.push({ name, pass, detail });
  console.log(`[${pass ? 'OK  ' : 'WARN'}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  // 1. GSC 所有权验证文件（必须可达，否则 Google 重验时取消验证、流量归零）
  try {
    const v = await get('/' + VERIFICATION_FILE);
    record('GSC 验证文件可访问', v.ok, v.ok ? `200 · ${v.body.length} bytes` : `status ${v.status}`);
    if (v.ok) {
      const trimmed = v.body.trim();
      record('验证文件内容正确', trimmed === EXPECTED_VERIFICATION, trimmed.slice(0, 48));
    }
  } catch (error) {
    record('GSC 验证文件可访问', false, error.message);
  }

  // 2. robots.txt 必须声明 Sitemap
  try {
    const r = await get('/robots.txt');
    const hasSitemap = r.ok && /Sitemap:\s*https?:\/\/\S+/i.test(r.body);
    record('robots.txt 含 Sitemap 声明', hasSitemap, hasSitemap ? 'found' : 'missing');
  } catch (error) {
    record('robots.txt', false, error.message);
  }

  // 3. sitemap + 逐页探测
  let urls = [];
  try {
    const s = await get('/sitemap.xml');
    if (s.ok) {
      urls = [...s.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
      record('sitemap.xml 可访问且含 URL', urls.length > 0, `${urls.length} 条 <loc>`);
    } else {
      record('sitemap.xml 可访问', false, `status ${s.status}`);
    }
  } catch (error) {
    record('sitemap.xml', false, error.message);
  }

  for (const url of urls) {
    const pathname = new URL(url).pathname;
    try {
      const page = await get(pathname);
      const hasTitle = /<title>[^<]+<\/title>/i.test(page.body);
      const hasCanonical = /rel="canonical"/i.test(page.body);
      const hasJsonLd = /application\/ld\+json/i.test(page.body);
      const pass = page.ok && hasTitle && hasCanonical;
      record(
        `页面 ${pathname}`,
        pass,
        page.ok
          ? `200 · title=${hasTitle} · canonical=${hasCanonical} · jsonld=${hasJsonLd}`
          : `status ${page.status}`
      );
    } catch (error) {
      record(`页面 ${pathname}`, false, error.message);
    }
  }

  // 4. GEO 基础：llms.txt 必须可达（AI 爬虫站点地图，P0）
  try {
    const l = await get('/llms.txt');
    record('llms.txt 可访问', l.ok, l.ok ? `200 · ${l.body.length} bytes` : `status ${l.status}`);
  } catch (error) {
    record('llms.txt 可访问', false, error.message);
  }

  // 5. GEO 实体定义页 /about（P1 待建，作为建议项不计入失败）
  try {
    const a = await get('/about');
    const hasTitle = /<title>[^<]+<\/title>/i.test(a.body);
    recordAdvisory('实体定义页 /about 可访问', a.ok, a.ok ? `200 · title=${hasTitle}` : `status ${a.status}（P1 待建，建议补充）`);
  } catch (error) {
    recordAdvisory('实体定义页 /about 可访问', false, `${error.message}（P1 待建，建议补充）`);
  }

  // 6. GEO 爬虫统计：从 /api/geo-stats 读取 AI 爬虫命中（nginx 独立日志聚合）
  //    作为建议项：端点未部署或当前为零爬虫均不计入失败，仅纳入报告供周检观察趋势。
  try {
    const g = await get('/api/geo-stats');
    if (g.ok) {
      let stats = null;
      try { stats = JSON.parse(g.body); } catch { /* ignore */ }
      if (stats && stats.available) {
        const aiTotal = Object.values(stats.aiCrawlers || {}).reduce((a, b) => a + b, 0);
        const llmsAi = Object.values((stats.llmsTxt && stats.llmsTxt.byAi) || {}).reduce((a, b) => a + b, 0);
        recordAdvisory(
          'GEO 爬虫统计 API 可达',
          true,
          `总请求 ${stats.totalRequests} · AI 爬虫合计 ${aiTotal} · llms.txt 被 AI 抓取 ${llmsAi}`
        );
        const dist = Object.entries(stats.aiCrawlers || {})
          .filter(([, n]) => n > 0)
          .map(([k, v]) => `${k}:${v}`)
          .join('  ');
        recordAdvisory('AI 爬虫命中分布', aiTotal > 0, dist || '暂无明显 AI 爬虫访问（llms.txt 上线后需等爬虫重新抓取）');
      } else {
        recordAdvisory('GEO 爬虫统计 API 可达', false, `日志不可用(${stats && stats.error ? stats.error : 'n/a'})`);
      }
    } else {
      recordAdvisory('GEO 爬虫统计 API 可达', false, `status ${g.status}（端点未部署）`);
    }
  } catch (error) {
    recordAdvisory('GEO 爬虫统计 API 可达', false, error.message);
  }

  const failed = checks.filter(c => !c.pass);
  console.log(`\n结果：${checks.length - failed.length}/${checks.length} 项通过`);
  if (failed.length) {
    console.log('失败项：' + failed.map(c => c.name).join('；'));
    process.exit(1);
  }
  console.log('全部通过 ✓');
  if (advisories.length) {
    const advFailed = advisories.filter(c => !c.pass);
    console.log(`\n建议项：${advisories.length - advFailed.length}/${advisories.length} 满足；待建项：` + advFailed.map(c => c.name).join('；'));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
