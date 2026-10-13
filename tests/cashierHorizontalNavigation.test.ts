import assert from 'node:assert/strict';
import test from 'node:test';
import { getCashierHorizontalItems, getCashierSidebarGroupsForPlan, getCashierSetupSidebarGroupsForPlan, isCashierNavigationActive } from '../src/components/caixa/navigation/cashierNavigation';
import { buildCashierFunctionSearchEntries, searchCashierFunctions } from '../src/components/caixa/navigation/cashierFunctionSearch';

const enabled = { printing: true, waiter_app: true, inventory: true, kds: true, advanced_reports: true, coupons: true, loyalty: true, courier_app: true };
test('every workspace shares horizontal destinations with the sidebar, including setup and restricted capabilities', () => {
  for (const capabilities of [enabled, { ...enabled, printing: false, waiter_app: false, inventory: false, advanced_reports: false }]) {
    for (const setup of [false, true]) {
      const groups = setup ? getCashierSetupSidebarGroupsForPlan('premium', capabilities) : getCashierSidebarGroupsForPlan('premium', capabilities);
      for (const item of groups.flatMap(group => group.items)) {
        assert.deepEqual(getCashierHorizontalItems(item.id, 'premium', capabilities, setup), item.children ?? []);
      }
    }
  }
});

test('attendance replaces small standalone tabs without hiding service tax when waiter app is absent', () => {
  const groups = getCashierSidebarGroupsForPlan('premium', { ...enabled, waiter_app: false });
  const settings = getCashierHorizontalItems('impressao_salao', 'premium', { ...enabled, waiter_app: false });
  assert.equal(settings.some(item => item.id === 'config_atendimento'), true);
  assert.equal(settings.some(item => ['config_taxa', 'config_garcom'].includes(item.id)), false);
  for (const subTab of ['taxa', 'garcom', 'atendimento']) assert.equal(isCashierNavigationActive('config_atendimento', 'impressao_salao', subTab), true);
  const entries = buildCashierFunctionSearchEntries(groups, true);
  assert.equal(searchCashierFunctions(entries, 'gorjeta')[0]?.id, 'config_atendimento');
  assert.deepEqual(searchCashierFunctions(entries, 'permissoes garcom'), []);
});
