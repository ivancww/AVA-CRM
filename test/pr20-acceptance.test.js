import test from 'node:test';
import assert from 'node:assert/strict';
import { makePolicyDraft } from '../policy-editor.js';
import { preparePolicyGroup } from '../crm-core.js';

test('ordered source rows and explicitly linked full names survive preparation', () => {
  const draft = makePolicyDraft('h', { insurer:'Example', productName:'combined', policyNumber:'P1', policyholder:{name:'MR HOLDER FULL'}, insuredPeople:[{name:'MS PERSON FULL'},{name:'MR OTHER FULL'}], premiumCoverageRows:[{name:'主險',planCode:'A1',effectiveDate:'2023-11-07',paidUpDate:'2041-11-07'},{name:'升級保障（首十年）',premium:0,effectiveDate:'2023-11-07',paidUpDate:'2033-11-07'},{name:'豁免保費',premium:0}] });
  assert.equal(draft.productName,'主險'); assert.equal(draft.paymentTerm,'18年'); assert.deepEqual(draft.contracts.map(c=>c.name),['升級保障（首十年）','豁免保費']);
  Object.assign(draft,{policyHolderId:'holder',insuredPersonIds:['one','two'],sourceInsuredLinks:{0:'two',1:'one'}});
  let n=0; const group=preparePolicyGroup(draft,()=>String(++n));
  assert.deepEqual(group.roles.map(r=>r.sourceInsuredName),['MR OTHER FULL','MS PERSON FULL']);
  assert.equal(group.policy.sourcePolicyholderName,'MR HOLDER FULL'); assert.equal(group.policy.premiumCoverageRows[0].planCode,'A1');
  draft.sourceInsuredLinks={0:'one'}; assert.throws(()=>preparePolicyGroup(draft),/關聯/);
});


test('source product matching never promotes a plan code and uses the first source row', async () => {
  const { sourceProductName, resolvePolicyMatches } = await import('../policy-extraction.js');
  assert.equal(sourceProductName({name:'A-123', planCode:'a-123'}), '');
  const policies = [{productName:'combined',premiumCoverageRows:[{name:'主險',planCode:'X'},{name:'附加',planCode:'Y'}]}];
  assert.deepEqual(resolvePolicyMatches({policies}, [], (_,p)=>p.productName), ['主險']);
  assert.equal(makePolicyDraft('h',{premiumCoverageRows:[{name:'CODE',planCode:'code'}]}).productName,'');
});

test('valid contract dates determine payment years independently of frequency and entered text', () => {
  let n=0; const group=preparePolicyGroup({householdId:'h',policyHolderId:'holder',insuredPersonIds:['holder'],insurer:'A',productName:'Main',policyNumber:'P',effectiveDate:'2023-11-07',paidUpDate:'2041-11-07',paymentFrequency:'annual',paymentTerm:'annual',contracts:[{name:'Upgrade',effectiveDate:'2023-11-07',paidUpDate:'2033-11-07',paymentTerm:'20年'}]},()=>String(++n));
  assert.equal(group.policy.paymentTerm,'18年');assert.equal(group.policy.paymentFrequency,'annual');assert.equal(group.policy.contracts[0].paymentTerm,'10年');
});
