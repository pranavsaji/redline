import { describe, expect, it } from 'vitest';
import { adfToText, createJiraClient, type AdfDoc } from '../../src/adapters/jira.js';
import { fakeHttp, fixture, noSleep } from './fake-http.js';

const client = (routes: Parameters<typeof fakeHttp>[0]) => {
  const http = fakeHttp(routes);
  const s = noSleep();
  return { jira: createJiraClient(http.request, { sleep: s.sleep, random: () => 0 }), calls: http.calls, waits: s.waits };
};

describe('jira client: issue', () => {
  it('maps a full issue: trusted fields, links, ADF description to plain text', async () => {
    const { jira, calls } = client([[/GET \/rest\/api\/3\/issue\/PAY-7\?/, { status: 200, body: fixture('jira', 'issue') }]]);
    const r = await jira.issue('PAY-7');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const i = r.value;
    expect(i).toMatchObject({
      id: '10042',
      key: 'PAY-7',
      summary: 'Refund webhook from the payment provider',
      issueType: { id: '10001', name: 'Story', subtask: false },
      parent: { id: '10040', key: 'PAY-5' },
      components: ['payments'],
      labels: ['pci'],
      project: { id: '10000', key: 'PAY' },
      status: { name: 'In Progress', category: 'indeterminate' },
      fixVersions: ['2026.12'],
      assignee: 'acc-1',
    });
    expect(i.links).toEqual([
      { type: 'relates to', direction: 'outward', issue: { id: '10050', key: 'PAY-9', summary: 'Payment provider incident', status: 'Done', issueType: 'Bug' } },
      { type: 'is blocked by', direction: 'inward', issue: { id: '10051', key: 'PAY-10', summary: 'Secrets rotation', status: 'To Do', issueType: 'Story' } },
    ]);
    expect(i.description).toContain('@Dana');
    expect(i.description).toContain('verify(sig, body)');
    expect(i.description).toContain('- HMAC check');
    expect(calls[0]!.path).toContain('fields=summary,description,issuetype,parent,issuelinks,components,labels,project,status,fixVersions,assignee');
  });

  it('maps a sparse issue with null description and no optional fields', async () => {
    const { jira } = client([[/GET \/rest\/api\/3\/issue\/PAY-8\?/, { status: 200, body: fixture('jira', 'issue-sparse') }]]);
    const r = await jira.issue('PAY-8');
    expect(r.ok && r.value).toMatchObject({ key: 'PAY-8', description: '', links: [], components: [], labels: [], fixVersions: [] });
    expect(r.ok && r.value.parent).toBeUndefined();
  });

  it('404 → err(not_found)', async () => {
    const { jira } = client([[/issue\/PAY-404/, { status: 404, body: fixture('jira', 'error-404') }]]);
    const r = await jira.issue('PAY-404');
    expect(!r.ok && r.error.code).toBe('not_found');
  });

  it('403 → err(forbidden)', async () => {
    const { jira } = client([[/issue\/PAY-1/, { status: 403, body: '{}' }]]);
    const r = await jira.issue('PAY-1');
    expect(!r.ok && r.error.code).toBe('forbidden');
  });

  it('429 is retried with backoff (honouring Retry-After) and then succeeds', async () => {
    const { jira, calls, waits } = client([
      [/issue\/PAY-7/, [{ status: 429, headers: { 'Retry-After': '2' } }, { status: 429 }, { status: 200, body: fixture('jira', 'issue') }]],
    ]);
    const r = await jira.issue('PAY-7');
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(waits[0]).toBe(2000);
    expect(waits[1]).toBeGreaterThan(0);
  });

  it('429 that never clears → err(upstream) after the retry budget, not an endless loop', async () => {
    const { jira, calls } = client([[/issue\/PAY-7/, { status: 429 }]]);
    const r = await jira.issue('PAY-7');
    expect(!r.ok && r.error.code).toBe('upstream');
    expect(calls.length).toBe(4);
  });

  it('a 200 whose body is not JSON → err(upstream)', async () => {
    const { jira } = client([[/issue\/PAY-7/, { status: 200, body: '<html>maintenance</html>' }]]);
    const r = await jira.issue('PAY-7');
    expect(!r.ok && r.error.code).toBe('upstream');
  });

  it('a 200 with an unexpected shape → err(upstream), never a half-filled issue', async () => {
    const { jira } = client([[/issue\/PAY-7/, { status: 200, body: '{"errorMessages":["x"]}' }]]);
    const r = await jira.issue('PAY-7');
    expect(!r.ok && r.error.code).toBe('upstream');
  });

  it('rejects a crafted key that would change the route, without calling Jira', async () => {
    const { jira, calls } = client([[/GET/, { status: 404, body: '{}' }]]);
    const r = await jira.issue('../../rest/api/3/myself');
    expect(!r.ok && r.error.code).toBe('validation');
    expect(calls).toHaveLength(0);
  });
});

describe('jira client: permissions', () => {
  it('canBrowse is true when the check returns the issue id', async () => {
    const { jira, calls } = client([[/POST \/rest\/api\/3\/permissions\/check/, { status: 200, body: fixture('jira', 'permissions-allowed') }]]);
    const r = await jira.canBrowse('acc-1', '10042');
    expect(r).toEqual({ ok: true, value: true });
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({
      accountId: 'acc-1',
      projectPermissions: [{ permissions: ['BROWSE_PROJECTS'], issues: [10042] }],
    });
    expect(calls[0]!.init!.headers!['Content-Type']).toBe('application/json');
  });

  it('canBrowse is false when the issue is absent from projectPermissions[].issues', async () => {
    const { jira } = client([[/permissions\/check/, { status: 200, body: fixture('jira', 'permissions-denied') }]]);
    expect(await jira.canBrowse('acc-1', '10042')).toEqual({ ok: true, value: false });
  });

  it('canBrowse resolves an issue key to its id first', async () => {
    const { jira, calls } = client([
      [/GET \/rest\/api\/3\/issue\/PAY-7\?/, { status: 200, body: fixture('jira', 'issue') }],
      [/permissions\/check/, { status: 200, body: fixture('jira', 'permissions-allowed') }],
    ]);
    expect(await jira.canBrowse('acc-1', 'PAY-7')).toEqual({ ok: true, value: true });
    expect(JSON.parse(calls[1]!.init!.body!).projectPermissions[0].issues).toEqual([10042]);
  });

  it('canBrowse for an issue that does not exist is false (no existence leak)', async () => {
    const { jira } = client([[/GET \/rest\/api\/3\/issue\/PAY-404/, { status: 404, body: '{}' }]]);
    expect(await jira.canBrowse('acc-1', 'PAY-404')).toEqual({ ok: true, value: false });
  });

  it('canBrowse with no account id is false without calling Jira', async () => {
    const { jira, calls } = client([]);
    expect(await jira.canBrowse('', '10042')).toEqual({ ok: true, value: false });
    expect(calls).toHaveLength(0);
  });

  it('canEdit asks for EDIT_ISSUES', async () => {
    const { jira, calls } = client([
      [/permissions\/check/, { status: 200, body: '{"projectPermissions":[{"permission":"EDIT_ISSUES","issues":[10042]}]}' }],
    ]);
    expect(await jira.canEdit('acc-1', '10042')).toEqual({ ok: true, value: true });
    expect(JSON.parse(calls[0]!.init!.body!).projectPermissions[0].permissions).toEqual(['EDIT_ISSUES']);
  });

  it('isAdmin reads the ADMINISTER global permission', async () => {
    const { jira, calls } = client([[/permissions\/check/, { status: 200, body: fixture('jira', 'permissions-admin') }]]);
    expect(await jira.isAdmin('acc-1')).toEqual({ ok: true, value: true });
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({ accountId: 'acc-1', globalPermissions: ['ADMINISTER'] });
  });

  it('groupsOf returns group names', async () => {
    const { jira, calls } = client([[/GET \/rest\/api\/3\/user\/groups\?accountId=acc-1/, { status: 200, body: fixture('jira', 'groups') }]]);
    expect(await jira.groupsOf('acc-1')).toEqual({ ok: true, value: ['redline-champions', 'jira-software-users'] });
    expect(calls).toHaveLength(1);
  });
});

describe('jira client: reads', () => {
  it('comments map ADF bodies to text; empty list is fine', async () => {
    const { jira } = client([
      [/issue\/10042\/comment/, { status: 200, body: fixture('jira', 'comments') }],
      [/issue\/10043\/comment/, { status: 200, body: fixture('jira', 'comments-empty') }],
    ]);
    expect(await jira.comments('10042')).toEqual({
      ok: true,
      value: [{ id: '200', body: 'Uses the shared secret', author: 'acc-2', created: '2026-11-11T09:00:00.000+0000' }],
    });
    expect(await jira.comments('10043')).toEqual({ ok: true, value: [] });
  });

  it('remote links keep url and default a missing title to the url', async () => {
    const { jira } = client([[/remotelink/, { status: 200, body: fixture('jira', 'remotelinks') }]]);
    const r = await jira.remoteLinks('10042');
    expect(r.ok && r.value).toEqual([
      { url: 'https://one-atlas-mefc.atlassian.net/wiki/spaces/PAY/pages/98305/Refund+design', title: 'Refund design' },
      { url: 'https://example.com/x', title: 'https://example.com/x' },
    ]);
  });

  it('search pages with nextPageToken until max', async () => {
    const { jira, calls } = client([
      [/POST \/rest\/api\/3\/search\/jql/, [{ status: 200, body: fixture('jira', 'search-page1') }, { status: 200, body: fixture('jira', 'search-page2') }]],
    ]);
    const r = await jira.search('parent = 10042', ['summary'], 50);
    expect(r.ok && r.value.map((i) => i.key)).toEqual(['PAY-11', 'PAY-12']);
    expect(JSON.parse(calls[1]!.init!.body!).nextPageToken).toBe('t2');
  });

  it('search stops at max even when more pages exist', async () => {
    const { jira, calls } = client([[/search\/jql/, { status: 200, body: fixture('jira', 'search-page1') }]]);
    const r = await jira.search('project = PAY', ['summary'], 1);
    expect(r.ok && r.value).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('children searches by parent id', async () => {
    const { jira, calls } = client([[/search\/jql/, [{ status: 200, body: fixture('jira', 'search-page1') }, { status: 200, body: fixture('jira', 'search-page2') }]]]);
    const r = await jira.children('10042');
    expect(r.ok && r.value).toHaveLength(2);
    expect(JSON.parse(calls[0]!.init!.body!).jql).toBe('parent = 10042');
  });

  it('children rejects a non-numeric id (no JQL injection)', async () => {
    const { jira, calls } = client([]);
    const r = await jira.children('1 OR project = SECRET');
    expect(!r.ok && r.error.code).toBe('validation');
    expect(calls).toHaveLength(0);
  });
});

describe('jira client: writes', () => {
  it('setProperty PUTs JSON with an explicit content type', async () => {
    const { jira, calls } = client([[/PUT \/rest\/api\/3\/issue\/10042\/properties\/redline\.verdict/, { status: 200, body: '' }]]);
    expect(await jira.setProperty('10042', 'redline.verdict', { state: 'block' })).toEqual({ ok: true, value: undefined });
    expect(calls[0]!.init).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"state":"block"}' });
  });

  it('createSubtask posts project + parent + issuetype and returns id/key', async () => {
    const doc: AdfDoc = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Given…' }] }] };
    const { jira, calls } = client([
      [/GET \/rest\/api\/3\/issue\/10042\?/, { status: 200, body: fixture('jira', 'issue') }],
      [/POST \/rest\/api\/3\/issue$/, { status: 201, body: fixture('jira', 'created') }],
    ]);
    const r = await jira.createSubtask('10042', { summary: 'Verify HMAC', description: doc, labels: ['redline'], issueTypeId: '10002' });
    expect(r).toEqual({ ok: true, value: { id: '10070', key: 'PAY-13' } });
    expect(JSON.parse(calls[1]!.init!.body!)).toEqual({
      fields: { project: { id: '10000' }, parent: { id: '10042' }, summary: 'Verify HMAC', description: doc, labels: ['redline'], issuetype: { id: '10002' } },
    });
  });

  it('addLabel / removeLabel use the update verbs', async () => {
    const { jira, calls } = client([[/PUT \/rest\/api\/3\/issue\/10042$/, { status: 204 }]]);
    await jira.addLabel('10042', 'redline-review');
    await jira.removeLabel('10042', 'redline-review');
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({ update: { labels: [{ add: 'redline-review' }] } });
    expect(JSON.parse(calls[1]!.init!.body!)).toEqual({ update: { labels: [{ remove: 'redline-review' }] } });
  });

  it('comment posts the ADF body', async () => {
    const doc: AdfDoc = { type: 'doc', version: 1, content: [] };
    const { jira, calls } = client([[/POST \/rest\/api\/3\/issue\/10042\/comment/, { status: 201, body: '{"id":"1"}' }]]);
    expect((await jira.comment('10042', doc)).ok).toBe(true);
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({ body: doc });
  });

  it('a 400 on write → err(validation) carrying Jira’s messages', async () => {
    const { jira } = client([[/PUT/, { status: 400, body: '{"errorMessages":["Field labels cannot be set"],"errors":{}}' }]]);
    const r = await jira.addLabel('10042', 'x');
    expect(!r.ok && r.error).toMatchObject({ code: 'validation', message: expect.stringContaining('Field labels cannot be set') });
  });
});

describe('adfToText', () => {
  it('handles mentions, code blocks, hard breaks, emoji, cards and nested lists', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Design' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, { type: 'mention', attrs: { text: '@Sam' } }, { type: 'hardBreak' }, { type: 'emoji', attrs: { shortName: ':lock:', text: '🔒' } }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'a()\nb()' }] },
        { type: 'paragraph', content: [{ type: 'inlineCard', attrs: { url: 'https://x.test/a' } }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }] }] }] }] },
      ],
    };
    const t = adfToText(doc);
    expect(t).toBe('Design\nHi @Sam\n🔒\na()\nb()\nhttps://x.test/a\n- one\n  - nested');
  });

  it('returns "" for null, strings pass through, and deep nesting is bounded', () => {
    expect(adfToText(null)).toBe('');
    expect(adfToText('plain')).toBe('plain');
    let deep: Record<string, unknown> = { type: 'text', text: 'bottom' };
    for (let i = 0; i < 500; i++) deep = { type: 'paragraph', content: [deep] };
    expect(() => adfToText({ type: 'doc', content: [deep] })).not.toThrow();
  });
});
