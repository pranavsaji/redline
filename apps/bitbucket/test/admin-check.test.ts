import { describe, expect, it } from 'vitest';
import { repoAdminCheck } from '../src/admin-check.js';

const WS = '{11111111-1111-4111-8111-111111111111}';
const REPO = '{22222222-2222-4222-8222-222222222222}';

describe('repoAdminCheck', () => {
  it('asks the workspace-scoped permissions API (the cross-workspace one returns 404)', async () => {
    const paths: string[] = [];
    const check = repoAdminCheck(async (path) => (paths.push(path), { status: 200, json: async () => ({ values: [{ permission: 'admin', repository: { uuid: REPO } }] }) }));
    expect(await check(WS, REPO)).toBe(true);
    expect(paths[0]).toBe(`/2.0/user/workspaces/${encodeURIComponent(WS)}/permissions/repositories?q=${encodeURIComponent(`repository.uuid="${REPO}"`)}`);
  });

  it('write access, another repository, an HTTP error or a bad id is not admin', async () => {
    const reply = (status: number, values: unknown[]) => repoAdminCheck(async () => ({ status, json: async () => ({ values }) }));
    expect(await reply(200, [{ permission: 'write', repository: { uuid: REPO } }])(WS, REPO)).toBe(false);
    expect(await reply(200, [{ permission: 'admin', repository: { uuid: '{33333333-3333-4333-8333-333333333333}' } }])(WS, REPO)).toBe(false);
    expect(await reply(404, [])(WS, REPO)).toBe(false);
    expect(await reply(200, [{ permission: 'admin', repository: { uuid: REPO } }])('x"y', REPO)).toBe(false);
  });
});
