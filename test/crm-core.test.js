import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_STATES, DB_VERSION, POLICY_COMPARE_FIELDS, STORE_DEFINITIONS, benefitAppearsInCategory, categoryBenefits, comparePolicy, createBenefit, coverageTotals, dedupeBenefits, matchProduct, normalizeSearchName, relevantPolicyIds, resolveProductMatch, saveUserLayerMutation } from '../crm-core.js';

test('AI intake uses confirmation states', () => assert.deepEqual(AI_STATES, ['draft', 'needs_confirmation', 'confirmed']));
test('benefits deduplicate by stable unique ID', () => { const first = createBenefit({ id: 'b1', primaryCategory: 'accident', presentationTags: ['accident', 'medical'] }); assert.equal(dedupeBenefits([first, { ...first, amount: 100 }]).length, 1); });
test('policy comparison returns differences without overwriting', () => assert.deepEqual(comparePolicy({ premium: 100, paymentTerm: '20年' }, { premium: 120, paymentTerm: '20年' }), [{ field: 'premium', existing: 100, extracted: 120 }]));
test('insurer and full product name match independently of version, without fuzzy matches', () => {
  const products=[{insurer:'AVA',productName:'安心醫療',productVersion:'2026'}];
  for(const version of ['', '2025', '2026']) assert.equal(matchProduct(products,{insurer:' ava ',productName:' 安心醫療 ',productVersion:version}).status,'exact');
  assert.equal(matchProduct(products,{insurer:'AVA',productName:'安心'}).status,'none');
  assert.equal(matchProduct(products,{insurer:'OTHER',productName:'安心醫療'}).status,'none');
});
test('sheet product rows are combined and deduplicated without adding contractual limits', () => {
 const rows=[{'保險公司':'A','產品名稱':'Plan','分類':'醫療','保障特點':'住院','簡單解釋':'按條款','資料狀態':'待確認','產品版本':'X','啟用':'是'}, {'保險公司':' A ','產品名稱':'Plan','分類':'危疾','保障特點':'危疾','簡單解釋':'按條款','資料狀態':'已核實','啟用':'是'}, {'保險公司':'A','產品名稱':'Plan','分類':'醫療','保障特點':'住院','啟用':'是'}];
 const match=resolveProductMatch(rows,{insurer:'A',productName:'Plan'});assert.deepEqual(match.categories,['醫療','危疾']);assert.deepEqual(match.officialFeatures,['住院','危疾']);assert.deepEqual(match.customerExplanations,['按條款']);assert.deepEqual(match.verifiedFeatures,['危疾']);assert.equal(match.annualLimit,undefined);
});
test('policy conflict comparison includes structured term and benefits', () => { const differences = comparePolicy({ coverageTerm: '20年', benefits: [{ id: 'b1', amount: 100 }] }, { coverageTerm: '終身', benefits: [{ id: 'b1', amount: 120 }] }); assert.deepEqual(differences.map((item) => item.field), ['coverageTerm', 'benefits']); });
test('database model has indexed-scale version and required comparison fields', () => { assert.equal(DB_VERSION, 3); assert.ok(POLICY_COMPARE_FIELDS.includes('coverageTerm')); assert.ok(POLICY_COMPARE_FIELDS.includes('benefits')); });
test('normalized customer search key and migration index contract', () => { assert.equal(normalizeSearchName('  陳 小明 '), '陳 小明'); assert.deepEqual(STORE_DEFINITIONS.households.find((index) => index[0] === 'bySearchName'), ['bySearchName', 'searchName']); assert.equal(DB_VERSION, 3); });
test('selected insured-person query only returns assigned policy IDs', () => { const roles = [{ insuredPersonId: 'p1', policyId: 'policy-a' }, { insuredPersonId: 'p2', policyId: 'policy-b' }, { insuredPersonId: 'p1', policyId: 'policy-a' }]; assert.deepEqual(relevantPolicyIds(roles, 'p1'), ['policy-a']); });
test('Accident Medical renders in both views without duplicate storage or totals', () => { const benefit = createBenefit({ id: 'acc-med', primaryCategory: 'accident', presentationTags: ['accident', 'medical'], benefitType: '意外醫療', amount: 100 }); assert.equal(categoryBenefits([benefit], 'medical').length, 1); assert.equal(categoryBenefits([benefit], 'accident').length, 1); assert.equal(categoryBenefits([benefit, { ...benefit }], 'medical').length, 1); assert.equal(benefitAppearsInCategory(benefit, 'medical'), true); });
test('coverage totals do not sum incompatible medical benefit meanings', () => {
  const benefits = [
    createBenefit({ id: 'reimbursement', primaryCategory: 'medical', benefitType: '醫療限額', amount: 100000, currency: 'HKD', unit: '額', benefitForm: 'reimbursement' }),
    createBenefit({ id: 'cash', primaryCategory: 'medical', benefitType: '住院現金', amount: 500, currency: 'HKD', unit: '日', benefitForm: 'daily-cash' })
  ];
  assert.equal(coverageTotals(benefits, 'medical'), null);
});
test('coverage totals sum only explicitly compatible aggregatable benefits', () => {
  const aggregation = { allowed: true, type: 'limit', definition: 'annual-medical-limit', semanticBasis: 'reimbursement-limit' };
  const benefits = [
    createBenefit({ id: 'm1', primaryCategory: 'medical', amount: 100000, currency: 'HKD', unit: '額', benefitForm: 'reimbursement', metadata: { aggregation } }),
    createBenefit({ id: 'm2', primaryCategory: 'medical', amount: 50000, currency: 'HKD', unit: '額', benefitForm: 'reimbursement', metadata: { aggregation } })
  ];
  assert.equal(coverageTotals(benefits, 'medical'), 150000);
});
test('same-insurer unrelated products are not broad candidates', () => { const products = [{ insurer: 'AVA', productName: '安心醫療', productVersion: '2026' }, { insurer: 'AVA', productName: '退休儲蓄', productVersion: '2026' }]; assert.equal(matchProduct(products, { insurer: 'AVA', productName: '危疾守護', productVersion: '2026' }).status, 'none'); });
test('User Layer save succeeds when file sync is unavailable', async () => { const result = await saveUserLayerMutation({ db: {}, storeName: 'people', value: { id: 'p1' }, saveFn: async () => true }); assert.deepEqual(result, { saved: true, fileSync: 'pending' }); });
test('official descriptions retain their source and status in a confirmed policy',async()=>{const {preparePolicyGroup}=await import('../crm-core.js');const officialProduct=resolveProductMatch([{'保險公司':'A','產品名稱':'Plan','分類':'醫療','保障特點':'住院','資料狀態':'待確認'}],{insurer:'A',productName:'Plan'});let n=0;const g=preparePolicyGroup({householdId:'h',policyHolderId:'p',insuredPersonIds:['p'],insurer:'A',productName:'Plan',policyNumber:'X',officialProduct},()=>String(++n));assert.equal(g.policy.officialProductInfo.source,'Official 產品資料');assert.equal(g.policy.officialProductInfo.entries[0].status,'待確認');assert.equal(g.benefits.length,0);});
