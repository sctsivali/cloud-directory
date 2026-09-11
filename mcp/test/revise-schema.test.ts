import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERROR_CODE, OUTCOME } from "../src/errors.ts";
import { PostgresProposalRepository } from "../src/pg-store.ts";
import { submitProposal } from "../src/proposal-tools.ts";
import { approveProposal, reviseProposal } from "../src/review-tools.ts";
import { MemoryProposalRepository } from "../src/store.ts";
import { claimRevisionBody } from "./claim-body.ts";
import { TEST_DATABASE_URL, withMigratedDatabase } from "./pg-harness.ts";

const claim = {
  idempotencyKey: "revise-schema-1",
  ...claimRevisionBody(),
};

describe("S1 revise_proposal validates replacement body against the original tool", () => {
  it("rejects missing required fields, toolName, nested identity, and invalid precision/scope", async () => {
    const repo = new MemoryProposalRepository();
    const created = await submitProposal(repo, "directory.propose_claim", claim, "worker-a");
    assert.equal(created.outcome, OUTCOME.created);
    if (created.outcome !== "created") return;

    const missing = await reviseProposal(
      repo,
      { proposalId: created.proposal.id, body: { subjectId: "local-packages", claimType: "hypervisor" } },
      "worker-a"
    );
    assert.equal(missing.outcome, OUTCOME.rejected);
    if (missing.outcome === "rejected") assert.equal(missing.code, ERROR_CODE.malformedPayload);

    const withToolName = await reviseProposal(
      repo,
      {
        proposalId: created.proposal.id,
        body: { ...claimRevisionBody(), toolName: "directory.propose_offering" },
      },
      "worker-a"
    );
    assert.equal(withToolName.outcome, OUTCOME.rejected);

    const nestedIdentity = await reviseProposal(
      repo,
      {
        proposalId: created.proposal.id,
        body: claimRevisionBody({ value: { text: "KVM", actorId: "victim-editor" } }),
      },
      "worker-a"
    );
    assert.equal(nestedIdentity.outcome, OUTCOME.rejected);

    const ok = await reviseProposal(
      repo,
      { proposalId: created.proposal.id, body: claimRevisionBody({ value: { text: "KVM-updated" } }) },
      "worker-a"
    );
    assert.equal(ok.outcome, OUTCOME.created);

    const location = await submitProposal(
      repo,
      "directory.propose_location",
      { idempotencyKey: "revise-loc-1", city: "Jakarta", country: "ID", mapPrecision: "city_centroid" },
      "worker-a"
    );
    assert.equal(location.outcome, OUTCOME.created);
    if (location.outcome !== "created") return;
    const exact = await reviseProposal(
      repo,
      {
        proposalId: location.proposal.id,
        body: { city: "Jakarta", country: "ID", mapPrecision: "facility_exact" },
      },
      "worker-a"
    );
    assert.equal(exact.outcome, OUTCOME.rejected);

    const tech = await submitProposal(
      repo,
      "directory.propose_technology_deployment",
      {
        idempotencyKey: "revise-tech-1",
        technologyId: "tech-kvm",
        scope: "offering",
        scopeId: "off-a1",
        hasUniversalScopeEvidence: false,
      },
      "worker-a"
    );
    assert.equal(tech.outcome, OUTCOME.created);
    if (tech.outcome !== "created") return;
    const badScope = await reviseProposal(
      repo,
      {
        proposalId: tech.proposal.id,
        body: { technologyId: "tech-kvm", scope: "universe", scopeId: "off-a1" },
      },
      "worker-a"
    );
    assert.equal(badScope.outcome, OUTCOME.rejected);
  });
});

describe("S1 PostgreSQL revise validation", { skip: !TEST_DATABASE_URL }, () => {
  it("rejects incomplete replacement bodies before writing a revision row", async () => {
    await withMigratedDatabase(async (client, pool) => {
      const repo = new PostgresProposalRepository(pool);
      const created = await submitProposal(
        repo,
        "directory.propose_claim",
        { ...claim, idempotencyKey: "pg-revise-schema" },
        "worker-a"
      );
      assert.equal(created.outcome, OUTCOME.created);
      if (created.outcome !== "created") return;
      const rejected = await reviseProposal(
        repo,
        { proposalId: created.proposal.id, body: { claimType: "storage" } },
        "worker-a"
      );
      assert.equal(rejected.outcome, OUTCOME.rejected);
      const revisions = await client.query("SELECT count(*)::int AS n FROM revisions WHERE proposal_id = $1", [
        created.proposal.id,
      ]);
      assert.equal(revisions.rows[0].n, 1);
    });
  });
});
