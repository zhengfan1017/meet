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

test('localStorage 后端只保留最近 20 条消息', async () => {
  const be = createLocalStorageBackend(fakeStorage());
  await be.init();
  for (let i = 0; i < 30; i += 1) {
    await be.put('messages', { id: `m${i}`, content: `x${i}` });
  }
  const all = await be.all('messages');
  assert.equal(all.length, 20);
  assert.equal(all[all.length - 1].id, 'm29');
});
