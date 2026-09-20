import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settings = readFileSync('src/components/caixa/settings/CashierSettings.tsx', 'utf8');
const settingsController = readFileSync('src/components/caixa/settings/useCashierSettings.ts', 'utf8');
const appearance = readFileSync('src/components/caixa/settings/CashierAppearanceSettings.tsx', 'utf8');
const responsiveCss = readFileSync('src/components/caixa/navigation/cashierLowHeight.css', 'utf8');
const waiterSettings = readFileSync('src/components/caixa/settings/CashierWaiterSettings.tsx', 'utf8');
const waiterPermissions = readFileSync('src/components/caixa/settings/waiterPermissions.ts', 'utf8');
const tableSettings = readFileSync('src/components/caixa/settings/CashierTableSettings.tsx', 'utf8');

test('cashier settings render only the active canonical destination without internal navigation cards', () => {
  const navigation = readFileSync('src/components/caixa/navigation/cashierNavigation.ts', 'utf8');
  const panel = readFileSync('src/components/CaixaPanel.tsx', 'utf8');

  assert.match(navigation, /config_aparencia[\s\S]*Aparência[\s\S]*subTab: 'aparencia'/);
  assert.match(navigation, /config_impressao[\s\S]*Impressão[\s\S]*subTab: 'impressao'/);
  assert.match(navigation, /config_mesas[\s\S]*Mesas[\s\S]*subTab: 'mesas'/);
  assert.match(navigation, /config_garcom[\s\S]*App do Garçom[\s\S]*subTab: 'garcom'/);
  assert.match(navigation, /config_taxa[\s\S]*Taxa de Serviço[\s\S]*subTab: 'taxa'/);
  assert.match(navigation, /config_implantacao[\s\S]*Implantação inicial[\s\S]*subTab: 'implantacao'/);
  assert.match(navigation, /config_integracoes[\s\S]*Integrações[\s\S]*subTab: 'integracoes'/);
  assert.match(panel, /settingsSubnavItems = getCashierNavigationItem\('impressao_salao'\)\?\.children \?\? \[\]/);
  assert.match(panel, /activeTab === 'impressao_salao' && settingsSubnavItems\.map/);

  assert.doesNotMatch(settings, /cashier-settings-tab|CASHIER_SETTINGS_GROUPS|selectSettingsTab|readInitialCashierSettingsTab/);
  assert.doesNotMatch(settings, /Configurações do Caixa/);
  assert.match(settings, /activeSubTab === 'aparencia'/);
  assert.match(settings, /activeSubTab === 'impressao'/);
  assert.match(settings, /activeSubTab === 'implantacao'/);
  assert.match(settings, /<CashierAppearanceSettings \/>/);
  assert.match(settings, /<CashierIntegrationsSettings/);
});

test('table settings stay configuration-only and do not leak the operational salon', () => {
  const panel = readFileSync('src/components/CaixaPanel.tsx', 'utf8');

  assert.match(panel, /activeTab === 'operacao' && activeSubTab === 'mesas'/);
  assert.match(panel, /activeTab === 'operacao' && cashShiftUiState !== 'open'/);
  assert.match(panel, /active=\{activeTab === 'operacao' && activeSubTab === 'balcao'\}/);
  assert.doesNotMatch(tableSettings, /OperationalBanner|prontas para receber|mesas cadastradas|lugares disponíveis|nomes personalizados/);
  assert.match(tableSettings, /Configuração das mesas/);
  assert.match(tableSettings, /Adicionar mesa/);
  assert.match(tableSettings, /Crie, renomeie, ajuste a capacidade ou remova mesas/);
  assert.match(tableSettings, /setEditingTable\(table\)/);
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

test('cashier printing settings keeps every action while prioritizing daily operation', () => {
  const printing = readFileSync('src/components/caixa/settings/CashierPrintingSettings.tsx', 'utf8');
  const monitor = readFileSync('src/components/printing/PrintMonitorPanel.tsx', 'utf8');

  // Contexto 1: leitura operacional primeiro, homologação avançada sob demanda.
  assert.match(printing, /Veja primeiro o que precisa de atenção/);
  assert.match(printing, /<PrintMonitorPanel/);
  assert.match(printing, /Testes avançados/);
  assert.match(printing, /Teste extremo do App do Garçom/);
  assert.match(printing, /Gerar comanda de teste/);
  assert.match(printing, /\/impressao\/teste-extremo-garcom/);
  assert.match(printing, /sem criar pedido real, estoque ou movimento de caixa/);
  assert.match(printing, /Impressão não incluída no Kôma Pocket/);
  assert.doesNotMatch(printing, /Fila ativa/);

  // O monitor distingue agente, USB físico e fila em vez de fundir os estados.
  assert.match(monitor, /label: 'agente local'/);
  assert.match(monitor, /label: 'impressora física'/);
  assert.match(monitor, /label: 'fila'/);
  assert.match(monitor, /Kôma Print conectado; impressora física desconectada/);
  assert.match(monitor, /agente online · USB desconectado/);
  assert.doesNotMatch(monitor, /sem surpresa na fila/);
  assert.doesNotMatch(monitor, /limite visual/);

  // Contexto 2: Cupom
  assert.match(printing, /aria-labelledby="printing-receipt-heading"/);
  assert.match(printing, /<Receipt /);
  assert.match(printing, /Nome do restaurante no cupom:/);
  assert.match(printing, /Onde imprimir o nome:/);
  assert.match(printing, /Mensagem adicional de rodapé:/);
  assert.match(printing, /SALVO NO RESTAURANTE/);
  assert.match(printing, /Prévia aproximada/);
  assert.match(printing, /PEDIDO #305/);
  assert.doesNotMatch(printing, /PEDIDO: #305/);

  // Contexto 3: Delivery vira uma escolha explícita de duas opções.
  assert.match(printing, /aria-labelledby="printing-delivery-heading"/);
  assert.match(printing, /role="radiogroup"/);
  assert.match(printing, /aria-checked=\{!unificarViasDelivery\}/);
  assert.match(printing, /aria-checked=\{unificarViasDelivery\}/);
  assert.match(printing, /unificar_vias_delivery/);
  assert.match(printing, />Vias separadas</);
  assert.match(printing, />Via única</);
  assert.doesNotMatch(printing, /marcado|desmarcado/);

  // Contrato do controller preservado.
  assert.match(printing, /ReturnType<typeof useCashierSettings>/);
});

test('printer test uses a synchronous ref lock to prevent duplicate POSTs before React rerenders', () => {
  assert.match(settingsController, /const isTestingPrinterRef = useRef\(false\)/);
  assert.match(settingsController, /if \(isTestingPrinterRef\.current\) return;/);
  assert.match(settingsController, /isTestingPrinterRef\.current = true;[\s\S]*setIsTestingPrinter\(true\)/);
  assert.match(settingsController, /finally \{[\s\S]*isTestingPrinterRef\.current = false;[\s\S]*setIsTestingPrinter\(false\)/);
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


test('printing queue explains FIFO order and job origin', () => {
  const monitor = readFileSync('src/components/printing/PrintMonitorPanel.tsx', 'utf8');

  assert.match(monitor, /mais antiga primeiro/);
  assert.match(monitor, /friendlyQueueOrigin/);
  assert.match(monitor, /Reimpressão manual/);
  assert.match(monitor, /queue_origins/);
  assert.match(monitor, /automática\(s\)/);
  assert.match(monitor, /reimpressão\(ões\)/);
});


test('printing diagnostics distinguish total queue from delayed subset', () => {
  const monitor = readFileSync('src/components/printing/PrintMonitorPanel.tsx', 'utf8');

  assert.match(monitor, /\$\{queueTotal\} na fila; \$\{monitorData\.summary\.delayed\} atrasada\(s\)/);
  assert.match(monitor, /Atraso significa mais de/);
  assert.doesNotMatch(monitor, /impressão\(ões\) aguardando; agente local conectado/);
});
