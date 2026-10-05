import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ADMIN_AREA_OPERATIONS, createAdminClient, validateOfficialRows } from '../admin-ui.js';

const source = fs.readFileSync(new URL('../admin-ui.js', import.meta.url), 'utf8');

test('Admin entry uses exactly five fixed Official areas and operations', () => {
  assert.deepEqual(Object.keys(ADMIN_AREA_OPERATIONS), ['頁面設定', 'Review問題', '保障分類', '產品資料', '系統設定']);
  assert.deepEqual(Object.values(ADMIN_AREA_OPERATIONS), ['replacePageSettings', 'replaceReviewQuestions', 'replaceCoverageCategories', 'replaceProductDefinitions', 'replaceSystemSettings']);
  assert.match(source, /action: 'exchangeAppLaunch'/);
  assert.match(source, /action: 'replaceOfficialArea'/);
  assert.match(source, /avaAdminLaunch/);
});

test('invalid, malformed and formula rows are rejected before Save Official', () => {
  const headers = ['title', 'enabled'];
  assert.deepEqual(validateOfficialRows([{ title: 'ok', enabled: true }], headers), []);
  assert.ok(validateOfficialRows([{ title: 'bad', enabled: true, extra: 'x' }], headers).length);
  assert.ok(validateOfficialRows([{ title: '=IMPORTDATA("x")', enabled: true }], headers).length);
});

test('launch exchange returns only expiry and keeps opaque appGrant private in memory', async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) return { ok: true, json: async () => ({ success: true, appGrant: 'opaque-grant', expiresAt: new Date(Date.now() + 60_000).toISOString() }) };
    return { ok: true, json: async () => ({ success: true, operation: 'replacePageSettings' }) };
  };
  const client = createAdminClient({ fetchImpl, endpoint: 'https://example.test/exec' });
  const exchange = await client.exchangeLaunch('one-time-ticket');
  assert.deepEqual(exchange.success, true);
  assert.deepEqual(exchange.appGrant, undefined);
  await client.saveOfficialArea('頁面設定', [{ title: 'ok', enabled: true }]);
  assert.equal(calls[0].action, 'exchangeAppLaunch');
  assert.equal(calls[1].action, 'replaceOfficialArea');
  assert.equal(calls[1].operation, 'replacePageSettings');
  assert.equal(calls[1].appGrant, 'opaque-grant');
});

test('failed, expired, replayed or wrong-app exchange cannot reach Official Save', async () => {
  const client = createAdminClient({ fetchImpl: async () => ({ ok: false, json: async () => ({ success: false, error: 'Invalid or expired Admin launch' }) }) });
  await assert.rejects(() => client.exchangeLaunch('expired-or-replayed'), /Invalid or expired/);
  await assert.rejects(() => client.saveOfficialArea('頁面設定', []), /authorization/);
  const expiredClient = createAdminClient({ fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, appGrant: 'expired', expiresAt: new Date(Date.now() - 1).toISOString() }) }) });
  await assert.rejects(() => expiredClient.exchangeLaunch('wrong-app-or-expired'), /過期/);
});

test('Admin code never uses persistent browser storage or private CRM stores', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|households|people|policies/);
  assert.match(source, /let appGrant = ''/);
  assert.match(source, /Official data 載入失敗；沒有初始化空白資料/);
  assert.match(source, /Save 失敗：\$\{error\.message\}。未保存的 UI 變更仍然保留/);
});

test('Admin UI cannot choose arbitrary sheet, range, or backend operation', () => {
  assert.doesNotMatch(source, /body\.sheet|body\.range|rangeName|spreadsheetId|writeAnySheet/);
  assert.match(source, /const operation = ADMIN_AREA_OPERATIONS\[area\]/);
  assert.match(source, /if \(!operation\) throw new Error/);
});

test('Admin responsive structure is bounded and uses an intentional contained nav scroll', () => {
  const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /\.admin-nav \{ flex-direction: row; overflow-x: auto;/);
  assert.match(css, /\.admin-field-grid \{ grid-template-columns: 1fr;/);
  assert.doesNotMatch(css, /body\s*\{[^}]*overflow-x\s*:\s*scroll/);
});
