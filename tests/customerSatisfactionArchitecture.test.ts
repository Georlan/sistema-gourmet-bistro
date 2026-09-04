import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('CustomerSatisfactionPanel is pure presentation without network requests or browser storage', () => {
  const fileContent = readFileSync(
    new URL('../src/components/caixa/customers/CustomerSatisfactionPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.ok(!fileContent.includes('fetch('), 'CustomerSatisfactionPanel must not perform fetch');
  assert.ok(!fileContent.includes('operationalFetch('), 'CustomerSatisfactionPanel must not perform operationalFetch');
  assert.ok(!fileContent.includes('localStorage'), 'CustomerSatisfactionPanel must not use localStorage');
  assert.ok(!fileContent.includes('sessionStorage'), 'CustomerSatisfactionPanel must not use sessionStorage');
  assert.ok(!fileContent.includes('window.'), 'CustomerSatisfactionPanel must not use window as source of truth');
});

test('useCustomerSatisfaction queries only /clientes/satisfacao without parallel endpoints', () => {
  const hookContent = readFileSync(
    new URL('../src/components/caixa/customers/useCustomerSatisfaction.ts', import.meta.url),
    'utf8',
  );

  assert.ok(hookContent.includes('/clientes/satisfacao'), 'Must query canonical /clientes/satisfacao');
  assert.ok(!hookContent.includes('/nps'), 'Must not create parallel /nps route');
  assert.ok(!hookContent.includes('/avaliacoes/clientes'), 'Must not create parallel /avaliacoes/clientes');
  assert.ok(!hookContent.includes('localStorage'), 'Must not use localStorage');
  assert.ok(!hookContent.includes('sessionStorage'), 'Must not use sessionStorage');
});

test('CustomerSatisfactionPanel is mounted inside CashierCustomers below CustomerRelationshipPanel', () => {
  const cashierContent = readFileSync(
    new URL('../src/components/caixa/customers/CashierCustomers.tsx', import.meta.url),
    'utf8',
  );

  assert.ok(
    cashierContent.includes('<CustomerRelationshipPanel'),
    'CashierCustomers must contain CustomerRelationshipPanel',
  );
  assert.ok(
    cashierContent.includes('<CustomerSatisfactionPanel'),
    'CashierCustomers must mount CustomerSatisfactionPanel',
  );

  const relIndex = cashierContent.indexOf('<CustomerRelationshipPanel');
  const satIndex = cashierContent.indexOf('<CustomerSatisfactionPanel');
  assert.ok(
    satIndex > relIndex,
    'CustomerSatisfactionPanel must appear AFTER CustomerRelationshipPanel',
  );
});

test('Customer satisfaction model and backend service enforce canonical Cliente.id and tenant isolation', () => {
  const serviceContent = readFileSync(
    new URL('../backend/app/services/customer_satisfaction.py', import.meta.url),
    'utf8',
  );

  assert.ok(serviceContent.includes('restaurante_id == restaurante_id'), 'Queries must be tenant-scoped');
  assert.ok(serviceContent.includes('cliente_id'), 'Must associate exclusively by canonical cliente_id');
  assert.ok(!serviceContent.includes('telefone =='), 'Must NEVER join or associate evaluations by phone');
  assert.ok(!serviceContent.includes('cpf =='), 'Must NEVER associate evaluations by CPF');
});
