import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURRENT_METHODOLOGY } from "../../packages/domain/src/scoring/methodology.ts";
import { bodyDigestFromValue } from "../../packages/domain/src/revisions/digest.ts";
import { selectPublicUpdates, toApiUpdate, toPublicUpdate } from "../../packages/domain/src/revisions/public-feed.ts";
import type { PreparedPublication } from "../../packages/domain/src/revisions/types.ts";
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
  const repo = new PostgresProposalRepository(pool);
  const created = await submitProposal(
    repo,
    "directory.propose_claim",
    { ...claim, idempotencyKey: key },
    actor
  );
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
});

void (0 as unknown as QueryExecutor);
