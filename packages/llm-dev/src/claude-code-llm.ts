import { spawn as nodeSpawn } from 'node:child_process';
import { appError, err, ok, type Result } from '@redline/shared';
import type { LlmPort, LlmRequest, LlmResponse } from '@redline/core';

export type SpawnFn = (cmd: string, args: string[], input: string, timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;

const defaultSpawn: SpawnFn = (cmd, args, input, timeoutMs) =>
  new Promise((resolve) => {
    const child = nodeSpawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(input);
  });

interface Envelope {
  is_error?: boolean;
  result?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

/**
 * Dev-only LLM adapter for prompt tuning and evals: runs prompts through the local `claude` CLI under Pranav's own
 * subscription with every tool disabled and Redline's prompt as the system prompt. Never bundled into a Forge app.
 * Never logs prompt text.
 */
export function claudeCodeLlm(opts: { model?: string; timeoutMs?: number; spawn?: SpawnFn } = {}): LlmPort {
  const model = opts.model ?? 'claude-sonnet-4-5';
  const run = opts.spawn ?? defaultSpawn;
  const timeoutMs = opts.timeoutMs ?? 240_000;
  return {
    async complete(req: LlmRequest): Promise<Result<LlmResponse>> {
      const args = ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--system-prompt', req.system, '--output-format', 'json', '--no-session-persistence'];
      const r = await run('claude', args, req.user, timeoutMs);
      if (r.timedOut) return err(appError('timeout', `claude -p timed out after ${timeoutMs} ms`));
      if (r.code !== 0) return err(appError('upstream', `claude -p exited with ${String(r.code)}`, { stderr: r.stderr.slice(0, 300) }));
      let env: Envelope;
      try {
        env = JSON.parse(r.stdout) as Envelope;
      } catch {
        return err(appError('upstream', 'claude -p did not return a JSON envelope'));
      }
      if (env.is_error || typeof env.result !== 'string') return err(appError('upstream', 'claude -p reported an error', { result: String(env.result).slice(0, 300) }));
      const u = env.usage ?? {};
      const tokensIn = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      const modelId = Object.keys(env.modelUsage ?? {})[0] ?? model;
      return ok({ text: env.result, modelId, tokensIn, tokensOut: u.output_tokens ?? 0 });
    },
  };
}
