import assert from 'node:assert/strict';
import { it } from 'node:test';
import { normalizeIntelligenceRequest, resolveIntelligenceRequest, trendResponse } from '../src/intelligence/request.ts';
import { buildOutlook, publicOutlookEligibilityView } from '../src/intelligence/outlook.ts';
import { longitudinalFacts, LONGITUDINAL_WINDOW } from './intelligence-fixtures.ts';

it('L10 normalizes transport-neutral scope and bounds, rejecting invalid input before loading', async () => {
  const normalized = normalizeIntelligenceRequest({ country: ' indonesia ', providerId: 'prov-a', metric: 'provider_count_by_country', limit: '10', page: '2' });
  assert.equal(normalized.countryCode, 'ID');
  assert.equal(normalized.limit, 10);
  for (const [input, code] of [
    [{country:'ZZ'}, 'invalid_country'], [{country:23}, 'invalid_country'],
    [{metric:'invented'}, 'invalid_metric'], [{metric:''}, 'invalid_metric'],
    [{providerId:' '}, 'invalid_provider'], [{limit:''}, 'invalid_limit'],
    [{limit:true}, 'invalid_limit'], [{page:0}, 'invalid_page'],
    [{windowStart:'yesterday'}, 'invalid_window'],
  ] as const) {
    let calls = 0;
    await assert.rejects(resolveIntelligenceRequest({ query: async () => { calls++; return {rows:[]}; } }, input), {code});
    assert.equal(calls, 0);
  }
});

it('L10 resolves one snapshot and supplies the identical scoped fact set/window to both outputs', async () => {
  let resolutions = 0;
  const source = longitudinalFacts();
  const snapshot = { id:'drv-test', cutoffAt:LONGITUDINAL_WINDOW.end, receiptIds:source.map(f=>f.receiptId), receiptSetSha256:'test', facts:source };
  const built = await resolveIntelligenceRequest({query: async () => { throw Error('unexpected database access'); }}, {
    country:'ID', providerId:'prov-a', metric:'provider_count_by_country', windowStart:LONGITUDINAL_WINDOW.start, windowEnd:LONGITUDINAL_WINDOW.end,
  }, async () => { resolutions++; return snapshot; });
  // Adversarial source mutation after resolution must not alter the request snapshot.
  source.push({...source[0]!, providerId:'leaked', receiptId:'late', revisionId:'late'});
  const response = trendResponse(built);
  assert.equal(resolutions, 1);
  assert.ok(Object.isFrozen(built.query.facts));
  assert.ok(built.query.facts.every(f => f.providerId === 'prov-a'));
  assert.deepEqual(response.outlookEligibility, publicOutlookEligibilityView(buildOutlook(built.query, 'provider_count_by_country')));
  assert.ok(!JSON.stringify(response).includes('leaked'));
  assert.equal(response.dataRevision, 'drv-test');
});

it('L10 preserves moved-entity latest-state semantics across country scope', async () => {
  const seed = longitudinalFacts()[0]!;
  const first = {...seed, entityType:'offering', entityId:'moved', fieldName:'offering', scopeId:null, providerId:'prov-a', countryCode:'ID', knowledgeState:'present' as const, changeType:'create' as const, observedAt:'2025-01-15T00:00:00.000Z', receiptId:'first', revisionId:'first'};
  const moved = {...first, countryCode:'SG', changeType:'update' as const, observedAt:'2025-02-15T00:00:00.000Z', receiptId:'moved', revisionId:'moved'};
  const built = await resolveIntelligenceRequest({query:async()=>({rows:[]})}, {country:'ID', providerId:'prov-a', metric:'offering_count_by_country', windowStart:'2025-01-01T00:00:00.000Z', windowEnd:'2025-03-01T00:00:00.000Z'}, async () => ({id:'move-revision',cutoffAt:LONGITUDINAL_WINDOW.end,receiptIds:['first','moved'],receiptSetSha256:'test',facts:[first,moved]}));
  const result = trendResponse(built);
  assert.deepEqual((result.series as {value:number}[]).map(p=>p.value), [1,0]);
  assert.deepEqual(result.outlookEligibility, publicOutlookEligibilityView(buildOutlook(built.query,'offering_count_by_country')));
});

