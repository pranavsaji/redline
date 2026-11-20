// Marketplace listing screenshots (Task 32): 5 per listing, from the mock-bridge previews, into docs/screenshots/.
//
//   pnpm --filter @redline/core-ui dev --port 5179 & pnpm --filter @redline/bitbucket-ui dev --port 5180 &
//   pnpm exec tsx scripts/listing-screenshots.ts
//
// The Bitbucket attestation shots use a throwaway key pair generated here, so the browser really verifies a signature;
// no key is stored. Every value shown comes from the fixtures in apps/core/ui/src/fixtures.ts.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodeAttestation, generateKeyPair } from '../packages/crypto/src/index.js';
// @ts-expect-error plain ESM script without types
import { capture, launch } from './layout-audit.mjs';

const CORE = process.env.CORE_URL ?? 'http://localhost:5179/';
const BB = process.env.BB_URL ?? 'http://localhost:5180/';
const OUT = join(process.cwd(), 'docs/screenshots');

const key = generateKeyPair();
const now = Math.floor(Date.now() / 1000);
const token = encodeAttestation(
  {
    v: 1,
    kid: key.kid,
    issueKey: 'PAY-6',
    repo: 'acme/payments',
    commitSha: '3f9c2a7d1e0b4c6a8f5d2e1b0a9c8d7e6f5a4b3c',
    verdict: 'pass',
    requirements: [
      { id: 'req_1', status: 'Verified' },
      { id: 'req_2', status: 'Verified' },
    ],
    iat: now - 60,
    exp: now + 24 * 3600,
    nonce: 'listing01',
  },
  key,
);
const tampered = token.slice(0, 40) + (token[40] === 'A' ? 'B' : 'A') + token.slice(41);
const KEYS = 'form[aria-label="Redline settings"] textarea';
const PASTE = 'form[aria-label="Test an attestation"] textarea';

const SHOTS = [
  // Redline for Jira (Core, with Confluence)
  { file: 'jira-1-issue-panel.png', url: `${CORE}?state=ready`, theme: 'light', width: 760, maxHeight: 1100 },
  { file: 'jira-2-threat-evidence.png', url: `${CORE}?state=ready`, theme: 'dark', width: 760, maxHeight: 1100, steps: [{ click: 'Details' }, { click: 'Explain like I’m new to security' }] },
  { file: 'jira-3-accept-risk.png', url: `${CORE}?state=ready`, theme: 'light', width: 760, maxHeight: 1200, steps: [{ click: 'Requirements (2)' }, { click: 'Accept risk' }] },
  { file: 'jira-4-posture-dashboard.png', url: `${CORE}?view=posture`, theme: 'light', width: 1280, maxHeight: 900 },
  { file: 'jira-5-admin-policy.png', url: `${CORE}?view=admin`, theme: 'dark', width: 1280, maxHeight: 1300 },
  // Redline for Bitbucket
  { file: 'bitbucket-1-repo-settings.png', url: BB, theme: 'light', width: 1280, maxHeight: 900 },
  { file: 'bitbucket-2-attestation-valid.png', url: BB, theme: 'light', width: 1280, maxHeight: 1100, steps: [{ fill: [KEYS, key.publicKey] }, { fill: [PASTE, `Redline attestation for PAY-6:\n${token}`] }, { click: 'Test' }] },
  { file: 'bitbucket-3-attestation-tampered.png', url: BB, theme: 'dark', width: 1280, maxHeight: 1100, steps: [{ fill: [KEYS, key.publicKey] }, { fill: [PASTE, tampered] }, { click: 'Test' }] },
  {
    file: 'bitbucket-4-jira-attestation.png',
    url: `${CORE}?state=pass`,
    theme: 'light',
    width: 760,
    maxHeight: 1400,
    steps: [{ click: 'Requirements (2)' }, { fill: ['form[aria-label="Merge attestation"] input', 'acme/payments'] }, { fill: ['form[aria-label="Merge attestation"] input:nth-of-type(2)', '3f9c2a7d1e0b4c6a8f5d2e1b0a9c8d7e6f5a4b3c'] }, { click: 'Get attestation' }],
  },
  { file: 'bitbucket-5-repo-settings-dark.png', url: BB, theme: 'dark', width: 1280, maxHeight: 900 },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const b = await launch();
  await b.send('Page.enable');
  await b.send('Runtime.enable');
  try {
    for (const s of SHOTS) {
      await capture(b, { ...s, file: join(OUT, s.file) });
      console.log(`saved docs/screenshots/${s.file}`);
    }
  } finally {
    b.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
