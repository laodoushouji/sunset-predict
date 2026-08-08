const path = require('node:path');
const Database = require('better-sqlite3');

// SQLite 句柄按反馈根目录缓存，避免每次请求重新打开文件。
// 单文件、无独立进程，配合 WAL 满足低写入、高读取的反馈场景。
const dbCache = new Map();

function openFeedbackDb(root) {
  const cached = dbCache.get(root);
  if (cached) return cached;
  const db = new Database(path.join(root, 'feedback.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      response_key TEXT PRIMARY KEY,
      respondent_hash TEXT NOT NULL,
      spot TEXT NOT NULL,
      date TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      photo_file TEXT,
      photo_mime TEXT,
      photo_size INTEGER,
      photo_sha256 TEXT,
      observed INTEGER,
      actual_quality INTEGER,
      actual_quality_label TEXT,
      raw_quality REAL,
      quality REAL,
      probability REAL,
      grade TEXT,
      model_version TEXT,
      source TEXT,
      prediction_json TEXT,
      recorded_at TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 3
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_spot_recorded ON feedback(spot, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_date ON feedback(date);
  `);
  dbCache.set(root, db);
  return db;
}

function getFeedbackRow(root, responseKey) {
  const db = openFeedbackDb(root);
  return db.prepare('SELECT * FROM feedback WHERE response_key = ?').get(responseKey) || null;
}

function saveFeedbackRow(root, row) {
  const db = openFeedbackDb(root);
  db.prepare(`
    INSERT INTO feedback (
      response_key, respondent_hash, spot, date, comment,
      photo_file, photo_mime, photo_size, photo_sha256,
      observed, actual_quality, actual_quality_label,
      raw_quality, quality, probability, grade, model_version, source,
      prediction_json, recorded_at, schema_version
    ) VALUES (
      @response_key, @respondent_hash, @spot, @date, @comment,
      @photo_file, @photo_mime, @photo_size, @photo_sha256,
      @observed, @actual_quality, @actual_quality_label,
      @raw_quality, @quality, @probability, @grade, @model_version, @source,
      @prediction_json, @recorded_at, @schema_version
    )
    ON CONFLICT(response_key) DO UPDATE SET
      comment = excluded.comment,
      photo_file = excluded.photo_file,
      photo_mime = excluded.photo_mime,
      photo_size = excluded.photo_size,
      photo_sha256 = excluded.photo_sha256,
      observed = excluded.observed,
      actual_quality = excluded.actual_quality,
      actual_quality_label = excluded.actual_quality_label,
      raw_quality = excluded.raw_quality,
      quality = excluded.quality,
      probability = excluded.probability,
      grade = excluded.grade,
      model_version = excluded.model_version,
      source = excluded.source,
      prediction_json = excluded.prediction_json,
      recorded_at = excluded.recorded_at
  `).run(row);
}

function listFeedbackMessages(root, spot) {
  const db = openFeedbackDb(root);
  return db.prepare(`
    SELECT response_key, spot, date, comment, photo_file, recorded_at
    FROM feedback
    WHERE spot = ? AND (comment <> '' OR photo_file IS NOT NULL)
    ORDER BY recorded_at DESC, response_key DESC
  `).all(spot);
}

// SEO 照片墙：按站点取"历史高分"照片，优先用户实拍评分（actual_quality），
// 缺失时回退到模型质量分（quality）。只取带图行，走 idx_feedback_spot_recorded 索引。
function listTopPhotos(root, spot, limit = 9) {
  const db = openFeedbackDb(root);
  return db.prepare(`
    SELECT response_key, spot, date, comment, photo_file,
      COALESCE(actual_quality, quality) AS score,
      recorded_at
    FROM feedback
    WHERE spot = ? AND photo_file IS NOT NULL
    ORDER BY COALESCE(actual_quality, quality) DESC, recorded_at DESC
    LIMIT ?
  `).all(spot, limit);
}

// 校准/统计视图：按站点汇总样本量、带图量、平均质量分与命中率。
// 直接服务 P1「累计实况真值、按站点统计 Probability 命中率与 Quality 误差」。
function getFeedbackStats(root) {
  const db = openFeedbackDb(root);
  return db.prepare(`
    SELECT spot,
      COUNT(*) AS total,
      SUM(CASE WHEN photo_file IS NOT NULL THEN 1 ELSE 0 END) AS with_photo,
      ROUND(AVG(quality), 2) AS avg_quality,
      ROUND(AVG(probability), 2) AS avg_probability
    FROM feedback
    GROUP BY spot
    ORDER BY total DESC
  `).all();
}

module.exports = {
  openFeedbackDb,
  getFeedbackRow,
  saveFeedbackRow,
  listFeedbackMessages,
  listTopPhotos,
  getFeedbackStats,
};
