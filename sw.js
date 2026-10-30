const CACHE = 'traebao-v1';

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
  './src/ui/stage.js',
  './src/ui/timeline.js',
  './src/ui/composer.js',
  './src/ui/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
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

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy));
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
