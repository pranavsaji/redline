# Redline — Build Design

Date: 2026-11-14 · Source of truth for product behaviour: `Redline Product and Technical Build Spec.md` (the "spec").
This document records the intent, the scope cut, the approach, and every decision layered on top of the spec.
Where this doc is silent, the spec wins.

## Intent

Win first prize at Codegeist 2026 (Atlassian, deadline Dec 22 12:00 PT) with Redline: every change gets a cited,
graph-aware security review, and nothing ships until that review is satisfied or a named owner signs off.
Judges score on idea, implementation quality, design (20%), and use of the platform; bonus prizes reward
Rovo, Bitbucket, Teamwork Graph, Marketplace and Runs on Atlassian. "Production-ready" means: it really enforces
(validator + merge check), it cannot be talked out of a verdict, it is tested, and it demos flawlessly on a fresh site.

## Goals

- T0 + T1 from the spec, complete.
- Research set: R1 (dual-LLM injection defense), R2 (self-consistency + verifier), R4 (signed attestations),
  R8 (agentic AI threat pack), R7 (incremental re-review), R10 (eval harness — offline in CI, real-LLM runs on request).
- Stretch, only if ahead: R12 what-if simulator (cheap, strong demo moment), R5 Merkle log (crypto package makes it cheap).
- Judge-facing proof: README with eval scores and coverage, `SECURITY_REVIEW.md`, `JUDGE_GUIDE.md`, `ARCHITECTURE.md`,
  open-source `mcp-skill/skill.md`.

## Non-goals

- T3 items (scanner connector, policy packs beyond ASVS levels, forecasting, multi-site, paid tiers).
- R3, R6, R9, R11 — roadmap slide only.
- Marketplace submission mechanics, video, Devpost write-up (Pranav does these; I provide assets and text drafts).

## Anti-goals (failure even if it "works")

- Any path where LLM output, or text an attacker wrote, changes a verdict, requirement status or acceptance.
- A threat shown without a resolvable citation.
- Any egress permission in either manifest (loses Runs on Atlassian).
- A demo that depends on a preview feature with no fallback (Teamwork Graph EAP, `rovo:skill` EAP, `rovo:mcp` Preview).
- Validator or merge check that calls an LLM or the graph (latency + reliability).

## Constraints

- Two Forge apps (ECO-329: Bitbucket workspace scopes cannot coexist with Jira/Confluence site scopes).
- Forge limits per spec table (55 s actions, 900 s async consumer, 5 MB invoke response, `requestTeamworkGraph` asUser only).
- Forge LLMs has no free tier: any real LLM run (pipeline smoke tests, eval runs) is confirmed with Pranav first.
- Forge CLI 14.2.0 installed, logged in. Developer site URL + Bitbucket workspace still to be confirmed before first deploy.

## Approaches considered

1. **Spec-faithful monorepo, pure domain core behind ports, Forge adapters at the edge, plus a local harness (chosen).**
   pnpm + strict TypeScript. `packages/core` has zero Forge imports, so the whole 7-stage pipeline, scoring, ledger,
   attestations and policy run in Vitest and in a local CLI with fake ports. Forge adapters are thin.
   Trade-off: more upfront structure; pays back in test coverage, eval harness, and a demo fallback.
2. **Forge-first, logic inside resolvers/handlers.** Fastest to a first deploy, but untestable without a live site,
   no offline evals, and judges comparing against Secure Notes will see it. Rejected.
3. **UI-first with mocked backend, wire later.** Good screenshots early, but enforcement (the core claim) would be
   the last thing built and the riskiest. Rejected.

## Decisions (my calls — correct any)

- **Workspace:** pnpm workspaces, Node 22, TypeScript `strict`, no `any`, zod at every boundary, Vitest, ESLint + Prettier.
- **Errors:** typed `Result<T, E>` (`Ok`/`Err` with code) across ports; no throws across a port.
- **Crypto:** `@noble/ed25519` + `@noble/hashes` (audited, pure JS — same code verifies in Core, Bitbucket app and the
  browser "test a pasted attestation" tool). Attestation format: `redline-att.v1.<base64url(canonical JSON)>.<base64url(sig)>`
  with key id, nonce, 24 h default expiry, bound to `issueKey + repo + commitSha`.
- **Canonical JSON** (sorted keys) for everything that is hashed or signed: ledger entries, attestations, `context_hash`.
- **LLM port:** one `LlmPort` interface; Forge adapter uses `@forge/llm`; `FakeLlm` returns deterministic, schema-valid
  fixtures for tests, CI evals and the local demo. Model routing per spec (Haiku-first, Sonnet verify, Opus for large releases);
  exact model ids read from the Forge LLMs docs at implementation time, never hard-coded in domain code.
- **Storage:** Forge SQL for relational/audit tables, KVS for config/caches/flags, secret storage for the signing key.
  All SQL in `packages/db` with a numbered-migration runner on install/upgrade.
- **Graph:** `GraphPort` with a Teamwork Graph adapter (persisted queries) *and* a REST-only adapter. REST is the
  guaranteed path; graph enrichment is additive and user-triggered (identity note in spec). Demo works on REST alone.
- **Frameworks data:** ship ASVS 5.0, a CWE subset, LLM Top 10 and Agentic Top 10 (ASI01–ASI10) as JSON in
  `packages/frameworks`, sourced from the official OWASP repos; requirement IDs are validated against it.
- **UI:** Custom UI, React 18 + Vite + Atlaskit components + design tokens (dark mode, WCAG 2.1 AA), one UI app serving
  issue panel, global page and admin page by module key. A local preview mode (mocked `@forge/bridge`) lets me iterate
  on design and take screenshots without deploying.
- **Bitbucket app:** separate Forge app, its own small UI for repo settings; shares `packages/crypto` and `packages/shared`.
- **Forge bundling risk:** Forge's bundler and pnpm symlinks can conflict. If they do, each app gets a prebuild step that
  bundles workspace packages; decided during M0 spike, not upfront.
- **Demo seeder:** admin-page button + CLI script that creates a project, epic "Add AI support agent", design page
  (including one poisoned paragraph for the R1 demo), incidents and policy — install to first value under 2 minutes.
- **Repo:** `git init` in this folder; conventional commits; GitHub Actions CI (lint, typecheck, unit/contract/pipeline tests,
  offline eval gate, `forge lint` for both manifests).

## Enforcement semantics (my calls, from the builder check)

- **Blocking does not depend on anyone clicking "Create requirements".** The verdict is computed from *accepted* threats
  at or above the policy severity: each one is blocking until its requirement is Verified, Accepted risk, or Not applicable,
  or the threat is dismissed by a champion with a reason code. A threat with no requirement yet is still blocking.
  "Create requirements" just materialises the subtasks.
- **Injection bar: injection can never reduce blocking.** A source flagged `injection_suspected` forces the review into
  "Needs human" for any threat or sketch field it influenced, and the review cannot auto-pass; a champion must confirm.
  Stage 2 output is also checked against deterministic signals (keywords for PII/payment/auth/LLM, public endpoints) and
  can only *raise* exposure or data classes relative to those signals, never lower them. Red-team fixtures assert
  "verdict and blocking count are ≥ the clean baseline".
- **Gates fail closed (Pranav's rules).**
  - Missing or failed review: block Done and merge; the message says exactly why.
  - Agent or model timeout/error counts as a missing review.
  - Stale (context changed since last review): block, with a one-click "Re-run review" link in the message.
  - Paused at budget (Redline token budget or the site's Rovo credits exhausted): block, but a project champion can
    confirm; the confirmation is a ledger entry and the admin is alerted, so one limit cannot freeze a team.
  - Break-glass: admin only, written reason required, every use ledgered.
  - Warn-only mode per project auto-expires after 14 days.
  - Changes touching no policy-sensitive paths merge freely.
  - `partial` bundles do not block on their own but show a banner and are recorded in the attestation.
- **Hierarchy:** reviews run on issue types enabled in admin (default Epic and Story). A child issue inherits blocking
  requirements from its reviewed ancestors for both the validator and the merge attestation, so `PROJ-142` (a story under
  the epic) is gated by the epic's review. Seeder uses a company-managed project so epics and stories can hold subtasks.
- **Which build judges see:** one manifest with all modules for the development install link judges use; a `--prod`
  manifest variant without EAP modules (`rovo:skill`) for the Marketplace listing. Verified against the Codegeist rules
  before M5.
## Model execution: $0 out of pocket (Pranav's rules + my design)

Budget is **$0 of Forge LLM, Anthropic API or other paid credits**. Three `LlmPort` adapters:

| Adapter | Used for | Default |
| --- | --- | --- |
| `FakeLlm` | Unit, pipeline and CI tests; offline demo | on in tests |
| `ClaudeCodeLlm` | Prompt tuning and eval runs on Pranav's machine via `claude -p` under his subscription: tools disabled, Redline prompt as the system prompt, `--model claude-sonnet-4-5` if available (else report the model used), no session persistence. 30-case subset first; full set only once prompts are stable | dev-only, never bundled into Forge |
| `ForgeLlm` | Kept in code, **off by default**. Turning it on for anything needs Pranav's OK with an expected cost | off |

**Live app: the review runs through the Rovo agent, on the site's Rovo credits.** What the docs confirm (Nov 2026):
- Forge `rovo:agent` modules can be added to Jira Automation rules ("Use agent" action), which invoke the agent
  asynchronously on Jira events. This is the documented, supported path for a Forge agent.
- Assigning a work item to an agent, or adding an agent to a workflow transition, auto-runs it — but the docs only
  describe this for Studio-built agents (beta), not Forge app agents. Unconfirmed for Redline; tested in the M0 spike.
- An agent run from Automation may have its write tools blocked; the documented way to use its output is the
  `{{agentResponse}}` smart value in a later rule step. Community reports say tool calls often don't fire there.
- Remote agents (`rovo:agentConnector`) are assignable but need an external endpoint = egress. Rejected.

So the design does not depend on the agent calling tools:
1. **Trigger** — a shipped Automation rule template (the seeder installs it on the demo project): on work item created,
   or transitioned to a "Security review" status, or labelled `redline-review` → "Use agent: Redline Security Reviewer"
   with a fixed prompt carrying the issue key and a per-run nonce. If Forge-agent assignment works on the site, the
   agent's prompt handles that path too, as a bonus.
2. **Agent output is data** — it returns a JSON threat model (STRIDE category, title, scenario, component, likelihood,
   impact, and *verbatim quotes* as evidence). It never decides anything.
3. **Ingest** — the next rule step is a Forge Automation action (`action` + `actionProvider`, Jira only) "Redline:
   ingest threat model" that takes `{{agentResponse}}`. Deterministic Forge code gathers the REST context bundle itself,
   validates the JSON against the schema, resolves every quote to a bundle fact (unresolved → threat dropped and logged),
   maps ASVS/CWE/ASI from the bundled framework tables, scores, and writes the verdict entity property.
   If the agent *can* call tools on the site, it calls the same ingest code as a `submit-threat-model` action.
4. **Gates read only the saved verdict** (entity property / SQL), never the agent.

**Deterministic baseline:** a rule-based threat pass (signals from the bundle: auth, PII, payment, public endpoint,
LLM/agent/tool-calling, file upload, secrets, new dependency) always runs in ingest. The agent can add threats on top;
it can never remove a baseline threat or lower exposure/data classes. So even a failed or poisoned agent run leaves a
valid, cited, fail-closed review.

**Simplifications forced by running through Rovo:**
- **R2 self-consistency:** 3 samples instead of 5 (three "Use agent" steps in the rule, each ingested; consensus in code
  keeps threats in ≥2 of 3). Sample count is an admin setting (1, 3 or 5) because each run costs Rovo credits.
- **R2 verifier:** the Sonnet verifier becomes a **deterministic grounding check** — the quote must appear in the cited
  fact (normalised whitespace/case) and the threat's component must appear in the sketch. "Weak" = paraphrase-only match
  → Needs human. An optional 4th agent step can act as an LLM verifier, off by default.
- **R1 dual-LLM:** the Rovo agent *is* the quarantined model — it reads raw text but its output is enum-heavy JSON with
  capped strings and no control fields; the privileged "planner" is deterministic code, not a second LLM. This is closer
  to CaMeL than a two-LLM pipeline, and the poisoned-page demo still works (verdict can't drop below baseline; page
  flagged by the heuristic scanner).
- **Model choice per stage** (Haiku/Sonnet/Opus routing) is not controllable through Rovo; dropped for the live path.
  The pipeline stages still exist in `packages/core` and run end-to-end with `ClaudeCodeLlm` for evals.
- **Latency** depends on Rovo; the panel shows live status from the rule's progress ("Agent run 2 of 3 received").

**README scores** are labelled "scored offline with Claude Code on model X, N cases, date".

**Cost controls:** stage outputs cached by `context_hash`; triggers debounced by `context_hash`; per-project sample
count; CI never calls a real model.

## Build order

Spec milestones M0–M5, golden path first, each milestone ends demoable:
M0 foundations + spikes (bundling, Ed25519 cross-app, Forge LLM call, SQL) → M1 context + pipeline + panel v1 →
M2 requirements, validator, Confluence page, seeder → M3 ledger, acceptances, attestations, Bitbucket →
M4 actions, Rovo agent/skill, MCP, R1/R2/R8, dashboard → M5 polish, evals, docs. Cut lines per spec.

## Left to the builder (decided during implementation, recorded in the plan)

- Exact Forge manifest property names (verified with `forge lint` and current docs, not copied from the spec sketch).
- Persisted graph query shapes (depend on what object types exist on the demo site).
- Prompt wording and eval fixture content.
- Risk-score formula constants (deterministic, unit-tested, documented in ARCHITECTURE.md).

## Open items for Pranav

- Developer site URL (with Rovo + Forge LLMs enabled) and Bitbucket workspace — needed before the first deploy (end of M0).
- Teamwork Graph connector EAP application status.
- Authorised Forge LLM spend for development and real eval runs (sets how many tuning/eval rounds happen with the real model).
