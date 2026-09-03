import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getCashierNavigationItem, getCashierNavigationTarget } from '../src/components/caixa/navigation/cashierNavigation';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Cardápio online exposes Perfil, Pedidos & horários and Marca from the canonical tree', () => {
  const online = getCashierNavigationItem('cardapio_digital');
  assert.deepEqual(online?.children?.map((child) => child.label), ['Perfil', 'Pedidos & horários', 'Marca']);
  assert.deepEqual(getCashierNavigationTarget('online_perfil'), { tab: 'cardapio_digital', subTab: 'cardapio_perfil' });
  assert.deepEqual(getCashierNavigationTarget('online_pedidos'), { tab: 'cardapio_digital', subTab: 'cardapio_pedidos' });
  assert.deepEqual(getCashierNavigationTarget('online_marca'), { tab: 'cardapio_digital', subTab: 'cardapio_marca' });
});

test('CashierOnlineMenu maps navigation subtab to the canonical settings owner', () => {
  const onlineMenu = source('../src/components/caixa/online-menu/CashierOnlineMenu.tsx');
  assert.match(onlineMenu, /activeSubTab/);
  assert.match(onlineMenu, /activeSection=\{activeSection\}/);
  assert.match(onlineMenu, /cardapio_perfil/);
  assert.match(onlineMenu, /cardapio_pedidos/);
  assert.match(onlineMenu, /cardapio_marca/);
});

test('CardapioDigitalSettingsPanel is controlled by its caller instead of private navigation state', () => {
  const panel = source('../src/components/cardapio/CardapioDigitalSettingsPanel.tsx');
  assert.match(panel, /activeSection/);
  assert.match(panel, /onSectionChange/);
  assert.doesNotMatch(panel, /useState<SettingsTab>\('perfil'\)/);
});
