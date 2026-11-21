import { describe, expect, it } from 'vitest';
import { claudeCodeLlm, type SpawnFn } from '../src/index.js';

const envelope = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{"ok":true}', usage: { input_tokens: 120, output_tokens: 30 }, modelUsage: { 'claude-sonnet-4-5-20250929': { inputTokens: 120 } } });
const req = { system: 'SYS PROMPT', user: 'USER PROMPT', tier: 'fast' as const, maxOutputTokens: 1000, purpose: 'propose' as const };

describe('claudeCodeLlm', () => {
  it('runs claude -p with tools disabled, the Threatline system prompt, JSON output and no session persistence; prompt on stdin', async () => {
    let seen: { cmd: string; args: string[]; input: string } | undefined;
    const spawn: SpawnFn = async (cmd, args, input) => {
      seen = { cmd, args, input };
      return { code: 0, stdout: envelope, stderr: '', timedOut: false };
    };
    const r = await claudeCodeLlm({ spawn }).complete(req);
    expect(seen!.cmd).toBe('claude');
    // --tools '' only removes built-in tools: MCP servers from the user's config (Threatline's own dev MCP server among them)
    // still load unless --strict-mcp-config is given with no --mcp-config. Skills and commands are off too.
    expect(seen!.args).toEqual(['-p', '--model', 'claude-sonnet-4-5', '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--system-prompt', 'SYS PROMPT', '--output-format', 'json', '--no-session-persistence']);
    expect(seen!.args).not.toContain('--mcp-config');
    expect(seen!.input).toBe('USER PROMPT');
    expect(r).toEqual({ ok: true, value: { text: '{"ok":true}', modelId: 'claude-sonnet-4-5-20250929', tokensIn: 120, tokensOut: 30 } });
  });
  it('maps a timeout to err(timeout) and a non-zero exit to err(upstream)', async () => {
    const t = await claudeCodeLlm({ spawn: async () => ({ code: null, stdout: '', stderr: '', timedOut: true }) }).complete(req);
    expect(!t.ok && t.error.code).toBe('timeout');
    const u = await claudeCodeLlm({ spawn: async () => ({ code: 1, stdout: '', stderr: 'boom', timedOut: false }) }).complete(req);
    expect(!u.ok && u.error.code).toBe('upstream');
  });
  it('treats an is_error envelope or garbage stdout as upstream errors', async () => {
    const e = await claudeCodeLlm({ spawn: async () => ({ code: 0, stdout: JSON.stringify({ is_error: true, result: 'usage limit' }), stderr: '', timedOut: false }) }).complete(req);
    expect(!e.ok && e.error.code).toBe('upstream');
    const g = await claudeCodeLlm({ spawn: async () => ({ code: 0, stdout: 'not json', stderr: '', timedOut: false }) }).complete(req);
    expect(!g.ok && g.error.code).toBe('upstream');
  });
  it('honours a model override', async () => {
    let args: string[] = [];
    await claudeCodeLlm({ model: 'opus', spawn: async (_c, a) => ((args = a), { code: 0, stdout: envelope, stderr: '', timedOut: false }) }).complete(req);
    expect(args[2]).toBe('opus');
  });
});
