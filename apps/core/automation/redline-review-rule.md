# Jira Automation rule: Threatline security review

Jira Automation cannot export a rule that uses "Use agent" as JSON, so this is the rule's definition.

- **Name:** Threatline: security review on create (3 agent runs)
- **Scope:** the projects listed in Threatline's enabled projects
- **Trigger:** Work item created, with the condition **Issue Type is one of** the policy's `reviewIssueTypes` (Story, Epic). Without it the rule also runs the agent three times for every sub-task, bug or incident created in the project, spending Rovo credits on items Threatline does not review (seen live: creating 11 requirement sub-tasks fired it 11 times).
- **Re-run rule (second rule, same actions):** trigger "Field value changed: Labels" (change type: value added), condition "Labels contains `redline-review`". The panel's "Re-run review" removes the label if it is already there and adds it again, so the rule fires on every re-run. Without this rule a re-run opens a revision that no agent fills, and it times out after `agentTimeoutMinutes`.
- **Actions:** three identical "Use agent" steps. The number of steps equals the policy's `agentSamples`.
  - Agent: **Threatline**
  - **Let this agent take actions:** on. Without it the agent cannot call `submit-threat-model`.
  - Prompt, the same text as `automationPrompt('{{issue.key}}')` in `packages/prompts/src/agent.ts`:

```
Review {{issue.key}}. Call get-review-context with issueKey "{{issue.key}}". Build the JSON threat model described in your instructions, with "issueKey": "{{issue.key}}". Then call submit-threat-model with issueKey "{{issue.key}}", the submissionToken from get-review-context, and threatModelJson set to that JSON object as a string. If you cannot call actions, output only the JSON object.
```

Each agent run uses the site's Rovo credits. If the last three runs come back empty, Threatline treats the credits as used up. It then pauses reviews and blocks with `budget_paused` until a champion confirms.
