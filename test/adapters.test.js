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
