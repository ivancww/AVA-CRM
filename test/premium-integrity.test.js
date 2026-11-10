import test from 'node:test';
import assert from 'node:assert/strict';
import { makePolicyDraft } from '../policy-editor.js';
import { annualPremiumSummary, preparePolicyGroup } from '../crm-core.js';

const sample={insurer:'Example',productName:'Main',policyNumber:'ANON',premium:{amount:785.60,currency:'USD',frequency:'annual'},premiumLevy:{amount:1.20,currency:'USD'},premiumCoverageRows:[{name:'Main',premium:223.60,premiumCurrency:'USD'}, {name:'Medical',premium:562,premiumCurrency:'USD'}, {name:'Upgrade',premium:0,premiumCurrency:'USD'}]};

test('official total, main, riders and levy stay distinct on preparation',()=>{
 const draft=makePolicyDraft('h',sample);assert.equal(draft.premium,785.60);assert.equal(draft.mainPremium,223.60);assert.equal(draft.contracts[0].premium,562);assert.equal(draft.contracts[1].premium,0);assert.equal(draft.premiumLevy,1.20);
 Object.assign(draft,{policyHolderId:'p',insuredPersonIds:['p']});let id=0;const {policy}=preparePolicyGroup(draft,()=>String(++id));assert.deepEqual([policy.premium,policy.currency,policy.mainPremium,policy.mainPremiumCurrency,policy.premiumLevy,policy.premiumLevyCurrency],[785.60,'USD',223.60,'USD',1.20,'USD']);assert.deepEqual(policy.contracts.map(r=>[r.premium,r.premiumCurrency]),[[562,'USD'],[0,'USD']]);assert.deepEqual(policy.premiumCoverageRows.map(r=>r.premiumCurrency),['USD','USD','USD']);assert.deepEqual(annualPremiumSummary([policy,policy]),{totals:[{currency:'USD',total:785.60}],incomplete:false});
});

test('missing official total stays unknown and legacy and manual amounts remain compatible',()=>{
 const missing=makePolicyDraft('h',{premiumCoverageRows:[{name:'Main',premium:223.60,premiumCurrency:'USD'}]});assert.equal(missing.premium,'');assert.equal(missing.mainPremium,223.60);
 const legacy=makePolicyDraft('h',{premium:{amount:80,currency:'HKD',frequency:'monthly'}});assert.equal(legacy.premium,80);assert.equal(legacy.mainPremium,'');
 let id=0;const manual=preparePolicyGroup({householdId:'h',policyHolderId:'p',insuredPersonIds:['p'],insurer:'A',productName:'B',policyNumber:'P',premium:'80',currency:'HKD',paymentFrequency:'monthly'},()=>String(++id)).policy;assert.equal(manual.premium,80);assert.equal(manual.mainPremium,null);assert.deepEqual(annualPremiumSummary([manual,{id:'unknown',premium:null,currency:'USD',paymentFrequency:'annual'}]),{totals:[{currency:'HKD',total:960}],incomplete:true});
});
