// 商户合作位（advertiser）动态配置存储。
// 数据存放在 SQLite 单文件，读取实时生效，无需重启服务即可更新商户信息。
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const dbCache = new Map();

// 仅允许写入的字段（白名单），渲染端以 textContent/src 使用，避免注入任意键。
const ALLOWED_FIELDS = ['image', 'imageAlt', 'title', 'description', 'badge'];

function defaultDbPath() {
  const feedbackRoot =
    process.env.FEEDBACK_ROOT || path.resolve(__dirname, '../../data/feedback');
  return path.join(feedbackRoot, '..', 'advertisers.db');
}

function resolveDbPath(dbPath) {
  return dbPath || process.env.ADVERTISERS_DB || defaultDbPath();
}

function openAdvertisersDb(dbPath) {
  const resolved = resolveDbPath(dbPath);
  const cached = dbCache.get(resolved);
  if (cached) return cached;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS advertiser_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  dbCache.set(resolved, db);
  return db;
}

function getAdvertiserConfig(dbPath) {
  const db = openAdvertisersDb(dbPath);
  const row = db
    .prepare('SELECT payload, updated_at FROM advertiser_config WHERE id = 1')
    .get();
  let data = null;
  if (row && row.payload != null) {
    try {
      data = JSON.parse(row.payload);
    } catch {
      data = null;
    }
  }
  return { data, updatedAt: row ? row.updated_at : null };
}

function validatePayload(payload) {
  if (payload === null || payload === undefined) return null;
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload 必须是对象或 null');
  }
  const clean = {};
  for (const key of ALLOWED_FIELDS) {
    if (payload[key] != null) {
      if (typeof payload[key] !== 'string') {
        throw new Error(`字段 ${key} 必须是字符串`);
      }
      clean[key] = payload[key];
    }
  }
  return clean;
}

function setAdvertiserConfig(dbPath, payload) {
  const clean = validatePayload(payload);
  const db = openAdvertisersDb(dbPath);
  const updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO advertiser_config (id, payload, updated_at)
    VALUES (1, @payload, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `).run({
    payload: clean ? JSON.stringify(clean) : null,
    updated_at: updatedAt,
  });
  return { data: clean, updatedAt };
}

module.exports = {
  ALLOWED_FIELDS,
  openAdvertisersDb,
  getAdvertiserConfig,
  setAdvertiserConfig,
  validatePayload,
};
