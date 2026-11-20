import type { Severity } from '@redline/shared';

/** likelihood x impact: >= 20 Critical, >= 12 High, >= 6 Medium, else Low. */
export function severityOf(likelihood: number, impact: number): Severity {
  const p = likelihood * impact;
  if (p >= 20) return 'Critical';
  if (p >= 12) return 'High';
  if (p >= 6) return 'Medium';
  return 'Low';
}
