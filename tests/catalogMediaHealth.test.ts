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
  assert.match(productsSource, /type MediaFilter = 'TODAS' \| 'SEM_FOTO' \| 'UMA_FOTO' \| 'GALERIA'/);
  assert.match(productsSource, /aria-label="Filtrar por fotos do produto"/);
  assert.match(productsSource, /'Sem foto'/);
  assert.match(productsSource, /'1 foto'/);
  assert.match(productsSource, /'2–3 fotos'/);
  assert.match(productsSource, /mediaCoverage/);
  assert.match(productsSource, /Editar fotos deste produto/);

  assert.doesNotMatch(catalogSource, /activeSubTab === 'midias'/);
  assert.doesNotMatch(catalogSource, /MediaManager|ImageManager|Gerenciador de imagens/);
});

test('media health reuses the canonical product gallery and existing edit flow', () => {
  assert.match(productsSource, /product\.imagem/);
  assert.match(productsSource, /product\.imagens_galeria/);
  assert.match(productsSource, /new Set\(urls\)\.size/);
  assert.match(productsSource, /onClick=\{\(\) => onEditProduct\(product\)\}/);

  assert.match(catalogSource, /imagens_galeria: galeriaUrls/);
  assert.match(catalogSource, /A primeira será a imagem principal/);
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
