const STORES = ['sessions', 'messages', 'memories', 'kv'];

export function createMemoryBackend() {
  const data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  return {
    async init() {},
    async put(store, record) {
      data[store].set(record.id, structuredClone(record));
    },
    async get(store, id) {
      const rec = data[store].get(id);
      return rec ? structuredClone(rec) : null;
    },
    async all(store) {
      return [...data[store].values()].map((r) => structuredClone(r));
    },
    async delete(store, id) {
      data[store].delete(id);
    },
    async clear(store) {
      data[store].clear();
    },
    async clearAll() {
      for (const s of STORES) data[s].clear();
    },
  };
}

export function createLocalStorageBackend(storage = globalThis.localStorage) {
  const keyOf = (store) => `traebao:${store}`;
  const MESSAGE_KEEP = 20;
  const readAll = (store) => {
    try {
      const parsed = JSON.parse(storage.getItem(keyOf(store)) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const writeAll = (store, list) => storage.setItem(keyOf(store), JSON.stringify(list));
  return {
    async init() {},
    async put(store, record) {
      let list = readAll(store).filter((r) => r.id !== record.id);
      list.push(record);
      if (store === 'messages') {
        // 隐私模式降级：只保留最近 20 条，避免 localStorage 无限膨胀
        list = list.slice(-MESSAGE_KEEP);
      }
      writeAll(store, list);
    },
    async get(store, id) {
      return readAll(store).find((r) => r.id === id) || null;
    },
    async all(store) {
      return readAll(store);
    },
    async delete(store, id) {
      writeAll(store, readAll(store).filter((r) => r.id !== id));
    },
    async clear(store) {
      writeAll(store, []);
    },
    async clearAll() {
      for (const s of STORES) writeAll(s, []);
    },
  };
}

export async function createIndexedDBBackend(factory = globalThis.indexedDB) {
  if (!factory) throw new Error('IndexedDB unavailable');
  const DB_NAME = 'traebao';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = factory.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of STORES) {
            if (!db.objectStoreNames.contains(name)) {
              db.createObjectStore(name, { keyPath: 'id' });
            }
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function withStore(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let out;
      try {
        out = fn(os);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const asPromise = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return {
    async init() { await open(); },
    async put(store, record) {
      await withStore(store, 'readwrite', (os) => { os.put(record); });
    },
    async get(store, id) {
      return withStore(store, 'readonly', (os) => asPromise(os.get(id)));
    },
    async all(store) {
      return withStore(store, 'readonly', (os) => asPromise(os.getAll()));
    },
    async delete(store, id) {
      await withStore(store, 'readwrite', (os) => { os.delete(id); });
    },
    async clear(store) {
      await withStore(store, 'readwrite', (os) => { os.clear(); });
    },
    async clearAll() {
      for (const s of STORES) {
        await withStore(s, 'readwrite', (os) => { os.clear(); });
      }
    },
  };
}
