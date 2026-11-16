/** M0 spike: proves the merge check runs and can read the PR, its diffstat and the destination's policy file. Replaced in Task 27. */
type PRCheckEvent = {
  workspace: { uuid: string };
  repository: { uuid: string };
  pullrequest: { id: number };
  trigger: { type: string };
};

export async function mergeCheck(event: PRCheckEvent): Promise<{ success: boolean; message: string }> {
  const { default: api, route } = await import('@forge/api');
  const ws = event.workspace.uuid;
  const repo = event.repository.uuid;
  const id = event.pullrequest.id;
  const bb = api.asApp();
  const pr = await bb.requestBitbucket(route`/2.0/repositories/${ws}/${repo}/pullrequests/${id}`);
  const prBody = (await pr.json()) as { source?: { commit?: { hash?: string } }; destination?: { commit?: { hash?: string } } };
  const src = prBody.source?.commit?.hash ?? '';
  const dest = prBody.destination?.commit?.hash ?? '';
  const diff = await bb.requestBitbucket(route`/2.0/repositories/${ws}/${repo}/diffstat/${`${src}..${dest}`}`);
  const diffBody = (await diff.json()) as { values?: Array<{ new?: { path?: string }; old?: { path?: string } }> };
  const policy = await bb.requestBitbucket(route`/2.0/repositories/${ws}/${repo}/src/${dest}/.redline/policy.yml`);
  const policyText = policy.ok ? await policy.text() : '';
  const summary = {
    event: 'merge_check_spike',
    trigger: event.trigger.type,
    prStatus: pr.status,
    src: src.slice(0, 12),
    dest: dest.slice(0, 12),
    diffStatus: diff.status,
    paths: (diffBody.values ?? []).map((v) => v.new?.path ?? v.old?.path ?? '?'),
    policyStatus: policy.status,
    policyBytes: policyText.length,
  };
  console.log(JSON.stringify(summary));
  return { success: true, message: `Redline spike: PR ${pr.status}, diffstat ${diff.status} (${summary.paths.length} files), policy ${policy.status}` };
}
