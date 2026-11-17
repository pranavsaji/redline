import { severityRank, type Requirement, type Severity } from '@redline/shared';
import type { CoreDeps } from '../deps.js';
import { panelGet } from '../resolvers/panel.js';
import type { ActionPayload } from './common.js';
import { callerOnIssue, fitJson, issueUrl, parseInput, SCHEMAS, type ActionError } from './schemas.js';

export interface RequirementDto {
  id: string;
  subtaskKey?: string;
  title: string;
  severity: Severity;
  status: Requirement['status'];
  acceptanceCriteria: string[];
  asvsIds: string[];
  fileHints: string[];
}

export interface GetRequirementsResult {
  issueKey: string;
  panelUrl: string;
  requirements: RequirementDto[];
  hiddenRequirements: number;
  truncated: boolean;
}

export const toRequirementDto = (r: Requirement): RequirementDto => ({
  id: r.id,
  ...(r.subtaskKey ? { subtaskKey: r.subtaskKey } : {}),
  title: r.title,
  severity: r.severity,
  status: r.status,
  acceptanceCriteria: r.criteria.map((c) => `Given ${c.given}, when ${c.when}, then ${c.then}`),
  asvsIds: r.asvsIds,
  fileHints: r.fileHints ?? [],
});

const OPEN_FIRST: Record<Requirement['status'], number> = { Open: 0, InProgress: 1, AcceptedRisk: 2, Verified: 3, NotApplicable: 4 };

/** GET (Agent, skill, MCP): the security requirements this caller may see, open and most severe first. */
export async function getSecurityRequirements(payload: ActionPayload & Record<string, unknown>, deps: CoreDeps): Promise<GetRequirementsResult | ActionError> {
  const input = parseInput(SCHEMAS.getSecurityRequirements, payload);
  if (!input.ok) return input.error;
  const who = await callerOnIssue(deps, payload, input.value.issueKey, 'browse');
  if (!who.ok) return who.error;
  const panel = await panelGet(deps, who.viewer);
  if ('error' in panel) return { error: panel.error };
  const status = input.value.status;
  const requirements = panel.requirements
    .filter((r) => !status || r.status === status)
    .sort((a, b) => OPEN_FIRST[a.status] - OPEN_FIRST[b.status] || severityRank(b.severity) - severityRank(a.severity) || a.title.localeCompare(b.title))
    .map(toRequirementDto);
  return fitJson({ issueKey: panel.issueKey, panelUrl: await issueUrl(deps, panel.issueKey), requirements, hiddenRequirements: panel.hiddenRequirements }, ['requirements']);
}
