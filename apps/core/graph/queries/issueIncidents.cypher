// Relationship: "JSM incident links Jira work item".
MATCH (i:JsmIncident)-[:jsm_incident_links_jira_work_item]->(w:JiraWorkItem {ari: $issueAri})
RETURN i
