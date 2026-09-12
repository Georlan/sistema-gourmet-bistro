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

test('atalho de pedido permanece integrado ao card sem virar FAB dominante', () => {
  const card = readFileSync(new URL('../src/components/MesaCard.tsx', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../src/components/shared/SharedTableCard.tsx', import.meta.url), 'utf8');

  assert.match(card, /operational\.occupancy === 'IN_SERVICE'/);
  assert.match(card, /footerAction=\{quickOrderAction\}/);
  assert.match(card, /quick-order-table-/);
  assert.match(card, /Novo pedido na Mesa/);
  assert.match(card, /bg-emerald-500\/\[0\.06\]/);
  assert.match(card, /h-7 w-7 shrink-0/);
  assert.doesNotMatch(card, /absolute right-2 top-1\/2/);
  assert.doesNotMatch(card, /rounded-full border border-emerald-400\/40 bg-emerald-500/);

  assert.match(shared, /footerAction\?: React\.ReactNode/);
  assert.match(shared, /items-center justify-between gap-2/);
});

test('grade do salão padroniza largura e altura de todos os cards', () => {
  const card = readFileSync(new URL('../src/components/MesaCard.tsx', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/components/mesas/MesasView.tsx', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../src/components/shared/SharedTableCard.tsx', import.meta.url), 'utf8');

  assert.match(view, /auto-rows-\[184px\]/);
  assert.match(view, /items-stretch/);
  assert.match(card, /relative h-full w-full min-w-0/);
  assert.match(card, /absolute inset-0 z-10 h-full w-full/);
  assert.match(card, /fillHeight/);
  assert.match(shared, /fillHeight\?: boolean/);
  assert.match(shared, /fillHeight \? 'h-full' : ''/);
  assert.doesNotMatch(card, /h-\[176px\]/);
  assert.doesNotMatch(card, /sm:h-\[184px\]/);
});

test('card do garçom não mostra contagem de itens e mantém o total dentro do rodapé', () => {
  const card = readFileSync(new URL('../src/components/MesaCard.tsx', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../src/components/shared/SharedTableCard.tsx', import.meta.url), 'utf8');

  assert.match(card, /showItemCount=\{false\}/);
  assert.match(shared, /showItemCount\?: boolean/);
  assert.match(shared, /showItemCount = true/);
  assert.match(shared, /mt-1\.5 block whitespace-nowrap font-mono text-xs leading-none text-koma-foreground/);
  assert.match(shared, /showItemCount && <span className="inline-flex items-center gap-1"><UsersRound/);
});
