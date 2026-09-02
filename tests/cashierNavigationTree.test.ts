import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CASHIER_SIDEBAR_GROUPS,
  getCashierNavigationTarget,
} from '../src/components/caixa/navigation/cashierNavigation';

const flatten = () => CASHIER_SIDEBAR_GROUPS.flatMap((group) => group.items);

test('navigation tree v2 has the intended product information architecture', () => {
  assert.deepEqual(
    CASHIER_SIDEBAR_GROUPS.map((group) => group.category),
    ['Operação', 'Cadastros', 'Vendas online', 'Gestão', 'Sistema'],
  );

  const items = flatten();
  assert.equal(new Set(items.map((item) => item.id)).size, items.length, 'navigation ids must be unique');
  assert.deepEqual(
    items.map((item) => [item.id, item.label]),
    [
      ['operacao', 'Vendas'],
      ['financeiro', 'Caixa'],
      ['cardapio', 'Cardápio'],
      ['estoque', 'Estoque & compras'],
      ['clientes', 'Clientes'],
      ['cardapio_digital', 'Cardápio online'],
      ['relatorios', 'Relatórios'],
      ['permissoes_cargos', 'Equipe'],
      ['impressao_salao', 'Configurações'],
      ['assinatura_pix', 'Conta & assinatura'],
    ],
  );
});

test('navigation tree owns default tab and subtab destinations', () => {
  assert.deepEqual(getCashierNavigationTarget('operacao'), { tab: 'operacao', subTab: 'pedidos' });
  assert.deepEqual(getCashierNavigationTarget('financeiro'), { tab: 'financeiro', subTab: 'turno_atual' });
  assert.deepEqual(getCashierNavigationTarget('estoque'), { tab: 'estoque', subTab: 'insumos' });
  assert.deepEqual(getCashierNavigationTarget('cardapio_digital'), {
    tab: 'cardapio_digital',
    subTab: 'cardapio_digital',
  });
  assert.deepEqual(getCashierNavigationTarget('assinatura_pix'), {
    tab: 'assinatura_pix',
    subTab: 'planos',
  });
  assert.equal(getCashierNavigationTarget('nao-existe'), undefined);
});

test('online menu and subscription are primary navigation, not duplicated footer shortcuts', () => {
  const footer = readFileSync(
    new URL('../src/components/caixa/navigation/CashierSidebarFooter.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(footer, /CASHIER_SIDEBAR_SECONDARY_ITEMS/);
  assert.doesNotMatch(footer, /Acesso rápido/);
});
