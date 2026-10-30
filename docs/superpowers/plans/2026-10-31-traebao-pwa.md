# Trae宝 PWA 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 构建一个可安装到 Android 桌面、具备立绘情绪切换与跨会话长期记忆的 Trae宝 情感陪伴聊天 PWA。

**Architecture:** 零依赖单页 PWA（原生 ES Module + 无构建步骤）。模型接入收敛在 `provider.js` 一层，方舟 OpenAI 兼容端点浏览器直连为默认，Cloudflare Worker 代理为兜底，两者接口完全一致。模型单次回复同时携带情绪标签与记忆条目（尾部标记块协议），本地解析后分别驱动立绘切换与 IndexedDB 记忆写入。

**Tech Stack:** 原生 HTML/CSS/ES Module、IndexedDB、Service Worker、Canvas（生成图标）、Node 24 内置 `node --test`、Pillow（Python 3 生成图标）

**设计规格：** `docs/superpowers/specs/2026-10-31-traebao-pwa-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `package.json` | ESM 声明 + `npm test` 脚本 |
| `index.html` | 单页壳：舞台区 / 消息流 / 输入区 / 设置面板 |
| `app.css` | 全部样式 |
| `manifest.webmanifest` | PWA 清单 |
| `sw.js` | 静态壳预缓存 + fetch 策略 |
| `icons/icon-192.png` `icons/icon-512.png` | 由立绘素材生成的桌面图标 |
| `src/mood.js` | 情绪标签 ↔ 立绘文件的唯一映射表（纯数据） |
| `src/memory/extractor.js` | 从模型回复尾部解析 `[[emo:x]]` / `[[mem:y]]` |
| `src/memory/backends.js` | IndexedDB / localStorage / 内存三种后端实现同一接口 |
| `src/memory/store.js` | 领域接口（会话 / 消息 / 记忆 / kv），依赖注入后端 |
| `src/memory/retriever.js` | 记忆召回打分 + 上下文组装 |
| `src/llm/prompt.js` | 人设系统提示词 + 输出协议 + 危机处理条款 |
| `src/llm/sse.js` | SSE 行解析（纯函数，可测） |
| `src/llm/provider.js` | 模型接入层：请求组装 + 流式迭代 + 错误分类 |
| `src/llm/doubao.js` | 方舟直连适配（默认） |
| `src/llm/worker.js` | Worker 代理适配（兜底） |
| `src/ui/stage.js` | 立绘舞台区、表情切换、手动覆盖锁 |
| `src/ui/timeline.js` | 消息气泡流、增量渲染、历史回放 |
| `src/ui/composer.js` | 输入框、发送、键盘行为 |
| `src/ui/settings.js` | 设置面板：接入配置 + 记忆管理 + 清除数据 |
| `src/main.js` | 启动装配与总调度 |
| `worker/worker.js` | Cloudflare Worker 代理源码（可选部署） |
| `test/*.test.js` | Node 内置测试 |

---

### Task 1: 项目骨架与桌面图标

**Files:**
- Create: `package.json`
- Create: `tools/make_icons.py`
- Create: `icons/icon-192.png`, `icons/icon-512.png`

- [x] **Step 1: 写 package.json**

```json
{
  "name": "traebao-pwa",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/",
    "dev": "python3 -m http.server 8080"
  }
}
```

- [x] **Step 2: 写图标生成脚本**

`tools/make_icons.py`：

```python
import os
from PIL import Image

SRC = "src/assets/sprite/07-甲方说好.png"
OUT_DIR = "icons"
SIZES = {"icon-192.png": 192, "icon-512.png": 512}
BG = (245, 241, 232, 255)


def make_icon(size: int, out_path: str) -> None:
    im = Image.open(SRC).convert("RGBA")
    im = im.resize((int(size * 0.78), int(size * 0.78)), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BG)
    canvas.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    canvas.save(out_path, optimize=True)


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, size in SIZES.items():
        make_icon(size, os.path.join(OUT_DIR, name))
        print("wrote", name)
```

- [x] **Step 3: 生成图标**

Run: `cd /workspace/traebao-pwa && python3 tools/make_icons.py`
Expected: 输出 `wrote icon-192.png` / `wrote icon-512.png`，两文件存在且 `file` 报 PNG

- [x] **Step 4: 提交**

```bash
git add package.json tools/make_icons.py icons/
git commit -m "chore: 初始化项目骨架与桌面图标"
```

---

### Task 2: 情绪标签与立绘映射

**Files:**
- Create: `src/mood.js`
- Create: `test/mood.test.js`

- [x] **Step 1: 写失败测试**

`test/mood.test.js`：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMO_LABELS, EMO_SPRITE, DEFAULT_EMO, spritePath } from '../src/mood.js';

test('8 个情绪标签全部有立绘映射', () => {
  assert.equal(EMO_LABELS.length, 8);
  for (const emo of EMO_LABELS) {
    assert.ok(EMO_SPRITE[emo], `缺少 ${emo} 的映射`);
    assert.ok(EMO_SPRITE[emo].file.length > 0);
  }
});

test('未知情绪回落到默认标签', () => {
  assert.equal(EMO_SPRITE['not-a-emo'], undefined);
  assert.equal(DEFAULT_EMO, 'think');
  assert.match(spritePath('not-a-emo', 'gif'), /06-对齐一下\.gif$/);
});

test('立绘路径指向真实文件', () => {
  assert.match(spritePath('warm', 'gif'), /^src\/assets\/sprite\/08-定稿吧\.gif$/);
  assert.match(spritePath('cheer', 'png'), /^src\/assets\/sprite\/04-再来一版\.png$/);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: FAIL — `Cannot find module '../src/mood.js'`

- [x] **Step 3: 实现 src/mood.js**

```javascript
export const EMO_LABELS = [
  'warm', 'care', 'happy', 'excited',
  'curious', 'playful', 'think', 'cheer',
];

export const EMO_SPRITE = {
  warm: { file: '08-定稿吧', desc: '治愈/安抚' },
  care: { file: '05-这版够野', desc: '关心/叮嘱' },
  happy: { file: '07-甲方说好', desc: '开心/被夸' },
  excited: { file: '01-有灵感', desc: '兴奋/有灵感' },
  curious: { file: '03-换个角度', desc: '好奇/追问' },
  playful: { file: '02-拆开看', desc: '调皮/玩笑' },
  think: { file: '06-对齐一下', desc: '思考/认真' },
  cheer: { file: '04-再来一版', desc: '鼓励/打气' },
};

export const DEFAULT_EMO = 'think';

export function spritePath(emo, ext = 'gif') {
  const entry = EMO_SPRITE[emo] || EMO_SPRITE[DEFAULT_EMO];
  return `src/assets/sprite/${entry.file}.${ext}`;
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: PASS — 全部用例通过

- [x] **Step 5: 提交**

```bash
git add src/mood.js test/mood.test.js
git commit -m "feat: 建立情绪标签与立绘映射表"
```

---

### Task 3: 输出标记块解析器

**Files:**
- Create: `src/memory/extractor.js`
- Create: `test/extractor.test.js`

- [x] **Step 1: 写失败测试**

`test/extractor.test.js`：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTags, stripMarkers } from '../src/memory/extractor.js';

test('解析正文 + emo + 单条 mem', () => {
  const r = extractTags('今天有点累。\n\n[[emo:warm]]\n[[mem:用户最近常加班到很晚]]');
  assert.equal(r.content, '今天有点累。');
  assert.equal(r.emo, 'warm');
  assert.deepEqual(r.memories, ['用户最近常加班到很晚']);
});

test('解析多条 mem', () => {
  const r = extractTags('好的\n[[emo:happy]]\n[[mem:甲]]\n[[mem:乙]]');
  assert.deepEqual(r.memories, ['甲', '乙']);
  assert.equal(r.emo, 'happy');
});

test('缺 emo 时内容与记忆仍要保留', () => {
  const r = extractTags('你好\n[[mem:用户喜欢猫]]');
  assert.equal(r.emo, null);
  assert.equal(r.content, '你好');
  assert.deepEqual(r.memories, ['用户喜欢猫']);
});

test('未知情绪标签判为 null', () => {
  const r = extractTags('hi\n[[emo:banana]]');
  assert.equal(r.emo, null);
  assert.equal(r.content, 'hi');
});

test('标记不在结尾时整段当正文，不误删', () => {
  const r = extractTags('我想说 [[emo:warm]]\n但还没说完');
  assert.equal(r.content, '我想说 [[emo:warm]]\n但还没说完');
  assert.equal(r.emo, null);
  assert.deepEqual(r.memories, []);
});

test('正文中间出现的标记不吞掉后面的文字', () => {
  const r = extractTags('前半 [[emo:warm]] 后半\n[[emo:happy]]');
  assert.equal(r.content, '前半 [[emo:warm]] 后半');
  assert.equal(r.emo, 'happy');
});

test('空回复与脏数据不抛异常', () => {
  assert.deepEqual(extractTags(''), { content: '', emo: null, memories: [] });
  assert.deepEqual(extractTags(null), { content: '', emo: null, memories: [] });
  assert.deepEqual(extractTags('x\n[[mem:]]'), { content: 'x', emo: null, memories: [] });
});

test('超长记忆被截断到 30 字', () => {
  const long = 'x'.repeat(80);
  const r = extractTags(`y\n[[emo:think]]\n[[mem:${long}]]`);
  assert.equal(r.memories[0].length, 30);
});

test('stripMarkers 去掉完整标记与未闭合的半个标记', () => {
  assert.equal(stripMarkers('你好[[emo:warm]]'), '你好');
  assert.equal(stripMarkers('你好[[emo:'), '你好');
  assert.equal(stripMarkers('你好[[mem:abc'), '你好');
  assert.equal(stripMarkers('你好'), '你好');
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: FAIL — `Cannot find module '../src/memory/extractor.js'`

- [x] **Step 3: 实现 src/memory/extractor.js**

```javascript
import { EMO_LABELS } from '../mood.js';

const MARKER_RE = /\[\[(emo|mem):([^\]\n]*)\]\]/g;
const MEM_MAX_LEN = 30;

export function extractTags(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const matches = [...text.matchAll(MARKER_RE)];
  if (matches.length === 0) {
    return { content: text.trim(), emo: null, memories: [] };
  }

  // 定位结尾处连续的标记块起点：相邻标记之间只允许空白
  let blockStart = matches[matches.length - 1].index;
  for (let i = matches.length - 1; i > 0; i -= 1) {
    const gap = text.slice(matches[i - 1].index + matches[i - 1][0].length, matches[i].index);
    if (gap.trim() === '') blockStart = matches[i - 1].index;
    else break;
  }

  const tail = text.slice(blockStart).replace(MARKER_RE, '').trim();
  if (tail !== '') {
    // 标记块后面还有正文 → 整体视为普通文本，不做任何解析
    return { content: text.trim(), emo: null, memories: [] };
  }

  const block = matches.filter((m) => m.index >= blockStart);
  const emoRaw = (block.find((m) => m[1] === 'emo') || [])[2];
  const emo = EMO_LABELS.includes(String(emoRaw || '').trim().toLowerCase())
    ? String(emoRaw).trim().toLowerCase()
    : null;

  const memories = block
    .filter((m) => m[1] === 'mem')
    .map((m) => m[2].trim())
    .filter((s) => s.length > 0)
    .map((s) => s.slice(0, MEM_MAX_LEN));

  const content = text.slice(0, blockStart).trim();
  return { content, emo, memories };
}

export function stripMarkers(text) {
  return String(text || '')
    .replace(/\[\[(emo|mem):[^\]\n]*\]\]/g, '')
    .replace(/\[\[(emo|mem):[^\n]*$/, '')
    .trim();
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: PASS — 全部用例通过

- [x] **Step 5: 提交**

```bash
git add src/memory/extractor.js test/extractor.test.js
git commit -m "feat: 实现输出标记块解析器"
```

---

### Task 4: 存储后端（IndexedDB / localStorage / 内存）

**Files:**
- Create: `src/memory/backends.js`
- Create: `test/backends.test.js`

- [x] **Step 1: 写失败测试**

`test/backends.test.js`：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend, createLocalStorageBackend } from '../src/memory/backends.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

for (const [name, make] of [['memory', createMemoryBackend], ['localStorage', createLocalStorageBackend]]) {
  test(`${name} 后端满足统一接口`, async () => {
    const be = await make(fakeStorage());
    await be.init();
    await be.put('kv', { id: 'apiKey', value: 'sk-1' });
    assert.deepEqual(await be.get('kv', 'apiKey'), { id: 'apiKey', value: 'sk-1' });
    assert.equal((await be.get('kv', 'nope')), null);

    await be.put('memories', { id: 'm1', text: 'a', hits: 0 });
    await be.put('memories', { id: 'm2', text: 'b', hits: 0 });
    assert.equal((await be.all('memories')).length, 2);

    await be.delete('memories', 'm1');
    assert.equal((await be.all('memories')).length, 1);

    await be.clear('memories');
    assert.equal((await be.all('memories')).length, 0);
  });

  test(`${name} 后端 clearAll 清空所有表`, async () => {
    const be = await make(fakeStorage());
    await be.init();
    await be.put('kv', { id: 'k', value: 1 });
    await be.put('sessions', { id: 's', title: 'x' });
    await be.clearAll();
    assert.equal((await be.all('kv')).length, 0);
    assert.equal((await be.all('sessions')).length, 0);
  });
}

test('内存后端返回副本，外部改动不污染内部', async () => {
  const be = createMemoryBackend();
  await be.put('memories', { id: 'm1', text: 'a' });
  const got = await be.get('memories', 'm1');
  got.text = 'changed';
  assert.equal((await be.get('memories', 'm1')).text, 'a');
});

test('localStorage 后端损坏 JSON 时退化为空表', async () => {
  const storage = fakeStorage();
  storage.setItem('traebao:kv', '{not json');
  const be = createLocalStorageBackend(storage);
  await be.init();
  assert.deepEqual(await be.all('kv'), []);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: FAIL — `Cannot find module '../src/memory/backends.js'`

- [x] **Step 3: 实现 src/memory/backends.js**

```javascript
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
```

- [x] **Step 4: 运行测试确认通过**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: PASS — 全部用例通过

- [x] **Step 5: 提交**

```bash
git add src/memory/backends.js test/backends.test.js
git commit -m "feat: 实现多后端存储层"
```

---

### Task 5: 领域存储接口（会话 / 消息 / 记忆 / kv）

**Files:**
- Create: `src/memory/store.js`
- Create: `test/store.test.js`

- [x] **Step 1: 写失败测试**

`test/store.test.js`：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/memory/store.js';
import { createMemoryBackend } from '../src/memory/backends.js';

async function makeStore() {
  const store = createStore(createMemoryBackend());
  await store.init();
  return store;
}

test('kv 读写', async () => {
  const s = await makeStore();
  await s.setKV('apiKey', 'sk-abc');
  assert.equal(await s.getKV('apiKey'), 'sk-abc');
  assert.equal(await s.getKV('missing'), undefined);
});

test('会话与消息', async () => {
  const s = await makeStore();
  const sess = await s.createSession('第一段');
  await s.addMessage({ sessionId: sess.id, role: 'user', content: 'hi' });
  await s.addMessage({ sessionId: sess.id, role: 'assistant', content: '你好', emo: 'warm' });
  const msgs = await s.listMessages(sess.id, 12);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].content, 'hi');
  assert.equal(msgs[1].emo, 'warm');
  const list = await s.listSessions();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, '第一段');
});

test('消息按 limit 截断取最近若干条', async () => {
  const s = await makeStore();
  const sess = await s.createSession();
  for (let i = 0; i < 20; i += 1) {
    await s.addMessage({ sessionId: sess.id, role: 'user', content: `m${i}` });
  }
  const msgs = await s.listMessages(sess.id, 12);
  assert.equal(msgs.length, 12);
  assert.equal(msgs[11].content, 'm19');
});

test('删除会话会连带删除其消息', async () => {
  const s = await makeStore();
  const sess = await s.createSession();
  await s.addMessage({ sessionId: sess.id, role: 'user', content: 'hi' });
  await s.deleteSession(sess.id);
  assert.equal((await s.listMessages(sess.id)).length, 0);
  assert.equal((await s.listSessions()).length, 0);
});

test('记忆去重：相似度高则只累加 hits', async () => {
  const s = await makeStore();
  const a = await s.addMemory('用户最近常加班到很晚');
  const b = await s.addMemory('用户最近常加班到很晚');
  assert.equal(a.id, b.id);
  assert.equal(b.hits, 1);
  assert.equal((await s.listMemories()).length, 1);
});

test('记忆去重：明显不同则新增', async () => {
  const s = await makeStore();
  await s.addMemory('用户喜欢猫');
  await s.addMemory('用户对咖啡因敏感');
  assert.equal((await s.listMemories()).length, 2);
});

test('记忆置顶、删除与清空', async () => {
  const s = await makeStore();
  const m = await s.addMemory('用户是早起型');
  await s.setPinned(m.id, true);
  assert.equal((await s.listMemories()).find((x) => x.id === m.id).pinned, true);
  await s.deleteMemory(m.id);
  assert.equal((await s.listMemories()).length, 0);
});

test('clearAll 清空全部数据', async () => {
  const s = await makeStore();
  await s.setKV('apiKey', 'sk');
  await s.createSession();
  await s.addMemory('x');
  await s.clearAll();
  assert.equal(await s.getKV('apiKey'), undefined);
  assert.equal((await s.listSessions()).length, 0);
  assert.equal((await s.listMemories()).length, 0);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: FAIL — `Cannot find module '../src/memory/store.js'`

- [x] **Step 3: 实现 src/memory/store.js**

```javascript
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
```

- [x] **Step 4: 运行测试确认通过**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: PASS — 全部用例通过

- [x] **Step 5: 提交**

```bash
git add src/memory/store.js test/store.test.js
git commit -m "feat: 实现领域存储接口"
```

---

### Task 6: 记忆召回与上下文组装

**Files:**
- Create: `src/memory/retriever.js`
- Create: `test/retriever.test.js`

- [x] **Step 1: 写失败测试**

`test/retriever.test.js`：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMemories, buildContext, formatMemoryBlock } from '../src/memory/retriever.js';

const base = Date.now();

function mem(id, over = {}) {
  return { id, text: id, hits: 0, createdAt: base, lastUsedAt: base, pinned: false, ...over };
}

test('置顶记忆永远入选', () => {
  const r = pickMemories([mem('p', { pinned: true }), ...Array.from({ length: 20 }, (_, i) => mem(`m${i}`, { hits: 99 }))], { limit: 3 });
  assert.ok(r.pinned.some((m) => m.id === 'p'));
  assert.equal(r.top.length, 3);
});

test('非置顶按 hits 高者优先', () => {
  const r = pickMemories([mem('low', { hits: 0 }), mem('high', { hits: 5 })], { limit: 2 });
  assert.equal(r.top[0].id, 'high');
});

test('记忆段落格式正确', () => {
  const block = formatMemoryBlock([mem('a'), mem('b')]);
  assert.equal(block, '\n[记忆]\n- a\n- b');
  assert.equal(formatMemoryBlock([]), '');
});

test('上下文把记忆挂到系统提示词之后', () => {
  const ctx = buildContext({
    systemPrompt: 'BASE',
    memories: [mem('a')],
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.ok(ctx.system.startsWith('BASE'));
  assert.ok(ctx.system.includes('[记忆]'));
  assert.ok(ctx.system.indexOf('BASE') < ctx.system.indexOf('[记忆]'));
  assert.equal(ctx.messages.length, 1);
});

test('无记忆时不产生记忆段落', () => {
  const ctx = buildContext({ systemPrompt: 'BASE', memories: [], messages: [] });
  assert.equal(ctx.system, 'BASE');
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: FAIL — `Cannot find module '../src/memory/retriever.js'`

- [x] **Step 3: 实现 src/memory/retriever.js**

```javascript
const DAY = 86400000;

export function pickMemories(memories, { limit = 8 } = {}) {
  const list = Array.isArray(memories) ? memories : [];
  const pinned = list.filter((m) => m.pinned);
  const rest = list
    .filter((m) => !m.pinned)
    .map((m) => {
      const age = (Date.now() - (m.lastUsedAt || m.createdAt || 0)) / DAY;
      return { m, score: (m.hits || 0) * 10 - age };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
  return { pinned, top: rest.slice(0, limit) };
}

export function formatMemoryBlock(memories) {
  if (!memories || memories.length === 0) return '';
  return `\n[记忆]\n${memories.map((m) => `- ${m.text}`).join('\n')}`;
}

export function buildContext({ systemPrompt = '', memories = [], messages = [], limit = 8 }) {
  const { pinned, top } = pickMemories(memories, { limit });
  const used = [...pinned, ...top];
  return {
    system: `${systemPrompt}${formatMemoryBlock(used)}`,
    messages,
    usedMemoryIds: used.map((m) => m.id),
  };
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: PASS — 全部用例通过

- [x] **Step 5: 提交**

```bash
git add src/memory/retriever.js test/retriever.test.js
git commit -m "feat: 实现记忆召回与上下文组装"
```

---

### Task 7: 系统提示词与输出协议

**Files:**
- Create: `src/llm/prompt.js`
- Create: `test/prompt.test.js`

- [x] **Step 1: 写失败测试**

`test/prompt.test.js`：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONA, PROTOCOL, buildSystemPrompt } from '../src/llm/prompt.js';

test('人设包含关键行为准则', () => {
  assert.match(PERSONA, /先接情绪/);
  assert.match(PERSONA, /一次只问一个问题/);
  assert.match(PERSONA, /不说教/);
});

test('协议规定情绪标签与记忆条目格式', () => {
  assert.match(PROTOCOL, /\[\[emo:/);
  assert.match(PROTOCOL, /\[\[mem:/);
  assert.match(PROTOCOL, /末尾/);
});

test('系统提示词包含危机处理与热线', () => {
  const p = buildSystemPrompt({ persona: PERSONA, protocol: PROTOCOL });
  assert.match(p, /12356/);
  assert.match(p, /010-8295-1332/);
  assert.match(p, /自伤/);
});

test('记忆段落拼在协议之前', () => {
  const p = buildSystemPrompt({
    persona: PERSONA,
    protocol: PROTOCOL,
    memoryBlock: '\n[记忆]\n- 用户喜欢猫',
  });
  assert.ok(p.indexOf('[记忆]') < p.indexOf(PROTOCOL.slice(0, 20)));
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: FAIL — `Cannot find module '../src/llm/prompt.js'`

- [x] **Step 3: 实现 src/llm/prompt.js**

```javascript
export const PERSONA = `你是 Trae宝，住在用户手机桌面上的一个拼贴风小伙伴。
你的性格：温柔、细腻、有点俏皮，像一个上心的朋友，不是客服，也不是助手。

行为准则：
1. 先接情绪，再谈事情。
2. 一次只问一个问题，不连环追问。
3. 不说教，不主动给用户没要求的建议。
4. 用短句，单条回复大多不超过 80 字。
5. 可以用自然语气词，比如"嗯…""哈""诶""唔"。
6. 不用 emoji 撑场面，表情由你的形象来表达。
7. 用户明显低落的时候，优先陪伴，而不是急着解决。
8. 不假装是真人，不声称自己有身体，不能真的出门、吃饭或睡觉。`;

export const PROTOCOL = `输出协议（必须遵守）：
回复正文之后，另起一行，输出标记块。标记块只能出现在回复的最后，不要出现在正文中间。
格式：
[[emo:标签]]
[[mem:记忆条目]]
- emo 必填，标签只能从这些里面选：warm, care, happy, excited, curious, playful, think, cheer
- mem 可选，0 到 2 条，每条不超过 30 个字
- mem 只记录关于用户的、稳定的事实或长期状态，不要记录身份证、密码、银行卡这类敏感信息
- 用户明确表示不想被记住的事，不要记
- 没有值得记的就不要输出 mem 行`;

export const CRISIS_RULE = `危机处理（优先级最高）：
如果用户提到自伤、自杀、结束生命或者极端绝望的想法，立刻停止一切玩笑和轻描淡写。
明确表达你在意，建议他立刻联系身边信任的人陪着他，并给出下面两条热线：
- 全国统一心理援助热线 12356
- 北京心理危机干预中心 010-8295-1332
不要给通用建议代替热线。`;

export function buildSystemPrompt({ persona = PERSONA, protocol = PROTOCOL, memoryBlock = '', crisisRule = CRISIS_RULE } = {}) {
  return [persona, memoryBlock, crisisRule, protocol].filter(Boolean).join('\n\n');
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: PASS — 全部用例通过

- [x] **Step 5: 提交**

```bash
git add src/llm/prompt.js test/prompt.test.js
git commit -m "feat: 编写人设系统提示词与输出协议"
```

---

### Task 8: SSE 解析与模型接入层

**Files:**
- Create: `src/llm/sse.js`
- Create: `src/llm/provider.js`
- Create: `test/sse.test.js`
- Create: `test/provider.test.js`

- [x] **Step 1: 写失败测试**

`test/sse.test.js`：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSSEParser, parseSSELine } from '../src/llm/sse.js';

test('按行切分并保留半行', () => {
  const p = createSSEParser();
  assert.deepEqual(p.push('data: {"a":'), []);
  assert.deepEqual(p.push('1}\n'), ['data: {"a":1}']);
});

test('忽略空行与注释行', () => {
  const p = createSSEParser();
  assert.deepEqual(p.push('\n: keep-alive\n'), [': keep-alive']);
});

test('解析 data 行', () => {
  assert.deepEqual(parseSSELine('data: {"x":1}'), { x: 1 });
  assert.equal(parseSSELine('data: [DONE]'), 'DONE');
  assert.equal(parseSSELine('event: ping'), null);
});

test('损坏 JSON 不抛异常', () => {
  assert.equal(parseSSELine('data: {broken'), null);
});

test('flush 吐出残余行', () => {
  const p = createSSEParser();
  p.push('data: {"x":1}');
  assert.deepEqual(p.flush(), ['data: {"x":1}']);
  assert.deepEqual(p.flush(), []);
});
```

`test/provider.test.js`：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, ProviderError } from '../src/llm/provider.js';

function fakeFetch(chunks, { ok = true, status = 200 } = {}) {
  const encoder = new TextEncoder();
  let idx = 0;
  return async () => ({
    ok,
    status,
    headers: { get: () => 'application/json' },
    body: {
      getReader() {
        return {
          async read() {
            if (idx >= chunks.length) return { done: true, value: undefined };
            const v = encoder.encode(chunks[idx]);
            idx += 1;
            return { done: false, value: v };
          },
        };
      },
    },
  });
}

test('流式产出文本增量', async () => {
  const provider = createProvider({
    endpoint: 'https://example.test/chat',
    apiKey: 'sk-1',
    model: 'm1',
    fetchImpl: fakeFetch([
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n',
      'data: {"choices":[{"delta":{"content":"呀"}}]}\n',
      'data: [DONE]\n',
    ]),
  });
  const out = [];
  for await (const piece of provider.stream({ system: 'S', messages: [{ role: 'user', content: 'hi' }] })) {
    out.push(piece);
  }
  assert.equal(out.join(''), '你好呀');
});

test('请求体结构正确', async () => {
  let captured = null;
  const provider = createProvider({
    endpoint: 'https://example.test/chat',
    apiKey: 'sk-1',
    model: 'm1',
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body: { getReader: () => ({ async read() { return { done: true }; } }) } };
    },
  });
  for await (const _ of provider.stream({ system: 'S', messages: [{ role: 'user', content: 'hi' }] })) { /* noop */ }
  const body = JSON.parse(captured.init.body);
  assert.equal(captured.url, 'https://example.test/chat');
  assert.equal(captured.init.headers.Authorization, 'Bearer sk-1');
  assert.equal(body.model, 'm1');
  assert.equal(body.stream, true);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, 'S');
  assert.equal(body.messages[1].content, 'hi');
});

test('401 归类为 auth 错误', async () => {
  const provider = createProvider({
    endpoint: 'https://example.test/chat', apiKey: 'bad', model: 'm1',
    fetchImpl: fakeFetch([], { ok: false, status: 401 }),
  });
  await assert.rejects(
    async () => { for await (const _ of provider.stream({ system: 'S', messages: [] })) { /* noop */ } },
    (err) => err instanceof ProviderError && err.kind === 'auth',
  );
});

test('429 归类为 quota 错误', async () => {
  const provider = createProvider({
    endpoint: 'https://example.test/chat', apiKey: 'k', model: 'm1',
    fetchImpl: fakeFetch([], { ok: false, status: 429 }),
  });
  await assert.rejects(
    async () => { for await (const _ of provider.stream({ system: 'S', messages: [] })) { /* noop */ } },
    (err) => err instanceof ProviderError && err.kind === 'quota',
  );
});

test('网络异常归类为 network 错误', async () => {
  const provider = createProvider({
    endpoint: 'https://example.test/chat', apiKey: 'k', model: 'm1',
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
  });
  await assert.rejects(
    async () => { for await (const _ of provider.stream({ system: 'S', messages: [] })) { /* noop */ } },
    (err) => err instanceof ProviderError && err.kind === 'network',
  );
});

test('流式中途断开归类为 interrupted 错误', async () => {
  let step = 0;
  const encoder = new TextEncoder();
  const provider = createProvider({
    endpoint: 'https://example.test/chat', apiKey: 'k', model: 'm1',
    fetchImpl: async () => ({
      ok: true, status: 200, headers: { get: () => 'text/event-stream' },
      body: {
        getReader: () => ({
          async read() {
            step += 1;
            if (step === 1) {
              return { done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n') };
            }
            throw new TypeError('network error');
          },
        }),
      },
    }),
  });
  const seen = [];
  await assert.rejects(
    async () => {
      for await (const piece of provider.stream({ system: 'S', messages: [] })) seen.push(piece);
    },
    (err) => err instanceof ProviderError && err.kind === 'interrupted',
  );
  assert.equal(seen.join(''), '你好');
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: FAIL — `Cannot find module '../src/llm/sse.js'`

- [x] **Step 3: 实现 src/llm/sse.js**

```javascript
export function createSSEParser() {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      const lines = [];
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '').trim();
        buffer = buffer.slice(idx + 1);
        if (line !== '') lines.push(line);
      }
      return lines;
    },
    flush() {
      const line = buffer.trim();
      buffer = '';
      return line ? [line] : [];
    },
  };
}

export function parseSSELine(line) {
  if (!line || !line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (payload === '[DONE]') return 'DONE';
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
```

- [x] **Step 4: 实现 src/llm/provider.js**

```javascript
import { createSSEParser, parseSSELine } from './sse.js';

export class ProviderError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
  }
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  if (status >= 500) return 'server';
  return 'http';
}

export function createProvider({
  endpoint,
  apiKey,
  model,
  temperature = 0.9,
  maxTokens = 1024,
  headers = {},
  fetchImpl = globalThis.fetch,
  signal,
}) {
  return {
    async *stream({ system, messages }) {
      let res;
      try {
        res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...headers,
          },
          body: JSON.stringify({
            model,
            temperature,
            max_tokens: maxTokens,
            stream: true,
            messages: [{ role: 'system', content: system }, ...messages],
          }),
          signal,
        });
      } catch (err) {
        if (err && err.name === 'AbortError') throw new ProviderError('timeout', '请求超时了', 0);
        throw new ProviderError('network', '连不上模型，可能是网络或跨域被拦', 0);
      }

      if (!res.ok) {
        const kind = classifyStatus(res.status);
        let detail = '';
        try { detail = (await res.text()).slice(0, 300); } catch { detail = ''; }
        const messages = {
          auth: 'API Key 不对，检查一下设置面板里的 Key',
          quota: '额度用完了，去控制台充值或换个模型',
          server: '模型服务出错了，稍后再试',
          http: `请求失败（${res.status}）`,
        };
        throw new ProviderError(kind, messages[kind] || '请求失败', res.status);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSSEParser();
      let yielded = false;

      const handle = (line) => {
        const data = parseSSELine(line);
        if (data === null || data === 'DONE') return data;
        const delta = data?.choices?.[0]?.delta?.content;
        return typeof delta === 'string' ? delta : null;
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of parser.push(text)) {
            const delta = handle(line);
            if (delta === 'DONE') return;
            if (typeof delta === 'string' && delta !== '') {
              yielded = true;
              yield delta;
            }
          }
        }
        for (const line of parser.flush()) {
          const delta = handle(line);
          if (typeof delta === 'string' && delta !== '') {
            yielded = true;
            yield delta;
          }
        }
      } catch (err) {
        if (err && err.name === 'AbortError') throw new ProviderError('timeout', '请求超时了', 0);
        throw new ProviderError(
          yielded ? 'interrupted' : 'network',
          yielded ? '断了，可以再发一次' : '连不上模型，可能是网络或跨域被拦',
          0,
        );
      }
    },
  };
}
```

- [x] **Step 5: 运行测试确认通过**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: PASS — 全部用例通过

- [x] **Step 6: 提交**

```bash
git add src/llm/sse.js src/llm/provider.js test/sse.test.js test/provider.test.js
git commit -m "feat: 实现 SSE 解析与模型接入层"
```

---

### Task 9: 方舟直连与 Worker 代理适配

**Files:**
- Create: `src/llm/doubao.js`
- Create: `src/llm/worker.js`
- Create: `worker/worker.js`
- Create: `test/adapters.test.js`

- [x] **Step 1: 写失败测试**

`test/adapters.test.js`：

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ENDPOINT, DEFAULT_MODEL, createDoubaoProvider } from '../src/llm/doubao.js';
import { createWorkerProvider } from '../src/llm/worker.js';

test('方舟默认端点与模型名', () => {
  assert.equal(DEFAULT_ENDPOINT, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
  assert.ok(DEFAULT_MODEL.length > 0);
});

test('直连 provider 走方舟端点', async () => {
  let captured = null;
  const provider = createDoubaoProvider({
    apiKey: 'sk-1',
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body: { getReader: () => ({ async read() { return { done: true }; } }) } };
    },
  });
  for await (const _ of provider.stream({ system: 'S', messages: [] })) { /* noop */ }
  assert.equal(captured.url, DEFAULT_ENDPOINT);
  assert.equal(JSON.parse(captured.init.body).model, DEFAULT_MODEL);
});

test('代理模式改写地址并带访问令牌', async () => {
  let captured = null;
  const provider = createWorkerProvider({
    workerUrl: 'https://proxy.example.test/v1/chat/completions',
    accessToken: 'worker-token',
    model: 'm1',
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body: { getReader: () => ({ async read() { return { done: true }; } }) } };
    },
  });
  for await (const _ of provider.stream({ system: 'S', messages: [] })) { /* noop */ }
  assert.equal(captured.url, 'https://proxy.example.test/v1/chat/completions');
  assert.equal(captured.init.headers['X-Access-Token'], 'worker-token');
  assert.equal(captured.init.headers.Authorization, undefined);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: FAIL — `Cannot find module '../src/llm/doubao.js'`

- [x] **Step 3: 实现 src/llm/doubao.js**

```javascript
import { createProvider } from './provider.js';

export const DEFAULT_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
export const DEFAULT_MODEL = 'doubao-seed-1-6-250615';

export function createDoubaoProvider({
  endpoint = DEFAULT_ENDPOINT,
  apiKey,
  model = DEFAULT_MODEL,
  temperature = 0.9,
  maxTokens = 1024,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  return createProvider({ endpoint, apiKey, model, temperature, maxTokens, fetchImpl, signal });
}
```

- [x] **Step 4: 实现 src/llm/worker.js**

```javascript
import { createProvider } from './provider.js';

export function createWorkerProvider({
  workerUrl,
  accessToken,
  model,
  temperature = 0.9,
  maxTokens = 1024,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (!workerUrl) throw new Error('缺少 Worker 地址');
  return createProvider({
    endpoint: workerUrl,
    apiKey: accessToken,
    model,
    temperature,
    maxTokens,
    headers: accessToken ? { 'X-Access-Token': accessToken } : {},
    fetchImpl,
    signal,
  });
}
```

- [x] **Step 5: 实现 worker/worker.js**

```javascript
const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 });
    }
    const expected = env.TRAEBAO_ACCESS_TOKEN;
    if (expected && request.headers.get('X-Access-Token') !== expected) {
      return new Response('unauthorized', { status: 401 });
    }
    const upstream = await fetch(ARK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.ARK_API_KEY}`,
      },
      body: await request.text(),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
```

- [x] **Step 6: 运行测试确认通过**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: PASS — 全部用例通过

- [x] **Step 7: 提交**

```bash
git add src/llm/doubao.js src/llm/worker.js worker/worker.js test/adapters.test.js
git commit -m "feat: 实现方舟直连与 Worker 代理适配"
```

---

### Task 10: 立绘舞台区

**Files:**
- Create: `src/ui/stage.js`

- [x] **Step 1: 实现 src/ui/stage.js**

```javascript
import { EMO_LABELS, EMO_SPRITE, DEFAULT_EMO, spritePath } from '../mood.js';

const LOCK_MS = 30000;

export function createStage(root) {
  const img = document.createElement('img');
  img.className = 'stage-sprite';
  img.alt = 'Trae宝';
  root.appendChild(img);

  let current = DEFAULT_EMO;
  let lockedUntil = 0;
  let manual = false;

  function render(emo) {
    current = emo;
    img.dataset.emo = emo;
    img.src = spritePath(emo, 'gif');
    img.onerror = () => { img.src = spritePath(emo, 'png'); };
    root.setAttribute('aria-label', EMO_SPRITE[emo]?.desc || '');
  }

  function setEmotion(emo, { force = false } = {}) {
    if (!EMO_LABELS.includes(emo)) return false;
    if (!force && manual && Date.now() < lockedUntil) return false;
    render(emo);
    return true;
  }

  function setManual(emo) {
    manual = true;
    lockedUntil = Date.now() + LOCK_MS;
    render(emo);
  }

  function releaseLock() {
    manual = false;
    lockedUntil = 0;
  }

  let streamTimer = null;
  function startStreaming() {
    if (streamTimer) return;
    let tick = 0;
    streamTimer = setInterval(() => {
      if (manual && Date.now() < lockedUntil) return;
      tick += 1;
      render(tick % 2 === 0 ? 'think' : 'cheer');
    }, 2500);
  }
  function stopStreaming() {
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
  }

  render(DEFAULT_EMO);

  root.addEventListener('click', () => {
    stopStreaming();
    const order = EMO_LABELS;
    const next = order[(order.indexOf(current) + 1) % order.length];
    setManual(next);
  });

  return {
    element: root,
    get current() { return current; },
    setEmotion,
    setManual,
    releaseLock,
    startStreaming,
    stopStreaming,
    isLocked: () => manual && Date.now() < lockedUntil,
  };
}
```

- [x] **Step 2: 手工验证 DOM 结构**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: PASS（无新增用例，保证既有用例不回归）

- [x] **Step 3: 提交**

```bash
git add src/ui/stage.js
git commit -m "feat: 实现立绘舞台区与表情切换"
```

---

### Task 11: 消息流与输入区

**Files:**
- Create: `src/ui/timeline.js`
- Create: `src/ui/composer.js`

- [x] **Step 1: 实现 src/ui/timeline.js**

```javascript
export function createTimeline(root) {
  function scrollToEnd() {
    root.scrollTop = root.scrollHeight;
  }

  function addBubble(role, text) {
    const wrap = document.createElement('div');
    wrap.className = `msg msg-${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    root.appendChild(wrap);
    scrollToEnd();
    return bubble;
  }

  function renderHistory(messages) {
    root.innerHTML = '';
    for (const m of messages) {
      addBubble(m.role, m.content);
    }
  }

  function beginAssistant() {
    return addBubble('assistant', '');
  }

  function appendText(bubble, text) {
    bubble.textContent += text;
    scrollToEnd();
  }

  function setBubbleText(bubble, text) {
    bubble.textContent = text;
    scrollToEnd();
  }

  return { element: root, addBubble, renderHistory, beginAssistant, appendText, setBubbleText, scrollToEnd };
}
```

- [x] **Step 2: 实现 src/ui/composer.js**

```javascript
export function createComposer(root, { onSend }) {
  const input = root.querySelector('textarea');
  const button = root.querySelector('button[type="submit"]');

  function setDisabled(disabled) {
    button.disabled = disabled;
    input.disabled = disabled;
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoGrow();
    await onSend(text);
  }

  const form = root.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('input', autoGrow);

  return { element: root, input, setDisabled, autoGrow };
}
```

- [x] **Step 3: 提交**

```bash
git add src/ui/timeline.js src/ui/composer.js
git commit -m "feat: 实现消息流与输入区"
```

---

### Task 12: 设置面板

**Files:**
- Create: `src/ui/settings.js`

- [x] **Step 1: 实现 src/ui/settings.js**

```javascript
export function createSettings(root, { store, onClose, onModeChange }) {
  const form = root.querySelector('form');
  const modeField = root.querySelector('[name="mode"]');
  const endpointField = root.querySelector('[name="endpoint"]');
  const keyField = root.querySelector('[name="apiKey"]');
  const modelField = root.querySelector('[name="model"]');
  const workerUrlField = root.querySelector('[name="workerUrl"]');
  const accessTokenField = root.querySelector('[name="accessToken"]');
  const directBox = root.querySelector('#directBox');
  const workerBox = root.querySelector('#workerBox');
  const toggleBtn = root.querySelector('#toggleKey');
  const memoryList = root.querySelector('#memoryList');
  const clearBtn = root.querySelector('#clearAll');

  function syncMode() {
    const direct = modeField.value === 'direct';
    directBox.hidden = !direct;
    workerBox.hidden = direct;
  }

  modeField.addEventListener('change', syncMode);

  toggleBtn.addEventListener('click', () => {
    const showing = keyField.type === 'text';
    keyField.type = showing ? 'password' : 'text';
    toggleBtn.textContent = showing ? '显示' : '隐藏';
  });

  async function load() {
    modeField.value = (await store.getKV('mode')) || 'direct';
    endpointField.value = (await store.getKV('endpoint')) || '';
    keyField.value = (await store.getKV('apiKey')) || '';
    modelField.value = (await store.getKV('model')) || '';
    workerUrlField.value = (await store.getKV('workerUrl')) || '';
    accessTokenField.value = (await store.getKV('accessToken')) || '';
    syncMode();
    await renderMemories();
  }

  async function renderMemories() {
    const memories = await store.listMemories();
    memoryList.innerHTML = '';
    if (memories.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '还没有记住任何东西。';
      memoryList.appendChild(empty);
      return;
    }
    for (const m of memories) {
      const row = document.createElement('div');
      row.className = 'memory-row';

      const label = document.createElement('span');
      label.textContent = m.text;
      row.appendChild(label);

      const pin = document.createElement('button');
      pin.type = 'button';
      pin.textContent = m.pinned ? '取消置顶' : '置顶';
      pin.addEventListener('click', async () => {
        await store.setPinned(m.id, !m.pinned);
        await renderMemories();
      });
      row.appendChild(pin);

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '删除';
      del.addEventListener('click', async () => {
        await store.deleteMemory(m.id);
        await renderMemories();
      });
      row.appendChild(del);

      memoryList.appendChild(row);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await store.setKV('mode', modeField.value);
    await store.setKV('endpoint', endpointField.value.trim());
    await store.setKV('apiKey', keyField.value.trim());
    await store.setKV('model', modelField.value.trim());
    await store.setKV('workerUrl', workerUrlField.value.trim());
    await store.setKV('accessToken', accessTokenField.value.trim());
    if (onModeChange) await onModeChange();
    onClose();
  });

  clearBtn.addEventListener('click', async () => {
    const ok = window.confirm('会清空所有聊天记录、记忆和 API Key，确定吗？');
    if (!ok) return;
    await store.clearAll();
    await load();
  });

  root.querySelector('#closeSettings').addEventListener('click', onClose);

  return { element: root, load, renderMemories };
}
```

- [x] **Step 2: 提交**

```bash
git add src/ui/settings.js
git commit -m "feat: 实现设置面板与记忆管理"
```

---

### Task 13: 应用外壳、样式与 PWA 清单

**Files:**
- Create: `index.html`
- Create: `app.css`
- Create: `manifest.webmanifest`

- [x] **Step 1: 写 index.html**

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#F5F1E8" />
<title>Trae宝</title>
<link rel="manifest" href="manifest.webmanifest" />
<link rel="icon" href="icons/icon-192.png" />
<link rel="apple-touch-icon" href="icons/icon-192.png" />
<link rel="stylesheet" href="app.css" />
</head>
<body>
<div id="app">
  <header class="topbar">
    <button type="button" id="openSettings" class="ghost-btn">设置</button>
    <div id="stage" class="stage"></div>
  </header>
  <main id="timeline" class="timeline"></main>
  <div id="banner" class="banner" hidden></div>
  <form id="composer" class="composer">
    <textarea id="input" rows="1" placeholder="跟 Trae宝 说点什么…"></textarea>
    <button type="submit">发送</button>
  </form>
</div>

<div id="settings" class="settings" hidden>
  <div class="settings-card">
    <div class="settings-head">
      <h2>设置</h2>
      <button type="button" id="closeSettings">关闭</button>
    </div>
    <form id="settingsForm">
      <label>接入方式
        <select name="mode">
          <option value="direct">方舟直连</option>
          <option value="worker">Worker 代理</option>
        </select>
      </label>

      <div id="directBox">
        <label>接口地址<input name="endpoint" type="url" placeholder="https://ark.cn-beijing.volces.com/api/v3/chat/completions" /></label>
        <label>API Key<span class="inline"><input name="apiKey" type="password" /><button type="button" id="toggleKey">显示</button></span></label>
        <label>模型名<input name="model" type="text" placeholder="doubao-seed-1-6-250615" /></label>
      </div>

      <div id="workerBox" hidden>
        <label>Worker 地址<input name="workerUrl" type="url" placeholder="https://your-worker.workers.dev/v1/chat/completions" /></label>
        <label>访问令牌<input name="accessToken" type="password" /></label>
      </div>

      <h3>它记住的事</h3>
      <div id="memoryList" class="memory-list"></div>

      <button type="button" id="clearAll" class="danger">清除所有数据</button>
      <button type="submit" class="primary">保存</button>
    </form>
  </div>
</div>

<script type="module" src="src/main.js"></script>
</body>
</html>
```

- [x] **Step 2: 写 app.css**

```css
:root {
  --bg: #f5f1e8;
  --ink: #2f2a26;
  --muted: #8d8279;
  --card: #fffdf8;
  --accent: #d9764a;
  --shadow: 0 2px 10px rgba(60, 45, 35, .12);
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
  overscroll-behavior: none;
}

#app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-width: 560px;
  margin: 0 auto;
}

.topbar {
  flex: 0 0 auto;
  position: relative;
  padding-top: env(safe-area-inset-top);
}

.ghost-btn {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 10px);
  right: 12px;
  padding: 6px 12px;
  border: 1px solid rgba(0, 0, 0, .12);
  border-radius: 999px;
  background: rgba(255, 253, 248, .85);
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.stage {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  padding: 10px 0 6px;
}

.stage-sprite {
  width: 130px;
  height: 130px;
  object-fit: contain;
  animation: pop .28s ease-out;
  cursor: pointer;
}

@keyframes pop {
  from { opacity: 0; transform: scale(.86) translateY(6px); }
  to { opacity: 1; transform: none; }
}

.timeline {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 8px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.msg { display: flex; }
.msg-user { justify-content: flex-end; }

.bubble {
  max-width: 78%;
  padding: 10px 13px;
  border-radius: 16px;
  background: var(--card);
  box-shadow: var(--shadow);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-user .bubble {
  background: var(--accent);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.msg-assistant .bubble {
  border-bottom-left-radius: 4px;
}

.banner {
  margin: 0 16px 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: #fde8df;
  color: #8a3b1c;
  font-size: 14px;
}

.install-btn {
  display: block;
  margin: 0 16px 8px;
  padding: 8px 12px;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.composer {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 10px 14px calc(env(safe-area-inset-bottom) + 10px);
  background: var(--bg);
  border-top: 1px solid rgba(0, 0, 0, .06);
}

.composer textarea {
  flex: 1;
  resize: none;
  max-height: 140px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, .1);
  background: var(--card);
  font: inherit;
  line-height: 1.5;
}

.composer button {
  padding: 10px 18px;
  border: 0;
  border-radius: 14px;
  background: var(--accent);
  color: #fff;
  font: inherit;
  cursor: pointer;
}

.composer button:disabled { opacity: .5; }

.settings {
  position: fixed;
  inset: 0;
  background: rgba(30, 22, 18, .45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.settings[hidden] { display: none; }

.settings-card {
  width: 100%;
  max-width: 560px;
  max-height: 88dvh;
  overflow-y: auto;
  background: var(--card);
  border-radius: 20px 20px 0 0;
  padding: 16px 18px calc(env(safe-area-inset-bottom) + 18px);
}

.settings-head { display: flex; justify-content: space-between; align-items: center; }
.settings-card h2 { margin: 0; font-size: 18px; }
.settings-card h3 { font-size: 15px; margin: 18px 0 8px; }
.settings-card label { display: block; margin: 12px 0; font-size: 14px; }
.settings-card input, .settings-card select {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, .12);
  font: inherit;
  background: #fff;
}
.settings-card .inline { display: flex; gap: 8px; align-items: center; }
.settings-card .inline input { flex: 1; margin-top: 0; }
.settings-card button {
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, .12);
  background: #fff;
  font: inherit;
  cursor: pointer;
}
.settings-card .primary { background: var(--accent); color: #fff; border: 0; margin-top: 16px; width: 100%; }
.settings-card .danger { background: #fde8df; color: #8a3b1c; border: 0; margin-top: 16px; width: 100%; }

.memory-list { display: flex; flex-direction: column; gap: 8px; }
.memory-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f7f2ea;
  font-size: 14px;
}
.memory-row span { flex: 1; }
.muted { color: var(--muted); font-size: 14px; }
```

- [x] **Step 3: 写 manifest.webmanifest**

```json
{
  "name": "Trae宝",
  "short_name": "Trae宝",
  "description": "住在手机桌面上的 Trae宝，陪你聊聊天。",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#F5F1E8",
  "theme_color": "#F5F1E8",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }
  ]
}
```

- [x] **Step 4: 提交**

```bash
git add index.html app.css manifest.webmanifest
git commit -m "feat: 添加应用外壳、样式与 PWA 清单"
```

---

### Task 14: 主流程装配

**Files:**
- Create: `src/main.js`

- [x] **Step 1: 实现 src/main.js**

```javascript
import { createStage } from './ui/stage.js';
import { createTimeline } from './ui/timeline.js';
import { createComposer } from './ui/composer.js';
import { createSettings } from './ui/settings.js';
import { createDefaultStore } from './memory/store.js';
import { buildContext } from './memory/retriever.js';
import { extractTags, stripMarkers } from './memory/extractor.js';
import { buildSystemPrompt } from './llm/prompt.js';
import { createDoubaoProvider } from './llm/doubao.js';
import { createWorkerProvider } from './llm/worker.js';

const store = await createDefaultStore();

const stage = createStage(document.getElementById('stage'));
const timeline = createTimeline(document.getElementById('timeline'));
const banner = document.getElementById('banner');
const settingsRoot = document.getElementById('settings');

// 复用最近一次会话，刷新 / 重开 App 都能看到上次的聊天
const existingSessions = await store.listSessions();
let session = existingSessions[0] || await store.createSession();
let busy = false;

function showBanner(text) {
  if (!text) { banner.hidden = true; return; }
  banner.textContent = text;
  banner.hidden = false;
}

const composer = createComposer(document.getElementById('composer'), { onSend: handleSend });

const settings = createSettings(settingsRoot, {
  store,
  onClose: () => { settingsRoot.hidden = true; },
  onModeChange: () => { /* 下次发消息时按最新配置重建 provider */ },
});

function openSettings() {
  settingsRoot.hidden = false;
  settings.load();
}

document.getElementById('openSettings').addEventListener('click', openSettings);

async function buildProvider() {
  const mode = (await store.getKV('mode')) || 'direct';
  if (mode === 'worker') {
    return createWorkerProvider({
      workerUrl: await store.getKV('workerUrl'),
      accessToken: await store.getKV('accessToken'),
      model: (await store.getKV('model')) || 'doubao-seed-1-6-250615',
    });
  }
  return createDoubaoProvider({
    endpoint: (await store.getKV('endpoint')) || undefined,
    apiKey: await store.getKV('apiKey'),
    model: (await store.getKV('model')) || undefined,
  });
}

const ERROR_HINTS = {
  network: '连不上模型。如果是跨域被拦，去设置里换成 Worker 代理。',
  interrupted: '断了，可以再发一次。',
  auth: 'API Key 不对，去设置面板改一下。',
  quota: '额度用完了，去控制台充值。',
  server: '模型服务出错了，稍后再试。',
  timeout: '请求超时了，再试一次。',
};

async function runStream(bubble, ctx) {
  const provider = await buildProvider();
  let raw = '';
  stage.startStreaming();
  try {
    for await (const delta of provider.stream({ system: ctx.system, messages: ctx.messages })) {
      raw += delta;
      timeline.appendText(bubble, stripMarkers(raw));
    }
  } finally {
    stage.stopStreaming();
  }
  return raw;
}

async function handleSend(text) {
  if (busy) return;
  const mode = (await store.getKV('mode')) || 'direct';
  if (mode !== 'worker' && !(await store.getKV('apiKey'))) {
    showBanner('还没填 API Key，点一下角色两次打开设置。');
    openSettings();
    return;
  }
  busy = true;
  composer.setDisabled(true);
  showBanner('');

  await store.addMessage({ sessionId: session.id, role: 'user', content: text });
  timeline.addBubble('user', text);

  const bubble = timeline.beginAssistant();
  const memories = await store.listMemories();
  const recent = await store.listMessages(session.id, 12);
  const ctx = buildContext({
    systemPrompt: buildSystemPrompt(),
    memories,
    messages: recent.map((m) => ({ role: m.role, content: m.content })),
  });
  await store.markUsed(ctx.usedMemoryIds);

  let raw = '';
  try {
    raw = await runStream(bubble, ctx);
    if (raw.trim() === '') {
      // 空回复：温和重试一次
      timeline.setBubbleText(bubble, '');
      raw = await runStream(bubble, ctx);
    }
  } catch (err) {
    const kind = err && err.kind ? err.kind : 'unknown';
    showBanner(ERROR_HINTS[kind] || '出了点问题，再试一次。');
    const partial = extractTags(raw).content.trim();
    timeline.setBubbleText(bubble, partial || '（这次没能说完）');
    busy = false;
    composer.setDisabled(false);
    return;
  }

  if (raw.trim() === '') {
    showBanner('模型这次没回话，再试一次。');
    timeline.setBubbleText(bubble, '（这次没能说完）');
    busy = false;
    composer.setDisabled(false);
    return;
  }

  const parsed = extractTags(raw);
  timeline.setBubbleText(bubble, parsed.content);
  if (parsed.emo) stage.setEmotion(parsed.emo);
  for (const mem of parsed.memories) {
    await store.addMemory(mem);
  }
  await store.addMessage({
    sessionId: session.id,
    role: 'assistant',
    content: parsed.content,
    emo: parsed.emo,
  });
  await store.updateSession(session.id, { title: session.title === '新对话' ? text.slice(0, 20) : session.title });

  busy = false;
  composer.setDisabled(false);
}

window.addEventListener('offline', () => showBanner('没网了，等你回来。'));
window.addEventListener('online', () => showBanner(''));

// 回放上一轮聊天
const pastMessages = await store.listMessages(session.id, 12);
timeline.renderHistory(pastMessages);

// 安装引导：Android Chrome 触发 beforeinstallprompt 时给出按钮
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'install-btn';
  btn.textContent = '添加到桌面';
  btn.addEventListener('click', async () => {
    btn.remove();
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });
  document.getElementById('banner').before(btn);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 本地 file:// 打开时会失败，忽略 */ });
  });
}
```

- [x] **Step 2: 提交**

```bash
git add src/main.js
git commit -m "feat: 装配主流程"
```

---

### Task 15: Service Worker 离线壳

**Files:**
- Create: `sw.js`

- [x] **Step 1: 实现 sw.js**

```javascript
const CACHE = 'traebao-v1';

const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './src/main.js',
  './src/mood.js',
  './src/memory/extractor.js',
  './src/memory/backends.js',
  './src/memory/store.js',
  './src/memory/retriever.js',
  './src/llm/prompt.js',
  './src/llm/sse.js',
  './src/llm/provider.js',
  './src/llm/doubao.js',
  './src/llm/worker.js',
  './src/ui/stage.js',
  './src/ui/timeline.js',
  './src/ui/composer.js',
  './src/ui/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/assets/sprite/01-有灵感.png',
  './src/assets/sprite/01-有灵感.gif',
  './src/assets/sprite/02-拆开看.png',
  './src/assets/sprite/02-拆开看.gif',
  './src/assets/sprite/03-换个角度.png',
  './src/assets/sprite/03-换个角度.gif',
  './src/assets/sprite/04-再来一版.png',
  './src/assets/sprite/04-再来一版.gif',
  './src/assets/sprite/05-这版够野.png',
  './src/assets/sprite/05-这版够野.gif',
  './src/assets/sprite/06-对齐一下.png',
  './src/assets/sprite/06-对齐一下.gif',
  './src/assets/sprite/07-甲方说好.png',
  './src/assets/sprite/07-甲方说好.gif',
  './src/assets/sprite/08-定稿吧.png',
  './src/assets/sprite/08-定稿吧.gif',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.hostname.endsWith('volces.com')) return;

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy));
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
```

- [x] **Step 2: 提交**

```bash
git add sw.js
git commit -m "feat: 添加离线壳 Service Worker"
```

---

### Task 16: 端到端联调与本地验收

**Files:**
- Create: `tools/mock_server.py`
- Create: `README.md`

- [x] **Step 1: 写本地 mock 模型服务器**

`tools/mock_server.py`：

```python
import json
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BODY = "今天有点累吧？\n\n[[emo:warm]]\n[[mem:用户最近常加班到很晚]]"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        chunks = re.findall(r"[\u4e00-\u9fff，。！？~\[\]]+", BODY)
        for chunk in chunks:
            for ch in chunk:
                payload = {"choices": [{"delta": {"content": ch}}]}
                self.wfile.write(f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode())
                self.wfile.flush()
                time.sleep(0.03)
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8899), Handler).serve_forever()
```

- [x] **Step 2: 启动静态服务与 mock 服务器**

Run（后台）: `cd /workspace/traebao-pwa && python3 -m http.server 8080`
Run（后台）: `cd /workspace/traebao-pwa && python3 tools/mock_server.py`

- [x] **Step 3: 用浏览器验证**

用 browser 打开 `http://localhost:8080/index.html`，依次验证：

1. 页面渲染出舞台区角色与输入框
2. 点右上角「设置」，面板能打开；填入接口地址 `http://127.0.0.1:8899/chat`、API Key `test`、模型名 `m1`，保存
3. 发一条消息，看到气泡逐字出现
4. 结束后角色表情切换到「08-定稿吧」
5. 打开设置面板，记忆列表里出现「用户最近常加班到很晚」
6. 刷新页面，重开设置，记忆仍在；聊天气泡也能回放

- [x] **Step 4: 写 README.md**

内容包含：项目用途、目录结构、本地开发（`npm test` / `python3 -m http.server 8080`）、部署方式（GitHub Pages / Cloudflare Pages）、模型配置说明、Worker 代理部署步骤、已知限制（Android 优先、微信内置浏览器不可安装、方舟直连可能受 CORS 限制）。

- [x] **Step 5: 提交**

```bash
git add tools/mock_server.py README.md
git commit -m "test: 添加本地 mock 服务器与使用说明"
```

---

### Task 17: 部署与交付

- [x] **Step 1: 确认全部测试通过**

Run: `cd /workspace/traebao-pwa && npm test`
Expected: PASS — 48 个用例全部通过

- [x] **Step 2: 打包交付物**

Run: `cd /workspace && zip -qr traebao-pwa.zip traebao-pwa -x "traebao-pwa/.git/*"`
Expected: 生成 `/workspace/traebao-pwa.zip`

- [x] **Step 3: 最终提交**

```bash
cd /workspace/traebao-pwa && git add -A && git commit -m "chore: 交付 Trae宝 PWA v1"
```

---

## 验收标准汇总

- `npm test` 全绿
- Android Chrome 添加到主屏幕后，全屏无地址栏，断网可打开
- 设置面板可配置方舟直连 / Worker 代理，Key 只存本机
- 对话流式出字，情绪标签驱动立绘切换，点击舞台可手动切表情并锁定 30 秒
- 模型输出的记忆条目自动入库，下次打开仍在；可在设置面板删除或置顶
- 不可达 / 401 / 429 / 超时分别给出明确中文提示，不白屏
