import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pickup = readFileSync(new URL('../src/components/caixa/orders/CashierPickups.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../backend/app/routes/orders_core.py', import.meta.url), 'utf8');

test('retiradas é uma visão derivada e reutiliza as ações canônicas do Caixa', () => {
  assert.match(panel, /<CashierPickups/);
  assert.match(panel, /handleAdvanceDigitalOrder=\{handleAdvanceDigitalOrder\}/);
  assert.match(panel, /handleFinalizeDigitalOrder=\{handleFinalizeDigitalOrder\}/);
  assert.match(pickup, /await handleAdvanceDigitalOrder\(order\)/);
  assert.match(pickup, /await handleFinalizeDigitalOrder\(order\)/);
  assert.doesNotMatch(pickup, /delivery\/status\?status_novo/);
  assert.doesNotMatch(pickup, /\/comandas\/\$\{[^}]+\}\/fechar/);
});

test('retiradas separa controle ativo do histórico concluído do dia', () => {
  assert.match(pickup, /bucketPickupOrders\(deliveryOrders, now\)/);
  assert.match(pickup, /Aguardando e em preparo/);
  assert.match(pickup, /Prontas para retirada/);
  assert.match(pickup, /Concluídas hoje/);
  assert.match(pickup, /localCalendarDate\(closedAt\) === today/);
  assert.match(pickup, /Atrasada/);
});

test('histórico de retiradas é leitura limitada e tenant-scoped', () => {
  assert.match(routes, /@router\.get\("\/delivery\/retiradas\/concluidas-recentes"/);
  assert.match(routes, /Comanda\.restaurante_id == require_tenant_id\(\)/);
  assert.match(routes, /Comanda\.tipo\.in_\(\["Retirada", "Viagem"\]\)/);
  assert.match(routes, /Comanda\.fechada\.is_\(True\)/);
  assert.match(routes, /datetime\.timedelta\(hours=36\)/);
  assert.match(routes, /\.limit\(100\)/);
});
