// Trae宝 的 Service Worker
//
// 这一版解决的是「页面更新了但按钮点了没反应」这个坑。
//
// 坑的成因：之前 HTML 走「网络优先」、JS 走「缓存优先」。
// 升级后浏览器会拿到「新 HTML + 旧 JS」：页面上按钮出现了，
// 但事件监听是旧代码绑的，点了没反应，也没有网络请求。
//
// 现在改成「同一个策略管到底」，从根上杜绝版本混搭：
//   · 代码类资源（HTML / JS / CSS）→ 网络优先，缓存兜底
//   · 图片类资源 → 缓存优先，网络兜底
//   同一类资源要么都来自网络、要么都来自缓存，不会一半新一半旧。
//
// 顺带解决「用户手机上装的是旧版本、永远刷不到新版」：
//   · index.html 里有一段内联脚本，用带版本号的地址注册 sw.js
//     （sw.js?v=8）。地址变了浏览器就会当成新注册去装，
//     不管 HTML 里引用的 main.js 是不是旧的。
//   · index.html 在旧版 SW 下也是网络优先，所以这段内联脚本
//     每次拿到的都是最新的。

const CACHE = 'traebao-v8';

// 离线时要用到的全部文件
const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './src/main.js',
  './src/mood.js',
  './src/memory/extractor.js',
  './src/memory/backends.js',
  './src/memory/store.js',
  './src/memory/retriever.js',
  './src/llm/prompt.js',
  './src/llm/sse.js',
  './src/llm/provider.js',
  './src/llm/doubao.js',
  './src/llm/worker.js',
  './src/llm/modelProbe.js',
  './src/ui/stage.js',
  './src/ui/timeline.js',
  './src/ui/composer.js',
  './src/ui/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/trae-robot-green.png',
  './src/assets/sprite/01-有灵感.png',
  './src/assets/sprite/01-有灵感.gif',
  './src/assets/sprite/02-拆开看.png',
  './src/assets/sprite/02-拆开看.gif',
  './src/assets/sprite/03-换个角度.png',
  './src/assets/sprite/03-换个角度.gif',
  './src/assets/sprite/04-再来一版.png',
  './src/assets/sprite/04-再来一版.gif',
  './src/assets/sprite/05-这版够野.png',
  './src/assets/sprite/05-这版够野.gif',
  './src/assets/sprite/06-对齐一下.png',
  './src/assets/sprite/06-对齐一下.gif',
  './src/assets/sprite/07-甲方说好.png',
  './src/assets/sprite/07-甲方说好.gif',
  './src/assets/sprite/08-定稿吧.png',
  './src/assets/sprite/08-定稿吧.gif',
];

// 代码类资源：这些必须「网络优先」，保证页面和脚本永远是同一套
const CODE_EXT = /\.(?:html?|js|mjs|css|webmanifest|json)$/i;

function isCodeRequest(req, url) {
  if (req.mode === 'navigate') return true;
  if (url.pathname === '/' || url.pathname === '') return true;
  return CODE_EXT.test(url.pathname);
}

// 逐个缓存而不是 cache.addAll：
// addAll 里只要有一个文件 404，整个安装就失败，新版本永远推不下去。
// 逐个放，缺哪个只影响那一个资源，不至于让整个 App 卡在旧版本。
async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(SHELL.map(async (url) => {
    try {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (res && res.ok) await cache.put(url, res);
    } catch {
      // 单个资源失败不阻塞安装
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.hostname.endsWith('volces.com')) return;

  // ignoreVary：服务器会回 Vary: Accept-Encoding，
  // 而预缓存和实际请求的压缩头可能不一致，不忽略就会匹配不上。
  const cache = caches.open(CACHE);

  if (isCodeRequest(req, url)) {
    // 网络优先：拿到新版本就用新的，拿不到才用缓存（离线时）
    event.respondWith(
      cache.then((c) => fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          c.put(req, copy);
        }
        return res;
      }).catch(() => {
        // 离线：代码回落到缓存。页面导航统一回落到 index.html。
        const key = req.mode === 'navigate' ? './index.html' : req;
        return c.match(key, { ignoreVary: true }).then((hit) => hit || Response.error());
      })),
    );
    return;
  }

  // 图片类：缓存优先（不会变），没有再走网络
  event.respondWith(
    cache.then((c) => c.match(req, { ignoreVary: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          c.put(req, copy);
        }
        return res;
      }).catch(() => Response.error());
    })),
  );
});
