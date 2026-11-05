// package.json is the canonical release source. The worker derives a
// deterministic cache identity from it so formal releases cannot retain the
// previous App Shell as the active cache.
const CACHE_PREFIX = 'ava-crm-shell-';
const LEGACY_CACHE_NAME = 'ava-crm-shell';
const FALLBACK_CACHE_NAME = 'ava-crm-shell-fallback';
let releaseCacheNamePromise;
const APP_BASE_PATH = new URL('./', self.location.href).pathname;
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './policy-extraction.js',
  './admin-ui.js',
  './ava-entry.js',
  './crm-core.js',
  './styles.css',
  './design-system.css',
  './manifest.webmanifest',
  './package.json',
  './sw.js'
];

async function getReleaseCacheName() {
  if (!releaseCacheNamePromise) {
    releaseCacheNamePromise = fetch('./package.json', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Release manifest request failed: ${response.status}`);
        return response.json();
      })
      .then((manifest) => {
        const version = String(manifest?.version || '').trim();
        if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version is invalid');
        return `${CACHE_PREFIX}${version}`;
      })
      .catch((error) => { releaseCacheNamePromise = undefined; throw error; });
  }
  return releaseCacheNamePromise;
}

async function openReleaseCache({ allowFallback = true } = {}) {
  try { return await caches.open(await getReleaseCacheName()); }
  catch (error) { if (!allowFallback) throw error; return caches.open(FALLBACK_CACHE_NAME); }
}

function isOwnedUrl(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(APP_BASE_PATH);
}

function isFreshShellRequest(request, url) {
  return request.mode === 'navigate' ||
    ['document', 'script', 'style'].includes(request.destination) ||
    ['package.json', 'manifest.webmanifest'].includes(url.pathname.slice(APP_BASE_PATH.length));
}

async function networkFirst(request, fallbackRequest = request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Shell request failed: ${response.status}`);
    if (response.ok && response.type === 'basic') {
      const cache = await openReleaseCache();
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(fallbackRequest);
    return cached || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error());
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    getReleaseCacheName()
      .then((cacheName) => caches.open(cacheName))
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    getReleaseCacheName()
      .then((currentCacheName) => caches.keys().then((names) => Promise.all(
        names
          .filter((name) => name === LEGACY_CACHE_NAME || (name.startsWith(CACHE_PREFIX) && name !== currentCacheName))
          .map((name) => caches.delete(name))
      )))
      // If the release manifest is temporarily unavailable, preserve old
      // caches so offline operation remains safe; the next startup retries.
      .catch(() => undefined)
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isOwnedUrl(url)) return;

  if (isFreshShellRequest(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        event.waitUntil(openReleaseCache().then((cache) => cache.put(request, response.clone())));
      }
      return response;
    }).catch(() => Response.error()))
  );
});
