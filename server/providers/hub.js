import { sameSiteGated } from './common/same-site.js';

/**
 * OneIntOS hub proxy (same-origin `/api/hub/*`, dev and preview).
 *
 * The browser never talks to OneIntOS. This server-side route forwards three
 * read-only layers-API routes to a loopback OneIntOS instance and adds the
 * bearer token, which stays in the server environment:
 *
 *   ONEINTOS_LAYERS_URL    e.g. http://127.0.0.1:<port>   (loopback only)
 *   ONEINTOS_LAYERS_TOKEN  the layers API read token       (server-side only)
 *
 * Unset or invalid values leave the hub off: every route answers 503.
 * Requests pass the same-site gate first. Only GET is served, only an
 * allowlist of paths and query keys is forwarded, the browser's Origin and
 * Cookie headers are never sent upstream, and bodies and streams are bounded.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const ROUTES = [
  /^\/layers$/,
  /^\/layers\/[a-z0-9-]{1,40}\/features$/,
  /^\/layers\/[a-z0-9-]{1,40}\/stream$/,
];
const STREAM_ROUTE = /^\/layers\/[a-z0-9-]{1,40}\/stream$/;
const QUERY_KEYS = new Set(['bbox', 'time', 'limit']);
const QUERY_VALUE = /^[0-9A-Za-z.,:/+-]{0,200}$/;
const MAX_JSON_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const STREAM_IDLE_MS = 30_000;
export const MAX_HUB_STREAMS = 4;

/** Parse the hub target. Returns null (hub off) unless it is a plain loopback http origin. */
export function resolveHubTarget(env = process.env) {
  const rawUrl = String(env.ONEINTOS_LAYERS_URL || '').trim();
  const token = String(env.ONEINTOS_LAYERS_TOKEN || '').trim();
  if (!rawUrl || !token) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    return null;
  return { origin: url.origin, token };
}

function json(res, status, value, extra = {}) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(JSON.stringify(value));
}

function upstreamQuery(searchParams) {
  const out = new URLSearchParams();
  for (const [key, value] of searchParams) {
    if (!QUERY_KEYS.has(key) || !QUERY_VALUE.test(value)) return null;
    out.append(key, value);
  }
  return out.toString();
}

async function readCapped(response, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Same-origin hub routes for dev and preview. */
export function hubProxy({
  env = process.env,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  let streams = 0;

  async function forward(req, res, target, url) {
    const query = upstreamQuery(url.searchParams);
    if (query === null) return json(res, 422, { error: 'invalid_query' });
    const isStream = STREAM_ROUTE.test(url.pathname);
    if (isStream && streams >= MAX_HUB_STREAMS)
      return json(
        res,
        429,
        { error: 'too_many_streams' },
        { 'Retry-After': '5' },
      );

    const abort = new AbortController();
    const limitMs = isStream ? STREAM_IDLE_MS : REQUEST_TIMEOUT_MS;
    let timer = setTimeout(() => abort.abort(), limitMs);
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => abort.abort(), limitMs);
    };
    const onClose = () => abort.abort();
    res.on('close', onClose);
    let counted = false;
    try {
      const upstream = await fetchImpl(
        `${target.origin}${url.pathname}${query ? `?${query}` : ''}`,
        {
          method: 'GET',
          redirect: 'error',
          signal: abort.signal,
          headers: {
            Authorization: `Bearer ${target.token}`,
            Accept: isStream ? 'text/event-stream' : 'application/json',
          },
        },
      );
      if ([401, 403].includes(upstream.status))
        return json(res, 502, { error: 'hub_auth_failed' });
      if (isStream && upstream.status === 200) {
        streams += 1;
        counted = true;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        for await (const chunk of upstream.body) {
          touch(); // a stream is cut only after STREAM_IDLE_MS of silence
          if (res.destroyed) break;
          res.write(chunk);
        }
        return res.end();
      }
      if (![200, 404, 422, 429, 503].includes(upstream.status))
        return json(res, 502, { error: 'hub_unavailable' });
      const body = await readCapped(upstream, MAX_JSON_BYTES);
      if (body === null)
        return json(res, 502, { error: 'hub_response_too_large' });
      if (res.destroyed) return undefined;
      res.writeHead(upstream.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    } catch {
      if (!res.headersSent) return json(res, 502, { error: 'hub_unavailable' });
      return res.end();
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
      if (counted) streams -= 1;
    }
  }

  const handler = sameSiteGated(async (req, res) => {
    if (req.method !== 'GET')
      return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    const url = new URL(req.url || '/', 'http://local');
    if (!ROUTES.some((route) => route.test(url.pathname)))
      return json(res, 404, { error: 'unknown_route' });
    const target = resolveHubTarget(env);
    if (!target) return json(res, 503, { error: 'hub_not_configured' });
    return forward(req, res, target, url);
  });

  return {
    name: 'oneintos-hub',
    configureServer({ middlewares }) {
      middlewares.use('/api/hub', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/hub', handler);
    },
  };
}
