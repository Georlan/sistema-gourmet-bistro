import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignalBudget, observeOperationalFetch, operationalEndpoint, type OperationalSignal } from '../src/analytics/operational';

test('endpoint telemetry removes identifiers, tokens, query strings and third party URLs', () => {
  assert.equal(operationalEndpoint('/api/comandas/private-name/status?token=secret', 'https://api.test', 'https://api.test/'), '/api/comandas/:id/status');
  assert.equal(operationalEndpoint('https://outside.test/api', 'https://api.test', 'https://app.test/'), null);
  assert.equal(operationalEndpoint('/api/caixa/events?token=secret', 'https://api.test', 'https://api.test/'), null);
});

test('signal budget deduplicates polling errors and bounds changing endpoints', () => {
  let time = 0;
  const accept = createSignalBudget(() => time);
  assert.equal(accept('401'), true);
  assert.equal(accept('401'), false);
  for (let i = 0; i < 29; i++) assert.equal(accept(String(i)), true);
  assert.equal(accept('overflow'), false);
  time = 300_000;
  assert.equal(accept('401'), true);
});

test('fetch preserves responses and errors, ignores aborts and never reads bodies', async () => {
  const signals: OperationalSignal[] = [];
  const response = new Response('private response', { status: 500, headers: { 'X-Request-ID': 'abcdef1234567890' } });
  let time = 0;
  const original = async () => { time += 4000; return response; };
  const observed = observeOperationalFetch(original, 'https://api.test', 'https://app.test/', signal => signals.push(signal), () => time);
  assert.equal(await observed('https://api.test/comandas/secret'), response);
  assert.equal(response.bodyUsed, false);
  assert.deepEqual(signals[0], { endpoint: '/comandas/:id', method: 'GET', status: 500, duration_ms: 4000, outcome: 'http_error', request_id: 'abcdef1234567890' });
  await observed('https://api.test/comandas/secret');
  assert.equal(signals.length, 1);
  const failure = new TypeError('private URL');
  const failed = observeOperationalFetch(async () => { throw failure; }, 'https://api.test', 'https://app.test/', signal => signals.push(signal));
  await assert.rejects(failed('https://api.test/pedidos'), error => error === failure);
  assert.equal(signals.at(-1)?.outcome, 'network_error');
  const aborted = observeOperationalFetch(async () => { throw new DOMException('cancelled', 'AbortError'); }, 'https://api.test', 'https://app.test/', () => assert.fail('abort captured'));
  await assert.rejects(aborted('https://api.test/pedidos'));
  const brokenReporter = observeOperationalFetch(async () => response, 'https://api.test', 'https://app.test/', () => { throw Error('analytics down'); });
  assert.equal(await brokenReporter('https://api.test/pedidos'), response);
});
