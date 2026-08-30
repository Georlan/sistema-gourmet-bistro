import assert from 'node:assert/strict';
import test from 'node:test';

import type { CartItem } from '../src/cardapio/components/CardapioCartDrawer';
import { buildCardapioOrderItems } from '../src/cardapio/orderItems';

function cartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'cart-burger',
    product: {
      id: 'product-burger',
      name: 'Burguer',
      description: '',
      price: 25,
      image: '',
      category: 'Lanches',
    },
    quantity: 1,
    selectedOptions: {},
    notes: '',
    ...overrides,
  };
}

test('pedido simples mantém o contrato e envia uma lista vazia de modificadores', () => {
  assert.deepEqual(buildCardapioOrderItems([cartItem({ notes: '  Sem cebola  ' })], 'Ana'), [{
    produto_id: 'product-burger',
    quantidade: 1,
    modificador_ids: [],
    observacao: 'Sem cebola',
    cliente_nome: 'Ana',
  }]);
});

test('envia os IDs das opções de todos os grupos, inclusive opções gratuitas', () => {
  const item = cartItem({
    selectedOptions: {
      'group-extras': [
        { id: 'option-bacon', name: 'Bacon', extraPrice: 5 },
        { id: 'option-cheddar', name: 'Cheddar', extraPrice: 4 },
      ],
      'group-point': [{ id: 'option-well-done', name: 'Bem passado', extraPrice: 0 }],
      'group-optional-empty': [],
    },
    notes: '  Sem picles  ',
  });
  const [payload] = buildCardapioOrderItems([item], 'Ana (Mesa 7)');

  assert.deepEqual(payload.modificador_ids, ['option-bacon', 'option-cheddar', 'option-well-done']);
  assert.equal(payload.observacao, 'Sem picles - Opções: Bacon, Cheddar, Bem passado');
  assert.equal(payload.cliente_nome, 'Ana (Mesa 7)');
});

test('duas unidades enviam o adicional uma vez; a multiplicação pertence ao servidor', () => {
  const item = cartItem({
    quantity: 2,
    selectedOptions: { extras: [{ id: 'option-bacon', name: 'Bacon', extraPrice: 5 }] },
  });
  const [payload] = buildCardapioOrderItems([item], 'Ana');

  assert.equal(payload.quantidade, 2);
  assert.deepEqual(payload.modificador_ids, ['option-bacon']);
  assert.equal(payload.observacao, 'Opções: Bacon');
});

test('mesmo produto com personalizações diferentes mantém linhas independentes', () => {
  const payload = buildCardapioOrderItems([
    cartItem({
      id: 'cart-bacon',
      selectedOptions: { extras: [{ id: 'option-bacon', name: 'Bacon', extraPrice: 5 }] },
      notes: 'Sem picles',
    }),
    cartItem({
      id: 'cart-cheddar',
      selectedOptions: { extras: [{ id: 'option-cheddar', name: 'Cheddar', extraPrice: 4 }] },
      notes: 'Sem cebola',
    }),
    cartItem(),
  ], 'Ana');

  assert.equal(payload.length, 3);
  assert.deepEqual(payload.map((item) => item.modificador_ids), [['option-bacon'], ['option-cheddar'], []]);
  assert.deepEqual(payload.map((item) => item.observacao), ['Sem picles - Opções: Bacon', 'Sem cebola - Opções: Cheddar', '']);
});

test('não envia preços locais nem nomes como substitutos dos identificadores', () => {
  const item = cartItem({
    selectedOptions: { extras: [{ id: 'option-bacon', name: 'Bacon', extraPrice: 0.01 }] },
  });
  item.product.price = 0.01;
  const [payload] = buildCardapioOrderItems([item], 'Ana');

  assert.deepEqual(Object.keys(payload).sort(), [
    'cliente_nome', 'modificador_ids', 'observacao', 'produto_id', 'quantidade',
  ]);
  assert.deepEqual(payload.modificador_ids, ['option-bacon']);
});

test('catálogos de lojas diferentes preservam seus próprios IDs mesmo com nomes iguais', () => {
  for (const store of ['store-a', 'store-b']) {
    const item = cartItem({
      selectedOptions: { extras: [{ id: `${store}-bacon`, name: 'Bacon', extraPrice: 5 }] },
    });
    item.product.id = `${store}-burger`;
    const [payload] = buildCardapioOrderItems([item], 'Ana');

    assert.equal(payload.produto_id, `${store}-burger`);
    assert.deepEqual(payload.modificador_ids, [`${store}-bacon`]);
  }
});

test('alterar o ID da opção altera os itens usados na identificação da tentativa', () => {
  const item = cartItem({
    selectedOptions: { extras: [{ id: 'option-a', name: 'Adicional', extraPrice: 5 }] },
  });
  const first = JSON.stringify(buildCardapioOrderItems([item], 'Ana'));
  item.selectedOptions.extras[0].id = 'option-b';

  assert.notEqual(JSON.stringify(buildCardapioOrderItems([item], 'Ana')), first);
});

test('serialização não altera o carrinho e aceita carrinho vazio', () => {
  const cart = [cartItem({
    selectedOptions: { extras: [{ id: 'option-bacon', name: 'Bacon', extraPrice: 5 }] },
  })];
  const before = structuredClone(cart);
  const payload = buildCardapioOrderItems(cart, 'Ana');
  payload[0].modificador_ids.push('unrelated');

  assert.deepEqual(cart, before);
  assert.deepEqual(buildCardapioOrderItems([], 'Ana'), []);
});
