const CACHE_VERSION = 'v0.3-proto-1';
const CACHE_NAME = `md-tracker-${CACHE_VERSION}`;
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './src/app.js',
  './src/db.js',
  './src/ui.js',
  './src/stats.js',
  './src/charts.js'
];

self.addEventListener('install', (event)=>{
  event.waitUntil((async ()=>{
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event)=>{
  event.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('md-tracker-') && k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

// Cache-first for same-origin requests
self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 外部は扱わない

  const pathname = url.pathname;
  const isCore = req.mode === 'navigate' || pathname.endsWith('/index.html') || pathname.endsWith('/styles.css') || pathname.includes('/src/') || pathname.endsWith('/sw.js');

  if (isCore) {
    // Network-first (常に最新を取りに行く)。失敗時のみキャッシュ。
    event.respondWith(networkThenCache(req));
  } else {
    // Cache-first (その他アセット)。なければ取得してキャッシュ。
    event.respondWith(cacheFirst(req));
  }
});

async function networkThenCache(request){
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(new Request(request, { cache: 'reload' }));
    if (fresh && fresh.ok) { cache.put(request, fresh.clone()); }
    return fresh;
  } catch(_e){
    const cached = await cache.match(request);
    if (cached) return cached;
    // navigation fallback
    if (request.mode === 'navigate') return cache.match('./index.html');
    throw _e;
  }
}

async function cacheFirst(request){
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  if (resp && resp.ok) cache.put(request, resp.clone());
  return resp;
}
