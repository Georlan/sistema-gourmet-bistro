import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('cashier service does not restore the obsolete duplicate employee reader', () => {
  const service = source('src/config/caixaService.ts');
  assert.doesNotMatch(service, /export const getFuncionarios/);
  assert.doesNotMatch(service, /\bgetFuncionarios,\s*/);
  assert.match(service, /export const cadastrarFuncionario/);
});
