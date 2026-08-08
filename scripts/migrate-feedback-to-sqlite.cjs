#!/usr/bin/env node
'use strict';

// 一次性迁移：将旧的「按日期目录存放的 JSON 反馈文件」灌入 SQLite。
// 用法：node scripts/migrate-feedback-to-sqlite.cjs [反馈根目录]
// 默认根目录：环境变量 FEEDBACK_ROOT 或 <仓库>/data/feedback
//
// 说明：
// - 仅迁移已存在的 JSON 文件，不动磁盘上的图片文件（旧图保持原格式）。
// - 使用 ON CONFLICT(response_key) DO UPDATE，可安全重复运行（幂等）。
// - 运行前请自行备份反馈根目录。

const fs = require('node:fs/promises');
const path = require('node:path');
const { saveFeedbackRow } = require('../worker/src/services/feedback-db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RECORD_RE = /^[a-f0-9]{64}\.json$/;

async function main() {
  const root = process.argv[2] || process.env.FEEDBACK_ROOT || path.join(__dirname, '..', 'data', 'feedback');
  console.log(`迁移反馈数据：根目录 = ${root}`);

  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('反馈根目录不存在，无需迁移。');
      return;
    }
    throw error;
  }

  let migrated = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !DATE_RE.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    const names = await fs.readdir(dir);
    for (const name of names) {
      if (!RECORD_RE.test(name)) continue;
      const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
      if (!record?.responseKey || !record.spot) {
        skipped += 1;
        continue;
      }
      const observed = record.legacyGroundTruth?.observed ?? (typeof record.observed === 'boolean' ? record.observed : null);
      const actualQuality = record.legacyGroundTruth?.actualQuality ?? record.actualQuality ?? null;
      const actualQualityLabel = record.legacyGroundTruth?.actualQualityLabel ?? record.actualQualityLabel ?? null;
      saveFeedbackRow(root, {
        response_key: record.responseKey,
        respondent_hash: record.respondentHash || '',
        spot: record.spot,
        date: record.date || entry.name,
        comment: record.comment || '',
        photo_file: record.photo?.file ?? null,
        photo_mime: record.photo?.mimeType ?? null,
        photo_size: record.photo?.size ?? null,
        photo_sha256: record.photo?.sha256 ?? null,
        observed: observed == null ? null : (observed ? 1 : 0),
        actual_quality: actualQuality ?? null,
        actual_quality_label: actualQualityLabel ?? null,
        raw_quality: record.prediction ? (Number.isFinite(record.prediction.rawQuality) ? record.prediction.rawQuality : record.prediction.quality) : null,
        quality: record.prediction?.quality ?? null,
        probability: record.prediction?.probability ?? null,
        grade: record.prediction?.grade ?? null,
        model_version: record.prediction?.modelVersion ?? null,
        source: record.prediction?.source ?? null,
        prediction_json: record.prediction ? JSON.stringify(record.prediction) : null,
        recorded_at: record.recordedAt || new Date().toISOString(),
        schema_version: record.schemaVersion || 3,
      });
      migrated += 1;
    }
  }

  console.log(`迁移完成：写入 ${migrated} 条，跳过 ${skipped} 条无效记录。`);
}

main().catch(error => {
  console.error(`迁移失败：${error.stack || error.message}`);
  process.exit(1);
});
