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
