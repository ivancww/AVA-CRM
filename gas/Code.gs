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
  return json_({ success: true, data: readOfficialRegistry_() });
}

function doPost(event) {
  try {
    const body = parseBody_(event);
    if (body.action === 'exchangeAppLaunch') return json_(exchangeAppLaunch_(body.launchTicket));
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
  return body;
}

function exchangeAppLaunch_(launchTicket) {
  const ticket = requireText_(launchTicket, 'launchTicket', 200);
  const response = platformRequest_({ action: 'exchangeAppLaunch', launchTicket: ticket, appId: CRM_APP_ID });
  if (response.success !== true || !response.appGrant || !response.expiresAt) throw new Error('CRM Admin launch was not authorized');
  return { success: true, appGrant: String(response.appGrant), expiresAt: String(response.expiresAt) };
}

function replaceOfficialArea_(body) {
  const operation = requireText_(body.operation, 'operation', 80);
  const sheetName = OFFICIAL_OPERATIONS[operation];
  if (!sheetName) throw new Error('Operation is not allowed');
  const rows = validateRows_(body.rows, sheetName);
  verifyAppGrant_(body.appGrant, operation);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = sheet_(sheetName);
    const headers = headers_(sheet);
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows.map(row => headers.map(header => row[header] ?? '')));
    return { success: true, operation, area: sheetName, count: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function verifyAppGrant_(appGrant, operation) {
  const grant = requireText_(appGrant, 'appGrant', 200);
  const response = platformRequest_({ action: 'verifyAppGrant', appGrant: grant, appId: CRM_APP_ID, operation });
  if (response.success !== true || String(response.appId) !== CRM_APP_ID || String(response.operation) !== operation) throw new Error('Invalid or unauthorized CRM App grant');
  const expiry = Date.parse(String(response.expiresAt || ''));
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('CRM App grant expired');
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
