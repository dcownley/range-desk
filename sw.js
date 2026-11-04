/* Range Desk offline support (service worker).
   - The app pages: network first, so updates arrive when online; the saved copy is used with no signal.
   - Libraries and fonts from the CDNs: saved copy first.
   - Map tiles: saved copy first; tiles seen while online, or saved with "Save this range for offline", work with no signal.
   - Weather, relay and other live data: always from the network (the app keeps its own last good copy). */
const APP_CACHE = 'rd-app-v2';
const LIB_CACHE = 'rd-lib-v1';
const TILE_CACHE = 'rd-tiles-v1';
const APP_FILES = ['./', './index.html', './backup.html', './bt-explorer.html', './Range-Desk-user-manual.pdf', './Range-Desk-daily-inputs.pdf'];
const LIB_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const TILE_HOSTS = ['server.arcgisonline.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => Promise.all(APP_FILES.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  const keep = [APP_CACHE, LIB_CACHE, TILE_CACHE];
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('rd-') && !keep.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const c = await caches.open(APP_CACHE);
  try {
    const r = await fetch(req);
    if (r && r.ok) c.put(req, r.clone());
    return r;
  } catch (e) {
    const hit = await c.match(req, { ignoreSearch: true }) || await c.match('./index.html');
    if (hit) return hit;
    throw e;
  }
}
async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req.url);
  if (hit) return hit;
  const r = await fetch(req);
  if (r && (r.ok || r.type === 'opaque')) c.put(req.url, r.clone());
  return r;
}
// Tiles: fetched with CORS where the server allows it, so the browser stores their real size
// (an opaque copy is counted as several MB against the storage allowance). Oldest tiles are trimmed past 6000.
let puts = 0;
async function tileFirst(req) {
  const c = await caches.open(TILE_CACHE);
  const hit = await c.match(req.url);
  if (hit) return hit;
  let r;
  try { r = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); } catch (e) { r = null; }
  if (!r || !r.ok) r = await fetch(req);
  if (r && (r.ok || r.type === 'opaque')) {
    await c.put(req.url, r.clone());
    if (++puts % 100 === 0) { const ks = await c.keys(); for (let i = 0; i < ks.length - 6000; i++) await c.delete(ks[i]); }
  }
  return r;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) {
    if (req.mode === 'navigate' || /\.(html|js|pdf)$/.test(u.pathname) || u.pathname.endsWith('/')) e.respondWith(networkFirst(req));
    return;
  }
  if (LIB_HOSTS.includes(u.hostname)) { e.respondWith(cacheFirst(req, LIB_CACHE)); return; }
  if (TILE_HOSTS.includes(u.hostname) && u.pathname.includes('/tile/')) { e.respondWith(tileFirst(req).catch(() => new Response('', { status: 504 }))); return; }
  // everything else (weather, relay, Windy) goes straight to the network
});
