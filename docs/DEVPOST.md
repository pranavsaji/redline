# Redline: Devpost submission and demo script

Copy the sections below into the Devpost form. The demo script is for a video of about three minutes.

## Tagline

Security review that actually gates Done and merge: cited threat models, verified by AI, enforced by code.

## Inspiration

Teams already "do" security review: a checklist in the ticket template, a threat-model page nobody updates, a
reviewer asked at the last minute. The review is advisory, so it loses to the deadline. AI made it worse in a new way:
a chatbot will happily write a threat model, but it invents risks, misses real ones, and anyone can ask it to say the
change is fine. We wanted review that is specific to the work, cites its evidence, and is enforced where work actually
finishes: the Done transition and the merge.

## What it does

- **Redline Engine reviews every story by itself.** On Atlassian-hosted Claude models (Forge LLMs): three
  independent analyses of the work item and its linked pages on the strongest model, which must agree and quote their
  evidence word for word, then an adversarial verifier that checks each threat against the quotes it rests on. No setup, no Rovo agent
  or Automation rule needed, and no developer can write their own review.
- **Every threat is cited.** Redline keeps only threats a majority of analyses raised and whose quotes are found word
  for word in the work item, its pages or incidents. A rule-based floor always runs underneath.
- **Injection-resistant by construction.** Text that tries to instruct the AI is flagged and shown; threats resting on
  it wait for a security champion; the verifier never runs on flagged material; the model never decides the verdict.
- **Requirements with evidence.** Each threat at or above policy becomes a Given/When/Then requirement and a sub-task,
  with fix-by dates and a copyable test skeleton.
- **Gates that fail closed.** A workflow validator blocks Done; signed Ed25519 attestations let the Bitbucket merge
  check (or the Redline GitHub Action) pass a sensitive pull request only for its exact head commit.
- **Risk acceptance with teeth, and an audit trail anyone can verify.** Reason, controls, expiry and the right approver;
  every decision goes into a hash-chained, Merkle-logged ledger with offline inclusion proofs.
- **Everywhere people work.** Issue panel, admin page, posture dashboard and gadget, Confluence threat-model pages,
  the Rovo agent, and MCP tools so coding agents (Claude Code, Cursor) see the same requirements.

## How we built it

Two Forge apps (Jira + Confluence, and Bitbucket) and a GitHub Action, in TypeScript. Forge LLMs run Redline Engine as
a chain of queue jobs with checkpoints; Forge SQL stores reviews, requirements and the ledger; Forge KVS and secret
storage hold policy and signing keys; Custom UI with Atlaskit for every surface. The design rule: the model proposes,
code decides. Consensus, quote grounding, scoring, the verdict and the gates are deterministic and unit-tested
(over 1,000 tests, browser journeys, and a 55-case eval set with poisoned twins).

## Challenges

- Keeping the AI out of the decision while still using it for what it is good at: proposals and verification are
  requests; code decides what they do, and fails closed when the model errs.
- Prompt injection in design docs: a quarantined injection check runs first, the analyses read the text only inside
  nonce-fenced data blocks, and attacker text can never decide which threats are dropped or what the verdict is.
- Forge limits: every model call in its own job to fit a function timeout, and atomic usage accounting across
  parallel jobs.

## Accomplishments

- A review a developer cannot talk their way out of, that still explains itself in plain language.
- Signed attestations: change one character in the pull request and the merge check fails.
- An eval harness with recorded runs, a judge, and a CI gate that fails if quality drops.

## What we learned

Precision is the product. Security teams ignore tools that cry wolf; every feature that removed noise (consensus,
verbatim quotes, coverage, the verifier) mattered more than adding threat types.

## What's next

Marketplace listing, Jira Service Management incident feedback into reviews, and per-team policies.

## Demo script (about 3 minutes)

1. **0:00 Problem (15 s).** "Security review is advisory, so it loses to the deadline. Redline makes it part of Done."
2. **0:15 Create a story (30 s).** In PAY, create "Let customers export their order history as CSV via a shareable
   link", describing a public S3 bucket, a link that never expires, and a `customerId` query parameter. Cut to the
   panel a few minutes later.
3. **0:45 The review (45 s).** Show the Redline Engine banner, the risk score, the threats (the `customerId` IDOR,
   the never-expiring public link), each with its quote, "Verified" badges, and one threat the verifier dropped with
   its reason.
4. **1:30 The gate (20 s).** Move the story to Done: blocked, with the open requirements listed.
5. **1:50 Injection (25 s).** Open the demo epic "Add AI support agent": the banner names the poisoned design
   paragraph; the threats resting on it wait for a champion.
6. **2:15 Fix and merge (30 s).** Verify a requirement with a PR link, accept one risk; Done passes. Copy the merge
   attestation into the pull request: the check passes; change one character in the commit and it fails.
7. **2:45 Audit (15 s).** Admin → Risk ledger → Verify the ledger; download an inclusion proof.
