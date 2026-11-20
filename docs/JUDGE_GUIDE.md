# Redline judge guide

Redline makes security review part of "Done": every Jira work item gets a cited STRIDE threat model, the threats that
matter become requirements, and the work item cannot move to Done (nor its pull request merge) until each requirement
is verified or its risk is accepted by someone allowed to accept it.

## Install

| App | Install link | Needs |
| --- | --- | --- |
| Redline for Jira (with Confluence) | `<Jira installation link from the Developer Console → Distribution>` | A Jira Cloud site with Rovo (agents need Rovo); Confluence on the same site for published pages |
| Redline for Bitbucket | `<Bitbucket installation link from the Developer Console → Distribution>` | A Bitbucket Cloud workspace; Premium to make the check *required* (otherwise it warns) |

Install the Jira app into Jira and Confluence. In **Atlassian Administration → Apps → Rovo MCP**, allow the clients you
want to use with Redline's MCP tools (optional).

## The 2-minute path

1. **Open the admin page**: Jira settings → Apps → **Redline**. The first-run wizard asks for a project, the transition
   to guard (for example Done) and the security champion group. Save.
2. **Add the gate**: in the project's workflow, add the rule **Redline security gate** (Marketplace rules) to the
   transition you chose.
3. **Load the demo data**: admin page → **Demo data** → enter the project and a Confluence space → **Load demo data**.
   It creates an epic "Add AI support agent" with stories (order lookup, refunds), two incidents, and a design page
   with one poisoned paragraph that tells the AI to approve the change.
4. **Turn on automatic reviews**: create an Automation rule in the project:
   *Work item created* (condition: type is Story or Epic) → **Use agent: Redline** with **Let this agent take actions**
   on, three times (three independent samples). Connect Automation to Rovo when asked.
   You can skip this step and start a review by hand: open the work item → Redline panel → **Run review**.
5. **Open the epic "Add AI support agent"**. Within about a minute the Redline panel shows:
   - the risk score and why Done is blocked;
   - threats in plain language first, each with the quote it rests on and a link to its source;
   - a banner naming the design page as containing instructions aimed at the AI: they were treated as data, and the
     threats resting on that page wait for a security champion instead of being trusted;
   - "What if…" to see the score if the feature were public or handled payment data.
6. **Try to move it to Done.** The gate blocks with the open requirements listed and a link back to the panel.
7. **Fix or accept**: on **Requirements**, create the sub-tasks, mark one *Verified* with a PR link as evidence, and
   **Accept risk** on another (a reason, controls and an expiry; a security champion approves it on **Acceptances**).
   Move the work item to Done: it passes.
8. **Merge**: on **Requirements → Merge attestation**, enter the repository and head commit, copy the attestation into
   the pull request description. The Bitbucket check passes; change one character and it fails.
9. **Audit**: admin page → **Risk ledger** → **Verify the ledger**, and download an inclusion proof; check it offline
   with `node scripts/verify-ledger-proof.mjs proof.json`.

Also worth a look: **Apps → Redline security posture** (and the dashboard gadget), the threat model published to
Confluence (**History → Publish to Confluence**), and asking the **Redline** agent in Rovo chat "What do I need to fix
before this can merge?".

## Without a Jira site

Everything above runs against fixture data in a local preview, no Atlassian site needed:

```bash
pnpm install
pnpm --filter @redline/core-ui dev --port 5179   # then open http://localhost:5179/?state=ready (or ?view=admin, ?view=posture)
pnpm test                                        # 900+ tests, including accessibility checks
pnpm redline sign-demo                           # sign an attestation, then show that one changed character fails
pnpm redline eval --llm recorded --subset 30     # replay the recorded eval offline
```

Screenshots of every surface are in [screenshots/](screenshots/README.md); the design in [ARCHITECTURE.md](ARCHITECTURE.md);
Redline's own threat model in [SECURITY_REVIEW.md](SECURITY_REVIEW.md).
