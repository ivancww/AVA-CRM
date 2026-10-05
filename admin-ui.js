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

export function createAdminClient({ fetchImpl = globalThis.fetch, endpoint = OFFICIAL_GAS_ENDPOINT } = {}) {
  // Deliberately private closure state. No browser storage or URL state is used.
  let appGrant = '';
  let grantExpiresAt = 0;

  async function request(body) {
    const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    let payload;
    try { payload = await response.json(); } catch (_) { throw new Error('CRM Admin 回應無效。'); }
    if (!response.ok || payload.success !== true) throw new Error(payload.error || 'CRM Admin request failed');
    return payload;
  }

  return Object.freeze({
    async exchangeLaunch(launchTicket) {
      if (!launchTicket || typeof launchTicket !== 'string' || launchTicket.length > 200) throw new Error('Admin launch ticket 無效。');
      const payload = await request({ action: 'exchangeAppLaunch', launchTicket });
      if (!payload.appGrant || !payload.expiresAt) throw new Error('CRM Admin authorization 未完成。');
      const expiry = Date.parse(payload.expiresAt);
      if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('CRM Admin authorization 已過期。');
      appGrant = String(payload.appGrant);
      grantExpiresAt = expiry;
      return { success: true, expiresAt: payload.expiresAt };
    },
    async saveOfficialArea(area, rows) {
      const operation = ADMIN_AREA_OPERATIONS[area];
      if (!operation) throw new Error('Official area 不在固定 allowlist。');
      if (!appGrant || grantExpiresAt <= Date.now()) throw new Error('CRM Admin authorization 已失效，請由 AVA Studio 重新進入。');
      return request({ action: 'replaceOfficialArea', operation, appGrant, rows });
    }
  });
}

function renderDenied({ documentObject, reason }) {
  documentObject.body.dataset.avaMode = 'admin-denied';
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
  const client = createAdminClient({ fetchImpl, endpoint });
  if (!ticket) { renderDenied({ documentObject, reason: '缺少 AVA Studio launch ticket。' }); return { authorized: false, reason: 'missing-ticket' }; }
  try { await client.exchangeLaunch(ticket); } catch (error) { renderDenied({ documentObject, reason: error.message }); return { authorized: false, reason: error.message }; }

  let response; let payload;
  try {
    response = await fetchImpl(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    try { payload = await response.json(); } catch (_) { payload = null; }
  } catch (_) {
    renderDenied({ documentObject, reason: 'Official data 載入失敗；沒有初始化空白資料。' });
    return { authorized: false, reason: 'official-fetch-failed' };
  }
  if (!response.ok || payload?.success !== true || !payload.data || typeof payload.data !== 'object') { renderDenied({ documentObject, reason: 'Official data 載入失敗；沒有初始化空白資料。' }); return { authorized: false, reason: 'official-fetch-failed' }; }

  const official = Object.fromEntries(AREA_ORDER.map((area) => [area, Array.isArray(payload.data[area]) ? clone(payload.data[area]) : []]));
  const draft = clone(official); let activeArea = AREA_ORDER[0];
  const header = documentObject.querySelector('#agentHeader');
  documentObject.querySelector('main')?.setAttribute('hidden', ''); documentObject.querySelector('footer')?.setAttribute('hidden', '');
  header?.classList.add('admin-header');
  const returnLink = documentObject.querySelector('#returnAvaLink'); if (returnLink) { returnLink.href = 'https://ivancww.github.io/avaplatform/'; returnLink.textContent = '← 返回 AVA / AVA Studio'; }
  const root = documentObject.createElement('main'); root.id = 'adminRoot'; root.className = 'ava-front__container admin-root';
  root.innerHTML = `<section class="admin-intro"><div><p class="eyebrow">AVA STUDIO · CRM</p><h1 class="ava-front__title">Official Configuration</h1><p class="ava-support">只管理 CRM Official Defaults / Registry；客戶、保單、User Overrides 及本機資料不在此介面。</p></div><span class="step-badge">Admin / Official Configuration</span></section><div class="admin-layout"><nav class="admin-nav" aria-label="CRM Official areas">${AREA_ORDER.map((area) => `<button type="button" data-admin-area="${area}">${area}</button>`).join('')}</nav><section class="ava-card admin-editor" aria-live="polite"><div class="admin-editor-heading"><div><p class="eyebrow" id="adminAreaEyebrow"></p><h2 id="adminAreaTitle"></h2><p class="ava-support" id="adminAreaDescription"></p></div><span class="soft-label">Official Cloud</span></div><div id="adminRows" class="admin-rows"></div><div class="admin-actions"><button type="button" class="ava-button ava-button--secondary" id="adminAddRow">＋ 新增記錄</button><button type="button" class="ava-button ava-button--secondary" id="adminReview">Review / Preview changes</button><button type="button" class="ava-button ava-button--primary" id="adminSave" disabled>Save Official</button></div><div id="adminStatus" class="admin-status" role="status"></div></section></div></main>`;
  documentObject.body.append(root);
  const rowsElement = root.querySelector('#adminRows'); const statusElement = root.querySelector('#adminStatus'); const saveButton = root.querySelector('#adminSave');
  const descriptions = { '頁面設定': '管理 CRM 頁面標題、步驟及展示設定。', 'Review問題': '管理 Customer Review 的問題與選項。', '保障分類': '管理保障類別及對應呈現規則。', '產品資料': '管理 Product Feature Registry 及官方產品資料。', '系統設定': '管理 CRM Official system defaults。' };
  function setStatus(text, type = '') { statusElement.textContent = text; statusElement.dataset.state = type; }
  function headersFor(area) { return draft[area].length ? Object.keys(draft[area][0]) : []; }
  function renderRows() {
    const headers = headersFor(activeArea); root.querySelector('#adminAreaEyebrow').textContent = `OFFICIAL AREA · ${AREA_ORDER.indexOf(activeArea) + 1}`; root.querySelector('#adminAreaTitle').textContent = activeArea; root.querySelector('#adminAreaDescription').textContent = descriptions[activeArea];
    rowsElement.replaceChildren();
    if (!headers.length) { rowsElement.innerHTML = '<div class="empty-state"><strong>目前沒有可編輯記錄</strong><span>為避免猜測 Official schema，請先由現有 Official data 提供至少一行結構化資料。</span></div>'; return; }
    draft[activeArea].forEach((row, rowIndex) => { const card = documentObject.createElement('article'); card.className = 'admin-row-card'; const title = documentObject.createElement('h3'); title.textContent = `記錄 ${rowIndex + 1}`; card.append(title); const grid = documentObject.createElement('div'); grid.className = 'admin-field-grid'; headers.forEach((header) => { const label = documentObject.createElement('label'); label.className = 'ava-field'; const caption = documentObject.createElement('span'); caption.className = 'ava-label'; caption.textContent = header; const input = documentObject.createElement(typeof row[header] === 'string' && String(row[header]).length > 100 ? 'textarea' : 'input'); input.value = fieldValue(row[header]); input.dataset.header = header; input.dataset.rowIndex = rowIndex; if (typeof row[header] === 'boolean') { input.type = 'checkbox'; input.checked = row[header]; } else { input.type = 'text'; } input.addEventListener('input', () => { draft[activeArea][rowIndex][header] = valueFromInput(input, row[header]); saveButton.disabled = true; }); label.append(caption, input); grid.append(label); }); card.append(grid); const remove = documentObject.createElement('button'); remove.type = 'button'; remove.className = 'ava-button ava-button--subtle'; remove.textContent = '刪除這行'; remove.addEventListener('click', () => { draft[activeArea].splice(rowIndex, 1); saveButton.disabled = true; renderRows(); setStatus('已有未保存變更。請先 Review / Preview。'); }); card.append(remove); rowsElement.append(card); });
  }
  function selectArea(area) { if (!AREA_ORDER.includes(area)) return; activeArea = area; root.querySelectorAll('[data-admin-area]').forEach((button) => button.classList.toggle('is-active', button.dataset.adminArea === area)); saveButton.disabled = true; renderRows(); setStatus('已載入目前 Official data；尚未保存任何修改。'); }
  root.querySelectorAll('[data-admin-area]').forEach((button) => button.addEventListener('click', () => selectArea(button.dataset.adminArea)));
  root.querySelector('#adminAddRow').addEventListener('click', () => { const headers = headersFor(activeArea); if (!headers.length) return setStatus('未能新增：Official schema 未知，系統不會猜測欄位。', 'error'); draft[activeArea].push(Object.fromEntries(headers.map((header) => [header, '']))); saveButton.disabled = true; renderRows(); setStatus('已有未保存變更。請先 Review / Preview。'); });
  root.querySelector('#adminReview').addEventListener('click', () => { const headers = headersFor(activeArea); const problems = validateOfficialRows(draft[activeArea], headers); if (problems.length) { saveButton.disabled = true; setStatus(`Review 未通過：${problems.join(' ')}`, 'error'); return; } const changed = JSON.stringify(draft[activeArea]) !== JSON.stringify(official[activeArea]); saveButton.disabled = !changed; setStatus(changed ? `Review 通過：${activeArea} 將替換 ${draft[activeArea].length} 行 Official records。再次按 Save Official 才會送出。` : '沒有變更；未有 Official write。', changed ? 'ready' : ''); });
  saveButton.addEventListener('click', async () => { const headers = headersFor(activeArea); const problems = validateOfficialRows(draft[activeArea], headers); if (problems.length) return setStatus(`Save blocked：${problems.join(' ')}`, 'error'); saveButton.disabled = true; setStatus('正在透過 CRM backend 驗證並保存…'); try { await client.saveOfficialArea(activeArea, clone(draft[activeArea])); official[activeArea] = clone(draft[activeArea]); setStatus(`已保存 ${activeArea}；共 ${official[activeArea].length} 行。`, 'success'); } catch (error) { saveButton.disabled = false; setStatus(`Save 失敗：${error.message}。未保存的 UI 變更仍然保留。`, 'error'); } });
  selectArea(activeArea);
  return { authorized: true };
}
