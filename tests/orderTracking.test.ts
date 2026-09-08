import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  ACTIVE_ORDERS_STORAGE_KEY,
  LEGACY_ACTIVE_ORDER_STORAGE_KEY,
  StoredOrder,
  fallbackOrderState,
  fetchOrderLiveStatus,
  loadStoredOrders,
  removeStoredOrder,
  resolveOrderState,
  saveStoredOrder,
} from '../src/cardapio/orderTracking';

function createMockStorage() {
  const values: Record<string, string> = {};
  return {
    getItem: (key: string) => values[key] || null,
    setItem: (key: string, value: string) => {
      values[key] = String(value);
    },
    removeItem: (key: string) => {
      delete values[key];
    },
    clear: () => {
      Object.keys(values).forEach((key) => delete values[key]);
    },
  };
}

(globalThis as any).localStorage = createMockStorage();
(globalThis as any).sessionStorage = createMockStorage();

beforeEach(() => {
  (globalThis as any).localStorage.clear();
  (globalThis as any).sessionStorage.clear();
});

test('fallback canônico usa mapa exato sem aceitar substrings parecidas', () => {
  assert.equal(fallbackOrderState('pendente', 'Retirada').status, 'pending');
  assert.equal(fallbackOrderState('producao', 'Retirada').phase, 'preparing');
  assert.equal(fallbackOrderState('pronto', 'Retirada').progress_step, 3);
  assert.equal(fallbackOrderState('transito', 'Delivery').progress_step, 4);
  assert.equal(fallbackOrderState('finalizado', 'Delivery').terminal, true);
  assert.equal(fallbackOrderState('recusado', 'Delivery').rejected, true);
  assert.equal(fallbackOrderState('cancelado', 'Retirada').rejected, true);

  assert.equal(fallbackOrderState('pedido-finalizado-talvez', 'Delivery').status, 'pending');
  assert.equal(fallbackOrderState('preparando-depois', 'Delivery').status, 'pending');
});

test('resolveOrderState prefere contrato retornado pelo backend', () => {
  const state = resolveOrderState({
    status: 'pendente',
    tipo: 'Retirada',
    state: {
      status: 'completed',
      phase: 'completed',
      label: 'Concluído',
      fulfillment: 'delivery',
      terminal: true,
      rejected: false,
      can_chat: false,
      can_cancel: false,
      progress_step: 5,
      progress_total: 5,
    },
  });

  assert.equal(state.status, 'completed');
  assert.equal(state.fulfillment, 'delivery');
  assert.equal(state.terminal, true);
  assert.equal(state.progress_step, 5);
});

test('loadStoredOrders migra chave legada do localStorage para a sessão', () => {
  localStorage.setItem(
    LEGACY_ACTIVE_ORDER_STORAGE_KEY,
    JSON.stringify({
      id: 'pedido-legado-1',
      numero_pedido: 101,
      timestamp: Date.now(),
      restaurante_id: 1,
      tipo: 'Retirada',
      total: 35.5,
      idempotency_key: 'idemp-101',
      status: 'pendente',
    }),
  );

  const orders = loadStoredOrders(1);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].id, 'pedido-legado-1');
  assert.equal(orders[0].numero_pedido, 101);
  assert.equal(orders[0].total, 35.5);
  assert.equal(localStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY), null);
  assert.ok(sessionStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY));
});

test('saveStoredOrder adiciona múltiplos pedidos somente na sessão', () => {
  const order1: StoredOrder = {
    id: 'p-1', numero_pedido: '1', timestamp: Date.now() - 1000,
    restaurante_id: 1, tipo: 'Retirada', total: 20, idempotency_key: 'k-1', status: 'producao',
  };
  const order2: StoredOrder = {
    id: 'p-2', numero_pedido: '2', timestamp: Date.now(),
    restaurante_id: 1, tipo: 'Delivery', total: 50, idempotency_key: 'k-2', status: 'pendente',
  };

  saveStoredOrder(order1);
  saveStoredOrder(order2);

  const loaded = loadStoredOrders(1);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].id, 'p-2');
  assert.equal(loaded[1].id, 'p-1');

  const legacyRaw = sessionStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY);
  assert.ok(legacyRaw);
  assert.equal(JSON.parse(legacyRaw!).id, 'p-2');
  assert.equal(localStorage.getItem(ACTIVE_ORDERS_STORAGE_KEY), null);
  assert.equal(localStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY), null);
});

test('removeStoredOrder remove o pedido específico e atualiza a chave legada da sessão', () => {
  const order1: StoredOrder = {
    id: 'p-1', numero_pedido: '1', timestamp: Date.now() - 1000,
    restaurante_id: 1, tipo: 'Retirada', total: 20, idempotency_key: 'k-1', status: 'producao',
  };
  const order2: StoredOrder = {
    id: 'p-2', numero_pedido: '2', timestamp: Date.now(),
    restaurante_id: 1, tipo: 'Delivery', total: 50, idempotency_key: 'k-2', status: 'finalizado',
  };

  saveStoredOrder(order1);
  saveStoredOrder(order2);
  removeStoredOrder('p-2');

  const remaining = loadStoredOrders(1);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'p-1');
  assert.equal(JSON.parse(sessionStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY)!).id, 'p-1');
});

test('pedido moderno mantém token opaco somente na sessão e remove duplicatas de segredo', () => {
  const orderWithTracking: StoredOrder = {
    id: 'comanda-1048',
    numero_pedido: 1048,
    timestamp: Date.now(),
    restaurante_id: 1,
    tipo: 'Delivery',
    total: 85.5,
    idempotency_key: 'tracking-comanda-1048',
    status: 'pendente',
    tracking_token: 'sec_tok_xyz1234567890abcdef',
    tracking_url: '/acompanhar/sec_tok_xyz1234567890abcdef',
  };

  saveStoredOrder(orderWithTracking);

  const loaded = loadStoredOrders(1);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].tracking_token, 'sec_tok_xyz1234567890abcdef');
  assert.equal(loaded[0].tracking_url, undefined);
  assert.equal(loaded[0].idempotency_key, '');
  assert.match(sessionStorage.getItem(ACTIVE_ORDERS_STORAGE_KEY) || '', /sec_tok_xyz1234567890abcdef/);
  assert.equal(localStorage.getItem(ACTIVE_ORDERS_STORAGE_KEY), null);
});

test('storage de pedidos não guarda PII nem detalhes de compra', () => {
  saveStoredOrder({
    id: 'private-order',
    numero_pedido: 77,
    timestamp: Date.now(),
    restaurante_id: 1,
    cliente_nome: 'Pessoa Privada',
    cliente_telefone: '85999999999',
    tipo: 'Delivery',
    total: 55,
    idempotency_key: 'should-not-persist-with-token',
    status: 'pendente',
    itens: [{ nome: 'Pedido secreto', quantidade: 2, observacao: 'Sem cebola' }],
    tracking_token: 'opaque-tracking-token',
    tracking_url: '/acompanhar/opaque-tracking-token',
  });

  const raw = sessionStorage.getItem(ACTIVE_ORDERS_STORAGE_KEY) || '';
  assert.match(raw, /opaque-tracking-token/);
  assert.doesNotMatch(raw, /Pessoa Privada/);
  assert.doesNotMatch(raw, /85999999999/);
  assert.doesNotMatch(raw, /Pedido secreto/);
  assert.doesNotMatch(raw, /Sem cebola/);
  assert.doesNotMatch(raw, /should-not-persist-with-token/);
  assert.doesNotMatch(raw, /tracking_url/);
  assert.equal(localStorage.getItem(ACTIVE_ORDERS_STORAGE_KEY), null);
});

test('leitura de registro antigo apaga cópia durável e converte tracking_url para token de sessão', () => {
  localStorage.setItem(ACTIVE_ORDERS_STORAGE_KEY, JSON.stringify([{
    id: 'legacy-private', numero_pedido: 8, timestamp: Date.now(), restaurante_id: 1,
    cliente_nome: 'Nome legado', cliente_telefone: '85111111111', tipo: 'Retirada', total: 12,
    idempotency_key: 'legacy-key', itens: [{ nome: 'Item legado', quantidade: 1 }],
    tracking_url: '/acompanhar/legacy%2Fopaque', status: 'pendente',
  }]));

  const loaded = loadStoredOrders(1);
  assert.equal(loaded[0].tracking_token, 'legacy/opaque');
  assert.equal(loaded[0].idempotency_key, '');

  assert.equal(localStorage.getItem(ACTIVE_ORDERS_STORAGE_KEY), null);
  const migrated = sessionStorage.getItem(ACTIVE_ORDERS_STORAGE_KEY) || '';
  assert.doesNotMatch(migrated, /Nome legado|85111111111|Item legado|legacy-key|tracking_url/);
  assert.match(migrated, /legacy\\\/opaque|legacy\/opaque/);
});

test('tracking secret deixa de existir quando a sessão da aba termina', () => {
  saveStoredOrder({
    id: 'session-order', numero_pedido: 9, timestamp: Date.now(), restaurante_id: 1,
    tipo: 'Delivery', total: 40, idempotency_key: '', status: 'pendente',
    tracking_token: 'session-only-secret',
  });
  assert.equal(loadStoredOrders(1).length, 1);

  sessionStorage.clear();

  assert.deepEqual(loadStoredOrders(1), []);
  assert.equal(localStorage.getItem(ACTIVE_ORDERS_STORAGE_KEY), null);
});

test('tracking seguro prefere state do backend e token opaco', async () => {
  const originalFetch = globalThis.fetch;
  let requested = '';
  globalThis.fetch = (async (url: string) => {
    requested = url;
    return new Response(JSON.stringify({
      id: 'order-1',
      status: 'producao',
      state: {
        status: 'ready', phase: 'ready', label: 'Pronto', fulfillment: 'pickup',
        terminal: false, rejected: false, can_chat: true, can_cancel: false,
        progress_step: 3, progress_total: 4,
      },
      restaurante: { id: 2 },
      itens: [{ nome: 'Suco', observacao: 'Sem gelo' }],
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const updated = await fetchOrderLiveStatus({
      id: 'order-1', numero_pedido: 1, timestamp: Date.now(), restaurante_id: 2,
      tipo: 'Retirada', total: 10, idempotency_key: 'tracking-order-1',
      tracking_token: 'opaque/secure',
    }, 'https://example.test');

    assert.equal(requested, 'https://example.test/api/cardapio/pedidos/acompanhar/opaque%2Fsecure');
    assert.equal(updated?.state?.status, 'ready');
    assert.equal(updated?.state?.progress_step, 3);
    assert.equal(updated?.itens?.[0].observacao, 'Sem gelo');
  } finally {
    globalThis.fetch = originalFetch;
  }
});