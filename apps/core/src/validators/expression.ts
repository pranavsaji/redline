/** Shown when a work item has no Redline verdict yet (EN-2: missing reviews block). */
export const NOT_REVIEWED_MESSAGE = 'Redline has not reviewed this work item yet. Open the Redline panel and click Run review.';
const BLOCKED_FALLBACK = 'Redline blocks this transition. Open the Redline panel on this work item to see why.';
const P = "issue.properties['redline.verdict']";

/**
 * The Done gate as a Jira expression: it reads only the precomputed `redline.verdict` property, so it is fast and no
 * text in the work item can change it. Fails closed: only `pass` and `warn` return true; a missing property, an unknown
 * state or a block returns a string, which Jira shows as the error. One line, single-quoted literals only (it sits in a
 * double-quoted YAML string in manifest.yml; a test keeps the two identical).
 */
export const VALIDATOR_EXPRESSION =
  `${P} == null ? '${NOT_REVIEWED_MESSAGE}' : (${P}.state == 'pass' || ${P}.state == 'warn' ? true : (${P}.message ?? '${BLOCKED_FALLBACK}'))`;
