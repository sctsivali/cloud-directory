import { factsFromLedgerRows, ledgerFactRowFromJoin } from './ledger.ts';
import { MAX_TREND_FACTS } from './trends.ts';
import type { VerifiedFact } from './types.ts';

export interface RevisionDatabase {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export class DataRevisionError extends Error {
  readonly code: 'invalid_data_revision' | 'fact_limit_exceeded' | 'invalid_revision_snapshot';
  constructor(code: DataRevisionError['code']) { super(code); this.code = code; }
}
export type DataRevisionSnapshot = {
  id: string;
  cutoffAt: string;
  receiptIds: string[];
  receiptSetSha256: string;
  facts: VerifiedFact[];
};

/** Resolve once, then read only immutable receipt membership. Never accept a provenance label. */
export async function loadDataRevision(db: RevisionDatabase, requested?: string | null): Promise<DataRevisionSnapshot> {
  const { rows } = requested != null
    ? await db.query('SELECT * FROM data_revisions WHERE id = $1', [requested])
    : await db.query('SELECT * FROM capture_data_revision()');
  const row = rows[0];
  if (!row) throw new DataRevisionError('invalid_data_revision');
  const receiptIds = row.receipt_ids as string[];
  if (receiptIds.length > MAX_TREND_FACTS) throw new DataRevisionError('fact_limit_exceeded');
  const { rows: ledger } = await db.query(`
    SELECT r.id AS receipt_id, r.revision_id, r.change_type, r.entity_type, r.entity_id, r.field_name,
      r.before_value, r.after_value, 'verified' AS verification_state, r.methodology_version,
      $2::text AS data_revision, r.knowledge_state, r.assessment_state,
      r.published_at::text AS published_at, r.verified_at::text AS verified_at,
      r.evidence_snapshot_ids, r.supersedes_receipt_id,
      e.observed_at::text AS observed_at, e.provider_id, e.value_sensitivity
    FROM publication_receipts r JOIN LATERAL (
      SELECT observed_at, provider_id, value_sensitivity FROM change_events
      WHERE receipt_id = r.id ORDER BY id COLLATE "C" LIMIT 1
    ) e ON true
    WHERE r.id = ANY($1::text[]) ORDER BY r.id COLLATE "C"`, [receiptIds, row.id]);
  if (ledger.length !== receiptIds.length) throw new DataRevisionError('invalid_revision_snapshot');
  return {
    id: String(row.id), cutoffAt: new Date(String(row.cutoff_at)).toISOString(),
    receiptIds, receiptSetSha256: String(row.receipt_set_sha256),
    facts: factsFromLedgerRows(ledger.map(ledgerFactRowFromJoin)),
  };
}
