import { describe, expect, it } from 'vitest';
import { createConfluenceClient } from '../../src/adapters/confluence.js';
import { fakeHttp, fixture, noSleep } from './fake-http.js';

const client = (routes: Parameters<typeof fakeHttp>[0]) => {
  const http = fakeHttp(routes);
  return { c: createConfluenceClient(http.request, { sleep: noSleep().sleep, random: () => 0 }), calls: http.calls };
};

describe('confluence client', () => {
  it('page returns storage body, version and absolute url', async () => {
    const { c, calls } = client([[/GET \/wiki\/api\/v2\/pages\/98305\?body-format=storage/, { status: 200, body: fixture('confluence', 'page') }]]);
    expect(await c.page('98305')).toEqual({
      ok: true,
      value: {
        id: '98305',
        title: 'Refund design',
        spaceId: '4456',
        version: 3,
        storage: '<p>The webhook trusts <strong>X-Signature</strong>.</p>',
        url: 'https://one-atlas-mefc.atlassian.net/wiki/spaces/PAY/pages/98305/Refund+design',
      },
    });
    expect(calls).toHaveLength(1);
  });

  it('a page without a body returns empty storage and the relative url', async () => {
    const { c } = client([[/pages\/98306/, { status: 200, body: fixture('confluence', 'page-no-body') }]]);
    const r = await c.page('98306');
    expect(r.ok && r.value).toMatchObject({ storage: '', url: '/wiki/spaces/PAY/pages/98306/Empty' });
  });

  it('page ids must be numeric', async () => {
    const { c, calls } = client([]);
    const r = await c.page('../spaces');
    expect(!r.ok && r.error.code).toBe('validation');
    expect(calls).toHaveLength(0);
  });

  it('404 → not_found, 403 → forbidden', async () => {
    const { c } = client([
      [/pages\/1\?/, { status: 404, body: '{}' }],
      [/pages\/2\?/, { status: 403, body: '{}' }],
    ]);
    const nf = await c.page('1');
    expect(!nf.ok && nf.error.code).toBe('not_found');
    const r = await c.page('2');
    expect(!r.ok && r.error.code).toBe('forbidden');
  });

  it('createPage posts a current storage page under the parent', async () => {
    const { c, calls } = client([[/POST \/wiki\/api\/v2\/pages$/, { status: 200, body: fixture('confluence', 'created') }]]);
    const r = await c.createPage({ spaceId: '4456', parentId: '98305', title: 'Redline threat model', storage: '<p>x</p>' });
    expect(r).toEqual({ ok: true, value: { id: '98400', url: 'https://one-atlas-mefc.atlassian.net/wiki/spaces/PAY/pages/98400' } });
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({
      spaceId: '4456',
      parentId: '98305',
      status: 'current',
      title: 'Redline threat model',
      body: { representation: 'storage', value: '<p>x</p>' },
    });
  });

  it('updatePage sends the next version number; a stale version → conflict', async () => {
    const { c, calls } = client([
      [/PUT \/wiki\/api\/v2\/pages\/98305$/, [{ status: 200, body: '{}' }, { status: 409, body: fixture('confluence', 'error-409') }]],
    ]);
    expect((await c.updatePage({ id: '98305', title: 'T', version: 3, storage: '<p>y</p>' })).ok).toBe(true);
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({
      id: '98305',
      status: 'current',
      title: 'T',
      version: { number: 4 },
      body: { representation: 'storage', value: '<p>y</p>' },
    });
    const r = await c.updatePage({ id: '98305', title: 'T', version: 3, storage: '<p>y</p>' });
    expect(!r.ok && r.error.code).toBe('conflict');
  });
});

describe('confluence client: canRead', () => {
  it('asks the content permission check for the user and read operation', async () => {
    const { c, calls } = client([[/POST \/wiki\/rest\/api\/content\/98305\/permission\/check/, { status: 200, body: '{"hasPermission":true}' }]]);
    expect(await c.canRead('98305', 'acc-1')).toEqual({ ok: true, value: true });
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({ subject: { type: 'user', identifier: 'acc-1' }, operation: 'read' });
  });

  it('no account, a 403/404, or a malformed answer → false', async () => {
    const { c } = client([
      [/content\/1\/permission/, { status: 403, body: '{}' }],
      [/content\/2\/permission/, { status: 404, body: '{}' }],
      [/content\/3\/permission/, { status: 200, body: '{"hasPermission":"yes"}' }],
    ]);
    expect(await c.canRead('98305', '')).toEqual({ ok: true, value: false });
    expect(await c.canRead('1', 'a')).toEqual({ ok: true, value: false });
    expect(await c.canRead('2', 'a')).toEqual({ ok: true, value: false });
    expect(await c.canRead('3', 'a')).toEqual({ ok: true, value: false });
  });

  it('spaceByKey returns the space id and home page; unknown key → not_found', async () => {
    const { c } = client([[/GET \/wiki\/api\/v2\/spaces\?keys=PAY$/, { status: 200, body: JSON.stringify({ results: [{ id: '4456', key: 'PAY', homepageId: '98000' }] }) }]]);
    expect(await c.spaceByKey('PAY')).toEqual({ ok: true, value: { id: '4456', homepageId: '98000' } });
    const none = client([[/spaces\?keys=NOPE/, { status: 200, body: JSON.stringify({ results: [] }) }]]);
    expect(await none.c.spaceByKey('NOPE')).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await none.c.spaceByKey('a b')).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('findPage looks a page up by exact title in a space', async () => {
    const { c, calls } = client([[/GET \/wiki\/api\/v2\/pages\?space-id=4456&title=Design%3A%20AI%20support%20agent&status=current$/, { status: 200, body: JSON.stringify({ results: [{ id: '98400', _links: { webui: '/spaces/PAY/pages/98400' } }], _links: { base: 'https://x.atlassian.net/wiki' } }) }]]);
    expect(await c.findPage('4456', 'Design: AI support agent')).toEqual({ ok: true, value: { id: '98400', url: '/wiki/spaces/PAY/pages/98400' } });
    expect(calls).toHaveLength(1);
  });

  it('createPage without a parent puts the page at the space root', async () => {
    const { c, calls } = client([[/POST \/wiki\/api\/v2\/pages$/, { status: 200, body: JSON.stringify({ id: '98401', _links: { webui: '/spaces/PAY/pages/98401', base: 'https://x.atlassian.net/wiki' } }) }]]);
    expect(await c.createPage({ spaceId: '4456', title: 'T', storage: '<p>x</p>' })).toEqual({ ok: true, value: { id: '98401', url: 'https://x.atlassian.net/wiki/spaces/PAY/pages/98401' } });
    expect(JSON.parse(calls[0]!.init!.body!)).not.toHaveProperty('parentId');
  });
});
