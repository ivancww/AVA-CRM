import test from 'node:test';
import assert from 'node:assert/strict';
import { makePolicyDraft } from '../policy-editor.js';
test('draft retains structured contracts and separates waiver benefit from visible benefits',()=>{
 const draft=makePolicyDraft('h',{productName:'Example',structuredRiders:[{name:'Medical',annualLimit:'5000'}],benefits:[{name:'免付保費附加契約'},{name:'Hospital'}],structuredValues:[{type:'cash_reserve',amount:0,currency:'HKD'}]});
 assert.equal(draft.contracts[0].annualLimit,'5000');assert.deepEqual(draft.benefits.map(b=>b.benefitType),['Hospital']);assert.equal(draft.hiddenContractualData[0].name,'免付保費附加契約');assert.equal(draft.values[0].amount,0);assert.equal(draft.values[0].verified,false);
});
