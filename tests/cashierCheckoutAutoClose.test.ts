import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAutoCloseDigitalOrderAfterPayment } from '../src/components/caixa/checkout/useCheckoutController';
import type { Order } from '../src/types';

const digitalOrder = (extra: Partial<Order> = {}): Order => ({
  id: 'pickup-22',
  numeroPedido: 22,
  mesaId: 0,
  garcomId: 'cashier',
  garcomNome: 'Caixa',
  timestamp: Date.now(),
  tipo: 'retirada',
  deliveryStatus: 'pronto',
  itens: [
    { id: 'item-a', produtoId: 'a', nome: 'Pizza A', preco: 48, observacao: '', clienteNome: 'Cliente', status: 'pronto', pago: false },
    { id: 'item-b', produtoId: 'b', nome: 'Pizza B', preco: 45, observacao: '', clienteNome: 'Cliente', status: 'pronto', pago: false },
  ],
  ...extra,
} as Order);

test('fecha pedido digital quando todos os itens ativos em aberto foram selecionados para pagamento', () => {
  assert.equal(shouldAutoCloseDigitalOrderAfterPayment(digitalOrder(), ['item-a', 'item-b'], 93), true);
});

test('não fecha pedido digital em pagamento parcial', () => {
  assert.equal(shouldAutoCloseDigitalOrderAfterPayment(digitalOrder(), ['item-a'], 48), false);
});

test('ignora itens já pagos ou cancelados ao decidir a finalização', () => {
  const order = digitalOrder({
    valorPago: 45,
    itens: [
      { id: 'item-a', produtoId: 'a', nome: 'Pizza A', preco: 48, observacao: '', clienteNome: 'Cliente', status: 'pronto', pago: false },
      { id: 'item-b', produtoId: 'b', nome: 'Pizza B', preco: 45, observacao: '', clienteNome: 'Cliente', status: 'pronto', pago: true },
      { id: 'item-c', produtoId: 'c', nome: 'Pizza C', preco: 30, observacao: '', clienteNome: 'Cliente', status: 'cancelado', pago: false },
    ],
  });
  assert.equal(shouldAutoCloseDigitalOrderAfterPayment(order, ['item-a'], 48), true);
});

test('nunca usa a regra de auto-fechamento de pedido digital em mesa de salão', () => {
  const table = digitalOrder({ mesaId: 7, tipo: 'Consumo no Local', deliveryStatus: null });
  assert.equal(shouldAutoCloseDigitalOrderAfterPayment(table, ['item-a', 'item-b'], 93), false);
});

test('saldo integral de delivery inclui frete mesmo sem seleção de itens', () => {
  const order = digitalOrder({ deliveryTax: 5, payableTotal: 98 });
  assert.equal(shouldAutoCloseDigitalOrderAfterPayment(order, [], 93), false);
  assert.equal(shouldAutoCloseDigitalOrderAfterPayment(order, [], 98), true);
});
