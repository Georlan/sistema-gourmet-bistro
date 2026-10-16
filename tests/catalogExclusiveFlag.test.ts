import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCatalogSnapshot } from '../src/catalog/catalog';

test('catálogo administrativo preserva exclusividade ao listar e reabrir produto', () => {
  const result = normalizeCatalogSnapshot({ categorias: [{ id: 'drink', nome: 'Bebidas' }], produtos: [
    { id: 'exclusive', nome: 'Bebida do conjunto', categoria_id: 'drink', preco: 1, somente_promocao: true },
    { id: 'regular', nome: 'Bebida avulsa', categoria_id: 'drink', preco: 6 },
  ] });
  assert.equal(result.produtos.find(p => p.id === 'exclusive')?.somente_promocao, true);
  assert.equal(result.produtos.find(p => p.id === 'regular')?.somente_promocao, false);
});
