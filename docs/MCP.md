# Threatline for coding agents (MCP)

The gate is only fair if the people (and agents) writing the code can see what it will check. Threatline's MCP server
gives Claude Code, Cursor or any MCP client the same security requirements the Done gate and the merge check enforce,
as the signed-in user, with that user's Jira permissions.

## Tools

| Tool | What it does |
| --- | --- |
| `get-security-requirements` | A work item's requirements: Given/When/Then criteria, ASVS ids, status, fix-by date, file hints, and (with `testLanguage`) a test skeleton with one failing test per criterion. |
| `check-change-risk` | Given changed paths, says whether the merge check would pass and why not. |
| `get-merge-attestation` | Signs an attestation for one repository and one head commit, when the work item's verdict allows it. |
| `verify-requirement` | Marks one requirement Verified with the pull request as evidence, as the caller, ledgered as made through an agent. |
| `request-risk-acceptance` | Records a pending risk acceptance; a person must approve it in Jira. |
| `get-review`, `explain-threat` | The cited threat model, and any threat explained in plain language. |
| `posture-summary` | Open requirements by severity and acceptances that expire soon. |

What an agent can never do: approve or reject an acceptance, dismiss a threat, mark anything Not applicable, override
the gate, or write its own review. Those stay with people, and every one is in the ledger.

## Connect Claude Code

```sh
claude mcp add --transport http threatline https://mcp.atlassian.com/forge/13898a7c-6897-48d3-a512-079d9f9f5f00
```

Sign in at the Atlassian consent screen and pick the site. A site admin allows the client under Atlassian
Administration → Rovo → MCP server. Add the [skill](../mcp-skill/skill.md) so the agent follows the workflow below.

## The loop, as it ran

Asked "fix the open security requirements on PAY-7 before I open the PR", Claude Code first called:

```text
get-security-requirements(issueKey: "PAY-7", status: "Open")
```

and got back (abridged; real output from the demo site):

```json
{
  "issueKey": "PAY-7",
  "requirements": [
    {
      "subtaskKey": "PAY-15", "title": "Validate LLM tool calls", "severity": "Critical", "status": "Open",
      "acceptanceCriteria": ["Given a user interaction with the AI agent, when the LLM attempts to call the refund tool, then the system must independently verify the user's ownership of the order and the refund eligibility before calling the Stripe API."],
      "asvsIds": ["V15.1.1", "V8.2.1", "V8.3.1"],
      "fileHints": ["**/refund*", "**/agent*/**", "**/tools/**"]
    },
    { "subtaskKey": "PAY-12", "title": "Verify Webhook Signatures", "severity": "High", "status": "Open", "asvsIds": ["V13.1.3"] }
  ]
}
```

It then:

1. wrote the ownership check where the file hints pointed, plus one test per acceptance criterion
   (`testLanguage: "typescript"` gives the skeleton);
2. called `check-change-risk` with the changed paths, to see whether the merge check would pass;
3. once the pull request was open and green, called `verify-requirement` with the requirement id and the PR link. The
   answer says what still blocks Done;
4. called `get-merge-attestation` for the repository and the head commit, and put the snippet in the PR description.

The merge check then passes for that exact commit, and fails if one character changes.

## Why this matters

Security requirements usually reach developers as a ticket comment after the code is written. Here the agent that writes
the code reads them first, writes the tests the criteria imply, and leaves an audit trail (ledger entry, PR evidence,
signed attestation) that a security champion can check without re-reviewing the change.
