import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { openWaiterQuickOrder, waiterTableMatchesQuery } from '../src/components/mesas/MesasView';
import type { Table } from '../src/types';

test('busca compacta encontra mesa por número, prefixo e nome', () => {
  const table = { id: 27, nome: 'Varanda Direita' } as Table;
  assert.equal(waiterTableMatchesQuery(table, '27'), true);
  assert.equal(waiterTableMatchesQuery(table, 'Mesa 27'), true);
  assert.equal(waiterTableMatchesQuery(table, 'varanda'), true);
  assert.equal(waiterTableMatchesQuery(table, '12'), false);
});

test('atalho de novo pedido abre a mesa e segue direto para a aba Pedido', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const calls: string[] = [];

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      requestAnimationFrame: (callback: () => void) => { callback(); return 1; },
      setTimeout: (callback: () => void) => { callback(); return 1; },
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      getElementById: (id: string) => ({ click: () => calls.push(id) }),
    },
  });

  try {
    openWaiterQuickOrder(12, (tableId) => calls.push(`mesa-${tableId}`));
    assert.deepEqual(calls, ['mesa-12', 'tab-lancamento-btn']);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('produto esgotado continua bloqueado e só ganha visibilidade durante busca', () => {
  const menu = readFileSync(new URL('../src/components/MenuPanel.tsx', import.meta.url), 'utf8');
  assert.match(menu, /activeProducts = useMemo/);
  assert.match(menu, /ativo !== false/);
  assert.match(menu, /unavailableSearchMatches/);
  assert.match(menu, /decorated\.ativo === false/);
  assert.match(menu, /if \(!query\) return \[\]/);
  assert.match(menu, /Indisponíveis encontrados/);
  assert.match(menu, /Indisponível para lançamento/);
  assert.match(menu, /aria-disabled="true"/);
});

test('botão rápido só é oferecido para mesa em atendimento e não substitui o toque normal', () => {
  const card = readFileSync(new URL('../src/components/MesaCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /operational\.occupancy === 'IN_SERVICE'/);
  assert.match(card, /onClick=\{\(\) => onClick\(table\.id\)\}/);
  assert.match(card, /quick-order-table-/);
  assert.match(card, /Novo pedido na Mesa/);
});
