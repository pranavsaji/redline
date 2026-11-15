import { describe, expect, it } from 'vitest';
import { diffBundles, threatDiff, threatsToReevaluate } from '../src/index.js';
import { threat } from './fixtures/verdict.js';

const f = (ari: string, version: string, id = `${ari}@${version}`) => ({ id, sourceAri: ari, version });

describe('incremental re-review', () => {
  const prev = [f('page/1', '1'), f('issue/1', '3'), f('page/2', '1')];
  const next = [f('page/1', '2'), f('issue/1', '3'), f('page/3', '1')];
  it('diffBundles reports changed, added and removed sources', () => {
    expect(diffBundles(prev, next)).toEqual({ changed: ['page/1'], added: ['page/3'], removed: ['page/2'] });
  });
  it('re-evaluates only threats citing changed or removed sources', () => {
    const keepT = threat({ id: 'a', citations: [{ factId: 'issue/1@3', quote: 'q' }] });
    const redoT = threat({ id: 'b', citations: [{ factId: 'page/1@1', quote: 'q' }] });
    const r = threatsToReevaluate([keepT, redoT], prev, diffBundles(prev, next));
    expect(r.keep.map((t) => t.id)).toEqual(['a']);
    expect(r.reevaluate.map((t) => t.id)).toEqual(['b']);
  });
  it('threatDiff reports added, removed and changed threats', () => {
    const a = threat({ id: 'a', title: 'Refund abuse', stride: 'Tampering' });
    const b = threat({ id: 'b', title: 'Transcript leak', stride: 'InformationDisclosure' });
    const c = threat({ id: 'c', title: 'Prompt injection hijack', stride: 'ElevationOfPrivilege' });
    const d = threat({ id: 'd', title: 'Upload runs code', stride: 'ElevationOfPrivilege', component: 'upload' });
    const r = threatDiff([a, b], [{ ...a, id: 'a2', severity: 'Critical' }, c, d]);
    expect(r.added.map((t) => t.id)).toEqual(['c', 'd']);
    expect(r.removed.map((t) => t.id)).toEqual(['b']);
    expect(r.changed).toHaveLength(1);
    expect(r.unchanged).toEqual([]);
  });
});
