import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutDiagnostics, type CheckoutDiagnosticSignal } from '../src/analytics/checkoutDiagnostic';

const id = '1234567890abcdef1234567890abcdef';
test('correlates the request and support code without reading private bodies', () => {
  const signals: CheckoutDiagnosticSignal[] = [];
  let time = 0;
  const begin = createCheckoutDiagnostics(signal => signals.push(signal), () => time, () => id);
  const attempt = begin(99051);
  assert.deepEqual(attempt.headers, { 'X-Request-ID': id });
  attempt.response(new Response('private customer data', { status: 200 }));
  attempt.setStage('submission');
  const response = new Response('private error', { status: 503, headers: { 'X-Request-ID': 'server-request_12' } });
  attempt.response(response);
  time = 2500;
  assert.equal(attempt.finish(attempt.failure(new Error('private text'))), 'server-reque');
  attempt.finish('accepted');
  assert.equal(response.bodyUsed, false);
  assert.deepEqual(signals, [{ restaurant_id: 99051, attempt_id: id, support_code: 'server-reque',
    stage: 'submission', outcome: 'http_error', status: 503, duration_ms: 2500, request_id: 'server-request_12' }]);
});

test('distinguishes uncertain timeouts, network failures, malformed JSON, changed catalog and acceptance', () => {
  const signals: CheckoutDiagnosticSignal[] = [];
  const begin = createCheckoutDiagnostics(signal => signals.push(signal), Date.now, () => id);
  for (const [error, expected] of [[new DOMException('private', 'AbortError'), 'timeout'], [new TypeError('private URL'), 'network_error'], [new SyntaxError('private JSON'), 'invalid_response']] as const) {
    const attempt = begin(99051);
    attempt.setStage('submission');
    attempt.finish(attempt.failure(error));
    assert.equal(signals.at(-1)?.outcome, expected);
    assert.equal(signals.at(-1)?.status, 0);
  }
  const malformed = begin(99051);
  malformed.response(new Response(null, { status: 200 }));
  malformed.finish(malformed.failure(new Error('invalid receipt')));
  assert.equal(signals.at(-1)?.outcome, 'invalid_response');
  begin(99051).finish('catalog_changed');
  begin(99051).finish('accepted');
  assert.equal(signals.at(-1)?.outcome, 'accepted');
  assert.equal(JSON.stringify(signals).includes('private'), false);
});

test('caps ingestion and resets the budget; support remains available above the cap', () => {
  let time = 0;
  let count = 0;
  const begin = createCheckoutDiagnostics(() => count++, () => time, () => id);
  for (let i = 0; i < 25; i++) assert.equal(begin(99051).finish('network_error'), id.slice(0, 12));
  assert.equal(count, 20);
  time = 300_001;
  begin(99051).finish('accepted');
  assert.equal(count, 21);
});

test('failed SDK, missing secure randomness and invalid tenant never interrupt orders', () => {
  const broken = createCheckoutDiagnostics(() => { throw Error('SDK down'); }, Date.now, () => id);
  assert.doesNotThrow(() => broken(99051).finish('accepted'));
  const noCrypto = createCheckoutDiagnostics(() => assert.fail('unexpected event'), Date.now, () => { throw Error('crypto unavailable'); });
  assert.deepEqual(noCrypto(99051).headers, {});
  assert.equal(noCrypto(99051).finish('accepted'), '');
  const invalid = createCheckoutDiagnostics(() => assert.fail('invalid tenant captured'), Date.now, () => id);
  invalid(NaN).finish('accepted');
});
