import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const workerSource = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const registrationSource = fs.readFileSync(new URL('../app-shell.js', import.meta.url), 'utf8');

function loadWorker({ cacheNames = [], fetchImpl = async () => { throw new Error('offline'); } } = {}) {
  const listeners = {};
  const deleted = [];
  const cache = { addAll: async () => undefined, put: async () => undefined };
  const context = {
    URL,
    Response,
    Promise,
    fetch: fetchImpl,
    caches: {
      open: async () => cache,
      keys: async () => cacheNames,
      delete: async (name) => { deleted.push(name); return true; },
      match: async () => undefined
    },
    self: {
      location: { origin: 'https://example.test', href: 'https://example.test/CRM/sw.js' },
      clients: { claim: async () => undefined },
      skipWaiting: async () => undefined,
      addEventListener: (type, listener) => { listeners[type] = listener; }
    }
  };
  vm.runInNewContext(workerSource, context);
  return { listeners, deleted };
}

test('service worker owns only CRM resources and cleans only CRM shell caches', async () => {
  const activation = loadWorker({ cacheNames: ['ava-crm-shell', 'ava-crm-shell-old', 'ava-platform-shell', 'other-app-shell'] });
  await new Promise((resolve) => activation.listeners.activate({ waitUntil: resolve }));
  assert.deepEqual(activation.deleted, ['ava-crm-shell-old']);
});

test('navigation and shell resources use network-first with offline fallback', async () => {
  const requests = [];
  const { listeners } = loadWorker({ fetchImpl: async (request) => {
    requests.push(request);
    return new Response('fresh', { status: 200 });
  } });
  let response;
  listeners.fetch({
    request: { method: 'GET', url: 'https://example.test/CRM/index.html', mode: 'navigate', destination: 'document' },
    respondWith: (promise) => { response = promise; }
  });
  assert.equal((await response).status, 200);
  assert.equal(requests.length, 1);
});

test('direct and Platform-style launches use the CRM-owned scope and force a worker check', async () => {
  const calls = [];
  const listeners = {};
  const context = {
    navigator: { serviceWorker: {
      controller: {},
      addEventListener: (type, listener) => { listeners[type] = listener; },
      register: async (script, options) => {
        calls.push({ script, options });
        return { update: async () => calls.push({ update: true }) };
      }
    } },
    window: { location: { reload: () => undefined } }
  };
  const body = registrationSource.replace(/^export /gm, '');
  vm.runInNewContext(`${body}\nregisterAppShellUpdate({ navigatorObject: navigator, windowObject: window });`, context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { script: './sw.js', options: { scope: './', updateViaCache: 'none' } },
    { update: true }
  ]);
  assert.ok(listeners.controllerchange);
});

test('controllerchange reload is bounded to one reload per page', () => {
  const listeners = {};
  let reloads = 0;
  const context = {
    navigator: { serviceWorker: { addEventListener: (type, listener) => { listeners[type] = listener; }, register: async () => ({ update: async () => undefined }) } },
    window: { location: { reload: () => { reloads += 1; } } }
  };
  const body = registrationSource.replace(/^export /gm, '');
  vm.runInNewContext(`${body}\nregisterAppShellUpdate({ navigatorObject: navigator, windowObject: window });`, context);
  listeners.controllerchange();
  listeners.controllerchange();
  assert.equal(reloads, 1);
});

test('update lifecycle never clears CRM user storage', () => {
  assert.doesNotMatch(workerSource, /localStorage\.clear\(|indexedDB\.deleteDatabase\(|localStorage\.removeItem\(/);
  assert.match(workerSource, /CACHE_PREFIX/);
  assert.match(fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8'), /fetch\('\.\/package\.json', \{ cache: 'no-store' \}\)/);
  assert.match(fs.readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'), /"scope":"\.\/"/);
});
