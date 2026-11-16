import type {
  ClockPort,
  ContextGatherer,
  FeedbackRepo,
  IssueRepo,
  LedgerRepo,
  RequirementRepo,
  ReviewRepo,
  UsageRepo,
  VerdictSink,
} from '@redline/core';
import type { Result } from '@redline/shared';
import type { ConfluenceClient } from './adapters/confluence.js';
import type { JiraClient } from './adapters/jira.js';
import type { ConfigStore, KvsPort } from './adapters/kvs-config.js';
import type { RetentionStore } from './adapters/retention.js';
import type { ReviewJob } from './jobs/types.js';

export interface JobQueue {
  push(jobs: ReviewJob[]): Promise<Result<void>>;
}

/** Everything a handler needs, wired once by composeCore(); tests build it from memory repos and fakes. */
export interface CoreDeps {
  reviews: ReviewRepo;
  requirements: RequirementRepo;
  ledger: LedgerRepo;
  feedback: FeedbackRepo;
  issues: IssueRepo;
  usage: UsageRepo;
  /** Jira as the app (triggers, consumers and jobs have no user). */
  jira: JiraClient;
  confluence: ConfluenceClient;
  gatherer: ContextGatherer;
  verdicts: VerdictSink;
  config: ConfigStore;
  /** Small app state in KVS: current context hashes, counters, schema version, alert de-duplication. */
  state: KvsPort;
  retention: RetentionStore;
  queue: JobQueue;
  clock: ClockPort;
  /** Applies pending SQL migrations (Forge migrationRunner in production). */
  migrate(): Promise<Result<{ to: number }>>;
  /** Site base URL, e.g. https://example.atlassian.net (for panel links). */
  siteUrl(): Promise<string>;
}
