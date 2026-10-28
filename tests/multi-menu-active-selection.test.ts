import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSellableProducts, normalizeCatalogSnapshot } from '../src/catalog/catalog';

test('operational catalog sells only active products from either selected menu', () => {
  const catalog = normalizeCatalogSnapshot({
    categorias: [{ id: 'c', nome: 'Comidas' }],
    cardapio_ativo_id: 'manha', cardapios_ativos_ids: ['manha', 'almoco'],
    produtos: [
      { id: 'a', nome: 'Bolo', categoria_id: 'c', preco: 5, ativo: true, cardapio_id: 'manha' },
      { id: 'b', nome: 'Almoço', categoria_id: 'c', preco: 10, ativo: true, cardapio_id: 'almoco' },
      { id: 'c', nome: 'Pausado', categoria_id: 'c', preco: 10, ativo: false, cardapio_id: 'almoco' },
      { id: 'd', nome: 'Outro', categoria_id: 'c', preco: 10, ativo: true, cardapio_id: 'noite' },
    ],
  });
  assert.deepEqual(getSellableProducts(catalog.produtos, catalog.cardapio_ativo_id, catalog.cardapios_ativos_ids).map(p => p.id), ['a', 'b']);
  assert.deepEqual(getSellableProducts(catalog.produtos, catalog.cardapio_ativo_id).map(p => p.id), ['a']);
});
