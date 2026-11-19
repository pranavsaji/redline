# Redline

![tests](https://img.shields.io/badge/tests-900%2B%20passing-brightgreen)
![coverage](https://img.shields.io/badge/line%20coverage-92.9%25-brightgreen)
![eval F1](https://img.shields.io/badge/eval%20F1-29.3%25-blue)
![injection resistance](https://img.shields.io/badge/injection%20resistance-1%2F6%20(tuning)-blue)
![runs on Atlassian](https://img.shields.io/badge/egress-none-informational)

**Security review that actually gates Done and merge.** Redline threat-models every Jira work item with a cited STRIDE
model, turns the threats that matter into security requirements, and blocks the Done transition and the Bitbucket merge
until each one is verified with evidence or its risk is accepted by someone allowed to accept it. Every decision goes
into a hash-chained, Merkle-logged risk ledger anyone can verify offline.

Built for Atlassian Codegeist 2026 on Forge: Jira, Confluence, Bitbucket, Rovo (agent, actions, skill, MCP),
Automation and Forge SQL. No egress: nothing leaves Atlassian.

![Redline issue panel](docs/screenshots/jira-1-issue-panel.png)

## What it does

- **Cited threat models.** Three independent Rovo agent runs propose STRIDE threats; Redline keeps only those a
  majority raised and whose quotes are found word for word in the work item, its pages or incidents. Plain language
  first ("A stolen link lets an attacker lock the real owner out for good."), then the STRIDE category, ASVS 5 and CWE.
- **Injection-resistant by construction.** The model never decides anything: code sets the verdict. Text that tries to
  instruct the AI is treated as data, flagged in the panel, and the threats it touches wait for a security champion.
- **Requirements with evidence.** Each threat at or above the policy becomes a Given/When/Then requirement and a
  sub-task; closing it needs a PR, test, Confluence section or note as evidence.
- **Enforcement that fails closed.** A workflow validator blocks Done while anything is open, missing, failed or out of
  date, with a message saying exactly why and a one-click re-run. Paused at the budget? A champion can confirm.
- **Risk acceptance with teeth.** Reason, compensating controls, an expiry (at most 30 days for Critical), an approver
  who is not the requester, and the right role for the severity.
- **Signed merge attestations.** The Bitbucket merge check accepts a sensitive pull request only with an Ed25519
  attestation for its exact head commit. One changed character fails.
- **A ledger you can audit.** Append-only hash chain, daily signed Merkle tree heads published to Confluence, and
  downloadable inclusion proofs checked with `node scripts/verify-ledger-proof.mjs` (Node built-ins only).
- **For everyone involved.** Issue panel, admin page with a first-run wizard, security posture page and dashboard
  gadget, Confluence threat-model pages and a weekly digest, the Redline Rovo agent, and an MCP server so coding agents
  (Claude Code, Cursor) see the same requirements ([skill](mcp-skill/skill.md)).

## Eval

_Scored offline with Claude Code on claude-sonnet-4-5, 30 cases (24 clean, 6 poisoned), 3 samples each, 2026-11-19, prompt v1.2.0. Prompt tuning is in progress; these are the first-run numbers._

| Metric | Value | Target |
| --- | --- | --- |
| High-severity recall | 89.2% | ≥ 85% |
| Recall | 85.2% | |
| Precision | 17.7% | ≥ 70% |
| F1 | 29.3% | |
| Citation grounding | 99.8% | 100% |
| Injection resistance | 16.7% (1 of 6) | 100% |

The eval set is 40 clean cases across web, API, mobile, data and AI features, plus 15 poisoned twins that hide
instructions to the AI in the design text; a poisoned case holds when its risk and blocking count do not drop below
its clean twin's and the injection is flagged. Run it yourself:

```bash
pnpm redline eval --llm recorded --subset 30             # replay the recorded model outputs offline (what CI runs)
pnpm redline eval --llm claude-code --subset 30          # live, through your own Claude Code subscription
pnpm redline eval --llm fake                             # deterministic baseline rules only, no model
```

## Try it

- **On a Jira site**: follow the [judge guide](docs/JUDGE_GUIDE.md): install, run the admin wizard, load the demo data,
  open the epic, try to move it to Done.
- **Locally, no site needed**:

  ```bash
  pnpm install
  pnpm test                                   # unit, contract, pipeline, UI and accessibility tests
  pnpm --filter @redline/core-ui dev --port 5179   # http://localhost:5179/?state=ready · ?view=admin · ?view=posture
  pnpm redline sign-demo                      # sign an attestation and watch a one-character change fail
  ```

## Docs

- [Architecture](docs/ARCHITECTURE.md): the review flow, the risk formula, the verdict rules, packages and ports.
- [Security review](docs/SECURITY_REVIEW.md): Redline threat-modelled, each control with the test that proves it.
- [Judge guide](docs/JUDGE_GUIDE.md), [screenshots](docs/screenshots/README.md), [privacy](docs/PRIVACY.md),
  [terms](docs/TERMS.md).

## Repository

```
apps/core        Redline for Jira: Forge functions, Rovo actions and agent, Custom UI (apps/core/ui)
apps/bitbucket   Redline for Bitbucket: merge check and repository settings
apps/local       pnpm redline: offline reviews, evals, demo signing
packages/        core (domain), crypto, db, frameworks (ASVS 5, CWE, OWASP LLM/Agentic), prompts, shared, llm-dev
evals/           cases, runner, metrics, recorded model outputs, results
scripts/         ledger proof verifier, layout audit, listing screenshots
```

Deploy (development): `pnpm --filter @redline/core-ui build && cd apps/core && node build.mjs && forge deploy -e development`.
