import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isPendingDeliveryComanda, projectApiComandaToDeliveryView } from '../src/components/caixa/orders/deliveryOrderProjection';

const rawOrder = (delivery_status: string, id: string) => ({
  id, tipo: 'Delivery', delivery_status, fechada: false,
  identificador: `Pedido ${id}`, criado_em: '2026-11-14T12:00:00Z',
  itens: [{ id: `${id}-item`, status: 'pronto', preco_unit: 15, produto: { nome: 'Prato' } }],
  lancamentos: [{ id: `${id}-launch`, origem: 'cardapio' }],
});

test('fila de aceite é subconjunto exato do snapshot ativo do backend', () => {
  const snapshot = ['pendente', 'analise', 'recebido', 'pending', 'aceito', 'producao', 'pronto', 'transito']
    .map((status, index) => rawOrder(status, `order-${index}`));
  const pending = snapshot.filter(isPendingDeliveryComanda);
  assert.deepEqual(pending.map((order) => order.delivery_status), ['pendente', 'analise', 'recebido', 'pending']);
  const projected = pending.map(projectApiComandaToDeliveryView).filter(Boolean);
  // Keep legacy projection behavior: only normalized, supported statuses are shown.
  assert.deepEqual(projected.map((order) => order?.status), ['pendente', 'analise']);
  assert.equal(isPendingDeliveryComanda(null), false);
});

test('Caixa lê uma projeção autoritativa para pedidos ativos e pendentes', () => {
  const file = readFileSync(new URL('../src/components/caixa/orders/useCashierOrders.ts', import.meta.url), 'utf8');
  const read = file.slice(file.indexOf('const readDeliveryOrders = async'), file.indexOf('const deliveryReadRef'));
  assert.match(read, /\/comandas\/delivery\/ativos/);
  assert.doesNotMatch(read, /\/comandas\/delivery\/pendentes/);
  assert.match(read, /data\.filter\(isPendingDeliveryComanda\)/);
  assert.match(read, /pendingDeliveryMutationRef\.current/);
});
