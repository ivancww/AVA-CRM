import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { AVA_PLATFORM_URL, CRM_CAPABILITIES, resolveAvaEntry, returnToAvaUrl } from '../ava-entry.js';

test('bare and frontend entry resolve to the real CRM Frontstage', () => {
  assert.equal(resolveAvaEntry(''), 'frontend');
  assert.equal(resolveAvaEntry('?avaEntry=frontend'), 'frontend');
});

test('user entry reuses the Frontstage and unsupported entries fail safely', () => {
  assert.equal(resolveAvaEntry('?avaEntry=user'), 'user');
  assert.equal(resolveAvaEntry('?avaEntry=admin'), 'admin');
  assert.equal(resolveAvaEntry('?avaEntry=unknown'), 'frontend');
  assert.deepEqual(CRM_CAPABILITIES, { frontend: true, user: true, admin: false });
});

test('Return to AVA uses the verified platform destination and surface contract', () => {
  assert.equal(returnToAvaUrl('frontend'), AVA_PLATFORM_URL);
  assert.equal(returnToAvaUrl('user'), `${AVA_PLATFORM_URL}?avaSurface=user`);
  assert.equal(returnToAvaUrl('admin'), AVA_PLATFORM_URL);
});

test('integration surfaces preserve version identity, User Layer and safe update boundaries', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(html, /id="appVersion"/);
  assert.match(html, /id="returnAvaLink"/);
  assert.match(html, /id="userModeBar"/);
  assert.match(app, /saveMutation\('settings', value\)/);
  assert.match(app, /ava-crm-frontstage-overrides/);
  assert.doesNotMatch(worker, /indexedDB\.deleteDatabase|localStorage\.clear|localStorage\.removeItem/);
});
