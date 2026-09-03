import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const boundary = readFileSync('src/components/auth/TenantSuspensionBoundary.tsx', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');

test('suspensão substitui o app operacional por uma tela exclusiva', () => {
  assert.match(boundary, /accessState === 'suspended'/);
  assert.match(boundary, /Estabelecimento temporariamente suspenso/);
  assert.match(boundary, /Caixa, vendas, cardápio interno, estoque, clientes/);
  assert.match(boundary, /return <SuspensionScreen/);
  assert.doesNotMatch(boundary, /SuspensionScreen[\s\S]*children[\s\S]*SuspensionScreen/);
});

test('boundary detecta suspensão no backend e revalida a sessão periodicamente', () => {
  assert.match(boundary, /response\.status !== 403/);
  assert.match(boundary, /normalized\.includes\('restaurante'\)/);
  assert.match(boundary, /normalized\.includes\('suspens'\)/);
  assert.match(boundary, /\/produtos\/categorias/);
  assert.match(boundary, /STATUS_PROBE_INTERVAL_MS = 5_000/);
  assert.match(boundary, /visibilitychange/);
  assert.match(boundary, /window\.addEventListener\('focus'/);
});

test('boundary cobre tokens operacionais sem sequestrar Super Admin ou cardápio público', () => {
  for (const tokenKey of ['koma_caixa_token', 'koma_waiter_token', 'koma_smartpos_session']) {
    assert.match(boundary, new RegExp(tokenKey));
  }
  assert.match(main, /TenantSuspensionBoundary/);
  assert.match(main, /pathname\.startsWith\("\/super-admin"\)/);
  assert.match(main, /pathname\.startsWith\("\/c\/"\)/);
  assert.match(main, /disabled=\{bypassTenantSuspensionBoundary\(\)\}/);
});

test('usuário suspenso só pode revalidar acesso ou sair', () => {
  assert.match(boundary, /Verificar acesso/);
  assert.match(boundary, />\s*Sair\s*</);
  assert.match(boundary, /clearOperatorSession\(\)/);
  assert.match(boundary, /window\.location\.reload\(\)/);
});
