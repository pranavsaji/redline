import { appendFileSync, readFileSync } from 'node:fs';
import { gitHubClient } from './github.js';
import { parseInputs, runGitHubCheck } from './run.js';

/** GitHub Actions entry point: reads the step's inputs and the pull request event, then passes or fails the job. */
const env = process.env;
const input = (name: string) => env[`INPUT_${name.toUpperCase()}`];
// Workflow commands: %, CR and LF must be escaped, or a message could end the annotation and start another command.
const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const say = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<number> {
  const nowSec = env.REDLINE_NOW ? Number(env.REDLINE_NOW) : Math.floor(Date.now() / 1000);
  const settings = parseInputs({ 'public-keys': input('public-keys'), 'sensitive-paths': input('sensitive-paths'), mode: input('mode'), 'warn-until': input('warn-until'), 'diff-score-threshold': input('diff-score-threshold') }, nowSec);
  if (!settings.ok) return finish(false, 'config_error', settings.message);
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? '', 'utf8')) as { pull_request?: { number?: number }; repository?: { full_name?: string } };
  const number = event.pull_request?.number;
  const repo = event.repository?.full_name;
  if (!number || !repo) return finish(false, 'config_error', 'Redline: run this action on pull_request events (opened, edited, synchronize, reopened).');
  const token = input('github-token') ?? env.GITHUB_TOKEN ?? '';
  const client = gitHubClient({ api: env.GITHUB_API_URL ?? 'https://api.github.com', token, repo, number });
  const r = await runGitHubCheck({ settings: settings.value, client, nowSec });
  return finish(r.success, r.outcome, r.message);
}

function finish(success: boolean, outcome: string, message: string): number {
  say(`::${success ? (outcome === 'warn' || message.startsWith('Warning') ? 'warning' : 'notice') : 'error'} title=Redline::${escape(message)}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `outcome=${outcome}\nmessage=${message.replace(/[\r\n]+/g, ' ')}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Redline merge gate: ${success ? 'pass' : 'blocked'}\n\n${message}\n`);
  return success ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    // Fail closed on any unexpected error; say what failed without dumping request details.
    say(`::error title=Redline::${escape(`Redline: the merge gate could not run (${e instanceof Error ? e.name : 'error'}), so the change is blocked. Re-run the job.`)}`);
    process.exit(1);
  },
);
