import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('delivery stages are never invented while hydrating or reconciling the cashier', () => {
  const projection = source('src/components/caixa/orders/deliveryOrderProjection.ts');
  const owner = source('src/components/caixa/orders/useCashierOrders.ts');

  assert.match(projection, /readActiveDeliveryStatus/);
  assert.doesNotMatch(projection, /deliveryStatus\s*\|\|\s*['"]pendente['"]/);
  assert.doesNotMatch(owner, /delivery_status\s*\|\|\s*['"]pendente['"]/);
  assert.match(projection, /export function projectApiComandaToDeliveryView\(c: any\): DeliveryOrderView \| null/);
  assert.match(owner, /mapComandaToDeliveryView = projectApiComandaToDeliveryView/);
});

test('digital orders have a single identity-based sound owner and reload only establishes baseline', () => {
  const alerts = source('src/components/caixa/realtime/useCashierAlerts.ts');

  assert.match(alerts, /isCashierTableOrder\(o\)/);
  assert.match(alerts, /knownDigitalOrderIdsRef = useRef<Set<string> \| null>\(null\)/);
  assert.match(alerts, /if \(knownDigitalOrderIdsRef\.current === null\)/);
  assert.match(alerts, /some\(\(id\) => !known\.has\(id\)\)/);
  assert.doesNotMatch(alerts, /prevDeliveryPendingCountRef/);
});

test('unknown cash shift is neutral until the server confirms open or closed', () => {
  const shift = source('src/components/caixa/shift/useCashShift.ts');
  const panel = source('src/components/CaixaPanel.tsx');
  const desktop = source('src/components/caixa/navigation/CashierDesktopSidebar.tsx');
  const mobile = source('src/components/caixa/navigation/CashierMobileSidebar.tsx');

  assert.match(shift, /useState<CashShiftLoadState>\(['"]loading['"]\)/);
  assert.match(shift, /current === ['"]loaded['"] \? current : ['"]loading['"]/);
  assert.match(panel, /cashShiftUiState/);
  assert.match(panel, /Sincronizando turno de caixa/);
  assert.match(panel, /Não foi possível confirmar o turno/);
  assert.doesNotMatch(panel, /turno\?\.status !== ['"]aberto['"]/);
  assert.match(desktop, /Sincronizando caixa/);
  assert.match(mobile, /Sincronizando caixa/);
});

test('remote empty states are not presented as authoritative defaults before loading', () => {
  const online = source('src/components/caixa/online-menu/OnlineOrderEmergencyControl.tsx');
  const settings = source('src/components/caixa/settings/useCashierSettings.ts');
  const settingsView = source('src/components/caixa/settings/CashierSettings.tsx');
  const couriers = source('src/components/caixa/orders/CashierCouriers.tsx');
  const orders = source('src/components/caixa/orders/useCashierOrders.ts');
  const shift = source('src/components/caixa/shift/useCashShift.ts');

  assert.match(online, /statusLoading/);
  assert.match(online, /Sincronizando cardápio online/);
  assert.doesNotMatch(online, /counts\?\.active\s*\?\?\s*0/);

  assert.match(settings, /settingsLoadState/);
  assert.match(settingsView, /settingsLoadState === ['"]loaded['"]/);
  assert.match(settingsView, /Aguardando os valores reais do restaurante/);

  assert.match(orders, /motoboysLoadState/);
  assert.match(couriers, /Sincronizando entregadores/);
  assert.match(shift, /isCaixaMovimentacoesLoading[^\n]*useState\(true\)/);
});
