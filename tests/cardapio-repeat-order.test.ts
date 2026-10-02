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
          { id: 'bacon', name: 'Bacon', extraPrice: 6, active: true },
          { id: 'cebola', name: 'Cebola', extraPrice: 2, active: true },
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

test('repeat order preserves repeated quantities without consuming extra group types', () => {
  const result = rebuildOrderFromCurrentCatalog(order({
    itens: [{
      produto_id: 'pizza-1',
      nome: 'Pizza antiga',
      quantidade: 1,
      preco_unitario: 40,
      modificadores: [
        { grupo_id: 'borda', opcao_id: 'catupiry', opcao_nome: 'Catupiry', preco_aplicado: 3 },
        { grupo_id: 'extras', opcao_id: 'azeitona', opcao_nome: 'Azeitona', preco_aplicado: 1 },
        { grupo_id: 'extras', opcao_id: 'azeitona', opcao_nome: 'Azeitona', preco_aplicado: 1 },
        { grupo_id: 'extras', opcao_id: 'bacon', opcao_nome: 'Bacon', preco_aplicado: 2 },
      ],
    }],
  }), products);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.items[0].selectedOptions.extras, [
    { id: 'azeitona', name: 'Azeitona', extraPrice: 4 },
    { id: 'azeitona', name: 'Azeitona', extraPrice: 4 },
    { id: 'bacon', name: 'Bacon', extraPrice: 6 },
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
        { grupo_id: 'extras', opcao_id: 'bacon-removido', opcao_nome: 'Bacon antigo', preco_aplicado: 5 },
      ],
    }],
  }), products);

  assert.equal(result.items.length, 1);
  assert.equal(result.skippedItems, 0);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /Bacon antigo/);
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

test('repetir marmita respeita modo e limite atuais, avisando sobre escolhas descartadas', () => {
  const historical = order({ itens: [{ produto_id: 'size-g', nome: 'Marmita G', quantidade: 1, preco_unitario: 25,
    modificadores: Array.from({ length: 3 }, () => ({ grupo_id: 'proteins', opcao_id: 'chicken', opcao_nome: 'Frango', preco_aplicado: 0 })),
  }] });
  const size: Product = { id: 'size-g', name: 'Marmita G', description: '', price: 25, image: '', category: 'Marmita G', isAvailable: true,
    modifierGroups: [{ id: 'proteins', name: 'Proteínas', type: 'obrigatorio', minSelection: 2, maxSelection: 2, selectionMode: 'porcoes',
      options: [{ id: 'chicken', name: 'Frango', extraPrice: 0, active: true }, { id: 'beef', name: 'Carne', extraPrice: 0, active: true }],
    }],
  };
  const portions = rebuildOrderFromCurrentCatalog(historical, [size]);
  assert.equal(portions.items.length, 1);
  assert.equal(portions.items[0].selectedOptions.proteins.length, 2);
  assert.ok(portions.issues.length > 0);
  const distinct: Product = { ...size, modifierGroups: size.modifierGroups!.map(group => ({ ...group, selectionMode: 'tipos' })) };
  const types = rebuildOrderFromCurrentCatalog(historical, [distinct]);
  assert.equal(types.items.length, 0);
  assert.ok(types.issues.some(issue => issue.includes('precisa escolher novamente')));
});

test('repetir Quentinha G com min=0 em todos os grupos nao bloqueia pedido e preserva adicionais pagos', () => {
  const historical = order({
    itens: [{
      produto_id: 'quentinha-g',
      nome: 'Quentinha G',
      quantidade: 1,
      preco_unitario: 17,
      modificadores: [
        { grupo_id: 'proteinas', opcao_id: 'frango', opcao_nome: 'Frango Grelhado', preco_aplicado: 0 },
        { grupo_id: 'adicionais', opcao_id: 'carne_extra', opcao_nome: 'Carne Adicional', preco_aplicado: 5 },
        { grupo_id: 'adicionais', opcao_id: 'ovo_extra', opcao_nome: 'Ovo Adicional', preco_aplicado: 2 },
      ],
    }],
  });

  const quentinhaG: Product = {
    id: 'quentinha-g',
    name: 'Quentinha G',
    description: '',
    price: 10,
    image: '',
    category: 'Marmitas',
    isAvailable: true,
    modifierGroups: [
      {
        id: 'proteinas',
        name: 'Proteínas',
        type: 'opcional',
        minSelection: 0,
        maxSelection: 2,
        selectionMode: 'porcoes',
        options: [
          { id: 'frango', name: 'Frango Grelhado', extraPrice: 0, active: true },
          { id: 'carne', name: 'Carne Assada', extraPrice: 0, active: true },
        ],
      },
      {
        id: 'saladas',
        name: 'Saladas',
        type: 'opcional',
        minSelection: 0,
        maxSelection: 3,
        selectionMode: 'tipos',
        options: [
          { id: 'alface', name: 'Alface', extraPrice: 0, active: true },
        ],
      },
      {
        id: 'guarnicoes',
        name: 'Guarnições',
        type: 'opcional',
        minSelection: 0,
        maxSelection: 20,
        selectionMode: 'porcoes',
        options: [
          { id: 'arroz', name: 'Arroz', extraPrice: 0, active: true },
        ],
      },
      {
        id: 'adicionais',
        name: 'Adicionais pagos',
        type: 'opcional',
        minSelection: 0,
        maxSelection: 20,
        selectionMode: 'porcoes',
        options: [
          { id: 'carne_extra', name: 'Carne Adicional', extraPrice: 5, active: true },
          { id: 'ovo_extra', name: 'Ovo Adicional', extraPrice: 2, active: true },
        ],
      },
    ],
  };

  const result = rebuildOrderFromCurrentCatalog(historical, [quentinhaG]);
  assert.equal(result.skippedItems, 0);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].product.price, 10);
  assert.equal(result.items[0].selectedOptions.proteinas.length, 1);
  assert.equal(result.items[0].selectedOptions.adicionais.length, 2);
  assert.deepEqual(result.items[0].selectedOptions.adicionais, [
    { id: 'carne_extra', name: 'Carne Adicional', extraPrice: 5 },
    { id: 'ovo_extra', name: 'Ovo Adicional', extraPrice: 2 },
  ]);

  // Se o historico nao tinha nenhuma proteina selecionada (min=0), nao deve ser descartado
  const zeroProteins = order({
    itens: [{
      produto_id: 'quentinha-g',
      nome: 'Quentinha G',
      quantidade: 1,
      preco_unitario: 10,
      modificadores: [],
    }],
  });
  const zeroResult = rebuildOrderFromCurrentCatalog(zeroProteins, [quentinhaG]);
  assert.equal(zeroResult.skippedItems, 0);
  assert.equal(zeroResult.items.length, 1);
  assert.deepEqual(zeroResult.issues, []);
});

