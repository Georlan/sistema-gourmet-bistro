import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const superAdminPanel = readFileSync(
  new URL('../src/super-admin/SuperAdminPanel.tsx', import.meta.url),
  'utf8',
);

test('polling do inbox de contratos pausa em aba oculta e reconcilia ao voltar', () => {
  assert.match(superAdminPanel, /const refreshContractInboxWhenVisible = \(\) => \{/);
  assert.match(superAdminPanel, /document\.visibilityState === "visible"\) void fetchContracts\(\)/);
  assert.match(superAdminPanel, /window\.setInterval\(refreshContractInboxWhenVisible, 30_000\)/);
  assert.match(superAdminPanel, /document\.addEventListener\("visibilitychange", refreshContractInboxWhenVisible\)/);
  assert.match(superAdminPanel, /document\.removeEventListener\("visibilitychange", refreshContractInboxWhenVisible\)/);
});

test('entrada autenticada ainda carrega contratos imediatamente', () => {
  const initialFetches = superAdminPanel.match(/void fetchContracts\(\);/g) ?? [];
  assert.ok(initialFetches.length >= 1);
});
