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
