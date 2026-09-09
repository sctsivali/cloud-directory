export const PUBLICATION_ERROR = {
  malformedPayload: "malformed_payload",
  notFound: "not_found",
  selfPublishForbidden: "self_publish_forbidden",
  staleApproval: "stale_approval",
  approvalInvalid: "approval_invalid",
  revisionMismatch: "revision_mismatch",
  casConflict: "canonical_state_conflict",
  idempotencyConflict: "idempotency_conflict",
  alreadyPublished: "already_published",
  commitUncertain: "commit_uncertain",
  subjectMismatch: "subject_mismatch",
  staleRollback: "stale_rollback",
  supersessionInvalid: "supersession_invalid",
  verificationMismatch: "verification_mismatch",
  selfVerifyForbidden: "self_verify_forbidden",
  attemptIdentityConflict: "attempt_identity_conflict",
} as const;

export type PublicationErrorCode = (typeof PUBLICATION_ERROR)[keyof typeof PUBLICATION_ERROR];

export type ProposalSnapshot = {
  id: string;
  toolName: string;
  actorId: string;
  idempotencyKey: string;
  body: Record<string, unknown>;
  bodyDigest: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type RevisionSnapshot = {
  id: string;
  proposalId: string;
  revisionOrdinal: number;
  body: Record<string, unknown>;
  bodyDigest: string;
  actorId: string;
  createdAt: string;
};

export type ReviewSnapshot = {
  id: string;
  proposalId: string;
  reviewerId: string;
  decision: string;
  comment: string | null;
  createdAt: string;
  invalidatedAt: string | null;
  boundRevisionId: string | null;
  boundBodyDigest: string | null;
};

export type CanonicalState = {
  entityType: string;
  entityId: string;
  fieldName: string;
  value: unknown;
  valueDigest: string;
  dataRevision: string;
  updatedAt: string;
};

export type PublicationAttempt = {
  id: string;
  idempotencyKey: string;
  requestDigest: string;
  proposalId: string;
  revisionId: string;
  publisherId: string;
  state: "pending" | "committed" | "uncertain" | "reconciled_committed" | "reconciled_absent";
  createdAt: string;
  updatedAt: string;
};

export type PublicationReceipt = {
  id: string;
  attemptId: string;
  proposalId: string;
  revisionId: string;
  revisionOrdinal: number;
  bodyDigest: string;
  approvalId: string;
  approvalDigest: string;
  reviewerId: string;
  publisherId: string;
  methodologyVersion: string;
  dataRevision: string;
  idempotencyKey: string;
  evidenceSnapshotIds: string[];
  beforeValue: unknown;
  afterValue: unknown;
  entityType: string;
  entityId: string;
  fieldName: string;
  changeType: "create" | "update" | "retract" | "rollback" | "correction";
  verificationState: "pending" | "verified" | "failed" | "uncertain" | "rolled_back";
  publishedAt: string;
  supersedesReceiptId: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
};

export type ChangeEvent = {
  id: string;
  receiptId: string;
  revisionId: string;
  proposalId: string;
  changeType: PublicationReceipt["changeType"];
  entityType: string;
  entityId: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  valueSensitivity: "public" | "redacted";
  sourceId: string | null;
  evidenceSnapshotIds: string[];
  detectedAt: string | null;
  observedAt: string | null;
  reviewedAt: string | null;
  publishedAt: string;
  correctionOfEventId: string | null;
  titleId: string;
  titleEn: string;
  summaryId: string | null;
  summaryEn: string | null;
  providerId: string | null;
  href: string | null;
};

export type PublishRequest = {
  proposalId: string;
  expectedRevisionId: string;
  expectedBodyDigest: string;
  idempotencyKey: string;
  methodologyVersion: string;
  dataRevision: string;
  publisherPrincipal: string;
  expectedCanonicalDigest?: string | null;
  rollbackOfReceiptId?: string | null;
};

export type PublicationOutcome =
  | { outcome: "created"; receipt: PublicationReceipt; event: ChangeEvent }
  | { outcome: "replayed"; receipt: PublicationReceipt; event: ChangeEvent }
  | { outcome: "rejected"; code: PublicationErrorCode; message: string; errors?: string[] }
  | { outcome: "ambiguous"; code: "commit_uncertain"; message: string; idempotencyKey: string; attemptId?: string };

export type PreparedPublication = {
  attemptId: string;
  receiptId: string;
  eventId: string;
  requestDigest: string;
  proposal: ProposalSnapshot;
  revision: RevisionSnapshot;
  approval: ReviewSnapshot;
  approvalDigest: string;
  publisherPrincipal: string;
  idempotencyKey: string;
  methodologyVersion: string;
  dataRevision: string;
  evidenceSnapshotIds: string[];
  beforeValue: unknown;
  afterValue: unknown;
  expectedCanonicalDigest: string | null;
  entityType: string;
  entityId: string;
  fieldName: string;
  changeType: PublicationReceipt["changeType"];
  valueSensitivity: "public" | "redacted";
  sourceId: string | null;
  detectedAt: string | null;
  observedAt: string | null;
  reviewedAt: string;
  publishedAt: string;
  titleId: string;
  titleEn: string;
  summaryId: string | null;
  summaryEn: string | null;
  providerId: string | null;
  href: string | null;
  correctionOfEventId: string | null;
  supersedesReceiptId: string | null;
  verificationState: PublicationReceipt["verificationState"];
};

export type PublishWriteResult =
  | { write: "ok"; receipt: PublicationReceipt; event: ChangeEvent }
  | { write: "replayed"; receipt: PublicationReceipt; event: ChangeEvent }
  | { write: "rejected"; code: PublicationErrorCode; message: string }
  | { write: "uncertain" }
  | { write: "cas_conflict" }
  | { write: "self_publish" };

export type VerifyRequest = {
  receiptId: string;
  eventId: string;
  expectedValueDigest: string;
  expectedDataRevision: string;
  verifierPrincipal: string;
};

export type PreparedVerification = {
  receiptId: string;
  eventId: string;
  expectedValueDigest: string;
  expectedDataRevision: string;
  verifierPrincipal: string;
  verifiedAt: string;
};

export type VerifyWriteResult =
  | { write: "ok"; receipt: PublicationReceipt }
  | { write: "replayed"; receipt: PublicationReceipt }
  | { write: "mismatch"; receipt: PublicationReceipt; state: "failed" | "uncertain" }
  | { write: "rejected"; code: PublicationErrorCode; message: string }
  | { write: "self_verify" }
  | { write: "uncertain" };

export type VerifyOutcome =
  | { outcome: "created"; receipt: PublicationReceipt }
  | { outcome: "replayed"; receipt: PublicationReceipt }
  | {
      outcome: "rejected";
      code: PublicationErrorCode;
      message: string;
      errors?: string[];
      receipt?: PublicationReceipt;
    }
  | { outcome: "ambiguous"; code: "commit_uncertain"; message: string };

export type PublicationStore = {
  findProposal(id: string): Promise<ProposalSnapshot | null>;
  findRevision(id: string): Promise<RevisionSnapshot | null>;
  listRevisions(proposalId: string): Promise<RevisionSnapshot[]>;
  listReviews(proposalId: string): Promise<ReviewSnapshot[]>;
  findReceiptByIdempotencyKey(key: string): Promise<PublicationReceipt | null>;
  findAttemptByIdempotencyKey(key: string): Promise<PublicationAttempt | null>;
  findReceiptById(id: string): Promise<PublicationReceipt | null>;
  findEventByReceiptId(receiptId: string): Promise<ChangeEvent | null>;
  findReceiptsSuperseding(receiptId: string): Promise<PublicationReceipt[]>;
  getCanonicalState(entityType: string, entityId: string, fieldName: string): Promise<CanonicalState | null>;
  recordUncertainAttempt(attempt: PublicationAttempt): Promise<void>;
  commitPublication(plan: PreparedPublication): Promise<PublishWriteResult>;
  commitVerification(plan: PreparedVerification): Promise<VerifyWriteResult>;
};
