import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ADMIN_AREA_OPERATIONS, createAdminClient, validateOfficialRows } from '../admin-ui.js';

const source = fs.readFileSync(new URL('../admin-ui.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function browserWindowFor(ticket, nonce) {
  let listener;
  const opener = {
    postMessage() {
      queueMicrotask(() => listener?.({
        source: opener,
        origin: 'https://ivancww.github.io',
        data: {
          type: 'ava-admin-session-response',
          appId: 'crm',
          launchTicket: ticket,
          launchNonce: nonce,
          browserProof: 'browser-proof',
          contract: 'ava-admin-session-v1'
        }
      }));
    }
  };
  return {
    opener,
    setTimeout,
    clearTimeout,
    addEventListener(_name, handler) { listener = handler; },
    removeEventListener() { listener = undefined; },
    location: { search: '?avaEntry=admin&avaAdminLaunch=' + ticket + '&avaAdminLaunchNonce=' + nonce, pathname: '/', hash: '' },
    history: { replaceState() {} }
  };
}

test('CRM Admin keeps exactly the five CRM-owned Official domains', () => {
  assert.deepEqual(Object.keys(ADMIN_AREA_OPERATIONS), ['頁面設定', 'Review問題', '保障分類', '產品資料', '系統設定']);
  assert.deepEqual(Object.values(ADMIN_AREA_OPERATIONS), ['replacePageSettings', 'replaceReviewQuestions', 'replaceCoverageCategories', 'replaceProductDefinitions', 'replaceSystemSettings']);
});

test('Saving-style Admin workspace has real tabs, one panel, record selection and bottom system info', () => {
  assert.match(source, /role="tablist"/);
  assert.match(source, /data-admin-tab/);
  assert.match(source, /panel\.hidden = !active/);
  assert.match(source, /aria-hidden/);
  assert.match(source, /data-admin-record-select/);
  assert.match(source, /選擇記錄/);
  assert.match(source, /isProtectedField/);
  assert.match(source, /admin-system-info/);
  assert.match(source, /未確認的草稿仍然保留/);
  assert.match(css, /\.admin-tabs\{display:grid;grid-template-columns:repeat\(5/);
  assert.match(css, /\.admin-domain\[hidden\],\.admin-record\[hidden\]\{display:none!important\}/);
  assert.doesNotMatch(css, /\.admin-nav/);
});

test('Official rows reject malformed, schema-changing and formula values', () => {
  const headers = ['id', 'title', 'enabled'];
  assert.deepEqual(validateOfficialRows([{ id: 'p1', title: 'ok', enabled: true }], headers), []);
  assert.ok(validateOfficialRows([{ id: 'p1', title: 'bad', enabled: true, extra: 'x' }], headers).length);
  assert.ok(validateOfficialRows([{ id: 'p1', title: '=IMPORTDATA("x")', enabled: true }], headers).length);
});

test('Official save requires CRM persistence evidence before returning success', async () => {
  const ticket = 'ticket';
  const nonce = 'nonce';
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (calls.length === 1) return { ok: true, json: async () => ({ success: true, appId: 'crm', adminSessionProof: 'opaque-proof', expiresAt: new Date(Date.now() + 60_000).toISOString(), contract: 'ava-admin-session-v1' }) };
    return { ok: true, json: async () => ({ success: true, appId: 'crm', operation: 'replacePageSettings', area: '頁面設定', count: 1, revision: 'a'.repeat(64) }) };
  };
  const client = createAdminClient({ fetchImpl, endpoint: 'https://example.test/exec', windowObject: browserWindowFor(ticket, nonce) });
  await client.exchangeLaunch({ launchTicket: ticket, launchNonce: nonce });
  const saved = await client.saveOfficialArea('頁面設定', [{ id: 'p1', title: 'ok', enabled: true }]);
  assert.equal(saved.persisted, undefined);
  assert.equal(calls[0].action, 'exchangeAdminSession');
  assert.equal(calls[1].action, 'replaceOfficialArea');
  assert.equal(calls[1].operation, 'replacePageSettings');
  assert.equal(calls[1].appId, 'crm');
});

test('incomplete persistence evidence is rejected and cannot confirm a write', async () => {
  const ticket = 'ticket';
  const nonce = 'nonce';
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.action === 'exchangeAdminSession') return { ok: true, json: async () => ({ success: true, appId: 'crm', adminSessionProof: 'opaque-proof', expiresAt: new Date(Date.now() + 60_000).toISOString(), contract: 'ava-admin-session-v1' }) };
    return { ok: true, json: async () => ({ success: true, appId: 'crm', operation: 'replacePageSettings', area: '頁面設定', count: 1, revision: 'not-a-canonical-revision' }) };
  };
  const client = createAdminClient({ fetchImpl, endpoint: 'https://example.test/exec', windowObject: browserWindowFor(ticket, nonce) });
  await client.exchangeLaunch({ launchTicket: ticket, launchNonce: nonce });
  await assert.rejects(() => client.saveOfficialArea('頁面設定', [{ id: 'p1', title: 'ok', enabled: true }]), /persistence evidence/);
});

test('Official save rejects an incorrect authoritative count', async () => {
  const ticket = 'ticket';
  const nonce = 'nonce';
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.action === 'exchangeAdminSession') return { ok: true, json: async () => ({ success: true, appId: 'crm', adminSessionProof: 'opaque-proof', expiresAt: new Date(Date.now() + 60_000).toISOString(), contract: 'ava-admin-session-v1' }) };
    return { ok: true, json: async () => ({ success: true, appId: 'crm', operation: 'replacePageSettings', area: '頁面設定', count: 2, revision: 'a'.repeat(64) }) };
  };
  const client = createAdminClient({ fetchImpl, endpoint: 'https://example.test/exec', windowObject: browserWindowFor(ticket, nonce) });
  await client.exchangeLaunch({ launchTicket: ticket, launchNonce: nonce });
  await assert.rejects(() => client.saveOfficialArea('頁面設定', [{ id: 'p1', title: 'ok', enabled: true }]), /persistence evidence/);
});

test('Admin preserves drafts changed while an Official save is in flight', () => {
  assert.match(source, /draftChangedDuringSave/);
  assert.match(source, /保存期間的新草稿修改仍然保留/);
});

test('Admin source does not use browser storage for Official session or customer data', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|households|people|policies/);
  assert.match(source, /let adminSessionProof = ''/);
  assert.match(source, /Official data 載入失敗；沒有初始化空白資料/);
});

test('responsive Admin layout is a wrapped card grid with no page-level horizontal scroll', () => {
  assert.match(css, /@media \(max-width:900px\)/);
  assert.match(css, /@media \(max-width:700px\)/);
  assert.match(css, /\.admin-field-grid\{grid-template-columns:1fr\}/);
  assert.match(css, /html,body\{max-width:100%;overflow-x:hidden\}/);
  assert.doesNotMatch(css, /\.admin-nav/);
});

const crmTestRows = [{ id: 'p1', title: 'ok', enabled: true }];
const crmValidWriteResponse = {
  success: true,
  appId: 'crm',
  operation: 'replacePageSettings',
  area: '頁面設定',
  count: 1,
  revision: 'a'.repeat(64)
};

async function exchangedCrmClient(replaceResponse) {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.action === 'exchangeAdminSession') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          appId: 'crm',
          adminSessionProof: 'opaque-proof',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          contract: 'ava-admin-session-v1'
        })
      };
    }
    if (replaceResponse instanceof Error) throw replaceResponse;
    return { ok: true, json: async () => replaceResponse };
  };
  const client = createAdminClient({
    fetchImpl,
    endpoint: 'https://example.test/exec',
    windowObject: browserWindowFor('ticket', 'nonce')
  });
  await client.exchangeLaunch({ launchTicket: 'ticket', launchNonce: 'nonce' });
  return { client, calls };
}

test('HTTP 200 with success=false is rejected as an unsuccessful Official write', async () => {
  const { client } = await exchangedCrmClient({ success: false, error: 'server rejected write' });
  await assert.rejects(() => client.saveOfficialArea('頁面設定', crmTestRows), /server rejected write/);
});

test('missing revision is rejected even when the HTTP response is otherwise successful', async () => {
  const { client } = await exchangedCrmClient({ ...crmValidWriteResponse, revision: undefined });
  await assert.rejects(() => client.saveOfficialArea('頁面設定', crmTestRows), /persistence evidence/);
});

for (const [label, response] of [
  ['wrong appId', { ...crmValidWriteResponse, appId: 'medical' }],
  ['wrong operation', { ...crmValidWriteResponse, operation: 'replaceSystemSettings' }],
  ['wrong area', { ...crmValidWriteResponse, area: '產品資料' }]
]) {
  test('Official write rejects ' + label, async () => {
    const { client } = await exchangedCrmClient(response);
    await assert.rejects(() => client.saveOfficialArea('頁面設定', crmTestRows), /persistence evidence/);
  });
}

test('expired Admin authorization is rejected before an Official write', async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.action, 'exchangeAdminSession');
    return {
      ok: true,
      json: async () => ({
        success: true,
        appId: 'crm',
        adminSessionProof: 'expired-proof',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        contract: 'ava-admin-session-v1'
      })
    };
  };
  const client = createAdminClient({
    fetchImpl,
    endpoint: 'https://example.test/exec',
    windowObject: browserWindowFor('ticket', 'nonce')
  });
  await assert.rejects(() => client.exchangeLaunch({ launchTicket: 'ticket', launchNonce: 'nonce' }), /authorization/);
});

test('stale expectedVersion and concurrent modification are not treated as persistence success', async () => {
  const { client, calls } = await exchangedCrmClient({ success: false, error: 'Stale Official revision' });
  client.setExpectedVersion('stale-revision');
  await assert.rejects(() => client.saveOfficialArea('頁面設定', crmTestRows), /Stale Official revision/);
  assert.equal(calls[1].expectedVersion, 'stale-revision');
});

for (const [label, error] of [
  ['network interruption', new Error('network interruption')],
  ['timeout', new Error('request timeout')],
  ['read-after-write failure', new Error('Official read-after-write verification failed')]
]) {
  test(label + ' does not become a successful Official write', async () => {
    const { client } = await exchangedCrmClient(error);
    await assert.rejects(() => client.saveOfficialArea('頁面設定', crmTestRows), new RegExp(error.message));
  });
}

test('duplicate Save attempts are guarded while the first request is in flight', () => {
  assert.match(source, /saveButton\.disabled = true/);
  assert.match(source, /const candidate = clone\(draft\[area\]\)/);
});

test('an in-flight response cannot replace a newer draft or omit unselected rows', () => {
  assert.match(source, /const draftChangedDuringSave = JSON\.stringify\(draft\[area\]\) !== JSON\.stringify\(candidate\)/);
  assert.match(source, /client\.saveOfficialArea\(area, candidate\)/);
  assert.match(source, /confirmed\[area\] = clone\(candidate\)/);
});

