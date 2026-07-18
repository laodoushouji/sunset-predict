#!/usr/bin/env bash

set -Eeuo pipefail

release_dir=/root/sunset-predict-v2
archive_file=/root/sunset-predict-v2.tar.gz
env_staging=/root/sunset-predict-v2.env
nginx_file=/etc/nginx/conf.d/sunset.conf
service_file=/etc/systemd/system/sunset-predict.service
backup_root=/root/sunset-backups
deploy_stamp=$(date -u +%Y%m%dT%H%M%SZ)
node_bin=$(command -v node)
previous_release=""
previous_service_active=0
nginx_backup="$backup_root/sunset.conf.pre-v2-$deploy_stamp"
service_backup="$backup_root/sunset-predict.service.pre-v2-$deploy_stamp"
history_root=/var/lib/sunset-predict/history
feedback_root=/var/lib/sunset-predict/feedback
cache_root=/var/lib/sunset-predict/cache

if systemctl is-active --quiet sunset-predict.service; then
  previous_service_active=1
fi

rollback() {
  rollback_code=$?
  trap - ERR
  set +e
  echo "ROLLBACK_START code=$rollback_code"
  systemctl stop sunset-predict.service

  if [ -f "$service_backup" ]; then
    cp "$service_backup" "$service_file"
    systemctl daemon-reload
  fi

  if [ -n "$previous_release" ] && [ -d "$previous_release" ]; then
    failed_release="$backup_root/sunset-predict-v2.failed-$deploy_stamp"
    if [ -d "$release_dir" ]; then
      mv "$release_dir" "$failed_release"
    fi
    mv "$previous_release" "$release_dir"
  fi

  if [ "$previous_service_active" -eq 1 ]; then
    systemctl start sunset-predict.service
  fi

  if [ -f "$nginx_backup" ]; then
    cp "$nginx_backup" "$nginx_file"
    nginx -t && nginx -s reload
  fi

  echo "ROLLBACK_COMPLETE"
  exit "$rollback_code"
}

trap rollback ERR

test -f "$archive_file"
test -f "$env_staging"
test -s "$env_staging"
test -f "$backup_root/sunset-before-deploy-20260717T053910Z.tar.gz"
mkdir -p "$backup_root"

if [ -d "$release_dir" ]; then
  previous_release="$backup_root/sunset-predict-v2.pre-$deploy_stamp"
  mv "$release_dir" "$previous_release"
fi

mkdir -p "$release_dir"
tar -xzf "$archive_file" -C "$release_dir"
mv "$env_staging" "$release_dir/.env"
chmod 600 "$release_dir/.env"
install -d -m 750 "$history_root"
install -d -m 750 "$feedback_root"
install -d -m 750 "$cache_root"

"$node_bin" --check "$release_dir/worker/src/server.mjs"
"$node_bin" --check "$release_dir/worker/src/services/prediction.js"
"$node_bin" --check "$release_dir/worker/src/services/shanghai.js"
"$node_bin" --check "$release_dir/worker/src/services/xihu.js"
"$node_bin" --check "$release_dir/worker/src/services/cities.js"
"$node_bin" --check "$release_dir/worker/src/services/timeline.js"
"$node_bin" --check "$release_dir/worker/src/services/feedback.js"
"$node_bin" --check "$release_dir/worker/src/services/memory-cache.js"
"$node_bin" --check "$release_dir/worker/src/services/sunset-window.js"
"$node_bin" --test "$release_dir"/worker/tests/*.test.js

cp "$nginx_file" "$nginx_backup"
cp "$service_file" "$service_backup"
install -m 644 "$release_dir/deploy/sunset-predict.service" "$service_file"
systemctl daemon-reload
systemctl enable sunset-predict.service
systemctl restart sunset-predict.service

service_ready=0
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3003/health >/dev/null; then
    service_ready=1
    break
  fi
  sleep 1
done
test "$service_ready" -eq 1

curl -fsS http://127.0.0.1:3003/ >/dev/null
curl -fsS http://127.0.0.1:3003/credits >/dev/null
curl -fsS -D /tmp/sunset-v2-robots-headers.txt http://127.0.0.1:3003/robots.txt -o /tmp/sunset-v2-robots.txt
curl -fsS -D /tmp/sunset-v2-sitemap-headers.txt http://127.0.0.1:3003/sitemap.xml -o /tmp/sunset-v2-sitemap.xml
grep -Eiq '^content-type: text/plain; charset=utf-8' /tmp/sunset-v2-robots-headers.txt
grep -Eiq '^content-type: application/xml; charset=utf-8' /tmp/sunset-v2-sitemap-headers.txt
grep -Fq 'Sitemap: https://sunsetpredict.cloud/sitemap.xml' /tmp/sunset-v2-robots.txt
grep -Fq '<loc>https://sunsetpredict.cloud/</loc>' /tmp/sunset-v2-sitemap.xml
grep -Fq '<loc>https://sunsetpredict.cloud/credits</loc>' /tmp/sunset-v2-sitemap.xml
curl -fsS http://127.0.0.1:3003/css/styles.css >/dev/null
curl -fsS http://127.0.0.1:3003/js/app.js >/dev/null
curl -fsS http://127.0.0.1:3003/assets/xihu-sunset.webp -o /tmp/sunset-v2-xihu-image.webp
curl -fsS http://127.0.0.1:3003/assets/waitan-sunset.webp -o /tmp/sunset-v2-waitan-image.webp
test "$(sha256sum /tmp/sunset-v2-xihu-image.webp | awk '{print $1}')" = "cc55ec6e2e0b155c781a8e6e8ff62538cb35b79364adbe68d8089cf8442977c7"
test "$(sha256sum /tmp/sunset-v2-waitan-image.webp | awk '{print $1}')" = "f51150c5a0a9fe5fa51cee565c2e049d2334c9c984cdba075630dbf9c378c9ae"
test "$(wc -c < /tmp/sunset-v2-xihu-image.webp)" -lt 200000
test "$(wc -c < /tmp/sunset-v2-waitan-image.webp)" -lt 200000
for slug in beijing erhai chongqing xiamen qingdao chengdu shenzhen huangshan; do
  curl -fsS "http://127.0.0.1:3003/assets/city-$slug.webp" -o "/tmp/sunset-v2-city-$slug.webp"
  test "$(wc -c < "/tmp/sunset-v2-city-$slug.webp")" -lt 200000
done
test "$(sha256sum /tmp/sunset-v2-city-erhai.webp | awk '{print $1}')" = "c2639568e5ea7a47a64704257d479940981f5e66fd5c40bec20e5a77be441ed7"
test "$(sha256sum /tmp/sunset-v2-city-xiamen.webp | awk '{print $1}')" = "2b41389d896005cb8e2a975ce5bd177ed74d50eeee90ed00f8fd993c6d937dd5"
test "$(sha256sum /tmp/sunset-v2-city-qingdao.webp | awk '{print $1}')" = "763719f74811494ff257bd9b8cb15f1d0c8e8bb0d9b274c46eabe411a833a4ac"
curl -fsS http://127.0.0.1:3003/wechat-pay.jpg -o /tmp/sunset-v2-qr-check.jpg
test "$(sha256sum /tmp/sunset-v2-qr-check.jpg | awk '{print $1}')" = "963811c8cd09b1a445d4bb97df695c4f1df6fdb51f05bc09fa5ee24ed00203a5"
curl -fsS http://127.0.0.1:3003/assets/business.jpg -o /tmp/sunset-v2-business-check.jpg
test "$(sha256sum /tmp/sunset-v2-business-check.jpg | awk '{print $1}')" = "d360f674a918462f75f8f3a1e9abe6d71b2b6295fbecc977480799b4938394d9"

curl -fsS http://127.0.0.1:3003/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const m=j.metrics;if(j.spot!=='xihu'||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3'||j.source!=='xihu-model-v3'||j.timeOffsetMinutes!==-15||j.sourceStatus?.waqi!=='connected'||j.days?.length!==3||j.days.some(d=>typeof d.rawQuality!=='number'||typeof d.probability!=='number')||![m?.cloudLow,m?.cloudMid,m?.cloudHigh,m?.visibilityKm,m?.windowTransparency].every(Number.isFinite))process.exit(1)})"
curl -fsS http://127.0.0.1:3003/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const m=j.metrics;if(j.sourceStatus?.precipitation!=='connected'||![m?.precipitationMm,m?.precipitationRateMmH,m?.precipitationProbability,m?.weatherCode].every(Number.isFinite))process.exit(1)})"
curl -fsS http://127.0.0.1:3003/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(typeof j.weather?.label!=='string'||typeof j.weather?.kind!=='string'||(j.weather.blocksSunset&&(j.quality!==0||j.probability!==0)))process.exit(1)})"
curl -fsS http://127.0.0.1:3003/api/spot/waitan | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const m=j.metrics;if(j.spot!=='waitan'||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3'||j.source!=='waitan-model-v4'||j.sourceStatus?.waqi!=='connected'||j.sourceStatus?.precipitation!=='connected'||typeof j.weather?.label!=='string'||![m?.cloudLow,m?.cloudMid,m?.cloudHigh,m?.visibilityKm,m?.windowTransparency,m?.precipitationRateMmH,m?.precipitationProbability,m?.weatherCode].every(Number.isFinite)||(j.weather.blocksSunset&&(j.quality!==0||j.probability!==0)))process.exit(1)})"
curl -fsS http://127.0.0.1:3003/api/timeline -o /tmp/sunset-v2-timeline.json
"$node_bin" -e "const j=require('/tmp/sunset-v2-timeline.json');const today=j.days?.find(d=>d.offset===0);if(!/^\d{4}-\d{2}-\d{2}$/.test(j.today)||j.days?.length<3||today?.xihu?.spot!=='xihu'||today?.waitan?.spot!=='waitan'||today?.spots?.length!==8||today.xihu.modelVersion!=='quality-v3'||typeof today.xihu.rawQuality!=='number')process.exit(1)"
"$node_bin" -e "const j=require('/tmp/sunset-v2-timeline.json');const d=j.days.find(x=>x.offset===0);const items=[d.xihu,d.waitan,...d.spots];if(items.length!==10||items.some((x,i)=>!x.sunsetWindow||!Array.isArray(x.sunsetWindow.timeline)||x.sunsetWindow.timeline.length>6||(x.sunsetWindow.available&&(!x.sunsetWindow.timeline?.some(n=>n.time===x.sunsetWindow.peakTime)||x.sunsetWindow.timeline.filter(n=>Number.isFinite(n.quality)).length<3))||x.sunsetWindow.timeline?.some(n=>n.resolution!==(i===0?'native-15m':'interpolated-from-hourly'))))process.exit(1)"
timeline_today=$("$node_bin" -p "require('/tmp/sunset-v2-timeline.json').today")
test -s "$history_root/$timeline_today.json"
"$node_bin" -e "const j=require(process.argv[1]);if(j.schemaVersion!==2||j.modelVersion!=='quality-v3'||j.calibration?.xihu?.outputs?.rawQuality!==j.xihu.rawQuality||!j.calibration?.xihu?.inputs?.model||!Array.isArray(j.calibration?.xihu?.adjustments))process.exit(1)" "$history_root/$timeline_today.json"
curl -fsS http://127.0.0.1:3003/api/spots -o /tmp/sunset-v2-regional-spots.json
"$node_bin" -e "const j=require('/tmp/sunset-v2-regional-spots.json');if(j.spots?.length!==8||j.spots.some(s=>typeof s.spot!=='string'||(typeof s.quality==='number'?(!Number.isFinite(s.rawQuality)||s.rawQuality!==s.quality||!Number.isFinite(s.probability)||typeof s.verdict!=='string'||s.modelVersion!=='quality-v3'||!s.source?.endsWith('-model-v3')||!['NONE','CLEAR','FAIR','GREAT','FIRE'].includes(s.grade)||s.sourceStatus?.precipitation!=='connected'||typeof s.weather?.label!=='string'||![s.metrics?.cloudLow,s.metrics?.cloudMid,s.metrics?.cloudHigh,s.metrics?.visibilityKm,s.metrics?.windowTransparency,s.metrics?.precipitationRateMmH,s.metrics?.precipitationProbability,s.metrics?.weatherCode].every(Number.isFinite)||(s.weather.blocksSunset&&(s.quality!==0||s.probability!==0))):typeof s.error!=='string')))process.exit(1)"
for slug in beijing erhai chongqing xiamen qingdao chengdu shenzhen huangshan; do
  status=$(curl -sS -o "/tmp/sunset-v2-$slug.json" -w '%{http_code}' "http://127.0.0.1:3003/api/spot/$slug")
  "$node_bin" -e "const j=JSON.parse(require('fs').readFileSync('/tmp/sunset-v2-'+process.argv[1]+'.json'));const status=process.argv[2];if(status==='200'?(j.spot!==process.argv[1]||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3'||!j.source?.endsWith('-model-v3')||j.forecast?.length!==3||![j.metrics?.cloudLow,j.metrics?.cloudMid,j.metrics?.cloudHigh,j.metrics?.visibilityKm,j.metrics?.windowTransparency].every(Number.isFinite)):(status!=='502'||j.error!=='Prediction service unavailable'))process.exit(1)" "$slug" "$status"
done
"$node_bin" -e "const h=require('/tmp/sunset-v2-huangshan.json');if(typeof h.quality==='number'&&(h.dataAvailability?.cloudBaseHeight!=='pressure-level-proxy'||h.sourceStatus?.cloudBaseHeight!=='pressure-level-proxy'))process.exit(1);const x=require('/tmp/sunset-v2-xiamen.json');if(typeof x.quality==='number'&&x.dataAvailability?.lowLevelHumidity!=='connected')process.exit(1)"
curl -fsS http://127.0.0.1:3003/api/spot/jingshan | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.spot!=='beijing'||j.source!=='beijing-model-v3'||j.modelVersion!=='quality-v3')process.exit(1)})"

install -m 644 "$release_dir/deploy/sunset.conf" "$nginx_file"
nginx -t
nginx -s reload

test "$(curl -sS -o /dev/null -w '%{http_code}' http://sunsetpredict.cloud/)" = "301"
test "$(curl -sS -o /dev/null -w '%{http_code}' https://sunsetpredict.cloud/)" = "200"
curl -fsS https://sunsetpredict.cloud/ -o /tmp/sunset-v2-public-index.html
grep -Fq '<title>晚霞预测 - 今日火烧云概率与摄影指南 | Sunset Predict</title>' /tmp/sunset-v2-public-index.html
grep -Fq '<meta name="description" content="专业提供杭州西湖、上海外滩等热门景区晚霞、火烧云精准预测。结合 250hPa 高空湿度与格点气象算法，为摄影师提供机位建议与参数指导。">' /tmp/sunset-v2-public-index.html
grep -Fq '<meta name="keywords" content="晚霞预测, 火烧云预报, 西湖摄影, 外滩日落, 摄影机位, 杭州天气">' /tmp/sunset-v2-public-index.html
grep -q "西湖" /tmp/sunset-v2-public-index.html
grep -q "上海外滩" /tmp/sunset-v2-public-index.html
grep -q "全国摄影站" /tmp/sunset-v2-public-index.html
grep -q "detail-overlay" /tmp/sunset-v2-public-index.html
grep -q "物理层拆解" /tmp/sunset-v2-public-index.html
grep -q "作者碎碎念" /tmp/sunset-v2-public-index.html
grep -q "20260717-feedback-open-v23" /tmp/sunset-v2-public-index.html
grep -q "20260718-city-caption-align-v24" /tmp/sunset-v2-public-index.html
grep -q 'id="sunset-window-track"' /tmp/sunset-v2-public-index.html
grep -q 'id="sunset-window-details"' /tmp/sunset-v2-public-index.html
grep -q 'id="feedback-title"' /tmp/sunset-v2-public-index.html
grep -q 'id="feedback-submit"' /tmp/sunset-v2-public-index.html
grep -q 'data-feedback-quality="95"' /tmp/sunset-v2-public-index.html
grep -q 'id="xihu-day-status"' /tmp/sunset-v2-public-index.html
grep -q 'id="waitan-weather"' /tmp/sunset-v2-public-index.html
grep -q 'id="weather-condition"' /tmp/sunset-v2-public-index.html
grep -q 'id="weather-precipitation"' /tmp/sunset-v2-public-index.html
"$node_bin" -e "const h=require('fs').readFileSync('/tmp/sunset-v2-public-index.html','utf8');const h1=h.match(/<h1\\b/g)||[];if(h1.length!==1||!/<h1 class=\"score\"[^>]*>[\\s\\S]*?id=\"score-value\"[\\s\\S]*?<\\/h1>/.test(h))process.exit(1);const images=h.match(/<img\\b[^>]*>/g)||[];if(!images.length||images.some(tag=>!/\\balt=\"[^\"]+\"/.test(tag)))process.exit(1);const footer=h.match(/<footer class=\"site-footer\">([\\s\\S]*?)<\\/footer>/)?.[1]||'';if(!footer.includes('class=\"support glass-panel\"')||!footer.includes('class=\"footer\"'))process.exit(1)"
grep -q "寻找本地合作伙伴：咖啡/酒店/摄影。" /tmp/sunset-v2-public-index.html
grep -q "咖啡 · 住宿 · 器材租赁 · 摄影服务" /tmp/sunset-v2-public-index.html
grep -q 'id="partner-card-open"' /tmp/sunset-v2-public-index.html
grep -q 'id="partner-modal"' /tmp/sunset-v2-public-index.html
grep -q "为浪漫续航" /tmp/sunset-v2-public-index.html
grep -q "算法服务器由个人开发者维护。你的每一份支持，都将用于获取更高精度的全球气象格点数据。" /tmp/sunset-v2-public-index.html
if grep -Eiq '请我们喝杯咖啡|Buy me a coffee|support__button--coffee|buymeacoffee\.com|支付宝|alipay' /tmp/sunset-v2-public-index.html; then
  echo "Legacy donation copy or payment method still present" >&2
  exit 1
fi
"$node_bin" -e "const h=require('fs').readFileSync('/tmp/sunset-v2-public-index.html','utf8');const regional=h.indexOf('class=\"regional\"');const support=h.indexOf('class=\"support glass-panel\"');const footer=h.indexOf('class=\"footer\"');if(!(regional<support&&support<footer))process.exit(1)"
grep -q 'id="partner-card-open"' /tmp/sunset-v2-public-index.html
if grep -Eiq 'Yesterday on location|昨日实况|yesterday-photo' /tmp/sunset-v2-public-index.html; then
  echo "Yesterday module still present" >&2
  exit 1
fi
if grep -Eq 'id="verdict-panel"|今日判断' /tmp/sunset-v2-public-index.html; then
  echo "Verdict module still present" >&2
  exit 1
fi
if grep -Eq 'id="color-tag"|id="color-dot"|id="color-label"|银灰雾霭' /tmp/sunset-v2-public-index.html; then
  echo "Legacy Xihu color tag still present" >&2
  exit 1
fi
if grep -q "三日趋势" /tmp/sunset-v2-public-index.html; then
  echo "Three-day outlook module still present" >&2
  exit 1
fi
grep -q "观测成功率" /tmp/sunset-v2-public-index.html
if grep -Eq "地区背景图片署名|图片：|footer__credits" /tmp/sunset-v2-public-index.html; then
  echo "Visible image credit row still present" >&2
  exit 1
fi
grep -q 'href="/credits"' /tmp/sunset-v2-public-index.html
curl -fsS https://sunsetpredict.cloud/credits -o /tmp/sunset-v2-public-credits.html
grep -q "图片版权说明" /tmp/sunset-v2-public-credits.html
curl -fsS -D /tmp/sunset-v2-public-robots-headers.txt https://sunsetpredict.cloud/robots.txt -o /tmp/sunset-v2-public-robots.txt
curl -fsS -D /tmp/sunset-v2-public-sitemap-headers.txt https://sunsetpredict.cloud/sitemap.xml -o /tmp/sunset-v2-public-sitemap.xml
grep -Eiq '^content-type: text/plain; charset=utf-8' /tmp/sunset-v2-public-robots-headers.txt
grep -Eiq '^content-type: application/xml; charset=utf-8' /tmp/sunset-v2-public-sitemap-headers.txt
grep -Fq 'Disallow: /api/' /tmp/sunset-v2-public-robots.txt
grep -Fq 'Sitemap: https://sunsetpredict.cloud/sitemap.xml' /tmp/sunset-v2-public-robots.txt
grep -Fq '<loc>https://sunsetpredict.cloud/</loc>' /tmp/sunset-v2-public-sitemap.xml
grep -Fq '<loc>https://sunsetpredict.cloud/credits</loc>' /tmp/sunset-v2-public-sitemap.xml
"$node_bin" -e "const h=require('fs').readFileSync('/tmp/sunset-v2-public-index.html','utf8');if(!/<\/section>\s*<nav class=\"day-switcher/.test(h))process.exit(1)"
grep -q "assets/xihu-sunset.webp" /tmp/sunset-v2-public-index.html
grep -q "assets/waitan-sunset.webp" /tmp/sunset-v2-public-index.html
if grep -Eiq 'src="https?://[^"]*wikimedia\.org' /tmp/sunset-v2-public-index.html; then exit 1; fi
curl -fsS https://sunsetpredict.cloud/css/styles.css -o /tmp/sunset-v2-public-styles.css
"$node_bin" -e "const c=require('fs').readFileSync('/tmp/sunset-v2-public-styles.css','utf8');const b=c.match(/\.live-badge\s*\{([^}]*)\}/)?.[1]||'';if(!/position:\s*absolute/.test(b)||!/top:\s*0/.test(b)||!/right:\s*0/.test(b))process.exit(1)"
grep -q "@media (max-width: 720px)" /tmp/sunset-v2-public-styles.css
grep -q "repeat(2, minmax(0, 1fr))" /tmp/sunset-v2-public-styles.css
grep -q "progress-glow-pulse" /tmp/sunset-v2-public-styles.css
grep -q "progress__fill.orange" /tmp/sunset-v2-public-styles.css
grep -q "detail-overlay.open" /tmp/sunset-v2-public-styles.css
grep -q "translate(-50%, 105%)" /tmp/sunset-v2-public-styles.css
grep -q "grid-template-rows: auto minmax(0, 1fr) 38px 22px 4px 28px" /tmp/sunset-v2-public-styles.css
grep -q "probability-pill.high" /tmp/sunset-v2-public-styles.css
grep -q ".weather-badge.rain-heavy" /tmp/sunset-v2-public-styles.css
grep -q ".observation-feedback" /tmp/sunset-v2-public-styles.css
curl -fsS https://sunsetpredict.cloud/js/app.js -o /tmp/sunset-v2-public-app.js
grep -q 'alt="${spot.name}标志性晚霞摄影景观"' /tmp/sunset-v2-public-app.js
grep -q 'image.alt = data?.imageAlt' /tmp/sunset-v2-public-app.js
if grep -Eq 'COLOR_DOT_MAP|color-dot|color-label|银灰雾霭' /tmp/sunset-v2-public-app.js; then
  echo "Legacy Xihu color renderer still present" >&2
  exit 1
fi
grep -q "/api/spot/waitan" /tmp/sunset-v2-public-app.js
grep -q "/api/spots" /tmp/sunset-v2-public-app.js
grep -q "SCORE_COLOR_CLASSES" /tmp/sunset-v2-public-app.js
grep -q "score > 85" /tmp/sunset-v2-public-app.js
grep -q "/api/timeline" /tmp/sunset-v2-public-app.js
grep -q "changeDay(deltaX > 0 ? 1 : -1)" /tmp/sunset-v2-public-app.js
grep -q '#!${spotId}' /tmp/sunset-v2-public-app.js
grep -q "bindDetailDrag" /tmp/sunset-v2-public-app.js
grep -q "renderSunsetWindow(data)" /tmp/sunset-v2-public-app.js
grep -q "openDetail(card.dataset.spot)" /tmp/sunset-v2-public-app.js
grep -q 'updateDetailUrl(open, spotId' /tmp/sunset-v2-public-app.js
grep -q 'DETAIL_SPOTS' /tmp/sunset-v2-public-app.js
grep -q 'SCENIC_CAPTIONS' /tmp/sunset-v2-public-app.js
grep -q 'getScenicCaption(data.spot, score, data.probability)' /tmp/sunset-v2-public-app.js
grep -q '身在雾中 · 云幕封山 · 霞光无从抵达' /tmp/sunset-v2-public-app.js
grep -q 'let advertiserData = window.advertiserData || null' /tmp/sunset-v2-public-app.js
grep -q 'renderPartnerCard(advertiserData, spotId)' /tmp/sunset-v2-public-app.js
if grep -Eq 'verdict-eyebrow|verdict-text' /tmp/sunset-v2-public-app.js; then
  echo "Verdict renderer still present" >&2
  exit 1
fi
grep -q "function renderProbability" /tmp/sunset-v2-public-app.js
grep -q "city-card__image" /tmp/sunset-v2-public-app.js
grep -q "function renderWeatherBadge" /tmp/sunset-v2-public-app.js
grep -q "function renderWeatherDetails" /tmp/sunset-v2-public-app.js
grep -q "function submitObservationFeedback" /tmp/sunset-v2-public-app.js
grep -q "const FEEDBACK_API_URL = '/api/feedback'" /tmp/sunset-v2-public-app.js
curl -fsS https://sunsetpredict.cloud/wechat-pay.jpg -o /tmp/sunset-v2-public-qr-check.jpg
test "$(sha256sum /tmp/sunset-v2-public-qr-check.jpg | awk '{print $1}')" = "963811c8cd09b1a445d4bb97df695c4f1df6fdb51f05bc09fa5ee24ed00203a5"
curl -fsS https://sunsetpredict.cloud/assets/business.jpg -o /tmp/sunset-v2-public-business-check.jpg
test "$(sha256sum /tmp/sunset-v2-public-business-check.jpg | awk '{print $1}')" = "d360f674a918462f75f8f3a1e9abe6d71b2b6295fbecc977480799b4938394d9"
curl -fsS https://sunsetpredict.cloud/assets/xihu-sunset.webp -o /tmp/sunset-v2-public-xihu-image.webp
curl -fsS https://sunsetpredict.cloud/assets/waitan-sunset.webp -o /tmp/sunset-v2-public-waitan-image.webp
test "$(sha256sum /tmp/sunset-v2-public-xihu-image.webp | awk '{print $1}')" = "cc55ec6e2e0b155c781a8e6e8ff62538cb35b79364adbe68d8089cf8442977c7"
test "$(sha256sum /tmp/sunset-v2-public-waitan-image.webp | awk '{print $1}')" = "f51150c5a0a9fe5fa51cee565c2e049d2334c9c984cdba075630dbf9c378c9ae"
for slug in beijing erhai chongqing xiamen qingdao chengdu shenzhen huangshan; do
  curl -fsS "https://sunsetpredict.cloud/assets/city-$slug.webp" -o "/tmp/sunset-v2-public-city-$slug.webp"
  test "$(wc -c < "/tmp/sunset-v2-public-city-$slug.webp")" -lt 200000
done
test "$(sha256sum /tmp/sunset-v2-public-city-erhai.webp | awk '{print $1}')" = "c2639568e5ea7a47a64704257d479940981f5e66fd5c40bec20e5a77be441ed7"
test "$(sha256sum /tmp/sunset-v2-public-city-xiamen.webp | awk '{print $1}')" = "2b41389d896005cb8e2a975ce5bd177ed74d50eeee90ed00f8fd993c6d937dd5"
test "$(sha256sum /tmp/sunset-v2-public-city-qingdao.webp | awk '{print $1}')" = "763719f74811494ff257bd9b8cb15f1d0c8e8bb0d9b274c46eabe411a833a4ac"

curl -fsS https://sunsetpredict.cloud/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const m=j.metrics;if(j.spot!=='xihu'||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3'||j.source!=='xihu-model-v3'||j.timeOffsetMinutes!==-15||j.sourceStatus?.waqi!=='connected'||j.days?.length!==3||j.days.some(d=>typeof d.rawQuality!=='number'||typeof d.probability!=='number')||![m?.cloudLow,m?.cloudMid,m?.cloudHigh,m?.visibilityKm,m?.windowTransparency].every(Number.isFinite))process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const m=j.metrics;if(j.sourceStatus?.precipitation!=='connected'||![m?.precipitationMm,m?.precipitationRateMmH,m?.precipitationProbability,m?.weatherCode].every(Number.isFinite))process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(typeof j.weather?.label!=='string'||typeof j.weather?.kind!=='string'||(j.weather.blocksSunset&&(j.quality!==0||j.probability!==0)))process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/sunset/ | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.spot!=='xihu'||typeof j.quality!=='number')process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/api/spot/waitan | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const m=j.metrics;if(j.spot!=='waitan'||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3'||j.source!=='waitan-model-v4'||j.sourceStatus?.waqi!=='connected'||j.sourceStatus?.precipitation!=='connected'||typeof j.weather?.label!=='string'||![m?.cloudLow,m?.cloudMid,m?.cloudHigh,m?.visibilityKm,m?.windowTransparency,m?.precipitationRateMmH,m?.precipitationProbability,m?.weatherCode].every(Number.isFinite)||(j.weather.blocksSunset&&(j.quality!==0||j.probability!==0)))process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/api/timeline -o /tmp/sunset-v2-public-timeline.json
"$node_bin" -e "const j=require('/tmp/sunset-v2-public-timeline.json');if(j.days?.length<3||j.days.find(d=>d.offset===0)?.spots?.length!==8)process.exit(1)"
"$node_bin" -e "const j=require('/tmp/sunset-v2-public-timeline.json');const d=j.days.find(x=>x.offset===0);const items=[d.xihu,d.waitan,...d.spots];if(items.some(x=>!x.sunsetWindow||!Array.isArray(x.sunsetWindow.timeline)||x.sunsetWindow.timeline.length>6))process.exit(1)"
curl -fsS https://sunsetpredict.cloud/api/spots -o /tmp/sunset-v2-public-regional-spots.json
"$node_bin" -e "const j=require('/tmp/sunset-v2-public-regional-spots.json');if(j.spots?.length!==8||j.spots.some(s=>typeof s.spot!=='string'||(typeof s.quality==='number'?(!Number.isFinite(s.rawQuality)||s.rawQuality!==s.quality||!Number.isFinite(s.probability)||typeof s.verdict!=='string'||s.modelVersion!=='quality-v3'||!s.source?.endsWith('-model-v3')||!['NONE','CLEAR','FAIR','GREAT','FIRE'].includes(s.grade)||s.sourceStatus?.precipitation!=='connected'||typeof s.weather?.label!=='string'||![s.metrics?.cloudLow,s.metrics?.cloudMid,s.metrics?.cloudHigh,s.metrics?.visibilityKm,s.metrics?.windowTransparency,s.metrics?.precipitationRateMmH,s.metrics?.precipitationProbability,s.metrics?.weatherCode].every(Number.isFinite)||(s.weather.blocksSunset&&(s.quality!==0||s.probability!==0))):typeof s.error!=='string')))process.exit(1)"
for slug in beijing erhai chongqing xiamen qingdao chengdu shenzhen huangshan; do
  status=$(curl -sS -o "/tmp/sunset-v2-public-$slug.json" -w '%{http_code}' "https://sunsetpredict.cloud/api/spot/$slug")
  "$node_bin" -e "const j=JSON.parse(require('fs').readFileSync('/tmp/sunset-v2-public-'+process.argv[1]+'.json'));const status=process.argv[2];if(status==='200'?(j.spot!==process.argv[1]||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3'||!j.source?.endsWith('-model-v3')||j.forecast?.length!==3||![j.metrics?.cloudLow,j.metrics?.cloudMid,j.metrics?.cloudHigh,j.metrics?.visibilityKm,j.metrics?.windowTransparency].every(Number.isFinite)):(status!=='502'||j.error!=='Prediction service unavailable'))process.exit(1)" "$slug" "$status"
done
"$node_bin" -e "const h=require('/tmp/sunset-v2-public-huangshan.json');if(typeof h.quality==='number'&&(h.dataAvailability?.cloudBaseHeight!=='pressure-level-proxy'||h.sourceStatus?.cloudBaseHeight!=='pressure-level-proxy'))process.exit(1);const x=require('/tmp/sunset-v2-public-xiamen.json');if(typeof x.quality==='number'&&x.dataAvailability?.lowLevelHumidity!=='connected')process.exit(1)"
curl -fsS https://sunsetpredict.cloud/api/spot/jingshan | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.spot!=='beijing'||j.source!=='beijing-model-v3'||j.modelVersion!=='quality-v3')process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/health | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.ok!==true||!j.services?.includes('feedback-v1'))process.exit(1)})"

invalid_feedback_status=$(curl -sS -o /tmp/sunset-v2-feedback-invalid.json -w '%{http_code}' \
  -H 'content-type: application/json' -d '{}' https://sunsetpredict.cloud/api/feedback)
test "$invalid_feedback_status" = "400"
"$node_bin" -e "const j=require('/tmp/sunset-v2-feedback-invalid.json');if(j.code!=='INVALID_FEEDBACK')process.exit(1)"

feedback_future_date=$("$node_bin" -p "require('/tmp/sunset-v2-public-timeline.json').days.find(day=>day.offset===1).date")
future_feedback_status=$(curl -sS -o /tmp/sunset-v2-feedback-future.json -w '%{http_code}' \
  -H 'content-type: application/json' \
  -d "{\"spot\":\"xihu\",\"date\":\"$feedback_future_date\",\"clientId\":\"deployment_check_client_123456\",\"observed\":true,\"actualQuality\":80}" \
  https://sunsetpredict.cloud/api/feedback)
test "$future_feedback_status" = "409"
"$node_bin" -e "const j=require('/tmp/sunset-v2-feedback-future.json');if(j.code!=='FUTURE_DATE')process.exit(1)"
test -d "$feedback_root"

trap - ERR

old_pid=$(ss -ltnp 'sport = :3001' 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -1)
if [ -n "$old_pid" ] && [ -d "/proc/$old_pid" ]; then
  old_cwd=$(readlink "/proc/$old_pid/cwd" 2>/dev/null || true)
  old_cmd=$(tr '\0' ' ' < "/proc/$old_pid/cmdline" 2>/dev/null || true)
  if [ "$old_cwd" = "/root/sunset-predict" ] && printf '%s' "$old_cmd" | grep -q "server.mjs"; then
    kill -TERM "$old_pid"
    for attempt in $(seq 1 10); do
      [ ! -d "/proc/$old_pid" ] && break
      sleep 1
    done
  fi
fi

systemctl is-active --quiet sunset-predict.service
curl -fsS https://sunsetpredict.cloud/health >/dev/null

echo "DEPLOYMENT_COMPLETE stamp=$deploy_stamp"
echo "NGINX_BACKUP=$nginx_backup"
echo "SERVICE_BACKUP=$service_backup"
