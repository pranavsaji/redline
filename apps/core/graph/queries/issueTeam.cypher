// Relationship: "Atlassian team assigned Jira work item".
MATCH (t:AtlassianTeam)-[:atlassian_team_assigned_jira_work_item]->(w:JiraWorkItem {ari: $issueAri})
RETURN t
