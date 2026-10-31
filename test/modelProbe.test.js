import test from 'node:test';
import assert from 'node:assert/strict';

import { findWorkingModel, MODEL_CANDIDATES } from '../src/llm/modelProbe.js';

function fakeFetch(behaviour) {
  const calls = [];
  const impl = async (url, init) => {
    const model = JSON.parse(init.body).model;
    calls.push(model);
    return behaviour(model);
  };
  impl.calls = calls;
  return impl;
}

const ok = () => ({ ok: true, status: 200 });

test('当前模型名可用时直接返回它', async () => {
  const fetchImpl = fakeFetch(() => ok());
  const found = await findWorkingModel({
    endpoint: 'https://x/api/v3/chat/completions',
    apiKey: 'k',
    model: 'doubao-seed-2-1-pro-260915',
    candidates: ['other'],
    fetchImpl,
  });
  assert.equal(found, 'doubao-seed-2-1-pro-260915');
  assert.deepEqual(fetchImpl.calls, ['doubao-seed-2-1-pro-260915']);
});

test('模型名写错（404）时自动试下一个候选', async () => {
  // 这正是用户踩的坑：控制台显示名 Doubao-Seed-2-1-pro 填进去必然 404
  const fetchImpl = fakeFetch((model) => (
    model === 'doubao-seed-2-1-pro-260915'
      ? { ok: true, status: 200 }
      : { ok: false, status: 404 }
  ));
  const found = await findWorkingModel({
    endpoint: 'https://x/api/v3/chat/completions',
    apiKey: 'k',
    model: 'Doubao-Seed-2-1-pro',
    candidates: ['doubao-seed-2-1-pro-260915'],
    fetchImpl,
  });
  assert.equal(found, 'doubao-seed-2-1-pro-260915');
  assert.deepEqual(fetchImpl.calls, ['Doubao-Seed-2-1-pro', 'doubao-seed-2-1-pro-260915']);
});

test('401 / 403 / 429 / 5xx 时立即停止（换模型也解决不了）', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const fetchImpl = fakeFetch(() => ({ ok: false, status }));
    const found = await findWorkingModel({
      endpoint: 'https://x/api/v3/chat/completions',
      apiKey: 'k',
      model: 'wrong',
      candidates: ['a', 'b', 'c'],
      fetchImpl,
    });
    assert.equal(found, null, `status ${status} 应该直接放弃`);
    assert.equal(fetchImpl.calls.length, 1, `status ${status} 时不该继续试候选`);
  }
});

test('网络异常时返回 null，不抛错', async () => {
  const fetchImpl = async () => { throw new Error('network down'); };
  const found = await findWorkingModel({
    endpoint: 'https://x/api/v3/chat/completions',
    apiKey: 'k',
    model: 'wrong',
    candidates: ['a'],
    fetchImpl,
  });
  assert.equal(found, null);
});

test('没有 API Key 或接口地址时不发请求', async () => {
  const fetchImpl = fakeFetch(() => ok());
  assert.equal(await findWorkingModel({ apiKey: '', model: 'x', fetchImpl }), null);
  assert.equal(await findWorkingModel({ endpoint: '', apiKey: 'k', model: 'x', fetchImpl }), null);
  assert.equal(fetchImpl.calls.length, 0);
});

test('候选表里都是带日期后缀的真实方舟模型 ID', () => {
  assert.ok(MODEL_CANDIDATES.length > 0);
  for (const id of MODEL_CANDIDATES) {
    assert.match(id, /^doubao-seed-\d+-\d+-(pro|turbo|lite|mini)-\d{6}$/, `${id} 不像方舟的模型 ID`);
  }
});
