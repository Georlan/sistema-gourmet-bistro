import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  fetchCardapioDigitalConfig,
  invalidateCardapioDigitalConfigCache,
} from '../src/components/caixa/online-menu/cardapioDigitalConfigClient';
import { startPendingPixPolling } from '../src/components/caixa/orders/pendingPixPolling';

test('fetchCardapioDigitalConfig coalesces concurrent calls, scopes by token, and invalidates cleanly', async () => {
  invalidateCardapioDigitalConfigCache();
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const auth = (init?.headers as Record<string, string>)?.Authorization || '';
    return new Response(JSON.stringify({ id: 7, slug: auth === 'Bearer a' ? 'loja-a' : 'loja-b' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const [first, second] = await Promise.all([
      fetchCardapioDigitalConfig<{ slug: string }>('https://api.test', 'Bearer a', { restaurantId: 7 }),
      fetchCardapioDigitalConfig<{ slug: string }>('https://api.test', 'Bearer a', { restaurantId: 7 }),
    ]);
    assert.equal(calls, 1);
    assert.equal(first.slug, 'loja-a');
    assert.equal(second.slug, 'loja-a');

    // Different authorization token must not reuse previous tenant/session cache
    const other = await fetchCardapioDigitalConfig<{ slug: string }>('https://api.test', 'Bearer b', { restaurantId: 7 });
    assert.equal(calls, 2);
    assert.equal(other.slug, 'loja-b');

    // Invalidation forces next read to hit network
    invalidateCardapioDigitalConfigCache();
    await fetchCardapioDigitalConfig<{ slug: string }>('https://api.test', 'Bearer a', { restaurantId: 7 });
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCardapioDigitalConfigCache();
  }
});

test('startPendingPixPolling passes force=true on payments events and invalidate()', async () => {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const fakeDoc = {
    hidden: false,
    addEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
      const set = listeners.get(type) ?? new Set();
      set.add(cb as (event: Event) => void);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(cb as (event: Event) => void);
    },
  };
  const fakeWin = {
    addEventListener: fakeDoc.addEventListener,
    removeEventListener: fakeDoc.removeEventListener,
  };

  const calls: Array<boolean | undefined> = [];
  const polling = startPendingPixPolling(
    async (_signal, force) => {
      calls.push(force);
      return 0;
    },
    fakeDoc as unknown as Document,
    fakeWin as unknown as Window,
    () => true,
  );

  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, [false]);

  const paymentEvent = new CustomEvent('koma_orders_updated', { detail: { scope: 'payments' } });
  for (const cb of listeners.get('koma_orders_updated') ?? []) cb(paymentEvent);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.at(-1), true);

  polling.invalidate();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.at(-1), true);

  polling.stop();
});

test('CaixaPanel gates loyalty customers load and motoboys reload on active state', () => {
  const caixaPanel = fs.readFileSync(path.resolve('src/components/CaixaPanel.tsx'), 'utf8');
  const realtimeHook = fs.readFileSync(path.resolve('src/components/caixa/realtime/useCashierRealtime.ts'), 'utf8');

  assert.match(caixaPanel, /enabled:\s*activeTab === 'clientes' \|\| hasOpenedCheckout/);
  assert.match(caixaPanel, /motoboysLoadState,/);
  assert.match(realtimeHook, /needsCouriers && \(motoboysLoadState === 'idle' \|\| motoboysLoadState === 'error'\)/);
});
