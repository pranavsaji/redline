import type { AgentThreat, Stride } from '@threatline/shared';

const TEMPLATES: Record<Stride, (c: string) => string> = {
  Spoofing: (c) => `Someone could pretend to be a legitimate user or service of the ${c}.`,
  Tampering: (c) => `Someone could change data or actions in the ${c} that they should not be able to change.`,
  Repudiation: (c) => `Someone could do something harmful in the ${c} and there would be no reliable record of who did it.`,
  InformationDisclosure: (c) => `Someone could read data from the ${c} that they should not see.`,
  DenialOfService: (c) => `Someone could overload the ${c} so real users cannot use it.`,
  ElevationOfPrivilege: (c) => `Someone could make the ${c} do things beyond what they are allowed to do.`,
};

/** Plain language first, jargon second: used when the agent gave no plainLanguage line. */
export function plainLanguageFor(t: Pick<AgentThreat, 'stride' | 'component' | 'plainLanguage'>): string {
  if (t.plainLanguage && t.plainLanguage.trim()) return t.plainLanguage.trim();
  return TEMPLATES[t.stride](t.component.trim() || 'system');
}
