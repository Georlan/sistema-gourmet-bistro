import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { describeTableOrders, indexTableOrders } from '../src/domain/tableReadModel';
import { projectCashierSalonTables } from '../src/domain/cashierSalonProjection';
import { countWaiterSalonTables, projectWaiterSalonTables } from '../src/domain/waiterSalonProjection';
import { deriveTableOperationalState, isActiveOperationalOrder } from '../src/domain/operationalState';
import type { Order, Table } from '../src/types';

const now = 1_800_000_000_000;
function check(id: string, mesaId: number, extra: Partial<Order> = {}): Order {
  return { id, mesaId, numeroPedido: 24, garcomId: 'ana', garcomNome: 'Ana', timestamp: now - 60000,
    itens: [{ id: 'item-' + id, produtoId: 'p', nome: 'Prato', preco: 48, status: 'pronto', observacao: '', clienteNome: 'Cliente', lancamentoId: 'launch-' + id }],
    ...extra };
}

test('table index preserves direct scopes, active-check policy and first merge reference without mutation', () => {
  const orders = [check('one', 7), check('closed', 7, { status: 'fechada' }),
    check('merged', 8, { mesaOrigemId: 7 }), check('later-merge', 9, { mesaOrigemId: 7 })];
  const snapshot = structuredClone(orders);
  const index = indexTableOrders(Object.freeze(orders));
  assert.deepEqual(index.byTable.get(7), orders.slice(0, 2));
  assert.deepEqual(index.activeByTable.get(7), [orders[0]]);
  assert.equal(index.mergedInto.get(7), 8);
  assert.deepEqual(orders, snapshot);
});

test('indexed cashier adapter matches the legacy projection across merges, closed checks and payments', () => {
  const tables: Table[] = Array.from({ length: 80 }, (_, id) => ({ id: id + 1, capacidade: 4,
    status: id % 9 === 0 ? 'ocupada' : 'livre' }));
  const orders = Array.from({ length: 240 }, (_, id) => check('c' + id, id % 65 + 1, {
    status: id % 11 === 0 ? 'fechada' : undefined,
    mesaOrigemId: id % 17 === 0 ? 70 + id % 10 : null,
    statusComanda: id % 7 === 0 ? 'aguardando_pagamento' : null,
  }));
  const pending = [{ comanda_id: 'c3' }, { comanda_id: 'c8' }];
  const legacy = tables.map(table => {
    const mergedIntoMesaId = orders.find(order => order.mesaOrigemId === table.id)?.mesaId || null;
    const isMerged = mergedIntoMesaId !== null;
    const displayMesaId = isMerged ? mergedIntoMesaId : table.id;
    const tableOrders = orders.filter(order => order.mesaId === displayMesaId && isActiveOperationalOrder(order));
    const operational = deriveTableOperationalState({ table, orders: tableOrders, pendingPayments: pending, mergedIntoMesaId, now });
    const total = tableOrders.reduce((sum, order) => sum + order.itens.reduce((amount, item) => amount + Number(item.preco || 0), 0), 0);
    return { table, displayMesaId, tableOrders, isMerged, isOccupied: operational.occupancy === 'IN_SERVICE',
      hasPendingPayment: operational.hasPendingPayment, operational, total };
  });
  assert.deepEqual(projectCashierSalonTables(tables, orders, pending, now).map(({ context, ...row }) => row), legacy);
});

test('waiter adapter retains direct table visibility and independent ready/payment signals', () => {
  const orders = [check('one', 7), check('moved', 8, { mesaOrigemId: 7 })];
  const rows = projectWaiterSalonTables([{ id: 7, capacidade: 4 }, { id: 8, capacidade: 4 }, { id: 9, capacidade: 2 }], orders, [], now);
  assert.deepEqual(rows[0].tableOrders, [orders[0]]);
  assert.equal(rows[0].operationalState.mergedIntoMesaId, 8);
  assert.equal(rows[0].operationalState.financial, 'OPEN');
  assert.deepEqual(countWaiterSalonTables(rows), { todos: 3, livres: 1, ocupadas: 2, prontas: 2 });
  assert.equal(countWaiterSalonTables(rows, false).prontas, 0);
});

test('context deduplicates by technical IDs and keeps persisted or missing identities honest', () => {
  const first = check('__proto__', 7, { launchIdentities: { 'launch-__proto__': { displayNumber: '24-AA' } } });
  const moved = check('constructor', 7, { numeroPedido: 25, garcomNome: 'Bruno',
    itens: [{ ...first.itens[0], id: 'moved-item' }] });
  const missing = check('unknown', 7);
  const legacy = check('legacy', 7, { itens: [{ ...first.itens[0], id: 'old', lancamentoId: undefined }] });
  const context = describeTableOrders([first, moved, missing, legacy]);
  assert.equal(context.checkCount, 4);
  assert.deepEqual(context.checkNumbers, [24, 25]);
  assert.deepEqual(context.launches, [{ id: 'launch-__proto__', displayNumber: '24-AA' }, { id: 'launch-unknown', displayNumber: undefined }]);
  assert.deepEqual(context.attendants, ['Ana', 'Bruno']);
  assert.equal(context.hasUnidentifiedItems, true);
});

test('table index traverses its input snapshot once; consumers depend on concrete shared modules', () => {
  let visits = 0;
  const original = Array.from({ length: 100 }, (_, id) => check('c' + id, id % 10));
  const input = new Proxy(original, { get(target, property, receiver) {
    if (property === Symbol.iterator) return function* () { for (const order of target) { visits++; yield order; } };
    return Reflect.get(target, property, receiver);
  } });
  indexTableOrders(input);
  assert.equal(visits, 100);
  for (const file of ['src/components/shared/SharedTableCard.tsx', 'src/domain/cashierSalonProjection.ts', 'src/domain/waiterSalonProjection.ts']) {
    assert.match(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), /tableReadModel/);
  }
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /rows=\{waiterTableRows\}/);
  const view = readFileSync(new URL('../src/components/mesas/MesasView.tsx', import.meta.url), 'utf8');
  assert.match(view, /operational=\{operationalState\}/);
});
