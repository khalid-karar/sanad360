// Sanad 360 service worker — v2 (safe rewrite)
//
// The previous scaffold worker cache-first'ed EVERY GET — including
// cross-origin Supabase auth/REST calls — and pre-cached SPA routes at
// install without revalidation. Result: stale auth responses served after
// sign-out and a bricked shell after every redeploy, in every browser that
// had ever visited. This version:
//
//   • NEVER touches cross-origin requests (Supabase, PDF service, fonts CDN)
//   • navigations: network-first, cached shell only as an OFFLINE fallback
//   • hashed build assets (/assets/*): cache-first (immutable by content hash)
//   • everything else same-origin: network-first
//   • bumped cache names + skipWaiting/claim so this worker immediately
//     replaces the broken v1 and the activate step deletes its caches
const CACHE = 'sanad360-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add('/'))   // offline shell fallback only
      .catch(() => null)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // CRITICAL: never intercept cross-origin (Supabase auth/REST/storage,
  // the PDF service, font CDNs). The browser handles them natively.
  if (url.origin !== self.location.origin) return;

  // Navigations: always prefer the network; cached shell only when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => null);
          }
          return res;
        })
        .catch(() => caches.match('/').then((r) => r ?? new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Hashed build assets are immutable — cache-first is safe.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => null);
            }
            return res;
          })
      )
    );
    return;
  }

  // Everything else same-origin: network-first, cache as offline fallback.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => null);
        }
        return res;
      })
      .catch(() => caches.match(request).then((r) => r ?? Response.error()))
  );
});
