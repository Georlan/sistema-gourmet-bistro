import assert from 'node:assert/strict';
import test from 'node:test';

import { rebuildOrderFromCurrentCatalog } from '../src/cardapio/repeatOrder';
import type { Product } from '../src/cardapio/CardapioTypes';
import type { CustomerHistoryOrder } from '../src/cardapio/components/CardapioCustomerOrderHistory';

function order(overrides: Partial<CustomerHistoryOrder> = {}): CustomerHistoryOrder {
  return {
    id: 'order-1',
    numero_pedido: 10,
    tipo: 'Retirada',
    status: 'finalizado',
    state: { terminal: true, label: 'Concluído', fulfillment: 'pickup' },
    total: 50,
    taxa_entrega: 0,
    desconto_cupom: 0,
    desconto_cashback: 0,
    itens: [],
    ...overrides,
  };
}

const products: Product[] = [
  {
    id: 'pizza-1',
    name: 'Pizza Atual',
    description: '',
    price: 60,
    image: '',
    category: 'Pizzas',
    isAvailable: true,
    modifierGroups: [
      {
        id: 'borda',
        name: 'Borda',
        minSelection: 1,
        maxSelection: 1,
        type: 'obrigatorio',
        options: [
          { id: 'catupiry', name: 'Catupiry atual', extraPrice: 8, active: true },
          { id: 'cheddar', name: 'Cheddar', extraPrice: 7, active: true },
        ],
      },
      {
        id: 'extras',
        name: 'Extras',
        minSelection: 0,
        maxSelection: 2,
        type: 'opcional',
        options: [
          { id: 'azeitona', name: 'Azeitona', extraPrice: 4, active: true },
        ],
      },
    ],
  },
];

test('repeat order uses current product and modifier prices, preserving quantity and note', () => {
  const result = rebuildOrderFromCurrentCatalog(order({
    itens: [{
      produto_id: 'pizza-1',
      nome: 'Pizza antiga',
      quantidade: 2,
      preco_unitario: 40,
      observacao: 'Bem assada',
      modificadores: [{
        grupo_id: 'borda',
        grupo_nome: 'Borda',
        opcao_id: 'catupiry',
        opcao_nome: 'Catupiry antigo',
        preco_aplicado: 3,
      }],
    }],
  }), products);

  assert.equal(result.skippedItems, 0);
  assert.deepEqual(result.issues, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].product.price, 60);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].notes, 'Bem assada');
  assert.deepEqual(result.items[0].selectedOptions.borda, [
    { id: 'catupiry', name: 'Catupiry atual', extraPrice: 8 },
  ]);
});

test('repeat order drops removed optional add-ons but keeps the product with a warning', () => {
  const result = rebuildOrderFromCurrentCatalog(order({
    itens: [{
      produto_id: 'pizza-1',
      nome: 'Pizza antiga',
      quantidade: 1,
      preco_unitario: 40,
      modificadores: [
        { grupo_id: 'borda', opcao_id: 'catupiry', opcao_nome: 'Catupiry', preco_aplicado: 3 },
        { grupo_id: 'extras', opcao_id: 'bacon-removido', opcao_nome: 'Bacon', preco_aplicado: 5 },
      ],
    }],
  }), products);

  assert.equal(result.items.length, 1);
  assert.equal(result.skippedItems, 0);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /Bacon/);
});

test('repeat order skips products that are gone or now require a missing choice', () => {
  const result = rebuildOrderFromCurrentCatalog(order({
    itens: [
      {
        produto_id: 'missing',
        nome: 'Produto removido',
        quantidade: 1,
        preco_unitario: 10,
        modificadores: [],
      },
      {
        produto_id: 'pizza-1',
        nome: 'Pizza antiga',
        quantidade: 2,
        preco_unitario: 40,
        modificadores: [],
      },
    ],
  }), products);

  assert.equal(result.items.length, 0);
  assert.equal(result.skippedItems, 3);
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0], /não está mais disponível/);
  assert.match(result.issues[1], /precisa escolher novamente/);
});

test('repeat order aggregates equal historical lines into one cart item', () => {
  const repeatedItem = {
    produto_id: 'pizza-1',
    nome: 'Pizza antiga',
    quantidade: 1,
    preco_unitario: 40,
    observacao: '',
    modificadores: [{ grupo_id: 'borda', opcao_id: 'cheddar', opcao_nome: 'Cheddar', preco_aplicado: 2 }],
  };
  const result = rebuildOrderFromCurrentCatalog(order({ itens: [repeatedItem, repeatedItem] }), products);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 2);
});