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
