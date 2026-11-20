# Forge platform spike — results (Task 15)

Run 2026-11-15/16 against the real platform. Apps are registered in the Developer Space "Redline":
`Redline` `13898a7c-6897-48d3-a512-079d9f9f5f00` and `Redline for Bitbucket` `53a2efe5-9150-4e9a-b869-8bd2605d64e0`.
Everything ran on the development environment and Forge CLI 14.2.0.

## Sites

| Site | What it is | Rovo agents | Use |
|---|---|---|---|
| `one-atlas-mefc.atlassian.net` | Forge **demo site** (`forge site provision`), enterprise Jira/Confluence/JSM + Rovo, expires **2027-02-13** | Yes | Primary dev + demo site |
| `redline-dev.atlassian.net` | Free Cloud Developer Bundle (Standard) | **No** ("your org admin needs to activate AI"; Rovo is not an app on the site) | Non-Rovo checks only |
| Bitbucket workspace `pranavsaji`, repo `redline` | Free plan | n/a | Merge check |

## Checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Workspace package (`@redline/crypto`) bundled with esbuild (`manual@2026`) runs in Forge | **PASS** | Spike web trigger returned `crypto: true` on both sites |
| 2 | Forge SQL `migrationRunner` creates a table; KVS `setSecret`/`getSecret` round-trips | **PASS** | `migrations: [{name: spike_v001}]`, `row: "redline"`, secret `{k: "v"}` round-tripped (both sites) |
| 3 | `PUT issue/{key}/properties/redline.verdict` as app, then the validator expression returns the property's message | **PASS** (after 2 fixes) | `putStatus 201/200`, `POST /rest/api/3/expression/evaluate` → `{"value":"Redline: spike verdict blocks Done"}`. Fixes: `requestJira` sends `text/plain` unless `Content-Type: application/json` is set (415), and `/expression/eval` is **removed (410)** → use `/expression/evaluate` |
| 4a | Forge agent selectable in Automation "Use agent" | **PASS** | "Redline — By Redline" listed and selectable on the demo site (after "Connect Automation to Rovo") |
| 4b | Agent can call the GET `ping` action from Automation | **PASS** | Rule "Work item created → Use agent: Redline" on PAY-3 and PAY-4: log `{"event":"ping","issueKey":"PAY-3"}` |
| 4c | The agent's output reaches Redline from Automation | **PASS via a better route** | With **"Let this agent take actions"** on, the agent called the CREATE action `submit-threat-model` with no human in the loop: log `{"event":"submit_spike","issueKey":"PAY-3","bytes":27}`. The `automation:actionProvider` + `{{agentResponse}}` route was **abandoned**: Automation kept serving the first-seen action list and config URL for over 40 minutes, even through a rename, a new resource key and a reinstall |
| 5 | Assign a work item to the Redline agent | **PASS — assignment starts the agent automatically** | Redline appears in the Assignee picker (app user). Assigning PAY-2 set the assignee to "Redline with Pranav Saji" and started an agent session that called `ping` and replied with PAY-2's key. Also startable from the work item's "Agents" menu (PAY-1: "pong=true"). The reply is a session "waiting for review", **only visible to the assigner** until someone uses "Draft comment" |
| 6 | Bitbucket: check appears, can be set Required, `requestBitbucket` reads PR / diffstat / policy file | **PARTIAL** | Check appears in repo settings → Custom merge checks after the workspace enables the feature, and was added on `main`. **"Required" (blocking) needs Bitbucket Premium** (tooltip: "Upgrade to premium to allow failed checks to prevent merges"), and so do workspace/project-level checks. The API reads are deployed but not yet exercised: they need a PR in the repo (waiting on Pranav) |

## New platform facts this spike found

- **Automation "Use agent" now has "Let this agent take actions"** ("Allows the agent to use tools that create, edit, or delete"). The agent then runs with the rule actor's permissions. This lifts the documented "Automation agents won't call CREATE actions" limit, so the agent may be able to call `submit-threat-model` directly from Automation. That is to be confirmed in 4b/4c.
- Automation Forge actions need a Custom UI config page that calls `view.submit({...inputs})` and handles `AUTOMATION_ACTION_SUBMIT`. With a static page, Next stays disabled. Automation caches **both the action list and the config resource URL** well past the documented 20 minutes (over 30 minutes observed), even across a major version and a new resource key.
- An unauthenticated web trigger in the manifest causes "RoA trust signal loss", which forces a major version. The spike trigger was **removed** after checks 1–3, and both trigger URLs were deleted.
- `forge register` needs a Developer Space, and the first run prompts for its name (TTY).
- Forge CLI 15.x needs Node ≥ 22.23.4. Version 14.2.0 works on Node 22.22.1.

## Caller identity in actions

Rovo action handlers get `payload.context = { agentId, accountId, cloudId, moduleKey, userAccess }` plus `payload.contextToken` and `payload.orgId`. The second argument is `{ principal, installContext, installation, workspaceId }`. **Authorise with `payload.context.accountId`**, never with inputs.

## Interactive sessions (assignment, Agents menu, chat)

A CREATE action shows a **confirmation card** ("Submit Redline threat model", with the inputs, Confirm/Cancel) and runs only after Confirm (seen on PAY-3, log at 00:45:42Z). GET actions run without a prompt.

## Decision gate (Step 5)

**Gate passed, and the live path is simpler than planned:**
1. **Automatic (primary):** an Automation rule (work item created / moved to "Security review" / label `redline-review`) runs "Use agent: Redline" with **Let this agent take actions** on. The agent calls GET `get-review-context`, then CREATE `submit-threat-model`. Each run is one sample, and the rule repeats the step N=3 times. This needs no `automation:actionProvider`, no config UI and no `{{agentResponse}}`.
2. **Assignment (user's question answered: yes):** assigning the work item to Redline starts a session that does the same, with one Confirm click on the submit card.
3. **Rovo chat:** the same actions, with the same confirmation.


## Task 19 live run (2026-11-16, demo site, app 5.3.0)

| Step | Result |
|---|---|
| Automation rule "Redline: security review on create (3 agent runs)": Work item created → 3 × "Use agent: Redline" with **Let this agent take actions** on | Enabled, scoped to Payments |
| PAY-6 created 05:30:39Z | Trigger created revision 1 (`awaiting_agent`) at 05:30:43Z |
| Agent run 1 / 2 / 3: get-review-context → submit-threat-model (with the single-use token) | Samples saved 05:30:54, 05:31:11, 05:31:25 — all valid, no human in the loop |
| Review `ready` | 05:31:25Z (**47 s** after the work item was created) |
| `redline.verdict` | `block`, 2 open High requirements, panel link |
| Interactive session (PAY-5, Agents menu) | Same actions; one Confirm click on the submit card; late sample after the 15-min timeout was assembled in final mode → `ready` |

**Finding:** Jira's bulk `POST /rest/api/3/permissions/check` returns **403** when an app asks about another user (it needs
Administer Jira). Permission checks now impersonate the account being checked (`asUser(accountId)` +
`GET /rest/api/3/mypermissions`, scopes `read:jira-work`/`read:jira-user` with `allowImpersonation: true`).
The first automation run (before this fix) shows in the rule's "Debug agent response" as two get-review-context calls and no submit.

## Task 20 live run (app 5.4.x): issue panel

- PAY-7 (AI support agent with refunds) reviewed unattended in 53 s. The panel shows 11 threats, the top one Critical and agreed by 3 of 3 runs ("Someone could trick the AI into giving them money…", ASI01/ASI02/LLM01/LLM06). It also shows 11 matching requirements and the verdict "Blocks Done and merge" (8 open at High or above).
- PAY-6, reviewed before the clustering fix, had all 9 agent threats discarded as "too few runs agreed". The runs had worded the same threats differently, which led to `sameThreat()` (shared evidence) in `packages/core/src/threats/cluster.ts`.
- Panel load is about 1–2 s in the Jira iframe (resolver plus permission checks).
- `forge deploy` lint scans `ui/node_modules` and takes about 10 minutes. Run `forge lint` only when the manifest changes, and otherwise deploy with `--no-verify` (about 40 s).

## Live: Done gate (Task 22, 2026-11-16, demo site)

- `redline-gate` (function validator) added to the PAY workflow's global "Any status → Done" transition through the new workflow editor (Add rule → Marketplace rules → Redline).
- PAY-7 → Done: HTTP 400, "Redline blocks Done: 8 open security requirement(s) at High or above (create the subtasks in the Redline panel). Open the Redline panel: https://one-atlas-mefc.atlassian.net/browse/PAY-7". First call 3.4 s (recomputed a pre-message verdict, cold start), warm call 0.6 s.
- Bypass check: a user `PUT {"state":"pass"}` into the `redline.verdict` issue property succeeds (200: anyone who can edit the item can write it) and the transition is still blocked, because the gate reads app storage. An expression validator over the property would have passed.
- `apps/core` uses `bundler: manual` (`dist/`): run `node build.mjs` before `forge deploy`, or the old bundle ships ("i[Q.functionName] is not a function" for a new handler).

## Live: requirements as sub-tasks (Task 21, 2026-11-16, demo site)

- PAY-7 panel → Requirements → "Create sub-tasks (11)" created PAY-8 … PAY-18 (type Sub-task, label `redline`, Given/When/Then + ASVS ids + panel link in the description).
- The gate message then named keys: "Redline blocks Done: 8 open security requirement(s) at High or above: PAY-15, PAY-8, PAY-18, PAY-17, PAY-9 and 3 more. Open the Redline panel: …/browse/PAY-7".
- JQL over the indexed property works: `project = PAY AND redlineState = block`.
- A requirement sub-task follows its own requirement: PAY-8 → Done is blocked with "This security requirement is not verified yet. Add evidence on PAY-7 in the Redline panel."
- Re-run Automation rule: a duplicated "Use agent" flow needs its own Rovo connection login ("This connection needs to be re-authenticated" → Log in), which Automation will not save without. Left for the site owner; the original create rule is unchanged and still "Logged in to Rovo".
