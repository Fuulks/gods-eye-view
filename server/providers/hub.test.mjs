import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { hubProxy, resolveHubTarget, MAX_HUB_STREAMS } from './hub.js';

const TOKEN = 'unit-test-token-placeholder';
const REQUEST_LIMIT_MS = 2000; // per request
const TEST_LIMIT_MS = 15000; // per test

// Servers a failed test never reached its own close() for are closed here, so a failure ends the run.
const openServers = new Set();
after(() => {
  for (const server of openServers) {
    server.closeAllConnections();
    server.close();
  }
});

/** A fake OneIntOS layers API that records what it was sent. */
async function fakeUpstream(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers, method: req.method });
    handler(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  openServers.add(server);
  return {
    seen,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((r) => server.close(r));
    },
  };
}

/** Mount the plugin on a real server the way Vite's connect does (prefix stripped). */
async function mount(env) {
  const plugin = hubProxy({ env });
  const mounts = [];
  plugin.configureServer({
    middlewares: { use: (p, fn) => mounts.push([p, fn]) },
  });
  const [prefix, fn] = mounts[0];
  assert.equal(prefix, '/api/hub');
  const server = http.createServer((req, res) => {
    req.url = req.url.slice(prefix.length) || '/';
    fn(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  openServers.add(server);
  const port = server.address().port;
  return {
    // Every request is bounded: a response that never ends fails the test instead of hanging it.
    get: (path, headers = {}) =>
      new Promise((resolve, reject) => {
        const req = http.get(
          { host: '127.0.0.1', port, path: `/api/hub${path}`, headers },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () =>
              resolve({
                status: res.statusCode,
                headers: res.headers,
                text: Buffer.concat(chunks).toString(),
              }),
            );
          },
        );
        req.on('error', reject);
        req.setTimeout(REQUEST_LIMIT_MS, () => {
          req.destroy(
            new Error(
              `no complete response from ${path} within ${REQUEST_LIMIT_MS} ms`,
            ),
          );
        });
      }),
    // Status line and headers only (for streams, which never end on their own).
    head: (path) =>
      new Promise((resolve, reject) => {
        const req = http.get(
          { host: '127.0.0.1', port, path: `/api/hub${path}` },
          (res) => {
            res.resume();
            resolve({ status: res.statusCode, headers: res.headers, req });
          },
        );
        req.on('error', reject);
        req.setTimeout(REQUEST_LIMIT_MS, () => {
          req.destroy(
            new Error(
              `no response headers from ${path} within ${REQUEST_LIMIT_MS} ms`,
            ),
          );
        });
      }),
    request: (method, path) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: `/api/hub${path}`, method },
          (res) => {
            res.resume();
            res.on('end', () =>
              resolve({ status: res.statusCode, headers: res.headers }),
            );
          },
        );
        req.on('error', reject);
        req.end();
      }),
    port,
    close: () => {
      server.closeAllConnections();
      return new Promise((r) => server.close(r));
    },
  };
}

const ok = (body) => (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

test(
  'the target must be a plain loopback http origin with a token',
  { timeout: TEST_LIMIT_MS },
  () => {
    const good = {
      ONEINTOS_LAYERS_URL: 'http://127.0.0.1:8090',
      ONEINTOS_LAYERS_TOKEN: TOKEN,
    };
    assert.deepEqual(resolveHubTarget(good), {
      origin: 'http://127.0.0.1:8090',
      token: TOKEN,
    });
    assert.ok(
      resolveHubTarget({
        ...good,
        ONEINTOS_LAYERS_URL: 'http://localhost:8090/',
      }),
    );
    for (const url of [
      'https://127.0.0.1:8090',
      'http://example.com:8090',
      'http://user:pw@127.0.0.1:8090',
      'http://127.0.0.1:8090/base',
      'http://127.0.0.1:8090/?a=1',
      'not a url',
      '',
    ])
      assert.equal(
        resolveHubTarget({ ...good, ONEINTOS_LAYERS_URL: url }),
        null,
        url,
      );
    assert.equal(
      resolveHubTarget({ ...good, ONEINTOS_LAYERS_TOKEN: '' }),
      null,
    );
    assert.equal(resolveHubTarget({}), null);
  },
);

test(
  'without configuration every route answers 503 and nothing is fetched',
  { timeout: TEST_LIMIT_MS },
  async () => {
    const hub = await mount({});
    const r = await hub.get('/layers');
    assert.equal(r.status, 503);
    assert.deepEqual(JSON.parse(r.text), { error: 'hub_not_configured' });
    await hub.close();
  },
);

test(
  'reads carry the bearer token upstream but never the browser Origin or cookies, and never leak it back',
  { timeout: TEST_LIMIT_MS },
  async () => {
    const up = await fakeUpstream(ok({ layers: [] }));
    const hub = await mount({
      ONEINTOS_LAYERS_URL: up.origin,
      ONEINTOS_LAYERS_TOKEN: TOKEN,
    });
    const r = await hub.get('/layers', {
      Cookie: 'session=secret',
      Authorization: 'Bearer from-browser',
    });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text), { layers: [] });
    assert.equal(up.seen[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(up.seen[0].headers.cookie, undefined);
    assert.equal(up.seen[0].headers.origin, undefined);
    assert.ok(
      !r.text.includes(TOKEN) && !JSON.stringify(r.headers).includes(TOKEN),
    );
    await hub.close();
    await up.close();
  },
);

test(
  'the same-site gate applies: cross-site browser requests are refused before anything is fetched',
  { timeout: TEST_LIMIT_MS },
  async () => {
    const up = await fakeUpstream(ok({}));
    const hub = await mount({
      ONEINTOS_LAYERS_URL: up.origin,
      ONEINTOS_LAYERS_TOKEN: TOKEN,
    });
    for (const headers of [
      { 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'http://evil.example' },
      { Origin: 'null' },
      { 'X-Forwarded-For': 'proxy.example' },
    ]) {
      const r = await hub.get('/layers', headers);
      assert.equal(r.status, 403, JSON.stringify(headers));
    }
    assert.equal(up.seen.length, 0);
    await hub.close();
    await up.close();
  },
);

test(
  'only GET, only the three layer routes, only bbox, time and limit',
  { timeout: TEST_LIMIT_MS },
  async () => {
    const up = await fakeUpstream(ok({}));
    const hub = await mount({
      ONEINTOS_LAYERS_URL: up.origin,
      ONEINTOS_LAYERS_TOKEN: TOKEN,
    });
    assert.equal((await hub.request('POST', '/layers')).status, 405);
    assert.equal((await hub.request('DELETE', '/layers')).status, 405);
    for (const path of [
      '/health',
      '/layers/x/other',
      '/layers/../etc',
      '/layers/UP/features',
      '/',
    ]) {
      assert.equal((await hub.get(path)).status, 404, path);
    }
    assert.equal(
      (await hub.get('/layers/stations/features?token=abc')).status,
      422,
    );
    assert.equal(
      (await hub.get('/layers/stations/features?bbox=<script>')).status,
      422,
    );
    assert.equal(up.seen.length, 0);
    const r = await hub.get(
      '/layers/stations/features?bbox=1,2,3,4&limit=5&time=2026-01-01T00:00:00Z',
    );
    assert.equal(r.status, 200);
    assert.equal(
      up.seen[0].url,
      '/layers/stations/features?bbox=1%2C2%2C3%2C4&limit=5&time=2026-01-01T00%3A00%3A00Z',
    );
    await hub.close();
    await up.close();
  },
);

test(
  'upstream auth failures and failures in general are generic 502s; client errors pass through',
  { timeout: TEST_LIMIT_MS },
  async () => {
    let status = 401;
    const up = await fakeUpstream((req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'x', detail: `secret ${TOKEN}` }));
    });
    const hub = await mount({
      ONEINTOS_LAYERS_URL: up.origin,
      ONEINTOS_LAYERS_TOKEN: TOKEN,
    });
    for (const [code, expected] of [
      [401, 502],
      [403, 502],
      [500, 502],
      [302, 502],
      [422, 422],
      [503, 503],
    ]) {
      status = code;
      const r = await hub.get('/layers');
      assert.equal(r.status, expected, String(code));
      if (expected === 502) assert.ok(!r.text.includes(TOKEN));
    }
    await hub.close();
    await up.close();
    const down = await mount({
      ONEINTOS_LAYERS_URL: 'http://127.0.0.1:9',
      ONEINTOS_LAYERS_TOKEN: TOKEN,
    });
    assert.equal((await down.get('/layers')).status, 502);
    await down.close();
  },
);

test(
  'an oversized upstream body is refused',
  { timeout: TEST_LIMIT_MS },
  async () => {
    const up = await fakeUpstream((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(`{"pad":"${'a'.repeat(1024 * 1024 + 10)}"}`);
    });
    const hub = await mount({
      ONEINTOS_LAYERS_URL: up.origin,
      ONEINTOS_LAYERS_TOKEN: TOKEN,
    });
    const r = await hub.get('/layers');
    assert.equal(r.status, 502);
    assert.deepEqual(JSON.parse(r.text), { error: 'hub_response_too_large' });
    await hub.close();
    await up.close();
  },
);

test(
  'streams pass through, are capped, and closing the client closes upstream',
  { timeout: TEST_LIMIT_MS },
  async () => {
    let open = 0;
    let closed = 0;
    const up = await fakeUpstream((req, res) => {
      open += 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: health\ndata: {"ok":true}\n\n');
      res.on('close', () => {
        closed += 1;
      });
    });
    const hub = await mount({
      ONEINTOS_LAYERS_URL: up.origin,
      ONEINTOS_LAYERS_TOKEN: TOKEN,
    });
    const clients = [];
    for (let i = 0; i < MAX_HUB_STREAMS; i += 1) {
      const res = await new Promise((resolve, reject) => {
        const req = http.get(
          {
            host: '127.0.0.1',
            port: hub.port,
            path: '/api/hub/layers/stations/stream',
          },
          resolve,
        );
        req.on('error', reject);
        clients.push(req);
      });
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'], /text\/event-stream/);
      const first = await new Promise((r) => res.once('data', r));
      assert.match(String(first), /event: health/);
    }
    const over = await hub.head('/layers/stations/stream');
    assert.equal(
      over.status,
      429,
      'the stream beyond the cap must be refused with 429',
    );
    over.req.destroy();
    assert.equal(open, MAX_HUB_STREAMS);
    for (const req of clients) req.destroy();
    for (let i = 0; i < 50 && closed < MAX_HUB_STREAMS; i += 1)
      await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      closed,
      MAX_HUB_STREAMS,
      'upstream connections must close with the clients',
    );
    await hub.close();
    await up.close();
  },
);
