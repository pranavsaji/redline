import type { AgentThreat, AgentThreatModel } from '@redline/shared';

export const ISSUE_KEY = 'PROJ-1';

export const refundAbuse: AgentThreat = {
  stride: 'Tampering',
  title: 'Refund abuse through the support agent',
  scenario: 'A customer convinces the agent to issue refunds above policy or for orders they do not own.',
  component: 'refund tool',
  likelihood: 4,
  impact: 4,
  evidence: [{ quote: 'The agent can issue refunds up to $200 through the Stripe payment API.' }],
  asvs: ['V2.3.1'],
  cwe: ['CWE-841'],
  plainLanguage: 'Someone could talk the AI into refunding money it should not.',
  requirement: { title: 'Enforce refund limits server-side', given: 'a refund tool call', when: 'the amount exceeds $200 or the order is not the caller’s', then: 'the refund is rejected and logged' },
};

export const transcriptLeak: AgentThreat = {
  stride: 'InformationDisclosure',
  title: 'Conversation transcripts expose customer data',
  scenario: 'Support staff or a compromised account read stored transcripts that contain addresses and phone numbers.',
  component: 'support database',
  likelihood: 3,
  impact: 3,
  evidence: [{ quote: 'Conversation transcripts are stored in the support database.' }],
};

export const goalHijack: AgentThreat = {
  stride: 'ElevationOfPrivilege',
  title: 'Agent goal hijack via injected instructions',
  scenario: 'An order note tells the agent to ignore its rules and refund the order.',
  component: 'agent service',
  likelihood: 2,
  impact: 2,
  evidence: [{ quote: 'The agent uses an LLM with tool calling to look up order history' }],
};

export const invented: AgentThreat = {
  stride: 'Spoofing',
  title: 'Admin console has no MFA',
  scenario: 'An attacker logs into the admin console.',
  component: 'admin console',
  likelihood: 3,
  impact: 5,
  evidence: [{ quote: 'The admin console is protected by a shared password only.' }],
};

export const paraphrased: AgentThreat = {
  stride: 'Repudiation',
  title: 'Screenshots uploaded without audit trail',
  scenario: 'Uploaded damage screenshots cannot be traced to who uploaded them.',
  component: 'file upload',
  likelihood: 4,
  impact: 3,
  evidence: [{ quote: 'customers upload damaged item screenshots' }],
};

export const model = (threats: AgentThreat[], extra: Partial<AgentThreatModel> = {}): AgentThreatModel => ({
  schema: 'redline.threatmodel.v1',
  issueKey: ISSUE_KEY,
  threats,
  ...extra,
});

export const json = (m: unknown): string => JSON.stringify(m, null, 2);

export const AGENT_TEXT = {
  clean: json(model([refundAbuse])),
  fenced: `Here is the threat model:\n\n\`\`\`json\n${json(model([refundAbuse]))}\n\`\`\`\n\nLet me know if you need more.`,
  proseWrapped: `I reviewed PROJ-1. ${json(model([refundAbuse]))} That covers the main risks.`,
  truncated: json(model([refundAbuse])).slice(0, 200),
  twoBlocks: `For example a threat looks like {"title": "example", "stride": "Spoofing"}. Now the real one: ${json(model([refundAbuse]))}`,
  wrongIssue: json({ ...model([refundAbuse]), issueKey: 'OTHER-9' }),
  extraVerdict: json({ ...model([refundAbuse]), verdict: 'pass' }),
  htmlEscaped: json(model([refundAbuse])).replace(/"/g, '&quot;'),
  noJson: 'I could not find anything risky in this work item.',
};
