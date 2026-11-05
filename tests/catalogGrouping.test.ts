import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupCategoryProductsForDisplay,
  isGroupedProduct,
  type GroupedDisplayProduct,
} from '../src/cardapio/catalogGrouping';
import type { Product } from '../src/cardapio/CardapioTypes';

test('groupCategoryProductsForDisplay agrupa Batatas Fritas em um unico card principal', () => {
  const batatas: Product[] = [
    {
      id: 'prod-je-08',
      name: 'Batata Frita',
      description: 'Batata frita com molho rosê',
      price: 12.0,
      image: 'img-08.jpg',
      category: 'Batatas Fritas',
      isAvailable: true,
      modifierGroups: [
        {
          id: 'grp-tamanho',
          name: 'Tamanho',
          minSelection: 1,
          maxSelection: 1,
          type: 'obrigatorio',
          options: [
            { id: 'p', name: 'Pequena (200 g)', extraPrice: 0, active: true },
            { id: 'm', name: 'Média (300 g)', extraPrice: 3, active: true },
            { id: 'g', name: 'Grande (400 g)', extraPrice: 6, active: true },
          ],
        },
      ],
    },
    {
      id: 'prod-je-09',
      name: 'batata frita especial',
      description: '300 g com bacon ou calabresa',
      price: 24.0,
      image: 'img-09.jpg',
      category: 'Batatas Fritas',
      isAvailable: true,
      modifierGroups: [
        {
          id: 'grp-acomp',
          name: 'Escolha o acompanhamento',
          minSelection: 1,
          maxSelection: 1,
          type: 'obrigatorio',
          options: [
            { id: 'bacon', name: 'Bacon', extraPrice: 0, active: true },
            { id: 'calabresa', name: 'Calabresa', extraPrice: 0, active: true },
          ],
        },
      ],
    },
    {
      id: 'prod-je-10',
      name: 'batata com filé com frita',
      description: '300 g batata 200 g filé de frango',
      price: 24.0,
      image: 'img-10.jpg',
      category: 'Batatas Fritas',
      isAvailable: true,
    },
    {
      id: 'prod-je-11',
      name: 'carne de sol com fritas',
      description: '300 g batata com carne de sol e queijo coalho',
      price: 28.0,
      image: 'img-11.jpg',
      category: 'Batatas Fritas',
      isAvailable: true,
    },
  ];

  const grouped = groupCategoryProductsForDisplay('Batatas Fritas', batatas);
  assert.equal(grouped.length, 1);
  const card = grouped[0];
  assert.ok(isGroupedProduct(card));
  assert.equal(card.name, 'Batata Frita');
  assert.equal(card.minPrice, 12.0);
  assert.equal(card.hasVariablePrice, true);
  assert.equal(card.variants.length, 4);

  // Labels amigáveis
  assert.equal(card.variants[0].label, 'Tradicional (com Molho Rosê)');
  assert.equal(card.variants[1].label, 'Especial (Bacon ou Calabresa)');
  assert.equal(card.variants[2].label, 'Com Filé de Frango (200 g)');
  assert.equal(card.variants[3].label, 'Com Carne de Sol e Queijo Coalho');

  // Cada variante preserva o produto real com seus modificadores
  assert.equal(card.variants[0].product.id, 'prod-je-08');
  assert.equal(card.variants[0].product.modifierGroups?.length, 1);
  assert.equal(card.variants[1].product.id, 'prod-je-09');
  assert.equal(card.variants[1].product.modifierGroups?.length, 1);
  assert.equal(card.variants[3].product.id, 'prod-je-11');
});

test('groupCategoryProductsForDisplay agrupa Pasteis unificando os 6 sabores', () => {
  const pasteis: Product[] = [
    { id: 'prod-je-12', name: 'Pastel de Carne de Sol', description: 'carne de sol, queijo e catupiry', price: 7.0, image: 'img-12.jpg', category: 'Pastelões e Pastel Médio', isAvailable: true },
    { id: 'prod-je-13', name: 'Pastel Mistão', description: 'frango, catupiry, calabresa e queijo', price: 7.0, image: 'img-13.jpg', category: 'Pastelões e Pastel Médio', isAvailable: true },
    { id: 'prod-je-14', name: 'Pastel de Carne Moída', description: 'carne moída, queijo, catupiry e ovo', price: 7.0, image: 'img-14.jpg', category: 'Pastelões e Pastel Médio', isAvailable: true },
    { id: 'prod-je-15', name: 'Pastel Sabor Pizza', description: 'queijo, presunto, calabresa e catupiry', price: 7.0, image: 'img-15.jpg', category: 'Pastelões e Pastel Médio', isAvailable: true },
    { id: 'prod-je-16', name: 'Pastel de Frango', description: 'frango, catupiry e queijo', price: 7.0, image: 'img-16.jpg', category: 'Pastelões e Pastel Médio', isAvailable: true },
    { id: 'prod-je-17', name: 'Pastel Três Queijos', description: 'queijo coalho, cheddar e mussarela', price: 7.0, image: 'img-17.jpg', category: 'Pastelões e Pastel Médio', isAvailable: true },
  ];

  const grouped = groupCategoryProductsForDisplay('Pastelões e Pastel Médio', pasteis);
  assert.equal(grouped.length, 1);
  const card = grouped[0];
  assert.ok(isGroupedProduct(card));
  assert.equal(card.name, 'Pastéis (Médio e Pastelão)');
  assert.equal(card.minPrice, 7.0);
  assert.equal(card.hasVariablePrice, true);
  assert.equal(card.variants.length, 6);
  assert.equal(card.variants[0].label, 'Carne de Sol');
  assert.equal(card.variants[1].label, 'Mistão');
  assert.equal(card.variants[2].label, 'Carne Moída');
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

  const grouped = groupCategoryProductsForDisplay('Vitaminas e Sucos', drinks);
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

  const grouped = groupCategoryProductsForDisplay('Refrigerantes', refris);
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

  const grouped = groupCategoryProductsForDisplay('Hambúrgueres', burgers);
  assert.equal(grouped.length, 2);
  assert.equal(isGroupedProduct(grouped[0]), false);
  assert.equal(isGroupedProduct(grouped[1]), false);
});
