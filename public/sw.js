const CACHE = 'linote-shell-v1.6';
const CORE = ['/', '/app.js', '/styles.css', '/overrides.css', '/features.css', '/icon.png', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const page = await fetch('/', {cache:'reload',headers:{Accept:'text/html'}});
    if (page.ok) {
      await cache.put('/', page.clone());
      const html = await page.text();
      const assets = [...html.matchAll(/(?:src|href)="(\/[^"?#]+(?:\?[^"#]*)?)"/g)]
        .map(match => match[1]).filter(path => !path.startsWith('/api/') && !path.endsWith('.apk'));
      await Promise.allSettled([...new Set([...CORE.slice(1), ...assets])].map(async path => {
        const response = await fetch(path);
        if (response.ok) await cache.put(path, response);
      }));
    }
    await self.skipWaiting();
  })().catch(() => self.skipWaiting()));
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
        if (response.ok) (await caches.open(CACHE)).put('/',response.clone());
        return response;
      } catch {
        return await caches.match('/') || new Response('离线页面尚未缓存，请联网打开一次 linote。',{headers:{'Content-Type':'text/plain; charset=utf-8'},status:503});
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
