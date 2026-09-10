import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const productsSource = readFileSync(
  new URL('../src/components/cardapio/CardapioProdutosTab.tsx', import.meta.url),
  'utf8',
);
const catalogSource = readFileSync(
  new URL('../src/components/caixa/catalog/CashierCatalog.tsx', import.meta.url),
  'utf8',
);

test('media health stays inside Produtos instead of creating a duplicate image owner', () => {
  assert.match(productsSource, /aria-label="Filtrar por fotos do produto"/);
  assert.match(productsSource, /'Sem foto'/);
  assert.match(productsSource, /mediaCoverage/);
  assert.match(productsSource, /onEditProduct\(product\)/);

  assert.doesNotMatch(catalogSource, /activeSubTab === 'midias'/);
  assert.doesNotMatch(catalogSource, /MediaManager|ImageManager|Gerenciador de imagens/);
});

test('product media editing now uses one stored photo through the existing product flow', () => {
  assert.match(productsSource, /product\.imagem/);
  assert.match(productsSource, /onClick=\{\(\) => onEditProduct\(product\)\}/);

  assert.match(catalogSource, /type="file"/);
  assert.match(catalogSource, /Use uma única foto/);
  assert.match(catalogSource, /imagens_galeria: \[\]/);
  assert.match(catalogSource, /\/api\/cardapio-digital\/assets\/product\//);
  assert.doesNotMatch(catalogSource, /Foto principal: https:\/\//);
  assert.doesNotMatch(catalogSource, /Segunda foto: https:\/\//);
  assert.doesNotMatch(catalogSource, /Terceira foto: https:\/\//);
});

test('existing catalog controls remain available alongside the condensed media filter', () => {
  for (const expected of [
    'Categorias do cardápio',
    'Filtrar por disponibilidade',
    'Novo produto',
    'Pausar venda',
    'Voltar a vender',
    'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
  ]) {
    assert.ok(productsSource.includes(expected), `missing existing product control: ${expected}`);
  }
});
