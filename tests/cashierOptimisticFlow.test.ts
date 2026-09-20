import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Order } from '../src/types';
import {
  projectDeliveryOrdersFromSharedSnapshot,
  reconcileDeliveryOrderAfterStatus,
} from '../src/components/caixa/orders/deliveryOrderProjection';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('optimistic Caixa delivery keeps the operational information needed by the Kanban', () => {
  const now = Date.now();
  const optimistic: Order = {
    id: `temp-${now}`,
    mesaId: 0,
    garcomId: 'c-01',
    garcomNome: 'Caixa 1',
    timestamp: now,
    created_at: new Date(now).toISOString(),
    tipo: 'Entrega',
    valorPago: 0,
    identificador: 'Cliente Teste',
    clienteId: 'customer-1',
    clientePhone: '88999999999',
    statusComanda: null,
    deliveryStatus: 'producao',
    deliveryAddress: 'Rua Teste, 123',
    deliveryTax: 5,
    origemOperacional: 'caixa',
    mesaOrigemId: null,
    mesaTransferidaDe: null,
    itens: [
      {
        id: 'temp-item-1',
        produtoId: 'p-1',
        nome: 'Hambúrguer',
        preco: 20,
        observacao: 'sem cebola',
        clienteNome: 'Cliente Teste',
        status: 'preparando',
      },
    ],
  };

  const [projected] = projectDeliveryOrdersFromSharedSnapshot([optimistic]);
  assert.ok(projected);
  assert.equal(projected.id, optimistic.id);
  assert.equal(projected.cliente, 'Cliente Teste');
  assert.equal(projected.telefone, '88999999999');
  assert.equal(projected.endereco, 'Rua Teste, 123');
  assert.equal(projected.total, 25);
  assert.equal(projected.origemOperacional, 'caixa');
  assert.equal(projected.modalidade, 'delivery');
  assert.equal(projected.status, 'producao');
});

test('delivery hydration never replaces a known customer with the generic placeholder', () => {
  const base = {
    id: 'order-1',
    telefone: '88999999999',
    itens: '1x Hambúrguer',
    detailItems: [],
    total: 20,
    canal: 'site',
    origemOperacional: 'caixa',
    isQuickSale: false,
    quantidadeItens: 1,
    modalidade: 'retirada',
    pago: false,
    status: 'producao',
    endereco: '',
    criadoEm: '12:00',
  } as const;

  const previous = { ...base, cliente: 'Georlan' } as any;
  const incoming = { ...base, cliente: 'Cliente Sem Nome' } as any;
  assert.equal(reconcileDeliveryOrderAfterStatus(previous, incoming).cliente, 'Georlan');

  const authoritative = { ...base, cliente: 'Nome Atualizado' } as any;
  assert.equal(reconcileDeliveryOrderAfterStatus(previous, authoritative).cliente, 'Nome Atualizado');
});

test('PDV reconciles or rolls back the temporary order instead of leaving duplicate cards', () => {
  const pdv = source('src/components/caixa/pdv/useCashierPdv.ts');
  const operational = source('src/components/app/data/useOperationalOrders.ts');
  const cashierOrders = source('src/components/caixa/orders/useCashierOrders.ts');

  assert.match(pdv, /koma_optimistic_order_reconcile/);
  assert.match(pdv, /koma_optimistic_order_remove/);
  assert.match(operational, /koma_optimistic_order_reconcile/);
  assert.match(operational, /String\(order\.id\) !== tempId/);
  assert.match(cashierOrders, /projectDeliveryOrdersFromSharedSnapshot\(orders\)/);
  assert.match(cashierOrders, /id\.startsWith\('temp-'\)/);
});

test('PDV models fulfillment separately from optional table association', () => {
  const pdv = source('src/components/caixa/pdv/useCashierPdv.ts');
  const view = source('src/components/caixa/pdv/CashierPdvView.tsx');

  assert.match(pdv, /useState<'pickup' \| 'delivery' \| 'dine_in'>\('pickup'\)/);
  assert.match(pdv, /mesa_id: orderType === 'delivery' \? null : mesaId \|\| null/);
  assert.doesNotMatch(pdv, /Selecione a mesa de destino antes de lançar o pedido/);
  assert.match(pdv, /getElementById\('pdv-target-table'\)/);

  assert.match(view, /pdvOrderType !== 'delivery'/);
  assert.match(view, /<option value="">Sem mesa<\/option>/);
  assert.match(view, /type\.id === 'delivery'\) setPdvTargetMesaId\(0\)/);
  assert.match(view, /id: 'dine_in', label: 'Consumo local'/);
});

test('customer lookup keeps validation and cancellation while removing artificial wait', () => {
  const pdv = source('src/components/caixa/pdv/useCashierPdv.ts');

  assert.match(pdv, /normalizedPhone\.length < 10 \|\| normalizedPhone\.length > 11/);
  assert.match(pdv, /new AbortController\(\)/);
  assert.match(pdv, /controller\.abort\(\)/);
  assert.match(pdv, /\}, 180\);/);
  assert.doesNotMatch(pdv, /\}, 350\);/);
});