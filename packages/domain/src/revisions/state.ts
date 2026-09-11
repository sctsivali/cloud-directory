import { isKnowledgeState, isAssessmentState } from "../knowledge-state.ts";
import type { CanonicalState, PreparedPublication, PublicationReceipt, TypedLedgerState } from "./types.ts";

/** Only validated top-level state fields are authoritative; payload metadata is not. */
export function ledgerState(body: Record<string, unknown>): Required<TypedLedgerState> {
  return {
    knowledgeState: typeof body.knowledgeState === "string" && isKnowledgeState(body.knowledgeState) ? body.knowledgeState : "unknown",
    assessmentState: typeof body.assessmentState === "string" && isAssessmentState(body.assessmentState) ? body.assessmentState : "legacy/unverified",
  };
}

/** Called only after canonical locking and CAS validation by publication stores. */
export function effectiveChangeType(current: Pick<CanonicalState, "knowledgeState" | "value"> | null, plan: Pick<PreparedPublication, "changeType" | "knowledgeState" | "afterValue">): PublicationReceipt["changeType"] {
  if (plan.changeType === "rollback" || plan.changeType === "correction") return plan.changeType;
  if (plan.changeType === "retract" || (current?.knowledgeState === "present" && plan.knowledgeState === "confirmed_absent")) return "retract";
  if (plan.knowledgeState === "present" && (!current || current.knowledgeState == null || current.knowledgeState === "unknown" || current.knowledgeState === "confirmed_absent")) return "create";
  return "update";
}
