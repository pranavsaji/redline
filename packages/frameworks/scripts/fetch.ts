/**
 * One-off generator for packages/frameworks/data/asvs-5.0.json from the official OWASP ASVS 5.0.0 release.
 * Run: pnpm --filter @redline/frameworks fetch   (fetches public reference data at build time; not app egress)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE =
  'https://github.com/OWASP/ASVS/releases/download/v5.0.0_release/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json';

interface FlatReq {
  chapter_id: string;
  chapter_name: string;
  section_id: string;
  section_name: string;
  req_id: string;
  req_description: string;
  L: string;
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`ASVS download failed: ${res.status}`);
const flat = (await res.json()) as { requirements: FlatReq[] };
const out = {
  source: SOURCE,
  version: '5.0.0',
  requirements: flat.requirements.map((r) => ({
    id: r.req_id,
    chapter: `${r.chapter_id} ${r.chapter_name}`,
    section: `${r.section_id} ${r.section_name}`,
    text: r.req_description,
    level: Number(r.L),
  })),
};
const target = fileURLToPath(new URL('../data/asvs-5.0.json', import.meta.url));
writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${out.requirements.length} requirements to ${target}`);
