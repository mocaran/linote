const CACHE = 'linote-shell-v1.23';
const CORE = ['/offline.html', '/app.js?v=1.23', '/styles.css?v=1.23', '/overrides.css?v=1.23', '/features.css?v=1.23'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map(async path => {
      const response = await fetch(path,{cache:'reload'});
      if (!response.ok) throw new Error('Offline asset missing: ' + path);
      await cache.put(path,response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('linote-shell-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.endsWith('.apk')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, {signal:AbortSignal.timeout(4000)});
        return response;
      } catch {
        return await caches.match('/offline.html') || new Response('离线页面尚未缓存，请联网打开一次 linote。',{headers:{'Content-Type':'text/plain; charset=utf-8'},status:503});
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      event.waitUntil(fetch(request).then(async response => { if (response.ok) await (await caches.open(CACHE)).put(request,response); }).catch(() => {}));
      return cached;
    }
    const response = await fetch(request);
    if (response.ok) event.waitUntil((await caches.open(CACHE)).put(request,response.clone()));
    return response;
  })());
});
