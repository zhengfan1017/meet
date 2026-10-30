import { createIndexedDBBackend, createLocalStorageBackend, createMemoryBackend } from './backends.js';

const SIMILARITY_THRESHOLD = 0.85;
const MEMORY_LIMIT = 200;

let seq = 0;
function uid(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

function similarity(a, b) {
  const norm = (s) => String(s).replace(/[\s，。,.、!！?？~～]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  const setB = new Set(y.split(''));
  let hit = 0;
  for (const ch of new Set(x.split(''))) if (setB.has(ch)) hit += 1;
  return hit / new Set(x.split('')).size;
}

export function createStore(backend) {
  const now = () => Date.now();

  return {
    async init() { await backend.init(); },

    async getKV(key) {
      const rec = await backend.get('kv', key);
      return rec ? rec.value : undefined;
    },
    async setKV(key, value) {
      await backend.put('kv', { id: key, value });
    },
    async deleteKV(key) {
      await backend.delete('kv', key);
    },

    async createSession(title = '新对话') {
      const rec = { id: uid('s'), createdAt: now(), title, lastMessageAt: now() };
      await backend.put('sessions', rec);
      return rec;
    },
    async listSessions() {
      const all = await backend.all('sessions');
      return all.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    },
    async getSession(id) {
      return backend.get('sessions', id);
    },
    async updateSession(id, patch) {
      const rec = await backend.get('sessions', id);
      if (!rec) return null;
      Object.assign(rec, patch, { lastMessageAt: now() });
      await backend.put('sessions', rec);
      return rec;
    },
    async deleteSession(id) {
      const msgs = await backend.all('messages');
      for (const m of msgs) {
        if (m.sessionId === id) await backend.delete('messages', m.id);
      }
      await backend.delete('sessions', id);
    },

    async addMessage(msg) {
      const rec = { id: uid('m'), ts: now(), emo: null, ...msg };
      await backend.put('messages', rec);
      return rec;
    },
    async listMessages(sessionId, limit = 12) {
      const all = await backend.all('messages');
      return all
        .filter((m) => m.sessionId === sessionId)
        .sort((a, b) => a.ts - b.ts)
        .slice(-limit);
    },

    async listMemories() {
      const all = await backend.all('memories');
      return all.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.hits || 0) - (a.hits || 0));
    },
    async addMemory(text) {
      const clean = String(text || '').trim();
      if (!clean) return null;
      const all = await backend.all('memories');
      const hit = all.find((m) => similarity(m.text, clean) >= SIMILARITY_THRESHOLD);
      if (hit) {
        hit.hits = (hit.hits || 0) + 1;
        hit.lastUsedAt = now();
        await backend.put('memories', hit);
        return hit;
      }
      const rec = { id: uid('mem'), text: clean, createdAt: now(), hits: 0, lastUsedAt: now(), pinned: false };
      await backend.put('memories', rec);
      if (all.length + 1 > MEMORY_LIMIT) {
        const evictable = all
          .filter((m) => !m.pinned)
          .sort((a, b) => (a.hits || 0) - (b.hits || 0) || (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
        for (const m of evictable.slice(0, all.length + 1 - MEMORY_LIMIT)) {
          await backend.delete('memories', m.id);
        }
      }
      return rec;
    },
    async setPinned(id, pinned) {
      const rec = await backend.get('memories', id);
      if (!rec) return null;
      rec.pinned = !!pinned;
      await backend.put('memories', rec);
      return rec;
    },
    async deleteMemory(id) {
      await backend.delete('memories', id);
    },
    async clearMemories() {
      await backend.clear('memories');
    },
    async markUsed(ids) {
      for (const id of ids) {
        const rec = await backend.get('memories', id);
        if (!rec) continue;
        rec.hits = (rec.hits || 0) + 1;
        rec.lastUsedAt = now();
        await backend.put('memories', rec);
      }
    },

    async clearAll() {
      await backend.clearAll();
    },
  };
}

export async function createDefaultStore() {
  try {
    const backend = await createIndexedDBBackend();
    await backend.init();
    const store = createStore(backend);
    await store.init();
    return store;
  } catch {
    const store = createStore(createLocalStorageBackend());
    await store.init();
    return store;
  }
}
