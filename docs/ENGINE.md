# Redline Engine

Redline Engine is how Redline reviews a work item by itself, on Atlassian-hosted Claude models (Forge LLMs). It is the
default for new sites. It needs no Rovo agent, no Automation rule and no setup, and a developer cannot write their own
work item's review: nothing outside Redline submits to it.

## The pipeline

Each stage is its own queue job, so every model call fits a function timeout and a redelivered job resumes from a
checkpoint instead of paying twice.

| Stage | Model tier | Reads | Produces |
| --- | --- | --- | --- |
| 1. Gather | none | the work item, linked pages, incidents, parent and children (scoped to who triggered it) | facts, each with a source, trust level and injection flag |
| 2. Extract (quarantined) | balanced (`claude-sonnet-5`, falling back to `claude-sonnet-4-6`) | the untrusted text, fenced with a random nonce | a typed architecture sketch and evidence items that quote the facts verbatim. Sketch strings that read like instructions are dropped and flag injection |
| 3. Propose ×3, in parallel | deep (`claude-opus-5`, falling back through `claude-opus-4-8`, `-4-7`, `-4-6`) | only the typed sketch, evidence ids and trusted metadata, never raw untrusted text; each run starts from a different lens (data stores, trust boundaries, users, external services, worst outcome) | three independent threat lists, each threat citing evidence ids |
| 4. Assemble (deterministic) | none | the three runs | consensus (a threat needs a majority of runs), quotes checked word for word against the sources, the rule-based floor, coverage, severity and STRIDE/ASVS/CWE mappings, the risk score |
| 5. Verify (adversarial) | deep | each accepted AI threat with the quotes it rests on, fenced as data | keep or drop, with a reason |

Code decides what a verifier verdict does:

- A kept threat is marked **Verified** in the panel.
- A dropped Medium or Low threat is dismissed, with the verifier's reason recorded on it. An untouched requirement it
  had is removed.
- A High or Critical threat the verifier doubts goes to a **security champion**. It never just disappears.
- Rule-based threats are never sent to the verifier. One that a dropped AI threat covered becomes active again, with
  its requirement.
- When injection is suspected anywhere in the material, the verifier does not run. A threat citing a flagged source is
  never demoted.

Model errors become failed runs, so a review whose model never answers settles as failed and the gate blocks (AI
errors count as missing). A failed verification leaves the review as assembled, which is stricter, never looser.

## Cost and limits

Forge LLM calls are billed to the app's developer, not to the site. Each review records its tokens and models; the
admin page shows the month's tokens under **Budgets**, where the per-review token caps and the monthly review cap
(500 by default) live. Choosing Redline Engine lifts per-review caps below 400,000 input and 60,000 output tokens to
those values. The adapter logs model, tokens and timing for every call, never prompt or reply text.

## Measuring it

`pnpm redline eval --llm claude-code --path pipeline` runs the same five stages offline through `claude -p` and scores
them like the agent path; recordings live in `evals/results/recorded-engine/` and `judged-engine/`, so the agent path's
CI gate is never overwritten. The in-product verifier uses its own rubric (does the quoted evidence support the
threat?), not the offline judge's, so judged precision is not the product grading itself.
