function createMemoryCache(ttlMs, now = Date.now) {
  const values = new Map();
  const pending = new Map();

  async function get(key, loader) {
    const current = values.get(key);
    if (current && now() - current.createdAt < ttlMs) return current.value;
    if (pending.has(key)) return pending.get(key);

    const request = Promise.resolve()
      .then(loader)
      .then(value => {
        values.set(key, { createdAt: now(), value });
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  return {
    get,
    set(key, value) {
      values.set(key, { createdAt: now(), value });
    },
    delete(key) {
      values.delete(key);
    },
  };
}

module.exports = { createMemoryCache };
