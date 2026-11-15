import type { AgentThreat } from '@redline/shared';
import type { Signals } from '../context/signals.js';

interface Rule {
  when: (s: Signals) => string | undefined; // returns the evidence key that triggered the rule
  threat: Omit<AgentThreat, 'evidence'>;
}

/** Deterministic STRIDE threats derived from bundle signals. They always run, so a failed or poisoned agent run still leaves a cited review. */
const RULES: Rule[] = [
  {
    when: (s) => (s.auth ? 'auth' : undefined),
    threat: {
      stride: 'Spoofing', title: 'Account takeover through weak authentication', component: 'authentication',
      scenario: 'An attacker reuses stolen or guessed credentials or a leaked session token to act as a customer.',
      likelihood: 3, impact: 4, asvs: ['V6.3.1', 'V7.2.1'], cwe: ['CWE-287'],
      plainLanguage: 'Someone could log in as a customer using a stolen password or session.',
    },
  },
  {
    when: (s) => (s.dataClasses.includes('pii') ? 'pii' : undefined),
    threat: {
      stride: 'InformationDisclosure', title: 'Personal data exposed to unauthorised users', component: 'customer data',
      scenario: 'A user or automated client requests records that belong to another customer and receives their personal data.',
      likelihood: 3, impact: 4, asvs: ['V8.2.1', 'V14.2.1'], cwe: ['CWE-359', 'CWE-639'],
      plainLanguage: 'Someone could see another customer’s personal details.',
    },
  },
  {
    when: (s) => (s.payment ? 'payment' : undefined),
    threat: {
      stride: 'Tampering', title: 'Payment amount or recipient manipulated', component: 'payment flow',
      scenario: 'An attacker alters the amount, currency or recipient of a payment or refund between request and execution.',
      likelihood: 3, impact: 5, asvs: ['V2.3.1', 'V2.2.1'], cwe: ['CWE-841'],
      plainLanguage: 'Someone could change how much money moves, or where it goes.',
    },
  },
  {
    when: (s) => (s.dataClasses.includes('credentials') ? 'credentials' : s.dataClasses.includes('secrets') ? 'secrets' : undefined),
    threat: {
      stride: 'InformationDisclosure', title: 'Credentials or secrets leaked', component: 'secret storage',
      scenario: 'Passwords, API keys or signing keys end up in code, logs, prompts or responses where attackers can read them.',
      likelihood: 3, impact: 4, asvs: ['V13.3.1', 'V6.2.1'], cwe: ['CWE-798', 'CWE-522'],
      plainLanguage: 'Someone could find a password or key and use it to get in.',
    },
  },
  {
    when: (s) => (s.fileUpload ? 'fileUpload' : undefined),
    threat: {
      stride: 'ElevationOfPrivilege', title: 'Malicious file upload executes code', component: 'file upload',
      scenario: 'An uploaded file with a dangerous type or crafted content is processed or served in a way that runs attacker code.',
      likelihood: 2, impact: 4, asvs: ['V5.2.1', 'V5.3.1'], cwe: ['CWE-434'],
      plainLanguage: 'Someone could upload a harmful file that runs on our servers or in other users’ browsers.',
    },
  },
  {
    when: (s) => (s.exposure === 'public' ? 'exposure' : undefined),
    threat: {
      stride: 'DenialOfService', title: 'Unauthenticated endpoint abused for resource exhaustion', component: 'public endpoint',
      scenario: 'Automated clients flood the internet-facing endpoint, exhausting compute, rate limits or paid downstream calls.',
      likelihood: 3, impact: 3, asvs: ['V2.4.1'], cwe: ['CWE-770', 'CWE-400'],
      plainLanguage: 'Someone could flood the public endpoint so real customers can’t use it, and run up our costs.',
    },
  },
  {
    when: (s) => (s.llmFeatures ? 'llmFeatures' : undefined),
    threat: {
      stride: 'ElevationOfPrivilege', title: 'Agent goal hijack through injected instructions', component: 'AI agent',
      scenario: 'Text the agent reads (a chat message, order note, page or tool result) contains instructions that redirect it to act for the attacker (prompt injection).',
      likelihood: 4, impact: 4, asvs: ['V8.3.1', 'V2.2.1'], cwe: ['CWE-1427'],
      plainLanguage: 'Someone could slip instructions into what the AI reads and make it work for them.',
    },
  },
  {
    when: (s) => (s.llmFeatures ? 'llmFeatures' : undefined),
    threat: {
      stride: 'Tampering', title: 'Tool misuse by an over-privileged agent', component: 'AI agent tools',
      scenario: 'The agent calls a tool (for example refunds or data lookups) with attacker-chosen arguments or beyond what the user is allowed to do.',
      likelihood: 3, impact: 4, asvs: ['V8.2.1', 'V8.3.1'], cwe: ['CWE-250', 'CWE-1426'],
      plainLanguage: 'The AI could be tricked into using its tools, like refunds, in ways nobody intended.',
    },
  },
  {
    when: (s) => (s.thirdParty.length > 0 ? `thirdParty:${s.thirdParty[0]}` : undefined),
    threat: {
      stride: 'InformationDisclosure', title: 'Sensitive data sent to a third-party service', component: 'third-party integration',
      scenario: 'Customer data is passed to an external provider without minimisation, contract controls or encryption in transit.',
      likelihood: 2, impact: 3, asvs: ['V12.2.1', 'V14.2.1'], cwe: ['CWE-200'],
      plainLanguage: 'Customer data could leave our systems and be exposed by another company.',
    },
  },
];

export function baselineThreats(signals: Signals): AgentThreat[] {
  const out: AgentThreat[] = [];
  for (const rule of RULES) {
    const key = rule.when(signals);
    const ev = key ? signals.evidence[key] : undefined;
    if (ev) out.push({ ...rule.threat, evidence: [{ quote: ev.quote }] });
  }
  return out;
}
