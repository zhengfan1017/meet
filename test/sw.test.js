import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url).pathname, 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url).pathname, 'utf8');

test('代码类资源网络优先、缓存兜底，不再出现版本混搭', () => {
  // 之前 HTML 走网络优先、JS 走缓存优先，升级后浏览器会拿到
  // 「新 HTML + 旧 JS」：页面上按钮出现了，但事件监听是旧代码绑的，点了没反应。
  // 现在同一类资源统一策略：代码类全部网络优先（拿不到才回落缓存）。
  assert.match(sw, /const CACHE = 'traebao-v\d+'/);
  assert.match(sw, /isCodeRequest/);

  // 代码类分支：先 fetch，catch 里才回落到缓存
  assert.match(sw, /fetch\(req\)\.then\(\(res\)/);
  assert.match(sw, /c\.match\(key, \{ ignoreVary: true \}\)/);

  // 不能再用全局 caches.match —— 那会命中任意历史版本的缓存
  assert.doesNotMatch(sw, /caches\.match\(/);
});

test('页面导航离线时回落到 index.html', () => {
  assert.match(sw, /req\.mode === 'navigate'\s*\?\s*'\.\/index\.html'\s*:\s*req/);
});

test('图片类资源缓存优先、网络兜底', () => {
  // 图片不会变，缓存优先能省流量；但没缓存时必须还能走网络
  assert.match(sw, /c\.match\(req, \{ ignoreVary: true \}\)/);
  const imgBranch = sw.slice(sw.indexOf('// 图片类'));
  assert.match(imgBranch, /fetch\(req\)/);
});

test('缓存版本号会随发布递增', () => {
  const m = sw.match(/const CACHE = 'traebao-v(\d+)'/);
  assert.ok(m, 'sw.js 里应有可识别的 CACHE 版本号');
  assert.ok(Number(m[1]) >= 9, 'CACHE 版本号应已升级到 v9 或更高');
});

test('旧版本缓存会在激活时被清掉', () => {
  assert.match(sw, /keys\.filter\(\(k\) => k !== CACHE\)\.map\(\(k\) => caches\.delete\(k\)\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
});

test('预缓存逐个放，单个资源缺失不会让整个安装失败', () => {
  // cache.addAll 里只要有一个 404，整个安装就失败，新版本永远推不下去
  assert.doesNotMatch(sw, /cache\.addAll\(/);
  assert.match(sw, /Promise\.all\(SHELL\.map\(/);
});

test('Service Worker 用版本化地址注册，旧手机也刷得到新版', () => {
  // 写死 sw.js 的话，手机里装过的旧版 SW 会一直占着同一个 URL，
  // 浏览器可能不重新拉。加 ?v=N 让地址变化，强制当成全新注册。
  const m = html.match(/serviceWorker\.register\('sw\.js\?v=(\d+)'/);
  assert.ok(m, 'index.html 里应有用 sw.js?v=N 的版本化注册');
  assert.ok(Number(m[1]) >= 9, '注册地址的版本号应与 SW 版本一致');

  // 注册脚本必须在 index.html 内联，不能放在 main.js 里
  // （main.js 会被旧版缓存挡住，注册代码就换不成了）
  assert.match(html, /<script>\s*\n\s*\/\/ 注册 Service Worker/);

  // main.js 里不应该再有注册代码
  const main = readFileSync(new URL('../src/main.js', import.meta.url).pathname, 'utf8');
  assert.doesNotMatch(main, /serviceWorker\.register/);
});

test('sw.js 的缓存版本号与注册地址的版本号必须一致', () => {
  // 两处版本号只要有一个忘了改，手机上就会拿到「新页面 + 旧缓存」。
  // 图片是缓存优先的，改了图标更必须升版本号，否则手机上还是旧图标。
  const cacheV = sw.match(/const CACHE = 'traebao-v(\d+)'/)[1];
  const regV = html.match(/serviceWorker\.register\('sw\.js\?v=(\d+)'/)[1];
  assert.equal(regV, cacheV, `注册地址是 v${regV}，但缓存是 v${cacheV}，两个版本号对不上`);
});
