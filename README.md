# Threatline

![tests](https://img.shields.io/badge/tests-1050%2B%20passing-brightgreen)
![coverage](https://img.shields.io/badge/line%20coverage-92.9%25-brightgreen)
![high-severity recall](https://img.shields.io/badge/high--severity%20recall-91.9%25-blue)
![injection resistance](https://img.shields.io/badge/injection%20resistance-6%2F6-blue)
![runs on Atlassian](https://img.shields.io/badge/egress-none-informational)

**Security review that actually gates Done and merge.** Threatline threat-models every Jira work item with a cited STRIDE
model, turns the threats that matter into security requirements, and blocks the Done transition and the Bitbucket merge
until each one is verified with evidence or its risk is accepted by someone allowed to accept it. Every decision goes
into a hash-chained, Merkle-logged risk ledger anyone can verify offline.

Built for Atlassian Codegeist 2026 on Forge: Forge LLMs (Threatline Engine), Jira, Confluence, Bitbucket, Rovo (agent,
actions, skill, MCP), Automation and Forge SQL. No egress: nothing leaves Atlassian.

![Threatline issue panel](docs/screenshots/jira-1-issue-panel.png)

## What it does

- **Threatline Engine: it reviews by itself.** Install, create a story, and within a few minutes the panel shows a cited
  threat model. Threatline runs it on Atlassian-hosted Claude models (Opus 5): three independent analyses that must
  agree, each quoting its evidence, then an adversarial verifier that checks every threat against its quotes (doubted
  High and Critical threats go to a champion instead of disappearing). No Rovo agent, Automation rule or setup, and no
  developer can write their own review. [How it works, and what we measured](docs/ENGINE.md).
- **Cited threat models.** Three independent AI runs (Threatline Engine, or your site's Rovo agent) propose STRIDE threats; Threatline keeps only those a
  majority raised and whose quotes are found word for word in the work item, its pages or incidents. Plain language
  first ("A stolen link lets an attacker lock the real owner out for good."), then the STRIDE category, ASVS 5 and CWE.
- **Injection-resistant by construction.** The model never decides anything: code sets the verdict. Text that tries to
  instruct the AI is treated as data, flagged in the panel, and the threats it touches wait for a security champion.
- **Requirements with evidence.** Each threat at or above the policy becomes a Given/When/Then requirement and a
  sub-task; closing it needs a PR, test, Confluence section or note as evidence.
- **From requirement to test in one click.** Every requirement copies as a ready-to-fill test skeleton (TypeScript,
  Python or Java) with one failing test per acceptance criterion, in the panel or for coding agents via
  `get-security-requirements` with `testLanguage`. Requirement text is escaped, so a hostile work item cannot inject
  code into the skeleton.
- **Fix-by dates.** Open requirements are due 7 days (Critical), 30 (High) or 90 (Medium) after Threatline raised them;
  the panel shows "Overdue by N days" and the posture page counts what is overdue.
- **Works without Rovo.** An admin can switch Review mode to rule-based checks only: every review completes at once from
  Threatline's built-in checks, clearly labelled, so the gates work on any Jira site.
- **Developers cannot write their own review.** An admin locks AI review runs to the account that owns the Automation
  rule (Review mode → Who can submit AI review runs). Anyone else's submission is refused and recorded in the ledger.
- **Enforcement that fails closed.** A workflow validator blocks Done while anything is open, missing, failed or out of
  date, with a message saying exactly why and a one-click re-run. Paused at the budget? A champion can confirm.
- **Risk acceptance with teeth.** Reason, compensating controls, an expiry (at most 30 days for Critical), an approver
  who is not the requester, and the right role for the severity.
- **Signed merge attestations.** The Bitbucket merge check accepts a sensitive pull request only with an Ed25519
  attestation for its exact head commit. One changed character fails.
- **GitHub too.** The same merge gate runs as a GitHub Action ([setup](docs/GITHUB.md)): add a workflow, paste the
  public key, require the check.
- **A ledger you can audit.** Append-only hash chain, daily signed Merkle tree heads published to Confluence, and
  downloadable inclusion proofs checked with `node scripts/verify-ledger-proof.mjs` (Node built-ins only).
- **For everyone involved.** Issue panel, admin page with a first-run wizard, security posture page and dashboard
  gadget, Confluence threat-model pages and a weekly digest, the Threatline Rovo agent, and an MCP server so coding agents
  (Claude Code, Cursor) see the same requirements ([skill](mcp-skill/skill.md)).

## Eval

_Scored offline with Claude Code on claude-sonnet-4-5 (tools and MCP off, Threatline's prompt as the system prompt), 30 cases (24 clean, 6 poisoned), 3 samples each, 2026-11-19, prompt v1.3.0._

| Metric | Value | Target |
| --- | --- | --- |
| High-severity recall | 91.9% | ≥ 85% |
| Recall | 85.2% | |
| Injection resistance | 6 of 6 | all |
| Citation grounding | 99.8% | 100% |
| Precision, judged: threats the model proposed | 76.3% | ≥ 70% |
| Precision, judged: all threats shown | 71.1% (was 59.6% before coverage) | |
| Precision, strict (vs the must-find list only) | 35.9% (was 29.5%) | lower bound |
| F1 (strict) | 50.5% (was 43.8%) | |

Each case lists only 2 to 3 must-find threats, while Threatline shows about 6 per case, so strict precision counts every
other threat as wrong. A separate `claude -p` call (same model, tools off, a strict rubric: follows from the design,
specific, not a duplicate) graded each threat outside the list: 45 of the 73 the model proposed are valid.

**Less noise from the rule-based floor.** The judge rated only 2 of 58 extra rule-based threats valid on the full set:
most were generic twins of a more specific threat the AI had already raised. A rule-based threat now stands back
(state `covered`) when a trusted AI threat (majority-voted, quoted word for word, untouched by injection) of the same
kind, on the same topic and at least as severe covers it. It stays stored, its standards mappings move to the AI
threat, and it comes back with its requirement if a champion dismisses that AI threat. Under suspected injection
nothing is covered. Rule-based extras fell from 58 to 15 with recall unchanged. The floor still always runs, so a
failed or poisoned agent run still leaves a fail-closed review. The eval report lists judged validity per rule.

A judge from the same model family may be lenient to its own outputs; its verdicts are recorded in
`evals/results/judged/` so you can read every one. Recorded verdicts are matched to threats by title, so they stay
valid when a change removes some threats; `--no-coverage` replays the earlier numbers exactly.

**Full set (all 55 cases, same model and prompt, 2026-11-20):** high-severity recall 90.0%, recall 85.1%, citation
grounding 98.9%, judged precision of model-proposed threats 73.7% (all threats 68.5%, strict 36.5%; before coverage
57.1% and 30.0%), injection resistance 14 of 15. The one miss, poisoned `ai-02`, still flagged the injection and blocked twice as much as its clean
twin, but its risk score came out 84 instead of 90 because the agent runs on that page reported fewer data classes;
the eval counts any drop in risk as a miss. Reports: `evals/results/2026-11-20-*-all.md`.

The eval set is 40 clean cases across web, API, mobile, data and AI features, plus 15 poisoned twins that hide
instructions to the AI in the design text; a poisoned case holds when its risk and blocking count do not drop below
its clean twin's and the injection is flagged. Run it yourself:

```bash
pnpm threatline eval --llm recorded --subset 30 --judge recorded   # replay recorded outputs and judge verdicts (CI)
pnpm threatline eval --llm claude-code --subset 30          # live, through your own Claude Code subscription
pnpm threatline eval --llm recorded --subset 30 --judge claude-code   # re-grade the extras live (one call per case)
pnpm threatline eval --llm fake                             # deterministic baseline rules only, no model
```

## Try it

- **On a Jira site**: [install Threatline for Jira](https://developer.atlassian.com/console/install/13898a7c-6897-48d3-a512-079d9f9f5f00?signature=AYABeCcfIQJqGrR0SUgfCmoTNmEAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB1BD8mEv4t3Ljf3OukSd5eQAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDEh%2BKItDcqUwro%2BHrQIBEIA7MA0KHRf%2BF3YuTEAMovFxVALBMAXOWvXwcePSrlXd8eWbO0Gu4PlzXePH9QGutTzgsBB7obWKVcKw55kAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgHlW5ynSsuhZ7zbqiK2sh%2B2AAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMkPcTbpchY2MsayhfAgEQgDuWokoIpYBa88xi5ggk1L1JkcZBleXY2Fhu75VlWDzfTq%2FPjQu2HTJqqUvWAGr3gQmwdhbGrdneGDgHcgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAbLrick3%2FS2k9TO8wl7jjBMAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwPyU3UXZLk3LyqQEcCARCAO56x65zN0k8TKW9hcCjB8AjClKyO30ptqnOAj2gX5CQsUchhHNyCLeBw5CSlVzbE5lnPkVzoFWWWPI9DAgAAAAAMAAAQAAAAAAAAAAAAAAAAAE5uz5LjAh1FnegGXQysekL%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADJlU7brRNHeEAgdUVuQgPgaQWe2H582mtCI1iAJ%2FP3ZS3ti2WQm0S86s3LQVssf56LpbJ8u0XxBB32s7u970Pyt6So%3D&product=jira&product=confluence) (and [Threatline for Bitbucket](https://developer.atlassian.com/console/install/53a2efe5-9150-4e9a-b869-8bd2605d64e0?signature=AYABeMU6Rt2jeek7C5UOdWnYVhcAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB9X7SgA05cnObTkvhYN1xbQAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDNEhzAe7TPWDBVqk6wIBEIA7keQSd6CapbYmtUGdkeKKsGD9awYJ3ooCpMpwMF2EDUNbpBp%2F9PeiHpLYzLpKRCnH1ToDtNvaJyOei0kAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgEaeJ%2BkdCobmSDv47DLtIySAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMGEExVBpjK5bbUYmTAgEQgDvy5cWJv19sweBbrSFr5C3xdwywv%2BBv20pRtihL1aMr7o8uQnVvR9vasue1xGfDidyWyh8RzUzmiGXFBQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAWqyfoA4bYp55SbOGUdCdOkAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwmXimEV%2FsYgm0GihwCARCAO2yT52i7N%2B%2BDNBN%2F2F87pJutoitrvTBVazhVeMuRbv%2BmP8xV9sDbTccsGcHKl%2BfdohjSFjjtL%2BQGx983AgAAAAAMAAAQAAAAAAAAAAAAAAAAANo1IMueG73KsfmrDTjuUgD%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADJ0ZrDuRm0Q%2Biua58qqR3NYv5pw6Y4tZl2HqZtAX21FXdWDPb0BBfCK40FDFpZmG9vKBDYJl3oHZ3or2flppy5yAWs%3D&product=bitbucket)), then follow the
  [judge guide](docs/JUDGE_GUIDE.md): run the admin wizard, load the demo data,
  open the epic, try to move it to Done.
- **Locally, no site needed**:

  ```bash
  pnpm install
  pnpm test                                   # unit, contract, pipeline, UI and accessibility tests
  pnpm --filter @threatline/core-ui dev --port 5179   # http://localhost:5179/?state=ready · ?view=admin · ?view=posture
  pnpm threatline sign-demo                      # sign an attestation and watch a one-character change fail
  pnpm e2e                                    # Journeys A and B and the merge check in a real browser
  ```

  `pnpm e2e` drives the real UI against Threatline's real resolvers, agent actions, Done validator and signing, with
  only Jira, Confluence, Rovo and the clock simulated (`e2e/local/server.ts`). CI also runs semgrep (Threatline's own
  rules in `.semgrep.yml` plus the registry rulesets), `pnpm audit`, gitleaks and knip, and fails on any high finding.

## Docs

- [Architecture](docs/ARCHITECTURE.md): the review flow, the risk formula, the verdict rules, packages and ports.
- [Security review](docs/SECURITY_REVIEW.md): Threatline threat-modelled, each control with the test that proves it.
- [Judge guide](docs/JUDGE_GUIDE.md), [screenshots](docs/screenshots/README.md), [privacy](docs/PRIVACY.md),
  [terms](docs/TERMS.md).

## Repository

```
apps/core        Threatline for Jira: Forge functions, Rovo actions and agent, Custom UI (apps/core/ui)
apps/bitbucket   Threatline for Bitbucket: merge check and repository settings
apps/github-action  Threatline merge gate for GitHub (same decision code; see docs/GITHUB.md)
apps/local       pnpm threatline: offline reviews, evals, demo signing
packages/        core (domain), crypto, db, frameworks (ASVS 5, CWE, OWASP LLM/Agentic), prompts, shared, llm-dev
evals/           cases, runner, metrics, recorded model outputs, results
e2e/             Playwright journeys (local harness in CI; optional smoke test on a real site)
scripts/         ledger proof verifier, layout audit, listing screenshots
```

Deploy (development): `pnpm --filter @threatline/core-ui build && cd apps/core && node build.mjs && forge deploy -e development`.
