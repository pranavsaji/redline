import api, { assumeTrustedRoute } from '@forge/api';
import { z } from 'zod';
import { appError, err, ok, type Result } from '@threatline/shared';
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
  /** Without `parentId` the page goes at the root of the space. */
  createPage(i: { spaceId: string; parentId?: string; title: string; storage: string }): Promise<Result<{ id: string; url: string }>>;
  spaceByKey(key: string): Promise<Result<{ id: string; homepageId: string | null }>>;
  /** A current page with exactly this title in the space, or null. */
  findPage(spaceId: string, title: string): Promise<Result<{ id: string; url: string } | null>>;
  /** `version` is the version you read; the update is sent as version + 1, so a concurrent edit returns `conflict`. */
  updatePage(i: { id: string; title: string; version: number; storage: string }): Promise<Result<void>>;
  /** Whether `accountId` may read the page. No account, a denied/missing page or an unexpected answer is false. */
  canRead(pageId: string, accountId: string): Promise<Result<boolean>>;
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
      if (!NUMERIC_ID.test(i.spaceId) || (i.parentId !== undefined && !NUMERIC_ID.test(i.parentId))) return err(appError('validation', 'invalid space or parent id'));
      const r = await call('/wiki/api/v2/pages', {
        method: 'POST',
        body: JSON.stringify({ spaceId: i.spaceId, ...(i.parentId ? { parentId: i.parentId } : {}), status: 'current', title: i.title, body: storageBody(i.storage) }),
      });
      if (!r.ok) return r;
      const p = parse(z.object({ id: z.string(), _links: Links }), r.value, 'create page');
      return p.ok ? ok({ id: p.value.id, url: pageUrl(p.value._links) }) : p;
    },

    async spaceByKey(key) {
      if (!/^[A-Za-z0-9~_-]{1,255}$/.test(key)) return err(appError('validation', 'invalid space key'));
      const r = await call(`/wiki/api/v2/spaces?keys=${encodeURIComponent(key)}`);
      if (!r.ok) return r;
      const p = parse(z.object({ results: z.array(z.object({ id: z.string(), homepageId: z.string().nullish() })) }), r.value, 'spaces');
      if (!p.ok) return p;
      const s0 = p.value.results[0];
      return s0 ? ok({ id: s0.id, homepageId: s0.homepageId ?? null }) : err(appError('not_found', `space ${key} not found`));
    },

    async findPage(spaceId, title) {
      if (!NUMERIC_ID.test(spaceId)) return err(appError('validation', 'invalid space id'));
      const r = await call(`/wiki/api/v2/pages?space-id=${seg(spaceId)}&title=${encodeURIComponent(title)}&status=current`);
      if (!r.ok) return r;
      const p = parse(z.object({ results: z.array(z.object({ id: z.string(), _links: Links })), _links: Links }), r.value, 'pages');
      if (!p.ok) return p;
      const hit = p.value.results[0];
      // The list response gives `base` once, at the top level; without it the URL is relative and Jira rejects it as a remote link.
      return ok(hit ? { id: hit.id, url: pageUrl({ ...hit._links, ...(p.value._links?.base && !hit._links?.base ? { base: p.value._links.base } : {}) }) } : null);
    },

    async updatePage(i) {
      if (!NUMERIC_ID.test(i.id)) return err(appError('validation', 'invalid page id'));
      const r = await call(`/wiki/api/v2/pages/${seg(i.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ id: i.id, status: 'current', title: i.title, version: { number: i.version + 1 }, body: storageBody(i.storage) }),
      });
      return r.ok ? ok(undefined) : r;
    },

    async canRead(pageId, accountId) {
      if (!accountId || !NUMERIC_ID.test(pageId)) return ok(false);
      const r = await call(`/wiki/rest/api/content/${seg(pageId)}/permission/check`, {
        method: 'POST',
        body: JSON.stringify({ subject: { type: 'user', identifier: accountId }, operation: 'read' }),
      });
      if (!r.ok) return r.error.code === 'forbidden' || r.error.code === 'not_found' ? ok(false) : r;
      return ok((r.value as { hasPermission?: unknown } | undefined)?.hasPermission === true);
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
