const CACHE_VERSION = 'v0.3-proto-1';
const CACHE_NAME = `md-tracker-${CACHE_VERSION}`;
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './src/app.js',
  './src/db.js',
  './src/ui.js',
  './src/stats.js'
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
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // no external fetch
  event.respondWith((async ()=>{
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const resp = await fetch(event.request);
      if (resp && resp.ok && event.request.method==='GET') cache.put(event.request, resp.clone());
      return resp;
    } catch(_e){
      // offline fallback: index.html for navigations
      if (event.request.mode==='navigate') return cache.match('./index.html');
      throw _e;
    }
  })());
});
