import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  ACTIVE_ORDERS_STORAGE_KEY,
  LEGACY_ACTIVE_ORDER_STORAGE_KEY,
  StoredOrder,
  isRejectedStatus,
  isTerminalStatus,
  loadStoredOrders,
  orderStatusLabel,
  orderStep,
  removeStoredOrder,
  saveStoredOrder,
} from '../src/cardapio/orderTracking';

// Mock localStorage in global scope for node:test environment
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

test('status helpers categorizam corretamente estados canônicos', () => {
  assert.equal(isTerminalStatus('pendente'), false);
  assert.equal(isTerminalStatus('producao'), false);
  assert.equal(isTerminalStatus('pronto'), false);
  assert.equal(isTerminalStatus('transito'), false);
  assert.equal(isTerminalStatus('finalizado'), true);
  assert.equal(isTerminalStatus('entregue'), true);
  assert.equal(isTerminalStatus('recusado'), true);
  assert.equal(isTerminalStatus('cancelado'), true);

  assert.equal(isRejectedStatus('recusado'), true);
  assert.equal(isRejectedStatus('cancelado'), true);
  assert.equal(isRejectedStatus('producao'), false);

  assert.equal(orderStatusLabel('pendente'), 'Aguardando aceite');
  assert.equal(orderStatusLabel('producao'), 'Em preparo');
  assert.equal(orderStatusLabel('pronto'), 'Pronto');
  assert.equal(orderStatusLabel('transito'), 'Saiu para entrega');
  assert.equal(orderStatusLabel('finalizado'), 'Concluído');
  assert.equal(orderStatusLabel('recusado'), 'Pedido não aceito');

  assert.equal(orderStep('pendente'), 1);
  assert.equal(orderStep('producao'), 2);
  assert.equal(orderStep('pronto'), 3);
  assert.equal(orderStep('transito'), 3);
  assert.equal(orderStep('finalizado'), 4);
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
  assert.equal(loaded[0].id, 'p-2'); // mais recente
  assert.equal(loaded[1].id, 'p-1');

  // Checa se a chave legada foi mantida
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
