// Cache-first app shell so the reader works offline once visited.
const CACHE = 'phonereadr-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'reflow.js', 'parsers.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png',
  'vendor/jszip.min.js', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // network first so updates arrive when online, cache as the offline fallback
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
