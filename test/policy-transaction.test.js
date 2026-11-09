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
function input(number = 'P001') { return { householdId: 'h1', policyHolderId: 'holder', insuredPersonIds: ['insured'], insurer: 'AIA', productName: 'Plan', policyNumber: number, premium: '1,200', currency:'HKD', paymentFrequency:'月繳', benefits: [{ insuredPersonId: 'insured', primaryCategory: 'medical', benefitType: 'Hospital', amount: 1000 }, { insuredPersonId: 'insured', primaryCategory: 'critical', benefitType: 'Critical', amount: 2000 }], values: [{ insuredPersonId: 'insured', valueType: 'guaranteed_value', amount: 100 }] }; }
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
test('cross household conflict is private, requires acknowledgement and never links records', async () => {
  const db=await fresh(); await saveLocal(db,'households',{id:'other',displayName:'PRIVATE NAME'}); await saveLocal(db,'people',{id:'other-person',householdId:'other'});
  const other={...input('SAME'),householdId:'other',policyHolderId:'other-person',insuredPersonIds:['other-person'],benefits:[],values:[]}; await saveConfirmedPolicy(db,preparePolicyGroup(other));
  const group=preparePolicyGroup(input('SAME')); const {findPolicyDuplicates}=await import('../crm-core.js'); const matches=await findPolicyDuplicates(db,group.policy);
  assert.deepEqual(matches,{sameHousehold:[],otherHousehold:true}); assert.doesNotMatch(JSON.stringify(matches),/PRIVATE NAME|other-person/);
  await assert.rejects(saveConfirmedPolicy(db,group),/其他客戶/); await saveConfirmedPolicy(db,group,{acknowledgeOtherHousehold:true});
  const data=await loadInsuredPersonData(db,'insured');assert.equal(data.policies.length,1);assert.equal(data.policies[0].householdId,'h1'); db.close();
});
test('unknown amounts remain null, and unconfirmed fields do not enter the saved group', () => {
 const i=input(); i.premium='  '; i.sumAssured=''; i.base64Data='secret'; const g=preparePolicyGroup(i); assert.equal(g.policy.premium,null); assert.equal(g.policy.sumAssured,null); assert.doesNotMatch(JSON.stringify(g),/secret|base64/);
});
test('multiple insured people see only their own person-specific benefits and values', async () => {
 const db=await fresh(); const i=input(); i.insuredPersonIds=['holder','insured']; i.benefits.push({insuredPersonId:'holder',primaryCategory:'life',benefitType:'Holder only',amount:999});i.values.push({insuredPersonId:'holder',valueType:'guaranteed_value',amount:777});await saveConfirmedPolicy(db,preparePolicyGroup(i));
 const insured=await loadInsuredPersonData(db,'insured'), holder=await loadInsuredPersonData(db,'holder');assert.equal(insured.policies.length,1);assert.equal(holder.policies.length,1);assert.equal(insured.benefits.length,2);assert.equal(holder.benefits.length,1);assert.equal(holder.values.length,1);assert.equal(insured.values.length,1);db.close();
});
test('policy role write failure aborts policy and dependent writes', async () => {
 const db=await fresh(); const first=preparePolicyGroup(input('P1'));await saveConfirmedPolicy(db,first);
 const second=preparePolicyGroup(input('P2'));second.roles[0].id=first.roles[0].id;await assert.rejects(saveConfirmedPolicy(db,second));
 const data=await loadInsuredPersonData(db,'insured');assert.equal(data.policies.length,1);assert.equal(data.benefits.length,2);assert.equal(data.values.length,1);db.close();
});
test('date and premium fields reject malformed data and normalize payment frequency', () => {
 const a=input();a.effectiveDate='2026-02-30';assert.throws(()=>preparePolicyGroup(a),/日期/);a.effectiveDate='2026-02-28';const p=preparePolicyGroup(a).policy;assert.equal(p.paymentFrequency,'monthly');assert.equal(p.effectiveDate,'2026-02-28');a.currency='';assert.throws(()=>preparePolicyGroup(a),/貨幣/);
});
test('new insured person joins policy atomically and rolls back on failure', async () => {
 const db=await fresh(); const i=input('NEW');i.insuredPersonIds=['insured','new-person'];i.newPeople=[{id:'new-person',name:'Child',relationship:'子女'}];i.benefits.push({insuredPersonId:'new-person',primaryCategory:'life',benefitType:'Child cover',amount:10});
 const first=preparePolicyGroup(i); first.roles[0].id='collision';await saveLocal(db,'policyRoles',{id:'collision'});await assert.rejects(saveConfirmedPolicy(db,first));let data=await exportUserLayer(db);assert.equal(data.data.people.some(p=>p.id==='new-person'),false);assert.equal(data.data.policies.length,0);
 const second=preparePolicyGroup(i);await saveConfirmedPolicy(db,second);const child=await loadInsuredPersonData(db,'new-person');assert.equal(child.policies.length,1);assert.equal(child.benefits.length,1);db.close();
});
test('new insured duplicate name is rejected before any write', async () => {
 const db=await fresh();const i=input('DUP');i.insuredPersonIds=['insured','new-person'];i.newPeople=[{id:'new-person',name:' INSURED ',relationship:'家人'}];await assert.rejects(saveConfirmedPolicy(db,preparePolicyGroup(i)),/重複/);const data=await exportUserLayer(db);assert.equal(data.data.policies.length,0);assert.equal(data.data.people.length,2);db.close();
});
test('structured rider details and value source metadata survive local save and backup restore', async () => {
 const db=await fresh(); const i=input('STRUCT');i.contracts=[{contractId:'r1',name:'Medical rider',insuredPersonId:'insured',category:'medical',premium:25,premiumCurrency:'HKD',sumAssured:1000,currency:'HKD',effectiveDate:'2026-01-01',annualDeductible:'100',annualLimit:'5000',lifetimeLimit:'not verified',source:'pdf'}];
 i.values.push({insuredPersonId:'insured',valueType:'annual_dividend',amount:0,currency:'HKD',valuationDate:'2026-01-01',verified:true,includesComponents:['cash_value']});
 await saveConfirmedPolicy(db,preparePolicyGroup(i));const backup=await exportUserLayer(db);await restoreUserLayer(db,backup);const data=await loadInsuredPersonData(db,'insured');assert.equal(data.policies[0].contracts[0].annualLimit,'5000');assert.equal(data.policies[0].contracts[0].insuredPersonId,'insured');assert.equal(data.values.find(v=>v.valueType==='annual_dividend').amount,0);assert.deepEqual(data.values.find(v=>v.valueType==='annual_dividend').includesComponents,['cash_value']);db.close();
});
test('rider cannot be attributed to an unrelated insured person',()=>{const i=input('X');i.contracts=[{name:'Medical',insuredPersonId:'someone-else'}];assert.throws(()=>preparePolicyGroup(i),/受保人/);});
test('one benefit can be displayed in multiple categories without duplicate records and keeps rider association',async()=>{
 const db=await fresh();const i=input('CATEGORIES');i.contracts=[{contractId:'r1',name:'Rider',insuredPersonId:'insured'}];i.benefits=[{insuredPersonId:'insured',primaryCategory:'accident',presentationTags:['medical','accident','medical'],contractId:'r1',benefitType:'Medical accident',amount:500}];
 const g=preparePolicyGroup(i);await saveConfirmedPolicy(db,g);const d=await loadInsuredPersonData(db,'insured');const {categoryBenefits}=await import('../crm-core.js');assert.equal(d.benefits.length,1);assert.equal(categoryBenefits(d.benefits,'medical').length,1);assert.equal(categoryBenefits(d.benefits,'accident').length,1);assert.equal(d.benefits[0].metadata.contractId,'r1');db.close();
});
test('benefit rejects an unrelated rider identity',()=>{const i=input('BAD');i.benefits[0].contractId='unknown';assert.throws(()=>preparePolicyGroup(i),/附加契約/);});
test('benefit cannot attach to another insured person’s rider',()=>{const i=input('PERSON');i.insuredPersonIds=['insured','holder'];i.contracts=[{contractId:'r1',name:'Rider',insuredPersonId:'holder'}];i.benefits[0].contractId='r1';assert.throws(()=>preparePolicyGroup(i),/受保人不一致/);});
test('historical values keep dates, inclusion and currency through atomic save and backup restore',async()=>{const db=await fresh();const i=input('HISTORY');i.values=[{insuredPersonId:'insured',valueType:'cash_reserve',amount:999,currency:'HKD',valuationDate:'2026-01-01',verified:true},{insuredPersonId:'insured',valueType:'cash_value',amount:12,currency:'HKD',valuationDate:'2025-01-01',includesComponents:['annual_dividend'],verified:true},{insuredPersonId:'insured',valueType:'cash_value',amount:14,currency:'USD',valuationDate:'2026-01-01',verified:true}];await saveConfirmedPolicy(db,preparePolicyGroup(i));const backup=await exportUserLayer(db);await restoreUserLayer(db,backup);const data=await loadInsuredPersonData(db,'insured');const {groupPolicyValues}=await import('../crm-core.js');const groups=groupPolicyValues(data.values,data.policies,'insured');assert.equal(groups.length,3);assert.deepEqual(data.values.find(v=>v.valuationDate==='2025-01-01').includesComponents,['annual_dividend']);assert.equal(groups.some(g=>g.accumulated.complete),false);db.close();});
test('reviewed cross-policy comparison survives restore and becomes invalid after a benefit changes',async()=>{
 const {saveReviewedComparison,reviewedComparisonResult,payoutReviewSignature,getById}=await import('../crm-core.js');const db=await fresh();
 for(const number of ['ONE','TWO']){const q={scenarioId:'s',label:'Example',date:'2026-05-01',currency:'HKD',relationship:'additional',source:'Example policy',sourcePage:1,sourceExcerpt:'Example policy clause stating independent payment.',startDate:'2026-01-01',endDate:'2026-12-31',payableAmount:100};const b={insuredPersonId:'insured',primaryCategory:'life',benefitType:'Example',amount:100,currency:'HKD',payoutScenario:q};b.payoutReviewSignature=payoutReviewSignature(b);const i=input(number);i.benefits=[b];i.values=[];await saveConfirmedPolicy(db,preparePolicyGroup(i));}
 let data=await loadInsuredPersonData(db,'insured');const comparison={reviewed:true,insuredPersonId:'insured',event:{definition:'Example event',criteria:'Example criteria',date:'2026-05-01',currency:'HKD'},proofs:data.benefits.map(b=>({benefitId:b.id,policyId:b.policyId,eventEquivalent:true,interactionConfirmed:true,evidence:{source:b.metadata.verifiedScenario.rule.source,...b.metadata.verifiedScenario.rule.evidence}}))};
 await saveReviewedComparison(db,'insured','life',comparison);const backup=await exportUserLayer(db);await restoreUserLayer(db,backup);data=await loadInsuredPersonData(db,'insured');let record=await getById(db,'settings','cross-policy:insured:life');assert.equal(reviewedComparisonResult(record,data.benefits,'insured','life').total,200);
 await saveLocal(db,'benefits',{...data.benefits[0],amount:999});data=await loadInsuredPersonData(db,'insured');assert.equal(reviewedComparisonResult(record,data.benefits,'insured','life').total,null);await assert.rejects(saveReviewedComparison(db,'insured','life',{...comparison,proofs:[]}));assert.equal((await getById(db,'settings','cross-policy:insured:life')).snapshot,record.snapshot);db.close();
});
test('ambiguous legacy reserve values preserve their source label after save and restore',async()=>{const db=await fresh();const i=input('LEGACY-RESERVE');i.values=[{insuredPersonId:'insured',valueType:'unclassified_document_value',sourceType:'現金儲備金',component:'guaranteed',amount:100,currency:'HKD'}];await saveConfirmedPolicy(db,preparePolicyGroup(i));const backup=await exportUserLayer(db);await restoreUserLayer(db,backup);const data=await loadInsuredPersonData(db,'insured');assert.equal(data.values[0].valueType,'unclassified_document_value');assert.equal(data.values[0].sourceType,'現金儲備金');assert.equal(data.values[0].component,'guaranteed');db.close();});
