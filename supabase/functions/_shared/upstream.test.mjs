// Tests for _shared/upstream.ts: the streamed, byte-capped body read
// (Wave-1 review #14) and fetchJson's retry / timeout / cap behaviour.
//
// Runs under BOTH runtimes (the module has no Deno-only syntax or APIs):
//   deno test --allow-env --allow-net=127.0.0.1 supabase/functions/_shared/upstream.test.mjs
//   node --experimental-strip-types --test supabase/functions/_shared/upstream.test.mjs
//
// `.mjs` on purpose (same as photo-signature.test.mjs): Node runs it without
// a TS toolchain, and the repo-level `tsc` (include: **/*.ts) skips it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Breaker, discardBody, fetchJson, readTextCapped, userAgent } from './upstream.ts';

const enc = new TextEncoder();
const noSleep = () => Promise.resolve();

/**
 * A body that yields `chunks` (strings or byte arrays) one pull at a time
 * and records how far it was read and whether it was cancelled. `endless`
 * keeps yielding the last chunk forever.
 */
function trackedStream(chunks, { endless = false } = {}) {
  const state = { pulls: 0, cancelled: false };
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      state.pulls++;
      if (i < chunks.length || endless) {
        const c = chunks[Math.min(i, chunks.length - 1)];
        i++;
        controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      } else {
        controller.close();
      }
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

test('readTextCapped: under the cap -> the whole text and its exact UTF-8 byte count', async () => {
  const r = await readTextCapped(new Response('{"name":"Ayasofya Camii – İstanbul"}'), 1024);
  assert.equal(r.ok, true);
  assert.equal(r.text, '{"name":"Ayasofya Camii – İstanbul"}');
  // 36 chars; "–" is 3 bytes and "İ" 2 bytes in UTF-8.
  assert.equal(r.bytes, enc.encode(r.text).length);
  assert.equal(r.bytes, 39);
});

test('readTextCapped: exactly at the cap is fine, one byte over is too_large', async () => {
  const at = await readTextCapped(new Response('x'.repeat(100)), 100);
  assert.equal(at.ok, true);
  const over = await readTextCapped(new Response('x'.repeat(101)), 100);
  assert.deepEqual(over, { ok: false, reason: 'too_large', bytes: 101 });
});

test('readTextCapped: stops reading and cancels the stream as soon as the cap is passed', async () => {
  const kb = 'y'.repeat(1024);
  const { stream, state } = trackedStream([kb, kb, kb, kb, kb, kb, kb, kb, kb, kb]);
  const r = await readTextCapped(new Response(stream), 2500);
  assert.equal(r.ok, false);
  assert.equal(r.bytes, 3072); // the third chunk tipped it over
  assert.ok(state.pulls <= 4, `read far past the cap: ${state.pulls} pulls`);
  assert.equal(state.cancelled, true);
});

test('readTextCapped: an endless body terminates at the cap instead of buffering forever', async () => {
  const { stream, state } = trackedStream(['z'.repeat(4096)], { endless: true });
  const r = await readTextCapped(new Response(stream), 64 * 1024);
  assert.equal(r.ok, false);
  assert.equal(r.bytes, 64 * 1024 + 4096);
  assert.equal(state.cancelled, true);
});

test('readTextCapped: a declared Content-Length over the cap is refused without reading', async () => {
  const { stream, state } = trackedStream(['small']);
  const res = new Response(stream, { headers: { 'content-length': '999999' } });
  const r = await readTextCapped(res, 1000);
  assert.deepEqual(r, { ok: false, reason: 'too_large', bytes: 999999 });
  assert.equal(state.cancelled, true);
  // A pull may have been primed by the stream machinery, but nothing was consumed as text.
  assert.ok(state.pulls <= 1);
});

test('readTextCapped: a multi-byte character split across chunks decodes intact', async () => {
  const bytes = enc.encode('şehir'); // "ş" = C5 9F
  const { stream } = trackedStream([bytes.slice(0, 1), bytes.slice(1)]);
  const r = await readTextCapped(new Response(stream), 100);
  assert.equal(r.ok, true);
  assert.equal(r.text, 'şehir');
  assert.equal(r.bytes, 6);
});

test('readTextCapped: no cap reads everything; empty / null bodies are empty text', async () => {
  const big = 'b'.repeat(200_000);
  const r = await readTextCapped(new Response(big));
  assert.equal(r.ok, true);
  assert.equal(r.text.length, 200_000);
  assert.deepEqual(await readTextCapped(new Response(null, { status: 204 }), 10), { ok: true, text: '', bytes: 0 });
  assert.deepEqual(await readTextCapped(new Response(''), 10), { ok: true, text: '', bytes: 0 });
});

test('discardBody never throws, even on a consumed body', async () => {
  const res = new Response('abc');
  await res.text();
  await discardBody(res);
  await discardBody(new Response(null));
});

test('fetchJson: parses JSON under the cap and reports the byte count', async () => {
  const r = await fetchJson('https://x.test/a', {
    fetchFn: () => Promise.resolve(new Response('{"ok":true,"t":"ç"}')),
    timeoutMs: 1000,
    maxBytes: 100,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { ok: true, t: 'ç' });
  assert.equal(r.bytes, 20);
  assert.equal(r.attempts, 1);
});

test('fetchJson: an oversized body is too_large, not retried, and the stream is cancelled', async () => {
  let calls = 0;
  const tracked = [];
  const r = await fetchJson('https://x.test/big', {
    fetchFn: () => {
      calls++;
      const t = trackedStream(['['.concat('1,'.repeat(600))], { endless: true });
      tracked.push(t.state);
      return Promise.resolve(new Response(t.stream));
    },
    timeoutMs: 1000,
    retries: 2,
    maxBytes: 10_000,
    sleep: noSleep,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_large');
  assert.equal(r.status, 200);
  assert.equal(calls, 1);
  assert.equal(tracked[0].cancelled, true);
});

test('fetchJson: 5xx is retried (body discarded), 4xx is not; bad JSON is bad_json', async () => {
  const bodies = [];
  let n = 0;
  const flaky = await fetchJson('https://x.test/f', {
    fetchFn: () => {
      n++;
      if (n === 1) {
        const t = trackedStream(['<html>busy</html>']);
        bodies.push(t.state);
        return Promise.resolve(new Response(t.stream, { status: 503 }));
      }
      return Promise.resolve(new Response('[1,2]'));
    },
    timeoutMs: 1000,
    retries: 1,
    sleep: noSleep,
  });
  assert.equal(flaky.ok, true);
  assert.deepEqual(flaky.data, [1, 2]);
  assert.equal(flaky.attempts, 2);
  assert.equal(bodies[0].cancelled, true, 'the 503 page is dropped, not buffered');

  let m = 0;
  const notFound = await fetchJson('https://x.test/nf', {
    fetchFn: () => {
      m++;
      return Promise.resolve(new Response('nope', { status: 404 }));
    },
    timeoutMs: 1000,
    retries: 2,
    sleep: noSleep,
  });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.reason, 'http_404');
  assert.equal(m, 1);

  const bad = await fetchJson('https://x.test/b', {
    fetchFn: () => Promise.resolve(new Response('{not json')),
    timeoutMs: 1000,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'bad_json');
});

test('fetchJson: a body that stalls past the timeout aborts the read -> timeout, not retried', async () => {
  let calls = 0;
  const r = await fetchJson('https://x.test/slow', {
    fetchFn: (_url, init) => {
      calls++;
      // Headers arrive at once; the body never finishes. Like a real fetch,
      // the request's AbortSignal errors the body stream.
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode('{"partial":'));
          init.signal.addEventListener('abort', () =>
            controller.error(new DOMException('The signal has been aborted', 'AbortError')),
          );
        },
      });
      return Promise.resolve(new Response(stream));
    },
    timeoutMs: 50,
    retries: 2,
    sleep: noSleep,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'timeout');
  assert.equal(calls, 1);
});

test('userAgent and Breaker (unchanged behaviour)', () => {
  assert.equal(userAgent('fx-rates'), 'Tripvisor/1.0 (https://tripvisor.pages.dev) fx-rates');
  assert.equal(userAgent('x', 'ops@example.test\n'), 'Tripvisor/1.0 (ops@example.test) x');
  let t = 1000;
  const b = new Breaker(() => t);
  assert.equal(b.isOpen('h'), false);
  b.trip('h', 500);
  assert.equal(b.isOpen('h'), true);
  t = 1600;
  assert.equal(b.isOpen('h'), false);
  b.trip('h', 500);
  b.reset('h');
  assert.equal(b.isOpen('h'), false);
});
