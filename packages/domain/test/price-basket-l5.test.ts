import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { priceTerms, basketFingerprint } from '../src/intelligence/price-terms.ts';
import { factFromLedgerRow } from '../src/intelligence/ledger.ts';
import { buildTrendSeries } from '../src/intelligence/trends.ts';

export const terms = { amount: 10, currency: 'USD', billingUnit: 'month', commitmentMonths: 0, promo: false, renewalAmount: 10, tax: 'exclusive', region: 'id-jkt', deploymentId: 'dep-a', vcpu: 2, ramGb: 4, storageGb: 40, storageType: 'ssd', comparable: true };
const changes = { currency: 'SGD', billingUnit: 'year', commitmentMonths: 12, promo: true, renewalAmount: 20, tax: 'inclusive', region: 'sg', deploymentId: 'dep-b', vcpu: 4, ramGb: 8, storageGb: 80, storageType: 'hdd' };
test('L5 hash covers every comparison attribute except observed amount', () => {
  const fp = basketFingerprint(terms);
  assert.match(fp!, /^[a-f0-9]{64}$/);
  assert.equal(fp, createHash('sha256').update(JSON.stringify(['USD','month','0','false','10','exclusive','id-jkt','dep-a','2','4','40','ssd']).replaceAll(',', ', ')).digest('hex'));
  assert.equal(fp, basketFingerprint({ ...terms, amount: 25 }));
  for (const [key, value] of Object.entries(changes)) assert.notEqual(fp, basketFingerprint({ ...terms, [key]: value }), key);
});
test('L5 missing or malformed terms and implicit comparable fail closed', () => {
  for (const key of Object.keys(terms)) {
    const value: Record<string, unknown> = { ...terms }; delete value[key];
    assert.equal(priceTerms(value).comparable, false, key);
  }
  for (const patch of [{ comparable: 'true' }, { promo: true }, { billingUnit: 'request' }, { tax: 'unknown' }, { amount: -1 }, { vcpu: 0 }, { commitmentMonths: -1 }, { renewalAmount: null }]) assert.equal(priceTerms({ ...terms, ...patch }).comparable, false);
});
function fact(value: object, month: string) {
  return factFromLedgerRow({ receiptId: month, revisionId: month, changeType: 'update', entityType: 'price', entityId: 'off-a', fieldName: 'price', publishedAt: `2025-${month}-02T00:00:00.000Z`, observedAt: `2025-${month}-01T00:00:00.000Z`, verifiedAt: `2025-${month}-02T00:00:00.000Z`, verificationState: 'verified', knowledgeState: 'present', assessmentState: 'independently_verified', afterValue: value, beforeValue: null });
}
test('L5 index admits only same currency and complete fingerprint, never changed basket or promo', () => {
  const index = (value: object) => buildTrendSeries({ facts: [fact(terms, '01'), fact(value, '02')], window: { start: '2025-01-01T00:00:00.000Z', end: '2025-03-01T00:00:00.000Z' } }, 'comparable_basket_price_index')[1]!.value;
  assert.equal(index({ ...terms, amount: 20 }), 200);
  for (const [key, value] of Object.entries(changes)) assert.equal(index({ ...terms, [key]: value }), null, key);
  const incomplete = { ...terms } as Record<string, unknown>; delete incomplete.storageType;
  assert.equal(index(incomplete), null);
  assert.equal(index({ ...terms, comparable: undefined }), null);
});
