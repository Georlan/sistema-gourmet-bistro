import test from 'node:test';
import assert from 'node:assert/strict';
import { supportTargetForCockpit } from '../src/super-admin/supportNavigation';
import { getCashierNavigationChild } from '../src/components/caixa/navigation/cashierNavigation';

test('support shortcuts resolve to the same destinations as the operational menu', () => {
  for (const [key, id] of Object.entries({ profile: 'online_perfil', hours: 'online_pedidos', catalog: 'cardapio_produtos', 'dine-in': 'config_mesas', delivery: 'online_entrega', payment: 'online_pagamentos', printing: 'config_impressao' })) {
    const item = getCashierNavigationChild(id)!;
    assert.deepEqual(supportTargetForCockpit(key), { ...item.target, label: item.label });
  }
  assert.equal(supportTargetForCockpit('missing'), null);
});
