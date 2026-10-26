import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignalBudget, observeOperationalFetch, operationalEndpoint, operationalArea, type OperationalSignal } from '../src/analytics/operational';

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

test('slow signals exclude external requests and streaming responses', async () => {
  let time = 0;
  const signals: OperationalSignal[] = [];
  const observer = observeOperationalFetch(async input => {
    time += 3500;
    return new Response(null, { headers: String(input).includes('streaming') ? { 'content-type': 'text/event-stream' } : {} });
  }, 'https://api.test', 'https://app.test/', signal => signals.push(signal), () => time);
  await observer('https://outside.test/pedidos');
  await observer('https://api.test/streaming');
  assert.equal(signals.length, 0);
  await observer('https://api.test/pedidos?tracking_token=private');
  assert.deepEqual(signals, [{ endpoint: '/pedidos', method: 'GET', status: 200, duration_ms: 3500, outcome: 'slow' }]);
});

test('SaaS billing endpoints retain diagnostic meaning without contract identifiers', () => {
  assert.equal(operationalEndpoint('https://api.test/api/contracts/KOMA-CTR-private/billing/setup?token=secret', 'https://api.test', 'https://app.test/'), '/api/contracts/:id/billing/setup');
});


test('operational correlation accepts every safe request ID accepted by the backend', async () => {
  const signals: OperationalSignal[] = [];
  const response = new Response(null, { status: 422, headers: { 'X-Request-ID': 'req-safe_ID-12' } });
  const observed = observeOperationalFetch(async () => response, 'https://api.test', 'https://app.test/', signal => signals.push(signal));
  await observed('https://api.test/cardapio/pedidos');
  assert.equal(signals[0].request_id, 'req-safe_ID-12');
});


test('shared API signals separate printing, payments, orders and deliveries without personal data', () => {
  for (const [path, area] of [
    ['/api/print-agents/private/jobs', 'printing'], ['/api/comandas/private/reimprimir', 'printing'],
    ['/api/comandas/private/pagamentos', 'payments'], ['/api/contracts/private/billing/setup', 'payments'],
    ['/cardapio/pedidos', 'orders'], ['/api/entregadores/private', 'delivery'],
    ['/api/produtos/private', 'catalog'], ['/auth/login', 'auth'], ['/something/private', 'other'],
  ]) {
    const endpoint = operationalEndpoint(`https://api.test${path}?token=secret`, 'https://api.test', 'https://app.test/')!;
    assert.equal(operationalArea(endpoint), area);
    assert.equal(endpoint.includes('private'), false);
    assert.equal(endpoint.includes('secret'), false);
  }
});
