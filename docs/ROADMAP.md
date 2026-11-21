# Roadmap

Ranked by how much each widens the gap between "a security checklist" and "security that ships with the code".

## Next

1. **Verification from CI.** Test names carry the requirement id (the test skeletons already do). The GitHub Action and
   Bitbucket Pipelines report which ones passed on the merge commit, and Threatline marks those requirements Verified
   with the CI run as evidence. No clicking: the gate closes itself when the tests prove the criteria.
2. **Does the pull request actually fix it?** The merge check reads the diff: did it touch the files the requirement
   points to, and add the tests its criteria imply? A "verified" requirement whose PR never touched the hinted code is
   flagged to a champion.
3. **Champion inbox.** One queue across projects for threats that need a person: grouped by "the verifier thinks this
   repeats X", with bulk confirm or dismiss and keyboard shortcuts. Cuts the champion's time per review to seconds.
4. **Incidents reopen reviews.** A Jira Service Management incident on a component re-opens the reviews of open work on
   that component, citing the incident, so the next story touching it cannot ship the same mistake.

## Later

5. **Teamwork Graph memory.** "This pattern was exploited in INC-42 in another project": similar past threats,
   incidents and accepted risks across the organisation, as context for every review.
6. **Data-flow diagrams.** Draw the components, stores and trust boundaries each review already extracts, as a diagram on
   the Confluence threat-model page and in the panel.
7. **Compliance evidence.** Map requirements, verifications and ledger entries to SOC 2, ISO 27001 and PCI DSS controls,
   and export an auditor-ready evidence pack per period.
8. **Fix suggestions.** For each requirement, a suggested patch and test from the repository's own code, proposed as a
   pull request, never merged by Threatline.
9. **Team-level learning.** Dismissals with reasons become per-team suppressions, so the same false positive is not
   raised twice; reviewed by a champion monthly.
10. **Marketplace listing**, with per-site model and budget controls.
