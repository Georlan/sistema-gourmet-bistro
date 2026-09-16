import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = appSource.indexOf('const handleCloseTable = async');
const end = appSource.indexOf('// 9.5. Clear Table Orders', start);

assert.ok(start >= 0, 'handleCloseTable precisa existir');
assert.ok(end > start, 'bloco handleCloseTable precisa estar delimitado');

const closeBlock = appSource.slice(start, end);

test('table close accepts management roles instead of caixa-only gate', () => {
  assert.match(closeBlock, /if \(!isManagementRole\(activeRole\)\)/);
  assert.doesNotMatch(closeBlock, /activeRole\s*!==\s*['"]caixa['"]/);
  assert.match(closeBlock, /const opKey = `close-\$\{mesaId\}`/);
});

test('table close waits for backend authority before announcing success', () => {
  const requestIndex = closeBlock.indexOf('const res = await operationalFetch');
  const failureIndex = closeBlock.indexOf('if (!res.ok)', requestIndex);
  const successIndex = closeBlock.indexOf('showToast(`Mesa ${mesaId} encerrada e liberada.`');

  assert.ok(requestIndex >= 0, 'fechamento deve chamar o backend');
  assert.ok(failureIndex > requestIndex, 'resposta do backend deve ser validada');
  assert.ok(successIndex > failureIndex, 'sucesso só pode ser anunciado após validar respostas');
  assert.doesNotMatch(closeBlock.slice(0, requestIndex), /encerrada e liberada/);
  assert.doesNotMatch(closeBlock, /setOrders\(/, 'não remover mesa localmente antes da confirmação');
  assert.match(closeBlock, /await fetchOrdersFromAPI\(\)/);
});
