import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inventoryResources, inventoryResourcesForTab } from '../src/components/caixa/inventory/inventoryResources';
import { aplicarMascaraTelefoneInput } from '../src/utils/phonePresentation';
import { DEFAULT_WAITER_PERMISSIONS, WAITER_PERMISSIONS, patchWaiterPermissions, readWaiterPermissions } from '../src/components/caixa/settings/waiterPermissions';
import { canonicalRoleSlug, ROLE_META, ROLE_ORDER } from '../src/components/equipe/teamRoles';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('waiter metadata preserves known keys, initial values and pending integrations', () => {
  assert.equal(WAITER_PERMISSIONS.length, 15);
  assert.equal(new Set(WAITER_PERMISSIONS.map(item => item.key)).size, 15);
  assert.equal(WAITER_PERMISSIONS.filter(item => item.available).length, 8);
  assert.deepEqual(WAITER_PERMISSIONS.filter(item => !item.available).map(item => item.key), [
    'perm_garcom_taxas', 'perm_garcom_abrir_vazia', 'perm_garcom_desconto',
    'perm_garcom_acrescimo', 'perm_garcom_pessoas', 'perm_garcom_chamar', 'perm_garcom_ociosas',
  ]);
  assert.equal(DEFAULT_WAITER_PERMISSIONS.perm_garcom_fechar, false);
  assert.equal(DEFAULT_WAITER_PERMISSIONS.perm_garcom_pessoas, true);
  const fromServer = readWaiterPermissions({ perm_garcom_delivery: false });
  assert.equal(fromServer.perm_garcom_delivery, false);
  assert.equal(fromServer.perm_garcom_fechar, undefined);
  const updated = patchWaiterPermissions(DEFAULT_WAITER_PERMISSIONS, {
    perm_garcom_delivery: false, perm_garcom_editar: undefined, extra: true,
  } as any);
  assert.equal(updated.perm_garcom_delivery, false);
  assert.equal(updated.perm_garcom_editar, true);
  assert.equal(DEFAULT_WAITER_PERMISSIONS.perm_garcom_delivery, true);
  assert.equal('extra' in updated, false);
});

test('role presentation preserves aliases and leaves unknown server roles alone', () => {
  assert.equal(canonicalRoleSlug('operador_caixa'), 'caixa');
  for (const role of ['custom', 'constructor', '__proto__', 'Admin']) assert.equal(canonicalRoleSlug(role), role);
  assert.deepEqual(ROLE_ORDER, ['admin', 'gerente', 'caixa', 'garcom', 'atendente', 'cozinha', 'motoboy']);
  assert.equal(ROLE_META.caixa.label, 'Operador de caixa');
  assert.notEqual(ROLE_META.cozinha.description, ROLE_META.cozinha.permissionDescription);
});

test('online settings mounts the canonical panel directly; uploader cannot replace the page', () => {
  const view = source('src/components/caixa/online-menu/CashierOnlineMenu.tsx');
  assert.match(view, /<CardapioDigitalSettingsPanel/);
  assert.doesNotMatch(view, /useState|fetch\(|config-cardapio|CardapioAssetUploader/);
  const upload = source('src/components/CardapioAssetUploader.tsx');
  assert.doesNotMatch(upload, /createPortal|closest\(|parentElement|CardapioDigitalSettingsPanel/);
  assert.match(upload, /onChange/);
  assert.match(source('src/components/cardapio/CardapioDigitalSettingsPanel.tsx'), /<CardapioAssetUploader/);
});

test('cashier catalog derives from live data without shadow state or a second GET', () => {
  const owner = source('src/components/caixa/catalog/useCashierCatalog.ts');
  assert.doesNotMatch(owner, /useState|useEffect|fetch\(/);
  assert.match(owner, /apiProdutos = liveProdutos/);
  assert.match(owner, /dynamicMenu: liveProdutos/);
  assert.match(owner, /fetchProdutos: onRefreshCategorias/);
  assert.match(owner, /fetchCategorias: onRefreshCategorias/);
});

test('cashier fallback cannot poll the order snapshot owned by App', () => {
  const realtime = source('src/components/caixa/realtime/useCashierRealtime.ts');
  assert.doesNotMatch(realtime, /onRefreshOrders|fetchOrdersFromAPI/);
  assert.match(realtime, /fetchDeliveryOrders\(\)/);
  assert.match(source('src/App.tsx'), /fetchOrdersFromAPI\(\);[\s\S]*?8000/);
});

test('inventory resource plans load what each screen and its dialogs use', () => {
  assert.deepEqual(inventoryResourcesForTab('insumos'), ['insumos', 'fichas']);
  assert.deepEqual(inventoryResourcesForTab('fornecedores'), ['insumos', 'distribuidores']);
  for (const tab of ['inventario', 'contagem'])
    assert.deepEqual(inventoryResourcesForTab(tab), ['insumos', 'contagens']);
  for (const tab of ['historico', 'entradas', 'movimentacoes']) {
    const resources = inventoryResourcesForTab(tab);
    assert.equal(new Set(resources).size, resources.length);
    for (const key of resources) assert.ok(inventoryResources[key]);
    for (const key of ['insumos', 'distribuidores', 'notas', 'entradas', 'movimentacoes'])
      assert.ok(resources.includes(key as keyof typeof inventoryResources));
  }
});

test('inventory mutations invalidate the owner instead of reimplementing snapshot reads', () => {
  const operations = source('src/components/caixa/inventory/useCashierInventoryOperations.ts');
  assert.doesNotMatch(operations, /\.then\(/);
  assert.match(operations, /refreshInventory\('insumos', 'movimentacoes', 'contagens'\)/);
  const owner = source('src/components/caixa/inventory/useCashierInventoryData.ts');
  assert.match(owner, /controller.signal.aborted/);
  assert.match(owner, /controller.abort\(\)/);
  assert.match(owner, /new Set\(resources\)/);
});

test('phone input uses one helper while preserving partial and complete values', () => {
  assert.equal(aplicarMascaraTelefoneInput(''), '');
  assert.equal(aplicarMascaraTelefoneInput('8'), '(8');
  assert.equal(aplicarMascaraTelefoneInput('85999990001'), '(85) 99999-0001');
  assert.equal(aplicarMascaraTelefoneInput('8533330001'), '(85) 3333-0001');
  assert.match(source('src/App.tsx'), /from '.\/utils\/phonePresentation'/);
  assert.doesNotMatch(source('src/App.tsx'), /const aplicarMascaraTelefoneInput/);
});
