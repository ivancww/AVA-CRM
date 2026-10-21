import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DB_VERSION, STORE_NAMES, exportUserLayer, restoreUserLayer, validateUserLayerExport } from '../crm-core.js';
import { DOCUMENT_ACCEPT, attachDocumentPicker } from '../policy-extraction.js';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const manifest=fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8');
function emptyExport(){return {app:'AVA-CRM',schemaVersion:DB_VERSION,exportedAt:new Date().toISOString(),data:Object.fromEntries(STORE_NAMES.map(name=>[name,[]]))};}
test('PWA defaults to Frontend and keeps explicit User capability',()=>{assert.match(manifest,/"start_url":"\.\/\?avaEntry=frontend"/);assert.match(app,/resolveAvaEntry\(window\.location\.search\)/);assert.match(app,/if \(canEditFrontstage\(entryMode\)\) enterUserEditMode\(\)/);});
test('provider-neutral backup restore controls have a fallback',()=>{assert.match(html,/備份／同步資料檔/);assert.match(html,/從資料檔恢復/);assert.match(app,/navigator\.share/);assert.match(app,/AVA-CRM-Data\.json/);assert.doesNotMatch(app,/檔案同步：BLOCKED/);});
test('portable export is limited to User Layer stores',async()=>{const fakeDb={transaction:()=>({objectStore:()=>({getAll:()=>{const r={};queueMicrotask(()=>{r.result=[];r.onsuccess?.();});return r;}})})};const payload=await exportUserLayer(fakeDb);assert.deepEqual(Object.keys(payload.data).sort(),[...STORE_NAMES].sort());assert.doesNotMatch(JSON.stringify(payload),/base64|GEMINI|launchTicket|browserProof|policy\.pdf/i);});
test('restore validates app/schema and requires confirmation',()=>{const p=emptyExport();assert.equal(validateUserLayerExport(p),p);assert.throws(()=>validateUserLayerExport({...p,app:'other-app'}),/不是 AVA-CRM/);assert.throws(()=>validateUserLayerExport({...p,schemaVersion:DB_VERSION+1}),/版本不受支援/);assert.throws(()=>validateUserLayerExport({...p,data:{...p.data,people:'bad'}}),/資料檔內容無效/);assert.match(app,/window\.confirm\(/);});
test('restore is one transaction and abort-safe',()=>{const source=fs.readFileSync(new URL('../crm-core.js',import.meta.url),'utf8');assert.match(source,/db\.transaction\(STORE_NAMES, 'readwrite'\)/);assert.match(source,/tx\.onabort/);assert.match(source,/store\.clear\(\)/);});
test('restore failure aborts before committing a partial replacement',async()=>{
  const original={households:[{id:'old-household'}],people:[{id:'old-person'}]};
  const working=structuredClone(original); let tx;
  const db={transaction:()=>{tx={aborted:false,objectStore(name){return {clear(){working[name]=[];},add(record){if(name==='people'){tx.error=new Error('forced write failure');throw tx.error;}working[name].push(record);}};},abort(){tx.aborted=true;working.households=original.households;working.people=original.people;tx.onabort?.();}};queueMicrotask(()=>{if(!tx.aborted)tx.oncomplete?.();});return tx;}};
  const payload=emptyExport(); payload.data.households=[{id:'new-household'}]; payload.data.people=[{id:'new-person'}];
  await assert.rejects(()=>restoreUserLayer(db,payload),/forced write failure/);
  assert.deepEqual(working,original);
});
test('AI picker is mounted and binds change before direct click',()=>{assert.equal(DOCUMENT_ACCEPT,'application/pdf,image/jpeg,image/png,image/webp');assert.match(html,/id="policyFile" class="visually-hidden"/);const calls=[];const input={accept:'',addEventListener(type){calls.push('input:'+type);},removeEventListener(){},click(){calls.push('click');}};const trigger={addEventListener(type,fn){calls.push('trigger:'+type);this.handler=fn;},removeEventListener(){}};attachDocumentPicker({trigger,input,onFile:()=>{}});trigger.handler();assert.deepEqual(calls,['input:change','trigger:click','click']);assert.equal(input.accept,DOCUMENT_ACCEPT);});
test('AI flow remains multi-policy read-only',()=>{assert.match(app,/extractPolicyDocumentFromFile\(file\)/);assert.match(app,/resolvePolicyMatches\(extraction/);assert.match(app,/extraction\.policies\.forEach/);assert.match(app,/state\.readOnlyExtraction = null/);assert.doesNotMatch(app.slice(app.indexOf('async function aiIntake'),app.indexOf('function manualPolicy')),/saveMutation|intakeDrafts|replaceOfficialArea/);});
