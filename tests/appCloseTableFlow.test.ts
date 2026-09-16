import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const commandSource = readFileSync(
  new URL('../src/components/app/data/operationalOrderCommands.ts', import.meta.url),
  'utf8',
);
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

test('table close delegates transport to command owner and waits for backend authority', () => {
  const requestIndex = closeBlock.indexOf('const result = await closeOperationalComandas');
  const failureIndex = closeBlock.indexOf('if (!result.ok)', requestIndex);
  const successIndex = closeBlock.indexOf('showToast(`Mesa ${mesaId} encerrada e liberada.`');

  assert.ok(requestIndex >= 0, 'fechamento deve delegar ao owner de comandos');
  assert.ok(failureIndex > requestIndex, 'resultado do backend deve ser validado');
  assert.ok(successIndex > failureIndex, 'sucesso só pode ser anunciado após validar respostas');
  assert.doesNotMatch(closeBlock.slice(0, requestIndex), /encerrada e liberada/);
  assert.doesNotMatch(closeBlock, /setOrders\(/, 'não remover mesa localmente antes da confirmação');
  assert.match(closeBlock, /await fetchOrdersFromAPI\(\)/);

  assert.match(commandSource, /for \(const comandaId of comandaIds\)/);
  assert.match(commandSource, /await operationalFetch/);
  assert.match(commandSource, /if \(!response.ok\)/);
  assert.match(commandSource, /return \{ ok: false, message:/);
  assert.match(commandSource, /return \{ ok: true \}/);
});
