import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  LEGACY_ACTIVE_ORDER_STORAGE_KEY,
  StoredOrder,
  fallbackOrderState,
  fetchOrderLiveStatus,
  loadStoredOrders,
  removeStoredOrder,
  resolveOrderState,
  saveStoredOrder,
} from '../src/cardapio/orderTracking';

const mockStorage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = String(value);
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  },
};

beforeEach(() => {
  (globalThis as any).localStorage.clear();
});

test('fallback canônico usa mapa exato sem aceitar substrings parecidas', () => {
  assert.equal(fallbackOrderState('pendente', 'Retirada').status, 'pending');
  assert.equal(fallbackOrderState('producao', 'Retirada').phase, 'preparing');
  assert.equal(fallbackOrderState('pronto', 'Retirada').progress_step, 3);
  assert.equal(fallbackOrderState('transito', 'Delivery').progress_step, 4);
  assert.equal(fallbackOrderState('finalizado', 'Delivery').terminal, true);
  assert.equal(fallbackOrderState('recusado', 'Delivery').rejected, true);
  assert.equal(fallbackOrderState('cancelado', 'Retirada').rejected, true);

  // Um texto arbitrário que apenas contém uma palavra conhecida não pode mudar o estado.
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

test('loadStoredOrders migra com sucesso da chave legada koma_active_order', () => {
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
});

test('saveStoredOrder adiciona múltiplos pedidos e preserva compatibilidade com koma_active_order', () => {
  const order1: StoredOrder = {
    id: 'p-1',
    numero_pedido: '1',
    timestamp: Date.now() - 1000,
    restaurante_id: 1,
    tipo: 'Retirada',
    total: 20,
    idempotency_key: 'k-1',
    status: 'producao',
  };
  const order2: StoredOrder = {
    id: 'p-2',
    numero_pedido: '2',
    timestamp: Date.now(),
    restaurante_id: 1,
    tipo: 'Delivery',
    total: 50,
    idempotency_key: 'k-2',
    status: 'pendente',
  };

  saveStoredOrder(order1);
  saveStoredOrder(order2);

  const loaded = loadStoredOrders(1);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].id, 'p-2');
  assert.equal(loaded[1].id, 'p-1');

  const legacyRaw = localStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY);
  assert.ok(legacyRaw);
  const legacy = JSON.parse(legacyRaw!);
  assert.equal(legacy.id, 'p-2');
});

test('removeStoredOrder remove o pedido específico e atualiza a chave legada', () => {
  const order1: StoredOrder = {
    id: 'p-1',
    numero_pedido: '1',
    timestamp: Date.now() - 1000,
    restaurante_id: 1,
    tipo: 'Retirada',
    total: 20,
    idempotency_key: 'k-1',
    status: 'producao',
  };
  const order2: StoredOrder = {
    id: 'p-2',
    numero_pedido: '2',
    timestamp: Date.now(),
    restaurante_id: 1,
    tipo: 'Delivery',
    total: 50,
    idempotency_key: 'k-2',
    status: 'finalizado',
  };

  saveStoredOrder(order1);
  saveStoredOrder(order2);

  removeStoredOrder('p-2');

  const remaining = loadStoredOrders(1);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'p-1');

  const legacy = JSON.parse(localStorage.getItem(LEGACY_ACTIVE_ORDER_STORAGE_KEY)!);
  assert.equal(legacy.id, 'p-1');
});

test('saveStoredOrder e loadStoredOrders preservam tracking do pedido durante compatibilidade', () => {
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
  assert.equal(loaded[0].tracking_url, '/acompanhar/sec_tok_xyz1234567890abcdef');
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
        status: 'ready',
        phase: 'ready',
        label: 'Pronto',
        fulfillment: 'pickup',
        terminal: false,
        rejected: false,
        can_chat: true,
        can_cancel: false,
        progress_step: 3,
        progress_total: 4,
      },
      restaurante: { id: 2 },
      itens: [{ nome: 'Suco', observacao: 'Sem gelo' }],
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const updated = await fetchOrderLiveStatus({
      id: 'order-1',
      numero_pedido: 1,
      timestamp: Date.now(),
      restaurante_id: 2,
      tipo: 'Retirada',
      total: 10,
      idempotency_key: 'tracking-order-1',
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
