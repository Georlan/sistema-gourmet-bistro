import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CASHIER_SIDEBAR_GROUPS,
  getCashierNavigationParentId,
  getCashierNavigationTarget,
} from '../src/components/caixa/navigation/cashierNavigation';

test('Configurações expõe destinos diretos sem duplicar os owners técnicos', () => {
  const system = CASHIER_SIDEBAR_GROUPS.find((group) => group.category === 'Sistema');
  const settings = system?.items.find((item) => item.id === 'impressao_salao');

  assert.deepEqual(settings?.children?.map((child) => child.label), [
    'Aparência',
    'Impressão',
    'Mesas',
    'App do Garçom',
    'Taxa de Serviço',
    'Implantação inicial',
    'Integrações',
  ]);
  assert.deepEqual(getCashierNavigationTarget('config_integracoes'), {
    tab: 'impressao_salao',
    subTab: 'integracoes',
  });
  assert.equal(getCashierNavigationParentId('config_integracoes'), 'impressao_salao');
});
