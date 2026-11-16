import { events, view } from '@forge/bridge';

/** Automation config for "Redline: ingest threat model": no user-editable fields; the inputs are fixed smart values. */
export const REDLINE_ACTION_INPUTS = { issueKey: '{{issue.key}}', agentResponse: '{{agentResponse}}' } as const;

async function main(): Promise<void> {
  const status = document.getElementById('status');
  const submit = () => view.submit({ ...REDLINE_ACTION_INPUTS });
  // Submit once on load so Automation enables Next, and again whenever the native Next button fires.
  await submit();
  events.on('AUTOMATION_ACTION_SUBMIT', () => void submit());
  if (status) status.textContent = 'Redline reads the work item key and the Redline agent response automatically. Nothing to configure.';
}

void main().catch((e: unknown) => {
  const status = document.getElementById('status');
  if (status) status.textContent = `Redline config failed to load: ${e instanceof Error ? e.message : String(e)}`;
});
