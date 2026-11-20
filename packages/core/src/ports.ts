import type {
  AgentThreatModel,
  ContextBundle,
  ContextFact,
  DismissReason,
  Requirement,
  Result,
  Review,
  ReviewStatus,
  Stride,
  Threat,
  Verdict,
} from '@redline/shared';
import type { KeyPair } from '@redline/crypto';

export interface ClockPort {
  now(): Date;
}

export type ModelTier = 'fast' | 'balanced' | 'deep';
export type LlmPurpose = 'extract' | 'propose' | 'verify' | 'requirements' | 'explain' | 'release';

export interface LlmRequest {
  system: string;
  user: string;
  tier: ModelTier;
  maxOutputTokens: number;
  purpose: LlmPurpose;
}
export interface LlmResponse {
  text: string;
  modelId: string;
  tokensIn: number;
  tokensOut: number;
}
export interface LlmPort {
  complete(req: LlmRequest): Promise<Result<LlmResponse>>;
}

export interface GatherOptions {
  /**
   * The person whose action caused this gather. Content the app can read but this person cannot (restricted
   * Confluence pages, incidents under issue security) is left out of the bundle. Without an actor it is left out too.
   */
  actorAccountId?: string;
}
export interface ContextGatherer {
  gather(issueId: string, opts?: GatherOptions): Promise<Result<ContextBundle>>;
}

export type FailedSample = { failed: string };
export type Sample = AgentThreatModel | FailedSample;
export const isFailedSample = (s: Sample): s is FailedSample => 'failed' in s;

export interface DiscardedThreat {
  title: string;
  stride?: Stride;
  reason: 'low_votes' | 'unsupported_citation' | 'duplicate_of_dismissed' | 'schema';
}

export interface ReviewRepo {
  latest(issueId: string): Promise<Result<Review | null>>;
  get(id: string): Promise<Result<Review | null>>;
  history(issueId: string): Promise<Result<Review[]>>;
  byStatus(status: ReviewStatus, olderThan?: string): Promise<Result<Review[]>>;
  create(r: Review): Promise<Result<Review>>;
  update(id: string, patch: Partial<Review>): Promise<Result<void>>;
  saveFacts(reviewId: string, facts: ContextFact[]): Promise<Result<void>>;
  facts(reviewId: string): Promise<Result<ContextFact[]>>;
  saveThreats(reviewId: string, threats: Threat[], discarded: DiscardedThreat[]): Promise<Result<void>>;
  threats(reviewId: string): Promise<Result<Threat[]>>;
  discarded(reviewId: string): Promise<Result<DiscardedThreat[]>>;
  updateThreat(id: string, patch: Partial<Threat>): Promise<Result<void>>;
  saveSample(reviewId: string, n: number, sample: Sample): Promise<Result<void>>;
  samples(reviewId: string): Promise<Result<Sample[]>>;
  /** `at` is when the stage reached this status (defaults to now); the admin page reads it as the run's trace. */
  saveStage(reviewId: string, stage: string, status: 'running' | 'done' | 'failed', checkpoint?: unknown, error?: string, at?: string): Promise<Result<void>>;
  stage(reviewId: string, stage: string): Promise<Result<{ status: string; checkpoint?: unknown } | null>>;
  /** Newest first by createdAt, at most `limit` (capped at 500); with `since`, only reviews created at or after it. */
  recent(limit: number, since?: string): Promise<Result<Review[]>>;
  /** The review's stage trace in time order, without checkpoints. */
  stages(reviewId: string): Promise<Result<StageTrace[]>>;
}

export interface StageTrace {
  stage: string;
  status: string;
  error?: string;
  at: string;
}

export interface RequirementRepo {
  forIssue(issueId: string): Promise<Result<Requirement[]>>;
  get(id: string): Promise<Result<Requirement | null>>;
  upsert(r: Requirement): Promise<Result<void>>;
}

export type LedgerEventType =
  | 'acceptance.requested'
  | 'acceptance.approved'
  | 'acceptance.rejected'
  | 'acceptance.revoked'
  | 'acceptance.expired'
  | 'attestation.issued'
  | 'override.breakglass'
  | 'review.champion_confirmed'
  | 'budget.champion_confirmed'
  | 'policy.warn_only'
  | 'policy.changed'
  | 'project.purged'
  | 'reviews.resumed'
  | 'review.sample'
  | 'key.rotated';

export interface LedgerInsert {
  seq: number;
  eventType: LedgerEventType;
  payload: Record<string, unknown>;
  actor: string;
  createdAt: string;
  prevHash: string;
  entryHash: string;
}
export type LedgerRow = LedgerInsert;

export interface LedgerRepo {
  head(): Promise<Result<{ seq: number; entryHash: string } | null>>;
  /** Must fail with `conflict` when prevHash (or seq) already exists, so concurrent appends cannot fork the chain. */
  append(e: LedgerInsert): Promise<Result<LedgerRow>>;
  range(fromSeq: number, toSeq: number): Promise<Result<LedgerRow[]>>;
  all(): Promise<Result<LedgerRow[]>>;
  /** Only rows of these event types, in seq order (indexed): what verdicts and the panel read on every refresh. */
  ofTypes(types: readonly LedgerEventType[]): Promise<Result<LedgerRow[]>>;
}

export interface FeedbackRow {
  threatId: string;
  component: string;
  title: string;
  stride: Stride;
  actor: string;
  action: 'dismiss' | 'accept' | 'edit';
  reason?: DismissReason;
  note?: string;
}
export interface FeedbackRepo {
  dismissedFor(component: string): Promise<Result<Array<{ title: string; stride: Stride; reason: DismissReason }>>>;
  record(f: FeedbackRow): Promise<Result<void>>;
}

export interface IssueRow {
  issueId: string;
  issueKey: string;
  projectKey: string;
  parentId?: string;
}
export interface IssueRepo {
  upsert(i: IssueRow): Promise<Result<void>>;
  get(issueId: string): Promise<Result<IssueRow | null>>;
  byKey(issueKey: string): Promise<Result<IssueRow | null>>;
  children(issueId: string): Promise<Result<IssueRow[]>>;
  linkPage(issueId: string, pageId: string): Promise<Result<void>>;
  issuesForPage(pageId: string): Promise<Result<string[]>>;
}

export interface AttestationRow {
  id: string;
  issueKey: string;
  repo: string;
  commitSha: string;
  kid: string;
  expiresAt: string;
  nonce: string;
}
export interface AttestationRepo {
  record(a: AttestationRow): Promise<Result<void>>;
  forIssue(issueKey: string): Promise<Result<AttestationRow[]>>;
}

/** R5: a signed head of the Merkle tree over the ledger's entry hashes (RFC 9162 style). */
export interface TreeHead {
  treeSize: number;
  rootHash: string;
  timestamp: string;
  kid: string;
  signature: string;
  /** The Confluence page it was published to, once it has been. */
  publishedPageId?: string;
}
export interface TreeHeadRepo {
  /** Fails with `conflict` when a head for this size already exists. */
  add(h: TreeHead): Promise<Result<void>>;
  latest(): Promise<Result<TreeHead | null>>;
  lastPublished(): Promise<Result<TreeHead | null>>;
  /** Newest (largest) first. */
  list(limit: number): Promise<Result<TreeHead[]>>;
  markPublished(treeSize: number, pageId: string): Promise<Result<void>>;
}

export interface UsageRepo {
  add(month: string, delta: { tokensIn: number; tokensOut: number; reviews: number }): Promise<Result<void>>;
  get(month: string): Promise<Result<{ tokensIn: number; tokensOut: number; reviews: number }>>;
}

export interface VerdictSink {
  write(issueId: string, v: Verdict & Record<string, unknown>): Promise<Result<void>>;
}

export interface PublicKeyInfo {
  active: { kid: string; publicKey: string };
  /** Still trusted until retireAt (the grace period after a rotation). */
  previous?: { kid: string; publicKey: string; retireAt: string };
}

export interface SigningKeyStore {
  active(): Promise<Result<KeyPair>>;
  publicKeys(): Promise<Result<Record<string, string>>>;
  rotate(): Promise<Result<KeyPair>>;
  /** Active and in-grace previous public keys (creates the first key pair if there is none). */
  describe(): Promise<Result<PublicKeyInfo>>;
}
