const test = require('node:test');
const assert = require('node:assert/strict');

const { createMemoryCache } = require('../src/services/memory-cache');

test('并发冷启动合并为同一次 loader 请求', async () => {
  const cache = createMemoryCache(60_000);
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return { ok: true };
  };

  const results = await Promise.all([
    cache.get('regional', loader),
    cache.get('regional', loader),
    cache.get('regional', loader),
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }]);
});

test('失败请求不会进入成功缓存', async () => {
  const cache = createMemoryCache(60_000);
  let calls = 0;
  const loader = async () => {
    calls += 1;
    if (calls === 1) throw new Error('upstream failed');
    return { ok: true };
  };

  await assert.rejects(cache.get('regional', loader), /upstream failed/);
  assert.deepEqual(await cache.get('regional', loader), { ok: true });
  assert.equal(calls, 2);
});
