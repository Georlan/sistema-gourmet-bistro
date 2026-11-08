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


test('snapshot operacional mantém familia_id e rótulo para reabrir a família inteira', () => {
  const snapshot = normalizeCatalogSnapshot({ categorias: [{ id: 'pasteis', nome: 'Pastéis' }], produtos: [
    { id: 'carne', nome: 'Pastel Médio Carne', categoria_id: 'pasteis', preco: 7,
      familia_id: 'pastel-family', variacao_rotulo: 'Carne Moída' },
    { id: 'queijo', nome: 'Pastel Médio Queijo', categoria_id: 'pasteis', preco: 8,
      familia_id: 'pastel-family', variacao_rotulo: 'Queijo' },
    { id: 'avulso', nome: 'Pastel avulso', categoria_id: 'pasteis', preco: 9 },
  ] });
  assert.equal(snapshot.produtos.find(p => p.id === 'carne')?.familia_id, 'pastel-family');
  assert.equal(snapshot.produtos.find(p => p.id === 'carne')?.variacao_rotulo, 'Carne Moída');
  assert.equal(snapshot.produtos.find(p => p.id === 'queijo')?.familia_id, 'pastel-family');
  assert.equal(snapshot.produtos.find(p => p.id === 'queijo')?.preco, 8);
  assert.equal(snapshot.produtos.find(p => p.id === 'avulso')?.familia_id, null);
});
