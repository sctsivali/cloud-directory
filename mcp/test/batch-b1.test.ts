import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createHash } from 'node:crypto';
import { TEST_DATABASE_URL, withMigratedDatabase } from './pg-harness.ts';
import { PostgresDirectoryReader } from '../src/read-tools.ts';

it('B1 database snapshot identity, immutable history, cutoff and real MCP revision resolution', { skip: !TEST_DATABASE_URL }, async () => {
  await withMigratedDatabase(async (client, pool) => {
    await client.query("SET TIME ZONE 'UTC'");
    const reader = new PostgresDirectoryReader(pool);
    const missing = await reader.getTrends({ dataRevision: 'caller-chosen-label' });
    assert.equal(missing.code, 'invalid_data_revision');
    async function receipt(id: string, published: string, verified: string | null) {
      await client.query(`INSERT INTO proposals (id,tool_name,actor_id,idempotency_key,body,body_digest,status)
        VALUES ($1,'test','author',$1,'{}',repeat('a',64),'published')`, [id]);
      await client.query(`INSERT INTO publication_attempts (id,idempotency_key,request_digest,proposal_id,revision_id,publisher_id,state)
        VALUES ($1,$1,repeat('a',64),$1,$1,'publisher','committed')`, [id]);
      await client.query(`INSERT INTO publication_receipts
        (id,attempt_id,proposal_id,revision_id,revision_ordinal,body_digest,approval_id,approval_digest,reviewer_id,publisher_id,
        methodology_version,data_revision,idempotency_key,entity_type,entity_id,field_name,change_type,verification_state,published_at,verified_at,knowledge_state,assessment_state,after_value)
        VALUES ($1,$1,$1,$1,1,repeat('a',64),$1,repeat('a',64),'reviewer','publisher','test','old-label',$1,'provider',$1,'country_presence','create','verified',$2,$3,'present','independently_verified','{"countryCode":"ID"}')`, [id, published, verified]);
      await client.query(`INSERT INTO change_events
        (id,receipt_id,revision_id,proposal_id,change_type,entity_type,entity_id,field_name,published_at,observed_at,title_id,title_en,provider_id)
        VALUES ($1,$1,$1,$1,'create','provider',$1,'country_presence',$2,'2025-01-15','test','test',$1)`, [id, published]);
    }
    await receipt('early', '2025-01-15', '2025-01-16');
    await receipt('late-published', '2025-07-01', '2025-07-02');
    await receipt('late-verified', '2025-01-15', '2025-07-02');
    const { rows: [revision] } = await client.query(`SELECT * FROM capture_data_revision('2025-02-01'::timestamptz)`);
    assert.deepEqual(revision.receipt_ids, ['early']);
    assert.equal(revision.receipt_set_sha256, createHash('sha256').update(JSON.stringify(['early'])).digest('hex'));
    const result = await reader.getTrends({ dataRevision: revision.id, metric: 'provider_count_by_country' });
    assert.equal(result.dataRevision, revision.id);
    assert.equal((result.series as { value: number }[])[0]!.value, 1);
    const { rows: [same] } = await client.query(`SELECT * FROM capture_data_revision('2025-03-01'::timestamptz)`);
    assert.equal(same.id, revision.id);
    assert.equal(new Date(same.cutoff_at).toISOString(), '2025-02-01T00:00:00.000Z');
    for (const sql of [
      'UPDATE data_revisions SET cutoff_at = now()', 'DELETE FROM data_revisions', 'TRUNCATE data_revisions',
      `UPDATE publication_receipts SET verified_at = now() WHERE id = 'early'`,
      `DELETE FROM publication_receipts WHERE id = 'early'`,
      `UPDATE change_events SET observed_at = now() WHERE id = 'early'`,
      'TRUNCATE publication_receipts CASCADE', 'TRUNCATE change_events',
      `INSERT INTO data_revisions (id,cutoff_at,receipt_ids,receipt_set_sha256) VALUES ('fake','2025-02-01',ARRAY['early'],repeat('b',64))`,
    ]) await assert.rejects(client.query(sql));
    const latest = await reader.getTrends({ metric: 'provider_count_by_country' });
    assert.notEqual(latest.dataRevision, revision.id);
    assert.equal((latest.series as { value: number }[])[0]!.value, 3);
    assert.deepEqual((await reader.getTrends({ dataRevision: revision.id, metric: 'provider_count_by_country' })).series, result.series);
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => reader.getTrends({})));
    assert.equal(new Set(concurrent.map(r => r.dataRevision)).size, 1);
    const facts = await client.query(`SELECT verified_at FROM publication_receipts WHERE id='early'`);
    assert.equal(new Date(facts.rows[0].verified_at).toISOString(), '2025-01-16T00:00:00.000Z');
    await client.query(`UPDATE publication_receipts SET verification_state='rolled_back' WHERE id='early'`);
    assert.deepEqual((await reader.getTrends({ dataRevision: revision.id, metric: 'provider_count_by_country' })).series, result.series);
    await receipt('stamp', '2025-01-15', null);
    const stamped = await client.query(`SELECT verified_at >= statement_timestamp() - interval '1 minute' AS recent FROM publication_receipts WHERE id='stamp'`);
    assert.equal(stamped.rows[0].recent, true);
  });
});
