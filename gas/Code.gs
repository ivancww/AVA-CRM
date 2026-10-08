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

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ success: true, data: readOfficialRegistry_(), revision: officialRevision_() });
}

function doPost(event) {
  try {
    const body = parseBody_(event);
    if (body.action === 'exchangeAdminSession') return json_(exchangeAdminSession_(body));
    if (body.action === 'replaceOfficialArea') return json_(replaceOfficialArea_(body));
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
  }
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
  return String(error && error.message || 'CRM Admin request failed').slice(0, 240);
}
