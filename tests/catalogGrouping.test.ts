import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProductMinStartingPrice,
  groupCategoryProductsForDisplay,
  isGroupedProduct,
  type GroupedDisplayProduct,
} from '../src/cardapio/catalogGrouping';
import type { Product } from '../src/cardapio/CardapioTypes';

test('batata tradicional seleciona tamanho em um card e preserva especial como SKU real', () => {
  const entries = [
    ['p', 'Batata Frita Pequena (200 g)', 12],
    ['m', 'Batata Frita Média (300 g)', 15],
    ['g', 'Batata Frita Grande (400 g)', 18],
    ['especial', 'Batata Frita Especial (300 g)', 24],
    ['file', 'Batata com Filé de Frango', 24],
    ['sol', 'Carne de Sol com Fritas', 28],
  ] as const;
  const products: Product[] = entries.map(([id, name, price]) => ({
    id, name, price, image: '', category: 'Batatas Fritas',
    description: 'Porção de batatas fritas com molho rosé', isAvailable: true,
  }));
  const items = groupCategoryProductsForDisplay('Batatas Fritas', products, '1');
  assert.deepEqual(items.map(item => item.id), ['family-batata-tradicional', 'especial', 'file', 'sol']);
  const family = items[0] as GroupedDisplayProduct;
  assert.ok(isGroupedProduct(family));
  assert.equal(family.name, 'Batata Frita Tradicional');
  assert.equal(family.requiresExplicitVariantSelection, true);
  assert.equal(family.minPrice, 12);
  assert.equal(family.hasVariablePrice, true);
  assert.deepEqual(family.variants.map(v => [v.id, v.label, v.price]),
    [['p', 'Pequena · 200 g', 12], ['m', 'Média · 300 g', 15], ['g', 'Grande · 400 g', 18]]);
  assert.ok(items.slice(1).every(item => !isGroupedProduct(item)));
});

test('groupCategoryProductsForDisplay preserva produtos individuais para outros restaurantes (IDs !== 1)', () => {
  const batatas: Product[] = [
    { id: 'b1', name: 'Batata Simples', price: 15.0, description: '', image: '', category: 'Batatas Fritas', isAvailable: true },
    { id: 'b2', name: 'Batata Rústica', price: 20.0, description: '', image: '', category: 'Batatas Fritas', isAvailable: true },
  ];

  // Outro restaurante (ex: ID 2 ou ID 6)
  const resultForOtherRestaurant = groupCategoryProductsForDisplay('Batatas Fritas', batatas, '2');
  assert.equal(resultForOtherRestaurant.length, 2);
  assert.equal(isGroupedProduct(resultForOtherRestaurant[0]), false);
  assert.equal(resultForOtherRestaurant[0].id, 'b1');
  assert.equal(resultForOtherRestaurant[1].id, 'b2');

  const resultWithoutId = groupCategoryProductsForDisplay('Batatas Fritas', batatas);
  assert.equal(resultWithoutId.length, 2);
  assert.equal(isGroupedProduct(resultWithoutId[0]), false);
});

test('calculateProductMinStartingPrice computa escolhas obrigatórias e ignora opções opcionais', () => {
  const burger: Product = {
    id: 'b1',
    name: 'Burger Gourmet',
    price: 30.0,
    description: '',
    image: '',
    category: 'Lanches',
    isAvailable: true,
    modifierGroups: [
      {
        id: 'ponto-carne',
        name: 'Ponto da carne',
        minSelection: 1,
        maxSelection: 1,
        type: 'obrigatorio',
        options: [
          { id: 'ao-ponto', name: 'Ao ponto', extraPrice: 0, active: true },
          { id: 'bem-passado', name: 'Bem passado', extraPrice: 0, active: true },
        ],
      },
      {
        id: 'adicionais-pagos',
        name: 'Adicionais',
        minSelection: 0,
        maxSelection: 3,
        type: 'opcional',
        options: [
          { id: 'bacon', name: 'Bacon extra', extraPrice: 5.0, active: true },
          { id: 'queijo', name: 'Queijo extra', extraPrice: 4.0, active: true },
        ],
      },
      {
        id: 'acompanhamento-obrigatorio',
        name: 'Escolha seu acompanhamento',
        minSelection: 1,
        maxSelection: 1,
        type: 'obrigatorio',
        options: [
          { id: 'salada', name: 'Salada simples', extraPrice: 2.0, active: true },
          { id: 'fritas', name: 'Batata frita', extraPrice: 4.0, active: true },
        ],
      },
    ],
  };

  // Preço base 30 + ponto (0) + acomp obrigatório mais barato (salada +2) = 32.0 (ignora adicionais opcionais)
  const minStarting = calculateProductMinStartingPrice(burger);
  assert.equal(minStarting, 32.0);
});

test('batata indisponível permanece selecionável somente se disponível, sem falsear preço inicial', () => {
  const products: Product[] = [
    { id: 'p', name: 'Batata Frita Pequena (200 g)', description: '200 g', price: 12, image: '', category: 'Batatas Fritas', isAvailable: false },
    { id: 'm', name: 'Batata Frita Média (300 g)', description: '300 g', price: 15, image: '', category: 'Batatas Fritas', isAvailable: true },
  ];
  const result = groupCategoryProductsForDisplay('Batatas Fritas', products, '1');
  assert.equal(result.length, 1);
  assert.ok(isGroupedProduct(result[0]));
  const family = result[0] as GroupedDisplayProduct;
  assert.equal(family.price, 15);
  assert.deepEqual(family.variants.map(v => v.isAvailable), [false, true]);
});

test('pastel médio e pastelão são dois cards e cada um oferece só sabores com preços reais', () => {
  const flavors = [
    { name: 'Carne de Sol', medium: 7, large: 17 },
    { name: 'Mistão', medium: 7, large: 16 },
    { name: 'Carne Moída', medium: 7, large: 16 },
    { name: 'Sabor Pizza', medium: 7, large: 16 },
    { name: 'Frango', medium: 7, large: 16 },
    { name: 'Três Queijos', medium: 7, large: 16 },
  ];
  const products: Product[] = flavors.flatMap((f, i) => [
    { id: `m-${i}`, name: `Pastel Médio de ${f.name}`, description: f.name, price: f.medium, image: '', category: 'Pastelões e Pastel Médio', isAvailable: true },
    { id: `g-${i}`, name: `Pastelão de ${f.name}`, description: f.name, price: f.large, image: '', category: 'Pastelões e Pastel Médio', isAvailable: true },
  ]);
  const grouped = groupCategoryProductsForDisplay('Pastelões e Pastel Médio', products, '1');
  assert.deepEqual(grouped.map(card => card.name), ['Pastel Médio', 'Pastelão']);
  assert.ok(grouped.every(isGroupedProduct));
  const medio = grouped[0] as GroupedDisplayProduct, grande = grouped[1] as GroupedDisplayProduct;
  assert.equal(medio.price, 7);
  assert.equal(grande.price, 16);
  assert.equal(grande.hasVariablePrice, true);
  assert.equal(medio.requiresExplicitVariantSelection, true);
  assert.equal(grande.requiresExplicitVariantSelection, true);
  assert.deepEqual(medio.variants.map(v => v.price), [7,7,7,7,7,7]);
  assert.deepEqual(grande.variants.map(v => v.price), [17,16,16,16,16,16]);
  assert.deepEqual(medio.variants.map(v => v.label), ['Carne de Sol','Mistão','Carne Moída','Pizza','Frango','Três Queijos']);
  assert.ok(grouped.every(card => !(card as GroupedDisplayProduct).variants.some(v => Boolean(v.product.modifierGroups?.length))));
});

test('groupCategoryProductsForDisplay separa Sucos e Vitaminas em dois cards limpos', () => {
  const drinks: Product[] = [
    { id: 'prod-18', name: 'suco de manga', description: 'suco de 300 ml', price: 5.0, image: 'suco.jpg', category: 'Vitaminas e Sucos', isAvailable: true },
    { id: 'prod-19', name: 'suco de acerola', description: 'suco de 300 ml', price: 5.0, image: 'suco.jpg', category: 'Vitaminas e Sucos', isAvailable: true },
    { id: 'prod-20', name: 'suco de goiaba', description: 'suco de 300 ml', price: 5.0, image: 'suco.jpg', category: 'Vitaminas e Sucos', isAvailable: true },
    { id: 'prod-21', name: 'suco de abacaxi', description: 'suco de 300 ml', price: 5.0, image: 'suco.jpg', category: 'Vitaminas e Sucos', isAvailable: true },
    { id: 'prod-22', name: 'vitamina de abacaxi', description: 'vitamina de 300 ml', price: 6.0, image: 'vit.jpg', category: 'Vitaminas e Sucos', isAvailable: true },
    { id: 'prod-23', name: 'vitamina de manga', description: 'vitamina de 300 ml', price: 6.0, image: 'vit.jpg', category: 'Vitaminas e Sucos', isAvailable: true },
    { id: 'prod-24', name: 'vitamina de acerola', description: 'vitamina de 300 ml', price: 6.0, image: 'vit.jpg', category: 'Vitaminas e Sucos', isAvailable: true },
    { id: 'prod-25', name: 'vitamina de goiaba', description: 'vitamina de 300 ml', price: 6.0, image: 'vit.jpg', category: 'Vitaminas e Sucos', isAvailable: true },
  ];

  const grouped = groupCategoryProductsForDisplay('Vitaminas e Sucos', drinks, '1');
  assert.equal(grouped.length, 2);

  const sucosCard = grouped[0] as GroupedDisplayProduct;
  assert.ok(isGroupedProduct(sucosCard));
  assert.equal(sucosCard.name, 'Sucos Naturais (300 ml)');
  assert.equal(sucosCard.price, 5.0);
  assert.equal(sucosCard.variants.length, 4);
  assert.equal(sucosCard.variants[0].label, 'Manga');

  const vitCard = grouped[1] as GroupedDisplayProduct;
  assert.ok(isGroupedProduct(vitCard));
  assert.equal(vitCard.name, 'Vitaminas Especiais (300 ml)');
  assert.equal(vitCard.price, 6.0);
  assert.equal(vitCard.variants.length, 4);
  assert.equal(vitCard.variants[0].label, 'Abacaxi');
});

test('groupCategoryProductsForDisplay agrupa Refrigerantes 1L em um unico card', () => {
  const refris: Product[] = [
    { id: 'prod-26', name: 'refrigerante guaraná', description: 'refrigerante guaraná  1L', price: 9.0, image: 'guarana.jpg', category: 'Refrigerantes', isAvailable: true },
    { id: 'prod-27', name: 'refrigerante Pepsi', description: 'refrigerante Pepsi 1L', price: 9.0, image: 'pepsi.jpg', category: 'Refrigerantes', isAvailable: true },
    { id: 'prod-28', name: 'refrigerante sukita', description: 'refrigerante sukita 1L', price: 9.0, image: 'sukita.jpg', category: 'Refrigerantes', isAvailable: true },
  ];

  const grouped = groupCategoryProductsForDisplay('Refrigerantes', refris, '1');
  assert.equal(grouped.length, 1);
  const card = grouped[0] as GroupedDisplayProduct;
  assert.ok(isGroupedProduct(card));
  assert.equal(card.name, 'Refrigerante 1L');
  assert.equal(card.price, 9.0);
  assert.equal(card.variants.length, 3);
  assert.equal(card.variants[0].label, 'Guaraná');
  assert.equal(card.variants[1].label, 'Pepsi');
  assert.equal(card.variants[2].label, 'Sukita');
});

test('groupCategoryProductsForDisplay mantem Hambúrgueres como produtos individuais', () => {
  const burgers: Product[] = [
    { id: 'prod-01', name: 'X-hambúrguer', description: 'brioche e carne', price: 10.0, image: 'b1.jpg', category: 'Hambúrgueres', isAvailable: true },
    { id: 'prod-02', name: 'X-Burguer', description: 'brioche e ovo', price: 12.0, image: 'b2.jpg', category: 'Hambúrgueres', isAvailable: true },
  ];

  const grouped = groupCategoryProductsForDisplay('Hambúrgueres', burgers, '1');
  assert.equal(grouped.length, 2);
  assert.equal(isGroupedProduct(grouped[0]), false);
  assert.equal(isGroupedProduct(grouped[1]), false);
});
