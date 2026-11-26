import assert from 'node:assert/strict';
import test from 'node:test';

import { extractSearchTerms, locateFeature, rankMatches } from '../scripts/ops-locate.mjs';

test('extractSearchTerms expands domain synonyms for Portuguese support prompts', () => {
  const terms = extractSearchTerms('O botão de despacho não funciona no delivery');
  assert.ok(terms.includes('dispatch'));
  assert.ok(terms.includes('courier'));
  assert.ok(terms.includes('delivery'));
  assert.ok(!terms.includes('nao'));
  assert.ok(!terms.includes('funciona'));
});

test('rankMatches prioritizes filename relevance over raw occurrence count', () => {
  const ranked = rankMatches(
    [
      { file: 'src/utils/genericHelper.ts', hits: 12 },
      { file: 'src/components/caixa/orders/CourierDispatchModal.tsx', hits: 4 },
    ],
    ['dispatch', 'courier'],
    2,
  );
  assert.equal(ranked[0].file, 'src/components/caixa/orders/CourierDispatchModal.tsx');
});

test('locateFeature locates real KOMA files, endpoints and tests deterministically', () => {
  const res = locateFeature('erro no pix pendente', process.cwd());
  assert.ok(res.durationMs < 5000);
  assert.ok(res.frontend.some(f => f.file.toLowerCase().includes('pix')));
  assert.ok(res.backend.some(f => f.file.toLowerCase().includes('pix')));
  assert.ok(res.tests.e2e.some(f => f.file.includes('direct-pix')));
});
