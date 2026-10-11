import { OFFICIAL_GAS_ENDPOINT } from './crm-core.js';

export const ADMIN_AREA_OPERATIONS = Object.freeze({
  '頁面設定': 'replacePageSettings',
  'Review問題': 'replaceReviewQuestions',
  '保障分類': 'replaceCoverageCategories',
  '產品資料': 'replaceProductDefinitions',
  '系統設定': 'replaceSystemSettings'
});

const AREA_ORDER = Object.freeze(Object.keys(ADMIN_AREA_OPERATIONS));

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function isScalar(value) { return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'; }

export function validateOfficialRows(rows, headers) {
  const problems = [];
  if (!Array.isArray(rows)) return ['Official rows 必須是列表。'];
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { problems.push(`第 ${index + 1} 行不是有效記錄。`); return; }
    const keys = Object.keys(row);
    if (keys.length !== headers.length || headers.some((header) => !Object.prototype.hasOwnProperty.call(row, header)) || keys.some((key) => !headers.includes(key))) problems.push(`第 ${index + 1} 行欄位與 Official schema 不一致。`);
    if (keys.some((key) => !isScalar(row[key]) || (typeof row[key] === 'string' && row[key].startsWith('=')))) problems.push(`第 ${index + 1} 行含有不支援的值。`);
  });
  return problems;
}

const CRM_APP_ID = 'crm';
const PLATFORM_ORIGIN = 'https://ivancww.github.io';

function browserProofFromOpener(launchTicket, launchNonce, windowObject = globalThis.window) {
  if (!launchTicket || !launchNonce || !windowObject?.opener) throw new Error('CRM Admin 必須由 AVA Studio 啟動。');
  return new Promise((resolve, reject) => {
    const opener = windowObject.opener; let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); windowObject.removeEventListener('message', onMessage); error ? reject(error) : resolve(value); };
    const timer = windowObject.setTimeout(() => finish(new Error('AVA browser binding expired')), 15000);
    const onMessage = event => {
      if (event.source !== opener || event.origin !== PLATFORM_ORIGIN) return;
      const data = event.data || {};
      if (data.type !== 'ava-admin-session-response' || data.appId !== CRM_APP_ID || data.launchTicket !== launchTicket || data.launchNonce !== launchNonce) return;
      if (!data.browserProof || data.contract !== 'ava-admin-session-v1') return finish(new Error('CRM browser proof 無效。'));
      finish(null, data);
    };
    windowObject.addEventListener('message', onMessage);
    opener.postMessage({ type: 'ava-admin-session-request', appId: CRM_APP_ID, launchTicket, launchNonce }, PLATFORM_ORIGIN);
  });
}

export function createAdminClient({ fetchImpl = globalThis.fetch, endpoint = OFFICIAL_GAS_ENDPOINT, windowObject = globalThis.window } = {}) {
  // Proof remains in this closure only; it is never written to URL or browser storage.
  let adminSessionProof = '';
  let proofExpiresAt = 0;
  let expectedVersion = '';

  async function request(body) {
    const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    let payload; try { payload = await response.json(); } catch (_) { throw new Error('CRM Admin 回應無效。'); }
    if (!response.ok || payload.success !== true) throw new Error(payload.error || 'CRM Admin request failed');
    return payload;
  }

  return Object.freeze({
    async exchangeLaunch({ launchTicket, launchNonce }) {
      if (!launchTicket || typeof launchTicket !== 'string' || launchTicket.length > 200 || !launchNonce || typeof launchNonce !== 'string' || launchNonce.length > 200) throw new Error('CRM Admin launch ticket 無效。');
      const browser = await browserProofFromOpener(launchTicket, launchNonce, windowObject);
      const payload = await request({ action: 'exchangeAdminSession', launchTicket, launchNonce, browserProof: browser.browserProof, appId: CRM_APP_ID });
      const expiry = Date.parse(payload.expiresAt || '');
      if (payload.appId !== CRM_APP_ID || payload.contract !== 'ava-admin-session-v1' || !payload.adminSessionProof || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('CRM Admin authorization 未完成。');
      adminSessionProof = String(payload.adminSessionProof); proofExpiresAt = expiry;
      return { success: true, expiresAt: payload.expiresAt, contract: payload.contract };
    },
    async saveOfficialArea(area, rows) {
      const operation = ADMIN_AREA_OPERATIONS[area];
      if (!operation) throw new Error('Official area 不在固定 allowlist。');
      if (!adminSessionProof || proofExpiresAt <= Date.now()) throw new Error('CRM Admin authorization 已失效，請由 AVA Studio 重新進入。');
      const payload = await request({ action: 'replaceOfficialArea', operation, appId: CRM_APP_ID, adminSessionProof, expectedVersion, rows });
          const revision = String(payload.revision || '');
          if (payload.appId !== CRM_APP_ID || payload.operation !== operation || payload.area !== area || !Number.isInteger(payload.count) || !/^[0-9a-f]{64}$/i.test(revision)) throw new Error('CRM Official persistence evidence incomplete.');
          return payload;
    }
    , setExpectedVersion(version) { expectedVersion = String(version || ''); }
  });
}

function renderDenied({ documentObject, reason }) {
  documentObject.body.dataset.avaMode = 'admin-denied';
  documentObject.querySelector('#adminContext')?.removeAttribute('hidden');
  documentObject.querySelector('#agentHeader')?.classList.add('admin-denied-header');
  documentObject.querySelector('main')?.setAttribute('hidden', '');
  documentObject.querySelector('footer')?.setAttribute('hidden', '');
  const existing = documentObject.getElementById('adminRoot');
  if (existing) existing.remove();
  const section = documentObject.createElement('main');
  section.id = 'adminRoot'; section.className = 'ava-front__container admin-root';
  section.innerHTML = '<section class="ava-card admin-denied-card"><p class="eyebrow">AVA-CRM · Admin</p><h1 class="ava-front__title">未能開啟 Admin</h1><p class="ava-support">這個入口只接受 AVA Studio 發出的有效、一次性 CRM launch ticket。沒有載入或修改 Official data。</p><p class="blocked-note" id="adminDeniedReason"></p><a class="ava-button ava-button--primary" href="https://ivancww.github.io/avaplatform/">返回 AVA / AVA Studio</a></section></main>';
  section.querySelector('#adminDeniedReason').textContent = reason || 'Admin authorization failed';
  documentObject.body.append(section);
}

function fieldValue(value) { return value === null || value === undefined ? '' : String(value); }
function valueFromInput(input, original) {
  if (input.type === 'checkbox') return input.checked;
  if (typeof original === 'number') { const number = Number(input.value); return Number.isFinite(number) ? number : input.value; }
  return input.value;
}

export async function initializeAdmin({ documentObject = document, windowObject = window, fetchImpl = fetch, endpoint = OFFICIAL_GAS_ENDPOINT } = {}) {
  const params = new URLSearchParams(windowObject.location.search);
  const ticket = params.get('avaAdminLaunch');
  const launchNonce = params.get('avaAdminLaunchNonce');
  const client = createAdminClient({ fetchImpl, endpoint, windowObject });
  if (!ticket || !launchNonce) { renderDenied({ documentObject, reason: '缺少 AVA Studio launch ticket。' }); return { authorized: false, reason: 'missing-ticket' }; }
  try {
    await client.exchangeLaunch({ launchTicket: ticket, launchNonce });
    params.delete('avaAdminLaunch');
    params.delete('avaAdminLaunchNonce');
    windowObject.history?.replaceState(null, '', windowObject.location.pathname + (params.toString() ? '?' + params.toString() : '') + windowObject.location.hash);
  } catch (error) {
    renderDenied({ documentObject, reason: error.message });
    return { authorized: false, reason: error.message };
  }

  let response;
  let payload;
  try {
    response = await fetchImpl(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    try { payload = await response.json(); } catch (_) { payload = null; }
  } catch (_) {
    renderDenied({ documentObject, reason: 'Official data 載入失敗；沒有初始化空白資料。' });
    return { authorized: false, reason: 'official-fetch-failed' };
  }
  if (!response.ok || payload?.success !== true || !payload.data || typeof payload.data !== 'object') {
    renderDenied({ documentObject, reason: 'Official data 載入失敗；沒有初始化空白資料。' });
    return { authorized: false, reason: 'official-fetch-failed' };
  }

  const official = Object.fromEntries(AREA_ORDER.map((area) => [area, Array.isArray(payload.data[area]) ? clone(payload.data[area]) : []]));
  const confirmed = clone(official);
  const draft = clone(official);
  const selectedRecord = Object.fromEntries(AREA_ORDER.map((area) => [area, 0]));
  const schemaHeaders = Object.fromEntries(AREA_ORDER.map((area) => [area, official[area].length ? Object.keys(official[area][0]) : []]));
  let activeArea = AREA_ORDER[0];

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const AREA_DESCRIPTIONS = {
    '頁面設定': '管理 CRM 前台頁面標題、步驟及展示設定。',
    'Review問題': '管理 Customer Review 使用的問題、選項及提示。',
    '保障分類': '管理保障分類及對應呈現規則。',
    '產品資料': '管理 CRM Official Product Feature Registry。',
    '系統設定': '管理 CRM Official defaults 及系統選項。'
  };
  const FIELD_LABELS = {
    id: '穩定識別碼', key: '穩定鍵', code: '穩定代碼', title: '標題', name: '名稱', label: '顯示名稱',
    description: '說明', subtitle: '副標題', content: '內容', text: '文字', question: '問題',
    options: '選項', enabled: '啟用', active: '啟用', order: '顯示順序', sort_order: '顯示排序',
    type: '類型', category: '分類', status: '狀態', value: '數值', page: '頁面', page_id: '頁面識別碼',
    created_at: '建立時間', updated_at: '更新時間', revision: '版本'
  };

  function isStableField(key) {
    return /(^id$|_id$|^key$|_key$|code$|_code$|編號|代碼|識別)/i.test(String(key));
  }
  function isProtectedField(key) {
    return isStableField(key) || /^(created|updated|deleted|last)[_-]?(at|by)?$|revision|version/i.test(String(key));
  }
  function fieldLabel(key) {
    const raw = String(key);
    const exact = FIELD_LABELS[raw];
    return exact || FIELD_LABELS[raw.toLowerCase()] || '欄位：' + raw;
  }
  function fieldType(key, value, rows) {
    if (typeof value === 'boolean') return 'checkbox';
    if (typeof value === 'number') return 'number';
    const values = [...new Set(rows.map((row) => row[key]).filter((item) => item !== null && item !== undefined && item !== ''))];
    if (values.length > 1 && values.length <= 12 && /type|category|status|kind|mode|state|role/i.test(String(key))) return 'select';
    if (typeof value === 'string' && value.length > 160) return 'textarea';
    return 'text';
  }
  function recordIdentity(area, row, index) {
    const keys = Object.keys(row || {});
    const identity = keys.find((key) => isStableField(key) && row[key] !== null && row[key] !== undefined && String(row[key]) !== '');
    return identity ? String(row[identity]) : '第 ' + (index + 1) + ' 筆（未提供穩定 ID）';
  }
  function currentHeaders(area) {
    return schemaHeaders[area]?.length ? schemaHeaders[area] : (draft[area].length ? Object.keys(draft[area][0]) : []);
  }
  function observedOptions(key, rows, value) {
    return [...new Set(rows.map((row) => row[key]).filter((item) => item !== null && item !== undefined && item !== '').concat(value === null || value === undefined ? [] : [value]))];
  }
  function renderField(area, row, rowIndex, key, rows) {
    const value = row[key];
    const kind = fieldType(key, value, rows);
    const stable = isProtectedField(key);
    const id = 'crm-admin-' + area + '-' + rowIndex + '-' + key;
    const label = '<span class="ava-label">' + escapeHtml(fieldLabel(key)) + (stable ? ' <small class="admin-field-note">（唯讀）</small>' : '') + '</span>';
    const actualKey = '<small class="admin-field-key">' + escapeHtml(String(key)) + '</small>';
    const common = 'data-admin-field="' + escapeHtml(String(key)) + '" data-admin-area="' + escapeHtml(area) + '" data-admin-row-index="' + rowIndex + '" data-admin-type="' + kind + '"';
    if (kind === 'checkbox') {
      return '<label class="admin-field admin-field--checkbox" for="' + escapeHtml(id) + '">' + label + actualKey + '<input id="' + escapeHtml(id) + '" type="checkbox" ' + common + (value === true ? ' checked' : '') + (stable ? ' disabled' : '') + '></label>';
    }
    if (kind === 'select') {
      return '<label class="admin-field" for="' + escapeHtml(id) + '">' + label + actualKey + '<select id="' + escapeHtml(id) + '" class="ava-input" ' + common + (stable ? ' disabled' : '') + '>' + observedOptions(key, rows, value).map((option) => '<option value="' + escapeHtml(option) + '"' + (String(option) === String(value) ? ' selected' : '') + '>' + escapeHtml(String(option)) + '</option>').join('') + '</select></label>';
    }
    if (kind === 'textarea') {
      return '<label class="admin-field" for="' + escapeHtml(id) + '">' + label + actualKey + '<textarea id="' + escapeHtml(id) + '" class="ava-input" ' + common + (stable ? ' readonly' : '') + '>' + escapeHtml(value) + '</textarea></label>';
    }
    return '<label class="admin-field" for="' + escapeHtml(id) + '">' + label + actualKey + '<input id="' + escapeHtml(id) + '" class="ava-input" type="' + (kind === 'number' ? 'number' : 'text') + '" value="' + escapeHtml(value) + '" ' + common + (stable ? ' readonly' : '') + '></label>';
  }
  function renderRecord(area, row, rowIndex, rows) {
    return '<article class="admin-record" data-admin-record="' + rowIndex + '" ' + (rowIndex === Number(selectedRecord[area] || 0) ? '' : 'hidden') + '><div class="admin-record-heading"><div><span class="eyebrow">' + escapeHtml(recordIdentity(area, row, rowIndex)) + '</span><h3>第 ' + (rowIndex + 1) + ' 筆記錄</h3></div><span class="admin-record-index">' + (rowIndex + 1) + ' / ' + rows.length + '</span></div><div class="admin-field-grid">' + Object.keys(row).map((key) => renderField(area, row, rowIndex, key, rows)).join('') + '</div><div class="admin-record-actions"><button type="button" class="ava-button ava-button--subtle" data-admin-action="delete-record" data-admin-area="' + escapeHtml(area) + '" data-admin-row-index="' + rowIndex + '">刪除選取記錄</button></div></article>';
  }
  function renderPanel(area) {
    const rows = draft[area];
    const actualRows = confirmed[area];
    const headers = currentHeaders(area);
    const selected = rows.length ? Math.min(Number(selectedRecord[area] || 0), rows.length - 1) : 0;
    selectedRecord[area] = selected;
    const dirty = JSON.stringify(rows) !== JSON.stringify(actualRows);
    const stableSchema = headers.some((key) => isStableField(key));
    const selector = rows.length
      ? '<div class="admin-record-tools"><label class="ava-field" for="crm-record-select-' + escapeHtml(area) + '"><span class="ava-label">選擇記錄</span><select id="crm-record-select-' + escapeHtml(area) + '" class="ava-input" data-admin-record-select="' + escapeHtml(area) + '">' + rows.map((row, index) => '<option value="' + index + '"' + (index === selected ? ' selected' : '') + '>' + escapeHtml(recordIdentity(area, row, index)) + '</option>').join('') + '</select></label><span class="admin-record-selection">只顯示已選取的 CRM Official record；原有順序會保留。</span></div>'
      : '<div class="empty-state"><strong>目前沒有 Official 記錄</strong><span>這個畫面不會自行建立資料或猜測 schema。</span></div>';
    const editor = rows.length ? rows.map((row, index) => renderRecord(area, row, index, rows)).join('') : '';
    const addDisabled = !headers.length || stableSchema;
    const addTitle = stableSchema ? 'CRM stable ID 由 Official source 擁有，前端不會產生新 ID。' : '按現有 schema 新增草稿記錄。';
    return '<section id="admin-panel-' + escapeHtml(area) + '" class="ava-card admin-domain" data-admin-panel="' + escapeHtml(area) + '" role="tabpanel" aria-labelledby="admin-tab-' + escapeHtml(area) + '" tabindex="-1" ' + (area === activeArea ? '' : 'hidden aria-hidden="true"') + '><div class="admin-domain-heading"><div><span class="eyebrow">CRM OFFICIAL · ' + escapeHtml(area) + '</span><h1>' + escapeHtml(area) + '</h1><p class="ava-support">' + escapeHtml(AREA_DESCRIPTIONS[area]) + '</p></div><div class="admin-count"><strong>' + actualRows.length + '</strong><span>筆 Official 記錄</span>' + (dirty ? '<small>有未儲存草稿</small>' : '') + '</div></div>' + selector + '<div class="admin-records">' + editor + '</div><div class="admin-actions"><button type="button" class="ava-button ava-button--secondary" data-admin-action="add-record" data-admin-area="' + escapeHtml(area) + '"' + (addDisabled ? ' disabled title="' + escapeHtml(addTitle) + '"' : '') + '>＋ 新增記錄</button><button type="button" class="ava-button ava-button--secondary" data-admin-action="review-area" data-admin-area="' + escapeHtml(area) + '">Review / Preview changes</button><button type="button" class="ava-button ava-button--primary" data-admin-action="save-area" data-admin-area="' + escapeHtml(area) + '"' + (dirty ? '' : ' disabled') + '>Save Official</button></div><div id="admin-status-' + escapeHtml(area) + '" class="admin-status" role="status"></div></section>';
  }
  function renderTabs() {
    const tabs = root.querySelector('.admin-tabs');
    if (!tabs) return;
    tabs.innerHTML = AREA_ORDER.map((area) => '<button id="admin-tab-' + escapeHtml(area) + '" class="admin-tab' + (area === activeArea ? ' is-active' : '') + '" data-admin-tab="' + escapeHtml(area) + '" role="tab" aria-selected="' + (area === activeArea ? 'true' : 'false') + '" aria-controls="admin-panel-' + escapeHtml(area) + '" tabindex="' + (area === activeArea ? '0' : '-1') + '" type="button"><span>' + escapeHtml(area) + '</span><small>' + confirmed[area].length + ' 筆</small></button>').join('');
  }
  function renderPanels() {
    const panels = root.querySelector('.admin-panels');
    if (!panels) return;
    panels.innerHTML = AREA_ORDER.map(renderPanel).join('');
    updatePanelVisibility();
  }
  function updatePanelVisibility() {
    root.querySelectorAll('[data-admin-panel]').forEach((panel) => {
      const active = panel.dataset.adminPanel === activeArea;
      panel.hidden = !active;
      panel.setAttribute('aria-hidden', String(!active));
    });
    root.querySelectorAll('[data-admin-tab]').forEach((tab) => {
      const active = tab.dataset.adminTab === activeArea;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
  }
  function isDirty(area) {
    return JSON.stringify(draft[area]) !== JSON.stringify(confirmed[area]);
  }
  function setStatus(area, message, type) {
    const status = root.querySelector('#admin-status-' + area);
    if (status) { status.textContent = message; status.dataset.state = type || ''; }
    const globalStatus = root.querySelector('#admin-global-status');
    if (globalStatus) { globalStatus.textContent = message; globalStatus.dataset.state = type || ''; }
  }
  function discardArea(area) {
    draft[area] = clone(confirmed[area]);
    selectedRecord[area] = 0;
    renderTabs();
    renderPanels();
  }
  function confirmDiscard(area, action) {
    if (!isDirty(area)) return true;
    return windowObject.confirm?.('「' + area + '」有未儲存修改。切換或繼續' + action + '前，是否放棄目前草稿？') === true;
  }
  function selectArea(area) {
    if (!AREA_ORDER.includes(area) || area === activeArea) return true;
    if (!confirmDiscard(activeArea, '')) return false;
    if (isDirty(activeArea)) discardArea(activeArea);
    activeArea = area;
    renderTabs();
    renderPanels();
    root.querySelector('#admin-panel-' + area)?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    root.querySelector('#admin-tab-' + area)?.focus?.({ preventScroll: true });
    return true;
  }
  function selectRecord(area, index) {
    if (area !== activeArea) return false;
    const next = Number(index);
    if (!Number.isInteger(next) || next < 0 || next >= draft[area].length) return false;
    if (Number(selectedRecord[area] || 0) === next) return true;
    if (!confirmDiscard(area, '')) return false;
    if (isDirty(area)) discardArea(area);
    selectedRecord[area] = next;
    renderPanels();
    root.querySelector('#admin-panel-' + area + ' [data-admin-record="' + next + '"]')?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    return true;
  }
  function readField(field) {
    if (field.dataset.adminType === 'checkbox') return field.checked;
    if (field.dataset.adminType === 'number') return field.value === '' ? '' : Number(field.value);
    return field.value;
  }
  function reviewArea(area) {
    const headers = currentHeaders(area);
    const problems = validateOfficialRows(draft[area], headers);
    if (problems.length) { setStatus(area, 'Review 未通過：' + problems.join(' '), 'error'); return false; }
    if (!isDirty(area)) { setStatus(area, '沒有變更；未有 Official write。', ''); return false; }
    setStatus(area, 'Review 通過：只會提交「' + area + '」這一個 Official domain；再次按 Save Official 才會送出。', 'ready');
    return true;
  }
  async function saveArea(area) {
    if (!isDirty(area)) { setStatus(area, '目前沒有未儲存修改。', ''); return; }
    const headers = currentHeaders(area);
    const problems = validateOfficialRows(draft[area], headers);
    if (problems.length) { setStatus(area, 'Save blocked：' + problems.join(' '), 'error'); return; }
    const saveButton = root.querySelector('[data-admin-action="save-area"][data-admin-area="' + area + '"]');
    if (saveButton) saveButton.disabled = true;
    setStatus(area, '正在透過 CRM backend 驗證並保存…', 'ready');
    const candidate = clone(draft[area]);
    try {
      const saved = await client.saveOfficialArea(area, candidate);
      client.setExpectedVersion(saved.revision);
      confirmed[area] = clone(candidate);
      draft[area] = clone(candidate);
      renderTabs();
      renderPanels();
      setStatus(area, '已保存「' + area + '」；server 已返回 revision、count、area 及 operation persistence evidence。', 'success');
    } catch (error) {
      if (saveButton) saveButton.disabled = false;
      setStatus(area, 'Save 失敗：' + error.message + '。未確認的草稿仍然保留。', 'error');
    }
  }
  function addRecord(area) {
    if (!currentHeaders(area).length || currentHeaders(area).some((key) => isStableField(key))) {
      setStatus(area, 'CRM stable ID 由 Official source 擁有，前端不會自行產生新 ID。', 'error');
      return;
    }
    const blank = Object.fromEntries(currentHeaders(area).map((key) => [key, '']));
    draft[area].push(blank);
    selectedRecord[area] = draft[area].length - 1;
    renderTabs();
    renderPanels();
    setStatus(area, '已新增未儲存草稿記錄；儲存前會再由 CRM backend 驗證完整 schema。', 'ready');
  }
  function deleteRecord(area, index) {
    const next = Number(index);
    if (!Number.isInteger(next) || next < 0 || next >= draft[area].length) return;
    if (windowObject.confirm?.('確定刪除已選取的 CRM Official 草稿記錄？保存前不會寫入 Official source。') !== true) return;
    draft[area].splice(next, 1);
    selectedRecord[area] = Math.max(0, Math.min(selectedRecord[area], draft[area].length - 1));
    renderTabs();
    renderPanels();
    setStatus(area, '已刪除草稿記錄；尚未寫入 Official source。', 'ready');
  }

  const header = documentObject.querySelector('#agentHeader');
  documentObject.querySelector('main')?.setAttribute('hidden', '');
  documentObject.querySelector('footer')?.setAttribute('hidden', '');
  header?.classList.add('admin-header');
  const context = documentObject.querySelector('#adminContext');
  if (context) context.hidden = false;
  const returnLink = documentObject.querySelector('#returnAvaLink');
  if (returnLink) {
    returnLink.href = 'https://ivancww.github.io/avaplatform/';
    returnLink.innerHTML = '<span aria-hidden="true">←</span> 返回 AVA';
  }
  const root = documentObject.createElement('main');
  root.id = 'adminRoot';
  root.className = 'ava-front__container admin-root';
  root.innerHTML = '<div class="admin-surface"><nav class="admin-tabs" aria-label="CRM Official areas" role="tablist"></nav><div class="admin-panels"></div><div id="admin-global-status" class="admin-global-status" role="status"></div><details class="admin-system-info"><summary>系統資料</summary><div class="admin-system-grid"><p><strong>App version</strong><span id="admin-system-app-version">載入中</span></p><p><strong>Official data revision</strong><span>' + escapeHtml(payload.revision || '未提供') + '</span></p><p><strong>同步狀態</strong><span>已完成 Official Read；Write 只在 server 返回完整 persistence evidence 後更新確認快取。</span></p><p><strong>來源</strong><span>CRM-owned Official GET / Official configuration endpoint</span></p><p><strong>安全狀態</strong><span>Browser-bound Admin session 只保留在記憶體；系統資料不顯示 launch ticket 或 session proof。</span></p></div></details></div>';
  documentObject.body.append(root);
  const appVersion = documentObject.querySelector('#appVersion')?.textContent || 'v—';
  const systemVersion = root.querySelector('#admin-system-app-version');
  if (systemVersion) systemVersion.textContent = appVersion;

  renderTabs();
  renderPanels();
  root.addEventListener('click', (event) => {
    const tab = event.target.closest?.('[data-admin-tab]');
    if (tab) { selectArea(tab.dataset.adminTab); return; }
    const action = event.target.closest?.('[data-admin-action]');
    if (!action) return;
    const area = action.dataset.adminArea;
    if (action.dataset.adminAction === 'review-area') reviewArea(area);
    if (action.dataset.adminAction === 'save-area') saveArea(area);
    if (action.dataset.adminAction === 'add-record') addRecord(area);
    if (action.dataset.adminAction === 'delete-record') deleteRecord(area, action.dataset.adminRowIndex);
  });
  root.addEventListener('change', (event) => {
    const selector = event.target.closest?.('[data-admin-record-select]');
    if (selector) { selectRecord(selector.dataset.adminRecordSelect, selector.value); return; }
    const field = event.target.closest?.('[data-admin-field]');
    if (!field) return;
    const area = field.dataset.adminArea;
    const rowIndex = Number(field.dataset.adminRowIndex);
    const key = field.dataset.adminField;
    if (!AREA_ORDER.includes(area) || !Number.isInteger(rowIndex) || !draft[area][rowIndex] || isProtectedField(key)) return;
    draft[area][rowIndex][key] = readField(field);
    const saveButton = root.querySelector('[data-admin-action="save-area"][data-admin-area="' + area + '"]');
    if (saveButton) saveButton.disabled = !isDirty(area);
    const panel = root.querySelector('#admin-panel-' + area);
    const count = panel?.querySelector('.admin-count small');
    if (count) count.textContent = '有未儲存草稿';
  });
  root.addEventListener('input', (event) => {
    const field = event.target.closest?.('[data-admin-field]');
    if (!field) return;
    const area = field.dataset.adminArea;
    const rowIndex = Number(field.dataset.adminRowIndex);
    const key = field.dataset.adminField;
    if (!AREA_ORDER.includes(area) || !Number.isInteger(rowIndex) || !draft[area][rowIndex] || isProtectedField(key)) return;
    draft[area][rowIndex][key] = readField(field);
    const saveButton = root.querySelector('[data-admin-action="save-area"][data-admin-area="' + area + '"]');
    if (saveButton) saveButton.disabled = !isDirty(area);
    const count = root.querySelector('#admin-panel-' + area + ' .admin-count small');
    if (count) count.textContent = '有未儲存草稿';
  });
  root.addEventListener('keydown', (event) => {
    const tab = event.target.closest?.('[data-admin-tab]');
    if (!tab) return;
    const tabs = [...root.querySelectorAll('[data-admin-tab]')];
    const index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); tabs[(index + 1) % tabs.length]?.focus(); selectArea(tabs[(index + 1) % tabs.length]?.dataset.adminTab); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); tabs[(index - 1 + tabs.length) % tabs.length]?.focus(); selectArea(tabs[(index - 1 + tabs.length) % tabs.length]?.dataset.adminTab); }
    if (event.key === 'Home') { event.preventDefault(); tabs[0]?.focus(); selectArea(tabs[0]?.dataset.adminTab); }
    if (event.key === 'End') { event.preventDefault(); tabs.at(-1)?.focus(); selectArea(tabs.at(-1)?.dataset.adminTab); }
  });
  windowObject.addEventListener?.('beforeunload', (event) => {
    if (AREA_ORDER.some(isDirty)) { event.preventDefault(); event.returnValue = ''; }
  });

  return { authorized: true, activeArea, domains: [...AREA_ORDER] };
}
