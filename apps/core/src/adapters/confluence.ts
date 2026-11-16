import api, { assumeTrustedRoute } from '@forge/api';
import { z } from 'zod';
import { appError, err, ok, type Result } from '@redline/shared';
import { httpJson, seg, type FetchLike, type HttpOptions } from './http.js';

export interface ConfluencePage {
  id: string;
  title: string;
  spaceId: string;
  version: number;
  /** Storage-format body. Untrusted. */
  storage: string;
  url: string;
}

export interface ConfluenceClient {
  page(id: string): Promise<Result<ConfluencePage>>;
  createPage(i: { spaceId: string; parentId: string; title: string; storage: string }): Promise<Result<{ id: string; url: string }>>;
  /** `version` is the version you read; the update is sent as version + 1, so a concurrent edit returns `conflict`. */
  updatePage(i: { id: string; title: string; version: number; storage: string }): Promise<Result<void>>;
}

const NUMERIC_ID = /^\d{1,20}$/;
const Links = z.object({ webui: z.string().nullish(), base: z.string().nullish() }).nullish();
const PageSchema = z.object({
  id: z.string(),
  title: z.string(),
  spaceId: z.string(),
  version: z.object({ number: z.number().int() }),
  body: z.object({ storage: z.object({ value: z.string() }).nullish() }).nullish(),
  _links: Links,
});

/** Absolute when Confluence gives a base; otherwise the site-relative `/wiki/...` path. */
function pageUrl(links: z.infer<typeof Links>): string {
  const webui = links?.webui ?? '';
  if (links?.base) return `${links.base}${webui}`;
  return webui.startsWith('/wiki') ? webui : `/wiki${webui}`;
}

const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown, what: string): Result<z.infer<S>> => {
  const p = schema.safeParse(value);
  return p.success ? ok(p.data) : err(appError('upstream', `unexpected ${what} response from Confluence`));
};

export function createConfluenceClient(request: FetchLike, opts: HttpOptions = {}): ConfluenceClient {
  const call = httpJson(request, opts);
  const storageBody = (value: string) => ({ representation: 'storage', value });

  return {
    async page(id) {
      if (!NUMERIC_ID.test(id)) return err(appError('validation', 'invalid page id'));
      const r = await call(`/wiki/api/v2/pages/${seg(id)}?body-format=storage`);
      if (!r.ok) return r;
      const p = parse(PageSchema, r.value, 'page');
      if (!p.ok) return p;
      const v = p.value;
      return ok({ id: v.id, title: v.title, spaceId: v.spaceId, version: v.version.number, storage: v.body?.storage?.value ?? '', url: pageUrl(v._links) });
    },

    async createPage(i) {
      if (!NUMERIC_ID.test(i.spaceId) || !NUMERIC_ID.test(i.parentId)) return err(appError('validation', 'invalid space or parent id'));
      const r = await call('/wiki/api/v2/pages', {
        method: 'POST',
        body: JSON.stringify({ spaceId: i.spaceId, parentId: i.parentId, status: 'current', title: i.title, body: storageBody(i.storage) }),
      });
      if (!r.ok) return r;
      const p = parse(z.object({ id: z.string(), _links: Links }), r.value, 'create page');
      return p.ok ? ok({ id: p.value.id, url: pageUrl(p.value._links) }) : p;
    },

    async updatePage(i) {
      if (!NUMERIC_ID.test(i.id)) return err(appError('validation', 'invalid page id'));
      const r = await call(`/wiki/api/v2/pages/${seg(i.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ id: i.id, status: 'current', title: i.title, version: { number: i.version + 1 }, body: storageBody(i.storage) }),
      });
      return r.ok ? ok(undefined) : r;
    },
  };
}

export function confluenceClient(as: 'app' | 'user'): ConfluenceClient {
  const request: FetchLike = (path, init) => {
    const product = as === 'app' ? api.asApp() : api.asUser();
    return product.requestConfluence(assumeTrustedRoute(path), init);
  };
  return createConfluenceClient(request);
}
