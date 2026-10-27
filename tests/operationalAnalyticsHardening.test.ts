import test from 'node:test';
import assert from 'node:assert/strict';
import {
  observeOperationalFetch,
  isAbortOrCancellation,
  isDiagnosticEndpoint,
  operationalEndpoint,
  type OperationalSignal,
} from '../src/analytics/operational';
import { rateWebVital } from '../src/analytics/webVitals';

test('isAbortOrCancellation correctly identifies intentional aborts and cancellations', () => {
  const abortedController = new AbortController();
  abortedController.abort();

  assert.equal(isAbortOrCancellation(new Error('fail'), abortedController.signal), true);
  assert.equal(isAbortOrCancellation(new DOMException('The operation was aborted.', 'AbortError'), null), true);
  assert.equal(isAbortOrCancellation({ name: 'CanceledError', message: 'canceled by user' }, null), true);
  assert.equal(isAbortOrCancellation(new Error('Request aborted'), null), true);

  // Timeouts are REAL operational failures, NOT intentional cancellations
  assert.equal(isAbortOrCancellation(new DOMException('The operation timed out.', 'TimeoutError'), null), false);
  assert.equal(isAbortOrCancellation(new Error('Request timed out'), null), false);

  const timeoutController = new AbortController();
  timeoutController.abort(new DOMException('The operation timed out.', 'TimeoutError'));
  assert.equal(isAbortOrCancellation(new Error('timeout'), timeoutController.signal), false);

  // Real network failure without abort should NOT be considered intentional abort
  const activeController = new AbortController();
  assert.equal(isAbortOrCancellation(new TypeError('Failed to fetch'), activeController.signal), false);
  assert.equal(isAbortOrCancellation(new TypeError('NetworkError when attempting to fetch resource.'), null), false);
});

test('isAbortOrCancellation does not suppress errors when document is hidden', () => {
  const origDoc = globalThis.document;
  try {
    // @ts-expect-error test mock
    globalThis.document = { visibilityState: 'hidden' };
    assert.equal(isAbortOrCancellation(new TypeError('Failed to fetch'), null), false);
    assert.equal(isAbortOrCancellation(new DOMException('The operation timed out.', 'TimeoutError'), null), false);
  } finally {
    globalThis.document = origDoc;
  }
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

test('observeOperationalFetch reports real network errors even when page is hidden', async () => {
  const origDoc = globalThis.document;
  try {
    // @ts-expect-error test mock
    globalThis.document = { visibilityState: 'hidden' };
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
  } finally {
    globalThis.document = origDoc;
  }
});

test('observeOperationalFetch reports timeout / expired requests as network_error', async () => {
  const signals: OperationalSignal[] = [];
  const timeoutError = new DOMException('The operation timed out.', 'TimeoutError');

  const observed = observeOperationalFetch(
    async () => {
      throw timeoutError;
    },
    'https://api.test',
    'https://app.test/',
    (signal) => signals.push(signal),
  );

  await assert.rejects(
    observed('https://api.test/pedidos'),
    (err: unknown) => err === timeoutError,
  );

  assert.equal(signals.length, 1);
  assert.equal(signals[0].outcome, 'network_error');
  assert.equal(signals[0].status, 0);
});

test('operationalEndpoint and isDiagnosticEndpoint preserve diagnostic path segments', () => {
  const apiOrigin = 'https://api.test';
  const pageUrl = 'https://app.test/';

  assert.equal(operationalEndpoint('https://api.test/api/print-agents/teste_extremo', apiOrigin, pageUrl), '/api/print-agents/teste_extremo');
  assert.equal(operationalEndpoint('https://api.test/health', apiOrigin, pageUrl), '/health');
  assert.equal(operationalEndpoint('https://api.test/ping', apiOrigin, pageUrl), '/ping');
  assert.equal(operationalEndpoint('https://api.test/api/print-agents/simulator/sources', apiOrigin, pageUrl), '/api/print-agents/simulator/sources');

  assert.equal(isDiagnosticEndpoint('/api/print-agents/simulator/sources'), true);
  assert.equal(isDiagnosticEndpoint('/api/print-agents/teste_extremo'), true);
  assert.equal(isDiagnosticEndpoint('/health'), true);
  assert.equal(isDiagnosticEndpoint('/ping'), true);
  assert.equal(isDiagnosticEndpoint('/comandas/itens/transferir-lote/2'), false);
  assert.equal(isDiagnosticEndpoint('/cardapio/pedidos'), false);
});

test('observeOperationalFetch end-to-end tags diagnostics and preserves commercial errors', async () => {
  const diagnosticPaths = [
    '/api/print-agents/teste_extremo',
    '/health',
    '/ping',
    '/api/print-agents/simulator/sources',
  ];

  for (const path of diagnosticPaths) {
    const signals: OperationalSignal[] = [];
    const observed = observeOperationalFetch(
      async () => new Response(null, { status: 503 }),
      'https://api.test',
      'https://app.test/',
      (signal) => signals.push(signal),
    );

    await observed(`https://api.test${path}`);

    assert.equal(signals.length, 1, `Expected signal for ${path}`);
    assert.equal(signals[0].status, 503);
    assert.equal(signals[0].is_diagnostic, true, `Expected is_diagnostic: true for ${path}`);
    assert.equal(signals[0].endpoint, path, `Expected endpoint ${path}`);
  }

  // Commercial request with error must NOT be tagged as diagnostic
  const commercialSignals: OperationalSignal[] = [];
  const observedCommercial = observeOperationalFetch(
    async () => new Response(null, { status: 500 }),
    'https://api.test',
    'https://app.test/',
    (signal) => commercialSignals.push(signal),
  );

  await observedCommercial('https://api.test/comandas/itens/transferir-lote/2');

  assert.equal(commercialSignals.length, 1);
  assert.equal(commercialSignals[0].status, 500);
  assert.equal(commercialSignals[0].outcome, 'http_error');
  assert.equal(commercialSignals[0].is_diagnostic, undefined, 'Commercial error must not be tagged as diagnostic');
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

