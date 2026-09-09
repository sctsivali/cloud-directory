import {
  CURRENT_METHODOLOGY,
  explainForSurface,
  scoreWithFallback,
  toPublicScoreView,
  type OfferingDeploymentSubject,
} from "../../packages/domain/src/scoring/index.ts";
import {
  TREND_METRICS,
  MAX_TREND_FACTS,
  buildCountryTimeline,
  buildOutlook,
  buildProviderTimeline,
  buildTrendReport,
  canonicalizeCountryCode,
  factsFromLedgerRows,
  guardTrendQuery,
  inferObservationWindow,
  ledgerFactRowFromJoin,
  publicOutlookEligibilityView,
  publicTrendView,
  resolveCountry,
  windowFromInferred,
  type TrendMetric,
  type VerifiedFact,
} from "../../packages/domain/src/intelligence/index.ts";
import { projectPublicTimelineDocument, projectVerifiedPublicReadModel } from "../../packages/domain/src/revisions/public-projection.ts";
import { Client } from "./pg.ts";
import { loadDataRevision, DataRevisionError } from '../../packages/domain/src/intelligence/data-revisions.ts';

export type JsonObject = Record<string, unknown>;

export type DirectoryReader = {
  getProvider(id: string): Promise<JsonObject | null>;
  searchProviders(args: { name?: string; country?: string; limit?: number }): Promise<JsonObject[]>;
  getOfferings(providerId: string): Promise<JsonObject[]>;
  getClaims(subjectType: string, subjectId: string): Promise<JsonObject[]>;
  getEvidence(args: { claimId?: string; snapshotId?: string; evidenceId?: string }): Promise<JsonObject[]>;
  getSourceSnapshot(id: string): Promise<JsonObject | null>;
  explainScore(
    providerId: string,
    args?: { offeringId?: string; deploymentId?: string }
  ): Promise<JsonObject | null>;
  getQualityReport(providerId?: string): Promise<JsonObject>;
  getTrends(args: IntelligenceReadArgs): Promise<JsonObject>;
  getTimeline(args: IntelligenceReadArgs): Promise<JsonObject>;
  getOutlookEligibility(args: IntelligenceReadArgs): Promise<JsonObject>;
};

export type IntelligenceReadArgs = {
  metric?: string;
  country?: string;
  providerId?: string;
  dataRevision?: string;
  windowStart?: string;
  windowEnd?: string;
  limit?: number;
  page?: number;
};

const LEGACY_METHODOLOGY = {
  engine: "legacy-fallback",
  methodologyVersion: "2026.08.18",
  note: "Legacy fallback: canonical offering/deployment data unavailable.",
  dimensions: [
    { code: "SOV", name: "Control & residency" },
    { code: "CONF", name: "Evidence quality" },
    { code: "OSS", name: "Open technology" },
  ],
};

export type Queryable = {
  query: InstanceType<typeof Client>["query"];
};

export class PostgresDirectoryReader implements DirectoryReader {
  private readonly client: Queryable;

  constructor(client: Queryable) {
    this.client = client;
  }

  async getProvider(id: string): Promise<JsonObject | null> {
    const { rows } = await this.client.query(
      `SELECT id, name, hq_country, legal_country, origin, is_local_asean, website
       FROM providers WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async searchProviders(args: {
    name?: string;
    country?: string;
    limit?: number;
  }): Promise<JsonObject[]> {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const { rows } = await this.client.query(
      `SELECT id, name, hq_country, legal_country, origin, is_local_asean
       FROM providers
       WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR hq_country = $2 OR legal_country = $2)
       ORDER BY name
       LIMIT $3`,
      [args.name ?? null, args.country ?? null, limit]
    );
    return rows;
  }

  async getOfferings(providerId: string): Promise<JsonObject[]> {
    const { rows } = await this.client.query(
      `SELECT id, provider_id, service_id, name, status, assessment_state
       FROM offerings WHERE provider_id = $1 ORDER BY name`,
      [providerId]
    );
    const fromLedger = projectVerifiedPublicReadModel(await this.loadLedgerFacts()).offerings.filter(
      (row) => row.providerId === providerId
    );
    const projected = fromLedger.map((row) => {
      const value = row.value && typeof row.value === "object" ? (row.value as Record<string, unknown>) : {};
      return {
        id: row.entityId,
        provider_id: row.providerId,
        service_id: value.serviceId ?? null,
        name: value.name ?? row.entityId,
        status: value.status ?? null,
        entityType: row.entityType,
        fieldName: row.fieldName,
        verification_state: row.verificationState,
      };
    });
    const seen = new Set(projected.map((row) => String(row.id)));
    return [...projected, ...rows.filter((row) => !seen.has(String((row as { id?: unknown }).id)))];
  }

  async getClaims(subjectType: string, subjectId: string): Promise<JsonObject[]> {
    const { rows } = await this.client.query(
      `SELECT id, subject_type, subject_id, claim_type, value, knowledge_state, assessment_state,
              observed_at, recorded_at, valid_from, valid_to
       FROM claims WHERE subject_type = $1 AND subject_id = $2
       ORDER BY recorded_at`,
      [subjectType, subjectId]
    );
    const fromLedger = projectVerifiedPublicReadModel(await this.loadLedgerFacts()).claims.filter(
      (row) => row.entityType === subjectType && row.entityId === subjectId
    );
    const projected = fromLedger.map((row) => ({
      id: `${row.entityType}:${row.entityId}:${row.fieldName}`,
      subject_type: row.entityType,
      subject_id: row.entityId,
      claim_type: row.fieldName,
      fieldName: row.fieldName,
      value: row.value,
      knowledge_state: row.knowledgeState,
      verification_state: row.verificationState,
      change_type: row.changeType,
      value_sensitivity: row.valueSensitivity,
    }));
    const seen = new Set(projected.map((row) => `${row.subject_type}:${row.subject_id}:${row.claim_type}`));
    return [
      ...projected,
      ...rows.filter((row) => !seen.has(`${String((row as { subject_type?: unknown }).subject_type)}:${String((row as { subject_id?: unknown }).subject_id)}:${String((row as { claim_type?: unknown }).claim_type)}`)),
    ];
  }

  async getEvidence(args: {
    claimId?: string;
    snapshotId?: string;
    evidenceId?: string;
  }): Promise<JsonObject[]> {
    const { rows } = await this.client.query(
      `SELECT e.id, e.snapshot_id, e.excerpt, e.note, e.observed_at, e.assessment_state
       FROM evidence e
       LEFT JOIN claim_evidence ce ON ce.evidence_id = e.id
       WHERE ($1::text IS NULL OR ce.claim_id = $1)
         AND ($2::text IS NULL OR e.snapshot_id = $2)
         AND ($3::text IS NULL OR e.id = $3)
       GROUP BY e.id
       ORDER BY e.id`,
      [args.claimId ?? null, args.snapshotId ?? null, args.evidenceId ?? null]
    );
    return rows;
  }

  async getSourceSnapshot(id: string): Promise<JsonObject | null> {
    const { rows } = await this.client.query(
      `SELECT id, source_url, final_url, fetched_at, http_status, content_type,
              content_sha256, body, byte_length, recorded_at
       FROM fetch_snapshots WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async explainScore(
    providerId: string,
    args?: { offeringId?: string; deploymentId?: string }
  ): Promise<JsonObject | null> {
    const provider = await this.getProvider(providerId);
    if (!provider) return null;
    const subjects = await this.loadCanonicalSubjects(providerId);
    const filtered = subjects.filter((subject) => {
      if (args?.offeringId && subject.offeringId !== args.offeringId) return false;
      if (args?.deploymentId && subject.deploymentId !== args.deploymentId) return false;
      return true;
    });
    if (filtered.length === 0) {
      const fallback = scoreWithFallback({
        canonical: null,
        legacyProvider: {
          id: providerId,
          name: String(provider.name ?? providerId),
          sov: 0,
          oss: 0,
          conf: 0,
        },
        methodology: CURRENT_METHODOLOGY,
        dataRevision: "legacy-public-tables",
      });
      return {
        ...toPublicScoreView(fallback),
        providerId,
        providerName: provider.name,
        legacy: LEGACY_METHODOLOGY,
        surface: "mcp",
      };
    }
    const scored = filtered.map((subject) =>
      explainForSurface("mcp", {
        subject,
        methodology: CURRENT_METHODOLOGY,
        dataRevision: "canonical-claims",
      })
    );
    return {
      ...toPublicScoreView(scored[0]!),
      providerId,
      providerName: provider.name,
      subjects: scored.map(toPublicScoreView),
      surface: "mcp",
    };
  }

  private async loadCanonicalSubjects(providerId: string): Promise<OfferingDeploymentSubject[]> {
    const offerings = await this.getOfferings(providerId);
    if (offerings.length === 0) return [];
    let deployments: { id: string; offering_id: string | null }[] = [];
    try {
      const { rows } = await this.client.query(
        `SELECT id, offering_id FROM deployments WHERE provider_id = $1`,
        [providerId]
      );
      deployments = rows as { id: string; offering_id: string | null }[];
    } catch {
      return [];
    }
    const pairs: OfferingDeploymentSubject[] = [];
    for (const offering of offerings) {
      const offeringId = String(offering.id);
      const matched = deployments.filter((d) => d.offering_id === offeringId);
      const deploymentIds = matched.length ? matched.map((d) => d.id) : [];
      if (deploymentIds.length === 0) continue;
      const claims = await this.getClaims("offering", offeringId);
      for (const deploymentId of deploymentIds) {
        const depClaims = await this.getClaims("deployment", deploymentId);
        const allClaims = [...claims, ...depClaims] as Array<{
          claim_type: string;
          knowledge_state: string;
          value: unknown;
        }>;
        pairs.push(subjectFromClaims(providerId, offeringId, deploymentId, String(offering.name ?? offeringId), allClaims));
      }
    }
    return pairs;
  }

  async getQualityReport(providerId?: string): Promise<JsonObject> {
    const claimFilter = providerId
      ? "WHERE subject_type = 'provider' AND subject_id = $1"
      : "";
    const params = providerId ? [providerId] : [];
    const claims = await this.client.query(
      `SELECT knowledge_state, assessment_state, count(*)::int AS n
       FROM claims ${claimFilter}
       GROUP BY knowledge_state, assessment_state`,
      params
    );
    const evidence = await this.client.query(`SELECT count(*)::int AS n FROM evidence`);
    const snapshots = await this.client.query(`SELECT count(*)::int AS n FROM fetch_snapshots`);
    const byKnowledgeState: Record<string, number> = {};
    const byAssessmentState: Record<string, number> = {};
    let claimCount = 0;
    for (const row of claims.rows as { knowledge_state: string; assessment_state: string; n: number }[]) {
      claimCount += row.n;
      byKnowledgeState[row.knowledge_state] = (byKnowledgeState[row.knowledge_state] ?? 0) + row.n;
      byAssessmentState[row.assessment_state] = (byAssessmentState[row.assessment_state] ?? 0) + row.n;
    }
    return {
      claimCount,
      evidenceCount: evidence.rows[0]?.n ?? 0,
      snapshotCount: snapshots.rows[0]?.n ?? 0,
      byKnowledgeState,
      byAssessmentState,
      providerId: providerId ?? null,
    };
  }

  async getTrends(args: IntelligenceReadArgs): Promise<JsonObject> {
    const built = await this.buildIntelligence(args);
    if ("error" in built) return built;
    const report = buildTrendReport(built.query);
    const view = publicTrendView(report);
    if (args.metric && isTrendMetric(args.metric)) {
      return {
        ok: true,
        metric: args.metric,
        series: view.series[args.metric],
        diagnostics: view.diagnostics[args.metric],
        eligibility: view.eligibility[args.metric],
        methodologyId: view.methodologyId,
        methodologyHash: view.methodologyHash,
        dataRevision: view.dataRevision,
        observationWindow: view.observationWindow,
        windowAvailable: view.windowAvailable,
        insufficientEvidence: view.insufficientEvidence,
        countryCode: view.countryCode,
        providerId: view.providerId,
      };
    }
    return { ok: true, ...view };
  }

  async getTimeline(args: IntelligenceReadArgs): Promise<JsonObject> {
    const built = await this.buildIntelligence(args);
    if ("error" in built) return built;
    const page = built.page;
    const limit = built.limit;
    const offset = (page - 1) * limit;
    if (args.providerId) {
      const doc = projectPublicTimelineDocument(buildProviderTimeline({ ...built.query, providerId: args.providerId }));
      return { ok: true, ...doc, events: doc.events.slice(offset, offset + limit), page, limit };
    }
    if (built.query.countryCode) {
      const doc = projectPublicTimelineDocument(buildCountryTimeline({ ...built.query, countryCode: built.query.countryCode }));
      return { ok: true, ...doc, events: doc.events.slice(offset, offset + limit), page, limit };
    }
    return { ok: false, error: "providerId or country is required" };
  }

  async getOutlookEligibility(args: IntelligenceReadArgs): Promise<JsonObject> {
    const built = await this.buildIntelligence(args);
    if ("error" in built) return built;
    if (!args.metric || !isTrendMetric(args.metric)) {
      return { ok: false, error: "metric is required" };
    }
    const outlook = buildOutlook(built.query, args.metric);
    return { ok: true, ...publicOutlookEligibilityView(outlook) };
  }

  private async buildIntelligence(args: IntelligenceReadArgs): Promise<
    | {
        query: {
          facts: VerifiedFact[];
          window: { start: string; end: string } | null;
          countryCode: string | null;
          providerId: string | null;
          dataRevision: string | null;
        };
        limit: number;
        page: number;
      }
    | { error: string; ok: false; code?: string }
  > {
    const guarded = guardTrendQuery({
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      limit: args.limit,
      page: args.page,
    });
    if (!guarded.ok) {
      return { ok: false, error: guarded.message, code: guarded.code };
    }
    let countryCode: string | null = null;
    if (args.country) {
      countryCode = canonicalizeCountryCode(args.country) ?? resolveCountry(args.country)?.iso2 ?? null;
      if (!countryCode) return { ok: false, error: `unregistered country: ${args.country}` };
    }
    let snapshot;
    try { snapshot = await loadDataRevision(this.client, args.dataRevision); }
    catch (error) {
      if (error instanceof DataRevisionError) return { ok: false, error: error.message, code: error.code };
      throw error;
    }
    const facts = snapshot.facts;
    const window = guarded.window ?? windowFromInferred(inferObservationWindow(facts));
    return {
      query: {
        facts,
        window,
        countryCode,
        providerId: args.providerId ?? null,
        dataRevision: snapshot.id,
      },
      limit: guarded.limit,
      page: guarded.page,
    };
  }

  private async loadLedgerFacts(): Promise<VerifiedFact[]> {
    try {
      const { rows } = await this.client.query(
        `SELECT r.id AS receipt_id, r.revision_id, r.change_type, r.entity_type, r.entity_id, r.field_name,
                r.before_value, r.after_value, r.verification_state, r.methodology_version, r.data_revision, r.knowledge_state, r.assessment_state,
                r.published_at::text AS published_at, r.verified_at::text AS verified_at, r.evidence_snapshot_ids, r.supersedes_receipt_id,
                e.observed_at::text AS observed_at, e.provider_id, e.value_sensitivity
         FROM publication_receipts r
         JOIN change_events e ON e.receipt_id = r.id
         ORDER BY r.published_at DESC, r.id DESC
         LIMIT $1`,
        [MAX_TREND_FACTS]
      );
      return factsFromLedgerRows((rows as Array<Record<string, unknown>>).map(ledgerFactRowFromJoin));
    } catch {
      return [];
    }
  }
}

function isTrendMetric(value: string): value is TrendMetric {
  return (TREND_METRICS as readonly string[]).includes(value);
}

function claimValueCountry(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "country" in value) {
    const country = (value as { country?: unknown }).country;
    return typeof country === "string" ? country : null;
  }
  return null;
}

function boundFromClaims(
  claims: Array<{ claim_type: string; knowledge_state: string; value: unknown }>,
  types: string[]
): { knowledgeState: "present" | "confirmed_absent" | "unknown" | "conflicting" | "not_applicable"; value: string | null } {
  const match = claims.filter((c) => types.includes(c.claim_type));
  if (match.some((c) => c.knowledge_state === "conflicting")) {
    return { knowledgeState: "conflicting", value: null };
  }
  const present = match.find((c) => c.knowledge_state === "present");
  if (present) {
    return { knowledgeState: "present", value: claimValueCountry(present.value) };
  }
  if (match.some((c) => c.knowledge_state === "confirmed_absent")) {
    return { knowledgeState: "confirmed_absent", value: null };
  }
  return { knowledgeState: "unknown", value: null };
}

function subjectFromClaims(
  providerId: string,
  offeringId: string,
  deploymentId: string,
  offeringName: string,
  claims: Array<{ claim_type: string; knowledge_state: string; value: unknown }>
): OfferingDeploymentSubject {
  const country = boundFromClaims(claims, ["deployment_country", "country"]);
  const primary = boundFromClaims(claims, ["primary_residency", "data_residency"]);
  const backup = boundFromClaims(claims, ["backup_residency"]);
  const metadata = boundFromClaims(claims, ["metadata_residency", "control_plane_residency"]);
  const legal = boundFromClaims(claims, ["legal_entity", "contracting_entity"]);
  return {
    offeringId,
    deploymentId,
    providerId,
    offeringName,
    deploymentCountry: country,
    primaryResidency: primary,
    backupResidency: backup,
    metadataResidency: metadata,
    contractingEntity: {
      knowledgeState: legal.knowledgeState,
      value: legal.value
        ? { id: "claimed", jurisdictionCountry: legal.value }
        : null,
    },
    administrativeAccess: { knowledgeState: "unknown", value: null },
    keyControl: { knowledgeState: "unknown", value: null },
    facility: { knowledgeState: "unknown", value: null },
    technologies: [],
    commercial: { knowledgeState: "unknown", value: null },
    evidenceItems: claims.map((c) => ({
      claimType: c.claim_type,
      assessmentState: "legacy/unverified",
      knowledgeState:
        c.knowledge_state === "present" ||
        c.knowledge_state === "confirmed_absent" ||
        c.knowledge_state === "unknown" ||
        c.knowledge_state === "conflicting" ||
        c.knowledge_state === "not_applicable"
          ? c.knowledge_state
          : "unknown",
      independent: false,
      freshnessDays: null,
      excerptPresent: false,
    })),
  };
}

export { LEGACY_METHODOLOGY };
