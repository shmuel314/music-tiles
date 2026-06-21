// Service worker: caches the app shell so the player works fully offline.
// Songs/images live in IndexedDB (handled by the app), not here.
const CACHE = 'music-tiles-v30';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './db.js',
  './app.js',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first (stale-while-revalidate) for everything we control.
//
// This is critical for the Android Back recovery path: if a system Back ever
// relaunches the PWA at start_url, the document must paint INSTANTLY from cache.
// A network-first shell would wait on the network and leave the user stuck on
// the native cream/icon splash. Cache-first guarantees an immediate render, then
// refreshes the cache in the background so updates still arrive on later launches.
function updateCache(req, res) {
  if (res && res.status === 200 && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((cache) => cache.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Navigations (including a relaunch after Back): serve the cached shell
  // immediately so we never sit on the splash waiting for the network.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const network = fetch(req).then((res) => updateCache(req, res)).catch(() => null);
        return cached || network.then((res) => res || caches.match('./index.html'));
      })
    );
    return;
  }

  // Everything else: cache-first, revalidate in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => updateCache(req, res)).catch(() => null);
      return cached || network.then((res) => res || caches.match('./index.html'));
    })
  );
});
