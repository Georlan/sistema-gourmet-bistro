import test from 'node:test';
import assert from 'node:assert/strict';
import {
  observeOperationalFetch,
  isAbortOrCancellation,
  isDiagnosticEndpoint,
  type OperationalSignal,
} from '../src/analytics/operational';
import { rateWebVital } from '../src/analytics/webVitals';

test('isAbortOrCancellation correctly identifies intentional aborts and cancellations', () => {
  const abortedController = new AbortController();
  abortedController.abort();

  assert.equal(isAbortOrCancellation(new Error('fail'), abortedController.signal), true);
  assert.equal(isAbortOrCancellation(new DOMException('The operation was aborted.', 'AbortError'), null), true);
  assert.equal(isAbortOrCancellation(new DOMException('The operation timed out.', 'TimeoutError'), null), true);
  assert.equal(isAbortOrCancellation({ name: 'CanceledError', message: 'canceled by user' }, null), true);
  assert.equal(isAbortOrCancellation(new Error('Request aborted'), null), true);

  // Real network failure without abort should NOT be considered intentional abort
  const activeController = new AbortController();
  assert.equal(isAbortOrCancellation(new TypeError('Failed to fetch'), activeController.signal), false);
  assert.equal(isAbortOrCancellation(new TypeError('NetworkError when attempting to fetch resource.'), null), false);
});

test('observeOperationalFetch suppresses network_error signal when request is aborted via signal', async () => {
  const signals: OperationalSignal[] = [];
  const controller = new AbortController();
  controller.abort();

  const observed = observeOperationalFetch(
    async () => {
      // Simulates WebKit Safari behavior where aborting a socket throws TypeError
      throw new TypeError('Load failed');
    },
    'https://api.test',
    'https://app.test/',
    (signal) => signals.push(signal),
  );

  await assert.rejects(
    observed('https://api.test/pedidos', { signal: controller.signal }),
    (err: unknown) => (err as Error).message === 'Load failed',
  );

  // Must NOT have emitted a network_error because the client intentionally aborted
  assert.equal(signals.length, 0);
});

test('observeOperationalFetch reports real network errors when not aborted', async () => {
  const signals: OperationalSignal[] = [];
  const realError = new TypeError('Failed to fetch');

  const observed = observeOperationalFetch(
    async () => {
      throw realError;
    },
    'https://api.test',
    'https://app.test/',
    (signal) => signals.push(signal),
  );

  await assert.rejects(
    observed('https://api.test/pedidos'),
    (err: unknown) => err === realError,
  );

  assert.equal(signals.length, 1);
  assert.equal(signals[0].outcome, 'network_error');
  assert.equal(signals[0].status, 0);
});

test('isDiagnosticEndpoint identifies testing and simulator endpoints', () => {
  assert.equal(isDiagnosticEndpoint('/api/print-agents/simulator/sources'), true);
  assert.equal(isDiagnosticEndpoint('/api/print-agents/teste_extremo'), true);
  assert.equal(isDiagnosticEndpoint('/health'), true);
  assert.equal(isDiagnosticEndpoint('/comandas/itens/transferir-lote/2'), false);
  assert.equal(isDiagnosticEndpoint('/cardapio/pedidos'), false);
});

test('diagnostic endpoints include is_diagnostic flag in operational signals', async () => {
  const signals: OperationalSignal[] = [];
  const response = new Response(null, { status: 503 });

  const observed = observeOperationalFetch(
    async () => response,
    'https://api.test',
    'https://app.test/',
    (signal) => signals.push(signal),
  );

  await observed('https://api.test/api/print-agents/simulator/sources');

  assert.equal(signals.length, 1);
  assert.equal(signals[0].status, 503);
  assert.equal(signals[0].outcome, 'http_error');
  assert.equal(signals[0].is_diagnostic, true);
});

test('rateWebVital computes ratings according to web standard thresholds', () => {
  assert.equal(rateWebVital('LCP', 2000), 'good');
  assert.equal(rateWebVital('LCP', 3000), 'needs-improvement');
  assert.equal(rateWebVital('LCP', 5000), 'poor');

  assert.equal(rateWebVital('CLS', 0.05), 'good');
  assert.equal(rateWebVital('CLS', 0.15), 'needs-improvement');
  assert.equal(rateWebVital('CLS', 0.35), 'poor');

  assert.equal(rateWebVital('INP', 150), 'good');
  assert.equal(rateWebVital('INP', 350), 'needs-improvement');
  assert.equal(rateWebVital('INP', 600), 'poor');
});
