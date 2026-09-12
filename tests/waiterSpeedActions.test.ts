import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { waiterTableMatchesQuery } from '../src/components/mesas/MesasView';
import type { Table } from '../src/types';

test('busca compacta encontra mesa por número, prefixo e nome', () => {
  const table = { id: 27, nome: 'Varanda Direita' } as Table;
  assert.equal(waiterTableMatchesQuery(table, '27'), true);
  assert.equal(waiterTableMatchesQuery(table, 'Mesa 27'), true);
  assert.equal(waiterTableMatchesQuery(table, 'varanda'), true);
  assert.equal(waiterTableMatchesQuery(table, '12'), false);
});

test('toque na mesa usa a navegação canônica: livre abre Pedido e ocupada abre Consumo', () => {
  const card = readFileSync(new URL('../src/components/MesaCard.tsx', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/components/mesas/MesasView.tsx', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../src/components/MesaDetailsModalBase.tsx', import.meta.url), 'utf8');

  assert.match(card, /onClick=\{\(\) => onClick\(table\.id\)\}/);
  assert.doesNotMatch(card, /onQuickOrder|quickOrderAction|quick-order-table-|Novo pedido na Mesa/);
  assert.doesNotMatch(view, /openWaiterQuickOrder|onQuickOrder/);
  assert.match(modal, /orders\.length === 0 \? 'lancamento' : 'consumo'/);
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

test('card do garçom usa Pedido como referência visual sem alterar a identidade interna', () => {
  const card = readFileSync(new URL('../src/components/MesaCard.tsx', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../src/components/shared/SharedTableCard.tsx', import.meta.url), 'utf8');

  assert.match(card, /identityLabel="Pedido"/);
  assert.match(shared, /identityLabel\?: string/);
  assert.match(shared, /identityLabel = 'Comanda'/);
  assert.match(shared, /\{identityLabel\} \{checkNumbers\[0\]\}/);
  assert.doesNotMatch(card, /footerAction/);
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

test('card do garçom não mostra contagem de itens e mantém tempo e total em linhas seguras', () => {
  const card = readFileSync(new URL('../src/components/MesaCard.tsx', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../src/components/shared/SharedTableCard.tsx', import.meta.url), 'utf8');

  assert.match(card, /showItemCount=\{false\}/);
  assert.match(shared, /showItemCount\?: boolean/);
  assert.match(shared, /showItemCount = true/);
  assert.match(shared, /showItemCount \? \(/);
  assert.match(shared, /space-y-1\.5/);
  assert.match(shared, /block whitespace-nowrap font-mono text-sm leading-none text-koma-foreground/);
  assert.match(shared, /UsersRound size=\{10\}/);
});
