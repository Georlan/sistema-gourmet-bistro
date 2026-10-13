import assert from 'node:assert/strict';
import test from 'node:test';
import { startPaymentStatusPolling } from '../src/cardapio/paymentStatusPolling';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
class Page extends EventTarget { hidden = false; }

test('stable visible checkout preserves 20 reads per minute; hidden checkout makes zero', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const page = new Page();
  const browser = new EventTarget();
  let calls = 0;
  const stop = startPaymentStatusPolling(async () => { calls++; }, page, browser, () => true);
  await flush();
  assert.equal(calls, 1);
  for (let i = 0; i < 20; i++) { t.mock.timers.tick(3000); await flush(); }
  assert.equal(calls, 21); // Initial read plus 20 periodic reads.
  page.hidden = true;
  page.dispatchEvent(new Event('visibilitychange'));
  for (let i = 0; i < 200; i++) { t.mock.timers.tick(3000); await flush(); }
  assert.equal(calls, 21);
  page.hidden = false;
  page.dispatchEvent(new Event('visibilitychange'));
  browser.dispatchEvent(new Event('focus'));
  await flush();
  assert.equal(calls, 22);
  stop();
  t.mock.timers.tick(30000);
  browser.dispatchEvent(new Event('online'));
  await flush();
  assert.equal(calls, 22);
});

test('offline startup waits; reconnect reads immediately and failures recover without overlap', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const page = new Page();
  const browser = new EventTarget();
  let online = false;
  let calls = 0;
  const stop = startPaymentStatusPolling(async () => { calls++; if (calls === 1) throw Error('network'); }, page, browser, () => online);
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(calls, 0);
  online = true;
  browser.dispatchEvent(new Event('online'));
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(calls, 2);
  stop();
});

test('hung transport is aborted and cannot hold the next read slot or apply late approval', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const page = new Page();
  const browser = new EventTarget();
  const signals: AbortSignal[] = [];
  let release!: () => void;
  let applied = 0;
  const stop = startPaymentStatusPolling(async signal => {
    signals.push(signal);
    if (signals.length === 1) await new Promise<void>(resolve => { release = resolve; });
    if (!signal.aborted) applied++;
  }, page, browser, () => true);
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(3000); await flush(); }
  assert.equal(signals.length, 1);
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(signals[0].aborted, true);
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(signals.length, 2);
  release();
  await flush();
  assert.equal(applied, 1);
  stop();
});

test('cleanup aborts in-flight request; a new order has its own read and cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const page = new Page();
  const browser = new EventTarget();
  const first: AbortSignal[] = [];
  const second: AbortSignal[] = [];
  const stopFirst = startPaymentStatusPolling(async signal => {
    first.push(signal);
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve()));
  }, page, browser, () => true);
  stopFirst();
  const stopSecond = startPaymentStatusPolling(async signal => { second.push(signal); }, page, browser, () => true);
  await flush();
  assert.equal(first[0].aborted, true);
  assert.equal(second.length, 1);
  assert.equal(second[0].aborted, false);
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(first.length, 1);
  assert.equal(second.length, 2);
  stopSecond();
});
