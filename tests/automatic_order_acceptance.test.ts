import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAutomaticallyAcceptableOrders } from '../src/components/caixa/orders/automaticOrderAcceptance';
import type { DeliveryOrderView } from '../src/components/caixa/orders/cashierWorkspaceTypes';

const order = (id: string, status: DeliveryOrderView['status']): DeliveryOrderView => ({
  id,
  cliente: `Cliente ${id}`,
  telefone: '',
  itens: '1x Item',
  total: 10,
  canal: 'site',
  origemOperacional: 'cardapio',
  isQuickSale: false,
  quantidadeItens: 1,
  modalidade: 'retirada',
  pago: false,
  status,
  criadoEm: '12:00',
});

describe('automatic order acceptance policy', () => {
  it('não aceita nada quando a opção está desligada', () => {
    const candidates = getAutomaticallyAcceptableOrders(false, [order('1', 'pendente')]);
    assert.deepEqual(candidates, []);
  });

  it('aceita somente pedidos pendentes quando a opção está ligada', () => {
    const pending = order('1', 'pendente');
    const candidates = getAutomaticallyAcceptableOrders(true, [
      pending,
      order('2', 'analise'),
      order('3', 'producao'),
      order('4', 'pronto'),
      order('5', 'transito'),
    ]);

    assert.deepEqual(candidates, [pending]);
  });
});
