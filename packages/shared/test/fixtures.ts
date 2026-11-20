export const fact = {
  id: 'fact_1',
  sourceAri: 'ari:cloud:jira::issue/10001',
  sourceType: 'jira_issue',
  title: 'PROJ-1 Add AI support agent',
  url: 'https://example.atlassian.net/browse/PROJ-1',
  excerpt: 'The agent reads order history containing email addresses.',
  trustLevel: 'untrusted',
  version: '3',
  injectionSuspected: false,
  injectionReasons: [],
  origin: 'rest',
} as const;

export const threat = {
  id: 'thr_1',
  reviewId: 'rev_1',
  stride: 'InformationDisclosure',
  title: 'Personal data exposed to unauthorised users',
  scenario: 'An attacker asks the agent for another customer order.',
  component: 'agent service',
  likelihood: 3,
  impact: 4,
  severity: 'High',
  votes: 3,
  samples: 3,
  grounding: 'supported',
  confidence: 1,
  state: 'accepted',
  origin: 'agent',
  citations: [{ factId: 'fact_1', quote: 'order history containing email addresses' }],
  mappings: [{ framework: 'ASVS5', refId: 'V8.2.1' }],
  plainLanguage: 'Someone could read another customer’s orders.',
};

export const agentThreat = {
  stride: 'Spoofing',
  title: 'Agent goal hijack',
  scenario: 'Injected text redirects the agent.',
  component: 'agent service',
  likelihood: 4,
  impact: 4,
  evidence: [{ quote: 'tool calling' }],
};

export const attestation = {
  v: 1,
  kid: 'abcdef0123456789',
  issueKey: 'PROJ-142',
  repo: 'acme/shop',
  commitSha: 'a'.repeat(40),
  verdict: 'pass',
  requirements: [{ id: 'req_1', status: 'Verified' }],
  iat: 1_700_000_000,
  exp: 1_700_086_400,
  nonce: 'n0nce',
};

export const sketch = {
  components: ['chat widget', 'agent service'],
  dataStores: ['orders db'],
  externalServices: ['payment provider'],
  trustBoundaries: ['internet → chat widget'],
  flows: [{ from: 'chat widget', to: 'agent service', data: 'messages' }],
  dataClasses: ['pii'],
  exposure: 'public',
  llmFeatures: true,
  injectionSuspected: false,
};
