// The worker script is the deployment identity. The cache name stays stable
// so a release never needs a manually maintained per-release cache/version.
const CACHE_NAME = 'ava-crm-shell';
const CACHE_PREFIX = 'ava-crm-shell';
const APP_BASE_PATH = new URL('./', self.location.href).pathname;
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './admin-ui.js',
  './ava-entry.js',
  './crm-core.js',
  './styles.css',
  './design-system.css',
  './manifest.webmanifest',
  './package.json',
  './sw.js'
];

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
      const cache = await caches.open(CACHE_NAME);
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
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
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
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())));
      }
      return response;
    }).catch(() => Response.error()))
  );
});
