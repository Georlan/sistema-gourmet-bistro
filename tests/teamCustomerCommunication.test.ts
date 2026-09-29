import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('restaurant customer screen uses the canonical customer CRUD endpoint', () => {
  const customers = source('../src/components/caixa/customers/CashierCustomers.tsx');
  const customerHook = source('../src/components/caixa/customers/useCashierCustomers.ts');

  assert.match(customers, /fetch\(\`\$\{apiBaseUrl\}\/fidelidade\/clientes\`/);
  assert.match(customers, /method: 'POST'/);
  assert.match(customers, /Cliente cadastrado com sucesso!/);
  assert.match(customers, /fidelidade\/clientes\/\$\{clienteId\}/);
  assert.match(customerHook, /fidelidade\/clientes/);
});

test('team resend stays wired to the canonical backend route', () => {
  const team = source('../src/components/caixa/team/CashierTeam.tsx');
  assert.match(team, /\/auth\/usuarios\/\$\{user\.id\}\/reenviar-convite/);
  assert.match(team, /method: 'POST'/);
});
