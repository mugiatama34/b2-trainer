/* B2 Prüfungstrainer service worker.
   VERSION must match version.json and APP_VERSION in app.js (see CLAUDE.md). */
const VERSION = '1.4.0';
const CACHE = 'b2trainer-v' + VERSION;
const LEGACY_CACHE = 'b2trainer-v1'; // pre-banner release that cannot show the update banner
const DATA_URL = './b2-data.json';
const APP_FILES = [
  './',
  './index.html',
  './app.js',
  './prompts.js',
  './style.css',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  DATA_URL
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_FILES.map(u => new Request(u, { cache: 'reload' }))))
      // A new version waits until the page sends SKIP_WAITING (update banner).
      // Exception: clients still on the legacy release have no banner, so take over directly.
      .then(() => caches.has(LEGACY_CACHE))
      .then(legacy => { if (legacy) return self.skipWaiting(); })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Only remove this app's old caches; other apps on the same origin keep theirs.
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('b2trainer-') && k !== CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isVersion(url) {
  return url.pathname.endsWith('/version.json');
}

function isData(url) {
  return url.pathname.endsWith('/b2-data.json');
}

// JSON: network-first so content updates arrive immediately; cached copy offline.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request, { cache: 'no-store' });
    if (res && res.ok) await cache.put(DATA_URL, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(DATA_URL);
    if (cached) return cached;
    throw e;
  }
}

// App shell: cache-first, fill cache on miss.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') await cache.put(request, res.clone());
    return res;
  } catch (e) {
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw e;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (isVersion(url)) return; // never cached: always straight from the network
  event.respondWith(isData(url) ? networkFirst(req) : cacheFirst(req));
});
