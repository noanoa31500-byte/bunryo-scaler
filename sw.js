// 分量スケーラ — Service Worker
const CACHE = 'scaler-v14';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './js/fooddb.js',
  './js/data.js',
  './js/core.js',
  './js/app.js',
  './planner.html',
  './pantry.html',
];

// Install: cache all static assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for same-origin, network-first for fonts
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always fetch Google Fonts from network
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Cache-first for our own files
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
