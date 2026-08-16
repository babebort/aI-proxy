/** Minimal SW — API always live; UI shell never cache-first (stale app.js broke OAuth). */
const CACHE = 'ai-proxy-v3';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['/icon.svg', '/manifest.webmanifest'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  const networkFirst =
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname === '/app.js' ||
    url.pathname === '/styles.css' ||
    url.pathname === '/sw.js';

  if (networkFirst) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});
