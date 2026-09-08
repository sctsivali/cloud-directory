import { validateToolInput } from "../../packages/contracts/src/mcp.ts";
import { ERROR_CODE, OUTCOME } from "./errors.ts";
import { submitProposal } from "./proposal-tools.ts";
import { approveProposal, reviewProposal, reviseProposal } from "./review-tools.ts";
import type { DirectoryReader } from "./read-tools.ts";
import type { ProposalRepository } from "./store.ts";

export type ToolContext = {
  reader: DirectoryReader | null;
  repo: ProposalRepository | null;
  principalId: string;
};

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function errorResult(code: string, message: string, extra?: Record<string, unknown>) {
  return jsonResult({ ok: false, code, message, ...extra });
}

async function requireRepo(ctx: ToolContext): Promise<ProposalRepository> {
  if (!ctx.repo) throw new Error("proposal store is not configured");
  return ctx.repo;
}

async function requireReader(ctx: ToolContext): Promise<DirectoryReader> {
  if (!ctx.reader) throw new Error("directory reader is not configured");
  return ctx.reader;
}

export async function executeTool(
  ctx: ToolContext,
  name: string,
  rawInput: unknown
): Promise<{ content: { type: "text"; text: string }[] }> {
  const input = rawInput ?? {};
  switch (name) {
    case "directory.get_provider": {
      const parsed = validateToolInput(name, input);
      if (!parsed.ok) return errorResult(ERROR_CODE.malformedPayload, parsed.errors.join("; "));
      const reader = await requireReader(ctx);
      const provider = await reader.getProvider(String((input as { id: string }).id));
      return jsonResult({ ok: true, provider });
    }
    case "directory.search_providers": {
      const parsed = validateToolInput(name, input);
      if (!parsed.ok) return errorResult(ERROR_CODE.malformedPayload, parsed.errors.join("; "));
      const args = input as { name?: string; country?: string; limit?: number };
      const reader = await requireReader(ctx);
      const providers = await reader.searchProviders(args);
      return jsonResult({ ok: true, providers });
    }
    case "directory.get_offerings": {
      const parsed = validateToolInput(name, input);
      if (!parsed.ok) return errorResult(ERROR_CODE.malformedPayload, parsed.errors.join("; "));
      const reader = await requireReader(ctx);
      const offerings = await reader.getOfferings(String((input as { providerId: string }).providerId));
      return jsonResult({ ok: true, offerings });
    }
    case "directory.get_claims": {
      const parsed = validateToolInput(name, input);
      if (!parsed.ok) return errorResult(ERROR_CODE.malformedPayload, parsed.errors.join("; "));
      const args = input as { subjectType: string; subjectId: string };
      const reader = await requireReader(ctx);
      const claims = await reader.getClaims(args.subjectType, args.subjectId);
      return jsonResult({ ok: true, claims });
    }
    case "directory.get_evidence": {
      const parsed = validateToolInput(name, input);
      if (!parsed.ok) return errorResult(ERROR_CODE.malformedPayload, parsed.errors.join("; "));
      const reader = await requireReader(ctx);
      const evidence = await reader.getEvidence(input as { claimId?: string; snapshotId?: string; evidenceId?: string });
      return jsonResult({ ok: true, evidence });
    }
    case "directory.get_source_snapshot": {
      const parsed = validateToolInput(name, input);
      if (!parsed.ok) return errorResult(ERROR_CODE.malformedPayload, parsed.errors.join("; "));
      const reader = await requireReader(ctx);
      const snapshot = await reader.getSourceSnapshot(String((input as { id: string }).id));
      return jsonResult({ ok: true, snapshot });
    }
    case "directory.explain_score": {
      const parsed = validateToolInput(name, input);
      if (!parsed.ok) return errorResult(ERROR_CODE.malformedPayload, parsed.errors.join("; "));
      const reader = await requireReader(ctx);
      const explanation = await reader.explainScore(String((input as { providerId: string }).providerId));
      return jsonResult({ ok: true, explanation });
    }
    case "directory.get_quality_report": {
      const parsed = validateToolInput(name, input);
      if (!parsed.ok) return errorResult(ERROR_CODE.malformedPayload, parsed.errors.join("; "));
      const reader = await requireReader(ctx);
      const report = await reader.getQualityReport((input as { providerId?: string }).providerId);
      return jsonResult({ ok: true, report });
    }
    case "directory.get_proposal": {
      const parsed = validateToolInput(name, input);
      if (!parsed.ok) return errorResult(ERROR_CODE.malformedPayload, parsed.errors.join("; "));
      const repo = await requireRepo(ctx);
      const args = input as { proposalId?: string; idempotencyKey?: string };
      const proposal = args.proposalId
        ? await repo.findById(args.proposalId)
        : args.idempotencyKey
          ? await repo.findByIdempotencyKey(args.idempotencyKey)
          : null;
      return jsonResult({ ok: true, proposal });
    }
    case "directory.propose_claim":
    case "directory.propose_offering":
    case "directory.propose_price_observation":
    case "directory.propose_location":
    case "directory.propose_facility":
    case "directory.propose_technology_deployment":
    case "directory.propose_retraction": {
      const repo = await requireRepo(ctx);
      const result = await submitProposal(repo, name, input, ctx.principalId);
      return jsonResult(result);
    }
    case "directory.revise_proposal": {
      const repo = await requireRepo(ctx);
      return jsonResult(await reviseProposal(repo, input, ctx.principalId));
    }
    case "directory.review_proposal": {
      const repo = await requireRepo(ctx);
      return jsonResult(await reviewProposal(repo, input, ctx.principalId));
    }
    case "directory.approve_proposal": {
      const repo = await requireRepo(ctx);
      return jsonResult(await approveProposal(repo, input, ctx.principalId));
    }
    default:
      return errorResult(ERROR_CODE.toolUnavailable, `tool unavailable: ${name}`, {
        outcome: OUTCOME.rejected,
      });
  }
}
