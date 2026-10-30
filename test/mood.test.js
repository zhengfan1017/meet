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
