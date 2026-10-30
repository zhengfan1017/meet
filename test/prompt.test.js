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
