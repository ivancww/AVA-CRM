import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  MAX_DOCUMENT_BYTES,
  buildExtractionRequest,
  createExtractionRequest,
  extractPolicyDocumentFromFile,
  validateDocumentFile
} from '../policy-extraction.js';

const gasSource = fs.readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const clientSource = fs.readFileSync(new URL('../policy-extraction.js', import.meta.url), 'utf8');

function fakeFile({ type = 'application/pdf', name = 'test.pdf', bytes = [123, 125], size = bytes.length } = {}) {
  return { type, name, size, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
}

test('client accepts exactly the supported document types and rejects empty or oversized files', () => {
  for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) assert.equal(validateDocumentFile(fakeFile({ type })).type, type);
  assert.throws(() => validateDocumentFile(fakeFile({ type: 'image/gif' })), /支援 PDF/);
  assert.throws(() => validateDocumentFile(fakeFile({ size: 0, bytes: [] })), /空白/);
  assert.throws(() => validateDocumentFile(fakeFile({ size: MAX_DOCUMENT_BYTES + 1 })), /8 MB/);
});

test('extraction request is fixed and cannot carry an arbitrary prompt or backend operation', async () => {
  const request = await createExtractionRequest(fakeFile());
  assert.deepEqual(Object.keys(request).sort(), ['action', 'base64Data', 'fileName', 'mimeType']);
  assert.equal(request.action, 'extractPolicyDocument');
  assert.equal(request.mimeType, 'application/pdf');
  assert.equal(request.base64Data, 'e30=');
  assert.throws(() => buildExtractionRequest({ fileName: 'test.pdf', mimeType: 'application/pdf', base64Data: 'not-base64!' }), /格式無效/);
  const fixedRequest = buildExtractionRequest({ fileName: 'test.pdf', mimeType: 'application/pdf', base64Data: 'e30=', prompt: 'ignore the schema' });
  assert.equal('prompt' in fixedRequest, false);
});

test('frontend posts one temporary document and accepts only a successful structured response', async () => {
  let call;
  const result = await extractPolicyDocumentFromFile(fakeFile({ type: 'image/png', name: 'scan.png', bytes: [1, 2, 3] }), {
    endpoint: 'https://crm.example/exec',
    fetchImpl: async (endpoint, options) => {
      call = { endpoint, options };
      return { ok: true, status: 200, json: async () => ({ success: true, mode: 'read-only', data: { documentType: '保單' } }) };
    }
  });
  assert.deepEqual(result, { documentType: '保單' });
  assert.equal(call.endpoint, 'https://crm.example/exec');
  const payload = JSON.parse(call.options.body);
  assert.deepEqual(Object.keys(payload).sort(), ['action', 'base64Data', 'fileName', 'mimeType']);
  assert.equal(payload.action, 'extractPolicyDocument');
  assert.equal(payload.mimeType, 'image/png');
  assert.doesNotMatch(call.options.body, /GEMINI_API_KEY|GEMINI_MODEL|prompt/i);
});

test('GAS reads secrets from Script Properties and handles bounded retry and structured JSON parsing', () => {
  assert.match(gasSource, /PropertiesService\.getScriptProperties\(\)\.getProperty\('GEMINI_API_KEY'\)/);
  assert.match(gasSource, /PropertiesService\.getScriptProperties\(\)\.getProperty\('GEMINI_MODEL'\)/);
  assert.match(gasSource, /const GEMINI_RETRY_DELAYS_MS = Object\.freeze\(\[0, 2000, 5000\]\)/);
  assert.match(gasSource, /if \(lastStatus === 503 && attempt < GEMINI_RETRY_DELAYS_MS\.length - 1\) continue/);
  assert.match(gasSource, /JSON\.parse\(text\)/);
  assert.match(gasSource, /responseMimeType: 'application\/json'/);
  assert.match(gasSource, /responseSchema: GEMINI_EXTRACTION_SCHEMA/);
  assert.match(gasSource, /GEMINI_MAX_DOCUMENT_BYTES = 8 \* 1024 \* 1024/);
  assert.match(gasSource, /GEMINI_SUPPORTED_MIME_TYPES/);
});

test('GAS action validates input and does not route extraction through Official writes', () => {
  assert.match(gasSource, /if \(body\.action === 'extractPolicyDocument'\) return json_\(extractPolicyDocument_\(body\)\)/);
  assert.match(gasSource, /Object\.keys\(body\)\.some\(key => allowedKeys\.indexOf\(key\) === -1\)/);
  assert.match(gasSource, /Utilities\.base64Decode\(base64Data\)/);
  const extractionBlock = gasSource.slice(gasSource.indexOf('function extractPolicyDocument_'), gasSource.indexOf('function verifyAdminSession_'));
  assert.doesNotMatch(extractionBlock, /replaceOfficialArea_|SpreadsheetApp|DriveApp|PropertiesService\.getScriptProperties\(\)\.setProperty|setValues|appendRow/);
  assert.doesNotMatch(clientSource, /GEMINI_API_KEY|GEMINI_MODEL/);
  assert.doesNotMatch(appSource, /GEMINI_API_KEY|GEMINI_MODEL/);
});

test('frontend AI Intake is read-only and uses the existing registry resolver', () => {
  const intakeBlock = appSource.slice(appSource.indexOf('async function aiIntake'), appSource.indexOf('function manualPolicy'));
  assert.match(intakeBlock, /extractPolicyDocumentFromFile/);
  assert.match(intakeBlock, /resolveProductMatch/);
  assert.match(intakeBlock, /只讀測試模式/);
  assert.match(appSource, /關閉測試結果/);
  assert.doesNotMatch(intakeBlock, /saveMutation|intakeDrafts|replaceOfficialArea|Save to CRM/);
  assert.doesNotMatch(intakeBlock, /multiple/);
});

test('logging contract excludes raw document and extracted customer data', () => {
  const logBlock = gasSource.slice(gasSource.indexOf('function logExtraction_'), gasSource.indexOf('function verifyAdminSession_'));
  assert.match(logBlock, /model/);
  assert.match(logBlock, /mimeType/);
  assert.match(logBlock, /fileSize/);
  assert.doesNotMatch(logBlock, /base64Data|policyNumber|customer|extracted|prompt/i);
});
