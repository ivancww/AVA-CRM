import test from 'node:test';
import assert from 'node:assert/strict';
import { accumulatedValueTotal, ACCUMULATED_VALUE_TYPES } from '../crm-core.js';
const rows = () => ACCUMULATED_VALUE_TYPES.map((valueType, i) => ({ valueType, amount:i, currency:'HKD', valuationDate:'2026-01-01', verified:true }));
test('verified components total includes zero and excludes cash reserve', () => {
  assert.deepEqual(accumulatedValueTotal([...rows(), {valueType:'cash_reserve', amount:999}]), { complete:true, total:6, currency:'HKD', valuationDate:'2026-01-01' });
});
test('missing, unverified, incompatible and duplicate components stay incomplete', () => {
  for (const change of [v => v.pop(), v => v[0].amount = null, v => v[0].amount = '', v => v[0].verified = false, v => v[0].currency = 'USD', v => v[0].valuationDate = '', v => v[0].valuationDate = '2025-01-01', v => v[0].conditions = 'other', v => v.push({...v[0]})]) {
    const v=rows(); change(v); assert.equal(accumulatedValueTotal(v).complete,false);
  }
});
test('changing a verified value recalculates the arithmetic total', () => { const v=rows(); v[0].amount=25; assert.equal(accumulatedValueTotal(v).total,31); });

test('confirmed components retain valuation metadata in policy preparation', async () => {
  const { preparePolicyGroup } = await import('../crm-core.js');
  let id=0;
  const input={ householdId:'h',policyHolderId:'p',insuredPersonIds:['p'],insurer:'Test',productName:'Example',policyNumber:'example',values:rows().map(v=>({...v,insuredPersonId:'p',includesComponents:['annual_dividend']})) };
  const group=preparePolicyGroup(input,()=>String(++id));
  assert.equal(group.values.length,4);
  assert.equal(group.values[0].amount,0);
  assert.equal(group.values[0].verified,true);
  assert.equal(group.values[0].valuationDate,'2026-01-01');
  assert.deepEqual(group.values[0].includesComponents,['annual_dividend']);
});
test('values belonging to different people or policies cannot be added', () => {
 const a=rows().map(v=>({...v,insuredPersonId:'person-a',policyId:'policy-a'}));
 a[1].insuredPersonId='person-b';assert.equal(accumulatedValueTotal(a).complete,false);
 a[1].insuredPersonId='person-a';a[1].policyId='policy-b';assert.equal(accumulatedValueTotal(a).complete,false);
});
test('blank value placeholders do not create records or block valid policies', async () => {
 const {preparePolicyGroup}=await import('../crm-core.js');let n=0;const group=preparePolicyGroup({householdId:'h',policyHolderId:'p',insuredPersonIds:['p'],insurer:'Test',productName:'Example',policyNumber:'N',values:[{valueType:'cash_reserve',amount:''},{valueType:'annual_dividend',amount:null}]},()=>String(++n));assert.equal(group.values.length,0);
});
