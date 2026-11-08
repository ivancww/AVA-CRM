// User-controlled form values are assigned via DOM properties, never HTML.
function node(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = String(text); if (className) el.className = className; return el; }
function button(label, fn) { const el = node('button', label, 'ava-button ava-button--secondary'); el.type = 'button'; el.addEventListener('click', fn); return el; }
function field(root, label, model, key, type = 'text') {
  const wrap = node('label', null, 'ava-field'); wrap.append(node('span', label, 'ava-label'));
  const input = node('input'); input.type = type; input.value = model[key] ?? ''; input.name = key; input.placeholder = '待確認';
  input.addEventListener('input', () => { model[key] = input.value; }); wrap.append(input); root.append(wrap); return input;
}
function select(root, label, model, key, choices) {
  const wrap = node('label', null, 'ava-field'); wrap.append(node('span', label, 'ava-label'));
  const input = node('select'); input.name = key; input.append(new Option('請選擇', ''));
  for (const [id, name] of choices) input.append(new Option(name, id)); input.value = model[key] || '';
  input.addEventListener('change', () => { model[key] = input.value; }); wrap.append(input); root.append(wrap); return input;
}
function section(root, title) { const details = node('details'); details.append(node('summary', title)); root.append(details); return details; }
const categoryOptions = [['medical','醫療'],['critical','危疾'],['life','人壽'],['accident','意外']];
const valueOptions = [['current_policy_cash_value','現時現金價值'],['guaranteed_value','保證價值'],['non_guaranteed_value','非保證價值']];
export function makePolicyDraft(householdId, extracted = null) {
  const policy = extracted || {}; const sum = Array.isArray(policy.sumAssured) ? policy.sumAssured : [];
  const values = [];
  for (const v of Array.isArray(policy.cashValues) ? policy.cashValues : []) {
    if (v.guaranteed != null && v.guaranteed !== '') values.push({ valueType:'guaranteed_value', amount:v.guaranteed, currency:v.currency || '', yearOrAge:v.yearOrAge || '', insuredPersonId:'' });
    if (v.nonGuaranteed != null && v.nonGuaranteed !== '') values.push({ valueType:'non_guaranteed_value', amount:v.nonGuaranteed, currency:v.currency || '', yearOrAge:v.yearOrAge || '', insuredPersonId:'' });
  }
  return { householdId, insurer:policy.insurer || '', productName:policy.productName || '', productVersion:policy.productVersion || '', policyNumber:policy.policyNumber || '', status:policy.policyStatus || '', issueDate:policy.issueDate || '', effectiveDate:policy.effectiveDate || '', premium:policy.premium?.amount ?? '', currency:policy.premium?.currency || '', paymentFrequency:policy.premium?.frequency || '', paymentTerm:policy.paymentTerm || '', coverageTerm:policy.coverageTerm || '', sumAssured:sum.length === 1 ? sum[0].amount ?? '' : '', sumAssuredCurrency:sum.length === 1 ? sum[0].currency || '' : '', policyHolderId:'', insuredPersonIds:[], benefits:(policy.benefits || []).map(b => ({ benefitType:b.name || '', amount:b.amount ?? '', limit:b.limit ?? '', currency:b.currency || '', primaryCategory:'', insuredPersonId:'', unit:'', benefitForm:'', notes:b.notes || '', extractedCategory:b.category || '', confidence:b.confidence })), values, riders:(policy.riders || []).map(r => typeof r === 'string' ? r : r?.name || '').filter(Boolean), extractedNames:extracted ? { holder:policy.policyholder?.name || '', insured:(policy.insuredPeople || []).map(p => p.name).filter(Boolean) } : null, extractionWarnings:extracted ? [...(policy.missingFields || []), ...(policy.conflicts || []), ...(policy.warnings || []), ...(sum.length > 1 ? ['識別到多項保障額，請核對並自行輸入所需金額'] : [])] : [], overallConfidence:policy.overallConfidence };
}
export function renderPolicyEditor({ draft, people, onReview, onCancel, onBack, extracted, onRerender }) {
  const root = node('div', null, 'policy-editor');
  const note = node('p', '請核對每項資料；未提供的資料可留空。持有人及所有被保人須從已選家庭中選擇。', 'ava-support'); root.append(note);
  if (extracted) { const warning=node('p', `AI 資料只供核對。識別持有人：${draft.extractedNames?.holder || '未識別'}；被保人：${draft.extractedNames?.insured?.join('、') || '未識別'}。請親自選擇人物和保障分類。`, 'blocked-note'); root.append(warning); const peopleList=node('ul');peopleList.setAttribute('aria-label','AI 識別的受保人');for(const name of draft.extractedNames?.insured || [])peopleList.append(node('li',name));root.append(node('p',`AI 識別受保人：${draft.extractedNames?.insured?.length || 0} 人`),peopleList); const summary=node('p', `整體信心：${draft.overallConfidence == null ? '未有資料' : Math.round(draft.overallConfidence*100)+'%'}；缺失／衝突／警告：${draft.extractionWarnings.length ? draft.extractionWarnings.join('、') : '未有提示'}。仍需逐項核對。`, 'blocked-note');root.append(summary); }
  const grid=node('div',null,'policy-form-grid'); root.append(grid);
  for (const [label,key,type] of [['保險公司 *','insurer'],['產品名稱 *','productName'],['產品版本','productVersion'],['保單號碼 *','policyNumber'],['保單狀態','status'],['生效日期（YYYY-MM-DD）','effectiveDate'],['簽發日期（YYYY-MM-DD）','issueDate'],['保費','premium'],['貨幣','currency'],['繳費頻率','paymentFrequency'],['繳費期','paymentTerm'],['保障期','coverageTerm'],['保障額','sumAssured'],['保障額貨幣','sumAssuredCurrency']]) field(grid,label,draft,key,type);
  draft.newPeople ||= [];
  const allPeople=[...people,...draft.newPeople];
  const choices=allPeople.map(p=>[p.id, `${p.name || '新受保人（請填姓名）'} · ${p.relationship || ''}`]);
  select(grid,'保單持有人 *',draft,'policyHolderId',choices);
  const insured = node('fieldset'); insured.append(node('legend','被保人 *（可選多人）'));
  for (const p of allPeople) { const label=node('label'); const box=node('input'); box.type='checkbox'; box.value=p.id; box.checked=draft.insuredPersonIds.includes(p.id); box.addEventListener('change',()=>{draft.insuredPersonIds=Array.from(insured.querySelectorAll('input:checked'),el=>el.value);}); label.append(box,document.createTextNode(` ${p.name} `)); insured.append(label); } root.append(insured);
  if (extracted) { const add=button('＋ 新增受保人',()=>{const id=crypto.randomUUID();draft.newPeople.push({id,name:'',relationship:''});draft.insuredPersonIds.push(id);onRerender();});root.append(add);
    draft.newPeople.forEach((person,index)=>{const box=node('div',null,'policy-repeat');box.append(node('h4',`新增受保人 ${index+1}（確認保存時才建立）`));field(box,'姓名 *',person,'name');field(box,'與客戶關係 *',person,'relationship');box.append(button('更新人物選項',onRerender));box.append(button('移除此受保人',()=>{draft.newPeople.splice(index,1);draft.insuredPersonIds=draft.insuredPersonIds.filter(id=>id!==person.id);for(const item of [...draft.benefits,...draft.values]) if(item.insuredPersonId===person.id)item.insuredPersonId='';onRerender();}));root.append(box);}); }
  const benefitSection=section(root,'保障項目（可新增多項）'); benefitSection.open=!!draft.benefits.length;
  const benefitList=node('div'); benefitSection.append(benefitList);
  function renderBenefits(){benefitList.replaceChildren(); draft.benefits.forEach((b,i)=>{const row=node('div',null,'policy-repeat');row.append(node('h4',`保障 ${i+1}`));if(b.extractedCategory || b.confidence != null) row.append(node('p',`AI 分類：${b.extractedCategory || '未識別'}；信心：${b.confidence == null ? '未有' : Math.round(b.confidence*100)+'%'}；請確認分類。`, 'ava-support'));select(row,'被保人 *',b,'insuredPersonId',choices);select(row,'分類 *',b,'primaryCategory',categoryOptions);field(row,'保障名稱 *',b,'benefitType');field(row,'金額',b,'amount');field(row,'限額說明',b,'limit');field(row,'貨幣',b,'currency');field(row,'單位',b,'unit');field(row,'保障形式',b,'benefitForm');field(row,'保障備註',b,'notes');row.append(button('刪除此保障',()=>{draft.benefits.splice(i,1);renderBenefits();}));benefitList.append(row);});}
  benefitSection.append(button('＋ 新增保障',()=>{draft.benefits.push({});renderBenefits();}));renderBenefits();
  const valueSection=section(root,'現金價值（選填）'); valueSection.open=!!draft.values.length; const valueList=node('div');valueSection.append(valueList);
  function renderValues(){valueList.replaceChildren();draft.values.forEach((v,i)=>{const row=node('div',null,'policy-repeat');row.append(node('h4',`價值 ${i+1}`));select(row,'被保人 *',v,'insuredPersonId',choices);select(row,'價值種類 *',v,'valueType',valueOptions);field(row,'金額 *',v,'amount');field(row,'貨幣',v,'currency');field(row,'保單年／年齡',v,'yearOrAge');row.append(button('刪除此價值',()=>{draft.values.splice(i,1);renderValues();}));valueList.append(row);});}
  valueSection.append(button('＋ 新增價值',()=>{draft.values.push({});renderValues();}));renderValues();
  const riderSection=section(root,'附加保障（選填，每行一項）'); const rider=node('textarea'); rider.value=draft.riders.join('\n');rider.addEventListener('input',()=>{draft.riders=rider.value.split('\n').map(s=>s.trim()).filter(Boolean);});rider.setAttribute('aria-label','附加保障');riderSection.append(rider);
  const error=node('p','', 'blocked-note');error.setAttribute('role','alert');root.append(error);
  const actions=node('div',null,'policy-actions'); actions.append(button('取消',onCancel));if(onBack) actions.append(button('返回列表',onBack));actions.append(button('核對資料',()=>onReview(draft,error)));root.append(actions);return root;
}
