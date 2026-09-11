import { bodyDigestFromValue } from "../../packages/domain/src/revisions/digest.ts";
import { effectiveChangeType, ledgerState } from "../../packages/domain/src/revisions/state.ts";
import { applyUncertainAttempt, attemptIdentityEqual, publicationReplayAllowed, verificationReplayAllowed, verificationStateAllowed } from "../../packages/domain/src/revisions/attempts.ts";
import { revalidateLockedPublication } from "../../packages/domain/src/revisions/publish.ts";
import { validateRollbackBindings } from "../../packages/domain/src/revisions/rollback.ts";
import { judgeVerification } from "../../packages/domain/src/revisions/verify.ts";
import { PUBLICATION_ERROR } from "../../packages/domain/src/revisions/types.ts";
import type {
  CanonicalState,
  ChangeEvent,
  PreparedPublication,
  PreparedVerification,
  PublicationAttempt,
  PublicationReceipt,
  PublicationStore,
  PublishWriteResult,
  ProposalSnapshot,
  ReviewSnapshot,
  RevisionSnapshot,
  VerifyWriteResult,
} from "../../packages/domain/src/revisions/types.ts";
import { Pool } from "./pg.ts";
import {
  type ConnectionProvider,
  type DedicatedClient,
  type QueryExecutor,
} from "./pg-store.ts";

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function pgCode(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

function pgMessage(err: unknown): string {
  return String((err as { message?: string }).message ?? err);
}

function pgConstraint(err: unknown): string {
  return String((err as { constraint?: string }).constraint ?? "");
}

function pgTable(err: unknown): string {
  return String((err as { table?: string }).table ?? "");
}

function isCanonicalUniqueViolation(err: unknown): boolean {
  return (
    pgCode(err) === "23505" &&
    (pgConstraint(err) === "canonical_states_pkey" || pgTable(err) === "canonical_states")
  );
}

function asConnectionProvider(provider: ConnectionProvider | InstanceType<typeof Pool>): ConnectionProvider {
  if (typeof provider.connect !== "function" || typeof provider.query !== "function") {
    throw new Error("PostgresPublicationStore requires a Pool or connection provider");
  }
  return provider as ConnectionProvider;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((row): row is string => typeof row === "string");
  return [];
}

async function lockCanonicalKey(
  client: QueryExecutor,
  entityType: string,
  entityId: string,
  fieldName: string
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `canonical\u001f${entityType}\u001f${entityId}\u001f${fieldName}`,
  ]);
}

function mapProposal(row: Record<string, unknown>): ProposalSnapshot {
  return {
    id: String(row.id),
    toolName: String(row.tool_name),
    actorId: String(row.actor_id),
    idempotencyKey: String(row.idempotency_key),
    body: (row.body ?? {}) as Record<string, unknown>,
    bodyDigest: String(row.body_digest),
    status: String(row.status),
    createdAt: iso(row.created_at as Date | string) ?? "",
    updatedAt: iso(row.updated_at as Date | string) ?? "",
  };
}

function mapRevision(row: Record<string, unknown>): RevisionSnapshot {
  return {
    id: String(row.id),
    proposalId: String(row.proposal_id),
    revisionOrdinal: Number(row.revision_ordinal),
    body: (row.body ?? {}) as Record<string, unknown>,
    bodyDigest: String(row.body_digest),
    actorId: String(row.actor_id),
    createdAt: iso(row.created_at as Date | string) ?? "",
  };
}

function mapReview(row: Record<string, unknown>): ReviewSnapshot {
  return {
    id: String(row.id),
    proposalId: String(row.proposal_id),
    reviewerId: String(row.reviewer_id),
    decision: String(row.decision),
    comment: (row.comment as string | null) ?? null,
    createdAt: iso(row.created_at as Date | string) ?? "",
    invalidatedAt: iso(row.invalidated_at as Date | string | null),
    boundRevisionId: row.bound_revision_id ? String(row.bound_revision_id) : null,
    boundBodyDigest: row.bound_body_digest ? String(row.bound_body_digest) : null,
  };
}

function mapReceipt(row: Record<string, unknown>): PublicationReceipt {
  return {
    ...ledgerState({ knowledgeState: row.knowledge_state, assessmentState: row.assessment_state }),
    id: String(row.id),
    attemptId: String(row.attempt_id),
    proposalId: String(row.proposal_id),
    revisionId: String(row.revision_id),
    revisionOrdinal: Number(row.revision_ordinal),
    bodyDigest: String(row.body_digest),
    approvalId: String(row.approval_id),
    approvalDigest: String(row.approval_digest),
    reviewerId: String(row.reviewer_id),
    publisherId: String(row.publisher_id),
    methodologyVersion: String(row.methodology_version),
    dataRevision: String(row.data_revision),
    idempotencyKey: String(row.idempotency_key),
    evidenceSnapshotIds: asStringArray(row.evidence_snapshot_ids),
    beforeValue: row.before_value,
    afterValue: row.after_value,
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    fieldName: String(row.field_name),
    changeType: row.change_type as PublicationReceipt["changeType"],
    verificationState: row.verification_state as PublicationReceipt["verificationState"],
    publishedAt: iso(row.published_at as Date | string) ?? "",
    supersedesReceiptId: row.supersedes_receipt_id ? String(row.supersedes_receipt_id) : null,
    verifiedBy: row.verified_by ? String(row.verified_by) : null,
    verifiedAt: iso(row.verified_at as Date | string | null),
  };
}

function mapEvent(row: Record<string, unknown>): ChangeEvent {
  return {
    ...ledgerState({ knowledgeState: row.knowledge_state, assessmentState: row.assessment_state }),
    id: String(row.id),
    receiptId: String(row.receipt_id),
    revisionId: String(row.revision_id),
    proposalId: String(row.proposal_id),
    changeType: row.change_type as ChangeEvent["changeType"],
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    fieldName: String(row.field_name),
    oldValue: row.old_value,
    newValue: row.new_value,
    valueSensitivity: (row.value_sensitivity as ChangeEvent["valueSensitivity"]) ?? "public",
    sourceId: row.source_id ? String(row.source_id) : null,
    evidenceSnapshotIds: asStringArray(row.evidence_snapshot_ids),
    detectedAt: iso(row.detected_at as Date | string | null),
    observedAt: iso(row.observed_at as Date | string | null),
    reviewedAt: iso(row.reviewed_at as Date | string | null),
    publishedAt: iso(row.published_at as Date | string) ?? "",
    correctionOfEventId: row.correction_of_event_id ? String(row.correction_of_event_id) : null,
    titleId: String(row.title_id),
    titleEn: String(row.title_en),
    summaryId: row.summary_id ? String(row.summary_id) : null,
    summaryEn: row.summary_en ? String(row.summary_en) : null,
    providerId: row.provider_id ? String(row.provider_id) : null,
    href: row.href ? String(row.href) : null,
  };
}

function mapAttempt(row: Record<string, unknown>): PublicationAttempt {
  return {
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    requestDigest: String(row.request_digest),
    proposalId: String(row.proposal_id),
    revisionId: String(row.revision_id),
    publisherId: String(row.publisher_id),
    state: row.state as PublicationAttempt["state"],
    createdAt: iso(row.created_at as Date | string) ?? "",
    updatedAt: iso(row.updated_at as Date | string) ?? "",
  };
}

export class PostgresPublicationStore implements PublicationStore {
  private readonly provider: ConnectionProvider;

  constructor(provider: ConnectionProvider | InstanceType<typeof Pool>) {
    this.provider = asConnectionProvider(provider);
  }

  async findProposal(id: string): Promise<ProposalSnapshot | null> {
    const { rows } = await this.provider.query("SELECT * FROM proposals WHERE id = $1", [id]);
    return rows[0] ? mapProposal(rows[0]) : null;
  }

  async findRevision(id: string): Promise<RevisionSnapshot | null> {
    const { rows } = await this.provider.query("SELECT * FROM revisions WHERE id = $1", [id]);
    return rows[0] ? mapRevision(rows[0]) : null;
  }

  async listRevisions(proposalId: string): Promise<RevisionSnapshot[]> {
    const { rows } = await this.provider.query(
      "SELECT * FROM revisions WHERE proposal_id = $1 ORDER BY revision_ordinal",
      [proposalId]
    );
    return rows.map(mapRevision);
  }

  async listReviews(proposalId: string): Promise<ReviewSnapshot[]> {
    const { rows } = await this.provider.query(
      "SELECT * FROM proposal_reviews WHERE proposal_id = $1 ORDER BY created_at",
      [proposalId]
    );
    return rows.map(mapReview);
  }

  async findReceiptByIdempotencyKey(key: string): Promise<PublicationReceipt | null> {
    const { rows } = await this.provider.query("SELECT * FROM publication_receipts WHERE idempotency_key = $1", [
      key,
    ]);
    return rows[0] ? mapReceipt(rows[0]) : null;
  }

  async findAttemptByIdempotencyKey(key: string): Promise<PublicationAttempt | null> {
    const { rows } = await this.provider.query("SELECT * FROM publication_attempts WHERE idempotency_key = $1", [
      key,
    ]);
    return rows[0] ? mapAttempt(rows[0]) : null;
  }

  async findReceiptById(id: string): Promise<PublicationReceipt | null> {
    const { rows } = await this.provider.query("SELECT * FROM publication_receipts WHERE id = $1", [id]);
    return rows[0] ? mapReceipt(rows[0]) : null;
  }

  async findEventByReceiptId(receiptId: string): Promise<ChangeEvent | null> {
    const { rows } = await this.provider.query("SELECT * FROM change_events WHERE receipt_id = $1", [receiptId]);
    return rows[0] ? mapEvent(rows[0]) : null;
  }

  async findReceiptsSuperseding(receiptId: string): Promise<PublicationReceipt[]> {
    const { rows } = await this.provider.query(
      "SELECT * FROM publication_receipts WHERE supersedes_receipt_id = $1",
      [receiptId]
    );
    return rows.map(mapReceipt);
  }

  async getCanonicalState(
    entityType: string,
    entityId: string,
    fieldName: string
  ): Promise<CanonicalState | null> {
    const { rows } = await this.provider.query(
      "SELECT * FROM canonical_states WHERE entity_type = $1 AND entity_id = $2 AND field_name = $3",
      [entityType, entityId, fieldName]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      entityType: String(row.entity_type),
      entityId: String(row.entity_id),
      fieldName: String(row.field_name),
      value: row.value,
      ...ledgerState({ knowledgeState: row.knowledge_state, assessmentState: row.assessment_state }),
      valueDigest: String(row.value_digest),
      dataRevision: String(row.data_revision),
      updatedAt: iso(row.updated_at as Date | string) ?? "",
    };
  }

  async recordUncertainAttempt(attempt: PublicationAttempt): Promise<void> {
    await this.provider.query(
      `INSERT INTO publication_attempts (
         id, idempotency_key, request_digest, proposal_id, revision_id, publisher_id, state, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'uncertain',$7,$8)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         state = CASE
           WHEN publication_attempts.state IN ('pending', 'uncertain') THEN 'uncertain'
           ELSE publication_attempts.state
         END,
         updated_at = CASE
           WHEN publication_attempts.state IN ('pending', 'uncertain') THEN EXCLUDED.updated_at
           ELSE publication_attempts.updated_at
         END
       WHERE publication_attempts.request_digest = EXCLUDED.request_digest
         AND publication_attempts.proposal_id = EXCLUDED.proposal_id
         AND publication_attempts.revision_id = EXCLUDED.revision_id
         AND publication_attempts.publisher_id = EXCLUDED.publisher_id`,
      [
        attempt.id,
        attempt.idempotencyKey,
        attempt.requestDigest,
        attempt.proposalId,
        attempt.revisionId,
        attempt.publisherId,
        attempt.createdAt,
        attempt.updatedAt,
      ]
    );
    const { rows } = await this.provider.query("SELECT * FROM publication_attempts WHERE idempotency_key = $1", [
      attempt.idempotencyKey,
    ]);
    if (!rows[0]) {
      throw new Error("publication attempt identity mismatch");
    }
    applyUncertainAttempt(mapAttempt(rows[0]), attempt);
  }

  async commitPublication(plan: PreparedPublication): Promise<PublishWriteResult> {
    const result = await this.transact(async (client) => {
      const locked = await client.query("SELECT * FROM proposals WHERE id = $1 FOR UPDATE", [plan.proposal.id]);
      if (!locked.rows[0]) return { write: "rejected" as const, code: "not_found" as const, message: "proposal not found" };
      const proposal = mapProposal(locked.rows[0]);
      const revisionRows = await client.query("SELECT * FROM revisions WHERE id = $1 FOR UPDATE", [plan.revision.id]);
      const revision = revisionRows.rows[0] ? mapRevision(revisionRows.rows[0]) : null;
      const reviewRows = await client.query(
        "SELECT * FROM proposal_reviews WHERE proposal_id = $1 FOR UPDATE",
        [plan.proposal.id]
      );
      const reviews = reviewRows.rows.map(mapReview);
      const lockedCheck = revalidateLockedPublication({ plan, proposal, revision, reviews });
      if (lockedCheck) return lockedCheck;

      const existing = await client.query("SELECT * FROM publication_receipts WHERE idempotency_key = $1 FOR UPDATE", [
        plan.idempotencyKey,
      ]);
      if (existing.rows[0]) {
        const receipt = mapReceipt(existing.rows[0]);
        const eventRows = await client.query("SELECT * FROM change_events WHERE receipt_id = $1", [receipt.id]);
        const attemptRows = await client.query("SELECT * FROM publication_attempts WHERE idempotency_key = $1 FOR UPDATE", [
          plan.idempotencyKey,
        ]);
        const attempt = attemptRows.rows[0] ? mapAttempt(attemptRows.rows[0]) : null;
        const incoming = {
          requestDigest: plan.requestDigest,
          proposalId: plan.proposal.id,
          revisionId: plan.revision.id,
          publisherId: plan.publisherPrincipal,
        };
        if (eventRows.rows[0] && publicationReplayAllowed({ receipt, attempt, incoming })) {
          return { write: "replayed" as const, receipt, event: mapEvent(eventRows.rows[0]) };
        }
        return {
          write: "rejected" as const,
          code: PUBLICATION_ERROR.idempotencyConflict,
          message: "same idempotency key with an altered publication request",
        };
      }

      const sameRevision = await client.query(
        "SELECT id FROM publication_receipts WHERE proposal_id = $1 AND revision_id = $2",
        [plan.proposal.id, plan.revision.id]
      );
      if (sameRevision.rows[0]) {
        return { write: "rejected" as const, code: "already_published" as const, message: "revision already published" };
      }

      await lockCanonicalKey(client, plan.entityType, plan.entityId, plan.fieldName);
      const current = await client.query(
        `SELECT value_digest, value, knowledge_state FROM canonical_states
         WHERE entity_type = $1 AND entity_id = $2 AND field_name = $3
         FOR UPDATE`,
        [plan.entityType, plan.entityId, plan.fieldName]
      );
      const currentDigest = current.rows[0] ? String(current.rows[0].value_digest) : null;
      if ((plan.expectedCanonicalDigest ?? null) !== currentDigest) {
        return { write: "cas_conflict" as const };
      }

      if (plan.changeType === "rollback" && plan.supersedesReceiptId) {
        const originalRows = await client.query("SELECT * FROM publication_receipts WHERE id = $1 FOR UPDATE", [
          plan.supersedesReceiptId,
        ]);
        if (!originalRows.rows[0]) {
          return { write: "rejected" as const, code: PUBLICATION_ERROR.notFound, message: "original publication receipt not found" };
        }
        const original = mapReceipt(originalRows.rows[0]);
        const originalEventRows = await client.query("SELECT * FROM change_events WHERE receipt_id = $1", [original.id]);
        const originalEvent = originalEventRows.rows[0] ? mapEvent(originalEventRows.rows[0]) : null;
        const supersedingRows = await client.query(
          "SELECT * FROM publication_receipts WHERE supersedes_receipt_id = $1 FOR UPDATE",
          [original.id]
        );
        const superseding = supersedingRows.rows.map(mapReceipt);
        const ancestors: PublicationReceipt[] = [];
        const seen = new Set<string>([original.id]);
        let cursor = original.supersedesReceiptId;
        let chainValid = true;
        while (cursor) {
          if (seen.has(cursor)) {
            chainValid = false;
            break;
          }
          seen.add(cursor);
          const ancestorRows = await client.query("SELECT * FROM publication_receipts WHERE id = $1 FOR UPDATE", [cursor]);
          if (!ancestorRows.rows[0]) {
            chainValid = false;
            break;
          }
          const ancestor = mapReceipt(ancestorRows.rows[0]);
          ancestors.push(ancestor);
          cursor = ancestor.supersedesReceiptId;
        }
        const rollback = validateRollbackBindings({
          original,
          originalEvent,
          target: { entityType: plan.entityType, entityId: plan.entityId, fieldName: plan.fieldName },
          currentDigest,
          superseding,
          ancestors: chainValid ? ancestors : null,
        });
        if (rollback && rollback.outcome === "rejected") {
          return { write: "rejected" as const, code: rollback.code, message: rollback.message };
        }
      }

      const afterDigest = bodyDigestFromValue(plan.afterValue);
      plan = { ...plan, changeType: effectiveChangeType(current.rows[0] ? {
        value: current.rows[0].value,
        knowledgeState: ledgerState({ knowledgeState: current.rows[0].knowledge_state }).knowledgeState,
      } : null, plan) };
      if (!current.rows[0]) {
        const inserted = await client.query(
          `INSERT INTO canonical_states (
             entity_type, entity_id, field_name, value, value_digest, data_revision, updated_at, knowledge_state, assessment_state
           ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
           ON CONFLICT (entity_type, entity_id, field_name) DO NOTHING
           RETURNING entity_type`,
          [
            plan.entityType,
            plan.entityId,
            plan.fieldName,
            JSON.stringify(plan.afterValue),
            afterDigest,
            plan.dataRevision,
            plan.publishedAt,
            plan.knowledgeState ?? "unknown",
            plan.assessmentState ?? "legacy/unverified",
          ]
        );
        if (!inserted.rows[0]) {
          return { write: "cas_conflict" as const };
        }
      } else {
        const updated = await client.query(
          `UPDATE canonical_states SET
             value = $4::jsonb,
             value_digest = $5,
             data_revision = $6,
             updated_at = $7, knowledge_state = $9, assessment_state = $10
           WHERE entity_type = $1 AND entity_id = $2 AND field_name = $3
             AND value_digest IS NOT DISTINCT FROM $8
           RETURNING entity_type`,
          [
            plan.entityType,
            plan.entityId,
            plan.fieldName,
            JSON.stringify(plan.afterValue),
            afterDigest,
            plan.dataRevision,
            plan.publishedAt,
            plan.expectedCanonicalDigest,
            plan.knowledgeState ?? "unknown",
            plan.assessmentState ?? "legacy/unverified",
          ]
        );
        if (!updated.rows[0]) {
          return { write: "cas_conflict" as const };
        }
      }

      await client.query(
        `INSERT INTO publication_attempts (
           id, idempotency_key, request_digest, proposal_id, revision_id, publisher_id, state, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$7)
         ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = EXCLUDED.updated_at
         WHERE publication_attempts.request_digest = EXCLUDED.request_digest
           AND publication_attempts.proposal_id = EXCLUDED.proposal_id
           AND publication_attempts.revision_id = EXCLUDED.revision_id
           AND publication_attempts.publisher_id = EXCLUDED.publisher_id`,
        [
          plan.attemptId,
          plan.idempotencyKey,
          plan.requestDigest,
          plan.proposal.id,
          plan.revision.id,
          plan.publisherPrincipal,
          plan.publishedAt,
        ]
      );
      const attemptRows = await client.query("SELECT * FROM publication_attempts WHERE idempotency_key = $1 FOR UPDATE", [
        plan.idempotencyKey,
      ]);
      if (!attemptRows.rows[0]) {
        return {
          write: "rejected" as const,
          code: PUBLICATION_ERROR.idempotencyConflict,
          message: "same idempotency key with an altered publication request",
        };
      }
      const existingAttempt = mapAttempt(attemptRows.rows[0]);
      if (!attemptIdentityEqual(existingAttempt, {
        requestDigest: plan.requestDigest,
        proposalId: plan.proposal.id,
        revisionId: plan.revision.id,
        publisherId: plan.publisherPrincipal,
      })) {
        return {
          write: "rejected" as const,
          code: PUBLICATION_ERROR.idempotencyConflict,
          message: "same idempotency key with an altered publication request",
        };
      }
      const attemptId = existingAttempt.id;

      await client.query(
        `INSERT INTO publication_receipts (
           id, attempt_id, proposal_id, revision_id, revision_ordinal, body_digest, approval_id, approval_digest,
           reviewer_id, publisher_id, methodology_version, data_revision, idempotency_key, evidence_snapshot_ids,
           before_value, after_value, entity_type, entity_id, field_name, change_type, verification_state,
           published_at, supersedes_receipt_id, knowledge_state, assessment_state
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$21,$22,$23,$24,$25
         )`,
        [
          plan.receiptId,
          attemptId,
          plan.proposal.id,
          plan.revision.id,
          plan.revision.revisionOrdinal,
          plan.revision.bodyDigest,
          plan.approval.id,
          plan.approvalDigest,
          plan.approval.reviewerId,
          plan.publisherPrincipal,
          plan.methodologyVersion,
          plan.dataRevision,
          plan.idempotencyKey,
          JSON.stringify(plan.evidenceSnapshotIds),
          JSON.stringify(plan.beforeValue),
          JSON.stringify(plan.afterValue),
          plan.entityType,
          plan.entityId,
          plan.fieldName,
          plan.changeType,
          plan.verificationState,
          plan.publishedAt,
          plan.supersedesReceiptId,
          plan.knowledgeState ?? "unknown",
          plan.assessmentState ?? "legacy/unverified",
        ]
      );

      await client.query(
        `INSERT INTO change_events (
           id, receipt_id, revision_id, proposal_id, change_type, entity_type, entity_id, field_name,
           old_value, new_value, value_sensitivity, source_id, evidence_snapshot_ids, detected_at,
           observed_at, reviewed_at, published_at, correction_of_event_id, title_id, title_en,
           summary_id, summary_en, provider_id, href, knowledge_state, assessment_state
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
         )`,
        [
          plan.eventId,
          plan.receiptId,
          plan.revision.id,
          plan.proposal.id,
          plan.changeType,
          plan.entityType,
          plan.entityId,
          plan.fieldName,
          JSON.stringify(plan.beforeValue),
          JSON.stringify(plan.afterValue),
          plan.valueSensitivity,
          plan.sourceId,
          JSON.stringify(plan.evidenceSnapshotIds),
          plan.detectedAt,
          plan.observedAt,
          plan.reviewedAt,
          plan.publishedAt,
          plan.correctionOfEventId,
          plan.titleId,
          plan.titleEn,
          plan.summaryId,
          plan.summaryEn,
          plan.providerId,
          plan.href,
          plan.knowledgeState ?? "unknown",
          plan.assessmentState ?? "legacy/unverified",
        ]
      );

      await client.query(
        `UPDATE publication_attempts SET state = 'committed', updated_at = $2 WHERE id = $1`,
        [attemptId, plan.publishedAt]
      );
      await client.query(`UPDATE proposals SET status = 'published', updated_at = $2 WHERE id = $1`, [
        plan.proposal.id,
        plan.publishedAt,
      ]);

      const receiptRows = await client.query("SELECT * FROM publication_receipts WHERE id = $1", [plan.receiptId]);
      const eventRows = await client.query("SELECT * FROM change_events WHERE id = $1", [plan.eventId]);
      return {
        write: "ok" as const,
        receipt: mapReceipt(receiptRows.rows[0]),
        event: mapEvent(eventRows.rows[0]),
      };
    });
    if (result.status === "ok") return result.value;
    if (result.status === "conflict") {
      const receipt = await this.findReceiptByIdempotencyKey(plan.idempotencyKey);
      const event = receipt ? await this.findEventByReceiptId(receipt.id) : null;
      const attempt = await this.findAttemptByIdempotencyKey(plan.idempotencyKey);
      const incoming = {
        requestDigest: plan.requestDigest,
        proposalId: plan.proposal.id,
        revisionId: plan.revision.id,
        publisherId: plan.publisherPrincipal,
      };
      if (receipt && event && publicationReplayAllowed({ receipt, attempt, incoming })) {
        return { write: "replayed", receipt, event };
      }
      if (receipt) {
        return {
          write: "rejected",
          code: PUBLICATION_ERROR.idempotencyConflict,
          message: "same idempotency key with an altered publication request",
        };
      }
      const taken = await this.getCanonicalState(plan.entityType, plan.entityId, plan.fieldName);
      if (taken) return { write: "cas_conflict" };
    }
    return { write: "uncertain" };
  }

  async commitVerification(plan: PreparedVerification): Promise<VerifyWriteResult> {
    const result = await this.transact(async (client) => {
      const receiptRows = await client.query("SELECT * FROM publication_receipts WHERE id = $1 FOR UPDATE", [
        plan.receiptId,
      ]);
      if (!receiptRows.rows[0]) {
        return { write: "rejected" as const, code: PUBLICATION_ERROR.notFound, message: "publication receipt not found" };
      }
      const receipt = mapReceipt(receiptRows.rows[0]);
      if (plan.verifierPrincipal === receipt.publisherId) return { write: "self_verify" as const };
      const proposalRows = await client.query("SELECT actor_id FROM proposals WHERE id = $1", [receipt.proposalId]);
      const revisionRows = await client.query("SELECT actor_id FROM revisions WHERE id = $1", [receipt.revisionId]);
      const proposalActor = proposalRows.rows[0] ? String(proposalRows.rows[0].actor_id) : null;
      const revisionActor = revisionRows.rows[0] ? String(revisionRows.rows[0].actor_id) : null;
      if (plan.verifierPrincipal === proposalActor || plan.verifierPrincipal === revisionActor) {
        return { write: "self_verify" as const };
      }
      const eventRows = await client.query("SELECT * FROM change_events WHERE receipt_id = $1 FOR UPDATE", [receipt.id]);
      const event = eventRows.rows[0] ? mapEvent(eventRows.rows[0]) : null;
      await lockCanonicalKey(client, receipt.entityType, receipt.entityId, receipt.fieldName);
      const canonicalRows = await client.query(
        "SELECT * FROM canonical_states WHERE entity_type = $1 AND entity_id = $2 AND field_name = $3",
        [receipt.entityType, receipt.entityId, receipt.fieldName]
      );
      const canonicalRow = canonicalRows.rows[0];
      const canonical = canonicalRow
        ? {
            entityType: String(canonicalRow.entity_type),
            entityId: String(canonicalRow.entity_id),
            fieldName: String(canonicalRow.field_name),
            value: canonicalRow.value,
            valueDigest: String(canonicalRow.value_digest),
            dataRevision: String(canonicalRow.data_revision),
            updatedAt: iso(canonicalRow.updated_at as Date | string) ?? "",
          }
        : null;
      const judgment = judgeVerification({ receipt, event, canonical, plan });
      if (receipt.verificationState === "verified") {
        if (verificationReplayAllowed({
          verifiedBy: receipt.verifiedBy,
          verifierPrincipal: plan.verifierPrincipal,
          judgment,
        })) {
          return { write: "replayed" as const, receipt };
        }
        return {
          write: "rejected" as const,
          code: PUBLICATION_ERROR.verificationMismatch,
          message: "publication is already verified; refusing to rewrite history",
        };
      }
      if (receipt.verificationState === "failed") {
        return { write: "mismatch" as const, receipt, state: "failed" as const };
      }
      if (receipt.verificationState !== "pending" && receipt.verificationState !== "uncertain") {
        return {
          write: "rejected" as const,
          code: PUBLICATION_ERROR.verificationMismatch,
          message: "publication verification cannot be rewritten",
        };
      }
      const nextState = judgment === "match" ? "verified" : judgment;
      if (!verificationStateAllowed(receipt.verificationState, nextState)) {
        return {
          write: "rejected" as const,
          code: PUBLICATION_ERROR.verificationMismatch,
          message: "publication verification cannot be rewritten",
        };
      }
      await client.query(
        `UPDATE publication_receipts
         SET verification_state = $2, verified_by = $3, verified_at = $4
         WHERE id = $1`,
        [receipt.id, nextState, plan.verifierPrincipal, plan.verifiedAt]
      );
      const updatedRows = await client.query("SELECT * FROM publication_receipts WHERE id = $1", [receipt.id]);
      const updated = mapReceipt(updatedRows.rows[0]);
      if (nextState === "verified") return { write: "ok" as const, receipt: updated };
      return { write: "mismatch" as const, receipt: updated, state: nextState };
    });
    if (result.status === "ok") return result.value;
    if (result.status === "conflict") {
      const receipt = await this.findReceiptById(plan.receiptId);
      if (
        receipt?.verificationState === "verified" &&
        verificationReplayAllowed({
          verifiedBy: receipt.verifiedBy,
          verifierPrincipal: plan.verifierPrincipal,
          judgment: "match",
        })
      ) {
        return { write: "replayed", receipt };
      }
      if (receipt?.verificationState === "verified") {
        return {
          write: "rejected",
          code: PUBLICATION_ERROR.verificationMismatch,
          message: "publication is already verified; refusing to rewrite history",
        };
      }
      if (receipt && (receipt.verificationState === "failed" || receipt.verificationState === "uncertain")) {
        return { write: "mismatch", receipt, state: receipt.verificationState };
      }
    }
    return { write: "uncertain" };
  }

  private async transact<T>(
    fn: (client: QueryExecutor) => Promise<T>
  ): Promise<{ status: "ok"; value: T } | { status: "conflict" } | { status: "uncertain" }> {
    let client: DedicatedClient | undefined;
    try {
      client = await this.provider.connect();
    } catch {
      return { status: "uncertain" };
    }
    try {
      try {
        await client.query("BEGIN");
      } catch {
        return { status: "uncertain" };
      }
      try {
        const value = await fn(client);
        const write =
          typeof value === "object" && value !== null && "write" in value
            ? String((value as { write?: unknown }).write)
            : "";
        if (write === "cas_conflict" || write === "rejected" || write === "self_publish" || write === "self_verify") {
          await client.query("ROLLBACK");
          return { status: "ok", value };
        }
        await client.query("COMMIT");
        return { status: "ok", value };
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          return { status: "uncertain" };
        }
        if (
          pgMessage(err).includes("cannot publish own") ||
          pgMessage(err).includes("revision author cannot publish")
        ) {
          return { status: "ok", value: { write: "self_publish" } as T };
        }
        if (isCanonicalUniqueViolation(err)) {
          return { status: "ok", value: { write: "cas_conflict" } as T };
        }
        if (pgCode(err) === "23505") return { status: "conflict" };
        return { status: "uncertain" };
      }
    } finally {
      try {
        client.release();
      } catch {
        // already released
      }
    }
  }
}
