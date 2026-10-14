/**
 * AVA-CRM Official Configuration Web App.
 *
 * Deploy this file as the CRM-owned, spreadsheet-bound GAS Web App only after
 * the deployment requirements in gas/README.md have been completed. This
 * source intentionally does not enable the CRM Admin entry or expose private
 * CRM/User-layer data.
 */
const CRM_APP_ID = 'crm';
const PLATFORM_ADMIN_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzVf1fuxcq8GPSOzS8WvcAtubqaawFj0rbVjxe0LOLKfwbYkRZf7Vs61Q0T73UG6dznww/exec';

// These are the existing Official Registry areas consumed by crm-core.js.
// Product Feature Registry records remain part of the verified 產品資料 area.
const OFFICIAL_SHEETS = Object.freeze({
  pageSettings: '頁面設定',
  reviewQuestions: 'Review問題',
  coverageCategories: '保障分類',
  productDefinitions: '產品資料',
  systemSettings: '系統設定'
});

// No browser-provided sheet name, range, or arbitrary operation is accepted.
const OFFICIAL_OPERATIONS = Object.freeze({
  replacePageSettings: OFFICIAL_SHEETS.pageSettings,
  replaceReviewQuestions: OFFICIAL_SHEETS.reviewQuestions,
  replaceCoverageCategories: OFFICIAL_SHEETS.coverageCategories,
  replaceProductDefinitions: OFFICIAL_SHEETS.productDefinitions,
  replaceSystemSettings: OFFICIAL_SHEETS.systemSettings
});

// Read-only policy extraction limits. The document is sent inline to Gemini
// and is never written to Drive, Sheets, Properties, or a CRM data store.
const GEMINI_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const GEMINI_SUPPORTED_MIME_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const GEMINI_RETRY_DELAYS_MS = Object.freeze([0, 2000, 5000]);
const GEMINI_EXTRACTION_SCHEMA = Object.freeze({
  type: 'OBJECT',
  properties: {
    documentType: { type: 'STRING' },
    policies: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      insurer: { type: 'STRING' }, productName: { type: 'STRING' }, productVersion: { type: 'STRING' }, policyNumber: { type: 'STRING' },
      policyholder: { type: 'OBJECT', properties: { name: { type: 'STRING' }, confidence: { type: 'NUMBER' } } },
      insuredPeople: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, relationship: { type: 'STRING' }, confidence: { type: 'NUMBER' } } } },
      policyStatus: { type: 'STRING' }, issueDate: { type: 'STRING' }, effectiveDate: { type: 'STRING' },
      premium: { type: 'OBJECT', properties: { amount: { type: 'NUMBER' }, currency: { type: 'STRING' }, frequency: { type: 'STRING' }, confidence: { type: 'NUMBER' } } },
      paymentTerm: { type: 'STRING' }, coverageTerm: { type: 'STRING' },
      sumAssured: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, amount: { type: 'NUMBER' }, currency: { type: 'STRING' }, confidence: { type: 'NUMBER' } } } },
      benefits: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, category: { type: 'STRING' }, amount: { type: 'NUMBER' }, currency: { type: 'STRING' }, limit: { type: 'STRING' }, notes: { type: 'STRING' }, confidence: { type: 'NUMBER' } } } },
      cashValues: { type: 'ARRAY', items: { type: 'OBJECT', properties: { type: { type: 'STRING' }, yearOrAge: { type: 'STRING' }, guaranteed: { type: 'NUMBER' }, nonGuaranteed: { type: 'NUMBER' }, currency: { type: 'STRING' }, confidence: { type: 'NUMBER' } } } },
      riders: { type: 'ARRAY', items: { type: 'STRING' } }, keyDates: { type: 'ARRAY', items: { type: 'STRING' } }, missingFields: { type: 'ARRAY', items: { type: 'STRING' } }, conflicts: { type: 'ARRAY', items: { type: 'STRING' } }, warnings: { type: 'ARRAY', items: { type: 'STRING' } }, overallConfidence: { type: 'NUMBER' }
    } } },
    documentWarnings: { type: 'ARRAY', items: { type: 'STRING' } }
  }
});

const GEMINI_EXTRACTION_PROMPT = [
  'You are a read-only insurance policy document extraction engine.',
  'Extract only information explicitly present in the supplied document.',
  'Never invent, estimate, or infer missing values. Use empty strings, null, or empty arrays when unknown.',
  'Preserve original wording where appropriate. Keep explicit data separate from inferred data.',
  'Put uncertainty in warnings or the relevant confidence field, and put contradictory document statements in conflicts.',
  'Inspect the entire document and determine how many independent policies it contains.',
  'Separate independent policies by distinct policy identity, product, policy section, insured contract, or policy schedule.',
  'Return every identified independent policy in policies[]. Never collapse separate policies merely because they share an insurer, policyholder, or insured person.',
  'If policy boundaries are uncertain, preserve that uncertainty in documentWarnings or policy conflicts instead of silently merging records.',
  'Do not provide insurance advice. Do not calculate values that are not present in the document.',
  'Return only JSON matching the supplied extraction schema.'
].join(' ');

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ success: true, data: readOfficialRegistry_(), revision: officialRevision_() });
}

function doPost(event) {
  let body;
  try {
    body = parseBody_(event);
    if (body.action === 'exchangeAdminSession') return json_(exchangeAdminSession_(body));
    if (body.action === 'replaceOfficialArea') return json_(replaceOfficialArea_(body));
    if (body.action === 'extractPolicyDocument') return json_(extractPolicyDocument_(body));
    return json_({ success: false, error: 'Unsupported CRM Admin action' });
  } catch (error) {
    return json_({ success: false, error: safeError_(error) });
  }
}

function parseBody_(event) {
  if (!event || !event.postData || typeof event.postData.contents !== 'string') throw new Error('Request body is required');
  let body;
  try { body = JSON.parse(event.postData.contents); } catch (_) { throw new Error('Malformed JSON body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object is required');
  return body;
}

function exchangeAdminSession_(body) {
  ['launchTicket','launchNonce','browserProof','appId'].forEach(key => requireText_(body[key], key, 200));
  if (body.appId !== CRM_APP_ID) throw new Error('Invalid App ID');
  const response = platformRequest_({ action: 'exchangeAdminSession', launchTicket: body.launchTicket, launchNonce: body.launchNonce, browserProof: body.browserProof, appId: CRM_APP_ID });
  const expiry = Date.parse(String(response.expiresAt || ''));
  if (response.success !== true || response.appId !== CRM_APP_ID || response.contract !== 'ava-admin-session-v1' || !response.adminSessionProof || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('CRM Admin launch was not authorized');
  return { success: true, appId: CRM_APP_ID, adminSessionProof: String(response.adminSessionProof), expiresAt: String(response.expiresAt), contract: response.contract };
}

function replaceOfficialArea_(body) {
  const operation = requireText_(body.operation, 'operation', 80), sheetName = OFFICIAL_OPERATIONS[operation];
  if (!sheetName || body.appId !== CRM_APP_ID) throw new Error('Operation is not allowed');
  const rows = validateRows_(body.rows, sheetName), proof = requireText_(body.adminSessionProof, 'adminSessionProof', 400), expectedVersion = requireText_(body.expectedVersion, 'expectedVersion', 200);
  verifyAdminSession_(proof, 'crm:official-write:' + operation);
  const lock = LockService.getScriptLock(); lock.waitLock(10000); let snapshot;
  try {
    if (expectedVersion !== officialRevision_()) throw new Error('Stale Official revision');
    const sheet = sheet_(sheetName); const headers = headers_(sheet); assertSheetSafeForReplacement_(sheet, headers.length); snapshot = snapshotSheet_(sheet);
    const values = rows.map(row => headers.map(header => row[header] ?? ''));
    if (values.length + 1 > sheet.getMaxRows()) throw new Error('Official sheet capacity is insufficient');
    if (values.length) sheet.getRange(2, 1, values.length, headers.length).setValues(values);
    const trailing = Math.max(0, sheet.getLastRow() - 1 - values.length); if (trailing) sheet.getRange(values.length + 2, 1, trailing, headers.length).clearContent();
    const actual = rows_(sheet); if (JSON.stringify(actual) !== JSON.stringify(rows)) throw new Error('Official read-after-write verification failed');
    return { success: true, appId: CRM_APP_ID, operation, area: sheetName, count: rows.length, revision: officialRevision_() };
  } catch (error) { if (snapshot) restoreSheet_(snapshot); throw error; } finally { lock.releaseLock(); }
}

function extractPolicyDocument_(body) {
  const startedAt = Date.now();
  let input;
  let model = '';
  try {
    input = validateExtractionRequest_(body);
    const apiKey = String(PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '').trim();
    model = String(PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || '').trim();
    if (!apiKey) throw extractionError_('Gemini API key is not configured', 'missing-api-key', 'AI服務設定不完整，請由管理員檢查服務設定。');
    if (!model) throw extractionError_('Gemini model is not configured', 'missing-model', 'AI服務設定不完整，請由管理員檢查服務設定。');
    const response = callGeminiForExtraction_(model, apiKey, input);
    const extracted = normalizePolicyExtraction_(parseGeminiExtraction_(response));
    if (!hasMeaningfulExtraction_(extracted)) throw extractionError_('Gemini returned an empty extraction', 'empty-extraction', '文件未能讀取出可核對的保單資料，請確認文件清晰後再試。');
    logExtraction_({ model, status: 200, durationMs: Date.now() - startedAt, mimeType: input.mimeType, fileSize: input.fileSize, outcome: 'success' });
    return { success: true, mode: 'read-only', data: extracted };
  } catch (error) {
    logExtraction_({ model, status: Number(error && error.httpStatus) || 0, durationMs: Date.now() - startedAt, mimeType: input?.mimeType || '', fileSize: input?.fileSize || 0, outcome: error && error.failureClass || 'failure' });
    throw error;
  }
}

function validateExtractionRequest_(body) {
  const allowedKeys = ['action', 'fileName', 'mimeType', 'base64Data'];
  if (!body || body.action !== 'extractPolicyDocument' || Object.keys(body).some(key => allowedKeys.indexOf(key) === -1)) throw extractionError_('Invalid extraction action', 'invalid-action', '文件讀取要求無效，請重新選擇文件。');
  const fileName = requireText_(body.fileName, 'fileName', 180);
  if (/[\r\n]/.test(fileName)) throw extractionError_('Invalid file name', 'invalid-file-name', '文件讀取要求無效，請重新選擇文件。');
  const mimeType = String(body.mimeType || '').trim().toLowerCase();
  if (GEMINI_SUPPORTED_MIME_TYPES.indexOf(mimeType) === -1) throw extractionError_('Unsupported document MIME type', 'unsupported-mime', '只支援 PDF、JPEG、PNG 或 WEBP 文件。');
  const base64Data = String(body.base64Data || '');
  if (!base64Data) throw extractionError_('Document payload is empty', 'empty-file', '文件內容是空白，請重新選擇文件。');
  if (base64Data.length > Math.ceil(GEMINI_MAX_DOCUMENT_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data) || base64Data.length % 4 !== 0) throw extractionError_('Document payload is malformed', 'malformed-base64', '文件資料格式無效，請重新選擇文件。');
  const fileSize = Math.floor(base64Data.length * 3 / 4) - (base64Data.endsWith('==') ? 2 : base64Data.endsWith('=') ? 1 : 0);
  if (fileSize <= 0) throw extractionError_('Document payload is empty', 'empty-file', '文件內容是空白，請重新選擇文件。');
  if (fileSize > GEMINI_MAX_DOCUMENT_BYTES) throw extractionError_('Document is oversized', 'oversized-file', '文件太大，請選擇 8 MB 或以下的文件。');
  try { Utilities.base64Decode(base64Data); } catch (_) { throw extractionError_('Document payload is malformed', 'malformed-base64', '文件資料格式無效，請重新選擇文件。'); }
  return { fileName, mimeType, base64Data, fileSize };
}

function callGeminiForExtraction_(model, apiKey, input) {
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  const payload = {
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: input.mimeType, data: input.base64Data } }, { text: GEMINI_EXTRACTION_PROMPT }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: GEMINI_EXTRACTION_SCHEMA }
  };
  let lastStatus = 0;
  for (let attempt = 0; attempt < GEMINI_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) Utilities.sleep(GEMINI_RETRY_DELAYS_MS[attempt]);
    let response;
    try {
      response = UrlFetchApp.fetch(endpoint, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
    } catch (_) {
      throw extractionError_('Gemini request failed', 'request-failed', 'AI文件讀取未完成，請稍後再試。');
    }
    lastStatus = response.getResponseCode();
    if (lastStatus === 503 && attempt < GEMINI_RETRY_DELAYS_MS.length - 1) continue;
    if (lastStatus === 429 || lastStatus === 503) throw extractionError_('Gemini service is temporarily busy', lastStatus === 503 ? 'http-503' : 'http-429', 'AI服務暫時繁忙，請稍後再試。', lastStatus);
    if (lastStatus < 200 || lastStatus >= 300) throw extractionError_('Gemini request was rejected', 'http-' + lastStatus, 'AI文件讀取未完成，請稍後再試。', lastStatus);
    try { return JSON.parse(response.getContentText()); } catch (_) { throw extractionError_('Gemini response was malformed', 'invalid-upstream-json', 'AI文件讀取未完成，請稍後再試。', lastStatus); }
  }
  throw extractionError_('Gemini service is temporarily busy', 'http-' + lastStatus, 'AI服務暫時繁忙，請稍後再試。', lastStatus);
}

function parseGeminiExtraction_(response) {
  const candidate = response && response.candidates && response.candidates[0];
  if (!candidate) throw extractionError_('Gemini returned no candidate', 'empty-response', '文件未能讀取出可核對的保單資料，請確認文件清晰後再試。');
  if (candidate.finishReason && candidate.finishReason !== 'STOP') throw extractionError_('Gemini refused or stopped the document extraction', 'model-refusal', 'AI未能完成文件讀取，請確認文件內容及清晰度後再試。');
  const text = (candidate.content && candidate.content.parts || []).map(part => part && part.text || '').join('').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!text) throw extractionError_('Gemini returned no extraction JSON', 'empty-response', '文件未能讀取出可核對的保單資料，請確認文件清晰後再試。');
  try { return JSON.parse(text); } catch (_) { throw extractionError_('Gemini extraction JSON is invalid', 'invalid-extraction-json', 'AI回傳格式無效，請稍後再試。'); }
}

function normalizePolicyExtraction_(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw extractionError_('Gemini extraction is not an object', 'invalid-extraction', 'AI回傳格式無效，請稍後再試。');
  const rawPolicies = Array.isArray(value.policies) ? value.policies : isLegacyPolicyExtraction_(value) ? [value] : [];
  const policies = rawPolicies.slice(0, 100).filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(normalizePolicyRecord_);
  if (!policies.length) throw extractionError_('Gemini returned no policies', 'empty-extraction', '文件未能讀取出可核對的保單資料，請確認文件清晰後再試。');
  return { documentType: extractionText_(value.documentType), policies, documentWarnings: extractionTextArray_(value.documentWarnings) };
}

function isLegacyPolicyExtraction_(value) {
  return Object.prototype.hasOwnProperty.call(value, 'policyNumber') || Object.prototype.hasOwnProperty.call(value, 'insurer') || Object.prototype.hasOwnProperty.call(value, 'productName') || Object.prototype.hasOwnProperty.call(value, 'policyholder') || Object.prototype.hasOwnProperty.call(value, 'insuredPeople') || Object.prototype.hasOwnProperty.call(value, 'premium');
}

function normalizePolicyRecord_(value) {
  const policyholder = value.policyholder && typeof value.policyholder === 'object' ? value.policyholder : {};
  const premium = value.premium && typeof value.premium === 'object' ? value.premium : {};
  return {
    insurer: extractionText_(value.insurer), productName: extractionText_(value.productName), productVersion: extractionText_(value.productVersion), policyNumber: extractionText_(value.policyNumber),
    policyholder: { name: extractionText_(policyholder.name), confidence: extractionConfidence_(policyholder.confidence) },
    insuredPeople: extractionArray_(value.insuredPeople, item => ({ name: extractionText_(item && item.name), relationship: extractionText_(item && item.relationship), confidence: extractionConfidence_(item && item.confidence) })),
    policyStatus: extractionText_(value.policyStatus), issueDate: extractionText_(value.issueDate), effectiveDate: extractionText_(value.effectiveDate),
    premium: { amount: extractionNumber_(premium.amount), currency: extractionText_(premium.currency), frequency: extractionText_(premium.frequency), confidence: extractionConfidence_(premium.confidence) },
    paymentTerm: extractionText_(value.paymentTerm), coverageTerm: extractionText_(value.coverageTerm),
    sumAssured: extractionArray_(value.sumAssured, item => ({ name: extractionText_(item && item.name), amount: extractionNumber_(item && item.amount), currency: extractionText_(item && item.currency), confidence: extractionConfidence_(item && item.confidence) })),
    benefits: extractionArray_(value.benefits, item => ({ name: extractionText_(item && item.name), category: extractionText_(item && item.category), amount: extractionNumber_(item && item.amount), currency: extractionText_(item && item.currency), limit: extractionText_(item && item.limit), notes: extractionText_(item && item.notes), confidence: extractionConfidence_(item && item.confidence) })),
    cashValues: extractionArray_(value.cashValues, item => ({ type: extractionText_(item && item.type), yearOrAge: extractionText_(item && item.yearOrAge), guaranteed: extractionNumber_(item && item.guaranteed), nonGuaranteed: extractionNumber_(item && item.nonGuaranteed), currency: extractionText_(item && item.currency), confidence: extractionConfidence_(item && item.confidence) })),
    riders: extractionTextArray_(value.riders), keyDates: extractionTextArray_(value.keyDates), missingFields: extractionTextArray_(value.missingFields), conflicts: extractionTextArray_(value.conflicts), warnings: extractionTextArray_(value.warnings), overallConfidence: extractionConfidence_(value.overallConfidence)
  };
}

function extractionText_(value) { return value === null || value === undefined ? '' : String(value).slice(0, 4000); }
function extractionNumber_(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function extractionConfidence_(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null; }
function extractionArray_(value, mapper) { return Array.isArray(value) ? value.slice(0, 100).filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(mapper) : []; }
function extractionTextArray_(value) { return Array.isArray(value) ? value.slice(0, 100).map(item => extractionText_(typeof item === 'string' ? item : JSON.stringify(item))).filter(Boolean) : []; }
function hasMeaningfulExtraction_(value) { return Boolean(value && Array.isArray(value.policies) && value.policies.some(policy => policy && (policy.insurer || policy.productName || policy.policyNumber || policy.policyholder.name || policy.insuredPeople.length || policy.premium.amount !== null || policy.benefits.length || policy.cashValues.length || policy.sumAssured.length))); }
function extractionError_(message, failureClass, publicMessage, httpStatus) { const error = new Error(message); error.failureClass = failureClass; error.publicMessage = publicMessage; error.httpStatus = httpStatus || 0; return error; }
function logExtraction_(entry) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: 'crm-policy-extraction', model: entry.model || '', httpStatus: entry.status || 0, durationMs: entry.durationMs || 0, mimeType: entry.mimeType || '', fileSize: entry.fileSize || 0, outcome: entry.outcome || 'failure' })); }

function verifyAdminSession_(proof, operation) {
  const response = platformRequest_({ action: 'verifyAdminSession', adminSessionProof: proof, appId: CRM_APP_ID, operation });
  const expiry = Date.parse(String(response.expiresAt || ''));
  if (response.success !== true || response.appId !== CRM_APP_ID || response.operation !== operation || response.contract !== 'ava-admin-session-v1' || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('Invalid or expired CRM Admin session');
  return response;
}

function platformRequest_(body) {
  const response = UrlFetchApp.fetch(PLATFORM_ADMIN_ENDPOINT, {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  let result;
  try { result = JSON.parse(response.getContentText()); } catch (_) { throw new Error('Invalid AVA Platform authorization response'); }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || result.success !== true) throw new Error(String(result.error || 'AVA Platform authorization failed'));
  return result;
}

function officialRevision_() { const text = JSON.stringify(readOfficialRegistry_()); return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text).map(byte => (byte + 256).toString(16).slice(-2)).join(''); }
function snapshotSheet_(sheet) { const range = sheet.getDataRange(); return { sheet, values: range.getValues(), formulas: range.getFormulas() }; }
function restoreSheet_(snapshot) { snapshot.sheet.getDataRange().clearContent(); if (!snapshot.values.length) return; snapshot.sheet.getRange(1, 1, snapshot.values.length, snapshot.values[0].length).setValues(snapshot.values); snapshot.formulas.forEach((row, r) => row.forEach((formula, c) => { if (formula) snapshot.sheet.getRange(r + 1, c + 1).setFormula(formula); })); }

function readOfficialRegistry_() {
  return Object.fromEntries(Object.values(OFFICIAL_SHEETS).map(name => [name, rows_(sheet_(name))]));
}

function validateRows_(value, sheetName) {
  if (!Array.isArray(value) || value.length > 5000) throw new Error(`Rows for ${sheetName} are required`);
  const headers = headers_(sheet_(sheetName));
  const allowed = new Set(headers);
  return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Each Official row must be an object');
    const keys = Object.keys(row);
    if (keys.length !== headers.length || headers.some(header => !Object.prototype.hasOwnProperty.call(row, header)) || keys.some(key => !allowed.has(key))) throw new Error(`Official row schema mismatch for ${sheetName}`);
    if (keys.some(key => !scalar_(row[key]))) throw new Error(`Unsupported Official value for ${sheetName}`);
    return row;
  });
}

function scalar_(value) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return true;
  return typeof value === 'string' && value.length <= 20000 && !value.startsWith('=');
}

function sheet_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error(`Missing Official sheet: ${name}`);
  return sheet;
}

function headers_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (!lastColumn) throw new Error('Official sheet has no header');
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
}

function assertSheetSafeForReplacement_(sheet, columnCount) {
  if (sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).some(protection => protection.isProtected())) throw new Error(`Official sheet is protected: ${sheet.getName()}`);
  if (sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).some(protection => protection.isProtected())) throw new Error(`Official sheet has protected ranges: ${sheet.getName()}`);
  if (sheet.getFilter()) throw new Error(`Official sheet has an active filter: ${sheet.getName()}`);
  if (sheet.getDataRange().getMergedRanges().length) throw new Error(`Official sheet has merged cells: ${sheet.getName()}`);
  for (let column = 1; column <= columnCount; column += 1) if (sheet.isColumnHiddenByUser(column)) throw new Error(`Official sheet has hidden columns: ${sheet.getName()}`);
  for (let row = 1; row <= Math.max(sheet.getLastRow(), 1); row += 1) if (sheet.isRowHiddenByUser(row)) throw new Error(`Official sheet has hidden rows: ${sheet.getName()}`);
  const formulas = sheet.getDataRange().getFormulas();
  if (formulas.some(row => row.some(Boolean))) throw new Error(`Official sheet contains formulas: ${sheet.getName()}`);
}

function rows_(sheet) {
  const headers = headers_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().filter(row => row.some(Boolean)).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

function requireText_(value, name, maxLength) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength) throw new Error(`${name} is invalid`);
  return text;
}

function safeError_(error) {
  if (error && error.publicMessage) return String(error.publicMessage).slice(0, 240);
  return String(error && error.message || 'CRM Admin request failed').slice(0, 240);
}
