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
