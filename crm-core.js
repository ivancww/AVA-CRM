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
// A display-only arithmetic sum, never an implied surrender or withdrawal value.
export const ACCUMULATED_VALUE_TYPES = ['annual_dividend', 'terminal_dividend', 'cash_value', 'reversionary_bonus'];
export function accumulatedValueTotal(values = []) {
  const parts = ACCUMULATED_VALUE_TYPES.map(type => values.filter(v => v.valueType === type));
  if (parts.some(rows => rows.length !== 1)) return { complete: false, total: null };
  const rows = parts.map(rows => rows[0]);
  if (rows.some(v => v.verified !== true || v.amount === null || v.amount === undefined || String(v.amount).trim() === '' || !Number.isFinite(Number(v.amount)) || Number(v.amount) < 0 || !v.currency || !v.valuationDate)) return { complete: false, total: null };
  const first = rows[0];
  if (rows.some(v => v.currency !== first.currency || v.valuationDate !== first.valuationDate || (v.conditions || '') !== (first.conditions || '') || (v.insuredPersonId || '') !== (first.insuredPersonId || '') || (v.policyId || '') !== (first.policyId || ''))) return { complete: false, total: null };
  return { complete: true, total: rows.reduce((n, v) => n + Number(v.amount), 0), currency: first.currency, valuationDate: first.valuationDate };
}

export function comparePolicy(existing = {}, extracted = {}) { return POLICY_COMPARE_FIELDS.filter((field) => JSON.stringify(existing[field] ?? null) !== JSON.stringify(extracted[field] ?? null)).map((field) => ({ field, existing: existing[field] ?? null, extracted: extracted[field] ?? null })); }
// Official rows are descriptions, not proof of an individual contract's terms.
export function matchProduct(products = [], query = {}) {
  const n = normalizeSearchName, insurer = n(query.insurer), name = n(query.productName);
  if (!insurer || !name) return {status:'none', candidates:[], requiresConfirmation:true};
  const rows = products.filter(row => n(row.insurer ?? row['保險公司']) === insurer && n(row.productName ?? row['產品名稱']) === name && !['否','false','0','no'].includes(n(row.enabled ?? row['啟用'] ?? '')));
  if (!rows.length) return {status:'none', candidates:[], requiresConfirmation:true};
  return {status:'exact', product:rows[0], rows, requiresConfirmation:false};
}
export function meaningfulProductSimilarity(left, right) { return Boolean(left && right && normalizeSearchName(left) === normalizeSearchName(right)); }
export function resolveProductMatch(products = [], extracted = {}) {
  const result=matchProduct(products,extracted);
  if(result.status!=='exact') return {...result, officialFeatures:[], verifiedFeatures:[], customerExplanations:[], categories:[]};
  const distinct = list => [...new Set(list.map(v=>String(v ?? '').trim()).filter(Boolean))];
  const entries=result.rows.map(row=>({category:String(row.category ?? row['分類'] ?? '').trim(), feature:String(row.feature ?? row['保障特點'] ?? '').trim(), explanation:String(row.explanation ?? row['簡單解釋'] ?? '').trim(), version:String(row.productVersion ?? row['產品版本'] ?? '').trim(), status:String(row.dataStatus ?? row.verificationStatus ?? row['資料狀態'] ?? '').trim(), source:'Official 產品資料'}));
  const values=key => distinct(entries.map(e=>e[key]));
  return {...result, entries, categories:values('category'), officialFeatures:distinct(entries.map(e=>e.feature).concat(result.rows.flatMap(row=>Array.isArray(row.features)?row.features:[]))), customerExplanations:distinct(entries.map(e=>e.explanation).concat(result.rows.flatMap(row=>Array.isArray(row.customerExplanations)?row.customerExplanations:[]))), verifiedFeatures:distinct(entries.filter(e=>['verified','confirmed','已核實','已確認'].includes(normalizeSearchName(e.status))).map(e=>e.feature))};
}

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
    protectionScope: text(input.protectionScope),
    officialProductInfo: input.officialProduct?.status === 'exact' ? { source:'Official 產品資料', entries:(input.officialProduct.entries || []).map(e=>({category:text(e.category), feature:text(e.feature), explanation:text(e.explanation), version:text(e.version), status:text(e.status)})) } : null,
    riders: (input.riders || []).map(text).filter(Boolean),
    contracts: (input.contracts || []).map((c, index) => {
      const personId = text(c.insuredPersonId);
      if (personId && !insured.includes(personId)) throw new Error('附加契約受保人不屬於此保單');
      return { contractId: text(c.contractId) || `rider-${index+1}`, name: text(c.name), insuredPersonId: personId, category: text(c.category), premium: amount(c.premium,'附加契約保費'), premiumCurrency: text(c.premiumCurrency).toUpperCase(), paymentFrequency: text(c.paymentFrequency), sumAssured: amount(c.sumAssured,'附加契約保障額'), currency: text(c.currency).toUpperCase(), effectiveDate: date(c.effectiveDate,'附加契約生效日期'), paidUpDate: date(c.paidUpDate,'附加契約繳清日期'), paymentTerm: text(c.paymentTerm), coverageTerm: text(c.coverageTerm), protectionScope: text(c.protectionScope), annualDeductible: text(c.annualDeductible), annualLimit: text(c.annualLimit), lifetimeLimit: text(c.lifetimeLimit), limitsVerified: c.limitsVerified === true, source: text(c.source) };
    }), hiddenContractualData: Array.isArray(input.hiddenContractualData) ? input.hiddenContractualData.map(b => ({ name:text(b.name), category:text(b.category), notes:text(b.notes), amount:amount(b.amount,'保障金額'), currency:text(b.currency), limit:text(b.limit) })) : [], createdAt: now };
  const roles = insured.map((personId) => ({ id: makeId(), policyId: id, personId, policyHolderId: holder, insuredPersonId: personId, createdAt: now }));
  const benefits = (input.benefits || []).map((b) => {
    const personId = text(b.insuredPersonId), category = text(b.primaryCategory), type = text(b.benefitType);
    if (!insured.includes(personId) || !category || !type) throw new Error('保障項目需要指定被保人、分類及名稱');
    const linkedContract = b.contractId && (input.contracts || []).find(c => c.contractId === b.contractId);
    if (b.contractId && !linkedContract) throw new Error('保障所屬附加契約無效');
    if (linkedContract?.insuredPersonId && linkedContract.insuredPersonId !== personId) throw new Error('保障與附加契約的受保人不一致');
    return createBenefit({ id: makeId(), policyId: id, insuredPersonId: personId, primaryCategory: category, benefitCategory: category,
      benefitType: type, amount: amount(b.amount, '保障金額'), limit: text(b.limit), currency: text(b.currency).toUpperCase(), unit: text(b.unit), benefitForm: text(b.benefitForm), presentationTags: [...new Set((b.presentationTags || []).map(text).filter(x => ['medical','critical','life','accident','savings','other'].includes(x)))], metadata: { classificationConfirmed: true, notes: text(b.notes), contractId: text(b.contractId), extractedCategory: text(b.extractedCategory), verifiedScenario: confirmedPayoutScenario(b,id) }, createdAt: now });
  });
  const values = (input.values || []).filter(v => v.amount != null && String(v.amount).trim() !== '').map((v) => {
    const personId = text(v.insuredPersonId), valueType = text(v.valueType);
    if (!insured.includes(personId) || !['current_policy_cash_value', 'guaranteed_value', 'non_guaranteed_value', 'cash_reserve', 'annual_dividend', 'terminal_dividend', 'cash_value', 'reversionary_bonus', 'net_policy_value'].includes(valueType)) throw new Error('現金價值需要指定被保人及種類');
    const n = amount(v.amount, '現金價值'); if (n === null) throw new Error('請輸入現金價值');
    return { id: makeId(), policyId: id, insuredPersonId: personId, valueType, amount: n, currency: text(v.currency).toUpperCase(), yearOrAge: text(v.yearOrAge), source: text(v.source) || 'agent_confirmed', valuationDate: date(v.valuationDate, '估值日期'), verified: v.verified === true, conditions: text(v.conditions), includesComponents: Array.isArray(v.includesComponents) ? v.includesComponents.map(text).filter(Boolean) : [], createdAt: now };
  });
  const newPeople = (input.newPeople || []).map((person) => ({ id: text(person.id), householdId, name: text(person.name), relationship: text(person.relationship), createdAt: now }));
  if (newPeople.some((person) => !person.id || !person.name || !person.relationship || !insured.includes(person.id))) throw new Error('新增受保人資料不完整');
  if (new Set(newPeople.map((person) => person.id)).size !== newPeople.length) throw new Error('新增受保人重複');
  return { policy, roles, benefits, values, newPeople, personIds: [...new Set([holder, ...insured])] };
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
        const additions = group.newPeople || [];
        if (!household || additions.some(person => person.householdId !== household.id || !person.name || !person.relationship)) return fail('客戶或人物關係無效');
        const keys = new Set();
        for (const person of additions) {
          const key = normalizeSearchName(person.name).replace(/\s+/g, '');
          if (!key || keys.has(key) || people.some(p => p.id === person.id || (p.householdId === household.id && normalizeSearchName(p.name).replace(/\s+/g, '') === key))) return fail('受保人名稱可能重複；請選擇現有人物或核對資料');
          keys.add(key);
        }
        if (group.personIds.some((id) => ![...people, ...additions].some((person) => person.id === id && person.householdId === household.id))) return fail('客戶或人物關係無效');
        const key = policyDuplicateKey(group.policy);
        const matches = policies.filter((p) => key && policyDuplicateKey(p) === key);
        if (matches.some((p) => p.householdId === household.id)) return fail('偵測到相同保險公司及保單號碼；請查看現有保單');
        if (matches.length && !acknowledgeOtherHousehold) return fail('其他客戶可能已有相同保單；請先核對，沒有自動連結');
        for (const person of additions) tx.objectStore('people').add(person);
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

// Confirmation is bound to identity, contract and displayed financial facts.
export function payoutReviewSignature(b) {
  return JSON.stringify([b.insuredPersonId || '',b.contractId || '',b.primaryCategory || '',b.benefitType || '',String(b.amount ?? ''),b.currency || '',b.payoutScenario || null]);
}
function confirmedPayoutScenario(b, policyId) {
  const q=b.payoutScenario;
  if (!q || !b.payoutReviewSignature || b.payoutReviewSignature !== payoutReviewSignature(b)) return null;
  const scenario={scenarioId:`${policyId}:${q.scenarioId || ''}`,label:String(q.label || '').trim(),date:String(q.date || '').trim(),currency:String(q.currency || '').trim().toUpperCase(),rule:{verified:true,source:String(q.source || '').trim(),currency:String(q.currency || '').trim().toUpperCase(),startDate:String(q.startDate || '').trim(),endDate:String(q.endDate || '').trim(),relationship:String(q.relationship || '').trim(),payableAmount:q.payableAmount,sharedGroup:String(q.sharedGroup || '').trim(),sharedRule:String(q.sharedRule || '').trim()}};
  if (!q.scenarioId || !scenario.label || !scenario.rule.source || !Number.isInteger(q.sourcePage) || q.sourcePage < 1 || String(q.sourceExcerpt || '').trim().length < 20 || !scenario.currency || !scenario.date || String(b.currency || '').trim().toUpperCase() !== scenario.currency) return null;
  scenario.rule.evidence={page:q.sourcePage, excerpt:String(q.sourceExcerpt).trim()};
  return scenario;
}
// Scenario amounts are payable amounts established for the same event, not face amounts.
// Unknown interactions, dates, currencies and reimbursement expenses block a total.
export function scenarioPayout(items, scenario = {}) {
  const day = String(scenario.date || '');
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (!validDate(day) || !scenario.currency || !Array.isArray(items) || !items.length) return { total: null, reason: 'insufficient_scenario' };
  let total = 0; const groups = new Map();
  for (const item of items) {
    if (item.verified !== true || !item.source || item.currency !== scenario.currency || !validDate(item.startDate) || !validDate(item.endDate) || item.endDate < item.startDate) return { total: null, reason: 'unverified_terms' };
    if (day < item.startDate || day > item.endDate) continue;
    if (item.relationship === 'reimbursement') return { total: null, reason: 'reimbursement_not_additive' };
    if (item.payableAmount == null || String(item.payableAmount).trim() === '' || !Number.isFinite(Number(item.payableAmount)) || Number(item.payableAmount) < 0) return { total: null, reason: 'missing_amount' };
    const amount = Number(item.payableAmount);
    if (item.relationship === 'additional') total += amount;
    else if (item.relationship === 'shared' && item.sharedGroup && item.sharedRule === 'maximum') groups.set(item.sharedGroup, Math.max(groups.get(item.sharedGroup) || 0, amount));
    else return { total: null, reason: 'unknown_relationship' };
  }
  for (const amount of groups.values()) total += amount;
  return { total, currency: scenario.currency };
}

export function medicalContractsForPerson(policies, personId) {
  if (!personId) return [];
  return (policies || []).flatMap(policy => (policy.contracts || [])
    .filter(contract => contract.insuredPersonId === personId && contract.category === 'medical' && !/免付保費|豁免保費|waiver\s+of\s+premium/i.test(contract.name || ''))
    .map(contract => ({ policyId: policy.id, policyName: policy.productName, contractId: contract.contractId, name: contract.name, ...(contract.limitsVerified === true ? { annualDeductible:contract.annualDeductible, annualLimit:contract.annualLimit, lifetimeLimit:contract.lifetimeLimit } : {}) })));
}

// Only evaluate one explicitly verified scenario shared by every displayed benefit.
export function verifiedCoverageScenario(benefits, personId, category) {
  const rows = categoryBenefits(benefits.filter(b => b.insuredPersonId === personId), category);
  if (!personId || !rows.length) return { total:null, reason:'missing_scenario' };
  const all = rows.map(b => b.metadata?.verifiedScenario);
  const first=all[0];
  if (!first || !first.scenarioId || !first.label || !first.date || !first.currency || all.some(x=>!x || x.scenarioId!==first.scenarioId || x.label!==first.label || x.date!==first.date || x.currency!==first.currency)) return { total:null, reason:'missing_scenario' };
  if (all.some(x=>!Number.isInteger(x.rule?.evidence?.page) || x.rule.evidence.page<1 || String(x.rule.evidence.excerpt || '').trim().length<20)) return {total:null,reason:'missing_document_evidence'};
  const result=scenarioPayout(all.map(x=>x.rule || {}),{date:first.date,currency:first.currency});
  return result.total == null ? result : {...result,label:first.label,date:first.date};
}
export function groupPolicyValues(values, policies, personId) {
  if(!personId) return [];
  const byId=new Map((policies || []).map(p=>[p.id,p])); const groups=new Map();
  for(const v of values || []) {
    if(v.insuredPersonId!==personId || !byId.has(v.policyId) || v.amount == null || String(v.amount).trim()==='' || !Number.isFinite(Number(v.amount))) continue;
    const key=JSON.stringify([v.policyId,v.currency || '',v.valuationDate || '',v.conditions || '']);
    if(!groups.has(key)) groups.set(key,{policyId:v.policyId,policyName:byId.get(v.policyId).productName || '保單待確認',currency:v.currency || '',valuationDate:v.valuationDate || '',values:[]});
    groups.get(key).values.push(v);
  }
  return [...groups.values()].map(group=>({...group,accumulated:accumulatedValueTotal(group.values)}));
}

// No labels or model-generated IDs establish cross-policy event equivalence.
// A comparison must explicitly identify every reviewed benefit and its evidence.
export function crossPolicyScenario(benefits, personId, category, comparison) {
  const rows=categoryBenefits((benefits || []).filter(b=>b.insuredPersonId===personId),category);
  if (!personId || rows.length<2 || new Set(rows.map(b=>b.policyId)).size<2 || rows.some(b=>!b.policyId || !b.id)) return {total:null,reason:'incomplete_policies'};
  if (!comparison || comparison.reviewed !== true || comparison.insuredPersonId!==personId || !comparison.event || !comparison.event.definition || !comparison.event.criteria || !comparison.event.date || !comparison.event.currency) return {total:null,reason:'unverified_event'};
  const proofs=Array.isArray(comparison.proofs) ? comparison.proofs : [];
  if (proofs.length!==rows.length || new Set(proofs.map(p=>p.benefitId)).size!==rows.length) return {total:null,reason:'incomplete_evidence'};
  const rules=[];
  for (const b of rows) {
    const proof=proofs.find(p=>p.benefitId===b.id && p.policyId===b.policyId);
    const evidence=proof?.evidence;
    if (!proof || proof.eventEquivalent !== true || proof.interactionConfirmed !== true || !evidence?.source || !Number.isInteger(evidence.page) || evidence.page<1 || String(evidence.excerpt || '').trim().length<20) return {total:null,reason:'incomplete_evidence'};
    const q=b.metadata?.verifiedScenario;
    if (!q || q.date!==comparison.event.date || q.currency!==comparison.event.currency || !q.rule?.verified || !q.rule.evidence?.page || !q.rule.evidence?.excerpt) return {total:null,reason:'unverified_terms'};
    rules.push(q.rule);
  }
  const result=scenarioPayout(rules,{date:comparison.event.date,currency:comparison.event.currency});
  return result.total==null ? result : {...result,policyIds:[...new Set(rows.map(b=>b.policyId))]};
}
