// Relationship: "Jira work item links external commit". Names follow the docs' snake_case convention; registration validates them.
MATCH (w:JiraWorkItem {ari: $issueAri})-[:jira_work_item_links_external_commit]->(c:ExternalCommit)
RETURN c
