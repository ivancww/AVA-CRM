import { OFFICIAL_GAS_ENDPOINT } from './crm-core.js';

export const SUPPORTED_DOCUMENT_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

// Keep the inline Gemini request well below Apps Script and upstream request limits.
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const DOCUMENT_ACCEPT = SUPPORTED_DOCUMENT_MIME_TYPES.join(',');

const CLIENT_ERROR_MESSAGES = Object.freeze({
  unsupported: '只支援 PDF、JPEG、PNG 或 WEBP 文件。',
  empty: '文件內容是空白，請重新選擇文件。',
  oversized: '文件太大，請選擇 8 MB 或以下的文件。',
  malformed: '文件資料格式無效，請重新選擇文件。',
  busy: 'AI服務暫時繁忙，請稍後再試。',
  unavailable: 'AI文件讀取未完成，請稍後再試。'
});

function extractionError(message, code = 'unavailable', status = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function validateDocumentFile(file) {
  if (!file || typeof file !== 'object') throw extractionError(CLIENT_ERROR_MESSAGES.malformed, 'malformed');
  if (!SUPPORTED_DOCUMENT_MIME_TYPES.includes(String(file.type || '').toLowerCase())) throw extractionError(CLIENT_ERROR_MESSAGES.unsupported, 'unsupported');
  if (!Number.isFinite(Number(file.size)) || Number(file.size) <= 0) throw extractionError(CLIENT_ERROR_MESSAGES.empty, 'empty');
  if (Number(file.size) > MAX_DOCUMENT_BYTES) throw extractionError(CLIENT_ERROR_MESSAGES.oversized, 'oversized');
  if (typeof file.arrayBuffer !== 'function') throw extractionError(CLIENT_ERROR_MESSAGES.malformed, 'malformed');
  return file;
}

export function arrayBufferToBase64(buffer) {
  if (!(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) throw extractionError(CLIENT_ERROR_MESSAGES.malformed, 'malformed');
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let output = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) output += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(output);
}

export function buildExtractionRequest({ fileName, mimeType, base64Data }) {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  if (!SUPPORTED_DOCUMENT_MIME_TYPES.includes(normalizedMimeType)) throw extractionError(CLIENT_ERROR_MESSAGES.unsupported, 'unsupported');
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 180 || /[\r\n]/.test(fileName)) throw extractionError(CLIENT_ERROR_MESSAGES.malformed, 'malformed');
  if (typeof base64Data !== 'string' || !base64Data || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data) || base64Data.length % 4 !== 0) throw extractionError(CLIENT_ERROR_MESSAGES.malformed, 'malformed');
  return { action: 'extractPolicyDocument', fileName: fileName.trim(), mimeType: normalizedMimeType, base64Data };
}

export async function createExtractionRequest(file) {
  validateDocumentFile(file);
  const buffer = await file.arrayBuffer();
  if (!buffer || buffer.byteLength <= 0) throw extractionError(CLIENT_ERROR_MESSAGES.empty, 'empty');
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) throw extractionError(CLIENT_ERROR_MESSAGES.oversized, 'oversized');
  return buildExtractionRequest({ fileName: String(file.name || 'document'), mimeType: file.type, base64Data: arrayBufferToBase64(buffer) });
}

function looksLikePolicy(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && (
    'policyNumber' in value || 'insurer' in value || 'productName' in value ||
    'policyholder' in value || 'insuredPeople' in value || 'premium' in value
  );
}

// The backend now returns a document result. Keep a narrow compatibility
// adapter for an older deployed GAS response so a single-policy document does
// not break while the backend deployment is being rolled out.
export function normalizeExtractionResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw extractionError(CLIENT_ERROR_MESSAGES.unavailable, 'invalid-extraction');
  const policies = Array.isArray(value.policies) ? value.policies.filter((policy) => policy && typeof policy === 'object' && !Array.isArray(policy)) : looksLikePolicy(value) ? [value] : [];
  if (!policies.length) throw extractionError(CLIENT_ERROR_MESSAGES.unavailable, 'empty-extraction');
  return {
    documentType: value.documentType ? String(value.documentType) : '',
    policies,
    documentWarnings: Array.isArray(value.documentWarnings) ? value.documentWarnings : []
  };
}

export function resolvePolicyMatches(documentResult, registryProducts, resolver) {
  if (typeof resolver !== 'function') throw new TypeError('A product resolver is required');
  return normalizeExtractionResult(documentResult).policies.map((policy) => resolver(registryProducts, policy));
}

function responseError(payload, status) {
  const message = String(payload?.error || '');
  if (status === 429 || status === 503 || /temporarily busy|暫時繁忙|503|429/i.test(message)) return extractionError(CLIENT_ERROR_MESSAGES.busy, 'busy', status);
  if (/unsupported|MIME|文件類型/i.test(message)) return extractionError(CLIENT_ERROR_MESSAGES.unsupported, 'unsupported', status);
  if (/oversized|too large|太大/i.test(message)) return extractionError(CLIENT_ERROR_MESSAGES.oversized, 'oversized', status);
  return extractionError(CLIENT_ERROR_MESSAGES.unavailable, 'unavailable', status);
}

export async function extractPolicyDocumentFromFile(file, { fetchImpl = globalThis.fetch, endpoint = OFFICIAL_GAS_ENDPOINT } = {}) {
  const request = await createExtractionRequest(file);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(request)
    });
  } catch (_) {
    throw extractionError(CLIENT_ERROR_MESSAGES.unavailable, 'unavailable');
  }
  let payload;
  try { payload = await response.json(); } catch (_) { throw extractionError(CLIENT_ERROR_MESSAGES.unavailable, 'unavailable', response.status); }
  if (!response.ok || payload?.success !== true || !payload?.data) throw responseError(payload, response.status);
  return normalizeExtractionResult(payload.data);
}

export function clientExtractionErrorMessage(error) {
  if (error?.code === 'unsupported' || error?.code === 'empty' || error?.code === 'oversized' || error?.code === 'malformed' || error?.code === 'busy') return error.message;
  return CLIENT_ERROR_MESSAGES.unavailable;
}


// Keep the input mounted and invoke it only from the trigger's direct gesture.
export function attachDocumentPicker({ trigger, input, onFile }) {
  if (!trigger || !input || typeof trigger.addEventListener !== 'function' || typeof input.addEventListener !== 'function' || typeof input.click !== 'function') throw new TypeError('A mounted document picker is required');
  input.accept = DOCUMENT_ACCEPT;
  const handleChange = (event) => { const file = event?.target?.files?.[0] || null; if (file && typeof onFile === 'function') onFile(file); };
  const openPicker = () => input.click(); input.addEventListener('change', handleChange); trigger.addEventListener('click', openPicker);
  return () => { input.removeEventListener('change', handleChange); trigger.removeEventListener('click', openPicker); };
}
