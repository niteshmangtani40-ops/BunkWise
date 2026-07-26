/**
 * service-worker.js — Smart Attendance Manager PWA Service Worker
 *
 * Strategy:
 *   - App shell (HTML/CSS/JS): Cache-first with network fallback
 *   - CDN assets (Chart.js, FA, Fonts): Cache-first, very long TTL
 *   - Dynamic pages: Stale-while-revalidate
 *
 * Cache names are versioned so old caches are cleaned on activation.
 */

const CACHE_VERSION = 'v1.0.1';
const SHELL_CACHE   = `sam-shell-${CACHE_VERSION}`;
const CDN_CACHE     = `sam-cdn-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `sam-dynamic-${CACHE_VERSION}`;

/* ── App Shell — files to pre-cache ─────────────────────────── */
const SHELL_FILES = [
  './index.html',
  './dashboard.html',
  './subjects.html',
  './timetable.html',
  './attendance.html',
  './history.html',
  './calendar.html',
  './reports.html',
  './calculator.html',
  './profile.html',
  './settings.html',
  './about.html',
  './offline.html',
  './404.html',
  './manifest.json',

  // CSS
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/layout.css',
  './css/animations.css',
  './css/wizard.css',
  './css/dashboard.css',
  './css/subjects.css',
  './css/timetable.css',
  './css/attendance.css',
  './css/history.css',
  './css/calendar.css',
  './css/reports.css',
  './css/calculator.css',
  './css/profile.css',
  './css/settings.css',
  './css/calendar.css',
  './css/profile.css',
  './css/about.css',

  // JS Core
  './js/app.js',
  './js/db.js',
  './js/store.js',
  './js/utils.js',
  './js/pwa.js',
  './js/notifications.js',

  // JS Pages
  './js/pages/wizard.js',
  './js/pages/dashboard.js',
  './js/pages/subjects.js',
  './js/pages/timetable.js',
  './js/pages/attendance.js',
  './js/pages/history.js',
  './js/pages/calendar.js',
  './js/pages/reports.js',
  './js/pages/calculator.js',
  './js/pages/profile.js',
  './js/pages/settings.js',
  './js/pages/about.js',

  // JS Features
  './js/features/charts.js',
  './js/features/backup.js',
  './js/features/achievements.js',
  './js/features/search.js',
  './js/features/import.js',
  './js/features/pdfparse.js',
  './js/features/ocr.js',
  './js/features/parser.js',

  // Icons
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

/* ── CDN URLs to cache ───────────────────────────────────────── */
const CDN_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
];

/* ─────────────────────────────────────────────────────────────
   INSTALL — Pre-cache app shell
   ───────────────────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      console.log('[SW] Pre-caching app shell');
      // Cache all shell files; don't fail install if some are missing
      return Promise.allSettled(
        SHELL_FILES.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] Failed to cache: ${url}`, err)
          )
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ─────────────────────────────────────────────────────────────
   ACTIVATE — Clean old caches
   ───────────────────────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  const activeCaches = [SHELL_CACHE, CDN_CACHE, DYNAMIC_CACHE];

  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(key => !activeCaches.includes(key))
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ─────────────────────────────────────────────────────────────
   FETCH — Route requests to appropriate strategy
   ───────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // CDN resources: Cache-first, long TTL
  if (isCDNRequest(url)) {
    event.respondWith(cacheFirstStrategy(request, CDN_CACHE));
    return;
  }

  // Navigation requests: Network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(request));
    return;
  }

  // App shell assets: Cache-first
  if (isShellAsset(url)) {
    event.respondWith(cacheFirstStrategy(request, SHELL_CACHE));
    return;
  }

  // Everything else: Stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

/* ─────────────────────────────────────────────────────────────
   STRATEGIES
   ───────────────────────────────────────────────────────────── */

/** Cache-first: serve from cache, fallback to network and update cache */
async function cacheFirstStrategy(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

/** Network-first navigation with offline fallback */
async function navigationStrategy(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Try cache
    const cached = await caches.match(request);
    if (cached) return cached;

    // Serve offline page as fallback for navigation requests
    const fallback = await caches.match('./offline.html') || await caches.match('./index.html');
    return fallback || new Response('<h1>Offline</h1>', {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

/** Stale-while-revalidate */
async function staleWhileRevalidate(request) {
  const cached   = await caches.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200) {
      caches.open(DYNAMIC_CACHE).then(cache => cache.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);

  return cached || await fetchPromise || new Response('Offline', { status: 503 });
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────── */

function isCDNRequest(url) {
  const cdnHosts = [
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net',
  ];
  return cdnHosts.some(host => url.hostname.includes(host));
}

function isShellAsset(url) {
  return url.pathname.match(/\.(html|css|js|json|png|svg|ico|webp)$/);
}

/* ─────────────────────────────────────────────────────────────
   PUSH NOTIFICATIONS
   ───────────────────────────────────────────────────────────── */

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'BunkWise', {
      body:    data.body   || 'Time to mark your attendance!',
      icon:    './assets/icons/icon-192.png',
      badge:   './assets/icons/icon-72.png',
      tag:     data.tag    || 'attendance',
      data:    data.url    || './attendance.html',
      vibrate: [200, 100, 200],
      actions: [
        { action: 'mark', title: '✅ Mark Now' },
        { action: 'later', title: '⏰ Remind Later' }
      ]
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'mark' || !event.action) {
    event.waitUntil(
      clients.openWindow(event.notification.data || './attendance.html')
    );
  }
});

/* ─────────────────────────────────────────────────────────────
   SYNC — Background sync for offline actions
   ───────────────────────────────────────────────────────────── */

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-attendance') {
    event.waitUntil(syncAttendance());
  }
});

async function syncAttendance() {
  // Placeholder for future background sync implementation
  console.log('[SW] Background sync: attendance');
}

/* ─────────────────────────────────────────────────────────────
   MESSAGE — Handle messages from app
   ───────────────────────────────────────────────────────────── */

self.addEventListener('message', (event) => {
  if (event.data?.action === 'skipWaiting') {
    self.skipWaiting();
  }

  if (event.data?.action === 'clearCache') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
      event.source?.postMessage({ action: 'cacheCleared' });
    });
  }

  if (event.data?.action === 'updateCaches') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    );
  }
});
