/* Estate Insight Service Worker（打包時由 vite.config.js 產生 dist/sw.js）
 * - 預先快取所有網站檔案，離線也能開啟（房屋資料本來就存在手機的 IndexedDB）。
 * - 頁面：網路優先（有網路時一定拿到最新版），離線時用快取。
 * - 其他檔案：快取優先；檔名含雜湊，新版會是新檔名。
 * - 只快取網站本身與 Google Fonts，不碰任何房屋資料。
 */
const VERSION = '__CACHE_VERSION__';
const CACHE = `estate-insight-${VERSION}`;
const FONT_CACHE = 'estate-insight-fonts';
const PRECACHE = __PRECACHE_LIST__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new URL(p, self.registration.scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('estate-insight-') && k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(new URL('index.html', self.registration.scope).href, res.clone());
    return res;
  } catch {
    return (await cache.match(new URL('index.html', self.registration.scope).href))
      || (await cache.match(self.registration.scope))
      || new Response('<h1>目前離線，且尚未快取網站</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((res) => { if (res.ok || res.type === 'opaque') cache.put(request, res.clone()); return res; }).catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(request.mode === 'navigate' ? networkFirstPage(request) : cacheFirst(request));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request));
  }
});
