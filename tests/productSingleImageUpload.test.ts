import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/components/caixa/catalog/CashierCatalog.tsx', 'utf8');

test('product editor uses one native file picker instead of URL gallery fields', () => {
  assert.match(source, /type="file"/);
  assert.match(source, /accept="image\/png,image\/jpeg,image\/jpg,image\/webp"/);
  assert.match(source, /Adicionar foto/);
  assert.match(source, /Trocar foto/);
  assert.match(source, /Remover foto/);
  assert.match(source, /Use uma única foto/);
  assert.doesNotMatch(source, /Foto principal: https:\/\//);
  assert.doesNotMatch(source, /Segunda foto: https:\/\//);
  assert.doesNotMatch(source, /Terceira foto: https:\/\//);
});

test('product save keeps a single-image data model and delegates binary upload to storage endpoint', () => {
  assert.match(source, /imagens_galeria: \[\]/);
  assert.match(source, /\/api\/cardapio-digital\/assets\/product\//);
  assert.match(source, /formData\.append\('file', prodFormImageFile\)/);
  assert.match(source, /method: 'DELETE'/);
});
