import assert from 'node:assert/strict';
import test from 'node:test';

import { mapBackendComandaToOperationalOrder } from '../src/components/app/data/operationalOrderMapping';

const makeComanda = (overrides: Record<string, unknown> = {}) => ({
  id: 'order-91',
  numero_pedido: 91,
  tipo: 'Retirada',
  identificador: 'Georlan',
  mesa_id: 0,
  garcom_id: 'admin-1',
  criada_por: { nome: 'Admin' },
  criado_em: '2026-09-14T18:30:00Z',
  delivery_status: 'producao',
  lancamentos: [
    {
      id: 'launch-91',
      display_number: '91',
      origem: 'cardapio',
    },
  ],
  itens: [
    {
      id: 'item-burger',
      produto_id: 'burger',
      produto: { nome: 'Burguer Pôr do Sol' },
      preco_unit: 32,
      observacao: '',
      cliente_nome: 'Consumo Geral',
      status: 'preparando',
      lancamento_id: 'launch-91',
      lancamento_display_number: '91',
    },
  ],
  ...overrides,
});

test('operational snapshot preserves the same human identity and channel on KDS items', () => {
  const order = mapBackendComandaToOperationalOrder({
    comanda: makeComanda(),
    liveProdutos: [],
  });

  const item = order.itens[0] as typeof order.itens[number] & {
    displayNumber?: string;
    numeroPedido?: number;
    tipo?: string;
    origemOperacional?: string;
    identificador?: string;
  };

  assert.equal(order.numeroPedido, 91);
  assert.equal(order.origemOperacional, 'cardapio');
  assert.equal(item.displayNumber, '91');
  assert.equal(item.numeroPedido, 91);
  assert.equal(item.tipo, 'Retirada');
  assert.equal(item.origemOperacional, 'cardapio');
  assert.equal(item.identificador, 'Georlan');
  assert.equal(item.comandaId, 'order-91');
});

test('operational snapshot preserves cash change instructions for cashier details', () => {
  const order = mapBackendComandaToOperationalOrder({
    comanda: makeComanda({
      delivery_forma_pagamento: 'dinheiro',
      delivery_troco_para: 100,
    }),
    liveProdutos: [],
  });

  assert.equal(order.paymentMethod, 'dinheiro');
  assert.equal(order.changeFor, 100);
});

test('table launch identity stays human-readable instead of falling back to technical ids', () => {
  const order = mapBackendComandaToOperationalOrder({
    comanda: makeComanda({
      id: 'table-order',
      numero_pedido: 20,
      tipo: 'Consumo no Local',
      identificador: null,
      mesa_id: 4,
      lancamentos: [
        {
          id: 'launch-20-b',
          display_number: '20-B',
          origem: 'garcom',
        },
      ],
      itens: [
        {
          id: 'item-fries',
          produto_id: 'fries',
          produto: { nome: 'Batata da Casa' },
          preco_unit: 18,
          observacao: '',
          cliente_nome: 'Consumo Geral',
          status: 'pronto',
          lancamento_id: 'launch-20-b',
          lancamento_display_number: '20-B',
        },
      ],
    }),
    liveProdutos: [],
  });

  assert.equal((order.itens[0] as any).displayNumber, '20-B');
  assert.equal((order.itens[0] as any).origemOperacional, 'garcom');
});
