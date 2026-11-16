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
