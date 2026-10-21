export const AVA_PLATFORM_URL = 'https://ivancww.github.io/avaplatform/';
export const CRM_CAPABILITIES = Object.freeze({ frontend: true, user: true, admin: false });

const SUPPORTED_ENTRIES = new Set(['frontend', 'user', 'admin']);

export function resolveAvaEntry(search = '') {
  const requested = new URLSearchParams(search).get('avaEntry');
  return SUPPORTED_ENTRIES.has(requested) ? requested : 'frontend';
}

// Frontstage editing is a User-entry capability only. Frontend and Admin
// entries must remain presentation/authorization flows respectively.
export function canEditFrontstage(entryMode) {
  return entryMode === 'user';
}

export function returnToAvaUrl(entryMode, platformUrl = AVA_PLATFORM_URL) {
  const destination = new URL(platformUrl);
  destination.search = '';
  if (entryMode === 'user') destination.searchParams.set('avaSurface', 'user');
  return destination.toString();
}


// The installed PWA defaults to Frontend; explicit Platform URLs remain authoritative.
export function defaultAvaStartUrl(path = './') {
  const url = new URL(path, 'https://ava-crm.invalid/'); url.search = '?avaEntry=frontend'; url.hash = ''; return url.pathname + url.search;
}
