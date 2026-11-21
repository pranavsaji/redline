import { canonicalJson } from '@threatline/shared';
import { sha256Hex } from '@threatline/crypto';
import type { ContextFact } from '@threatline/shared';

/** SHA-256 over the sorted (sourceAri, version) pairs: changes exactly when a source is added, removed or edited. */
export function contextHash(facts: ReadonlyArray<Pick<ContextFact, 'sourceAri' | 'version'>>): string {
  const pairs = facts.map((f) => [f.sourceAri, f.version] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return sha256Hex(canonicalJson(pairs));
}
