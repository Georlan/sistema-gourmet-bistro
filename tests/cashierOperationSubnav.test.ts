import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getCashierNavigationItem } from '../src/components/caixa/navigation/cashierNavigation';

test('operation horizontal tabs mirror Navigation Tree v2 children', () => {
  const operation = getCashierNavigationItem('operacao');
  assert.deepEqual(
    operation?.children?.map((child) => [child.id, child.label, child.target.subTab]),
    [
      ['vendas_pedidos', 'Pedidos', 'pedidos'],
      ['vendas_novo_pedido', 'Novo pedido', 'balcao'],
      ['vendas_salao', 'Salão', 'mesas'],
      ['vendas_cozinha', 'Cozinha', 'kds'],
      ['vendas_retiradas', 'Retiradas', 'retiradas'],
      ['vendas_entregas', 'Entregas', 'entregadores'],
    ],
  );
});

test('CaixaPanel delegates operation subnav clicks and active state to the shared navigation controller', () => {
  const panel = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');

  assert.match(panel, /<CashierSubNavigation/);
  assert.match(panel, /onNavigate=\{handleSidebarNavigation\}/);
  const subnav = readFileSync(new URL('../src/components/caixa/navigation/CashierSubNavigation.tsx', import.meta.url), 'utf8');
  assert.match(subnav, /onNavigate\(item.id\)/);
  assert.match(subnav, /isCashierNavigationActive\(item.id/);
  assert.doesNotMatch(panel, /\{ id: 'pedidos', label: 'Pedidos' \}[\s\S]*\{ id: 'mesas', label: 'Salão' \}/);
});
