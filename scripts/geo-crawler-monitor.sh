#!/usr/bin/env bash
# GEO 爬虫监控：仅统计 sunsetpredict.cloud 本站的 Nginx 访问日志（不混入其他 vhost）
# 用法: bash scripts/geo-crawler-monitor.sh            # 全量统计
#       bash scripts/geo-crawler-monitor.sh --recent   # 仅看最近 1 小时
set -euo pipefail

LOG="/var/log/nginx/sunsetpredict.access.log"
[ -f "$LOG" ] || { echo "日志不存在: $LOG (确认 sunset.conf 已配置独立 access_log)"; exit 1; }

RECENT_FLAG="${1:-}"
if [ "$RECENT_FLAG" = "--recent" ]; then
  # 最近 1 小时（按 nginx 时间格式过滤）
  SINCE=$(date -d '1 hour ago' '+%d/%b/%Y:%H:%M:%S' 2>/dev/null || date -v-1H '+%d/%b/%Y:%H:%M:%S')
  LOGVIEW=$(awk -v s="$SINCE" '$4 > "["s' "$LOG")
else
  LOGVIEW=$(cat "$LOG")
fi

echo "=== 日志区间: $(head -1 "$LOG" | awk '{print $4}' 2>/dev/null) ~ $(tail -1 "$LOG" | awk '{print $4}' 2>/dev/null) ==="
echo "总请求: $(echo "$LOGVIEW" | grep -c .)"
echo
echo "=== AI / 已知爬虫 UA 命中 ==="
echo "$LOGVIEW" | grep -oiE "(GPTBot|ClaudeBot|PerplexityBot|Google-Extended|ChatGPT-User|CCBot|Bytespider|facebookexternalhit|Applebot|DuckDuckBot|Bingbot|YandexBot)" \
  | sort | uniq -c | sort -rn || echo "(无)"
echo
echo "=== llms.txt 命中明细（含状态码）==="
echo "$LOGVIEW" | grep " llms.txt" | awk '{print $4, $6, $9, $12}' || true
echo "$LOGVIEW" | grep " llms.txt" | grep -oiE "(GPTBot|ClaudeBot|PerplexityBot|Google-Extended|CCBot)" | sort | uniq -c || echo "(llms.txt 暂无 AI 爬虫访问)"
echo
echo "=== 最近 10 条 AI 爬虫记录 ==="
echo "$LOGVIEW" | grep -iE "GPTBot|ClaudeBot|PerplexityBot|Google-Extended|CCBot|ChatGPT-User" | tail -10 || echo "(无)"
