import { REPO_UUID } from './settings-store.js';

export type UserRequest = (path: string) => Promise<{ status: number; json(): Promise<unknown> }>;

/**
 * Is the calling user a repository admin? Asked of Bitbucket as the user, through the workspace-scoped permissions API
 * (the cross-workspace /2.0/user/permissions/repositories returns 404). Anything unexpected is "no".
 */
export function repoAdminCheck(request: UserRequest) {
  return async (workspaceUuid: string, repoUuid: string): Promise<boolean> => {
    if (!REPO_UUID.test(workspaceUuid) || !REPO_UUID.test(repoUuid)) return false;
    const q = encodeURIComponent(`repository.uuid="${repoUuid}"`);
    const r = await request(`/2.0/user/workspaces/${encodeURIComponent(workspaceUuid)}/permissions/repositories?q=${q}`);
    if (r.status !== 200) return false;
    const body = (await r.json()) as { values?: Array<{ permission?: string; repository?: { uuid?: string } }> };
    return (body.values ?? []).some((v) => v.permission === 'admin' && v.repository?.uuid?.toLowerCase() === repoUuid.toLowerCase());
  };
}
