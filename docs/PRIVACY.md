# Threatline privacy policy

Last updated: 2026-11-21

Threatline for Jira and Threatline for Bitbucket ("Threatline") are Forge apps published by Pranav Saji. This policy explains
what Threatline processes, where, and for how long.

## What Threatline processes

- **Jira work items** you enable Threatline for: key, type, status, project, components, fix versions, summary,
  description, comments, parent, child and linked work items, and related incidents.
- **Confluence pages** linked from those work items, and pages Threatline publishes (threat models, digests, ledger
  tree heads).
- **Atlassian account IDs** of people who act in Threatline (reviewers, approvers, requesters), and group names you set
  as Threatline roles.
- **Bitbucket pull request metadata** for repositories where the merge check is enabled: the source commit, changed
  file paths and counts, and the pull request description (to find an attestation).
- **Threatline's own records**: threat models, requirements, evidence links, risk acceptances, attestations and the risk
  ledger.

Threatline does not collect payment data, does not use cookies or analytics, and does not sell or share data.

## Where it is processed

Everything runs on Atlassian's Forge platform. Neither app declares egress, so Threatline sends no data outside Atlassian.
Stored data lives in Forge-hosted storage (Forge SQL, Key-Value Store and secret storage) and follows Atlassian's data
residency for your site. The threat model is written inside Atlassian: by default on Atlassian-hosted models (Forge LLMs), or
by your site's Rovo agent under your site's Rovo terms if you choose that mode. Before text reaches a model, Threatline caps
excerpts and redacts strings that look like secrets.

Logs record ids, timings and counts only; never work item text, page text or prompts.

## Who can see it

Threatline shows a review only to people who can see the work item, and leaves out any source (page, incident, linked work
item) a viewer cannot open. Admin pages are limited to Jira administrators.

## Retention and deletion

- Reviews, gathered context and threat models: 400 days, then purged automatically.
- The risk ledger and attestation records: for the life of the installation, because they are an audit trail.
- Uninstalling Threatline removes its stored data according to Atlassian's Forge rules for app storage.
- On the admin page, an administrator can export a project's evidence pack (Risk ledger) and, once Threatline is turned
  off for a project, purge its reviews, gathered text and requirements (Data retention). Purges are recorded in the
  ledger; the ledger itself is kept.

## Contact

Questions or requests: [pranavs.mec@gmail.com](mailto:pranavs.mec@gmail.com).
