import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('CustomerRelationshipPanel is pure presentation without network requests or browser storage', () => {
  const fileContent = readFileSync(
    new URL('../src/components/caixa/customers/CustomerRelationshipPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.ok(!fileContent.includes('fetch('), 'CustomerRelationshipPanel must not perform fetch');
  assert.ok(!fileContent.includes('operationalFetch('), 'CustomerRelationshipPanel must not perform operationalFetch');
  assert.ok(!fileContent.includes('localStorage'), 'CustomerRelationshipPanel must not use localStorage');
  assert.ok(!fileContent.includes('sessionStorage'), 'CustomerRelationshipPanel must not use sessionStorage');
  assert.ok(!fileContent.includes('useState'), 'CustomerRelationshipPanel should not hold uncontrolled local mutation state');
  assert.ok(!fileContent.includes('useEffect'), 'CustomerRelationshipPanel should not trigger side effects');
});

test('useCashierCustomers keeps Cliente.id canonical and only fetches /fidelidade/clientes', () => {
  const fileContent = readFileSync(
    new URL('../src/components/caixa/customers/useCashierCustomers.ts', import.meta.url),
    'utf8',
  );

  assert.ok(fileContent.includes('/fidelidade/clientes'), 'Must fetch canonical /fidelidade/clientes');
  assert.ok(!fileContent.includes('/crm/clientes'), 'Must not fetch /crm/clientes');
  assert.ok(!fileContent.includes('/relacionamento/clientes'), 'Must not fetch /relacionamento/clientes');
  assert.ok(fileContent.includes('id: String(c.id)'), 'Cliente.id must remain the frontend identity');
  assert.ok(!fileContent.includes('c.id || c.telefone'), 'Phone must never be a fallback identity');
});

test('Backend customer_relationship service enforces tenant isolation and canonical Comanda.cliente_id FK', () => {
  const serviceContent = readFileSync(
    new URL('../backend/app/services/customer_relationship.py', import.meta.url),
    'utf8',
  );

  assert.ok(serviceContent.includes('Comanda.restaurante_id == restaurante_id'), 'Query must be tenant-scoped');
  assert.ok(serviceContent.includes('Comanda.cliente_id'), 'Must associate exclusively by Comanda.cliente_id');
  assert.ok(serviceContent.includes('Comanda.fechada == True'), 'Must only aggregate closed comandas');
  assert.ok(!serviceContent.includes('telefone =='), 'Must NEVER join or associate purchases by phone');
  assert.ok(!serviceContent.includes('cpf =='), 'Must NEVER associate purchases by CPF');
});
