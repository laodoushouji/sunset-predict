#!/usr/bin/env bash

set -Eeuo pipefail

region=cn-wulanchabu
instance_id=i-0jlhdxupa04wr19b7mol
archive_file=${1:-$HOME/sunset-predict-domestic.tar.gz}
env_arg=${2:-$HOME/sunset-predict-domestic.env}
reuse_remote_env=0
if [ "$env_arg" = "--reuse-remote-env" ]; then
  reuse_remote_env=1
  env_file=""
else
  env_file=$env_arg
fi
remote_archive=/root/sunset-predict-domestic.tar.gz
remote_env=/root/sunset-predict-domestic.env
chunk_root=$(mktemp -d)

cleanup() {
  rm -rf "$chunk_root"
  if [ "$reuse_remote_env" -eq 0 ]; then
    rm -f "$env_file"
  fi
}
trap cleanup EXIT

test -s "$archive_file"
if [ "$reuse_remote_env" -eq 0 ]; then
  test -s "$env_file"
fi

run_remote() {
  local script=$1
  local timeout=${2:-120}
  local content response invoke_id result status output exit_code
  content=$(printf '%s' "$script" | base64 -w 0)
  response=$(aliyun ecs RunCommand \
    --RegionId "$region" \
    --Type RunShellScript \
    --CommandContent "$content" \
    --ContentEncoding Base64 \
    --InstanceId.1 "$instance_id" \
    --Timeout "$timeout" \
    --KeepCommand false)
  invoke_id=$(printf '%s' "$response" | jq -r '.InvokeId')
  test -n "$invoke_id"
  test "$invoke_id" != null

  for _ in $(seq 1 "$timeout"); do
    result=$(aliyun ecs DescribeInvocationResults --RegionId "$region" --InvokeId "$invoke_id")
    status=$(printf '%s' "$result" | jq -r '.Invocation.InvocationResults.InvocationResult[0].InvocationStatus // empty')
    if [ "$status" = Success ] || [ "$status" = Failed ] || [ "$status" = Stopped ]; then
      output=$(printf '%s' "$result" | jq -r '.Invocation.InvocationResults.InvocationResult[0].Output // empty')
      if [ -n "$output" ]; then
        printf '%s' "$output" | base64 -d
        echo
      fi
      exit_code=$(printf '%s' "$result" | jq -r '.Invocation.InvocationResults.InvocationResult[0].ExitCode // 1')
      test "$status" = Success
      test "$exit_code" = 0
      return
    fi
    sleep 1
  done

  echo "Cloud Assistant timeout: $invoke_id" >&2
  return 1
}

upload_file() {
  local source_file=$1
  local target_file=$2
  local label=$3
  local file_hash part chunk count index

  run_remote "install -m 600 /dev/null '$target_file'" 60
  split -b 11000 "$source_file" "$chunk_root/$label."
  count=$(find "$chunk_root" -type f -name "$label.*" | wc -l)
  index=0
  for part in "$chunk_root/$label."*; do
    index=$((index + 1))
    chunk=$(base64 -w 0 "$part")
    run_remote "printf '%s' '$chunk' | base64 -d >> '$target_file'" 60
    printf 'UPLOAD_%s %s/%s\n' "$label" "$index" "$count"
  done

  file_hash=$(sha256sum "$source_file" | awk '{print $1}')
  run_remote "echo '$file_hash  $target_file' | sha256sum -c -" 60
}

upload_file "$archive_file" "$remote_archive" archive
if [ "$reuse_remote_env" -eq 1 ]; then
  run_remote "set -e; cp /root/sunset-predict-v2/.env '$remote_env'; chmod 600 '$remote_env'; test -s '$remote_env'" 60
else
  upload_file "$env_file" "$remote_env" env
fi

run_remote "set -e; tar -xOzf '$remote_archive' deploy/remote-deploy-domestic.sh > /root/remote-deploy-domestic.sh; chmod 700 /root/remote-deploy-domestic.sh; if /root/remote-deploy-domestic.sh >/root/glowsunset-deploy.log 2>&1; then tail -n 100 /root/glowsunset-deploy.log; else code=\$?; tail -n 160 /root/glowsunset-deploy.log; exit \$code; fi" 1800

echo "CLOUDSHELL_DEPLOYMENT_COMPLETE"
