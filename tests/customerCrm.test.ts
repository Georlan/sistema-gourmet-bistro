import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesCustomerSegment, selectCrmCustomers } from '../src/domain/customerCrm';
import type { LoyaltyCustomer } from '../src/components/caixa/cashierContracts';
const make = (id: string, count: number, days: number | null, total = 0): LoyaltyCustomer => ({ id, cliente: id, telefone: '85999998888', pontos: 0, saldoCashback: 0, pedidos_concluidos: count, dias_sem_comprar: days, valor_pago_total: total, segmento_relacionamento: days === null ? 'SEM_COMPRA' : days > 60 ? 'REATIVAR' : days > 30 ? 'ATENCAO' : 'ATIVO' });
const customers = [make('Zero', 0, null), make('Recente', 1, 0, 50), make('Fiel', 8, 70, 400), make('Outro', 8, 3, 600)];
test('ranking puts repeat buyers before unpurchased registrations without mutating snapshot', () => {
  assert.deepEqual(selectCrmCustomers(customers, '', 'ALL', 'orders').map(c => c.id), ['Outro', 'Fiel', 'Recente', 'Zero']);
  assert.equal(customers[0].id, 'Zero');
});
test('missing purchase dates stay last for both recency and inactivity', () => {
  assert.equal(selectCrmCustomers(customers, '', 'ALL', 'recent').at(-1)?.id, 'Zero');
  assert.equal(selectCrmCustomers(customers, '', 'ALL', 'absent')[0].id, 'Fiel');
  assert.equal(selectCrmCustomers(customers, '', 'ALL', 'absent').at(-1)?.id, 'Zero');
});
test('search by formatted phone composes with relationship filters', () => {
  assert.deepEqual(selectCrmCustomers(customers, '(85) 99999-8888', 'REATIVAR', 'orders').map(c => c.id), ['Fiel']);
  assert.equal(selectCrmCustomers(customers, 'zz', 'ALL', 'orders').length, 0);
  assert.equal(selectCrmCustomers(customers, '', 'REPEAT', 'orders').length, 2);
});

test('opportunities respect boundaries and never infer activity from registrations', () => {
  for (const days of [6, 30]) assert.equal(matchesCustomerSegment(make('one', 1, days), 'SECOND'), true);
  for (const days of [0, 5, 31, null]) assert.equal(matchesCustomerSegment(make('one', 1, days), 'SECOND'), false);
  assert.equal(matchesCustomerSegment({ ...make('balance', 2, 31), pontos: 10 }, 'BALANCE'), true);
  assert.equal(matchesCustomerSegment({ ...make('zero', 0, null), pontos: 10 }, 'BALANCE'), false);
  assert.equal(matchesCustomerSegment({ ...make('rhythm', 3, 8), intervalo_medio_dias: 4 }, 'CADENCE'), true);
  assert.equal(matchesCustomerSegment({ ...make('rhythm', 3, 6), intervalo_medio_dias: 4 }, 'CADENCE'), false);
  assert.equal(matchesCustomerSegment({ ...make('same-day', 8, 8), intervalo_medio_dias: 0 }, 'CADENCE'), false);
  assert.equal(matchesCustomerSegment(make('unknown', 3, 50), 'CADENCE'), false);
});
