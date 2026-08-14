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
npm_bin=$(command -v npm)
previous_release=""
previous_service_active=0
nginx_backup="$backup_root/sunset.conf.pre-v2-$deploy_stamp"
service_backup="$backup_root/sunset-predict.service.pre-v2-$deploy_stamp"
history_root=/var/lib/sunset-predict/history
feedback_root=/var/lib/sunset-predict/feedback
cache_root=/var/lib/sunset-predict/cache
forecast_slugs="beijing erhai chongqing xiamen qingdao chengdu shenzhen huangshan guangzhou wuhan sanya xian nanjing xiapu wuxi hongkong dunhuang caoyuan-tianlu hukou longmen haerbin-song wusongdao yalu hengshan lushan fanjing namtso heimahe ejina xiangbishan helanshan kanas taipei tianjin-wudadao coloane"

if systemctl is-active --quiet sunset-predict.service; then
  previous_service_active=1
fi

rollback() {
  rollback_code=${1:-1}
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

trap 'rollback_code=$?; echo "DEPLOY_FAILED at line $LINENO: $BASH_COMMAND (exit $rollback_code)"; rollback "$rollback_code"' ERR

test -f "$archive_file"
test -f "$env_staging"
test -s "$env_staging"
mkdir -p "$backup_root"

if [ -d "$release_dir" ]; then
  previous_release="$backup_root/sunset-predict-v2.pre-$deploy_stamp"
  mv "$release_dir" "$previous_release"
fi

mkdir -p "$release_dir"
tar -xzf "$archive_file" -C "$release_dir"
# 增量发布可以不重复上传未变更的图片；新包中已存在的同名文件优先保留。
if [ -n "$previous_release" ] && [ -d "$previous_release/frontend/assets" ]; then
  mkdir -p "$release_dir/frontend/assets"
  cp -an "$previous_release/frontend/assets/." "$release_dir/frontend/assets/"
fi
mv "$env_staging" "$release_dir/.env"
chmod 600 "$release_dir/.env"

install -d -m 750 "$history_root"
install -d -m 750 "$feedback_root"
install -d -m 750 "$cache_root"

"$npm_bin" ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix "$release_dir"
# 显式重建原生模块（better-sqlite3 / sharp）：ci 用 --ignore-scripts 跳过全量脚本，这里只构建这两个需要的
"$npm_bin" rebuild --prefix "$release_dir" better-sqlite3 sharp

# 重新生成 sitemap.xml，写入当天 lastmod，给 Google 准确的新鲜度信号（避免陈旧 lastmod 拖慢收录）。
# 必须在 npm ci/rebuild 之后：gen-sitemap 经 cities.js→blue-hour.js 依赖 suncalc（生产依赖）。
( cd "$release_dir" && "$node_bin" scripts/gen-sitemap.cjs ) \
  || { echo "gen-sitemap 失败，中止部署" >&2; rollback; }

# SQLite 预热：校验原生模块可加载并建表；失败则回滚，避免上线后崩溃
( cd "$release_dir" && \
  FEEDBACK_ROOT="$feedback_root" ADVERTISERS_DB="$(dirname "$feedback_root")/advertisers.db" \
  "$node_bin" -e "require('./worker/src/services/feedback').getFeedbackStats(process.env.FEEDBACK_ROOT); require('./worker/src/services/advertisers').getAdvertiserConfig(); console.log('sqlite warmup ok')" ) \
  || { echo "SQLite 预热失败（原生模块或建表异常），中止部署" >&2; rollback; }

# 反馈数据兜底迁移：把旧版按日期目录存放的 JSON 留言一次性灌入 feedback.db（幂等，
# 已存在的记录 ON CONFLICT 不重复插入，空库不报错）。确保即便漏跑过迁移，留言在部署后仍不丢失。
# 非致命：迁移异常仅告警，不阻断发布。
( cd "$release_dir" && \
  FEEDBACK_ROOT="$feedback_root" \
  "$node_bin" scripts/migrate-feedback-to-sqlite.cjs "$feedback_root" ) \
  && echo "feedback 迁移 ok" \
  || echo "WARNING: feedback 迁移未执行或出错（不影响发布，留言可能沿用旧存储）" >&2

"$node_bin" --check "$release_dir/worker/src/server.mjs"
"$node_bin" --check "$release_dir/worker/src/services/prediction.js"
"$node_bin" --check "$release_dir/worker/src/services/shanghai.js"
"$node_bin" --check "$release_dir/worker/src/services/xihu.js"
"$node_bin" --check "$release_dir/worker/src/services/cities.js"
"$node_bin" --check "$release_dir/worker/src/services/timeline.js"
"$node_bin" --check "$release_dir/worker/src/services/feedback.js"
"$node_bin" --check "$release_dir/worker/src/services/frontend-bootstrap.js"
"$node_bin" --check "$release_dir/worker/src/services/memory-cache.js"
"$node_bin" --check "$release_dir/worker/src/services/sunset-window.js"
"$node_bin" --check "$release_dir/worker/src/services/qweather.js"
"$node_bin" --check "$release_dir/worker/src/services/blue-hour.js"
"$node_bin" --check "$release_dir/worker/src/services/nearby.js"
"$node_bin" --test "$release_dir"/worker/tests/*.test.js

cp "$nginx_file" "$nginx_backup"
cp "$service_file" "$service_backup"
install -m 644 "$release_dir/deploy/sunset-predict.service" "$service_file"
systemctl daemon-reload
systemctl enable sunset-predict.service
systemctl restart sunset-predict.service

# worker 冷启动（node + 原生模块加载 + 预热）可能需要十几秒，给足窗口
sleep 5
service_ready=0
for attempt in $(seq 1 90); do
  if curl -fsS -m 3 http://127.0.0.1:3003/health >/dev/null 2>&1; then
    service_ready=1
    break
  fi
  sleep 1
done
if [ "$service_ready" -ne 1 ]; then
  echo "HEALTHCHECK_FAILED: worker 在 95 秒内未就绪 (127.0.0.1:3003/health)"
  exit 1
fi

curl -fsS http://127.0.0.1:3003/ >/dev/null
curl -fsS http://127.0.0.1:3003/credits >/dev/null
curl -fsS -D /tmp/sunset-v2-robots-headers.txt http://127.0.0.1:3003/robots.txt -o /tmp/sunset-v2-robots.txt
curl -fsS -D /tmp/sunset-v2-sitemap-headers.txt http://127.0.0.1:3003/sitemap.xml -o /tmp/sunset-v2-sitemap.xml
grep -Eiq '^content-type: text/plain; charset=utf-8' /tmp/sunset-v2-robots-headers.txt
grep -Eiq '^content-type: application/xml; charset=utf-8' /tmp/sunset-v2-sitemap-headers.txt
grep -Fq 'Sitemap: https://sunsetpredict.cloud/sitemap.xml' /tmp/sunset-v2-robots.txt
grep -Fq '<loc>https://sunsetpredict.cloud/</loc>' /tmp/sunset-v2-sitemap.xml
grep -Fq '<loc>https://sunsetpredict.cloud/spots/xihu</loc>' /tmp/sunset-v2-sitemap.xml
grep -Fq '<loc>https://sunsetpredict.cloud/spots/hongkong</loc>' /tmp/sunset-v2-sitemap.xml
test "$(grep -c '<loc>' /tmp/sunset-v2-sitemap.xml)" -eq 38
curl -fsS http://127.0.0.1:3003/spots/xihu -o /tmp/sunset-v2-xihu-page.html
grep -Fq '<link rel="canonical" href="https://sunsetpredict.cloud/spots/xihu">' /tmp/sunset-v2-xihu-page.html
grep -Fq '杭州西湖晚霞预测与摄影指南' /tmp/sunset-v2-xihu-page.html
# 新增省份站点健康检查：必须具备与既有站点一致的预测详情与独立图片
curl -fsS http://127.0.0.1:3003/spots/hukou -o /tmp/sunset-v2-hukou-page.html
grep -Fq '吉县壶口瀑布晚霞预测与摄影指南' /tmp/sunset-v2-hukou-page.html
grep -Fq '吉县壶口瀑布今日晚霞概率' /tmp/sunset-v2-hukou-page.html
curl -fsS http://127.0.0.1:3003/ -o /tmp/sunset-v2-home.html
test "$(grep -o 'id="city-' /tmp/sunset-v2-home.html | wc -l)" -eq 35
if grep -q 'city-card--guide' /tmp/sunset-v2-home.html; then
  echo "Guide-only province cards still present" >&2
  exit 1
fi
if grep -q 'class="province-card"' /tmp/sunset-v2-home.html; then
  echo "Legacy compact province cards still present" >&2
  exit 1
fi
curl -fsS http://127.0.0.1:3003/assets/city-hukou.webp -o /tmp/sunset-v2-city-hukou.webp
test "$(wc -c < /tmp/sunset-v2-city-hukou.webp)" -lt 200000
curl -fsS http://127.0.0.1:3003/css/styles.css >/dev/null
curl -fsS http://127.0.0.1:3003/js/app.js >/dev/null
# 自托管字体上线校验：/assets/fonts/*.woff2 与 /css/fonts.css 必须可访问，否则前端回退系统字体（生僻字缺字/问号）
curl -fsS http://127.0.0.1:3003/assets/fonts/noto-serif-sc-600.woff2 -o /dev/null
curl -fsS http://127.0.0.1:3003/assets/fonts/noto-sans-sc-400.woff2 -o /dev/null
curl -fsS http://127.0.0.1:3003/css/fonts.css -o /dev/null
curl -fsS http://127.0.0.1:3003/assets/xihu-sunset.webp -o /tmp/sunset-v2-xihu-image.webp
curl -fsS http://127.0.0.1:3003/assets/waitan-sunset.webp -o /tmp/sunset-v2-waitan-image.webp
test "$(sha256sum /tmp/sunset-v2-xihu-image.webp | awk '{print $1}')" = "cc55ec6e2e0b155c781a8e6e8ff62538cb35b79364adbe68d8089cf8442977c7"
test "$(sha256sum /tmp/sunset-v2-waitan-image.webp | awk '{print $1}')" = "f51150c5a0a9fe5fa51cee565c2e049d2334c9c984cdba075630dbf9c378c9ae"
test "$(wc -c < /tmp/sunset-v2-xihu-image.webp)" -lt 200000
test "$(wc -c < /tmp/sunset-v2-waitan-image.webp)" -lt 200000
for slug in $forecast_slugs; do
  curl -fsS "http://127.0.0.1:3003/assets/city-$slug.webp" -o "/tmp/sunset-v2-city-$slug.webp"
  test "$(wc -c < "/tmp/sunset-v2-city-$slug.webp")" -lt 200000
done
test "$(sha256sum /tmp/sunset-v2-city-erhai.webp | awk '{print $1}')" = "c2639568e5ea7a47a64704257d479940981f5e66fd5c40bec20e5a77be441ed7"
test "$(sha256sum /tmp/sunset-v2-city-xiamen.webp | awk '{print $1}')" = "7a2cb3424fb4a7eab5c323917fb54fb4efd48fd4916b9edec3ab423138cc8dd2"
test "$(sha256sum /tmp/sunset-v2-city-qingdao.webp | awk '{print $1}')" = "763719f74811494ff257bd9b8cb15f1d0c8e8bb0d9b274c46eabe411a833a4ac"
test "$(sha256sum /tmp/sunset-v2-city-huangshan.webp | awk '{print $1}')" = "f80b7120f867bec059432488c4af6ed55924337d7217e7d796cc592aa8e5198b"
test "$(sha256sum /tmp/sunset-v2-city-guangzhou.webp | awk '{print $1}')" = "e6299f3c50967a10609485119b8c6b7a1488cbd027f5513fad17cc1eb9965419"
test "$(sha256sum /tmp/sunset-v2-city-wuhan.webp | awk '{print $1}')" = "f1498459103ba919fcd61ed4cc64f8d614fb3d3c82fb708dc5ab6641470153db"
test "$(sha256sum /tmp/sunset-v2-city-nanjing.webp | awk '{print $1}')" = "093dd899b57baa8780b07ccd57dd727eea0fab44af779af6c0536839e4772b01"
test "$(sha256sum /tmp/sunset-v2-city-xiapu.webp | awk '{print $1}')" = "386f81249efe0ae950b4d0e5379361eb2a6d8a943cb4b760a399aac57890faa8"
test "$(sha256sum /tmp/sunset-v2-city-wuxi.webp | awk '{print $1}')" = "0d7ea145d82ac19ea4b3e4fb1e8cae0d4e6a574b6cca8b338d0eb7a0476aa148"
curl -fsS http://127.0.0.1:3003/wechat-pay.jpg -o /tmp/sunset-v2-qr-check.jpg
test "$(sha256sum /tmp/sunset-v2-qr-check.jpg | awk '{print $1}')" = "963811c8cd09b1a445d4bb97df695c4f1df6fdb51f05bc09fa5ee24ed00203a5"
curl -fsS http://127.0.0.1:3003/assets/business.jpg -o /tmp/sunset-v2-business-check.jpg
test "$(sha256sum /tmp/sunset-v2-business-check.jpg | awk '{print $1}')" = "d360f674a918462f75f8f3a1e9abe6d71b2b6295fbecc977480799b4938394d9"

# 说明: 天气主源(qweather/open-meteo)与各 sourceStatus 由 worker 动态选择, 冷启动时若外部 API
# 瞬时抖动会被标为 unavailable 或回退主源, 不能据此阻断部署(否则误杀). 仅校验结构/类型,
# 外部连通性由 worker 自身优雅降级, 不属于部署阻断条件.
curl -fsS http://127.0.0.1:3003/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const okStatus=v=>v===undefined||['connected','available','unavailable','degraded','pressure-level-proxy','not-configured'].includes(v);const m=j.metrics;const b=j.blueHour;if(j.spot!=='xihu'||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3.1'||j.source!=='xihu-model-v3'||j.timeOffsetMinutes!==-15||!okStatus(j.sourceStatus?.waqi)||j.days?.length!==3||j.days.some(d=>typeof d.rawQuality!=='number'||typeof d.probability!=='number'||d.blueHour?.source!=='suncalc-2.0.1')||b?.source!=='suncalc-2.0.1'||typeof b.score!=='number'||!/^\d{2}:\d{2}$/.test(b.start)||!/^\d{2}:\d{2}$/.test(b.end)||![m?.cloudLow,m?.cloudMid,m?.cloudHigh,m?.visibilityKm,m?.windowTransparency].every(Number.isFinite))process.exit(1)})"
curl -fsS http://127.0.0.1:3003/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const okStatus=v=>v===undefined||['connected','available','unavailable','degraded','pressure-level-proxy','not-configured'].includes(v);const m=j.metrics;if(!okStatus(j.sourceStatus?.precipitation)||![m?.precipitationMm,m?.precipitationRateMmH,m?.precipitationProbability,m?.weatherCode].every(Number.isFinite))process.exit(1)})"
curl -fsS http://127.0.0.1:3003/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const okStatus=v=>v===undefined||['connected','available','unavailable','degraded','pressure-level-proxy','not-configured'].includes(v);if(!okStatus(j.sourceStatus?.qweather)||typeof j.weather?.source!=='string'||typeof j.weather?.label!=='string'||typeof j.weather?.kind!=='string'||(j.weather.blocksSunset&&(j.quality!==0||j.probability!==0)))process.exit(1)})"
curl -fsS http://127.0.0.1:3003/api/spot/waitan | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const okStatus=v=>v===undefined||['connected','available','unavailable','degraded','pressure-level-proxy','not-configured'].includes(v);const m=j.metrics;const b=j.blueHour;if(j.spot!=='waitan'||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3.1'||j.source!=='waitan-model-v4'||!okStatus(j.sourceStatus?.waqi)||!okStatus(j.sourceStatus?.precipitation)||b?.source!=='suncalc-2.0.1'||typeof b.score!=='number'||typeof j.weather?.label!=='string'||![m?.cloudLow,m?.cloudMid,m?.cloudHigh,m?.visibilityKm,m?.windowTransparency,m?.precipitationRateMmH,m?.precipitationProbability,m?.weatherCode].every(Number.isFinite)||(j.weather.blocksSunset&&(j.quality!==0||j.probability!==0)))process.exit(1)})"
curl -fsS http://127.0.0.1:3003/api/timeline -o /tmp/sunset-v2-timeline.json
"$node_bin" -e "const j=require('/tmp/sunset-v2-timeline.json');const today=j.days?.find(d=>d.offset===0);if(!/^\d{4}-\d{2}-\d{2}$/.test(j.today)||j.days?.length<3||today?.xihu?.spot!=='xihu'||today?.waitan?.spot!=='waitan'||today?.spots?.length!==35||today.xihu.modelVersion!=='quality-v3.1'||typeof today.xihu.rawQuality!=='number')process.exit(1)"
"$node_bin" -e "const j=require('/tmp/sunset-v2-timeline.json');const d=j.days.find(x=>x.offset===0);const items=[d.xihu,d.waitan,...d.spots];if(items.length!==37||items.some((x,i)=>!x.sunsetWindow||!Array.isArray(x.sunsetWindow.timeline)||x.sunsetWindow.timeline.length>6||(x.sunsetWindow.available&&(!x.sunsetWindow.timeline?.some(n=>n.time===x.sunsetWindow.peakTime)||x.sunsetWindow.timeline.filter(n=>Number.isFinite(n.quality)).length<3))||x.sunsetWindow.timeline?.some(n=>n.resolution!==(i===0?'native-15m':'interpolated-from-hourly'))))process.exit(1)"
timeline_today=$("$node_bin" -p "require('/tmp/sunset-v2-timeline.json').today")
test -s "$history_root/$timeline_today.json"
"$node_bin" -e "const j=require(process.argv[1]);if(j.schemaVersion!==2||j.modelVersion!=='quality-v3.1'||j.calibration?.xihu?.outputs?.rawQuality!==j.xihu.rawQuality||!j.calibration?.xihu?.inputs?.model||!Array.isArray(j.calibration?.xihu?.adjustments))process.exit(1)" "$history_root/$timeline_today.json"
curl -fsS http://127.0.0.1:3003/api/spots -o /tmp/sunset-v2-regional-spots.json
"$node_bin" -e "const j=require('/tmp/sunset-v2-regional-spots.json');const okStatus=v=>v===undefined||['connected','available','unavailable','degraded','pressure-level-proxy','not-configured'].includes(v);if(j.spots?.length!==35||j.spots.some(s=>typeof s.spot!=='string'||(typeof s.quality==='number'?(!Number.isFinite(s.rawQuality)||s.rawQuality!==s.quality||!Number.isFinite(s.probability)||typeof s.verdict!=='string'||s.modelVersion!=='quality-v3.1'||!s.source?.endsWith('-model-v3')||!['NONE','CLEAR','FAIR','GREAT','FIRE'].includes(s.grade)||!okStatus(s.sourceStatus?.precipitation)||!okStatus(s.sourceStatus?.qweather)||typeof s.weather?.source!=='string'||typeof s.weather?.label!=='string'||![s.metrics?.cloudLow,s.metrics?.cloudMid,s.metrics?.cloudHigh,s.metrics?.visibilityKm,s.metrics?.windowTransparency,s.metrics?.precipitationRateMmH,s.metrics?.precipitationProbability,s.metrics?.weatherCode].every(Number.isFinite)||(s.weather.blocksSunset&&(s.quality!==0||s.probability!==0))):typeof s.error!=='string')))process.exit(1)"
"$node_bin" -e "const j=require('/tmp/sunset-v2-regional-spots.json');if(j.spots?.some(s=>!s.error&&(!s.blueHour?.available||!/^\\d{2}:\\d{2}$/.test(s.blueHour.start)||!/^\\d{2}:\\d{2}$/.test(s.blueHour.end))))process.exit(1)"
curl -fsS -H 'X-Real-IP: 223.5.5.5' http://127.0.0.1:3003/api/nearby -o /tmp/sunset-v2-nearby.json
"$node_bin" -e "const j=require('/tmp/sunset-v2-nearby.json');if(j.available!==true||j.accuracy!=='city'||j.nearestSpot?.spot!=='xihu'||!Number.isFinite(j.nearestSpot?.distanceKm)||j.ip!==undefined)process.exit(1)"
for slug in $forecast_slugs; do
  status=$(curl -sS -o "/tmp/sunset-v2-$slug.json" -w '%{http_code}' "http://127.0.0.1:3003/api/spot/$slug")
  "$node_bin" -e "const j=JSON.parse(require('fs').readFileSync('/tmp/sunset-v2-'+process.argv[1]+'.json'));const status=process.argv[2];if(status==='200'?(j.spot!==process.argv[1]||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3.1'||!j.source?.endsWith('-model-v3')||j.forecast?.length!==3||![j.metrics?.cloudLow,j.metrics?.cloudMid,j.metrics?.cloudHigh,j.metrics?.visibilityKm,j.metrics?.windowTransparency].every(Number.isFinite)):(status!=='502'||j.error!=='Prediction service unavailable'))process.exit(1)" "$slug" "$status"
done
"$node_bin" -e "const h=require('/tmp/sunset-v2-huangshan.json');if(typeof h.quality==='number'&&(h.dataAvailability?.cloudBaseHeight!=='pressure-level-proxy'||h.sourceStatus?.cloudBaseHeight!=='pressure-level-proxy'))process.exit(1);const x=require('/tmp/sunset-v2-xiamen.json');if(typeof x.quality==='number'&&x.dataAvailability?.lowLevelHumidity!=='connected')process.exit(1)"
curl -fsS http://127.0.0.1:3003/api/spot/jingshan | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.spot!=='beijing'||j.source!=='beijing-model-v3'||j.modelVersion!=='quality-v3.1')process.exit(1)})"

install -m 644 "$release_dir/deploy/sunset.conf" "$nginx_file"
nginx -t
nginx -s reload

test "$(curl -sS -o /dev/null -w '%{http_code}' http://sunsetpredict.cloud/)" = "301"
test "$(curl -sS -o /dev/null -w '%{http_code}' https://sunsetpredict.cloud/)" = "200"
# GSC 所有权验证文件必须可达，否则 Google 重验时取消验证、搜索流量归零
test "$(curl -sS -o /dev/null -w '%{http_code}' https://sunsetpredict.cloud/google644a617b7e117520.html)" = "200"
test "$(curl -fsS https://sunsetpredict.cloud/google644a617b7e117520.html)" = "google-site-verification: google644a617b7e117520.html"
curl -fsS https://sunsetpredict.cloud/ -o /tmp/sunset-v2-public-index.html
curl -fsS --compressed -D /tmp/sunset-v2-public-index-gzip.txt -o /dev/null https://sunsetpredict.cloud/
curl -fsS --compressed -D /tmp/sunset-v2-public-timeline-gzip.txt -o /dev/null https://sunsetpredict.cloud/api/timeline
grep -Eiq '^content-encoding: gzip' /tmp/sunset-v2-public-index-gzip.txt
grep -Eiq '^content-encoding: gzip' /tmp/sunset-v2-public-timeline-gzip.txt
grep -Fq '<title>晚霞预测 - 今日火烧云概率与摄影指南 | Sunset Predict</title>' /tmp/sunset-v2-public-index.html
grep -Fq '<meta name="description" content="专业提供全国 37 个热门摄影地点（杭州西湖、上海外滩、北京故宫、香港维港、敦煌鸣沙山等）晚霞、火烧云预测。结合 250hPa 高空湿度与格点气象算法，为摄影师提供机位建议与参数指导。">' /tmp/sunset-v2-public-index.html
grep -Fq '<link rel="canonical" href="https://sunsetpredict.cloud/">' /tmp/sunset-v2-public-index.html
grep -Fq '<meta property="og:image" content="https://sunsetpredict.cloud/assets/xihu-sunset.webp">' /tmp/sunset-v2-public-index.html
grep -Fq 'id="seo-structured-data" type="application/ld+json"' /tmp/sunset-v2-public-index.html
test "$(grep -o 'id=\"city-' /tmp/sunset-v2-public-index.html | wc -l)" -eq 35
if grep -q 'city-card--guide' /tmp/sunset-v2-public-index.html; then
  echo "Guide-only province cards still present on public homepage" >&2
  exit 1
fi
grep -q "西湖" /tmp/sunset-v2-public-index.html
grep -q "上海外滩" /tmp/sunset-v2-public-index.html
grep -q "全国摄影站" /tmp/sunset-v2-public-index.html
grep -q "detail-overlay" /tmp/sunset-v2-public-index.html
grep -q "物理层拆解" /tmp/sunset-v2-public-index.html
grep -q "作者碎碎念" /tmp/sunset-v2-public-index.html
grep -q "css/styles.css?v=20260811-spot-search-v59" /tmp/sunset-v2-public-index.html
grep -q "js/app.js?v=20260811-spot-search-v59" /tmp/sunset-v2-public-index.html
grep -q 'id="spot-search-toggle"' /tmp/sunset-v2-public-index.html
grep -q 'id="spot-search-input"' /tmp/sunset-v2-public-index.html
grep -q 'id="spot-search-empty"' /tmp/sunset-v2-public-index.html
grep -q '<script async src="https://unpkg.com/lucide@1.25.0/dist/umd/lucide.min.js"></script>' /tmp/sunset-v2-public-index.html
grep -Eq 'id="forecast-bootstrap" type="application/json">\{"today":"[0-9]{4}-[0-9]{2}-[0-9]{2}"' /tmp/sunset-v2-public-index.html
if grep -q 'cdn.tailwindcss.com' /tmp/sunset-v2-public-index.html; then
  echo "Blocking Tailwind runtime still present" >&2
  exit 1
fi
grep -q 'src="/umami/script.js"' /tmp/sunset-v2-public-index.html
grep -q 'data-website-id="890d254b-a58a-44de-a333-421e0345058b"' /tmp/sunset-v2-public-index.html
grep -q 'data-exclude-search="true"' /tmp/sunset-v2-public-index.html
grep -q 'data-exclude-hash="true"' /tmp/sunset-v2-public-index.html
grep -q 'data-do-not-track="true"' /tmp/sunset-v2-public-index.html
grep -q 'id="sunset-window-track"' /tmp/sunset-v2-public-index.html
grep -q 'id="sunset-window-details"' /tmp/sunset-v2-public-index.html
grep -q 'id="feedback-title"' /tmp/sunset-v2-public-index.html
grep -q 'id="feedback-submit"' /tmp/sunset-v2-public-index.html
grep -q 'id="feedback-photo"' /tmp/sunset-v2-public-index.html
grep -q 'id="feedback-comment"' /tmp/sunset-v2-public-index.html
grep -q 'maxlength="300"' /tmp/sunset-v2-public-index.html
grep -q 'id="spot-messages-list"' /tmp/sunset-v2-public-index.html
grep -q 'id="spot-messages-more"' /tmp/sunset-v2-public-index.html
grep -q '全部照片与评论，不按日期筛选' /tmp/sunset-v2-public-index.html
grep -q 'id="detail-share"' /tmp/sunset-v2-public-index.html
if grep -q 'nearby-spot' /tmp/sunset-v2-public-index.html; then
  echo "Nearby spot entry should not appear on frontend" >&2
  exit 1
fi
grep -q 'id="share-poster-modal"' /tmp/sunset-v2-public-index.html
grep -q 'id="share-system-button"' /tmp/sunset-v2-public-index.html
grep -q 'id="share-poster-download"' /tmp/sunset-v2-public-index.html
grep -q '电脑端请先保存长图' /tmp/sunset-v2-public-index.html
if grep -Eq 'data-feedback-(observed|quality)|看到了|没看到|现场记录' /tmp/sunset-v2-public-index.html; then
  echo "Legacy ground-truth controls still present" >&2
  exit 1
fi
grep -q 'id="xihu-day-status"' /tmp/sunset-v2-public-index.html
grep -q 'id="waitan-weather"' /tmp/sunset-v2-public-index.html
grep -q 'id="weather-condition"' /tmp/sunset-v2-public-index.html
grep -q 'id="weather-precipitation"' /tmp/sunset-v2-public-index.html
grep -q 'id="blue-hour-section"' /tmp/sunset-v2-public-index.html
grep -q 'id="blue-hour-countdown"' /tmp/sunset-v2-public-index.html
grep -q 'id="hero-blue-hour-time"' /tmp/sunset-v2-public-index.html
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
if grep -Eq 'id="color-tag"|id="color-dot"|id="color-label"' /tmp/sunset-v2-public-index.html; then
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
grep -q "This product includes GeoLite Data created by MaxMind" /tmp/sunset-v2-public-credits.html
curl -fsS -D /tmp/sunset-v2-public-robots-headers.txt https://sunsetpredict.cloud/robots.txt -o /tmp/sunset-v2-public-robots.txt
curl -fsS -D /tmp/sunset-v2-public-sitemap-headers.txt https://sunsetpredict.cloud/sitemap.xml -o /tmp/sunset-v2-public-sitemap.xml
grep -Eiq '^content-type: text/plain; charset=utf-8' /tmp/sunset-v2-public-robots-headers.txt
grep -Eiq '^content-type: application/xml; charset=utf-8' /tmp/sunset-v2-public-sitemap-headers.txt
grep -Fq 'Disallow: /api/' /tmp/sunset-v2-public-robots.txt
grep -Fq 'Sitemap: https://sunsetpredict.cloud/sitemap.xml' /tmp/sunset-v2-public-robots.txt
grep -Fq '<loc>https://sunsetpredict.cloud/</loc>' /tmp/sunset-v2-public-sitemap.xml
grep -Fq '<loc>https://sunsetpredict.cloud/spots/xihu</loc>' /tmp/sunset-v2-public-sitemap.xml
grep -Fq '<loc>https://sunsetpredict.cloud/spots/hongkong</loc>' /tmp/sunset-v2-public-sitemap.xml
test "$(grep -c '<loc>' /tmp/sunset-v2-public-sitemap.xml)" -eq 38

# --- P1: 站长平台验证标签断言 ---
# 仅当部署 env 配置了验证 token 时才校验线上页面是否出现对应 <meta>；
# 未配置则明确告警，避免后续部署静默跳过验证。
if grep -qE '^(GOOGLE_SITE_VERIFICATION|BAIDU_SITE_VERIFICATION)=' "$release_dir/.env"; then
  for path in "" "spots/hongkong"; do
    page=$(curl -fsS "https://sunsetpredict.cloud/${path}")
    printf '%s' "$page" | grep -q 'name="google-site-verification"' \
      || echo "WARN: google-site-verification meta 缺失于 /${path}"
    printf '%s' "$page" | grep -q 'name="baidu-site-verification"' \
      || echo "WARN: baidu-site-verification meta 缺失于 /${path}"
  done
else
  echo "WARN: 部署 env 未配置 GOOGLE_SITE_VERIFICATION / BAIDU_SITE_VERIFICATION，站长平台无法验证所有权。"
fi

curl -fsS https://sunsetpredict.cloud/spots/hongkong -o /tmp/sunset-v2-public-hongkong-page.html
grep -Fq '<title>香港维多利亚港晚霞预测 - 今日火烧云概率与摄影指南 | Sunset Predict</title>' /tmp/sunset-v2-public-hongkong-page.html
grep -Fq '<link rel="canonical" href="https://sunsetpredict.cloud/spots/hongkong">' /tmp/sunset-v2-public-hongkong-page.html
grep -Fq '香港维多利亚港晚霞预测与摄影指南' /tmp/sunset-v2-public-hongkong-page.html
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
grep -q ".feedback-photo-preview" /tmp/sunset-v2-public-styles.css
grep -q "#feedback-comment" /tmp/sunset-v2-public-styles.css
grep -q ".spot-messages__list" /tmp/sunset-v2-public-styles.css
grep -q ".spot-message__image" /tmp/sunset-v2-public-styles.css
grep -q ".blue-hour__card" /tmp/sunset-v2-public-styles.css
grep -q "body.blue-hour-active" /tmp/sunset-v2-public-styles.css
grep -q ".spot-search.is-open .spot-search__field" /tmp/sunset-v2-public-styles.css
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
grep -q "openDetail('xihu'" /tmp/sunset-v2-public-app.js
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
grep -q "function filterSpotCards(query)" /tmp/sunset-v2-public-app.js
grep -q "function bindSpotSearch()" /tmp/sunset-v2-public-app.js
grep -q "function renderWeatherBadge" /tmp/sunset-v2-public-app.js
grep -q "function renderWeatherDetails" /tmp/sunset-v2-public-app.js
grep -q "function renderBlueHour" /tmp/sunset-v2-public-app.js
grep -q "light-timeline-connector" /tmp/sunset-v2-public-app.js
grep -q "function trackUmamiEvent" /tmp/sunset-v2-public-app.js
if grep -Eq "fetchNearbySpot|NEARBY_API_URL" /tmp/sunset-v2-public-app.js; then
  echo "Frontend should not fetch nearby spot" >&2
  exit 1
fi
grep -q "trackUmamiEvent('detail-open', spotId)" /tmp/sunset-v2-public-app.js
grep -q "trackUmamiEvent('date-change')" /tmp/sunset-v2-public-app.js
grep -q "trackUmamiEvent('feedback-submit', feedbackDraft.spot)" /tmp/sunset-v2-public-app.js
grep -q "trackUmamiEvent('support-open')" /tmp/sunset-v2-public-app.js
grep -q "trackUmamiEvent('partner-open', activeDetailSpot)" /tmp/sunset-v2-public-app.js
grep -q "async function createSharePoster" /tmp/sunset-v2-public-app.js
grep -q "async function openSharePoster" /tmp/sunset-v2-public-app.js
grep -q "async function sharePreparedPoster" /tmp/sunset-v2-public-app.js
grep -q "navigator.maxTouchPoints > 0" /tmp/sunset-v2-public-app.js
grep -q "event.target.closest?.('.detail__actions')" /tmp/sunset-v2-public-app.js
grep -q "function readForecastBootstrap" /tmp/sunset-v2-public-app.js
grep -q "function applyTimelinePayload" /tmp/sunset-v2-public-app.js
grep -q "function submitSpotMessage" /tmp/sunset-v2-public-app.js
grep -q "async function loadSpotMessages" /tmp/sunset-v2-public-app.js
grep -q "async function compressFeedbackPhoto" /tmp/sunset-v2-public-app.js
grep -q "async function handleFeedbackPhoto" /tmp/sunset-v2-public-app.js
grep -q "const FEEDBACK_API_URL = '/api/feedback'" /tmp/sunset-v2-public-app.js
curl -fsS https://sunsetpredict.cloud/wechat-pay.jpg -o /tmp/sunset-v2-public-qr-check.jpg
test "$(sha256sum /tmp/sunset-v2-public-qr-check.jpg | awk '{print $1}')" = "963811c8cd09b1a445d4bb97df695c4f1df6fdb51f05bc09fa5ee24ed00203a5"
curl -fsS https://sunsetpredict.cloud/assets/business.jpg -o /tmp/sunset-v2-public-business-check.jpg
test "$(sha256sum /tmp/sunset-v2-public-business-check.jpg | awk '{print $1}')" = "d360f674a918462f75f8f3a1e9abe6d71b2b6295fbecc977480799b4938394d9"
curl -fsS https://sunsetpredict.cloud/assets/xihu-sunset.webp -o /tmp/sunset-v2-public-xihu-image.webp
curl -fsS https://sunsetpredict.cloud/assets/waitan-sunset.webp -o /tmp/sunset-v2-public-waitan-image.webp
test "$(sha256sum /tmp/sunset-v2-public-xihu-image.webp | awk '{print $1}')" = "cc55ec6e2e0b155c781a8e6e8ff62538cb35b79364adbe68d8089cf8442977c7"
test "$(sha256sum /tmp/sunset-v2-public-waitan-image.webp | awk '{print $1}')" = "f51150c5a0a9fe5fa51cee565c2e049d2334c9c984cdba075630dbf9c378c9ae"
for slug in $forecast_slugs; do
  curl -fsS "https://sunsetpredict.cloud/assets/city-$slug.webp" -o "/tmp/sunset-v2-public-city-$slug.webp"
  test "$(wc -c < "/tmp/sunset-v2-public-city-$slug.webp")" -lt 200000
done
test "$(sha256sum /tmp/sunset-v2-public-city-erhai.webp | awk '{print $1}')" = "c2639568e5ea7a47a64704257d479940981f5e66fd5c40bec20e5a77be441ed7"
test "$(sha256sum /tmp/sunset-v2-public-city-xiamen.webp | awk '{print $1}')" = "7a2cb3424fb4a7eab5c323917fb54fb4efd48fd4916b9edec3ab423138cc8dd2"
test "$(sha256sum /tmp/sunset-v2-public-city-qingdao.webp | awk '{print $1}')" = "763719f74811494ff257bd9b8cb15f1d0c8e8bb0d9b274c46eabe411a833a4ac"
test "$(sha256sum /tmp/sunset-v2-public-city-huangshan.webp | awk '{print $1}')" = "f80b7120f867bec059432488c4af6ed55924337d7217e7d796cc592aa8e5198b"
test "$(sha256sum /tmp/sunset-v2-public-city-guangzhou.webp | awk '{print $1}')" = "e6299f3c50967a10609485119b8c6b7a1488cbd027f5513fad17cc1eb9965419"
test "$(sha256sum /tmp/sunset-v2-public-city-wuhan.webp | awk '{print $1}')" = "f1498459103ba919fcd61ed4cc64f8d614fb3d3c82fb708dc5ab6641470153db"
test "$(sha256sum /tmp/sunset-v2-public-city-nanjing.webp | awk '{print $1}')" = "093dd899b57baa8780b07ccd57dd727eea0fab44af779af6c0536839e4772b01"
test "$(sha256sum /tmp/sunset-v2-public-city-xiapu.webp | awk '{print $1}')" = "386f81249efe0ae950b4d0e5379361eb2a6d8a943cb4b760a399aac57890faa8"
test "$(sha256sum /tmp/sunset-v2-public-city-wuxi.webp | awk '{print $1}')" = "0d7ea145d82ac19ea4b3e4fb1e8cae0d4e6a574b6cca8b338d0eb7a0476aa148"

curl -fsS https://sunsetpredict.cloud/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const okStatus=v=>v===undefined||['connected','available','unavailable','degraded','pressure-level-proxy','not-configured'].includes(v);const m=j.metrics;const b=j.blueHour;if(j.spot!=='xihu'||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3.1'||j.source!=='xihu-model-v3'||j.timeOffsetMinutes!==-15||!okStatus(j.sourceStatus?.waqi)||j.days?.length!==3||j.days.some(d=>typeof d.rawQuality!=='number'||typeof d.probability!=='number'||d.blueHour?.source!=='suncalc-2.0.1')||b?.source!=='suncalc-2.0.1'||typeof b.score!=='number'||!/^\d{2}:\d{2}$/.test(b.start)||!/^\d{2}:\d{2}$/.test(b.end)||![m?.cloudLow,m?.cloudMid,m?.cloudHigh,m?.visibilityKm,m?.windowTransparency].every(Number.isFinite))process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const okStatus=v=>v===undefined||['connected','available','unavailable','degraded','pressure-level-proxy','not-configured'].includes(v);const m=j.metrics;if(!okStatus(j.sourceStatus?.precipitation)||![m?.precipitationMm,m?.precipitationRateMmH,m?.precipitationProbability,m?.weatherCode].every(Number.isFinite))process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/sunset | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const okStatus=v=>v===undefined||['connected','available','unavailable','degraded','pressure-level-proxy','not-configured'].includes(v);if(!okStatus(j.sourceStatus?.qweather)||typeof j.weather?.source!=='string'||typeof j.weather?.label!=='string'||typeof j.weather?.kind!=='string'||(j.weather.blocksSunset&&(j.quality!==0||j.probability!==0)))process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/sunset/ | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.spot!=='xihu'||typeof j.quality!=='number')process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/api/spot/waitan | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const okStatus=v=>v===undefined||['connected','available','unavailable','degraded','pressure-level-proxy','not-configured'].includes(v);const m=j.metrics;const b=j.blueHour;if(j.spot!=='waitan'||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3.1'||j.source!=='waitan-model-v4'||!okStatus(j.sourceStatus?.waqi)||!okStatus(j.sourceStatus?.precipitation)||b?.source!=='suncalc-2.0.1'||typeof b.score!=='number'||typeof j.weather?.label!=='string'||![m?.cloudLow,m?.cloudMid,m?.cloudHigh,m?.visibilityKm,m?.windowTransparency,m?.precipitationRateMmH,m?.precipitationProbability,m?.weatherCode].every(Number.isFinite)||(j.weather.blocksSunset&&(j.quality!==0||j.probability!==0)))process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/api/timeline -o /tmp/sunset-v2-public-timeline.json
"$node_bin" -e "const j=require('/tmp/sunset-v2-public-timeline.json');if(j.days?.length<3||j.days.find(d=>d.offset===0)?.spots?.length!==35)process.exit(1)"
"$node_bin" -e "const j=require('/tmp/sunset-v2-public-timeline.json');const d=j.days.find(x=>x.offset===0);const items=[d.xihu,d.waitan,...d.spots];if(items.some(x=>!x.sunsetWindow||!Array.isArray(x.sunsetWindow.timeline)||x.sunsetWindow.timeline.length>6))process.exit(1)"
curl -fsS https://sunsetpredict.cloud/api/spots -o /tmp/sunset-v2-public-regional-spots.json
"$node_bin" -e "const j=require('/tmp/sunset-v2-public-regional-spots.json');const okStatus=v=>v===undefined||['connected','available','unavailable','degraded','pressure-level-proxy','not-configured'].includes(v);if(j.spots?.length!==35||j.spots.some(s=>typeof s.spot!=='string'||(typeof s.quality==='number'?(!Number.isFinite(s.rawQuality)||s.rawQuality!==s.quality||!Number.isFinite(s.probability)||typeof s.verdict!=='string'||s.modelVersion!=='quality-v3.1'||!s.source?.endsWith('-model-v3')||!['NONE','CLEAR','FAIR','GREAT','FIRE'].includes(s.grade)||!okStatus(s.sourceStatus?.precipitation)||!okStatus(s.sourceStatus?.qweather)||typeof s.weather?.source!=='string'||typeof s.weather?.label!=='string'||![s.metrics?.cloudLow,s.metrics?.cloudMid,s.metrics?.cloudHigh,s.metrics?.visibilityKm,s.metrics?.windowTransparency,s.metrics?.precipitationRateMmH,s.metrics?.precipitationProbability,s.metrics?.weatherCode].every(Number.isFinite)||(s.weather.blocksSunset&&(s.quality!==0||s.probability!==0))):typeof s.error!=='string')))process.exit(1)"
"$node_bin" -e "const j=require('/tmp/sunset-v2-public-regional-spots.json');if(j.spots?.some(s=>!s.error&&(!s.blueHour?.available||!/^\\d{2}:\\d{2}$/.test(s.blueHour.start)||!/^\\d{2}:\\d{2}$/.test(s.blueHour.end))))process.exit(1)"
for slug in $forecast_slugs; do
  status=$(curl -sS -o "/tmp/sunset-v2-public-$slug.json" -w '%{http_code}' "https://sunsetpredict.cloud/api/spot/$slug")
  "$node_bin" -e "const j=JSON.parse(require('fs').readFileSync('/tmp/sunset-v2-public-'+process.argv[1]+'.json'));const status=process.argv[2];if(status==='200'?(j.spot!==process.argv[1]||typeof j.rawQuality!=='number'||j.rawQuality!==j.quality||typeof j.probability!=='number'||typeof j.verdict!=='string'||j.modelVersion!=='quality-v3.1'||!j.source?.endsWith('-model-v3')||j.forecast?.length!==3||![j.metrics?.cloudLow,j.metrics?.cloudMid,j.metrics?.cloudHigh,j.metrics?.visibilityKm,j.metrics?.windowTransparency].every(Number.isFinite)):(status!=='502'||j.error!=='Prediction service unavailable'))process.exit(1)" "$slug" "$status"
done
"$node_bin" -e "const h=require('/tmp/sunset-v2-public-huangshan.json');if(typeof h.quality==='number'&&(h.dataAvailability?.cloudBaseHeight!=='pressure-level-proxy'||h.sourceStatus?.cloudBaseHeight!=='pressure-level-proxy'))process.exit(1);const x=require('/tmp/sunset-v2-public-xiamen.json');if(typeof x.quality==='number'&&x.dataAvailability?.lowLevelHumidity!=='connected')process.exit(1)"
curl -fsS https://sunsetpredict.cloud/api/spot/jingshan | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.spot!=='beijing'||j.source!=='beijing-model-v3'||j.modelVersion!=='quality-v3.1')process.exit(1)})"
curl -fsS https://sunsetpredict.cloud/health | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.ok!==true||!j.services?.includes('feedback-v3')||!j.services?.includes('qweather-weather-v1')||!j.services?.includes('blue-hour-v1')||!j.services?.includes('nearby-ip-city-v1'))process.exit(1)})"

curl -fsS 'https://sunsetpredict.cloud/api/feedback?spot=xihu&limit=1' \
  | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(j.spot!=='xihu'||!Array.isArray(j.items)||typeof j.total!=='number'||(j.nextCursor!==null&&typeof j.nextCursor!=='string')||j.items.some(x=>x.respondentHash!==undefined||x.prediction!==undefined))process.exit(1)})"

invalid_feedback_status=$(curl -sS -o /tmp/sunset-v2-feedback-invalid.json -w '%{http_code}' \
  -H 'content-type: application/json' -d '{}' https://sunsetpredict.cloud/api/feedback)
test "$invalid_feedback_status" = "400"
"$node_bin" -e "const j=require('/tmp/sunset-v2-feedback-invalid.json');if(j.code!=='INVALID_FEEDBACK')process.exit(1)"

feedback_future_date=$("$node_bin" -p "require('/tmp/sunset-v2-public-timeline.json').days.find(day=>day.offset===1).date")
future_feedback_status=$(curl -sS -o /tmp/sunset-v2-feedback-future.json -w '%{http_code}' \
  -H 'content-type: application/json' \
  -d "{\"spot\":\"xihu\",\"date\":\"$feedback_future_date\",\"clientId\":\"deployment_check_client_123456\",\"comment\":\"deployment-check\"}" \
  https://sunsetpredict.cloud/api/feedback)
test "$future_feedback_status" = "409"
"$node_bin" -e "const j=require('/tmp/sunset-v2-feedback-future.json');if(j.code!=='FUTURE_DATE')process.exit(1)"
test -d "$feedback_root"

# 新增端点健康检查：反馈统计 + 商户合作位配置（实时读取 SQLite，无需重启）
curl -fsS "http://127.0.0.1:3003/api/feedback/stats" \
  | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(!Array.isArray(j.stats))process.exit(1);console.log('feedback/stats ok')})" \
  || { echo 'API /api/feedback/stats 健康检查失败' >&2; rollback; }
curl -fsS "http://127.0.0.1:3003/api/advertisers" \
  | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);if(!('data' in j)||(j.updatedAt!==null&&typeof j.updatedAt!=='string'))process.exit(1);console.log('advertisers ok')})" \
  || { echo 'API /api/advertisers 健康检查失败' >&2; rollback; }

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
