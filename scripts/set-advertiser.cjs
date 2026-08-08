#!/usr/bin/env node
// 动态更新商户合作位配置（无需重启服务）。
// 商户信息写入 SQLite；运行中的服务每次读取实时生效。
//
// 用法：
//   node scripts/set-advertiser.cjs --db /var/lib/sunset-predict/advertisers.db --json '{"title":"...","description":"...","image":"/assets/business.jpg","imageAlt":"...","badge":"合作伙伴"}'
//   node scripts/set-advertiser.cjs --db /var/lib/sunset-predict/advertisers.db --file ./advertiser.json
//   node scripts/set-advertiser.cjs --db /var/lib/sunset-predict/advertisers.db --clear
//
// 也可通过环境变量指定库路径：ADVERTISERS_DB=/path/to/advertisers.db
const path = require('node:path');
const fs = require('node:fs');
const { setAdvertiserConfig, validatePayload } = require('../worker/src/services/advertisers');

function parseArgs(argv) {
  const args = { db: process.env.ADVERTISERS_DB, json: null, file: null, clear: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--db') args.db = argv[++i];
    else if (a === '--json') args.json = argv[++i];
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--clear') args.clear = true;
    else {
      console.error(`未知参数：${a}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.db) {
  console.error('缺少 --db 或 ADVERTISERS_DB 环境变量（指向 advertisers.db）');
  process.exit(2);
}

let payload;
if (args.clear) payload = null;
else if (args.file) payload = JSON.parse(fs.readFileSync(path.resolve(args.file), 'utf8'));
else if (args.json) payload = JSON.parse(args.json);
else {
  console.error('需提供 --json、--file 或 --clear 之一');
  process.exit(2);
}

validatePayload(payload); // 提前校验，给出清晰错误而非写入脏数据
const result = setAdvertiserConfig(args.db, payload);
console.log(`已写入商户配置（updatedAt=${result.updatedAt}）`);
console.log(JSON.stringify(result.data, null, 2));
