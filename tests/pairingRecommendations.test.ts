import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyProduct,
  getPairingRecommendations,
} from '../src/cardapio/pairingRecommendations';
import type { Product } from '../src/cardapio/CardapioTypes';

const mockCatalog: Product[] = [
  {
    id: '1',
    name: 'Burger Clássico',
    description: 'Pão brioche e carne 160g',
    price: 35.0,
    category: 'Burgers',
    image: '',
    isAvailable: true,
  },
  {
    id: '2',
    name: 'Batata Rústica Crocante',
    description: 'Batatas com alecrim',
    price: 18.0,
    category: 'Acompanhamentos',
    image: '',
    isAvailable: true,
  },
  {
    id: '3',
    name: 'Coca-Cola Lata 350ml',
    description: 'Refrigerante gelado',
    price: 7.0,
    category: 'Bebidas',
    image: '',
    isAvailable: true,
  },
  {
    id: '4',
    name: 'Suco de Laranja Natural',
    description: '300ml',
    price: 10.0,
    category: 'Bebidas',
    image: '',
    isAvailable: true,
  },
  {
    id: '5',
    name: 'Pudim de Leite Condensado',
    description: 'Sobremesa clássica',
    price: 14.0,
    category: 'Sobremesas',
    image: '',
    isAvailable: true,
  },
  {
    id: '6',
    name: 'Onion Rings',
    description: 'Anéis de cebola empanados',
    price: 16.0,
    category: 'Porções',
    image: '',
    isAvailable: false, // Indisponível
  },
];

test('classifyProduct correctly classifies products based on category and name', () => {
  assert.equal(classifyProduct(mockCatalog[0]), 'main');
  assert.equal(classifyProduct(mockCatalog[1]), 'side');
  assert.equal(classifyProduct(mockCatalog[2]), 'beverage');
  assert.equal(classifyProduct(mockCatalog[3]), 'beverage');
  assert.equal(classifyProduct(mockCatalog[4]), 'dessert');
  assert.equal(classifyProduct(mockCatalog[5]), 'side');
});

test('getPairingRecommendations returns complementary items excluding focused and cart items', () => {
  const recs = getPairingRecommendations({
    catalog: mockCatalog,
    focusedProductId: '1', // Burger em foco
    cartProductIds: [],
    limit: 3,
  });

  // Não pode conter o burger (id 1)
  assert.ok(!recs.some((p) => p.id === '1'));
  // Não pode conter item indisponível (id 6)
  assert.ok(!recs.some((p) => p.id === '6'));
  // Deve conter side (batata 2), bebida (coca 3), sobremesa (pudim 5)
  assert.equal(recs.length, 3);
  const ids = recs.map((r) => r.id);
  assert.ok(ids.includes('2')); // Batata
  assert.ok(ids.includes('3')); // Coca
  assert.ok(ids.includes('5')); // Pudim
});

test('getPairingRecommendations avoids suggesting beverages if one is already in cart', () => {
  const recs = getPairingRecommendations({
    catalog: mockCatalog,
    focusedProductId: '1',
    cartProductIds: ['1', '3'], // Burger e Coca já no carrinho
    limit: 2,
  });

  // Não pode conter Coca (3)
  assert.ok(!recs.some((p) => p.id === '3'));
  // Deve sugerir batata (2) e sobremesa (5) antes de uma segunda bebida
  assert.equal(recs[0].id, '2');
  assert.equal(recs[1].id, '5');
});

test('getPairingRecommendations handles empty catalog or zero limit gracefully', () => {
  assert.deepEqual(getPairingRecommendations({ catalog: [], limit: 4 }), []);
  assert.deepEqual(getPairingRecommendations({ catalog: mockCatalog, limit: 0 }), []);
});

test('getPairingRecommendations never fills slots with main dishes (burgers/pizzas)', () => {
  const onlyBurgersAndOneDrink: Product[] = [
    mockCatalog[0], // Burger Clássico (main)
    mockCatalog[2], // Coca-Cola (beverage)
  ];
  const recs = getPairingRecommendations({
    catalog: onlyBurgersAndOneDrink,
    focusedProductId: null,
    cartProductIds: [],
    limit: 4,
  });
  // Should only return Coca-Cola, NEVER burger
  assert.equal(recs.length, 1);
  assert.equal(recs[0].id, '3');
  assert.ok(!recs.some((p) => p.id === '1'));
});

test('getPairingRecommendations keeps recommended items stable when adding to cart', () => {
  const recsInitial = getPairingRecommendations({
    catalog: mockCatalog,
    focusedProductId: '1',
    cartProductIds: [],
    limit: 3,
    excludeCartItems: false,
  });
  assert.equal(recsInitial.length, 3);

  // User adds Batata (id 2) to cart
  const recsAfterAdd = getPairingRecommendations({
    catalog: mockCatalog,
    focusedProductId: '1',
    cartProductIds: ['2'],
    limit: 3,
    excludeCartItems: false,
  });

  const idsAfter = recsAfterAdd.map((r) => r.id);
  // Batata remains in the recommendation list without disappearing
  assert.ok(idsAfter.includes('2'));
  assert.ok(idsAfter.includes('3'));
  assert.ok(idsAfter.includes('5'));
});

