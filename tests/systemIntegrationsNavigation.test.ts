import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CASHIER_SIDEBAR_GROUPS,
  getCashierNavigationParentId,
  getCashierNavigationTarget,
} from '../src/components/caixa/navigation/cashierNavigation';

test('Configurações exposes Salão e impressão plus Integrações without duplicating owners', () => {
  const system = CASHIER_SIDEBAR_GROUPS.find((group) => group.category === 'Sistema');
  const settings = system?.items.find((item) => item.id === 'impressao_salao');

  assert.deepEqual(settings?.children?.map((child) => child.label), [
    'Salão e impressão',
    'Integrações',
  ]);
  assert.deepEqual(getCashierNavigationTarget('config_integracoes'), {
    tab: 'impressao_salao',
    subTab: 'integracoes',
  });
  assert.equal(getCashierNavigationParentId('config_integracoes'), 'impressao_salao');
});
