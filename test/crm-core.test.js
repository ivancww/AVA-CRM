import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_STATES, comparePolicy, createBenefit, dedupeBenefits, matchProduct } from '../crm-core.js';

test('AI intake uses confirmation states', () => assert.deepEqual(AI_STATES, ['draft', 'needs_confirmation', 'confirmed']));
test('benefits deduplicate by stable unique ID', () => { const first = createBenefit({ id: 'b1', primaryCategory: 'accident', presentationTags: ['accident', 'medical'] }); assert.equal(dedupeBenefits([first, { ...first, amount: 100 }]).length, 1); });
test('policy comparison returns differences without overwriting', () => assert.deepEqual(comparePolicy({ premium: 100, paymentTerm: '20年' }, { premium: 120, paymentTerm: '20年' }), [{ field: 'premium', existing: 100, extracted: 120 }]));
test('product match distinguishes exact from candidate', () => { const products = [{ insurer: 'AVA', productName: '安心醫療', productVersion: '2026' }]; assert.equal(matchProduct(products, products[0]).status, 'exact'); assert.equal(matchProduct(products, { insurer: 'AVA', productName: '安心', productVersion: '2025' }).requiresConfirmation, true); });
