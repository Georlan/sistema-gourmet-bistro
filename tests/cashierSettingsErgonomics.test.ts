import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settings = readFileSync('src/components/caixa/settings/CashierSettings.tsx', 'utf8');
const appearance = readFileSync('src/components/caixa/settings/CashierAppearanceSettings.tsx', 'utf8');
const responsiveCss = readFileSync('src/components/caixa/navigation/cashierLowHeight.css', 'utf8');
const waiterSettings = readFileSync('src/components/caixa/settings/CashierWaiterSettings.tsx', 'utf8');
const waiterPermissions = readFileSync('src/components/caixa/settings/waiterPermissions.ts', 'utf8');

test('cashier settings expose task groups and remember the last operator section', () => {
  assert.match(settings, /CASHIER_SETTINGS_TAB_STORAGE_KEY = 'koma_cashier_settings_tab'/);
  assert.match(settings, /useState<CashierSettingsTab>\(readInitialCashierSettingsTab\)/);
  assert.match(settings, /window\.localStorage\.getItem\(CASHIER_SETTINGS_TAB_STORAGE_KEY\)/);
  assert.match(settings, /window\.localStorage\.setItem\(CASHIER_SETTINGS_TAB_STORAGE_KEY, tab\)/);
  assert.match(settings, /Configurações do Caixa/);
  assert.match(settings, /aria-label="Configurações do caixa"/);
  assert.match(settings, /label: 'Neste dispositivo'/);
  assert.match(settings, /label: 'Operação do salão'/);
  assert.match(settings, /label: 'Aparência'/);
  assert.match(settings, /label: 'Impressão'/);
  assert.match(settings, /label: 'Mesas'/);
  assert.match(settings, /label: 'App do Garçom'/);
  assert.match(settings, /label: 'Taxa de Serviço'/);
  assert.match(settings, /onClick=\{\(\) => selectSettingsTab\(tab\.id\)\}/);
  assert.match(settings, /<CashierAppearanceSettings \/>/);
});

test('appearance settings persist theme and local text size using the cashier preference contract', () => {
  assert.match(appearance, /persistKomaTheme\(nextTheme\)/);
  assert.match(appearance, /localStorage\.setItem\('koma_font_size', nextFontSize\)/);
  assert.match(appearance, /koma_font_size_changed/);
  assert.match(appearance, /aria-label="Tema do caixa"/);
  assert.match(appearance, /aria-label="Tamanho do texto do caixa"/);
  assert.match(appearance, /aria-pressed=\{selected\}/);
});

test('mobile cashier topbar reserves independent 44px touch targets for menu, chat and fullscreen', () => {
  assert.match(responsiveCss, /@media \(max-width: 639px\)/);
  assert.match(responsiveCss, /#btn-mobile-caixa-sidebar-open,[\s\S]*#btn-caixa-conversas-drawer,[\s\S]*#btn-modo-pdv-fullscreen/);
  assert.match(responsiveCss, /width: 2\.75rem/);
  assert.match(responsiveCss, /min-height: 2\.75rem/);
  assert.doesNotMatch(responsiveCss, /(?:width|height|min-width|min-height): 2\.55rem/);
  assert.match(responsiveCss, /#btn-caixa-conversas-drawer > span:not\(\[role="status"\]\)[\s\S]*display: none/);
  assert.match(responsiveCss, /\.cashier-subnav__button[\s\S]*min-height: 2\.75rem/);
});

test('cashier printing settings separates state and diagnostics, coupon, and delivery into operational contexts', () => {
  const printing = readFileSync('src/components/caixa/settings/CashierPrintingSettings.tsx', 'utf8');

  // Contexto 1: Estado e diagnóstico
  assert.match(printing, /Estado e diagnóstico/);
  assert.match(printing, /<PrintMonitorPanel/);
  assert.match(printing, /Homologação do App do Garçom/);
  assert.match(printing, /Teste extremo — Garçom/);
  assert.match(printing, /\/impressao\/teste-extremo-garcom/);
  assert.match(printing, /sem criar pedido real, estoque ou movimento de caixa/);
  assert.match(printing, /Impressão não incluída no Kôma Pocket/);

  // Contexto 2: Cupom
  assert.match(printing, /aria-labelledby="printing-receipt-heading"/);
  assert.match(printing, /<Receipt /);
  assert.match(printing, /Nome do restaurante no cupom:/);
  assert.match(printing, /Onde imprimir o nome:/);
  assert.match(printing, /Mensagem adicional de rodapé:/);
  assert.match(printing, /SALVO NO RESTAURANTE/);
  assert.match(printing, /Prévia aproximada/);

  // Contexto 3: Delivery
  assert.match(printing, /aria-labelledby="printing-delivery-heading"/);
  assert.match(printing, /<Truck /);
  assert.match(printing, /Unificar vias de delivery \(via única\)/);
  assert.match(printing, /unificar_vias_delivery/);
  assert.match(printing, /Via única \(marcado\)/);
  assert.match(printing, /Vias separadas \(desmarcado\)/);
  assert.match(printing, /Imprime uma única comanda com dados do cliente, itens e entrega juntos/);

  // Contrato do controller preservado
  assert.match(printing, /ReturnType<typeof useCashierSettings>/);
});

test('waiter settings separate actionable permissions from future capabilities and use operational labels', () => {
  assert.match(waiterSettings, /WAITER_SETTINGS_GROUPS/);
  assert.match(waiterSettings, /label: 'Pedidos'/);
  assert.match(waiterSettings, /label: 'Fechamento'/);
  assert.match(waiterSettings, /label: 'Atendimento'/);
  assert.match(waiterSettings, /Ações disponíveis agora/);
  assert.match(waiterSettings, /Ainda não disponível/);
  assert.match(waiterSettings, /Em preparação/);
  assert.match(waiterSettings, /availablePermissions\.map/);
  assert.match(waiterSettings, /unavailablePermissions\.map/);
  assert.match(waiterSettings, /setConfigSalSubTab\(group\.id\)/);
  assert.doesNotMatch(waiterSettings, /as any/);
  assert.match(waiterSettings, /updateConfiguracoes\(\{ \[item\.key\]: event\.target\.checked \}\)/);
  assert.match(waiterSettings, /ReturnType<typeof useCashierSettings>/);

  assert.match(waiterPermissions, /title: 'Criar pedidos de delivery'/);
  assert.match(waiterPermissions, /title: 'Editar pedidos em andamento'/);
  assert.match(waiterPermissions, /title: 'Fechar conta pelo app'/);
  assert.match(waiterPermissions, /title: 'Transferir mesa ou comanda'/);
  assert.doesNotMatch(waiterPermissions, /title: 'Permitir que/);
});
