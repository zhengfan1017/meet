import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (extname(p) === '.js') out.push(p);
  }
  return out;
}

const jsFiles = walk(SRC).map((p) => ({ path: p, code: readFileSync(p, 'utf8') }));
const css = readFileSync(new URL('../app.css', import.meta.url).pathname, 'utf8');

// 小米浏览器有大量 MIUI 12 时代的存量设备（Chromium 71~87）。
// 下面这些特性在对应版本才支持，用了会整块抛错甚至白屏：
const BANNED = [
  { token: '?.', since: 'Chrome 80 可选链' },
  { token: '??', since: 'Chrome 80 空值合并' },
  { token: '.matchAll(', since: 'Chrome 73 matchAll' },
  { token: '.replaceAll(', since: 'Chrome 85 replaceAll' },
  { token: '.flatMap(', since: 'Chrome 69 flatMap' },
  { token: 'Object.fromEntries(', since: 'Chrome 73 fromEntries' },
  { token: '.at(', since: 'Chrome 92 Array.at' },
  { token: 'crypto.randomUUID(', since: 'Chrome 92 randomUUID' },
];

test('src/ 不使用老版本 Chromium 不支持的语法', () => {
  const problems = [];
  for (const { path, code } of jsFiles) {
    for (const { token, since } of BANNED) {
      if (code.includes(token)) problems.push(`${path} 用了 ${token}（${since}）`);
    }
    // 顶层 await：Chrome 89 才有，且会让整个模块解析失败
    for (const line of code.split('\n')) {
      if (/^(const|let|var)\s.*=\s*await\s/.test(line)) {
        problems.push(`${path} 用了顶层 await（Chrome 89+）`);
      }
      if (/^await\s/.test(line)) {
        problems.push(`${path} 用了顶层 await（Chrome 89+）`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('structuredClone 必须有降级兜底', () => {
  const file = jsFiles.find((f) => f.path.endsWith('backends.js'));
  assert.ok(file, '找不到 backends.js');
  assert.match(file.code, /typeof structuredClone === 'function'/);
  assert.match(file.code, /JSON\.parse\(JSON\.stringify\(/);
});

test('app.css 的 dvh 有 vh 兜底', () => {
  const dvhLines = css.split('\n').filter((l) => l.includes('dvh'));
  assert.ok(dvhLines.length > 0, '预期有 dvh 用法');
  for (const line of dvhLines) {
    assert.match(line, /^\s*[\w-]+:\s*[\d.]+dvh/);
  }
  // 每处 dvh 声明前一行都应是同属性的 vh 声明
  const lines = css.split('\n');
  lines.forEach((line, i) => {
    if (!line.includes('dvh')) return;
    const prop = line.split(':')[0].trim();
    const prev = lines[i - 1] || '';
    assert.ok(prev.includes(`${prop}:`) && prev.includes('vh'), `${prop} 的 dvh 缺少 vh 兜底`);
  });
});

test('app.css 不用 flex gap（Chrome 84+）', () => {
  const gapLines = css.split('\n').filter((l) => /^\s*gap:/.test(l));
  assert.deepEqual(gapLines, [], `仍有 gap 用法:\n${gapLines.join('\n')}`);
});
