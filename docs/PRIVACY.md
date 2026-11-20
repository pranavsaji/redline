# Redline privacy policy

Last updated: 2026-11-21

Redline for Jira and Redline for Bitbucket ("Redline") are Forge apps published by Pranav Saji. This policy explains
what Redline processes, where, and for how long.

## What Redline processes

- **Jira work items** you enable Redline for: key, type, status, project, components, fix versions, summary,
  description, comments, parent, child and linked work items, and related incidents.
- **Confluence pages** linked from those work items, and pages Redline publishes (threat models, digests, ledger
  tree heads).
- **Atlassian account IDs** of people who act in Redline (reviewers, approvers, requesters), and group names you set
  as Redline roles.
- **Bitbucket pull request metadata** for repositories where the merge check is enabled: the source commit, changed
  file paths and counts, and the pull request description (to find an attestation).
- **Redline's own records**: threat models, requirements, evidence links, risk acceptances, attestations and the risk
  ledger.

Redline does not collect payment data, does not use cookies or analytics, and does not sell or share data.

## Where it is processed

Everything runs on Atlassian's Forge platform. Neither app declares egress, so Redline sends no data outside Atlassian.
Stored data lives in Forge-hosted storage (Forge SQL, Key-Value Store and secret storage) and follows Atlassian's data
residency for your site. The threat model is written inside Atlassian: by default on Atlassian-hosted models (Forge LLMs), or
by your site's Rovo agent under your site's Rovo terms if you choose that mode. Before text reaches a model, Redline caps
excerpts and redacts strings that look like secrets.

Logs record ids, timings and counts only; never work item text, page text or prompts.

## Who can see it

Redline shows a review only to people who can see the work item, and leaves out any source (page, incident, linked work
item) a viewer cannot open. Admin pages are limited to Jira administrators.

## Retention and deletion

- Reviews, gathered context and threat models: 400 days, then purged automatically.
- The risk ledger and attestation records: for the life of the installation, because they are an audit trail.
- Uninstalling Redline removes its stored data according to Atlassian's Forge rules for app storage.
- On the admin page, an administrator can export a project's evidence pack (Risk ledger) and, once Redline is turned
  off for a project, purge its reviews, gathered text and requirements (Data retention). Purges are recorded in the
  ledger; the ledger itself is kept.

## Contact

Questions or requests: [pranavs.mec@gmail.com](mailto:pranavs.mec@gmail.com).
