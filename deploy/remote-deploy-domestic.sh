#!/usr/bin/env bash

set -Eeuo pipefail

release_dir=/root/sunset-predict-v2
archive_file=/root/sunset-predict-domestic.tar.gz
env_staging=/root/sunset-predict-domestic.env
nginx_file=/etc/nginx/conf.d/glowsunset.conf
service_file=/etc/systemd/system/sunset-predict.service
backup_root=/root/sunset-domestic-backups
deploy_stamp=$(date -u +%Y%m%dT%H%M%SZ)
previous_release=""
previous_service_active=0
nginx_existed=0
service_existed=0
nginx_backup="$backup_root/glowsunset.conf.pre-$deploy_stamp"
service_backup="$backup_root/sunset-predict.service.pre-$deploy_stamp"
history_root=/var/lib/sunset-predict/history
feedback_root=/var/lib/sunset-predict/feedback
cache_root=/var/lib/sunset-predict/cache

if systemctl is-active --quiet sunset-predict.service 2>/dev/null; then
  previous_service_active=1
fi
if [ -f "$nginx_file" ]; then
  nginx_existed=1
fi
if [ -f "$service_file" ]; then
  service_existed=1
fi

rollback() {
  rollback_code=${1:-1}
  trap - ERR
  set +e
  echo "ROLLBACK_START code=$rollback_code"
  systemctl stop sunset-predict.service 2>/dev/null

  if [ "$service_existed" -eq 1 ] && [ -f "$service_backup" ]; then
    cp "$service_backup" "$service_file"
  else
    rm -f "$service_file"
  fi
  systemctl daemon-reload

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

  if [ "$nginx_existed" -eq 1 ] && [ -f "$nginx_backup" ]; then
    cp "$nginx_backup" "$nginx_file"
  else
    rm -f "$nginx_file"
  fi
  nginx -t >/dev/null 2>&1 && nginx -s reload

  echo "ROLLBACK_COMPLETE"
  exit "$rollback_code"
}

trap 'rollback_code=$?; echo "DEPLOY_FAILED at line $LINENO: $BASH_COMMAND (exit $rollback_code)"; rollback "$rollback_code"' ERR

test -s "$archive_file"
test -s "$env_staging"
mkdir -p "$backup_root"

dnf install -y nginx curl xz tar >/dev/null

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
fi
if [ "$node_major" -lt 20 ]; then
  node_version=v22.23.2
  node_archive="node-$node_version-linux-x64.tar.xz"
  node_sha=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307
  curl -fsSLo "/tmp/$node_archive" "https://nodejs.org/dist/$node_version/$node_archive"
  echo "$node_sha  /tmp/$node_archive" | sha256sum -c -
  rm -rf "/usr/local/lib/node-$node_version-linux-x64"
  mkdir -p /usr/local/lib
  tar -xJf "/tmp/$node_archive" -C /usr/local/lib
  ln -sfn "/usr/local/lib/node-$node_version-linux-x64/bin/node" /usr/local/bin/node
  ln -sfn "/usr/local/lib/node-$node_version-linux-x64/bin/npm" /usr/local/bin/npm
  ln -sfn "/usr/local/lib/node-$node_version-linux-x64/bin/npx" /usr/local/bin/npx
fi

node_bin=$(command -v node)
npm_bin=$(command -v npm)
test "$($node_bin -p 'Number(process.versions.node.split(".")[0])')" -ge 20

if [ -d "$release_dir" ]; then
  previous_release="$backup_root/sunset-predict-v2.pre-$deploy_stamp"
  mv "$release_dir" "$previous_release"
fi

mkdir -p "$release_dir"
tar -xzf "$archive_file" -C "$release_dir"
mv "$env_staging" "$release_dir/.env"
chmod 600 "$release_dir/.env"

# 国内发布包不重复携带已压缩图片，部署时从当前生产站同源复制并逐一验收。
asset_files="business.jpg city-beijing.webp city-caoyuan-tianlu.webp city-chengdu.webp city-chongqing.webp city-coloane.webp city-dunhuang.webp city-ejina.webp city-erhai.webp city-fanjing.webp city-generic-sunset.webp city-guangzhou.webp city-haerbin-song.webp city-heimahe.webp city-helanshan.webp city-hengshan.webp city-hongkong.webp city-huangshan.webp city-hukou.webp city-kanas.webp city-longmen.webp city-lushan.webp city-namtso.webp city-nanjing.webp city-qingdao.webp city-sanya.webp city-shenzhen.webp city-taipei.webp city-tianjin-wudadao.webp city-wuhan.webp city-wusongdao.webp city-wuxi.webp city-xiamen.webp city-xian.webp city-xiangbishan.webp city-xiapu.webp city-yalu.webp waitan-sunset.webp wechat-pay.jpg xihu-sunset.webp"
mkdir -p "$release_dir/frontend/assets"
for asset in $asset_files; do
  curl -fsSLo "$release_dir/frontend/assets/$asset" "https://sunsetpredict.cloud/assets/$asset"
  test -s "$release_dir/frontend/assets/$asset"
  test "$(wc -c < "$release_dir/frontend/assets/$asset")" -lt 200000
done

install -d -m 750 "$history_root" "$feedback_root" "$cache_root"

"$npm_bin" ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix "$release_dir"
"$npm_bin" rebuild --prefix "$release_dir" better-sqlite3 sharp
( cd "$release_dir" && "$node_bin" scripts/gen-sitemap.cjs )
( cd "$release_dir" && \
  FEEDBACK_ROOT="$feedback_root" ADVERTISERS_DB="$(dirname "$feedback_root")/advertisers.db" \
  "$node_bin" -e "require('./worker/src/services/feedback').getFeedbackStats(process.env.FEEDBACK_ROOT); require('./worker/src/services/advertisers').getAdvertiserConfig(); console.log('sqlite warmup ok')" )

"$node_bin" --check "$release_dir/worker/src/server.mjs"
"$node_bin" --check "$release_dir/worker/src/services/cities.js"
"$node_bin" --check "$release_dir/worker/src/services/feedback.js"
if ! "$node_bin" --test "$release_dir"/worker/tests/*.test.js >/tmp/glowsunset-tests.log 2>&1; then
  tail -n 100 /tmp/glowsunset-tests.log
  exit 1
fi
tail -n 12 /tmp/glowsunset-tests.log

if [ "$nginx_existed" -eq 1 ]; then
  cp "$nginx_file" "$nginx_backup"
fi
if [ "$service_existed" -eq 1 ]; then
  cp "$service_file" "$service_backup"
fi

install -m 644 "$release_dir/deploy/sunset-predict.service" "$service_file"
install -m 644 "$release_dir/deploy/glowsunset.conf" "$nginx_file"
sed -i "s#^ExecStart=.*#ExecStart=$node_bin worker/src/server.mjs#" "$service_file"
systemctl daemon-reload
systemctl enable sunset-predict.service nginx >/dev/null
systemctl restart sunset-predict.service

service_ready=0
for attempt in $(seq 1 90); do
  if curl -fsS -m 3 http://127.0.0.1:3003/health >/dev/null 2>&1; then
    service_ready=1
    break
  fi
  sleep 1
done
test "$service_ready" -eq 1

curl -fsS http://127.0.0.1:3003/api/spots -o /tmp/glowsunset-spots.json
"$node_bin" -e "const j=require('/tmp/glowsunset-spots.json');if(j.spots?.length!==35||j.spots.some(s=>!s.error&&(!Number.isFinite(s.quality)||!Number.isFinite(s.probability))))process.exit(1)"
curl -fsS http://127.0.0.1:3003/api/spot/hukou -o /tmp/glowsunset-hukou.json
"$node_bin" -e "const j=require('/tmp/glowsunset-hukou.json');if(j.spot!=='hukou'||!Number.isFinite(j.quality)||!Number.isFinite(j.probability)||j.sunsetWindow?.timeline?.length!==6||!j.blueHour?.available)process.exit(1)"
test "$(grep -c '<loc>' "$release_dir/frontend/sitemap.xml")" -eq 38
test "$(wc -c < "$release_dir/frontend/assets/city-hukou.webp")" -lt 200000

nginx -t
systemctl restart nginx
test -s /etc/nginx/ssl/glowsunset/fullchain.pem
test -s /etc/nginx/ssl/glowsunset/privkey.pem
test "$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: glowsunset.cn' http://127.0.0.1/)" = 301
curl -fsS --resolve glowsunset.cn:443:127.0.0.1 https://glowsunset.cn/ >/dev/null
curl -fsS --resolve glowsunset.cn:443:127.0.0.1 https://glowsunset.cn/health >/dev/null
curl -fsS --resolve glowsunset.cn:443:127.0.0.1 https://glowsunset.cn/ -o /tmp/glowsunset-public-index.html
grep -q "css/styles.css?v=20260811-spot-search-v59" /tmp/glowsunset-public-index.html
grep -q "js/app.js?v=20260811-spot-search-v59" /tmp/glowsunset-public-index.html
grep -q 'id="spot-search-toggle"' /tmp/glowsunset-public-index.html
grep -q 'id="spot-search-input"' /tmp/glowsunset-public-index.html
curl -fsS --resolve glowsunset.cn:443:127.0.0.1 https://glowsunset.cn/js/app.js -o /tmp/glowsunset-public-app.js
grep -q "function filterSpotCards(query)" /tmp/glowsunset-public-app.js
curl -fsS --resolve glowsunset.cn:443:127.0.0.1 https://glowsunset.cn/api/spots -o /tmp/glowsunset-public-spots.json
"$node_bin" -e "const j=require('/tmp/glowsunset-public-spots.json');if(j.spots?.length!==35)process.exit(1)"
curl -fsS --resolve glowsunset.cn:443:127.0.0.1 https://glowsunset.cn/assets/city-hukou.webp -o /tmp/glowsunset-public-hukou.webp
test "$(wc -c < /tmp/glowsunset-public-hukou.webp)" -lt 200000

echo "DOMESTIC_DEPLOYMENT_COMPLETE stamp=$deploy_stamp"
echo "BACKUP_ROOT=$backup_root"
