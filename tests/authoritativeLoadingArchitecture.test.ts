import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('shared snapshot boundary is reused instead of duplicating first-load markup', () => {
  const shared = read('src/components/shared/KomaSnapshotLoading.tsx');
  const operational = read('src/components/app/OperationalSnapshotLoading.tsx');
  const route = read('src/components/app/AppRouteBoundary.tsx');
  const deferred = read('src/components/caixa/loading/DeferredCashierSection.tsx');

  assert.match(shared, /UNKNOWN não pode ser tratado como EMPTY/);
  assert.match(operational, /KomaSnapshotLoading/);
  assert.match(route, /KomaSnapshotLoading/);
  assert.match(deferred, /KomaSnapshotLoading/);
});

test('inventory publishes empty onboarding only after all resources for the view are known', () => {
  const owner = read('src/components/caixa/inventory/useCashierInventoryData.ts');
  const view = read('src/components/caixa/inventory/CashierInventory.tsx');

  assert.match(owner, /loadedResources/);
  assert.match(owner, /requiredResources\.every\(\(resource\) => loadedResources\.has\(resource\)\)/);
  assert.match(owner, /INVENTORY_INVALID_RESPONSE/);
  assert.match(view, /inventory-snapshot-loading/);
  assert.ok(
    view.indexOf("if (activeTab === 'estoque' && !isCurrentViewReady)") < view.indexOf("eyebrow={estoqueInsumos.length === 0 ? 'PRIMEIROS PASSOS'"),
    'inventory readiness must gate empty/onboarding projections',
  );
});

test('team never renders first-person onboarding before a successful people snapshot', () => {
  const team = read('src/components/caixa/team/CashierTeam.tsx');
  const roles = read('src/components/equipe/EquipeCargosTab.tsx');

  assert.match(team, /hasSystemUsersSnapshot/);
  assert.match(team, /team-snapshot-loading/);
  assert.match(team, /peopleViewActive && hasSystemUsersSnapshot/);
  assert.match(roles, /useState\(true\)/);
  assert.match(roles, /team-roles-snapshot-loading/);
});

test('financial and product reports bind rendered data to the selected query snapshot', () => {
  const financial = read('src/components/relatorios/RelatorioFinanceiroTab.tsx');
  const products = read('src/components/relatorios/RelatoriosProdutosTab.tsx');

  assert.match(financial, /loadedSnapshotKey !== snapshotKey/);
  assert.match(financial, /financial-report-snapshot-loading/);
  assert.match(products, /loadedSnapshotKey !== snapshotKey/);
  assert.match(products, /PRODUCT_REPORT_INVALID_RESPONSE/);
  assert.match(products, /products-report-snapshot-loading/);
});

test('super admin trial and audit summaries distinguish unavailable data from genuine zero', () => {
  const trials = read('src/super-admin/SuperAdminTrialsTab.tsx');
  const audit = read('src/super-admin/SuperAdminAuditTab.tsx');

  for (const source of [trials, audit]) {
    assert.match(source, /hasSnapshot/);
    assert.match(source, /KomaSnapshotLoading/);
  }
  assert.ok(trials.indexOf('if (!hasSnapshot)') < trials.indexOf('summary.active'));
  assert.ok(audit.indexOf('if (!hasSnapshot)') < audit.indexOf('filteredLogs.length === 0'));
});
