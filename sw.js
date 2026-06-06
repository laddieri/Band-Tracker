const CACHE = 'band-tracker-v2';

const PRECACHE = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/firebase-config.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
];

// Precache everything on install, activate immediately
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

// Delete old caches on activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Let Firebase Auth/Firestore API calls go straight to the network
  if (url.hostname.endsWith('googleapis.com') ||
      url.hostname.endsWith('firebaseio.com') ||
      url.hostname.endsWith('firebaseapp.com')) {
    return;
  }

  // Firebase CDN scripts are versioned — cache forever once fetched
  if (url.hostname === 'www.gstatic.com') {
    e.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(res => {
        caches.open(CACHE).then(c => c.put(request, res.clone()));
        return res;
      }))
    );
    return;
  }

  // App files — network-first: always get the latest deployed code when online,
  // fall back to cache only when offline. (Stale-while-revalidate served old
  // code after every deploy, so fixes appeared to "not work" until a 2nd load.)
  if (request.method === 'GET') {
    e.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
  }
});
