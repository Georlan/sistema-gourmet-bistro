import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackOrderState, orderPhaseDescription, orderProgress } from '../src/cardapio/orderTracking';

test('o andamento não presume que preparo foi iniciado antes do pedido ficar pronto', () => {
  const accepted = fallbackOrderState('aceito', 'delivery');
  assert.match(orderPhaseDescription(accepted), /Aceito/);
  assert.deepEqual(orderProgress(accepted), { labels: ['Recebido', 'Pronto', 'Saiu', 'Concluído'], current: 1 });
  assert.equal(orderProgress(fallbackOrderState('producao', 'delivery'))?.current, 1);
  assert.equal(orderProgress(fallbackOrderState('pronto', 'delivery'))?.current, 2);
  assert.equal(orderProgress(fallbackOrderState('saiu_para_entrega', 'delivery'))?.current, 3);
  assert.equal(orderProgress(fallbackOrderState('finalizado', 'delivery'))?.current, 4);
});

test('pagamento pendente, agendamento e cancelamento não anunciam etapas de produção', () => {
  for (const status of ['aguardando_pagamento', 'falha_pagamento', 'agendado', 'cancelado', 'recusado']) {
    assert.equal(orderProgress(fallbackOrderState(status, 'retirada')), null);
  }
  assert.deepEqual(orderProgress(fallbackOrderState('pronto', 'retirada')), { labels: ['Recebido', 'Pronto', 'Concluído'], current: 2 });
});
