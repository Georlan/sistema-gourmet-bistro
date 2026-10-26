import assert from 'node:assert/strict';
import test from 'node:test';
import { startPendingPixPolling } from '../src/components/caixa/orders/pendingPixPolling';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
class Page extends EventTarget { hidden = false; }

test('empty cashier reduces safety reads by 75%, then a payment event reconciles immediately', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const page = new Page();
  const browser = new EventTarget();
  let pending = 0;
  let calls = 0;
  const polling = startPendingPixPolling(async () => { calls++; return pending; }, page, browser, () => true);
  await flush();
  for (let i = 0; i < 16; i++) { t.mock.timers.tick(15_000); await flush(); }
  assert.equal(calls, 5); // Initial + 4 safety reads, instead of initial + 16.
  pending = 1;
  browser.dispatchEvent(new Event('koma_orders_updated'));
  await flush();
  assert.equal(calls, 6);
  t.mock.timers.tick(15_000);
  await flush();
  assert.equal(calls, 7); // Pending receipts retain the existing cadence.
  polling.stop();
});

test('missed payment event is recovered by the bounded empty-list safety read', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  let pending = 0;
  const observed: number[] = [];
  const polling = startPendingPixPolling(async () => { observed.push(pending); return pending; }, new Page(), new EventTarget(), () => true);
  await flush();
  pending = 1;
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(15_000); await flush(); }
  assert.deepEqual(observed, [0, 1]);
  polling.stop();
});

test('hidden/offline cashier pauses and return reconciles once despite paired visibility/focus events', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const page = new Page();
  const browser = new EventTarget();
  let online = false;
  let calls = 0;
  const polling = startPendingPixPolling(async () => { calls++; return 1; }, page, browser, () => online);
  t.mock.timers.tick(60_000); await flush();
  assert.equal(calls, 0);
  online = true;
  browser.dispatchEvent(new Event('online')); await flush();
  assert.equal(calls, 1);
  page.hidden = true;
  for (let i = 0; i < 8; i++) { t.mock.timers.tick(15_000); await flush(); }
  browser.dispatchEvent(new Event('koma_orders_updated')); await flush();
  assert.equal(calls, 1);
  page.hidden = false;
  page.dispatchEvent(new Event('visibilitychange'));
  browser.dispatchEvent(new Event('focus')); await flush();
  assert.equal(calls, 2);
  polling.stop();
  browser.dispatchEvent(new Event('koma_orders_updated'));
  t.mock.timers.tick(120_000); await flush();
  assert.equal(calls, 2);
});

test('in-flight invalidations coalesce; a salon-only event does not fetch payments', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const browser = new EventTarget();
  let release!: () => void;
  let calls = 0;
  const polling = startPendingPixPolling(async () => {
    calls++;
    if (calls === 1) await new Promise<void>(resolve => { release = resolve; });
    return 0;
  }, new Page(), browser, () => true);
  const salon = new Event('koma_orders_updated');
  Object.assign(salon, { detail: { resources: ['salon'] } });
  browser.dispatchEvent(salon);
  for (let i = 0; i < 10; i++) browser.dispatchEvent(new Event('koma_orders_updated'));
  await flush(); assert.equal(calls, 1);
  release(); await flush(); assert.equal(calls, 2);
  browser.dispatchEvent(salon); await flush(); assert.equal(calls, 2);
  polling.stop();
});

test('hung or failed transport cannot block recovery or apply an old-tenant result after cleanup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const signals: AbortSignal[] = [];
  let release!: () => void;
  let applied = 0;
  const polling = startPendingPixPolling(async signal => {
    signals.push(signal);
    if (signals.length === 1) await new Promise<void>(resolve => { release = resolve; });
    if (signals.length === 2) throw new Error('temporary network failure');
    if (!signal.aborted) applied++;
    return 0;
  }, new Page(), new EventTarget(), () => true);
  t.mock.timers.tick(15_000); await flush();
  assert.equal(signals[0].aborted, true);
  t.mock.timers.tick(15_000); await flush();
  assert.equal(signals.length, 2);
  t.mock.timers.tick(15_000); await flush();
  assert.equal(signals.length, 3);
  assert.equal(applied, 1);
  polling.stop(); release(); await flush();
  assert.equal(applied, 1);
});

test('changing tenant aborts the old reader and starts a separate authenticated reconciliation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  const page = new Page();
  const browser = new EventTarget();
  let oldSignal!: AbortSignal;
  const old = startPendingPixPolling(async signal => {
    oldSignal = signal;
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return 0;
  }, page, browser, () => true);
  old.stop();
  let reads = 0;
  const current = startPendingPixPolling(async signal => { assert.equal(signal.aborted, false); reads++; return 0; }, page, browser, () => true);
  await flush();
  assert.equal(oldSignal.aborted, true);
  assert.equal(reads, 1);
  current.stop();
});
