# Claude Code + Threatline MCP: a recorded session (live, 2026-11-17)

- **Where:** demo site `one-atlas-mefc`, Threatline development environment (app 6.x), served through Atlassian's Forge MCP endpoint `https://mcp.atlassian.com/forge/<appId>`. The app has one installation shared by Jira (required) and Confluence (optional).
- **Client:** Claude Code (`claude -p`, model claude-opus-5-5) with all of its own tools off (`--tools ""`) and only the Threatline MCP server allowed (`--allowedTools mcp__threatline`). Signed in with OAuth via `claude mcp login threatline`; Forge checks the caller's Jira permissions on every call.
- **How to reproduce:** see `mcp-skill/skill.md` for the `claude mcp add` command, then run the prompt below.
- **Transcript:** tool calls and the agent's final answer are verbatim. Long tool results are cut to their first two items with an "omitted here" marker; nothing else is changed. In Claude Code, tool names show the environment suffix `_development`.

## Prompt

```text
You are a coding agent about to work on Jira work item PAY-7 ("Verify refund webhook signatures") in the Bitbucket repository pranavsaji/threatline. Use only the Threatline MCP tools, and follow the Threatline workflow:
1. Call get-security-requirements for PAY-7 (status Open) and summarise what must be true before Done.
2. Call get-review for PAY-7, then explain-threat for the most severe threat (use its T-n ref).
3. The planned change touches src/auth/webhook.ts and README.md. Call check-change-risk for PAY-7 with those paths and say whether it would pass.
4. Call get-merge-attestation for PAY-7, repo pranavsaji/threatline, commit caf80f1cfbff47d603baeb761ba02338b0dedcd2. If it is blocked, list the reasons and stop; do not retry.
5. Call posture-summary for project PAY.
Do not call request-risk-acceptance. Finish with a short summary for the developer.
```

## Tool calls and results

### 1. `get-security-requirements`

**Input:** `{"issueKey": "PAY-7", "status": "Open"}`

```json
{
  "issueKey": "PAY-7",
  "panelUrl": "https://one-atlas-mefc.atlassian.net/browse/PAY-7",
  "requirements": [
    {
      "id": "req_8e47d83b41b957a7",
      "subtaskKey": "PAY-15",
      "title": "Validate LLM tool calls",
      "severity": "Critical",
      "status": "Open",
      "acceptanceCriteria": [
        "Given A user interaction with the AI agent, when The LLM attempts to call the refund tool, then The system must independently verify the user's ownership of the order and the refund eligibility before calling the Stripe API."
      ],
      "asvsIds": [
        "V15.1.1",
        "V8.2.1",
        "V8.3.1"
      ],
      "fileHints": [
        "**/auth/**",
        "**/session*",
        "**/login*",
        "**/payment*/**",
        "**/refund*",
        "**/billing/**",
        "**/agent*/**",
        "**/tools/**",
        "**/prompt*"
      ]
    },
    {
      "id": "req_6f75d2d77c24ac15",
      "subtaskKey": "PAY-13",
      "title": "Encrypt PII at rest and minimize retention",
      "severity": "High",
      "status": "Open",
      "acceptanceCriteria": [
        "Given Customer transcripts are stored, when Data is written to the support database, then PII must be encrypted and a strict 90-day deletion policy must be enforced."
      ],
      "asvsIds": [
        "V8.2.1",
        "V14.2.1"
      ],
      "fileHints": [
        "**/models/**",
        "**/repositor*/**",
        "**/db/**"
      ]
    },
    "… 9 more omitted here"
  ],
  "hiddenRequirements": 0,
  "truncated": false
}
```

### 2. `get-review`

**Input:** `{"issueKey": "PAY-7"}`

```json
{
  "issueKey": "PAY-7",
  "panelUrl": "https://one-atlas-mefc.atlassian.net/browse/PAY-7",
  "status": "ready",
  "revision": 1,
  "riskScore": 100,
  "partial": false,
  "verdict": {
    "state": "block",
    "blockingCount": 8,
    "maxOpenSeverity": "Critical",
    "reasons": [
      "8 open security requirement(s) at High or above."
    ]
  },
  "threats": [
    {
      "ref": "T-1",
      "id": "thr_dc1f7213d2371597",
      "title": "Prompt injection to trigger unauthorized refunds",
      "stride": "ElevationOfPrivilege",
      "severity": "Critical",
      "state": "accepted",
      "component": "AI Support Agent",
      "plainLanguage": "Someone could trick the AI into giving them money by sending it special messages.",
      "citations": [
        {
          "source": "PAY-7 Add AI support agent that can issue refunds",
          "url": "/browse/PAY-7",
          "quote": "The agent uses an LLM with tool calling to look up order history and can issue refunds up to $200 through the Stripe payment API."
        },
        {
          "source": "PAY-7 Add AI support agent that can issue refunds",
          "url": "/browse/PAY-7",
          "quote": "The agent uses an LLM with tool calling to look up order history"
        }
      ]
    },
    {
      "ref": "T-2",
      "id": "thr_26d1e757cea95843",
      "title": "Account takeover through weak authentication",
      "stride": "Spoofing",
      "severity": "High",
      "state": "accepted",
      "component": "authentication",
      "plainLanguage": "Someone could log in as a customer using a stolen password or session.",
      "citations": [
        {
          "source": "PAY-7 Add AI support agent that can issue refunds",
          "url": "/browse/PAY-7",
          "quote": "Customers sign in with their account and ask about orders."
        }
      ]
    },
    "… 9 more omitted here"
  ],
  "threatsTotal": 11,
  "hiddenThreats": 0,
  "truncated": false
}
```

### 3. `explain-threat`

**Input:** `{"issueKey": "PAY-7", "threatId": "T-1"}`

```json
{
  "issueKey": "PAY-7",
  "threatId": "thr_dc1f7213d2371597",
  "title": "Prompt injection to trigger unauthorized refunds",
  "severity": "Critical",
  "panelUrl": "https://one-atlas-mefc.atlassian.net/browse/PAY-7",
  "story": "Someone could trick the AI into giving them money by sending it special messages. A malicious user could use prompt injection techniques to trick the LLM into calling the refund tool for orders they don't own or for amounts they aren't entitled to, bypassing the intended logic.",
  "fixes": [
    "Validate LLM tool calls: given A user interaction with the AI agent, when The LLM attempts to call the refund tool, then The system must independently verify the user's ownership of the order and the refund eligibility before calling the Stripe API..",
    "Verify that application documentation defines risk based remediation time frames for 3rd party component versions with vulnerabilities and for updating libraries in general, to minimize the risk from these components.",
    "Verify that the application ensures that function-level access is restricted to consumers with explicit permissions.",
    "Verify that the application enforces authorization rules at a trusted service layer and doesn't rely on controls that an untrusted consumer could manipulate, such as client-side JavaScript."
  ],
  "refs": [
    {
      "framework": "OWASP ASVS 5.0",
      "id": "V15.1.1",
      "title": "Verify that application documentation defines risk based remediation time frames for 3rd party component versions with vulnerabilities and for updating libraries in general, to minimize the risk from these components.",
      "url": "https://github.com/OWASP/ASVS/tree/master/5.0"
    },
    {
      "framework": "CWE",
      "id": "CWE-94",
      "title": "Improper Control of Generation of Code ('Code Injection')",
      "url": "https://cwe.mitre.org/data/definitions/94.html"
    },
    {
      "framework": "OWASP ASVS 5.0",
      "id": "V8.2.1",
      "title": "Verify that the application ensures that function-level access is restricted to consumers with explicit permissions.",
      "url": "https://github.com/OWASP/ASVS/tree/master/5.0"
    },
    {
      "framework": "OWASP ASVS 5.0",
      "id": "V8.3.1",
      "title": "Verify that the application enforces authorization rules at a trusted service layer and doesn't rely on controls that an untrusted consumer could manipulate, such as client-side JavaScript.",
      "url": "https://github.com/OWASP/ASVS/tree/master/5.0"
    },
    {
      "framework": "CWE",
      "id": "CWE-269",
      "title": "Improper Privilege Management",
      "url": "https://cwe.mitre.org/data/definitions/269.html"
    },
    {
      "framework": "OWASP Top 10 for Agentic Applications",
      "id": "ASI02",
      "title": "ASI02",
      "url": "https://genai.owasp.org/"
    },
    {
      "framework": "OWASP Top 10 for Agentic Applications",
      "id": "ASI01",
      "title": "ASI01",
      "url": "https://genai.owasp.org/"
    },
    {
      "framework": "OWASP Top 10 for LLM Applications",
      "id": "LLM06",
      "title": "LLM06",
      "url": "https://genai.owasp.org/"
    },
    {
      "framework": "OWASP Top 10 for LLM Applications",
      "id": "LLM01",
      "title": "LLM01",
      "url": "https://genai.owasp.org/"
    }
  ]
}
```

### 4. `check-change-risk`

**Input:** `{"changedPaths": "src/auth/webhook.ts,README.md", "issueKey": "PAY-7", "summary": "Verify Stripe signatures on refund webhook events"}`

```json
{
  "issueKey": "PAY-7",
  "wouldPass": false,
  "needsAttestation": true,
  "diffScore": 60,
  "signals": [
    "sensitive_path",
    "auth_crypto_change"
  ],
  "sensitiveFiles": [
    "src/auth/webhook.ts"
  ],
  "touchedRequirements": [
    {
      "id": "req_1e60e12a6011969c",
      "subtaskKey": "PAY-8",
      "title": "Mitigate: Account takeover through weak authentication",
      "severity": "High",
      "status": "Open",
      "paths": [
        "src/auth/webhook.ts"
      ]
    },
    {
      "id": "req_370c805f14695912",
      "subtaskKey": "PAY-9",
      "title": "Mitigate: Personal data exposed to unauthorised users",
      "severity": "High",
      "status": "Open",
      "paths": [
        "src/auth/webhook.ts"
      ]
    },
    "… 3 more omitted here"
  ],
  "reasons": [
    "Touches security-sensitive paths: src/auth/webhook.ts. The merge check needs a Threatline attestation for PAY-7.",
    "8 open security requirement(s) at High or above.",
    "Requirement PAY-8 (High, Open) covers src/auth/webhook.ts: \"Mitigate: Account takeover through weak authentication\".",
    "Requirement PAY-9 (High, Open) covers src/auth/webhook.ts: \"Mitigate: Personal data exposed to unauthorised users\".",
    "Requirement PAY-11 (Medium, Open) covers src/auth/webhook.ts: \"Mitigate: Unauthenticated endpoint abused for resource exhaustion\".",
    "Requirement PAY-12 (High, Open) covers src/auth/webhook.ts: \"Verify Webhook Signatures\".",
    "Requirement PAY-15 (Critical, Open) covers src/auth/webhook.ts: \"Validate LLM tool calls\"."
  ],
  "truncated": false
}
```

### 5. `get-merge-attestation`

**Input:** `{"commitSha": "caf80f1cfbff47d603baeb761ba02338b0dedcd2", "issueKey": "PAY-7", "repo": "pranavsaji/threatline"}`

```json
{
  "issued": false,
  "blocking": [
    {
      "code": "open_requirement",
      "message": "8 open security requirement(s) at High or above."
    }
  ],
  "message": "Threatline blocks merging PAY-7: 8 open security requirement(s) at High or above."
}
```

Step 5 was not called in this run: the attestation blocked, and the prompt said to stop at a block. It was run as a separate call:

### 6. `posture-summary`

**Input:** `{"project": "PAY"}`

```json
{"openBySeverity":{"Low":0,"Medium":10,"High":21,"Critical":3},"byTeamComponent":[{"team":"Unassigned","component":"None","open":34,"maxSeverity":"Critical"}],"expiringIn14d":0,"topRiskyComponents":[{"component":"None","score":377}],"projects":["PAY"],"issuesCounted":3,"expiring":[],"hiddenExpiring":0,"truncated":false}
```

## The agent's final answer

## PAY-7 Threatline workflow results

**1. Open security requirements (11 open, 8 at High or above).** All 11 have to be Verified, or have a risk acceptance or Not Applicable status recorded, before PAY-7 can be Done:

| Sev | Subtask | Requirement | What must be true |
|---|---|---|---|
| Critical | PAY-15 | Validate LLM tool calls | Before calling Stripe, the server checks that the user owns the order and that it qualifies for a refund. It must not trust the LLM to do this. |
| High | PAY-12 | Verify webhook signatures | Every refund event on the public webhook has its Stripe signature header validated (ASVS V13.1.3). |
| High | PAY-8 | Account takeover | Credential-stuffing and brute-force controls are in place, and session tokens are verified on the backend. |
| High | PAY-18 | Agent goal hijack | Authorisation is enforced at a trusted service layer, and input is checked against an allow list. |
| High | PAY-17 | Payment amount or recipient tampering | Payment steps run in their fixed order, and amount, currency and recipient are checked against allowed values. |
| High | PAY-9 | PII exposed to unauthorised users | Access is checked per function, and no sensitive data goes in URLs or query strings. |
| High | PAY-10 | Over-privileged agent tools | Agent tools only run with explicit permissions, enforced on the server. |
| High | PAY-13 | Encrypt PII at rest | Transcript PII is encrypted and deleted after 90 days. |
| Medium | PAY-16, PAY-14, PAY-11 | Rate limiting and input size; TLS and data minimisation for third parties; protection against automated abuse | |

**2. Review.** Status is ready with a risk score of 100. The verdict is **block** because 8 requirements at High or above are still open. The most severe threat is **T-1, "Prompt injection to trigger unauthorized refunds" (Critical)**:
- **Attack:** a user writes chat messages that trick the LLM into calling the refund tool for orders they don't own, or for more than they're owed. The agent can refund up to $200 through Stripe.
- **Fix:** the server checks order ownership and refund eligibility itself before calling Stripe (PAY-15). Access must be restricted per function and authorisation enforced at a trusted service layer.
- **References:** CWE-94, CWE-269, ASVS V8.2.1 / V8.3.1 / V15.1.1, OWASP LLM01 and LLM06, Agentic ASI01 and ASI02.

**3. Change-risk check (`src/auth/webhook.ts`, `README.md`): would not pass.** The diff scores 60, with the signals "sensitive path" and "auth/crypto change". `src/auth/webhook.ts` is a sensitive file, so the merge needs a Threatline attestation. The change touches PAY-12, PAY-15, PAY-8, PAY-9 and PAY-11, all still Open.

**4. Merge attestation: blocked, no attestation issued.**
- `open_requirement`: 8 open security requirement(s) at High or above.

I didn't retry. You told me to stop at a block, so I **did not call posture-summary (step 5)**. I didn't call request-risk-acceptance either.

## Summary for the developer
You can't merge PAY-7 yet. The webhook change is the right place to close **PAY-12**: verify the `Stripe-Signature` header with the endpoint secret and Stripe's constructEvent, and reject the request if verification fails. Those requirements still won't clear, though, because the Threatline gate also counts the open requirements for the AI agent and data (PAY-15, 18, 10, 17, 9, 8, 13). Start with **PAY-15**, the Critical one: server-side ownership and eligibility checks before every refund tool call. Once each requirement is Verified, or a tech lead or security champion approves a risk acceptance in the Threatline panel, ask for the attestation again for the new head commit.

## What this run found (and what was fixed)

An earlier recording on the same day showed get-review returning `"state": "pass"` alongside 8 blocking requirements, and check-change-risk saying `wouldPass: true`. Meanwhile get-merge-attestation refused. The stored verdict was a break-glass override whose window had ended hours earlier, and nothing recomputed it. Commit `ba571eb` makes every reader of the stored verdict (the Done validator, the panel, the actions and the Confluence page) recompute a lapsed break-glass or warn-only verdict, and treat it as a block if that fails. This recording was made after that fix: all five tools agree.

