import { describe, expect, it } from 'vitest';
import { fitProposal, ProposalSchema } from '../src/index.js';

describe('fitProposal (strong models write long)', () => {
  it('trims wording, caps lists, drops unknown keys and reads numeric strings, so a sound proposal validates', () => {
    const raw = {
      threats: Array.from({ length: 30 }, (_, n) => ({
        id: `T${n}`,
        severity: 'High',
        stride: 'Tampering',
        title: 'x'.repeat(200),
        scenario: 'y'.repeat(900),
        component: 'z'.repeat(100),
        likelihood: '4',
        impact: 7,
        evidenceIds: ['E1', 'E2', 'E3', 'E4'],
        cwe: ['CWE-639', 'C'.repeat(40)],
        requirement: { title: 't'.repeat(300), given: 'g', when: 'w', then: 'h' },
      })),
    };
    const fitted = fitProposal(raw);
    const v = ProposalSchema.safeParse(fitted);
    expect(v.success).toBe(true);
    if (!v.success) return;
    expect(v.data.threats).toHaveLength(25);
    expect(v.data.threats[0]).toMatchObject({ likelihood: 4, impact: 5, evidenceIds: ['E1', 'E2', 'E3'], cwe: ['CWE-639'] });
    expect(v.data.threats[0]!.title.length).toBe(120);
  });

  it('does not invent what is missing: a threat with no evidence still fails', () => {
    expect(ProposalSchema.safeParse(fitProposal({ threats: [{ stride: 'Tampering', title: 't', scenario: 's', component: 'c', likelihood: 3, impact: 3, evidenceIds: [] }] })).success).toBe(false);
    expect(fitProposal('not an object')).toBe('not an object');
  });
});
