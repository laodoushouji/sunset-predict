const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getAdvertiserConfig,
  setAdvertiserConfig,
  validatePayload,
} = require('../src/services/advertisers');

function tmpDb() {
  return path.join(os.tmpdir(), `adv-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(db) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${db}${suffix}`, { force: true });
    } catch {
      // ignore
    }
  }
}

test('validatePayload 仅保留白名单字段，并拒绝非法类型', () => {
  assert.strictEqual(validatePayload(null), null);
  assert.deepStrictEqual(validatePayload({ title: 'A', extra: 1 }), { title: 'A' });
  assert.throws(() => validatePayload('nope'));
  assert.throws(() => validatePayload([1, 2]));
  assert.throws(() => validatePayload({ title: 5 }));
});

test('set 后 get 返回相同数据，updatedAt 存在', () => {
  const db = tmpDb();
  const payload = {
    image: '/assets/business.jpg',
    imageAlt: '示例商户',
    title: '示例商户',
    description: '合作示例',
    badge: '合作伙伴',
  };
  const set = setAdvertiserConfig(db, payload);
  assert.strictEqual(set.data.title, '示例商户');
  assert.ok(set.updatedAt);
  const got = getAdvertiserConfig(db);
  assert.deepStrictEqual(got.data, payload);
  assert.strictEqual(got.updatedAt, set.updatedAt);
  cleanup(db);
});

test('set null 会清空 data', () => {
  const db = tmpDb();
  setAdvertiserConfig(db, { title: 'T' });
  const cleared = setAdvertiserConfig(db, null);
  assert.strictEqual(cleared.data, null);
  assert.strictEqual(getAdvertiserConfig(db).data, null);
  cleanup(db);
});

test('同一行 upsert 不新增记录', () => {
  const db = tmpDb();
  setAdvertiserConfig(db, { title: 'A' });
  setAdvertiserConfig(db, { title: 'B' });
  const got = getAdvertiserConfig(db);
  assert.strictEqual(got.data.title, 'B');
  assert.strictEqual(got.updatedAt !== null, true);
  cleanup(db);
});
