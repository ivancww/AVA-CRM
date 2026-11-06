export const OFFICIAL_GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyvGzKK5v9VEXyTeCmGUKhnVXgO6eh7Hg6FDEfwEIfsd58SCtPdNQvW21wTp9J5FfAX/exec';
export const DB_NAME = 'ava-crm-user-layer';
export const DB_VERSION = 3;
export const AI_STATES = ['draft', 'needs_confirmation', 'confirmed'];
export const INTAKE_STEPS = ['Upload', 'Document Understanding', 'Policy Grouping', 'Policy Extraction', 'Product Matching', 'Feature Matching', 'Coverage Classification', 'Conflict / Missing Data Detection', 'Human Confirmation', 'Save structured data', 'Delete temporary source'];
export const POLICY_COMPARE_FIELDS = ['insurer', 'productName', 'productVersion', 'policyNumber', 'coverageTerm', 'premium', 'paymentTerm', 'paymentFrequency', 'currency', 'status', 'issueDate', 'effectiveDate', 'sumAssured', 'sumAssuredCurrency', 'benefits'];

export function normalizeSearchName(value = '') { return String(value).normalize('NFKC').trim().toLocaleLowerCase(); }
export function createBenefit(input = {}) { return { id: input.id || crypto.randomUUID(), policyId: input.policyId || '', insuredPersonId: input.insuredPersonId || '', primaryCategory: input.primaryCategory || 'medical', benefitCategory: input.benefitCategory || input.primaryCategory || 'medical', presentationTags: input.presentationTags || [], benefitType: input.benefitType || '', amount: input.amount ?? null, limit: input.limit ?? null, currency: input.currency || '', unit: input.unit || '', benefitForm: input.benefitForm || '', metadata: input.metadata || {}, createdAt: input.createdAt || new Date().toISOString() }; }
export function dedupeBenefits(benefits) { const unique = new Map(); for (const benefit of benefits) unique.set(benefit.id, benefit); return [...unique.values()]; }
export function benefitAppearsInCategory(benefit, category) { return benefit.primaryCategory === category || (benefit.presentationTags || []).includes(category) || benefit.benefitCategory === category; }
export function categoryBenefits(benefits, category) { return dedupeBenefits(benefits.filter((benefit) => benefitAppearsInCategory(benefit, category))); }
export function coverageTotals(benefits, category) {
  const eligible = categoryBenefits(benefits, category);
  if (!eligible.length) return null;
  const aggregations = eligible.map((benefit) => benefit.metadata?.aggregation);
  const first = aggregations[0];
  if (!first?.allowed || !first.type || !first.definition || !first.semanticBasis || !eligible[0].currency || !eligible[0].unit || !eligible[0].benefitForm) return null;
  if (eligible.some((benefit, index) => {
    const aggregation = aggregations[index];
    return !aggregation?.allowed || aggregation.type !== first.type || aggregation.definition !== first.definition || aggregation.semanticBasis !== first.semanticBasis || benefit.currency !== eligible[0].currency || benefit.unit !== eligible[0].unit || benefit.benefitForm !== eligible[0].benefitForm;
  })) return null;
  const amounts = eligible.map((benefit) => Number(benefit.amount));
  return amounts.every(Number.isFinite) ? amounts.reduce((total, amount) => total + amount, 0) : null;
}
export function comparePolicy(existing = {}, extracted = {}) { return POLICY_COMPARE_FIELDS.filter((field) => JSON.stringify(existing[field] ?? null) !== JSON.stringify(extracted[field] ?? null)).map((field) => ({ field, existing: existing[field] ?? null, extracted: extracted[field] ?? null })); }
function hasConfirmedCompatibleVersion(product, version) {
  const n = normalizeSearchName;
  if (!version) return false;
  if (n(product.productVersion) === version) return true;
  const compatibleVersions = product.compatibleProductVersions || product.productVersionAliases || product.metadata?.compatibleProductVersions || [];
  return compatibleVersions.some((compatibleVersion) => n(compatibleVersion) === version);
}
export function matchProduct(products = [], query = {}) { const n = normalizeSearchName; const insurer = n(query.insurer); const product = n(query.productName); const version = n(query.productVersion); const exact = products.find((item) => n(item.insurer) === insurer && n(item.productName) === product && hasConfirmedCompatibleVersion(item, version)); if (exact) return { status: 'exact', product: exact, requiresConfirmation: false }; const candidates = products.filter((item) => n(item.insurer) === insurer && product && meaningfulProductSimilarity(n(item.productName), product)); return candidates.length ? { status: 'candidate', candidates, requiresConfirmation: true } : { status: 'none', candidates: [], requiresConfirmation: true }; }
export function meaningfulProductSimilarity(left, right) { if (!left || !right) return false; if (left === right || left.includes(right) || right.includes(left)) return true; const leftTokens = new Set(left.split(/[\s·•丨|，,()（）-]+/).filter(Boolean)); const rightTokens = new Set(right.split(/[\s·•丨|，,()（）-]+/).filter(Boolean)); return [...leftTokens].some((token) => token.length >= 2 && rightTokens.has(token)); }
export function resolveProductMatch(products = [], extracted = {}) { const result = matchProduct(products, extracted); if (result.status === 'exact') return { ...result, verifiedFeatures: result.product.features || [], customerExplanations: result.product.customerExplanations || [] }; if (result.status === 'candidate') return { ...result, candidateFeatures: [], message: 'Candidate match requires User confirmation.' }; return { ...result, candidateFeatures: extracted.features || [], message: 'No verified registry match; extracted features remain needs_confirmation.' }; }
export function createDeviceTransferPointer() { return `ava-crm-transfer:${crypto.randomUUID()}`; }
export function emptyOfficialRegistry() { return { '保障分類': [], '產品資料': [], 'Review問題': [], '頁面設定': [], '系統設定': [] }; }

export const STORE_DEFINITIONS = { households: [['byCreatedAt', 'createdAt'], ['bySearchName', 'searchName']], people: [['byHouseholdId', 'householdId']], policies: [['byHouseholdId', 'householdId'], ['byPolicyHolderId', 'policyHolderId']], policyRoles: [['byPolicyId', 'policyId'], ['byPersonId', 'personId'], ['byPolicyHolderId', 'policyHolderId'], ['byInsuredPersonId', 'insuredPersonId']], benefits: [['byPolicyId', 'policyId'], ['byPrimaryCategory', 'primaryCategory'], ['byBenefitCategory', 'benefitCategory'], ['byInsuredPersonId', 'insuredPersonId']], policyValues: [['byPolicyId', 'policyId'], ['byInsuredPersonId', 'insuredPersonId'], ['byValueType', 'valueType']], reviews: [['byHouseholdId', 'householdId'], ['byInsuredPersonId', 'insuredPersonId']], intakeDrafts: [['byHouseholdId', 'householdId'], ['byStatus', 'status']], settings: [['byKey', 'key']] };
export const STORE_NAMES = Object.keys(STORE_DEFINITIONS);

export async function openUserDatabase() { if (!('indexedDB' in globalThis)) return null; return new Promise((resolve, reject) => { const request = indexedDB.open(DB_NAME, DB_VERSION); request.onupgradeneeded = () => { const db = request.result; for (const [storeName, indexes] of Object.entries(STORE_DEFINITIONS)) { const store = db.objectStoreNames.contains(storeName) ? request.transaction.objectStore(storeName) : db.createObjectStore(storeName, { keyPath: 'id' }); for (const [name, keyPath] of indexes) if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false }); } }; request.onsuccess = () => { const db = request.result; const migration = db.transaction('households', 'readwrite'); const cursorRequest = migration.objectStore('households').openCursor(); cursorRequest.onsuccess = () => { const cursor = cursorRequest.result; if (!cursor) return; const value = cursor.value; const searchName = normalizeSearchName(value.searchName || value.displayName); if (value.searchName !== searchName) cursor.update({ ...value, searchName }); cursor.continue(); }; resolve(db); }; request.onerror = () => reject(request.error); }); }
export async function saveLocal(db, storeName, value) { if (!db) return false; return new Promise((resolve, reject) => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(value); tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); }); }
export async function queryByIndex(db, storeName, indexName, value) { if (!db) return []; return new Promise((resolve, reject) => { const tx = db.transaction(storeName, 'readonly'); const request = tx.objectStore(storeName).index(indexName).getAll(IDBKeyRange.only(value)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
export async function getById(db, storeName, id) { if (!db) return null; return new Promise((resolve, reject) => { const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(id); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error); }); }
export async function queryIndexPrefix(db, storeName, indexName, prefix, limit = 50) { if (!db) return []; return new Promise((resolve, reject) => { const output = []; const tx = db.transaction(storeName, 'readonly'); const request = tx.objectStore(storeName).index(indexName).openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`)); request.onsuccess = () => { const cursor = request.result; if (!cursor || output.length >= limit) return resolve(output); output.push(cursor.value); cursor.continue(); }; request.onerror = () => reject(request.error); }); }
export function relevantPolicyIds(roles = [], insuredPersonId) { return [...new Set(roles.filter((role) => role.insuredPersonId === insuredPersonId).map((role) => role.policyId).filter(Boolean))]; }
export async function loadInsuredPersonData(db, insuredPersonId) { const roles = await queryByIndex(db, 'policyRoles', 'byInsuredPersonId', insuredPersonId); const policyIds = relevantPolicyIds(roles, insuredPersonId); const policies = (await Promise.all(policyIds.map((policyId) => getById(db, 'policies', policyId)))).filter(Boolean); const benefits = (await Promise.all(policyIds.map((policyId) => queryByIndex(db, 'benefits', 'byPolicyId', policyId)))).flat(); const values = (await Promise.all(policyIds.map((policyId) => queryByIndex(db, 'policyValues', 'byPolicyId', policyId)))).flat(); return { roles, policies, benefits: dedupeBenefits(benefits.filter((benefit) => !benefit.insuredPersonId || benefit.insuredPersonId === insuredPersonId)), values: values.filter((value) => !value.insuredPersonId || value.insuredPersonId === insuredPersonId) }; }
export async function exportUserLayer(db) { if (!db) return null; const data = {}; for (const storeName of STORE_NAMES) data[storeName] = await new Promise((resolve, reject) => { const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); return { app: 'AVA-CRM', schemaVersion: DB_VERSION, exportedAt: new Date().toISOString(), data }; }
export function validateUserLayerExport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('資料檔格式無效');
  if (payload.app !== 'AVA-CRM') throw new Error('資料檔不是 AVA-CRM');
  if (payload.schemaVersion !== DB_VERSION) throw new Error('資料檔版本不受支援');
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) throw new Error('資料檔結構無效');
  const keys = Object.keys(payload.data); if (keys.length !== STORE_NAMES.length || keys.some((key) => !STORE_NAMES.includes(key))) throw new Error('資料檔缺少必要資料區域');
  for (const storeName of STORE_NAMES) if (!Array.isArray(payload.data[storeName]) || payload.data[storeName].some((record) => !record || typeof record !== 'object' || Array.isArray(record))) throw new Error('資料檔內容無效');
  return payload;
}

export async function restoreUserLayer(db, payload) {
  validateUserLayerExport(payload); if (!db) throw new Error('本機資料庫不可用');
  return new Promise((resolve, reject) => { let settled = false; const finish = (fn, value) => { if (settled) return; settled = true; fn(value); }; let tx; try { tx = db.transaction(STORE_NAMES, 'readwrite'); } catch (error) { finish(reject, error); return; }
    tx.oncomplete = () => finish(resolve, true); tx.onerror = () => finish(reject, tx.error || new Error('資料檔恢復失敗')); tx.onabort = () => finish(reject, tx.error || new Error('資料檔恢復失敗'));
    try { for (const storeName of STORE_NAMES) { const store = tx.objectStore(storeName); store.clear(); for (const record of payload.data[storeName]) store.add(record); } } catch (error) { try { tx.abort(); } catch (_) {} finish(reject, error); }
  });
}

export async function saveUserLayerMutation({ db, storeName, value, fileHandle, exportFn = exportUserLayer, saveFn = saveLocal }) { const saved = await saveFn(db, storeName, value); if (!saved) return { saved: false, fileSync: 'unavailable' }; if (!fileHandle) return { saved: true, fileSync: 'pending' }; try { const writable = await fileHandle.createWritable(); await writable.write(JSON.stringify(await exportFn(db), null, 2)); await writable.close(); return { saved: true, fileSync: 'synced' }; } catch { return { saved: true, fileSync: 'unavailable' }; } }
export async function loadOfficialRegistry(fetchImpl = fetch, storage = localStorage) { const cacheKey = 'ava-crm-official-registry-v3'; try { const response = await fetchImpl(OFFICIAL_GAS_ENDPOINT, { headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error(`Official registry request failed: ${response.status}`); const payload = await response.json(); storage.setItem(cacheKey, JSON.stringify({ savedAt: new Date().toISOString(), payload })); return { source: 'official', payload }; } catch { try { const cached = JSON.parse(storage.getItem(cacheKey) || 'null'); if (cached?.payload) return { source: 'official-cache', payload: cached.payload }; } catch { /* safe fallback */ } return { source: 'built-in-fallback', payload: emptyOfficialRegistry() }; } }

// Confirmed policy groups are written in a single transaction. No extraction
// payload or original document is accepted by this interface.
export function preparePolicyGroup(input, makeId = () => crypto.randomUUID()) {
  const text = (v) => String(v ?? '').trim();
  const amount = (v, label) => {
    if (v == null || String(v).trim() === '') return null;
    const value = Number(String(v).replace(/,/g, ''));
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label}無效`);
    return value;
  };
  const householdId = text(input.householdId), holder = text(input.policyHolderId);
  const insured = [...new Set((input.insuredPersonIds || []).map(text).filter(Boolean))];
  const insurer = text(input.insurer), productName = text(input.productName), policyNumber = text(input.policyNumber);
  if (!householdId || !holder || !insured.length || !insurer || !productName || !policyNumber) throw new Error('請填妥客戶、持有人、被保人、保險公司、產品及保單號碼');
  const date = (value, label) => { const result = text(value); if (!result) return ''; const parsed = new Date(`${result}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) throw new Error(`${label}請用 YYYY-MM-DD`); return result; };
  const premium = amount(input.premium, '保費');
  const currency = text(input.currency).toUpperCase();
  const frequencyInput = text(input.paymentFrequency);
  const frequencyAliases = { '年繳':'annual', '每年':'annual', 'annual':'annual', 'yearly':'annual', '月繳':'monthly', '每月':'monthly', 'monthly':'monthly', '季繳':'quarterly', 'quarterly':'quarterly', '半年繳':'semiannual', 'semiannual':'semiannual', '躉繳':'single', 'single':'single' };
  const frequency = frequencyAliases[frequencyInput.toLowerCase()] || frequencyInput;
  if (premium !== null && (!currency || !frequency)) throw new Error('保費需要填寫貨幣及繳費頻率');
  const id = makeId(), now = new Date().toISOString();
  const policy = { id, householdId, policyHolderId: holder, insurer, productName, productVersion: text(input.productVersion), policyNumber,
    status: text(input.status), issueDate: date(input.issueDate, '簽發日期'), effectiveDate: date(input.effectiveDate, '生效日期'),
    premium, currency, paymentFrequency: frequency,
    paymentTerm: text(input.paymentTerm), coverageTerm: text(input.coverageTerm), sumAssured: amount(input.sumAssured, '保障額'), sumAssuredCurrency: text(input.sumAssuredCurrency).toUpperCase(),
    riders: (input.riders || []).map(text).filter(Boolean), createdAt: now };
  const roles = insured.map((personId) => ({ id: makeId(), policyId: id, personId, policyHolderId: holder, insuredPersonId: personId, createdAt: now }));
  const benefits = (input.benefits || []).map((b) => {
    const personId = text(b.insuredPersonId), category = text(b.primaryCategory), type = text(b.benefitType);
    if (!insured.includes(personId) || !category || !type) throw new Error('保障項目需要指定被保人、分類及名稱');
    return createBenefit({ id: makeId(), policyId: id, insuredPersonId: personId, primaryCategory: category, benefitCategory: category,
      benefitType: type, amount: amount(b.amount, '保障金額'), limit: text(b.limit), currency: text(b.currency).toUpperCase(), unit: text(b.unit), benefitForm: text(b.benefitForm), metadata: { classificationConfirmed: true, notes: text(b.notes) }, createdAt: now });
  });
  const values = (input.values || []).map((v) => {
    const personId = text(v.insuredPersonId), valueType = text(v.valueType);
    if (!insured.includes(personId) || !['current_policy_cash_value', 'guaranteed_value', 'non_guaranteed_value'].includes(valueType)) throw new Error('現金價值需要指定被保人及種類');
    const n = amount(v.amount, '現金價值'); if (n === null) throw new Error('請輸入現金價值');
    return { id: makeId(), policyId: id, insuredPersonId: personId, valueType, amount: n, currency: text(v.currency).toUpperCase(), yearOrAge: text(v.yearOrAge), createdAt: now };
  });
  return { policy, roles, benefits, values, personIds: [...new Set([holder, ...insured])] };
}

export function policyDuplicateKey(policy) {
  const normalize = (v) => String(v || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, '');
  return normalize(policy.insurer) && normalize(policy.policyNumber) ? `${normalize(policy.insurer)}\u0000${normalize(policy.policyNumber)}` : '';
}

export async function saveConfirmedPolicy(db, group, { acknowledgeOtherHousehold = false } = {}) {
  if (!db || !group?.policy || !group.roles?.length) throw new Error('本機資料庫或保單資料不可用');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['households', 'people', 'policies', 'policyRoles', 'benefits', 'policyValues'], 'readwrite');
    let reason = null, household, people, policies, remaining = 3;
    const fail = (message) => { reason = new Error(message); try { tx.abort(); } catch (_) {} };
    tx.oncomplete = () => resolve(group.policy.id);
    tx.onabort = tx.onerror = () => reject(reason || tx.error || new Error('本機保存失敗'));
    const check = () => {
      if (--remaining) return;
      try {
        if (!household || group.personIds.some((id) => !people.some((person) => person.id === id && person.householdId === household.id))) return fail('客戶或人物關係無效');
        const key = policyDuplicateKey(group.policy);
        const matches = policies.filter((p) => key && policyDuplicateKey(p) === key);
        if (matches.some((p) => p.householdId === household.id)) return fail('偵測到相同保險公司及保單號碼；請查看現有保單');
        if (matches.length && !acknowledgeOtherHousehold) return fail('其他客戶可能已有相同保單；請先核對，沒有自動連結');
        tx.objectStore('policies').add(group.policy);
        for (const role of group.roles) tx.objectStore('policyRoles').add(role);
        for (const benefit of group.benefits) tx.objectStore('benefits').add(benefit);
        for (const value of group.values) tx.objectStore('policyValues').add(value);
      } catch (error) { reason = error; try { tx.abort(); } catch (_) {} }
    };
    const h = tx.objectStore('households').get(group.policy.householdId); h.onsuccess = () => { household = h.result; check(); };
    const p = tx.objectStore('people').getAll(); p.onsuccess = () => { people = p.result; check(); };
    const q = tx.objectStore('policies').getAll(); q.onsuccess = () => { policies = q.result; check(); };
  });
}

export async function findPolicyDuplicates(db, candidate) {
  if (!db) throw new Error('本機資料庫不可用');
  const rows = await new Promise((resolve, reject) => { const req=db.transaction('policies','readonly').objectStore('policies').getAll(); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });
  const key=policyDuplicateKey(candidate); const matches=rows.filter(row=>key && policyDuplicateKey(row) === key);
  return { sameHousehold:matches.filter(row=>row.householdId === candidate.householdId), otherHousehold:matches.some(row=>row.householdId !== candidate.householdId) };
}
