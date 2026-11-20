// Relationships: "Jira work item links external commit" and "External pull request has external commit".
MATCH (w:JiraWorkItem {ari: $issueAri})-[:jira_work_item_links_external_commit]->(:ExternalCommit)<-[:external_pull_request_has_external_commit]-(pr:ExternalPullRequest)
RETURN DISTINCT pr
