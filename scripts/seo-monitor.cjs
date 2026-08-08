// 监控 sunsetpredict.cloud 的 SEO 健康度（可抓取性 / 索引基础）。
// 不读取 GSC 内部数据（需站长登录），而是直接探测线上页面，
// 捕捉会导致 Google 展示次数下降的技术回归：
//   404、缺 canonical/JSON-LD、sitemap 漂移、GSC 验证文件失效。
// 用法：node scripts/seo-monitor.cjs  （SITE_URL 可用环境变量覆盖）
const SITE_URL = process.env.SITE_URL || 'https://sunsetpredict.cloud';
const VERIFICATION_FILE = 'google644a617b7e117520.html';
const EXPECTED_VERIFICATION = 'google-site-verification: google644a617b7e117520.html';

const checks = [];

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

  const failed = checks.filter(c => !c.pass);
  console.log(`\n结果：${checks.length - failed.length}/${checks.length} 项通过`);
  if (failed.length) {
    console.log('失败项：' + failed.map(c => c.name).join('；'));
    process.exit(1);
  }
  console.log('全部通过 ✓');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
