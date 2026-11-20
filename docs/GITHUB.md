# Redline merge gate for GitHub

The Redline GitHub Action does on GitHub what Redline for Bitbucket's merge check does on Bitbucket: a pull request
that touches security-sensitive files merges only with a valid Redline attestation for its head commit. Changes that
touch no sensitive paths pass freely. The decision code is shared with Bitbucket (`packages/core/src/merge-gate.ts`),
so both platforms give the same answer for the same change.

## Set it up (5 minutes)

1. In Jira, open **Redline admin → Signing keys** and copy the active public key. It is public: no secret is needed.
2. Add `.github/workflows/redline.yml` to the repository:

   ```yaml
   name: Redline
   on:
     pull_request:
       types: [opened, edited, synchronize, reopened]
   permissions:
     contents: read
     pull-requests: read
   jobs:
     merge-gate:
       runs-on: ubuntu-latest
       steps:
         # Pin to a full commit SHA from https://github.com/pranavsaji/redline/commits/main
         - uses: pranavsaji/redline/apps/github-action@main
           with:
             public-keys: |
               PASTE-THE-PUBLIC-KEY-HERE
   ```

3. In **Settings → Branches** (or Rules), require the **Redline / merge-gate** status check on your main branch.

`edited` is in the trigger list so that pasting an attestation into the description re-runs the check.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `public-keys` | (required) | Redline public keys, one per line. During a key rotation, list both. |
| `sensitive-paths` | none | Extra path globs, one per line, on top of Redline's defaults. |
| `diff-score-threshold` | `40` | A change scoring at or above this needs an attestation even outside sensitive paths. |
| `mode` | `block` | `warn` reports failures but passes, until `warn-until`. |
| `warn-until` | none | Required in warn mode: an ISO date at most 14 days away. After it, the check blocks again. |

The base branch's `.redline/policy.yml` can add sensitive paths and lower the threshold. It can never weaken them, and
an unreadable policy file makes every changed file count as sensitive.

## How a developer gets through the gate

1. Finish the work item's security requirements in Jira (or get a risk acceptance).
2. In the Redline panel, use **Merge attestation** with the repository as `owner/repository` and the pull request's
   head commit. An IDE agent can call `get-merge-attestation` over MCP instead.
3. Paste the attestation into the pull request description. Put the work item key in the title or branch name.

The check fails, saying exactly why, when the attestation is missing, for another commit or repository, for a
different work item than the one the pull request names, expired, or not signed by a listed key. It also fails closed
when GitHub cannot be read, when a text diff is too large for GitHub to return, or when the pull request changes more
than 3,000 files.
