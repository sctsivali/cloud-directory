import assert from 'node:assert/strict';
import { it } from 'node:test';
import { registerHooks } from 'node:module';
import { TEST_DATABASE_URL, withMigratedDatabase } from './pg-harness.ts';

it('B1 actual API handler resolves the database revision and rejects arbitrary labels without HTTP', { skip: !TEST_DATABASE_URL }, async () => {
  await withMigratedDatabase(async (_client, pool) => {
    const globals = globalThis as unknown as { pool?: unknown };
    const old = globals.pool;
    globals.pool = pool;
    const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) return nextResolve(new URL(`../../web/src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      if (specifier === 'next/server') return nextResolve('next/server.js', context);
      if (specifier === './legacy-scoring') return nextResolve('./legacy-scoring.ts', context);
      return nextResolve(specifier, context);
    } });
    try {
      const routeUrl = new URL('../../web/src/app/api/trends/route.ts', import.meta.url).href;
      const { GET } = await import(routeUrl) as { GET(req: Request): Promise<Response> };
      const bad = await GET(new Request('http://test.invalid/api/trends?dataRevision=made-up'));
      assert.equal(bad.status, 400);
      assert.equal((await bad.json() as { code: string }).code, 'invalid_data_revision');
      const good = await GET(new Request('http://test.invalid/api/trends?metric=provider_count_by_country'));
      assert.equal(good.status, 200);
      const body = await good.json() as { dataRevision: string; outlookEligibility: { provenance: { dataRevision: string } } };
      assert.match(body.dataRevision, /^drv-[a-f0-9]{64}$/);
      assert.equal(body.outlookEligibility.provenance.dataRevision, body.dataRevision);
      const saved = await pool.query('SELECT id FROM data_revisions WHERE id=$1', [body.dataRevision]);
      assert.equal(saved.rowCount, 1);
      const replay = await GET(new Request(`http://test.invalid/api/trends?metric=provider_count_by_country&dataRevision=${body.dataRevision}`));
      assert.deepEqual(await replay.json(), body);
    } finally { hooks.deregister(); globals.pool = old; }
  });
});
