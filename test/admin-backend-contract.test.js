import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const docs = fs.readFileSync(new URL('../gas/README.md', import.meta.url), 'utf8');

test('CRM backend uses the Platform ticket and grant contract', () => {
  assert.match(source, /action: 'exchangeAppLaunch'/);
  assert.match(source, /action: 'verifyAppGrant'/);
  assert.match(source, /appId: CRM_APP_ID/);
  assert.match(source, /response\.appGrant/);
  assert.match(source, /response\.operation/);
  assert.match(source, /Date\.parse/);
});

test('CRM backend has a fixed Official operation allowlist', () => {
  for (const operation of ['replacePageSettings', 'replaceReviewQuestions', 'replaceCoverageCategories', 'replaceProductDefinitions', 'replaceSystemSettings']) assert.match(source, new RegExp(operation));
  assert.doesNotMatch(source, /writeAnySheet|rangeName|body\.sheet|body\.range/);
  assert.match(source, /Official row schema mismatch/);
  assert.match(source, /Unsupported Official value/);
  assert.match(source, /value\.startsWith\('='\)/);
  assert.match(source, /assertSheetSafeForReplacement_/);
  assert.match(source, /getProtections/);
  assert.match(source, /getMergedRanges/);
  assert.match(source, /isColumnHiddenByUser/);
  assert.match(source, /getFormulas/);
});

test('CRM backend does not contain private CRM/User data targets or frontend secrets', () => {
  assert.doesNotMatch(source, /households|people|policies|policyNumbers|indexedDB|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /ADMIN_PASSWORD|SESSION_SECRET|sessionToken/);
  assert.match(docs, /User Overrides/);
  assert.match(docs, /AI\/customer policy data is not accepted/);
});
