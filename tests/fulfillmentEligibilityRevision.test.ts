import assert from 'node:assert/strict';
import test from 'node:test';
import { fulfillmentEligibilityRevision } from '../src/components/caixa/orders/fulfillmentEligibilityRevision';

test('carregamento da lista de entregadores não invalida elegibilidade, mas atribuição e alterações do pedido invalidam', () => {
  const order = { id: 'c1', deliveryStatus: 'pronto', total: 25, itens: [{ id: 'i', pago: false }], courierAssignment: { value: null, options: [], loading: true, loadState: 'loading' } };
  const baseline = fulfillmentEligibilityRevision(order);
  assert.equal(fulfillmentEligibilityRevision({ ...order, courierAssignment: { ...order.courierAssignment, options: [{ id: 4, nome: 'Teste' }], loading: false, loadState: 'loaded' } }), baseline);
  assert.notEqual(fulfillmentEligibilityRevision({ ...order, courierAssignment: { ...order.courierAssignment, value: 4 } }), baseline);
  assert.notEqual(fulfillmentEligibilityRevision({ ...order, deliveryStatus: 'transito' }), baseline);
  assert.notEqual(fulfillmentEligibilityRevision({ ...order, itens: [{ id: 'i', pago: true }] }), baseline);
});
