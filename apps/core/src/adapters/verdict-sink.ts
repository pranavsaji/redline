import type { VerdictSink } from '@redline/core';
import type { JiraClient } from './jira.js';

export const VERDICT_PROPERTY = 'redline.verdict';

/** Writes the verdict to the issue property the Done-gate validator expression reads. */
export function jiraVerdictSink(jira: JiraClient): VerdictSink {
  return { write: (issueId, v) => jira.setProperty(issueId, VERDICT_PROPERTY, v) };
}
