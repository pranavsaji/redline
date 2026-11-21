# Threatline: Devpost submission and demo script

Copy the sections below into the Devpost form. The demo script is for a video of about three minutes.

## Tagline

Security review that gates Done and merge: AI threat models with cited evidence, enforced by code the AI cannot talk
past.

## Inspiration

Teams already "do" security review: a checklist in the ticket template, a threat-model page nobody updates, a
reviewer asked at the last minute. The review is advisory, so it loses to the deadline. AI made it worse in a new way:
a chatbot will happily write a threat model, but it invents risks, misses real ones, and anyone can ask it to say the
change is fine. We wanted review that is specific to the work, cites its evidence, and is enforced where work actually
finishes: the Done transition and the merge.

## What it does

Threatline makes security review part of "Done". One story shows all of it:

1. **Create a story.** Threatline Engine reviews it by itself on Atlassian-hosted Claude models (Forge LLMs): three
   independent analyses that must agree and quote their evidence word for word, then an adversarial verifier. No
   setup, no Rovo agent, no Automation rule, and no developer can write their own review.
2. **Read the threats in plain language**, each with the sentence it rests on, its STRIDE category, ASVS 5 and CWE, and
   a Given/When/Then requirement with a fix-by date and a copyable test skeleton.
3. **Try to move it to Done: blocked.** The workflow validator lists the open requirements. Missing, failed or
   out-of-date reviews block too, with a one-click re-run. The gate fails closed.
4. **Fix or accept.** Verify a requirement with a PR link, or accept the risk with a reason, controls, an expiry and an
   approver who is not you. Done passes.
5. **Merge.** A signed Ed25519 attestation lets the Bitbucket merge check (or the Threatline GitHub Action) pass the
   sensitive pull request for its exact head commit. Change one character and it fails.

**The AI cannot be talked into approving.** Text that tries to instruct the model is flagged, the threats resting on it
wait for a security champion, the verifier never runs on flagged material, and code, not the model, computes the
verdict. Measured on our eval: 6 of 6 poisoned cases held, high-severity recall 91.9%.

**Also:** a hash-chained, Merkle-logged risk ledger with offline inclusion proofs; MCP tools and a Rovo agent so coding
agents (Claude Code, Cursor) see the same requirements; a posture dashboard and gadget; Confluence threat-model pages;
break-glass overrides with written reasons; warn-only mode that expires after 14 days.

## How we built it

Two Forge apps (Jira + Confluence, and Bitbucket) and a GitHub Action, in TypeScript. Forge LLMs run Threatline Engine as
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

1. **0:00 Problem (15 s).** "Security review is advisory, so it loses to the deadline. Threatline makes it part of Done."
2. **0:15 Create a story (30 s).** In PAY, create "Let customers export their order history as CSV via a shareable
   link", describing a public S3 bucket, a link that never expires, and a `customerId` query parameter. Cut to the
   panel a few minutes later.
3. **0:45 The review (45 s).** Show the Threatline Engine banner, the risk score, the threats (the `customerId` IDOR,
   the never-expiring public link), each with its quote, "Verified" badges, and one threat the verifier dropped with
   its reason.
4. **1:30 The gate (20 s).** Move the story to Done: blocked, with the open requirements listed.
5. **1:50 Injection (25 s).** Open the demo epic "Add AI support agent": the banner names the poisoned design
   paragraph; the threats resting on it wait for a champion.
6. **2:15 Fix and merge (30 s).** Verify a requirement with a PR link, accept one risk; Done passes. Copy the merge
   attestation into the pull request: the check passes; change one character in the commit and it fails.
7. **2:45 Audit (15 s).** Admin → Risk ledger → Verify the ledger; download an inclusion proof.

## Additional info (judges only): ready-to-paste answers

Fields not listed here (submitter type, country, age, eligibility, employment, survey questions) are yours to answer.

- **Is your project new?** New (started 2026-11-14).
- **Installation link:** the "Install Threatline for Jira" link in `docs/JUDGE_GUIDE.md` (Jira + Confluence). Also give the
  Bitbucket link from the same file in the testing instructions.
- **Testing instructions:** "Follow https://github.com/pranavsaji/threatline/blob/main/docs/JUDGE_GUIDE.md: open
  Jira settings → Apps → Threatline, save the first-run wizard, click Add the gate for me, load demo data (project
  key + any Confluence space key), then open the epic 'Add AI support agent' a few minutes later. No Rovo or Automation
  setup is needed; Threatline Engine runs the reviews on Forge LLMs."
- **App ID:** `13898a7c-6897-48d3-a512-079d9f9f5f00` (Threatline for Jira). Threatline for Bitbucket:
  `53a2efe5-9150-4e9a-b869-8bd2605d64e0`.
- **How it meets the technology requirement:** Built entirely on Forge. Jira: issue panel, workflow validator (the
  Done gate), admin and global pages, dashboard gadget, entity properties for JQL, issue events. Confluence: design
  pages read as review context, threat-model pages and signed ledger heads published. Bitbucket: a merge check that
  verifies signed attestations. Forge LLMs: Threatline Engine (Claude models hosted by Atlassian). Rovo: an agent with
  actions and an MCP server for coding agents. Forge SQL, KVS, secret storage and queues hold state; nothing egresses.
- **Category:** Apps for Software Teams. **Why:** it changes how software teams ship: security requirements become part
  of Done and of the merge, in Jira and Bitbucket, where developers already work.
- **Bonus prize:** Best app with Atlassian MCP (Threatline's MCP tools give Claude Code or Cursor the same requirements
  the gate checks; the Rovo agent also qualifies it for Best Agents).
- **AI tools used:** Claude Code (Claude) for pair programming and the eval harness; Forge LLMs (Claude) inside the app.
