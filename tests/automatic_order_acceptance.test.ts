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
  it('filtra candidatos conforme a opcao', () => {
    const pending = order('1', 'pendente');
    assert.deepEqual(getAutomaticallyAcceptableOrders(false, [pending]), []);
    assert.deepEqual(getAutomaticallyAcceptableOrders(true, [pending, order('2', 'producao')]), [pending]);
  });
});
