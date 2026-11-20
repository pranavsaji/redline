# Redline judge guide

Redline makes security review part of "Done": every Jira work item gets a cited STRIDE threat model, the threats that
matter become requirements, and the work item cannot move to Done (nor its pull request merge) until each requirement
is verified or its risk is accepted by someone allowed to accept it.

## Install

| App | Install link | Needs |
| --- | --- | --- |
| Redline for Jira (with Confluence) | [Install Redline for Jira](https://developer.atlassian.com/console/install/13898a7c-6897-48d3-a512-079d9f9f5f00?signature=AYABeCcfIQJqGrR0SUgfCmoTNmEAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB1BD8mEv4t3Ljf3OukSd5eQAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDEh%2BKItDcqUwro%2BHrQIBEIA7MA0KHRf%2BF3YuTEAMovFxVALBMAXOWvXwcePSrlXd8eWbO0Gu4PlzXePH9QGutTzgsBB7obWKVcKw55kAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgHlW5ynSsuhZ7zbqiK2sh%2B2AAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMkPcTbpchY2MsayhfAgEQgDuWokoIpYBa88xi5ggk1L1JkcZBleXY2Fhu75VlWDzfTq%2FPjQu2HTJqqUvWAGr3gQmwdhbGrdneGDgHcgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAbLrick3%2FS2k9TO8wl7jjBMAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwPyU3UXZLk3LyqQEcCARCAO56x65zN0k8TKW9hcCjB8AjClKyO30ptqnOAj2gX5CQsUchhHNyCLeBw5CSlVzbE5lnPkVzoFWWWPI9DAgAAAAAMAAAQAAAAAAAAAAAAAAAAAE5uz5LjAh1FnegGXQysekL%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADJlU7brRNHeEAgdUVuQgPgaQWe2H582mtCI1iAJ%2FP3ZS3ti2WQm0S86s3LQVssf56LpbJ8u0XxBB32s7u970Pyt6So%3D&product=jira&product=confluence) | A Jira Cloud site with Rovo (agents need Rovo); Confluence on the same site for published pages |
| Redline for Bitbucket | [Install Redline for Bitbucket](https://developer.atlassian.com/console/install/53a2efe5-9150-4e9a-b869-8bd2605d64e0?signature=AYABeKFrOdIp4KpSdnKGbGUBSkUAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB43xQ8z0a40vUy92qFrbZsgAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDLmyoQqegXqdj1hpawIBEIA7KqL2Jq8dMqSVB%2BqLp%2BqmRoaoxpOLEOxAiir3VTO5e6sSe7s5CXVhfARMsp0c1HUiWcXegZaQ2afBrboAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgEputGsmrOJAk%2FkRTqjeiMVAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMkH7QJyZwcmbpFIVEAgEQgDsHAfyZkW2%2BSGje9GoN3d5v8W%2FjjNH6AZqGtivmtT6mifu72SeLpu3P6CtQdUhCniy4BntFoD0iOIC1nQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAZJijhliY2wtihwZxY0ZFg4AAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAw8KYxq%2BOBFrXk5KjwCARCAOxK9or6FQxcLuzPGYQeMECqtNv1j0ZC8u9P0W0GNJVp0yeYt4cHziLHW7O%2BxamFnPnnS13F8bky3lfspAgAAAAAMAAAQAAAAAAAAAAAAAAAAAD5FLYx1pYO%2B%2BHscT5ahDZP%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLmtENlA5glak6mKZ8RlGFud8haL7JU3yXg40aDBe7s9XGrm0hcfv%2BUa75S%2FBNizLRIC3uIp8m7LVm2W4Gys7NdNrE%3D&product=bitbucket) | A Bitbucket Cloud workspace; Premium to make the check *required* (otherwise it warns) |

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

## If a review never arrives

- **Automation audit log says "The agent selected for this rule has been deactivated"**: an app update replaced the
  Redline agent. Open the rule, and in each **Use agent** step choose **⋯ → Switch agent → Redline**, then save.
- **The Redline panel is not on a work item**: add it once from the apps button under the work item title
  (**Redline security review**).
- **Load demo data says the Confluence space was not found**: create a space (any name) and enter its key.
- **Run review on this work item does nothing for a long time**: the re-run needs a second Automation rule with the
  trigger *Field value changed → Labels → Value added*, condition `{{issue.labels}}` contains `redline-review`, and the
  same three **Use agent: Redline** steps.

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
