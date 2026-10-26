import assert from 'node:assert/strict';
import test from 'node:test';
import { createSncfStationsSource } from './source.js';

const jsonResponse = (payload, init = {}) =>
  new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });

test('the source asks the LOCAL proxy, never an upstream URL', async () => {
  const calls = [];
  const source = createSncfStationsSource({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({ stations: [], total: 0 });
    },
  });
  await source.getSnapshot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], '/api/sncf/stations');
  assert.ok(!calls[0].includes('data.sncf.com'));
});

test('a malformed payload is refused rather than shown as an empty layer', async () => {
  const source = createSncfStationsSource({
    fetchImpl: async () => jsonResponse({ nope: true }),
  });
  await assert.rejects(source.getSnapshot(), /Malformed station response/);
});

test('an upstream failure is surfaced with its status', async () => {
  const source = createSncfStationsSource({
    fetchImpl: async () => jsonResponse({ error: 'x' }, { status: 502 }),
  });
  await assert.rejects(source.getSnapshot(), /SNCF HTTP 502/);
});

test('a cancelled request does not resolve', async () => {
  const controller = new AbortController();
  const source = createSncfStationsSource({
    fetchImpl: async () => {
      controller.abort();
      return jsonResponse({ stations: [], total: 0 });
    },
  });
  await assert.rejects(
    source.getSnapshot({ signal: controller.signal }),
    { name: 'AbortError' },
  );
});
