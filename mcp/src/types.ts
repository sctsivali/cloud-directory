export type ProposalStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "published";

export type ProposalRecord = {
  id: string;
  toolName: string;
  actorId: string;
  idempotencyKey: string;
  body: Record<string, unknown>;
  bodyDigest: string;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
};

export type RevisionRecord = {
  id: string;
  proposalId: string;
  revisionOrdinal: number;
  body: Record<string, unknown>;
  bodyDigest: string;
  actorId: string;
  createdAt: string;
};

export type ReviewDecision = "approve" | "reject" | "request_changes";

export type ReviewRecord = {
  id: string;
  proposalId: string;
  reviewerId: string;
  decision: ReviewDecision;
  comment: string | null;
  createdAt: string;
  invalidatedAt: string | null;
  boundRevisionId?: string | null;
  boundBodyDigest?: string | null;
};

export type RejectedOutcome = {
  outcome: "rejected";
  code: string;
  message: string;
  errors?: string[];
};

export type AmbiguousOutcome = {
  outcome: "ambiguous";
  code: "commit_uncertain";
  message: string;
  idempotencyKey: string;
};

export type ProposalSubmitResult =
  | { outcome: "created"; proposal: ProposalRecord }
  | { outcome: "replayed"; proposal: ProposalRecord }
  | RejectedOutcome
  | AmbiguousOutcome;

export type MutationResult =
  | { outcome: "created"; proposal: ProposalRecord; review?: ReviewRecord }
  | RejectedOutcome
  | AmbiguousOutcome;
