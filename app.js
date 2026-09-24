import { AI_STATES, OFFICIAL_GAS_ENDPOINT, createDeviceTransferPointer, loadOfficialRegistry, openUserDatabase, saveLocal } from './crm-core.js';

const state = { customer: null, perception: '', category: 'medical', db: null };
const $ = (id) => document.getElementById(id);
const modal = $('modal');
let dataFileHandle = null;

function showModal(title, body, action = '') {
  $('modalBody').innerHTML = `<h2>${title}</h2><p>${body}</p>${action}`;
  modal.showModal();
}

function createCustomer() {
  const name = window.prompt('客戶姓名 / Customer name（只會保存在本機）');
  if (!name?.trim()) return;
  state.customer = { id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString() };
  const option = new Option(`${state.customer.name} · 本機客戶`, state.customer.id, true, true);
  $('customerSelect').add(option); $('insuredSelect').disabled = false; $('insuredSelect').innerHTML = `<option value="${state.customer.id}">${state.customer.name}</option>`;
  $('storageStatus').textContent = '本機已保存';
  saveLocal(state.db, 'clients', state.customer);
  requestDataFileLocation();
}

async function requestDataFileLocation() {
  if (!window.showSaveFilePicker) {
    showModal('本機資料已保存', '本機 IndexedDB 已可用。此瀏覽器未提供持久化檔案選擇器，因此 AVA-CRM 不會假裝可以背景寫入資料檔；你可稍後從支援的裝置匯出。');
    return;
  }
  try {
    dataFileHandle = await window.showSaveFilePicker({ suggestedName: 'ava-crm-data.json', types: [{ description: 'AVA-CRM data', accept: { 'application/json': ['.json'] } }] });
    const writable = await dataFileHandle.createWritable();
    await writable.write(JSON.stringify({ schemaVersion: 1, app: 'AVA-CRM', note: 'Customer data remains User Layer data.' }));
    await writable.close();
    showModal('資料檔案位置已設定', '之後的本機操作會以 IndexedDB 為即時資料庫；瀏覽器是否能持續背景寫入檔案，會按平台能力處理，不會默認成功。');
  } catch (error) { if (error?.name !== 'AbortError') showModal('仍可使用本機資料', '你取消了資料檔案位置選擇。資料仍留在本機 IndexedDB，並未上傳；日後可再次設定。'); }
}

function selectCustomer(event) {
  const selected = event.target.value;
  if (!selected) { $('insuredSelect').disabled = true; return; }
  state.customer = selected === 'demo' ? { id: 'demo', name: '陳小明' } : state.customer;
  $('insuredSelect').disabled = false; $('insuredSelect').innerHTML = `<option value="${state.customer.id}">${state.customer.name}（本人）</option>`;
}

function selectPerception(event) {
  document.querySelectorAll('.perception-option').forEach((button) => { const active = button === event.currentTarget; button.setAttribute('aria-pressed', String(active)); if (active) state.perception = button.dataset.perception; });
  $('startReviewBtn').disabled = !state.customer || !state.perception;
}

function selectCategory(event) {
  const copy = { medical: ['醫療保障', '住院、手術、住院現金與意外醫療會分開呈現，不把不同意義混成一個數字。', '✚'], critical: ['危疾保障', '顯示一次性賠償、持續賠償與多次賠償狀態，讓客戶知道保障何時可以再次發揮作用。', '◇'], life: ['人壽保障', '用客戶聽得明的方式理解身故保障、受保人與保單價值。', '◯'], accident: ['意外保障', '把意外身故、傷殘與意外醫療分開理解，避免與一般醫療重複計算。', '＋'] }[event.currentTarget.dataset.category];
  state.category = event.currentTarget.dataset.category;
  document.querySelectorAll('.category-tab').forEach((tab) => { const active = tab === event.currentTarget; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', String(active)); });
  $('coveragePanelTitle').textContent = copy[0]; $('coveragePanelCopy').textContent = copy[1]; document.querySelector('.category-icon').textContent = copy[2];
}

function startReview() {
  $('progressFill').style.setProperty('--ava-visual-value', '36%');
  showModal('Review 已開始', `已記錄「${state.perception}」。下一步可逐一查看 ${state.customer.name} 的實際保障，並保留客戶自己的選擇。`, '<button class="ava-button ava-button--primary" id="modalContinue">繼續了解保障</button>');
  $('modalContinue').onclick = () => { modal.close(); document.querySelector('.category-section').scrollIntoView({ behavior: 'smooth' }); };
  saveLocal(state.db, 'reviews', { id: crypto.randomUUID(), customerId: state.customer.id, perception: state.perception, status: 'draft', createdAt: new Date().toISOString() });
}

function aiIntake() {
  showModal('AI 加入保單', '上載前請注意：PDF / 圖片只作臨時處理，最多 10 個檔案；原始檔案不會保存，處理完成後會清除。AI 結果必須經你確認，才會成為正式 CRM 資料。', '<label class="ava-button ava-button--secondary" for="policyFiles">選擇 PDF / 圖片</label><input id="policyFiles" type="file" accept="application/pdf,image/*" multiple hidden><p class="ava-support">流程：Upload → Document Understanding → Policy Grouping → Extraction → Matching → Conflict Detection → Human Confirmation</p>');
  $('policyFiles').onchange = (event) => { if (event.target.files.length > 10) { event.target.value = ''; showModal('檔案數量超過上限', '每批最多 10 個上載項目。'); return; } showModal('等待人手確認', `已暫存 ${event.target.files.length} 個處理項目。狀態：${AI_STATES.join(' → ')}。正式儲存前不會寫入政策資料，臨時原始檔案亦會清除。`); };
}

function deviceTransfer() { showModal('裝置轉移', 'QR 只會包含安全轉移指標，不會暴露客戶姓名、保單、保障或其他原始資料。正式轉移服務會由 AVA Platform 安全服務驗證。', `<code>${createDeviceTransferPointer()}</code><p class="ava-support">目前狀態：架構預留，尚未連接轉移後端。</p>`); }

$('modalClose').onclick = () => modal.close(); $('addCustomerBtn').onclick = createCustomer; $('customerSelect').onchange = selectCustomer; $('aiPolicyBtn').onclick = aiIntake; $('deviceTransferBtn').onclick = deviceTransfer; $('startReviewBtn').onclick = startReview;
$('manualPolicyBtn').onclick = () => showModal('手動加入保單', '手動輸入會建立本機草稿，之後仍需確認才會成為正式政策資料。');
document.querySelectorAll('.perception-option').forEach((button) => button.addEventListener('click', selectPerception)); document.querySelectorAll('.category-tab').forEach((tab) => tab.addEventListener('click', selectCategory));

openUserDatabase().then((db) => { state.db = db; $('storageStatus').textContent = db ? '本機已就緒' : '瀏覽器不支援本機資料庫'; }).catch(() => { $('storageStatus').textContent = '本機資料庫錯誤'; });
loadOfficialRegistry().then((result) => { document.body.dataset.officialSource = result.source; }).catch(() => { document.body.dataset.officialSource = 'built-in-fallback'; });
window.addEventListener('beforeunload', () => state.db?.close());
console.info('AVA-CRM official configuration endpoint (read-only):', OFFICIAL_GAS_ENDPOINT);
