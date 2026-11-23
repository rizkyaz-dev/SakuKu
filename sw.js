/**
 * SakuKu Service Worker
 * Meng-cache seluruh aset antarmuka agar aplikasi dapat dibuka & digunakan 100% offline.
 */

const CACHE_NAME = 'sakuku-cache-v2';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './charts.js',
  './sync.js',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Jangan cache request API Google Apps Script (biarkan langsung ke jaringan)
  if (
    req.method !== 'GET' ||
    req.url.includes('script.google.com') ||
    req.url.includes('script.googleusercontent.com')
  ) {
    return;
  }

  // Strategi Stale-While-Revalidate untuk aset aplikasi
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const networkFetch = fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, responseClone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })
  );
});
