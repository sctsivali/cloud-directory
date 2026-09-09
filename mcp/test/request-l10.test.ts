import assert from 'node:assert/strict';
import { it } from 'node:test';
import { registerHooks } from 'node:module';
import { TEST_DATABASE_URL, withMigratedDatabase } from './pg-harness.ts';
import { PostgresDirectoryReader } from '../src/read-tools.ts';
import { executeTool } from '../src/handlers.ts';

it('L10 actual API/MCP/Postgres parity, single resolution under a hostile publication interleave, and scoped eligibility', {skip:!TEST_DATABASE_URL}, async () => {
  await withMigratedDatabase(async (client, pool) => {
    async function receipt(id: string, provider: string, observed = '2025-01-15') {
      await client.query(`INSERT INTO proposals (id,tool_name,actor_id,idempotency_key,body,body_digest,status) VALUES ($1,'test','author',$1,'{}',repeat('a',64),'published')`,[id]);
      await client.query(`INSERT INTO publication_attempts (id,idempotency_key,request_digest,proposal_id,revision_id,publisher_id,state) VALUES ($1,$1,repeat('a',64),$1,$1,'publisher','committed')`,[id]);
      await client.query(`INSERT INTO publication_receipts
        (id,attempt_id,proposal_id,revision_id,revision_ordinal,body_digest,approval_id,approval_digest,reviewer_id,publisher_id,methodology_version,data_revision,idempotency_key,entity_type,entity_id,field_name,change_type,verification_state,published_at,verified_at,knowledge_state,assessment_state,after_value)
        VALUES ($1,$1,$1,$1,1,repeat('a',64),$1,repeat('a',64),'reviewer','publisher','test','old',$1,'provider',$1,'country_presence','create','verified',$2,$2,'present','independently_verified','{"countryCode":"ID"}')`,[id,observed]);
      await client.query(`INSERT INTO change_events (id,receipt_id,revision_id,proposal_id,change_type,entity_type,entity_id,field_name,published_at,observed_at,title_id,title_en,provider_id) VALUES ($1,$1,$1,$1,'create','provider',$1,'country_presence',$3,$3,'test','test',$2)`,[id,provider,observed]);
    }
    await receipt('owned','prov-a');
    await receipt('foreign','prov-b','2024-01-15');
    const originalQuery = pool.query.bind(pool);
    let resolutions = 0, ledgerReads = 0, interleaved = false;
    const guardedDb = { query: async (sql: string, values?: unknown[]) => {
      if (/capture_data_revision|SELECT \* FROM data_revisions/.test(sql)) resolutions++;
      const result = await originalQuery(sql, values);
      if (sql.includes('JOIN LATERAL')) {
        ledgerReads++;
        if (!interleaved) { interleaved = true; await receipt('late-owned','prov-a','2025-02-15'); }
      }
      return result;
    }};
    const globals = globalThis as unknown as {pool?:unknown};
    const old = globals.pool; globals.pool = guardedDb;
    const hooks = registerHooks({resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) return nextResolve(new URL(`../../web/src/${specifier.slice(2)}.ts`,import.meta.url).href,context);
      if (specifier === 'next/server') return nextResolve('next/server.js',context);
      if (specifier === './legacy-scoring') return nextResolve('./legacy-scoring.ts',context);
      return nextResolve(specifier,context);
    }});
    try {
      const {GET} = await import(new URL('../../web/src/app/api/trends/route.ts',import.meta.url).href);
      const args = {country:' indonesia ',providerId:'prov-a',metric:'provider_count_by_country',windowStart:'2025-01-01T00:00:00.000Z',windowEnd:'2025-03-01T00:00:00.000Z'};
      const response = await GET(new Request(`http://test.invalid/api/trends?${new URLSearchParams(args)}`));
      assert.equal(response.status,200);
      const api = await response.json();
      assert.equal(resolutions,1); assert.equal(ledgerReads,1);
      assert.equal(api.countryCode,'ID');
      assert.equal(api.providerId,'prov-a');
      assert.equal(api.outlookEligibility.providerId,'prov-a');
      assert.equal(api.outlookEligibility.provenance.dataRevision,api.dataRevision);
      assert.deepEqual(api.outlookEligibility.observationWindow,api.observationWindow);
      assert.ok(!JSON.stringify(api).includes('foreign'));
      assert.ok(!JSON.stringify(api).includes('late-owned'));
      const reader = new PostgresDirectoryReader(pool);
      const ctx = {reader,repo:null,principalId:'reader',capabilities:['read'] as const};
      const mcp = JSON.parse((await executeTool(ctx,'directory.get_trends',{...args,dataRevision:api.dataRevision})).content[0]!.text);
      const {apiVersion,...apiBody} = api;
      assert.deepEqual(mcp,apiBody);
      const eligibility = JSON.parse((await executeTool(ctx,'directory.get_outlook_eligibility',{...args,dataRevision:api.dataRevision})).content[0]!.text);
      const {ok,...eligibilityBody} = eligibility;
      assert.deepEqual(eligibilityBody,api.outlookEligibility);
      const latest = await reader.getTrends(args);
      assert.notEqual(latest.dataRevision,api.dataRevision);
      const inferred = await reader.getTrends({providerId:'prov-a',dataRevision:api.dataRevision});
      assert.deepEqual(inferred.observationWindow,{start:'2025-01-01T00:00:00.000Z',end:'2025-02-01T00:00:00.000Z'});
      for (const [key,value,code] of [['country','ZZ','invalid_country'],['country','','invalid_country'],['metric','bogus','invalid_metric'],['providerId',' ','invalid_provider'],['limit','0','invalid_limit'],['page','1001','invalid_page'],['windowStart','yesterday','invalid_window']]) {
        const bad = await GET(new Request(`http://test.invalid/api/trends?${new URLSearchParams({[key!]:value!})}`));
        const body = await bad.json(); assert.equal(bad.status,400); assert.equal(body.code,code);
        const input = {[key!]: ['limit','page'].includes(key!) ? Number(value) : value};
        const tool = JSON.parse((await executeTool(ctx,'directory.get_trends',input)).content[0]!.text);
        assert.equal(tool.code,body.code); assert.equal(tool.error,body.error);
      }
    } finally {hooks.deregister();globals.pool=old;}
  });
});
