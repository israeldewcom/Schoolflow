/* SchoolFlow service worker
 * - App shell precache (works offline from the 2nd visit onward)
 * - CDN assets (Bootstrap, icons, fonts, Chart.js): stale-while-revalidate
 * - API GET requests: network-first, fall back to last saved copy (max 7 days)
 * - Navigations: network-first with offline fallback
 * Bump VERSION on every release so users get the update prompt.
 */
const VERSION = 'v1.0.0';
const SHELL = 'sf-shell-' + VERSION;
const STATIC = 'sf-static-' + VERSION;
const API = 'sf-api-' + VERSION;
const ALL = [SHELL, STATIC, API];

const SHELL_URLS = [
  './', './index.html', './offline.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
const CDN_PRECACHE = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap'
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const API_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const API_TIMEOUT_MS = 8000;
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await Promise.allSettled(SHELL_URLS.map((u) => shell.add(new Request(u, { cache: 'reload' }))));
    const st = await caches.open(STATIC);
    await Promise.allSettled(CDN_PRECACHE.map((u) => st.add(u)));
    // No skipWaiting here: the page shows "Update available" and asks first.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('sf-') && !ALL.includes(k)).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (_) {} }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  else if (d.type === 'CLEAR_API_CACHE') event.waitUntil(caches.delete(API));
  else if (d.type === 'CACHE_URLS' && Array.isArray(d.urls)) {
    event.waitUntil((async () => {
      const st = await caches.open(STATIC);
      await Promise.allSettled(d.urls.filter((u) => {
        try { return CDN_HOSTS.includes(new URL(u).hostname); } catch (_) { return false; }
      }).map(async (u) => { if (!(await st.match(u))) await st.add(u); }));
    })());
  }
});

const withTimeout = (p, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms);
  p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});

async function navigationHandler(event) {
  try {
    const preload = event.preloadResponse ? await event.preloadResponse : null;
    const resp = preload || await withTimeout(fetch(event.request), NAV_TIMEOUT_MS);
    if (resp && resp.ok) {
      const c = await caches.open(SHELL);
      c.put('./index.html', resp.clone()).catch(() => {});
    }
    return resp;
  } catch (_) {
    const c = await caches.open(SHELL);
    return (await c.match('./index.html')) || (await c.match('./')) || (await c.match('./offline.html')) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const c = await caches.open(STATIC);
  const cached = await c.match(request);
  const net = fetch(request).then((r) => { if (r && (r.ok || r.type === 'opaque')) c.put(request, r.clone()).catch(() => {}); return r; }).catch(() => null);
  return cached || (await net) || Response.error();
}

async function apiHandler(request) {
  const c = await caches.open(API);
  try {
    const resp = await withTimeout(fetch(request), API_TIMEOUT_MS);
    if (resp && resp.status === 200) {
      const headers = new Headers(resp.headers);
      headers.set('X-SW-Cached-At', String(Date.now()));
      const body = await resp.clone().blob();
      c.put(request.url, new Response(body, { status: 200, statusText: 'OK', headers })).catch(() => {});
    }
    return resp;
  } catch (err) {
    const hit = await c.match(request.url);
    if (hit) {
      const at = Number(hit.headers.get('X-SW-Cached-At') || 0);
      if (!at || Date.now() - at < API_MAX_AGE_MS) {
        const headers = new Headers(hit.headers);
        headers.set('X-SW-From-Cache', '1');
        return new Response(await hit.blob(), { status: 200, statusText: 'OK', headers });
      }
    }
    return new Response(JSON.stringify({ success: false, offline: true, message: 'You are offline and this data has not been saved yet.' }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'X-SW-Offline': '1' } });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate' && url.origin === location.origin) {
    event.respondWith(navigationHandler(event));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (url.pathname.includes('/api/v1/')) {
    if (url.pathname.includes('/auth/')) return;          // never cache auth
    event.respondWith(apiHandler(req));
    return;
  }
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const c = await caches.open(SHELL);
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r && r.ok) c.put(req, r.clone()).catch(() => {}); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
  }
});
