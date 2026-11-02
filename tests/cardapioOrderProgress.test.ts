import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackOrderState, orderPhaseDescription, orderProgress, customerOrderLabel } from '../src/cardapio/orderTracking';

test('cliente vê ação correta para modalidade mesmo com resumo antigo', () => {
  for (const [type, ready, done] of [
    ['Retirada', 'Pronto para retirar', 'Retirada concluída'],
    ['Delivery', 'Pronto para sair', 'Entrega concluída'],
    ['Consumo no Local', 'Pronto para servir', 'Pedido concluído'],
  ]) {
    const state = fallbackOrderState('pronto', type);
    assert.equal(customerOrderLabel({ ...state, label: 'Pronto' }), ready);
    assert.equal(customerOrderLabel(fallbackOrderState('finalizado', type)), done);
  }
  assert.equal(customerOrderLabel(fallbackOrderState('saiu_para_entrega', 'Delivery')), 'Saiu para entrega');
  assert.match(orderPhaseDescription(fallbackOrderState('pronto', 'Retirada')), /buscar/i);
  assert.equal(customerOrderLabel(fallbackOrderState('aguardando_pagamento', 'Retirada')), 'Aguardando pagamento');
});

test('o andamento não presume que preparo foi iniciado antes do pedido ficar pronto', () => {
  const accepted = fallbackOrderState('aceito', 'delivery');
  assert.match(orderPhaseDescription(accepted), /Aceito/);
  assert.deepEqual(orderProgress(accepted), { labels: ['Recebido', 'Pronto', 'Saiu para entrega', 'Concluído'], current: 1 });
  assert.equal(orderProgress(fallbackOrderState('producao', 'delivery'))?.current, 1);
  assert.equal(orderProgress(fallbackOrderState('pronto', 'delivery'))?.current, 2);
  assert.equal(orderProgress(fallbackOrderState('saiu_para_entrega', 'delivery'))?.current, 3);
  assert.equal(orderProgress(fallbackOrderState('finalizado', 'delivery'))?.current, 4);
});

test('pagamento pendente, agendamento e cancelamento não anunciam etapas de produção', () => {
  for (const status of ['aguardando_pagamento', 'falha_pagamento', 'agendado', 'cancelado', 'recusado']) {
    assert.equal(orderProgress(fallbackOrderState(status, 'retirada')), null);
  }
  assert.deepEqual(orderProgress(fallbackOrderState('pronto', 'retirada')), { labels: ['Recebido', 'Pronto para retirar', 'Concluído'], current: 2 });
});
