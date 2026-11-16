# Jira Automation rule: Redline security review

Jira Automation cannot export a rule that uses "Use agent" as JSON, so this is the rule's definition.

- **Name:** Redline: security review on create (3 agent runs)
- **Scope:** the projects listed in Redline's enabled projects
- **Trigger:** Work item created. Optionally add a second rule with trigger "Field value changed: Labels" and the condition labels contains `redline-review` (re-run).
- **Actions:** three identical "Use agent" steps. The number of steps equals the policy's `agentSamples`.
  - Agent: **Redline**
  - **Let this agent take actions:** on. Without it the agent cannot call `submit-threat-model`.
  - Prompt, the same text as `automationPrompt('{{issue.key}}')` in `packages/prompts/src/agent.ts`:

```
Review {{issue.key}}. Call get-review-context with issueKey "{{issue.key}}". Build the JSON threat model described in your instructions, with "issueKey": "{{issue.key}}". Then call submit-threat-model with issueKey "{{issue.key}}", the submissionToken from get-review-context, and threatModelJson set to that JSON object as a string. If you cannot call actions, output only the JSON object.
```

Each agent run uses the site's Rovo credits. If the last three runs come back empty, Redline treats the credits as used up. It then pauses reviews and blocks with `budget_paused` until a champion confirms.
