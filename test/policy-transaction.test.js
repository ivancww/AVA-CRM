import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { openUserDatabase, preparePolicyGroup, saveConfirmedPolicy, saveLocal, loadInsuredPersonData, exportUserLayer, restoreUserLayer, policyDuplicateKey } from '../crm-core.js';

async function fresh() {
  await new Promise((resolve, reject) => { const req = indexedDB.deleteDatabase('ava-crm-user-layer'); req.onsuccess = resolve; req.onerror = () => reject(req.error); });
  const db = await openUserDatabase();
  await saveLocal(db, 'households', { id: 'h1', displayName: 'Family', searchName: 'family' });
  await saveLocal(db, 'people', { id: 'holder', householdId: 'h1', name: 'Holder' });
  await saveLocal(db, 'people', { id: 'insured', householdId: 'h1', name: 'Insured' });
  return db;
}
function input(number = 'P001') { return { householdId: 'h1', policyHolderId: 'holder', insuredPersonIds: ['insured'], insurer: 'AIA', productName: 'Plan', policyNumber: number, premium: '1,200', benefits: [{ insuredPersonId: 'insured', primaryCategory: 'medical', benefitType: 'Hospital', amount: 1000 }, { insuredPersonId: 'insured', primaryCategory: 'critical', benefitType: 'Critical', amount: 2000 }], values: [{ insuredPersonId: 'insured', valueType: 'guaranteed_value', amount: 100 }] }; }
test('policy group preserves roles and is queryable and exportable', async () => {
  const db = await fresh(); const group = preparePolicyGroup(input());
  await saveConfirmedPolicy(db, group);
  const data = await loadInsuredPersonData(db, 'insured');
  assert.equal(data.policies.length, 1); assert.equal(data.policies[0].policyHolderId, 'holder'); assert.equal(data.benefits.length, 2); assert.equal(data.values.length, 1); assert.equal(data.policies[0].premium, 1200);
  const backup = await exportUserLayer(db); await restoreUserLayer(db, backup);
  const restored = await loadInsuredPersonData(db, 'insured'); assert.equal(restored.benefits.length, 2); assert.equal(restored.values[0].policyId, restored.policies[0].id); db.close();
});
test('duplicate policy is rejected while a different number is independent', async () => {
  const db = await fresh(); await saveConfirmedPolicy(db, preparePolicyGroup(input()));
  await assert.rejects(saveConfirmedPolicy(db, preparePolicyGroup(input(' p001 '))), /相同/);
  await saveConfirmedPolicy(db, preparePolicyGroup(input('P002')));
  assert.equal((await loadInsuredPersonData(db, 'insured')).policies.length, 2); db.close();
});
test('duplicate benefit key aborts all writes to policy group', async () => {
  const db = await fresh(); const first = preparePolicyGroup(input()); await saveConfirmedPolicy(db, first);
  const second = preparePolicyGroup(input('P002')); second.benefits[0].id = first.benefits[0].id;
  await assert.rejects(saveConfirmedPolicy(db, second));
  const data = await loadInsuredPersonData(db, 'insured'); assert.equal(data.policies.length, 1); assert.equal(data.benefits.length, 2); db.close();
});
test('requires real person in household and verified policy number', async () => {
  assert.throws(() => preparePolicyGroup(input('')), /保單號碼/);
  const db = await fresh(); const bad = input(); bad.insuredPersonIds = ['missing']; bad.benefits = []; bad.values = [];
  await assert.rejects(saveConfirmedPolicy(db, preparePolicyGroup(bad)), /人物關係無效/);
  assert.equal((await exportUserLayer(db)).data.policies.length, 0); db.close();
});
test('duplicate normalization never equates different insurer', () => { assert.notEqual(policyDuplicateKey({ insurer:'AIA', policyNumber:'1' }), policyDuplicateKey({ insurer:'B', policyNumber:'1' })); });
test('three provisional inputs persist only selected policy groups and no source payload', async () => {
  const db = await fresh(); const provisional = [input('A'), input('B'), input('C')];
  provisional.forEach((v) => { v.base64Data = 'PRIVATEBASE64'; v.rawDocument = 'PRIVATEFILE'; v.apiKey = 'PRIVATEKEY'; });
  await saveConfirmedPolicy(db, preparePolicyGroup(provisional[0]));
  await saveConfirmedPolicy(db, preparePolicyGroup(provisional[2]));
  const exported = await exportUserLayer(db);
  assert.deepEqual(exported.data.policies.map((p) => p.policyNumber).sort(), ['A', 'C']);
  assert.doesNotMatch(JSON.stringify(exported), /PRIVATEBASE64|PRIVATEFILE|PRIVATEKEY/);
  db.close();
});
