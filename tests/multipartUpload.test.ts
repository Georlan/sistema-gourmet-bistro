import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildMultipartUploadHeaders } from '../src/utils/multipartUpload';
import { buildMultipartUploadHeaders as reexportedHelper } from '../src/utils/promotionFormHelpers';

test('buildMultipartUploadHeaders remove Content-Type de forma case-insensitive e preserva headers de autenticação', () => {
  assert.equal(reexportedHelper, buildMultipartUploadHeaders);

  const original = {
    Authorization: 'Bearer token-seguro',
    'Content-Type': 'application/json',
    'X-Restaurant-Id': '6',
    Accept: 'application/json',
  };
  const sanitized = buildMultipartUploadHeaders(original);

  assert.deepEqual(sanitized, {
    Authorization: 'Bearer token-seguro',
    'X-Restaurant-Id': '6',
    Accept: 'application/json',
  });
  // Não muta o objeto de entrada
  assert.equal(original['Content-Type'], 'application/json');

  const mixedCases = buildMultipartUploadHeaders({
    authorization: 'Bearer abc',
    'content-type': 'application/json; charset=utf-8',
    'CONTENT-TYPE': 'text/plain',
    'Content-type': 'multipart/form-data',
    'x-restaurant-id': '42',
  });
  assert.deepEqual(mixedCases, {
    authorization: 'Bearer abc',
    'x-restaurant-id': '42',
  });
});

test('todos os fluxos de upload multipart (FormData) usam buildMultipartUploadHeaders', () => {
  const inventoryOps = readFileSync(
    'src/components/caixa/inventory/useCashierInventoryOperations.ts',
    'utf8',
  );
  const assetUploader = readFileSync('src/components/CardapioAssetUploader.tsx', 'utf8');
  const cashierCatalog = readFileSync('src/components/caixa/catalog/CashierCatalog.tsx', 'utf8');
  const promotionsSettings = readFileSync('src/components/cardapio/PromotionsSettings.tsx', 'utf8');

  assert.match(inventoryOps, /from '\.\.\/\.\.\/\.\.\/utils\/multipartUpload'/);
  assert.match(inventoryOps, /\/estoque\/importar-xml[\s\S]*?headers:\s*buildMultipartUploadHeaders\(authHeaders\)/);
  assert.doesNotMatch(inventoryOps, /\/estoque\/importar-xml[\s\S]*?headers:\s*authHeaders\b/);

  assert.match(assetUploader, /from '\.\.\/utils\/multipartUpload'/);
  assert.match(assetUploader, /headers:\s*buildMultipartUploadHeaders\(authHeaders\)/);
  assert.doesNotMatch(assetUploader, /delete headers\['Content-Type'\]/);

  assert.match(cashierCatalog, /from '\.\.\/\.\.\/\.\.\/utils\/multipartUpload'/);
  const catalogMatches = cashierCatalog.match(/buildMultipartUploadHeaders\(authHeaders\)/g) ?? [];
  assert.equal(catalogMatches.length, 2);
  assert.doesNotMatch(cashierCatalog, /delete uploadHeaders\['Content-Type'\]/);

  assert.match(promotionsSettings, /headers:\s*buildMultipartUploadHeaders\(authHeaders\)/);
});
