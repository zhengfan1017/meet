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
