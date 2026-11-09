import { accumulatedValueTotal, ACCUMULATED_VALUE_TYPES, payoutReviewSignature } from './crm-core.js';
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
const categoryOptions = [['medical','醫療'],['critical','危疾'],['life','人壽'],['accident','意外'],['savings','儲蓄／資產'],['other','其他契約保障']];
const suggestedCategory = c => ({醫療:'medical',危疾:'critical',人壽:'life',意外:'accident',儲蓄:'savings',資產:'savings',medical:'medical',critical:'critical',life:'life',accident:'accident',savings:'savings',other:'other'})[String(c || '').trim().toLowerCase()] || '';
const valueOptions = [['current_policy_cash_value','現時現金價值'],['guaranteed_value','保證價值'],['non_guaranteed_value','非保證價值'],['cash_reserve','現金儲備戶口'],['annual_dividend','週年紅利'],['terminal_dividend','終期紅利'],['cash_value','現金價值'],['reversionary_bonus','復歸紅利'],['net_policy_value','原文件淨保單價值']];
export function makePolicyDraft(householdId, extracted = null) {
  const policy = extracted || {}; const sum = Array.isArray(policy.sumAssured) ? policy.sumAssured : [];
  const values = [];
  for (const v of Array.isArray(policy.cashValues) ? policy.cashValues : []) {
    // Legacy GAS cannot distinguish a reserve balance from value components.
    // Preserve ambiguous reserve data without classifying it as guaranteed value.
    const reserve=/現金儲備|cash\s*reserve/i.test(String(v.type || ''));
    if (v.guaranteed != null && v.guaranteed !== '') values.push({ valueType:reserve?'unclassified_document_value':'guaranteed_value', sourceType:v.type || '', component:'guaranteed', amount:v.guaranteed, currency:v.currency || '', yearOrAge:v.yearOrAge || '', insuredPersonId:'' });
    if (v.nonGuaranteed != null && v.nonGuaranteed !== '') values.push({ valueType:reserve?'unclassified_document_value':'non_guaranteed_value', sourceType:v.type || '', component:'non_guaranteed', amount:v.nonGuaranteed, currency:v.currency || '', yearOrAge:v.yearOrAge || '', insuredPersonId:'' });
  }
  const allowedValues = ['cash_reserve', 'annual_dividend', 'terminal_dividend', 'cash_value', 'reversionary_bonus', 'net_policy_value'];
  for (const v of Array.isArray(policy.structuredValues) ? policy.structuredValues : []) {
    if (allowedValues.includes(v.type) && v.amount != null) values.push({ valueType:v.type, amount:v.amount, currency:v.currency || '', valuationDate:v.valuationDate || '', conditions:v.conditions || '', includesComponents:v.includesComponents || [], insuredPersonId:'', verified:false });
  }
  const contracts = (policy.structuredRiders || []).map((r, i) => ({ ...r, contractId: `rider-${i+1}`, insuredPersonId: '', category: r.category || '', source: 'pdf' }));
  // Deployed legacy GAS returns rider names, not structured rider objects.
  // Preserve them as reviewable contracts without duplicating structured matches.
  const riderNameKey = name => String(name || '').normalize('NFKC').trim().toLocaleLowerCase();
  const seen = new Set(contracts.map(c => riderNameKey(c.name)).filter(Boolean));
  for (const rider of Array.isArray(policy.riders) ? policy.riders : []) {
    const name=typeof rider==='string' ? rider.trim() : ''; const key=riderNameKey(name);
    if (key && !seen.has(key)) {seen.add(key);contracts.push({name,contractId:`rider-${contracts.length+1}`,insuredPersonId:'',category:'',source:'pdf'});}
  }
  return { contracts, householdId, insurer:policy.insurer || '', productName:policy.productName || '', productVersion:policy.productVersion || '', policyNumber:policy.policyNumber || '', status:policy.policyStatus || '', issueDate:policy.issueDate || '', effectiveDate:policy.effectiveDate || '', premium:policy.premium?.amount ?? '', currency:policy.premium?.currency || '', paymentFrequency:policy.premium?.frequency || '', paymentTerm:policy.paymentTerm || '', coverageTerm:policy.coverageTerm || '', sumAssured:sum.length === 1 ? sum[0].amount ?? '' : '', sumAssuredCurrency:sum.length === 1 ? sum[0].currency || '' : '', policyHolderId:'', insuredPersonIds:[], hiddenContractualData:(policy.benefits || []).filter(b => /免付保費|豁免保費|waiver\s+of\s+premium/i.test(b.name || '')).map(b => ({...b})), benefits:(policy.benefits || []).filter(b => !/免付保費|豁免保費|waiver\s+of\s+premium/i.test(b.name || '')).map(b => ({ benefitType:b.name || '', amount:b.amount ?? '', limit:b.limit ?? '', currency:b.currency || '', primaryCategory:suggestedCategory(b.category), presentationTags:[], contractId:'', insuredPersonId:'', unit:'', benefitForm:'', notes:b.notes || '', extractedCategory:b.category || '', confidence:b.confidence, payoutScenario:b.payoutScenario && typeof b.payoutScenario==='object' ? {...b.payoutScenario} : null, payoutReviewSignature:'' })), values, riders:(policy.riders || []).map(r => typeof r === 'string' ? r : r?.name || '').filter(Boolean), extractedNames:extracted ? { holder:policy.policyholder?.name || '', insured:(policy.insuredPeople || []).map(p => p.name).filter(Boolean) } : null, extractionWarnings:extracted ? [...(policy.missingFields || []), ...(policy.conflicts || []), ...(policy.warnings || []), ...(sum.length > 1 ? ['識別到多項保障額，請核對並自行輸入所需金額'] : [])] : [], overallConfidence:policy.overallConfidence };
}
export function renderPolicyEditor({ draft, people, onReview, onCancel, onBack, extracted, onRerender }) {
  if (extracted) return renderAiPolicyEditor({draft, people, onReview, onCancel, onRerender});
  const root = node('div', null, 'policy-editor');
  if (extracted && !draft.categoryConfirmed) {
    root.append(node('h3', '步驟 1：確認產品保障分類'));
    root.append(node('p', '請按各項保障核對分類，同一保單可包含不同類別。', 'ava-support'));
    for (const benefit of draft.benefits) {
      const card = node('div', null, 'policy-repeat');
      card.append(node('strong', benefit.benefitType || '未命名保障'));
      if (benefit.extractedCategory) card.append(node('p', `AI 建議：${benefit.extractedCategory}`));
      select(card, '保障分類', benefit, 'primaryCategory', categoryOptions);
      root.append(card);
    }
    root.append(button('確認分類並核對保單', () => { draft.categoryConfirmed = true; onRerender(); }));
    root.append(button('取消', onCancel));
    return root;
  }
  if (extracted) root.append(button('返回確認分類', () => { draft.categoryConfirmed = false; onRerender(); }));
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
  function renderValues(){valueList.replaceChildren();draft.values.forEach((v,i)=>{const row=node('div',null,'policy-repeat');row.append(node('h4',`價值 ${i+1}`));select(row,'被保人 *',v,'insuredPersonId',choices);select(row,'價值種類 *',v,'valueType',valueOptions);field(row,'金額 *',v,'amount');field(row,'貨幣',v,'currency');field(row,'保單年／年齡',v,'yearOrAge');field(row,'估值日期（YYYY-MM-DD）',v,'valuationDate');field(row,'適用條件',v,'conditions');const verified=node('label');const check=node('input');check.type='checkbox';check.checked=v.verified === true;check.addEventListener('change',()=>{v.verified=check.checked;updateTotal();});verified.append(check,document.createTextNode(' 已核實'));row.append(verified);row.addEventListener('input',updateTotal);row.addEventListener('change',updateTotal);row.append(button('刪除此價值',()=>{draft.values.splice(i,1);renderValues();}));valueList.append(row);});}
  const totalDisplay=node('p'); function updateTotal(){const result=accumulatedValueTotal(draft.values); totalDisplay.textContent=result.complete ? `四類累積價值合計：${result.currency} ${result.total.toLocaleString()}（算術合計）` : '四類累積價值合計：資料未齊或條件不相符';} valueSection.append(totalDisplay);updateTotal();
  valueSection.append(button('＋ 新增價值',()=>{draft.values.push({});renderValues();}));renderValues();
  const riderSection=section(root,'附加保障（選填，每行一項）'); const rider=node('textarea'); rider.value=draft.riders.join('\n');rider.addEventListener('input',()=>{draft.riders=rider.value.split('\n').map(s=>s.trim()).filter(Boolean);});rider.setAttribute('aria-label','附加保障');riderSection.append(rider);
  const error=node('p','', 'blocked-note');error.setAttribute('role','alert');root.append(error);
  const actions=node('div',null,'policy-actions'); actions.append(button('取消',onCancel));if(onBack) actions.append(button('返回列表',onBack));actions.append(button('核對資料',()=>onReview(draft,error)));root.append(actions);return root;
}

const policyValueLabels = [['cash_reserve','現金儲備戶口'],['annual_dividend','週年紅利'],['terminal_dividend','終期紅利'],['cash_value','現金價值'],['reversionary_bonus','復歸紅利']];
const waiver = name => /免付保費|豁免保費|waiver\s+of\s+premium/i.test(String(name || ''));
function renderAiPolicyEditor({draft,people,onReview,onCancel,onRerender}) {
  const root=node('div',null,'policy-editor'); draft.newPeople ||= []; draft.contracts ||= [];
  if (!draft.categoryConfirmed) {
    root.append(node('h3','步驟 1：確認產品保障分類'));
    if(draft.officialProduct?.status==='exact'){const official=node('div',null,'policy-repeat');official.append(node('strong','產品資料（Official）'));for(const e of draft.officialProduct.entries || [])official.append(node('p',[e.category,e.feature,e.explanation,e.status ? `資料狀態：${e.status}` : ''].filter(Boolean).join(' · ')));official.append(node('small','按保險公司及產品名稱匹配；個別保單條款仍須核對。'));root.append(official);}
    for (const b of draft.benefits) { const card=node('div',null,'policy-repeat'); card.append(node('strong',b.benefitType || '未命名保障')); if(b.extractedCategory)card.append(node('p',`AI 建議：${b.extractedCategory}`)); select(card,'主要保障分類',b,'primaryCategory',categoryOptions);const tags=node('fieldset');tags.append(node('legend','其他適用分類'));b.presentationTags ||= [];for(const [id,label] of categoryOptions){const wrap=node('label'),box=node('input');box.type='checkbox';box.checked=b.presentationTags.includes(id);box.addEventListener('change',()=>{b.presentationTags=box.checked?[...new Set([...b.presentationTags,id])]:b.presentationTags.filter(x=>x!==id);});wrap.append(box,document.createTextNode(' '+label+' '));tags.append(wrap);}card.append(tags);root.append(card); }
    for (const c of draft.contracts.filter(c=>!waiver(c.name))) {const card=node('div',null,'policy-repeat');card.append(node('strong',c.name || '附加契約'));select(card,'契約分類',c,'category',categoryOptions);root.append(card);}
    root.append(button('確認分類並核對保單',()=>{draft.categoryConfirmed=true;onRerender();}),button('取消',onCancel));return root;
  }
  root.append(button('返回確認分類',()=>{draft.categoryConfirmed=false;onRerender();}));
  const personSection=node('section');personSection.append(node('h3','人物資料'));
  personSection.append(node('p',`AI 識別持有人：${draft.extractedNames?.holder || '未識別'}；受保人：${draft.extractedNames?.insured?.join('、') || '未識別'}。請核對並選擇家庭人物。`));
  const all=[...people,...draft.newPeople], choices=all.map(p=>[p.id,`${p.name || '新受保人'} · ${p.relationship || ''}`]);
  select(personSection,'保單持有人 *',draft,'policyHolderId',choices);
  const insured=node('fieldset');insured.append(node('legend','受保人 *（可選多人）'));
  for(const p of all){const label=node('label'), box=node('input');box.type='checkbox';box.checked=draft.insuredPersonIds.includes(p.id);box.addEventListener('change',()=>{if(box.checked){if(!draft.insuredPersonIds.includes(p.id))draft.insuredPersonIds.push(p.id);}else draft.insuredPersonIds=draft.insuredPersonIds.filter(id=>id!==p.id);});label.append(box,document.createTextNode(` ${p.name || '新受保人'} `));insured.append(label);}personSection.append(insured);
  personSection.append(button('＋ 新增受保人',()=>{const id=crypto.randomUUID();draft.newPeople.push({id,name:'',relationship:''});draft.insuredPersonIds.push(id);onRerender();}));
  draft.newPeople.forEach((person,i)=>{const box=node('div',null,'policy-repeat');field(box,'姓名 *',person,'name');field(box,'與客戶關係 *',person,'relationship');box.append(button('更新人物選項',onRerender),button('移除此受保人',()=>{draft.newPeople.splice(i,1);draft.insuredPersonIds=draft.insuredPersonIds.filter(id=>id!==person.id);for(const item of [...draft.benefits,...draft.values,...draft.contracts])if(item.insuredPersonId===person.id)item.insuredPersonId='';onRerender();}));personSection.append(box);});root.append(personSection);
  const contracts=node('section');contracts.append(node('h3','主險＋附加契約'));const main=node('div',null,'policy-repeat');main.append(node('h4','主險'));
  for(const [label,key] of [['保險公司 *','insurer'],['產品名稱 *','productName'],['產品版本','productVersion'],['保單號碼 *','policyNumber'],['保單狀態','status'],['簽發日期','issueDate'],['生效日期','effectiveDate'],['保費','premium'],['保費貨幣','currency'],['繳費頻率','paymentFrequency'],['繳費期','paymentTerm'],['保障期','coverageTerm'],['保障額','sumAssured'],['保障額貨幣','sumAssuredCurrency'],['保障範圍','protectionScope']])field(main,label,draft,key);contracts.append(main);
  for(const c of draft.contracts.filter(c=>!waiver(c.name))){const card=section(contracts,c.name || '附加契約');const grid=node('div',null,'policy-form-grid');card.append(grid);select(grid,'受保人',c,'insuredPersonId',choices);for(const [label,key] of [['產品名稱','name'],['保費','premium'],['保費貨幣','premiumCurrency'],['繳費頻率','paymentFrequency'],['保障額','sumAssured'],['保障額貨幣','currency'],['生效日期','effectiveDate'],['繳費期','paymentTerm'],['已繳清日期','paidUpDate'],['保障期','coverageTerm'],['保障範圍','protectionScope'],['每年墊底費／自付額','annualDeductible'],['每年賠償限額','annualLimit'],['個人終身賠償限額','lifetimeLimit']])field(grid,label,c,key);if(c.category==='medical'){const label=node('label'),check=node('input');check.type='checkbox';check.checked=c.limitsVerified===true;check.addEventListener('change',()=>{c.limitsVerified=check.checked;});label.append(check,document.createTextNode(' 我已核對醫療限額'));grid.append(label);grid.addEventListener('input',event=>{if(['annualDeductible','annualLimit','lifetimeLimit'].includes(event.target.name)){c.limitsVerified=false;check.checked=false;}});}}
  const bList=node('div');contracts.append(bList);function benefits(){bList.replaceChildren();draft.benefits.forEach((b,i)=>{if(waiver(b.benefitType))return;const box=node('div',null,'policy-repeat');box.append(node('h4',b.benefitType || '保障'));select(box,'受保人 *',b,'insuredPersonId',choices);select(box,'分類 *',b,'primaryCategory',categoryOptions);select(box,'所屬附加契約（主險可留空）',b,'contractId',draft.contracts.filter(c=>!waiver(c.name)).map(c=>[c.contractId,c.name]));for(const [label,key] of [['保障名稱 *','benefitType'],['金額','amount'],['貨幣','currency'],['限額說明','limit'],['備註','notes']])field(box,label,b,key);
    if(b.payoutScenario){const q=b.payoutScenario, review=node('div',null,'ava-support');const relationship={additional:'可額外賠償',shared:'與其他保障共用',reducing:'保障額可能遞減',reimbursement:'按合資格費用報銷'}[q.relationship] || '關係未明';review.append(node('p',`文件情境：${q.label || '未有'}；日期：${q.date || '未有'}；金額：${q.payableAmount ?? '未有'} ${q.currency || ''}；${relationship}；適用期：${q.startDate || '未有'} 至 ${q.endDate || '未有'}；依據：${q.source || '未有'}；文件頁數：${q.sourcePage ?? '未有'}；文件原文：${q.sourceExcerpt || '未有'}。`));const lbl=node('label'),check=node('input');check.type='checkbox';check.checked=Boolean(b.payoutReviewSignature && b.payoutReviewSignature===payoutReviewSignature(b));check.addEventListener('change',()=>{b.payoutReviewSignature=check.checked?payoutReviewSignature(b):'';});lbl.append(check,document.createTextNode(' 我已核對以上資料及文件依據'));review.append(lbl);box.append(review);box.addEventListener('input',event=>{if(event.target!==check){b.payoutReviewSignature='';check.checked=false;}});box.addEventListener('change',event=>{if(event.target!==check){b.payoutReviewSignature='';check.checked=false;}});}
    box.append(button('刪除此保障',()=>{draft.benefits.splice(i,1);benefits();}));bList.append(box);});}benefits();contracts.append(button('＋ 新增保障',()=>{draft.benefits.push({});benefits();}));root.append(contracts);
  const values=node('section');values.append(node('h3','保單價值'));const card=node('div',null,'policy-repeat');card.append(node('p','現金儲備戶口與四類累積價值分開顯示；算術合計不代表可提取金額。'));
  const valueOwner=node('div');select(valueOwner,'保單價值所屬受保人',draft,'valuePersonId',choices);valueOwner.addEventListener('change',()=>{for(const v of draft.values) if(policyValueLabels.some(([t])=>t===v.valueType)) v.insuredPersonId=draft.valuePersonId;updateTotal();});card.append(valueOwner);
  for(const [type,label] of policyValueLabels){let v=draft.values.find(x=>x.valueType===type);if(!v){v={valueType:type,amount:'',currency:'',valuationDate:'',insuredPersonId:draft.valuePersonId || '',verified:false};draft.values.push(v);}const row=node('div',null,'policy-form-grid');row.append(node('h4',label));field(row,'金額',v,'amount');field(row,'貨幣',v,'currency');const details=section(row,'估值資料');field(details,'估值日期（YYYY-MM-DD）',v,'valuationDate');field(details,'適用條件',v,'conditions');const labelNode=node('label'),check=node('input');check.type='checkbox';check.checked=v.verified===true;check.addEventListener('change',()=>{v.verified=check.checked;updateTotal();});labelNode.append(check,document.createTextNode(' 已核對'));details.append(labelNode);row.addEventListener('input',event=>{if(event.target!==check){v.verified=false;check.checked=false;}updateTotal();});card.append(row);}
  const total=node('p');function updateTotal(){const result=accumulatedValueTotal(draft.values);total.textContent=result.complete ? `四類累積價值合計：${result.currency} ${result.total.toLocaleString()}（算術合計）` : '四類累積價值合計：資料未齊或條件不相符';}card.append(total);updateTotal();
  const primaryValues=new Set(policyValueLabels.map(([type])=>draft.values.find(v=>v.valueType===type)).filter(Boolean));
  const other=draft.values.filter(v=>!primaryValues.has(v));
  if(other.length){const extra=section(card,'原有及其他文件價值');for(const v of other){const row=node('div',null,'policy-form-grid');row.append(node('h4',v.sourceType ? `${v.sourceType}（原文件資料）` : v.valueType));select(row,'受保人',v,'insuredPersonId',choices);field(row,'金額',v,'amount');field(row,'貨幣',v,'currency');field(row,'保單年／年齡',v,'yearOrAge');field(row,'估值日期',v,'valuationDate');extra.append(row);}}
  values.append(card);root.append(values);
  const error=node('p','','blocked-note');error.setAttribute('role','alert');root.append(error);const actions=node('div',null,'policy-actions');actions.append(button('取消',onCancel),button('核對資料',()=>onReview(draft,error)));root.append(actions);return root;
}
