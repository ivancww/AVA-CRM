export const OFFICIAL_GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyvGzKK5v9VEXyTeCmGUKhnVXgO6eh7Hg6FDEfwEIfsd58SCtPdNQvW21wTp9J5FfAX/exec';
export const DB_NAME = 'ava-crm-user-layer';
export const DB_VERSION = 1;
export const AI_STATES = ['draft', 'needs_confirmation', 'confirmed'];

export function createBenefit(input = {}) {
  return { id: input.id || crypto.randomUUID(), policyId: input.policyId || '', primaryCategory: input.primaryCategory || 'medical', presentationTags: input.presentationTags || [], benefitType: input.benefitType || '', amount: input.amount ?? null, limit: input.limit ?? null, unit: input.unit || '', benefitForm: input.benefitForm || '', metadata: input.metadata || {}, createdAt: input.createdAt || new Date().toISOString() };
}

export function dedupeBenefits(benefits) {
  const unique = new Map();
  for (const benefit of benefits) unique.set(benefit.id, benefit);
  return [...unique.values()];
}

export function comparePolicy(existing, extracted) {
  const fields = ['insurer', 'productName', 'productVersion', 'premium', 'paymentTerm'];
  return fields.filter((field) => String(existing?.[field] ?? '') !== String(extracted?.[field] ?? '')).map((field) => ({ field, existing: existing?.[field] ?? null, extracted: extracted?.[field] ?? null }));
}

export function matchProduct(products, query) {
  const normalized = (value) => String(value || '').trim().toLocaleLowerCase();
  const insurer = normalized(query?.insurer); const product = normalized(query?.productName); const version = normalized(query?.productVersion);
  const exact = products.find((item) => normalized(item.insurer) === insurer && normalized(item.productName) === product && (!version || normalized(item.productVersion) === version));
  if (exact) return { status: 'exact', product: exact, requiresConfirmation: false };
  const candidates = products.filter((item) => normalized(item.insurer) === insurer || normalized(item.productName).includes(product) || product.includes(normalized(item.productName)));
  return candidates.length ? { status: 'candidate', candidates, requiresConfirmation: true } : { status: 'none', candidates: [], requiresConfirmation: true };
}

export function createDeviceTransferPointer() {
  return `ava-crm-transfer:${crypto.randomUUID()}`;
}

export async function openUserDatabase() {
  if (!('indexedDB' in globalThis)) return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of ['clients', 'people', 'policies', 'benefits', 'reviews', 'intakeDrafts']) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

export async function saveLocal(db, storeName, value) {
  if (!db) return false;
  return new Promise((resolve, reject) => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(value); tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); });
}

export async function loadOfficialRegistry(fetchImpl = fetch, storage = localStorage) {
  const cacheKey = 'ava-crm-official-registry-v1';
  try {
    const response = await fetchImpl(OFFICIAL_GAS_ENDPOINT, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Official registry request failed: ${response.status}`);
    const payload = await response.json();
    storage.setItem(cacheKey, JSON.stringify({ savedAt: new Date().toISOString(), payload }));
    return { source: 'official', payload };
  } catch {
    try { const cached = JSON.parse(storage.getItem(cacheKey) || 'null'); if (cached?.payload) return { source: 'official-cache', payload: cached.payload }; } catch { /* safe fallback below */ }
    return { source: 'built-in-fallback', payload: { '保障分類': [], '產品資料': [], 'Review問題': [], '頁面設定': [], '系統設定': [] } };
  }
}
