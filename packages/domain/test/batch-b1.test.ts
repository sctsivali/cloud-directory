import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildTrendReport } from '../src/intelligence/trends.ts';
import { buildOutlook } from '../src/intelligence/outlook.ts';
import { factFromLedgerRow } from '../src/intelligence/ledger.ts';
import { makeFact, monotonicPriceFacts, LONGITUDINAL_WINDOW } from './intelligence-fixtures.ts';

const metric = 'provider_count_by_country' as const;
it('B1 absent observed_at cannot turn publication time into a fresh observation', () => {
  const fact = factFromLedgerRow({ receiptId: 'missing-observation', revisionId: 'r',
    changeType: 'create', entityType: 'provider', entityId: 'p', fieldName: 'country_presence',
    publishedAt: '2025-01-15T00:00:00.000Z', verifiedAt: '2025-01-15T00:00:00.000Z',
    observedAt: null, verificationState: 'verified', knowledgeState: 'present',
    afterValue: { countryCode: 'ID' }, beforeValue: null });
  const report = buildTrendReport({ facts: [fact], window });
  assert.equal(report.series[metric][0]!.value, 1);
  assert.equal(report.diagnostics[metric].observationCount, 0);
});
const window = { start: '2025-01-01T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' };
function provider(id: string, observedAt = '2025-01-15T00:00:00.000Z') {
  return makeFact({ receiptId: id, revisionId: id, entityType: 'provider', entityId: id,
    fieldName: 'country_presence', providerId: id, countryCode: 'ID', observedAt,
    verifiedAt: observedAt, changeType: 'create', verificationState: 'verified',
    knowledgeState: 'present', afterValue: { countryCode: 'ID' }, beforeValue: null });
}
it('B1 stock carry-forward supplies no new samples or continuity', () => {
  const report = buildTrendReport({ facts: [provider('a'), provider('b')], window });
  const points = report.series[metric];
  assert.equal(points[0]!.stockPopulation, 2);
  assert.equal(points[0]!.freshObservationCount, 2);
  assert.equal(points[1]!.value, 2);
  assert.equal(points[1]!.carriedForwardCount, 2);
  assert.equal(points[1]!.observationCount, 0);
  assert.equal(points[1]!.continuityContribution, false);
  assert.equal(report.diagnostics[metric].effectiveSampleSize, 2);
  assert.equal(report.eligibility[metric].eligible, false);
});
it('B1 duplicate receipts/evidence and unrelated metrics do not inflate effective samples', () => {
  const a = { ...provider('a'), evidenceSnapshotIds: ['same-evidence'] };
  const b = { ...provider('b'), evidenceSnapshotIds: ['same-evidence'] };
  const report = buildTrendReport({ facts: [a, a, b], window });
  assert.equal(report.series[metric][0]!.freshObservationCount, 2);
  assert.equal(report.diagnostics[metric].effectiveSampleSize, 1);
  assert.equal(report.diagnostics.technology_adoption.observationCount, 0);
});
it('B1 missing verification time and delayed verification cannot be fresh', () => {
  for (const verifiedAt of [null, '2025-02-01T00:00:00.000Z']) {
    const report = buildTrendReport({ facts: [{ ...provider('a'), verifiedAt }], window });
    assert.equal(report.diagnostics[metric].observationCount, 0);
  }
});
it('B1 reused evidence across months cannot supply fresh continuity', () => {
  const facts = Array.from({ length: 12 }, (_, i) => ({
    ...provider(`r${i}`, `2025-${String(i + 1).padStart(2, '0')}-15T00:00:00.000Z`),
    evidenceSnapshotIds: ['reused'],
  }));
  const report = buildTrendReport({ facts, window });
  assert.equal(report.diagnostics[metric].effectiveSampleSize, 1);
  assert.equal(report.series[metric].filter(p => p.continuityContribution).length, 1);
});
it('B1 stale stock share blocks otherwise continuous observations', () => {
  const facts = Array.from({ length: 12 }, (_, i) => provider(`p${i}`, `2025-${String(i + 1).padStart(2, '0')}-15T00:00:00.000Z`));
  facts.push(...Array.from({ length: 100 }, (_, i) => ({ ...provider(`old${i}`, '2024-01-15T00:00:00.000Z'), stale: true })));
  const report = buildTrendReport({ facts, window });
  assert.ok(report.eligibility[metric].failedGates.some(g => g.code === 'stale_share'));
});
it('B1 late-published or late-verified historical prices cannot train earlier backtests', () => {
  for (const field of ['publishedAt', 'verifiedAt'] as const) {
    const facts = monotonicPriceFacts().map(f => ({ ...f, verifiedAt: f.publishedAt, [field]: '2026-02-01T00:00:00.000Z' }));
    const doc = buildOutlook({ facts, window: LONGITUDINAL_WINDOW }, 'comparable_basket_price_index');
    assert.equal(doc.backtest.status, 'insufficient');
    assert.equal(doc.backtest.sampleCount, 0);
    assert.equal(doc.forecast, null);
  }
});
