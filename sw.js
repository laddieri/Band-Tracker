const CACHE = 'band-tracker-v97';
// Deploy stamp (epoch seconds), rewritten by .github/workflows/deploy.yml to
// match APP_BUILD in js/01-core.js. Its only job is to make every deploy change
// this file's bytes, which is what makes browsers install the new worker (and
// the page offer a reload). 0 = an unstamped local copy.
const BUILD = 0;

const PRECACHE = [
  '/',
  '/index.html',
  '/app.css',
  '/js/00-logic.js',
  '/js/01-core.js',
  '/js/02-data.js',
  '/js/03-router.js',
  '/js/04-render.js',
  '/js/05-auth-views.js',
  '/js/06-roster.js',
  '/js/07-songs-portal.js',
  '/js/08-stats.js',
  '/js/09-rehearsal.js',
  '/js/09b-attendance.js',
  '/js/10-modals-settings.js',
  '/js/12-drill.js',
  '/js/14-tasks.js',
  '/js/15-export.js',
  '/js/16-absences.js',
  '/js/17-spot-challenge.js',
  '/js/13-boot.js',
  '/firebase-config.js',
  '/manifest.json',
  '/icons/icon-32.png',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check-compat.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-compat.js',
];

// Precache everything on install, activate immediately. `cache: 'reload'`
// skips the browser's HTTP cache: GitHub Pages serves app files with
// max-age=600, so a plain addAll right after a deploy could precache the
// previous version's files.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })))));
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

  // Firebase CDN scripts are versioned — cache forever once fetched (only a
  // successful response: a cached error would stick until the next CACHE bump)
  if (url.hostname === 'www.gstatic.com') {
    e.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(request, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Any other cross-origin request (reCAPTCHA for App Check, images from other
  // sites…) isn't ours to cache: leave it to the browser.
  if (url.origin !== self.location.origin) return;

  // App files — network-first, bypassing the HTTP cache. `cache: 'no-store'`
  // is essential: GitHub Pages serves these with Cache-Control max-age=600, so
  // a plain fetch() would return a stale copy from the browser's HTTP cache for
  // ~10 min after a deploy (changes wouldn't show without clearing browser
  // data). We always pull fresh from the server when online, and fall back to
  // the SW cache only when offline.
  // Only successful responses are cached, so a 404 or a 5xx during a deploy
  // can't replace a good offline copy.
  if (request.method === 'GET') {
    e.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
  }
});
