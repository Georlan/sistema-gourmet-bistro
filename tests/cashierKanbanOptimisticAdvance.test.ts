import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/components/caixa/orders/useCashierOrders.ts', import.meta.url),
  'utf8',
);

test('avanço digital projeta o próximo status antes do round-trip e bloqueia clique concorrente', () => {
  const handlerStart = source.indexOf('const handleUpdateDeliveryStatus');
  const optimisticWrite = source.indexOf('setDeliveryOrders((current) =>', handlerStart);
  const mutationFetch = source.indexOf("method: 'PUT'", handlerStart);

  assert.ok(handlerStart >= 0, 'handler de status digital deve existir');
  assert.ok(optimisticWrite > handlerStart, 'deve existir projeção otimista no estado local');
  assert.ok(mutationFetch > optimisticWrite, 'projeção otimista precisa ocorrer antes do PUT ao backend');
  assert.match(source, /if \(pendingDeliveryMutationRef\.current\[orderKey\]\) return false;/);
});

test('leituras e realtime não sobrescrevem mutação pendente e respostas antigas são invalidadas', () => {
  assert.match(source, /const pending = pendingDeliveryMutationRef\.current\[String\(order\.id\)\];/);
  assert.match(source, /pending\?\.status \? \{ \.\.\.order, status: pending\.status \} : order/);

  const invalidations = source.match(/deliveryOrdersRequestRef\.current \+= 1;/g) || [];
  assert.ok(invalidations.length >= 2, 'leituras anteriores e disparadas durante a mutação devem ser invalidadas');
});

test('falha do backend restaura snapshot anterior e força reconciliação segura', () => {
  assert.match(source, /const rollbackCurrentMutation = \(\) =>/);
  assert.match(source, /String\(order\.id\) === orderKey \? previousOrder : order/);
  assert.match(source, /void fetchDeliveryOrders\(\);/);
  assert.match(source, /errorData\?\.detail \|\| 'Erro ao atualizar status do pedido\.'/);
});

test('reconstrução do #319 não ressuscita polling paralelo de 5 segundos', () => {
  assert.doesNotMatch(source, /setInterval[\s\S]{0,180}5000/);
});
