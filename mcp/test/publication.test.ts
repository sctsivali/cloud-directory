import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../../packages/domain/src/scoring/methodology.ts";
import { bodyDigestFromValue } from "../../packages/domain/src/revisions/digest.ts";
import { selectPublicUpdates, toApiUpdate, toPublicUpdate } from "../../packages/domain/src/revisions/public-feed.ts";
import {
  projectPublicTimelineDocument,
  projectVerifiedPublicReadModel,
} from "../../packages/domain/src/revisions/public-projection.ts";
import {
  buildCountryTimeline,
  buildProviderTimeline,
  factsFromLedgerRows,
  inferObservationWindow,
  publicTrendView,
  buildTrendReport,
  windowFromInferred,
} from "../../packages/domain/src/intelligence/index.ts";
import type { PreparedPublication } from "../../packages/domain/src/revisions/types.ts";
import { PostgresDirectoryReader } from "../src/read-tools.ts";
import { OUTCOME } from "../src/errors.ts";
import { executeTool } from "../src/handlers.ts";
import { PostgresProposalRepository, type ConnectionProvider, type QueryExecutor } from "../src/pg-store.ts";
import { PostgresPublicationStore } from "../src/pg-publication.ts";
import { submitProposal } from "../src/proposal-tools.ts";
import { approveProposal, reviseProposal } from "../src/review-tools.ts";
import { createDirectoryMcpServer } from "../src/server.ts";
import { TEST_DATABASE_URL, withMigratedDatabase } from "./pg-harness.ts";

const claim = {
  subjectType: "provider",
  subjectId: "local-packages",
  claimType: "hypervisor",
  value: { text: "KVM" },
  knowledgeState: "present",
  assessmentState: "independently_verified",
  observedAt: "2026-09-01T00:00:00.000Z",
  snapshotId: "snap-1",
};

function payloadOf(result: unknown): Record<string, unknown> {
  const record = result as { content?: { text?: string }[] };
  const text = record.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("missing tool text");
  return JSON.parse(text) as Record<string, unknown>;
}

function digestHex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

async function approveClaim(pool: ConnectionProvider, key: string, actor = "worker-a", reviewer = "editor-1") {
  return approveProposalBody(pool, "directory.propose_claim", { ...claim, idempotencyKey: key }, key, actor, reviewer);
}

async function approveProposalBody(
  pool: ConnectionProvider,
  toolName: string,
  body: Record<string, unknown>,
  key: string,
  actor = "worker-a",
  reviewer = "editor-1"
) {
  const repo = new PostgresProposalRepository(pool);
  const created = await submitProposal(repo, toolName, { ...body, idempotencyKey: key }, actor);
  assert.equal(created.outcome, OUTCOME.created);
  if (created.outcome !== "created") throw new Error("proposal missing");
  const approved = await approveProposal(repo, { proposalId: created.proposal.id }, reviewer);
  assert.equal(approved.outcome, OUTCOME.created);
  if (approved.outcome !== "created") throw new Error("approval missing");
  const revisions = await repo.listRevisions(created.proposal.id);
  const latest = revisions[revisions.length - 1];
  if (!latest) throw new Error("revision missing");
  return { repo, proposal: approved.proposal, revision: latest };
}

function publishArgs(proposalId: string, revisionId: string, bodyDigest: string, key: string) {
  return {
    proposalId,
    expectedRevisionId: revisionId,
    expectedBodyDigest: bodyDigest,
    idempotencyKey: key,
    methodologyVersion: CURRENT_METHODOLOGY.id,
    dataRevision: `drv-${key}`,
  };
}

describe("PostgreSQL publication ledger", { skip: !TEST_DATABASE_URL }, () => {
  it("publishes through the MCP publish session and records a receipt", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const ready = await approveClaim(pool, "pg-pub-1");
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication: new PostgresPublicationStore(pool),
          principalId: "publisher-1",
        },
      });
      const result = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-pub-1")
        )
      );
      assert.equal(result.outcome, OUTCOME.created);
      const receipt = result.receipt as { bodyDigest?: string; publisherId?: string };
      assert.equal(receipt.publisherId, "publisher-1");
      assert.ok(digestHex(String(receipt.bodyDigest)));
      const receipts = await client.query("SELECT * FROM publication_receipts");
      const events = await client.query("SELECT * FROM change_events");
      assert.equal(receipts.rows.length, 1);
      assert.equal(events.rows.length, 1);
      assert.equal(events.rows[0].revision_id, ready.revision.id);
    });
  });

  it("replays a confirmed publish and rejects an altered key", async () => {
    await withMigratedDatabase(async (_client, pool) => {
      const ready = await approveClaim(pool, "pg-replay");
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication: new PostgresPublicationStore(pool),
          principalId: "publisher-1",
        },
      });
      const args = publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-replay");
      const first = payloadOf(await publisher.invoke("directory.publish_revision", args));
      const replay = payloadOf(await publisher.invoke("directory.publish_revision", args));
      assert.equal(first.outcome, OUTCOME.created);
      assert.equal(replay.outcome, OUTCOME.replayed);
      const altered = payloadOf(
        await publisher.invoke("directory.publish_revision", { ...args, dataRevision: "drv-other" })
      );
      assert.equal(altered.outcome, OUTCOME.rejected);
      const otherPublisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication: new PostgresPublicationStore(pool),
          principalId: "publisher-2",
        },
      });
      const stolen = payloadOf(await otherPublisher.invoke("directory.publish_revision", args));
      assert.equal(stolen.outcome, OUTCOME.rejected);
    });
  });

  it("rejects self-publish, stale approval, and post-approval mutation", async () => {
    await withMigratedDatabase(async (_client, pool) => {
      const ready = await approveClaim(pool, "pg-self");
      const selfPublisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication: new PostgresPublicationStore(pool),
          principalId: "worker-a",
        },
      });
      const self = payloadOf(
        await selfPublisher.invoke(
          "directory.publish_revision",
          publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-self")
        )
      );
      assert.equal(self.outcome, OUTCOME.rejected);

      const staleReady = await approveClaim(pool, "pg-stale");
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: staleReady.repo,
          publication: new PostgresPublicationStore(pool),
          principalId: "publisher-1",
        },
      });
      const stale = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(staleReady.proposal.id, "missing-revision", staleReady.proposal.bodyDigest, "pg-stale")
        )
      );
      assert.equal(stale.outcome, OUTCOME.rejected);

      const mutated = await approveClaim(pool, "pg-mut");
      await reviseProposal(
        mutated.repo,
        { proposalId: mutated.proposal.id, body: { ...claim, value: { text: "Xen" } } },
        "worker-a"
      );
      const afterMut = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(mutated.proposal.id, mutated.revision.id, mutated.proposal.bodyDigest, "pg-mut")
        )
      );
      assert.equal(afterMut.outcome, OUTCOME.rejected);
    });
  });

  it("treats a crashed publish as durable ambiguous and never blind-retries", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const ready = await approveClaim(pool, "pg-crash");
      let writes = 0;
      const faulting = {
        query: pool.query.bind(pool),
        async connect() {
          const leased = await pool.connect();
          return {
            query: async (queryText: string, values?: unknown[]) => {
              const trimmed = String(queryText).trim();
              if (/^INSERT INTO publication_receipts\b/i.test(trimmed)) {
                writes += 1;
                if (writes === 1) {
                  throw Object.assign(new Error("injected publish crash"), { code: "XX000" });
                }
              }
              return leased.query(queryText, values);
            },
            release: () => leased.release(),
          };
        },
      } as ConnectionProvider;
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication: new PostgresPublicationStore(faulting),
          principalId: "publisher-1",
        },
      });
      const args = publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-crash");
      const crashed = payloadOf(await publisher.invoke("directory.publish_revision", args));
      assert.equal(crashed.outcome, OUTCOME.ambiguous);
      const receipts = await client.query("SELECT id FROM publication_receipts");
      assert.equal(receipts.rows.length, 0);
      const retry = payloadOf(await publisher.invoke("directory.publish_revision", args));
      assert.equal(retry.outcome, OUTCOME.ambiguous);
      const after = await client.query("SELECT id FROM publication_receipts");
      assert.equal(after.rows.length, 0);
    });
  });

  it("serializes concurrent publishes of the same proposal to one receipt", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const ready = await approveClaim(pool, "pg-race");
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication: new PostgresPublicationStore(pool),
          principalId: "publisher-1",
        },
      });
      const args = publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-race");
      const results = await Promise.all(
        Array.from({ length: 8 }, () => publisher.invoke("directory.publish_revision", args))
      );
      const payloads = results.map(payloadOf);
      const created = payloads.filter((row) => row.outcome === OUTCOME.created);
      const replayed = payloads.filter((row) => row.outcome === OUTCOME.replayed);
      assert.equal(created.length, 1);
      assert.equal(created.length + replayed.length, payloads.length);
      const receipts = await client.query("SELECT id FROM publication_receipts");
      const events = await client.query("SELECT id FROM change_events");
      assert.equal(receipts.rows.length, 1);
      assert.equal(events.rows.length, 1);
    });
  });

  it("runs twenty concurrent-publish stress iterations", async () => {
    for (let run = 0; run < 20; run += 1) {
      await withMigratedDatabase(async (client, pool) => {
        const ready = await approveClaim(pool, `pg-stress-${run}`);
        const publisher = createDirectoryMcpServer({
          capabilities: ["publish"],
          context: {
            reader: null,
            repo: ready.repo,
            publication: new PostgresPublicationStore(pool),
            principalId: "publisher-1",
          },
        });
        const args = publishArgs(
          ready.proposal.id,
          ready.revision.id,
          ready.proposal.bodyDigest,
          `pg-stress-${run}`
        );
        const results = await Promise.all(
          Array.from({ length: 6 }, () => publisher.invoke("directory.publish_revision", args))
        );
        const payloads = results.map(payloadOf);
        assert.equal(payloads.filter((row) => row.outcome === OUTCOME.created).length, 1);
        const receipts = await client.query("SELECT id FROM publication_receipts");
        assert.equal(receipts.rows.length, 1, `run ${run}`);
      });
    }
  });

  it("rolls back as a new event and keeps public-feed parity with the API shape", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const ready = await approveClaim(pool, "pg-roll-src");
      const publication = new PostgresPublicationStore(pool);
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication,
          principalId: "publisher-1",
        },
      });
      const published = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-roll-src")
        )
      );
      assert.equal(published.outcome, OUTCOME.created);
      const receipt = published.receipt as { id: string };
      const rollbackReady = await approveClaim(pool, "pg-roll-new", "worker-b", "editor-2");
      const rolled = payloadOf(
        await executeTool(
          {
            reader: null,
            repo: rollbackReady.repo,
            publication,
            principalId: "publisher-1",
            capabilities: ["publish"],
          },
          "directory.publish_change",
          {
            revisionId: rollbackReady.revision.id,
            expectedRevisionId: rollbackReady.revision.id,
            expectedBodyDigest: rollbackReady.proposal.bodyDigest,
            idempotencyKey: "pg-roll-new",
            methodologyVersion: CURRENT_METHODOLOGY.id,
            dataRevision: "drv-roll",
            rollbackOfReceiptId: receipt.id,
          }
        )
      );
      assert.equal(rolled.outcome, OUTCOME.created);
      const events = await client.query(
        "SELECT id, change_type, correction_of_event_id, old_value, new_value, revision_id, published_at FROM change_events ORDER BY published_at"
      );
      assert.equal(events.rows.length, 2);
      assert.equal(events.rows[1].change_type, "rollback");
      assert.equal(events.rows[1].correction_of_event_id, events.rows[0].id);
      const originals = await client.query("SELECT id FROM publication_receipts WHERE id = $1", [receipt.id]);
      assert.equal(originals.rows.length, 1);

      const mapped = events.rows.map((row) =>
        toPublicUpdate({
          id: String(row.id),
          receiptId: "x",
          revisionId: String(row.revision_id),
          proposalId: "p",
          changeType: String(row.change_type) as "rollback",
          entityType: "provider",
          entityId: "local-packages",
          fieldName: "hypervisor",
          oldValue: row.old_value,
          newValue: row.new_value,
          valueSensitivity: "public",
          sourceId: "snap-1",
          evidenceSnapshotIds: ["snap-1"],
          detectedAt: "2026-09-01T00:00:00.000Z",
          observedAt: "2026-09-01T00:00:00.000Z",
          reviewedAt: "2026-09-09T00:00:00.000Z",
          publishedAt: new Date(row.published_at).toISOString(),
          correctionOfEventId: row.correction_of_event_id ? String(row.correction_of_event_id) : null,
          titleId: "t",
          titleEn: "t",
          summaryId: null,
          summaryEn: null,
          providerId: "local-packages",
          href: "/provider/local-packages",
        })
      );
      const selected = selectPublicUpdates(
        mapped.map((row, i) => ({
          id: String(events.rows[i].id),
          receiptId: "x",
          revisionId: String(events.rows[i].revision_id),
          proposalId: "p",
          changeType: String(events.rows[i].change_type) as "create" | "rollback",
          entityType: "provider",
          entityId: "local-packages",
          fieldName: "hypervisor",
          oldValue: events.rows[i].old_value,
          newValue: events.rows[i].new_value,
          valueSensitivity: "public" as const,
          sourceId: "snap-1",
          evidenceSnapshotIds: ["snap-1"],
          detectedAt: "2026-09-01T00:00:00.000Z",
          observedAt: "2026-09-01T00:00:00.000Z",
          reviewedAt: "2026-09-09T00:00:00.000Z",
          publishedAt: new Date(events.rows[i].published_at).toISOString(),
          correctionOfEventId: events.rows[i].correction_of_event_id
            ? String(events.rows[i].correction_of_event_id)
            : null,
          titleId: "t",
          titleEn: "t",
          summaryId: null,
          summaryEn: null,
          providerId: "local-packages",
          href: "/provider/local-packages",
        })),
        []
      );
      assert.equal(selected.length, 2);
      assert.deepEqual(toApiUpdate(selected[0]!), toApiUpdate(toPublicUpdate({
        id: String(events.rows[0].id),
        receiptId: "x",
        revisionId: String(events.rows[0].revision_id),
        proposalId: "p",
        changeType: "create",
        entityType: "provider",
        entityId: "local-packages",
        fieldName: "hypervisor",
        oldValue: events.rows[0].old_value,
        newValue: events.rows[0].new_value,
        valueSensitivity: "public",
        sourceId: "snap-1",
        evidenceSnapshotIds: ["snap-1"],
        detectedAt: "2026-09-01T00:00:00.000Z",
        observedAt: "2026-09-01T00:00:00.000Z",
        reviewedAt: "2026-09-09T00:00:00.000Z",
        publishedAt: new Date(events.rows[0].published_at).toISOString(),
        correctionOfEventId: null,
        titleId: "t",
        titleEn: "t",
        summaryId: null,
        summaryEn: null,
        providerId: "local-packages",
        href: "/provider/local-packages",
      })));
    });
  });

  it("rejects a publish whose approval was invalidated after prevalidation and before commit", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const ready = await approveClaim(pool, "pg-interleave");
      class InterleavingStore extends PostgresPublicationStore {
        override async commitPublication(plan: PreparedPublication) {
          await reviseProposal(
            ready.repo,
            { proposalId: ready.proposal.id, body: { ...claim, value: { text: "Xen" } } },
            "worker-a"
          );
          return super.commitPublication(plan);
        }
      }
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication: new InterleavingStore(pool),
          principalId: "publisher-1",
        },
      });
      const result = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-interleave")
        )
      );
      assert.equal(result.outcome, OUTCOME.rejected);
      const receipts = await client.query("SELECT id FROM publication_receipts");
      const events = await client.query("SELECT id FROM change_events");
      assert.equal(receipts.rows.length, 0);
      assert.equal(events.rows.length, 0);
    });
  });

  it("keeps committed attempts monotonic against uncertain recording and identity overwrite", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const ready = await approveClaim(pool, "pg-attempt");
      const store = new PostgresPublicationStore(pool);
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication: store,
          principalId: "publisher-1",
        },
      });
      const created = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-attempt")
        )
      );
      assert.equal(created.outcome, OUTCOME.created);
      const before = await client.query(
        "SELECT id, request_digest, proposal_id, revision_id, publisher_id, state FROM publication_attempts WHERE idempotency_key = $1",
        ["pg-attempt"]
      );
      assert.equal(before.rows[0].state, "committed");
      const attempt = {
        id: String(before.rows[0].id),
        idempotencyKey: "pg-attempt",
        requestDigest: String(before.rows[0].request_digest),
        proposalId: String(before.rows[0].proposal_id),
        revisionId: String(before.rows[0].revision_id),
        publisherId: String(before.rows[0].publisher_id),
        state: "uncertain" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.recordUncertainAttempt(attempt);
      const afterSame = await client.query("SELECT state, request_digest FROM publication_attempts WHERE idempotency_key = $1", [
        "pg-attempt",
      ]);
      assert.equal(afterSame.rows[0].state, "committed");
      await assert.rejects(
        () =>
          store.recordUncertainAttempt({
            ...attempt,
            requestDigest: "c".repeat(64),
            publisherId: "publisher-2",
          }),
        /identity mismatch/
      );
      await assert.rejects(() =>
        client.query("UPDATE publication_attempts SET state = 'uncertain' WHERE idempotency_key = $1", ["pg-attempt"])
      );
      const locked = await client.query(
        "SELECT state, request_digest, proposal_id, revision_id, publisher_id FROM publication_attempts WHERE idempotency_key = $1",
        ["pg-attempt"]
      );
      assert.equal(locked.rows[0].state, "committed");
      assert.equal(String(locked.rows[0].request_digest), attempt.requestDigest);
      assert.equal(String(locked.rows[0].proposal_id), attempt.proposalId);
    });
  });

  it("does not regress a committed attempt when publish returns ambiguous after a confirmed commit", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const ready = await approveClaim(pool, "pg-after-commit");
      class HideReceiptStore extends PostgresPublicationStore {
        hide = false;
        override async commitPublication(plan: PreparedPublication) {
          const wrote = await super.commitPublication(plan);
          this.hide = true;
          if (wrote.write === "ok") return { write: "uncertain" as const };
          return wrote;
        }
        override async findReceiptByIdempotencyKey(key: string) {
          if (this.hide) return null;
          return super.findReceiptByIdempotencyKey(key);
        }
      }
      const store = new HideReceiptStore(pool);
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication: store,
          principalId: "publisher-1",
        },
      });
      const crashed = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-after-commit")
        )
      );
      assert.equal(crashed.outcome, OUTCOME.ambiguous);
      const attempt = await client.query("SELECT state FROM publication_attempts WHERE idempotency_key = $1", [
        "pg-after-commit",
      ]);
      assert.equal(attempt.rows[0].state, "committed");
      const receipts = await client.query("SELECT id, after_value FROM publication_receipts");
      assert.equal(receipts.rows.length, 1);
      store.hide = false;
      const retry = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-after-commit")
        )
      );
      assert.equal(retry.outcome, OUTCOME.replayed);
      const after = await client.query("SELECT state FROM publication_attempts WHERE idempotency_key = $1", [
        "pg-after-commit",
      ]);
      assert.equal(after.rows[0].state, "committed");
      assert.equal((await client.query("SELECT id FROM publication_receipts")).rows.length, 1);
    });
  });

  it("publishes pending verification and verifies with a different principal", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const ready = await approveClaim(pool, "pg-verify");
      const publication = new PostgresPublicationStore(pool);
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication,
          principalId: "publisher-1",
        },
      });
      const published = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-verify")
        )
      );
      assert.equal(published.outcome, OUTCOME.created);
      const receipt = published.receipt as {
        id: string;
        verificationState: string;
        afterValue: unknown;
        dataRevision: string;
        publisherId: string;
      };
      const event = published.event as { id: string };
      assert.equal(receipt.verificationState, "pending");
      const pendingRow = await client.query("SELECT verification_state FROM publication_receipts WHERE id = $1", [
        receipt.id,
      ]);
      assert.equal(pendingRow.rows[0].verification_state, "pending");

      const self = payloadOf(
        await executeTool(
          {
            reader: null,
            repo: ready.repo,
            publication,
            principalId: "publisher-1",
            capabilities: ["verify"],
          },
          "directory.verify_publication",
          {
            receiptId: receipt.id,
            eventId: event.id,
            expectedValueDigest: bodyDigestFromValue(receipt.afterValue),
            expectedDataRevision: receipt.dataRevision,
          }
        )
      );
      assert.equal(self.outcome, OUTCOME.rejected);

      const verifier = createDirectoryMcpServer({
        capabilities: ["verify"],
        context: {
          reader: null,
          repo: ready.repo,
          publication,
          principalId: "verifier-1",
        },
      });
      const args = {
        receiptId: receipt.id,
        eventId: event.id,
        expectedValueDigest: bodyDigestFromValue(receipt.afterValue),
        expectedDataRevision: receipt.dataRevision,
      };
      const first = payloadOf(await verifier.invoke("directory.verify_publication", args));
      const replay = payloadOf(await verifier.invoke("directory.verify_publication", args));
      assert.equal(first.outcome, OUTCOME.created);
      assert.equal(replay.outcome, OUTCOME.replayed);
      const verified = first.receipt as { verificationState: string; verifiedBy: string; afterValue: unknown };
      assert.equal(verified.verificationState, "verified");
      assert.equal(verified.verifiedBy, "verifier-1");
      assert.deepEqual(verified.afterValue, receipt.afterValue);

      const mismatchReady = await approveClaim(pool, "pg-verify-miss");
      const mismatchedPub = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(
            mismatchReady.proposal.id,
            mismatchReady.revision.id,
            mismatchReady.proposal.bodyDigest,
            "pg-verify-miss"
          )
        )
      );
      const missReceipt = mismatchedPub.receipt as { id: string; afterValue: unknown; dataRevision: string };
      const missEvent = mismatchedPub.event as { id: string };
      const mismatch = payloadOf(
        await verifier.invoke("directory.verify_publication", {
          receiptId: missReceipt.id,
          eventId: missEvent.id,
          expectedValueDigest: "d".repeat(64),
          expectedDataRevision: missReceipt.dataRevision,
        })
      );
      assert.equal(mismatch.outcome, OUTCOME.rejected);
      const failed = await client.query(
        "SELECT verification_state, after_value, body_digest FROM publication_receipts WHERE id = $1",
        [missReceipt.id]
      );
      assert.equal(failed.rows[0].verification_state, "failed");
      assert.deepEqual(failed.rows[0].after_value, missReceipt.afterValue);
    });
  });

  it("serializes concurrent verifications and twenty publication/verify stress iterations", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const ready = await approveClaim(pool, "pg-verify-race");
      const publication = new PostgresPublicationStore(pool);
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: {
          reader: null,
          repo: ready.repo,
          publication,
          principalId: "publisher-1",
        },
      });
      const published = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-verify-race")
        )
      );
      assert.equal(published.outcome, OUTCOME.created);
      const receipt = published.receipt as { id: string; afterValue: unknown; dataRevision: string };
      const event = published.event as { id: string };
      const verifier = createDirectoryMcpServer({
        capabilities: ["verify"],
        context: {
          reader: null,
          repo: ready.repo,
          publication,
          principalId: "verifier-1",
        },
      });
      const args = {
        receiptId: receipt.id,
        eventId: event.id,
        expectedValueDigest: bodyDigestFromValue(receipt.afterValue),
        expectedDataRevision: receipt.dataRevision,
      };
      const raced = await Promise.all(
        Array.from({ length: 8 }, () => verifier.invoke("directory.verify_publication", args))
      );
      const payloads = raced.map(payloadOf);
      assert.equal(payloads.filter((row) => row.outcome === OUTCOME.created).length, 1);
      assert.equal(
        payloads.filter((row) => row.outcome === OUTCOME.created || row.outcome === OUTCOME.replayed).length,
        payloads.length
      );
      const states = await client.query("SELECT verification_state FROM publication_receipts");
      assert.equal(states.rows.length, 1);
      assert.equal(states.rows[0].verification_state, "verified");
    });

    for (let run = 0; run < 20; run += 1) {
      await withMigratedDatabase(async (client, pool) => {
        const ready = await approveClaim(pool, `pg-verify-stress-${run}`);
        const publication = new PostgresPublicationStore(pool);
        const publisher = createDirectoryMcpServer({
          capabilities: ["publish"],
          context: {
            reader: null,
            repo: ready.repo,
            publication,
            principalId: "publisher-1",
          },
        });
        const published = payloadOf(
          await publisher.invoke(
            "directory.publish_revision",
            publishArgs(
              ready.proposal.id,
              ready.revision.id,
              ready.proposal.bodyDigest,
              `pg-verify-stress-${run}`
            )
          )
        );
        assert.equal(published.outcome, OUTCOME.created);
        const receipt = published.receipt as { id: string; afterValue: unknown; dataRevision: string };
        const event = published.event as { id: string };
        const verifier = createDirectoryMcpServer({
          capabilities: ["verify"],
          context: {
            reader: null,
            repo: ready.repo,
            publication,
            principalId: "verifier-1",
          },
        });
        const args = {
          receiptId: receipt.id,
          eventId: event.id,
          expectedValueDigest: bodyDigestFromValue(receipt.afterValue),
          expectedDataRevision: receipt.dataRevision,
        };
        const results = await Promise.all(
          Array.from({ length: 6 }, () => verifier.invoke("directory.verify_publication", args))
        );
        const payloads = results.map(payloadOf);
        assert.equal(payloads.filter((row) => row.outcome === OUTCOME.created).length, 1, `run ${run}`);
        const row = await client.query("SELECT verification_state FROM publication_receipts");
        assert.equal(row.rows[0].verification_state, "verified", `run ${run}`);
      });
    }
  });

  it("serializes two different proposals racing on an absent canonical key", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const left = await approveProposalBody(
        pool,
        "directory.propose_claim",
        { ...claim, value: { text: "KVM" } },
        "pg-absent-a"
      );
      const right = await approveProposalBody(
        pool,
        "directory.propose_claim",
        { ...claim, value: { text: "Xen" } },
        "pg-absent-b",
        "worker-b",
        "editor-2"
      );
      const publication = new PostgresPublicationStore(pool);
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: { reader: null, repo: left.repo, publication, principalId: "publisher-1" },
      });
      const leftArgs = publishArgs(left.proposal.id, left.revision.id, left.proposal.bodyDigest, "pg-absent-a");
      const rightArgs = publishArgs(right.proposal.id, right.revision.id, right.proposal.bodyDigest, "pg-absent-b");
      const raced = await Promise.all([
        publisher.invoke("directory.publish_revision", leftArgs),
        publisher.invoke("directory.publish_revision", rightArgs),
      ]);
      const payloads = raced.map(payloadOf);
      const created = payloads.filter((row) => row.outcome === OUTCOME.created);
      const conflicts = payloads.filter(
        (row) => row.outcome === OUTCOME.rejected && row.code === "canonical_state_conflict"
      );
      assert.equal(created.length, 1);
      assert.equal(conflicts.length, 1);
      const winner = created[0]!.receipt as { beforeValue: unknown; afterValue: unknown; id: string };
      assert.equal(winner.beforeValue, null);
      const receipts = await client.query(
        "SELECT id, before_value, after_value, entity_type, entity_id, field_name FROM publication_receipts"
      );
      assert.equal(receipts.rows.length, 1);
      assert.equal(receipts.rows[0].before_value, null);
      assert.deepEqual(receipts.rows[0].after_value, winner.afterValue);
      const canonical = await client.query(
        "SELECT value FROM canonical_states WHERE entity_type = $1 AND entity_id = $2 AND field_name = $3",
        [String(receipts.rows[0].entity_type), String(receipts.rows[0].entity_id), String(receipts.rows[0].field_name)]
      );
      assert.equal(canonical.rows.length, 1);
      assert.deepEqual(canonical.rows[0].value, winner.afterValue);
    });
  });

  it("runs twenty absent-key two-proposal CAS stress iterations", async () => {
    for (let run = 0; run < 20; run += 1) {
      await withMigratedDatabase(async (client, pool) => {
        const left = await approveProposalBody(
          pool,
          "directory.propose_claim",
          { ...claim, value: { text: `left-${run}` } },
          `pg-absent-stress-a-${run}`
        );
        const right = await approveProposalBody(
          pool,
          "directory.propose_claim",
          { ...claim, value: { text: `right-${run}` } },
          `pg-absent-stress-b-${run}`,
          "worker-b",
          "editor-2"
        );
        const publication = new PostgresPublicationStore(pool);
        const publisher = createDirectoryMcpServer({
          capabilities: ["publish"],
          context: { reader: null, repo: left.repo, publication, principalId: "publisher-1" },
        });
        const payloads = (
          await Promise.all([
            publisher.invoke(
              "directory.publish_revision",
              publishArgs(left.proposal.id, left.revision.id, left.proposal.bodyDigest, `pg-absent-stress-a-${run}`)
            ),
            publisher.invoke(
              "directory.publish_revision",
              publishArgs(right.proposal.id, right.revision.id, right.proposal.bodyDigest, `pg-absent-stress-b-${run}`)
            ),
          ])
        ).map(payloadOf);
        assert.equal(payloads.filter((row) => row.outcome === OUTCOME.created).length, 1, `run ${run}`);
        assert.equal(
          payloads.filter((row) => row.outcome === OUTCOME.rejected && row.code === "canonical_state_conflict").length,
          1,
          `run ${run}`
        );
        const receipts = await client.query("SELECT before_value, after_value FROM publication_receipts");
        assert.equal(receipts.rows.length, 1, `run ${run}`);
        assert.equal(receipts.rows[0].before_value, null, `run ${run}`);
        const winner = payloads.find((row) => row.outcome === OUTCOME.created)!.receipt as { afterValue: unknown };
        assert.deepEqual(receipts.rows[0].after_value, winner.afterValue, `run ${run}`);
      });
    }
  });

  it("does not leak redacted receipt values on public updates, timelines, country/provider, MCP, or props", async () => {
    const secret = "redacted-secret-value-NEVER-PUBLIC";
    await withMigratedDatabase(async (client, pool) => {
      const ready = await approveProposalBody(
        pool,
        "directory.propose_claim",
        {
          ...claim,
          claimType: "token",
          value: { token: secret },
          observedAt: "2026-09-01T00:00:00.000Z",
        },
        "pg-redact"
      );
      const publication = new PostgresPublicationStore(pool);
      const publisher = createDirectoryMcpServer({
        capabilities: ["publish"],
        context: { reader: null, repo: ready.repo, publication, principalId: "publisher-1" },
      });
      const published = payloadOf(
        await publisher.invoke(
          "directory.publish_revision",
          publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, "pg-redact")
        )
      );
      assert.equal(published.outcome, OUTCOME.created);
      const receipt = published.receipt as { id: string; afterValue: unknown; dataRevision: string };
      const event = published.event as { id: string; valueSensitivity?: string };
      assert.equal(event.valueSensitivity, "redacted");
      const verifier = createDirectoryMcpServer({
        capabilities: ["verify"],
        context: { reader: null, repo: ready.repo, publication, principalId: "verifier-1" },
      });
      const verified = payloadOf(
        await verifier.invoke("directory.verify_publication", {
          receiptId: receipt.id,
          eventId: event.id,
          expectedValueDigest: bodyDigestFromValue(receipt.afterValue),
          expectedDataRevision: receipt.dataRevision,
        })
      );
      assert.equal(verified.outcome, OUTCOME.created);

      const events = await client.query(
        `SELECT id, receipt_id, revision_id, proposal_id, change_type, entity_type, entity_id, field_name,
                old_value, new_value, value_sensitivity, source_id, evidence_snapshot_ids,
                detected_at::text AS detected_at, observed_at::text AS observed_at,
                reviewed_at::text AS reviewed_at, published_at::text AS published_at,
                correction_of_event_id, title_id, title_en, summary_id, summary_en, provider_id, href
         FROM change_events`
      );
      const updates = selectPublicUpdates(
        events.rows.map((row) =>
          toPublicUpdate({
            id: String(row.id),
            receiptId: String(row.receipt_id),
            revisionId: String(row.revision_id),
            proposalId: String(row.proposal_id),
            changeType: row.change_type as "create",
            entityType: String(row.entity_type),
            entityId: String(row.entity_id),
            fieldName: String(row.field_name),
            oldValue: row.old_value,
            newValue: row.new_value,
            valueSensitivity: row.value_sensitivity as "redacted",
            sourceId: row.source_id ? String(row.source_id) : null,
            evidenceSnapshotIds: Array.isArray(row.evidence_snapshot_ids)
              ? row.evidence_snapshot_ids.filter((item: unknown): item is string => typeof item === "string")
              : [],
            detectedAt: row.detected_at ? String(row.detected_at) : null,
            observedAt: row.observed_at ? String(row.observed_at) : null,
            reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
            publishedAt: new Date(String(row.published_at)).toISOString(),
            correctionOfEventId: row.correction_of_event_id ? String(row.correction_of_event_id) : null,
            titleId: String(row.title_id),
            titleEn: String(row.title_en),
            summaryId: row.summary_id ? String(row.summary_id) : null,
            summaryEn: row.summary_en ? String(row.summary_en) : null,
            providerId: row.provider_id ? String(row.provider_id) : null,
            href: row.href ? String(row.href) : null,
          })
        ).map((_, i) => ({
          id: String(events.rows[i].id),
          receiptId: String(events.rows[i].receipt_id),
          revisionId: String(events.rows[i].revision_id),
          proposalId: String(events.rows[i].proposal_id),
          changeType: events.rows[i].change_type as "create",
          entityType: String(events.rows[i].entity_type),
          entityId: String(events.rows[i].entity_id),
          fieldName: String(events.rows[i].field_name),
          oldValue: events.rows[i].old_value,
          newValue: events.rows[i].new_value,
          valueSensitivity: events.rows[i].value_sensitivity as "redacted",
          sourceId: events.rows[i].source_id ? String(events.rows[i].source_id) : null,
          evidenceSnapshotIds: [],
          detectedAt: events.rows[i].detected_at ? String(events.rows[i].detected_at) : null,
          observedAt: events.rows[i].observed_at ? String(events.rows[i].observed_at) : null,
          reviewedAt: events.rows[i].reviewed_at ? String(events.rows[i].reviewed_at) : null,
          publishedAt: new Date(String(events.rows[i].published_at)).toISOString(),
          correctionOfEventId: null,
          titleId: String(events.rows[i].title_id),
          titleEn: String(events.rows[i].title_en),
          summaryId: events.rows[i].summary_id ? String(events.rows[i].summary_id) : null,
          summaryEn: events.rows[i].summary_en ? String(events.rows[i].summary_en) : null,
          providerId: events.rows[i].provider_id ? String(events.rows[i].provider_id) : null,
          href: events.rows[i].href ? String(events.rows[i].href) : null,
        })),
        []
      );
      assert.equal(updates[0]?.value_sensitivity, "redacted");
      assert.equal(updates[0]?.new_value, null);

      const reader = new PostgresDirectoryReader(pool);
      const facts = factsFromLedgerRows(
        (
          await client.query(
            `SELECT r.id AS receipt_id, r.revision_id, r.change_type, r.entity_type, r.entity_id, r.field_name,
                    r.before_value, r.after_value, r.verification_state, r.methodology_version, r.data_revision,
                    r.published_at::text AS published_at, r.supersedes_receipt_id,
                    e.observed_at::text AS observed_at, e.provider_id, e.value_sensitivity
             FROM publication_receipts r JOIN change_events e ON e.receipt_id = r.id`
          )
        ).rows.map((row) => ({
          receiptId: String(row.receipt_id),
          revisionId: String(row.revision_id),
          changeType: String(row.change_type),
          entityType: String(row.entity_type),
          entityId: String(row.entity_id),
          fieldName: String(row.field_name),
          providerId: row.provider_id ? String(row.provider_id) : null,
          observedAt: row.observed_at ? String(row.observed_at) : null,
          publishedAt: String(row.published_at),
          verificationState: String(row.verification_state),
          afterValue: row.after_value,
          beforeValue: row.before_value,
          methodologyVersion: row.methodology_version ? String(row.methodology_version) : null,
          dataRevision: row.data_revision ? String(row.data_revision) : null,
          supersedesReceiptId: row.supersedes_receipt_id ? String(row.supersedes_receipt_id) : null,
          valueSensitivity: row.value_sensitivity ? String(row.value_sensitivity) : null,
        }))
      );
      const window = windowFromInferred(inferObservationWindow(facts));
      const providerDoc = projectPublicTimelineDocument(
        buildProviderTimeline({ facts, window, providerId: "local-packages" })
      );
      const countryDoc = projectPublicTimelineDocument(buildCountryTimeline({ facts, window, countryCode: "ID" }));
      const trends = publicTrendView(buildTrendReport({ facts, window, providerId: "local-packages" }));
      const mcpTimeline = await reader.getTimeline({ providerId: "local-packages" });
      const mcpCountry = await reader.getTimeline({ country: "ID" });
      const claims = await reader.getClaims("provider", "local-packages");
      const props = { provider: providerDoc, country: countryDoc, updates, trends, claims };
      const surfaces = [updates, toApiUpdate(updates[0]!), providerDoc, countryDoc, trends, mcpTimeline, mcpCountry, claims, props];
      for (const surface of surfaces) {
        assert.equal(JSON.stringify(surface).includes(secret), false, "redacted value leaked");
      }
      assert.equal(providerDoc.events[0]?.valueSensitivity, "redacted");
      assert.equal(providerDoc.events[0]?.afterValue, null);
    });
  });

  it("publishes, verifies, and reads every propose tool without colliding entity keys", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const publication = new PostgresPublicationStore(pool);
      const cases: Array<{
        tool: string;
        body: Record<string, unknown>;
        key: string;
        entityType: string;
        fieldName: string;
      }> = [
        {
          tool: "directory.propose_claim",
          body: { ...claim, value: { text: "KVM" } },
          key: "e2e-claim",
          entityType: "provider",
          fieldName: "hypervisor",
        },
        {
          tool: "directory.propose_offering",
          body: { providerId: "local-packages", serviceId: "svc-compute", name: "Small ID" },
          key: "e2e-off-a",
          entityType: "offering",
          fieldName: "offering",
        },
        {
          tool: "directory.propose_offering",
          body: { providerId: "local-packages", serviceId: "svc-compute", name: "Medium ID" },
          key: "e2e-off-b",
          entityType: "offering",
          fieldName: "offering",
        },
        {
          tool: "directory.propose_price_observation",
          body: { offeringId: "off-a1", amount: 11, currency: "USD", billingUnit: "month" },
          key: "e2e-price",
          entityType: "price",
          fieldName: "price",
        },
        {
          tool: "directory.propose_location",
          body: { city: "Jakarta", country: "ID" },
          key: "e2e-loc",
          entityType: "location",
          fieldName: "location",
        },
        {
          tool: "directory.propose_facility",
          body: { name: "Jakarta Hall", locationId: "loc-1", operator: "op-nusantara" },
          key: "e2e-fac",
          entityType: "facility",
          fieldName: "facility",
        },
        {
          tool: "directory.propose_technology_deployment",
          body: { technologyId: "tech-kvm", scope: "offering", scopeId: "off-a1" },
          key: "e2e-tech",
          entityType: "technology",
          fieldName: "technology",
        },
        {
          tool: "directory.propose_retraction",
          body: { claimId: "provider:local-packages:hypervisor", reason: "replaced" },
          key: "e2e-retract",
          entityType: "provider",
          fieldName: "hypervisor",
        },
      ];
      const receipts: Array<{ entityType: string; entityId: string; fieldName: string; changeType: string }> = [];
      for (const row of cases) {
        const ready = await approveProposalBody(pool, row.tool, row.body, row.key);
        const publisher = createDirectoryMcpServer({
          capabilities: ["publish"],
          context: { reader: null, repo: ready.repo, publication, principalId: "publisher-1" },
        });
        const published = payloadOf(
          await publisher.invoke(
            "directory.publish_revision",
            publishArgs(ready.proposal.id, ready.revision.id, ready.proposal.bodyDigest, row.key)
          )
        );
        assert.equal(published.outcome, OUTCOME.created, row.key);
        const receipt = published.receipt as {
          id: string;
          afterValue: unknown;
          dataRevision: string;
          entityType: string;
          entityId: string;
          fieldName: string;
          changeType: string;
        };
        const event = published.event as { id: string };
        assert.equal(receipt.entityType, row.entityType, row.key);
        assert.equal(receipt.fieldName, row.fieldName, row.key);
        if (row.tool === "directory.propose_offering") {
          assert.notEqual(receipt.entityId, "local-packages");
        }
        if (row.tool === "directory.propose_facility" || row.tool === "directory.propose_location") {
          assert.notEqual(receipt.entityType, "provider");
        }
        if (row.tool === "directory.propose_technology_deployment") {
          assert.equal(receipt.entityType, "technology");
        }
        if (row.tool === "directory.propose_retraction") {
          assert.equal(receipt.changeType, "retract");
        }
        const verifier = createDirectoryMcpServer({
          capabilities: ["verify"],
          context: { reader: null, repo: ready.repo, publication, principalId: "verifier-1" },
        });
        const verified = payloadOf(
          await verifier.invoke("directory.verify_publication", {
            receiptId: receipt.id,
            eventId: event.id,
            expectedValueDigest: bodyDigestFromValue(receipt.afterValue),
            expectedDataRevision: receipt.dataRevision,
          })
        );
        assert.equal(verified.outcome, OUTCOME.created, `verify ${row.key}`);
        receipts.push(receipt);
      }
      const offeringIds = receipts.filter((row) => row.entityType === "offering").map((row) => row.entityId);
      assert.equal(offeringIds.length, 2);
      assert.notEqual(offeringIds[0], offeringIds[1]);

      const reader = new PostgresDirectoryReader(pool);
      const offerings = await reader.getOfferings("local-packages");
      const claims = await reader.getClaims("provider", "local-packages");
      const timeline = await reader.getTimeline({ providerId: "local-packages" });
      assert.equal(offerings.filter((row) => row.entityType === "offering" || row.name).length >= 2, true);
      assert.equal(claims.some((row) => row.fieldName === "hypervisor" || row.claim_type === "hypervisor"), true);
      const model = projectVerifiedPublicReadModel(
        factsFromLedgerRows(
          (
            await client.query(
              `SELECT r.id AS receipt_id, r.revision_id, r.change_type, r.entity_type, r.entity_id, r.field_name,
                      r.before_value, r.after_value, r.verification_state, r.methodology_version, r.data_revision,
                      r.published_at::text AS published_at, r.supersedes_receipt_id,
                      e.observed_at::text AS observed_at, e.provider_id, e.value_sensitivity
               FROM publication_receipts r JOIN change_events e ON e.receipt_id = r.id`
            )
          ).rows.map((row) => ({
            receiptId: String(row.receipt_id),
            revisionId: String(row.revision_id),
            changeType: String(row.change_type),
            entityType: String(row.entity_type),
            entityId: String(row.entity_id),
            fieldName: String(row.field_name),
            providerId: row.provider_id ? String(row.provider_id) : null,
            observedAt: row.observed_at ? String(row.observed_at) : null,
            publishedAt: String(row.published_at),
            verificationState: String(row.verification_state),
            afterValue: row.after_value,
            beforeValue: row.before_value,
            methodologyVersion: row.methodology_version ? String(row.methodology_version) : null,
            dataRevision: row.data_revision ? String(row.data_revision) : null,
            supersedesReceiptId: row.supersedes_receipt_id ? String(row.supersedes_receipt_id) : null,
            valueSensitivity: row.value_sensitivity ? String(row.value_sensitivity) : null,
          }))
        )
      );
      assert.equal(model.offerings.length, 2);
      assert.equal(model.prices.length, 1);
      assert.equal(model.locations.length, 1);
      assert.equal(model.facilities.length, 1);
      assert.equal(model.technologies.length, 1);
      assert.equal(model.claims.some((row) => row.changeType === "retract"), true);
      assert.equal("events" in timeline, true);
    });
  });
});

void (0 as unknown as QueryExecutor);
