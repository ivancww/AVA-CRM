import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_STATES, DB_VERSION, POLICY_COMPARE_FIELDS, STORE_DEFINITIONS, benefitAppearsInCategory, categoryBenefits, comparePolicy, createBenefit, coverageTotals, dedupeBenefits, matchProduct, normalizeSearchName, relevantPolicyIds, resolveProductMatch, saveUserLayerMutation } from '../crm-core.js';

test('AI intake uses confirmation states', () => assert.deepEqual(AI_STATES, ['draft', 'needs_confirmation', 'confirmed']));
test('benefits deduplicate by stable unique ID', () => { const first = createBenefit({ id: 'b1', primaryCategory: 'accident', presentationTags: ['accident', 'medical'] }); assert.equal(dedupeBenefits([first, { ...first, amount: 100 }]).length, 1); });
test('policy comparison returns differences without overwriting', () => assert.deepEqual(comparePolicy({ premium: 100, paymentTerm: '20年' }, { premium: 120, paymentTerm: '20年' }), [{ field: 'premium', existing: 100, extracted: 120 }]));
test('product match distinguishes exact from candidate', () => { const products = [{ insurer: 'AVA', productName: '安心醫療', productVersion: '2026' }]; assert.equal(matchProduct(products, products[0]).status, 'exact'); assert.equal(matchProduct(products, { insurer: 'AVA', productName: '安心', productVersion: '2025' }).requiresConfirmation, true); });
test('product matching requires confirmed version identity for exact status', () => {
  const products = [{ insurer: 'AVA', productName: '安心醫療', productVersion: '2026' }];
  assert.equal(matchProduct(products, { insurer: 'AVA', productName: '安心醫療', productVersion: '2026' }).status, 'exact');
  assert.equal(matchProduct(products, { insurer: 'AVA', productName: '安心醫療' }).status, 'candidate');
  assert.equal(matchProduct(products, { insurer: 'AVA', productName: '安心醫療', productVersion: '2025' }).status, 'candidate');
  assert.equal(matchProduct(products, { insurer: 'AVA', productName: '安心醫療計劃', productVersion: '2026' }).status, 'candidate');
  assert.equal(matchProduct(products, { insurer: 'AVA', productName: '危疾守護', productVersion: '2026' }).status, 'none');
});
test('explicitly confirmed compatible product versions may be exact', () => { const products = [{ insurer: 'AVA', productName: '安心醫療', productVersion: '2026', compatibleProductVersions: ['2025'] }]; assert.equal(matchProduct(products, { insurer: 'AVA', productName: '安心醫療', productVersion: '2025' }).status, 'exact'); });
test('policy conflict comparison includes structured term and benefits', () => { const differences = comparePolicy({ coverageTerm: '20年', benefits: [{ id: 'b1', amount: 100 }] }, { coverageTerm: '終身', benefits: [{ id: 'b1', amount: 120 }] }); assert.deepEqual(differences.map((item) => item.field), ['coverageTerm', 'benefits']); });
test('database model has indexed-scale version and required comparison fields', () => { assert.equal(DB_VERSION, 3); assert.ok(POLICY_COMPARE_FIELDS.includes('coverageTerm')); assert.ok(POLICY_COMPARE_FIELDS.includes('benefits')); });
test('exact official product match carries verified features while fuzzy match requires confirmation', () => { const registry = [{ insurer: 'AVA', productName: '安心醫療', productVersion: '2026', features: ['住院醫療'], customerExplanations: ['住院時可按條款申請'] }]; const exact = resolveProductMatch(registry, registry[0]); assert.deepEqual(exact.verifiedFeatures, ['住院醫療']); const candidate = resolveProductMatch(registry, { insurer: 'AVA', productName: '安心', productVersion: '2025' }); assert.equal(candidate.requiresConfirmation, true); });
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
