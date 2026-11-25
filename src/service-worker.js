const prefix = 'dayline-shell-';
const version = '__BUILD_VERSION__';
const cacheName = prefix + version;
const assets = __PRECACHE_FILES__;
const precached = new Set(assets.map((path) => new URL(path, self.registration.scope).href));
const voiceModel = new URL('./voice/model.js', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(assets.map((path) => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(prefix) && key !== cacheName).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && precached.has(`${url.origin}${url.pathname}`)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      try {
        return await fetch(request);
      } catch {
        return (await cache.match(new URL('./index.html', self.registration.scope))) ?? Response.error();
      }
    })());
  } else if (request.url === voiceModel) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const saved = await cache.match(request, { ignoreVary: true });
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone()).catch(() => {});
      return response;
    })());
  } else if (precached.has(request.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      // Module and stylesheet requests can vary by Origin. The app shell is identical for every request.
      return (await cache.match(request, { ignoreVary: true })) ?? fetch(request);
    })());
  }
});
