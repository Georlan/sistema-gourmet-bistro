import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const repoPath = (relative: string) => new URL(`../${relative}`, import.meta.url);

test('imagens fictícias de preview não ficam em public/ para não irem ao deploy de produção', () => {
  assert.equal(existsSync(repoPath('public/mock-preview')), false);
  for (const image of ['burger-hero.jpg', 'drink-combo.jpg', 'porcao-fritas.jpg', 'smash-duplo.jpg']) {
    assert.equal(existsSync(repoPath(`scripts/fixtures/mock-preview/${image}`)), true);
  }
});

test('componentes e scripts legados removidos não retornam ao repositório', () => {
  for (const removed of [
    'src/components/FechamentoCegoModal.tsx',
    'src/components/onboarding/CatalogImport.tsx',
    'scripts/capture-flow-screens.mjs',
  ]) {
    assert.equal(existsSync(repoPath(removed)), false);
  }
});
