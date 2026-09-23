import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const activation = source('../src/components/CaixaAtivarPage.tsx');
const onboarding = source('../src/components/onboarding/FirstAccessOnboarding.tsx');
const boundary = source('../src/components/onboarding/OnboardingOperationalBoundary.tsx');
const hostedEntry = source('../src/components/onboarding/OnboardingAwareOperationalEntry.tsx');
const gateHook = source('../src/components/onboarding/useOnboardingAccessGate.ts');
const main = source('../src/main.tsx');
const unifiedEntry = source('../src/components/auth/UnifiedOperationalEntry.tsx');
const navigation = source('../src/components/caixa/navigation/useCashierNavigation.ts');
const onlineMenu = source('../src/components/caixa/online-menu/CashierOnlineMenu.tsx');
const routeComposition = source('../backend/app/routes/__init__.py');
const desktopSidebar = source('../src/components/caixa/navigation/CashierDesktopSidebar.tsx');
const mobileSidebar = source('../src/components/caixa/navigation/CashierMobileSidebar.tsx');
const onboardingShortcut = source('../src/components/caixa/navigation/CashierOnboardingShortcut.tsx');
const sidebarSearch = source('../src/components/caixa/navigation/CashierSidebarSearch.tsx');
const cashierSettings = source('../src/components/caixa/settings/CashierSettings.tsx');
const integrationsSettings = source('../src/components/caixa/settings/CashierIntegrationsSettings.tsx');

test('new admin activation enters guided onboarding instead of raw cashier', () => {
  assert.match(activation, /userRole === 'admin'/);
  assert.match(activation, /<FirstAccessOnboarding/);
  assert.match(activation, /saveOperatorSession\(accessToken, sessionUser\)/);
});

test('configured restaurants prioritize function search and can resume setup from settings', () => {
  assert.match(activation, /getOperatorSession\('caixa'\)/);
  assert.match(activation, /resumeRequested/);
  assert.match(activation, /Voltar para a implantação inicial/);
  assert.match(onboardingShortcut, /\/ativar\?resume=1/);
  assert.match(onboardingShortcut, /removeItem\(ONBOARDING_SETUP_MODE_KEY\)/);
  assert.match(desktopSidebar, /<CashierSidebarSearch/);
  assert.match(mobileSidebar, /<CashierSidebarSearch/);
  assert.match(sidebarSearch, /Pesquisar funções\.\.\./);
  assert.match(sidebarSearch, /handleSidebarNavigation/);
  assert.match(cashierSettings, /activeSubTab === 'implantacao'/);
  assert.match(cashierSettings, /Implantação inicial/);
  assert.match(cashierSettings, /\/ativar\?resume=1/);
  assert.match(cashierSettings, /removeItem\(ONBOARDING_SETUP_MODE_KEY\)/);
});

test('required onboarding persists and releases operation only after explicit trial start', () => {
  assert.match(onboarding, /Conclua os quatro itens mínimos/);
  assert.match(onboarding, /configurationComplete/);
  assert.match(onboarding, /\/api\/onboarding\/start-trial/);
  assert.match(onboarding, /Iniciar 7 dias e fazer teste/);
  assert.match(onboarding, /sessionStorage\.setItem\(ONBOARDING_SETUP_MODE_KEY, '1'\)/);
  assert.match(onboarding, /sessionStorage\.removeItem\(ONBOARDING_SETUP_MODE_KEY\)/);
  assert.match(boundary, /!gate\.requiredComplete/);
  assert.match(boundary, /<FirstAccessOnboarding/);
  assert.match(gateHook, /\/api\/onboarding\/status/);
});

test('setup mode exposes canonical configuration and fiscal without exposing normal operation', () => {
  assert.match(navigation, /SETUP_DIRECT_TABS/);
  assert.match(navigation, /'cardapio'/);
  assert.match(navigation, /'cardapio_digital'/);
  assert.match(navigation, /tab === 'impressao_salao' && subTab === 'integracoes'/);
  assert.match(navigation, /Finalize a implantação inicial antes de acessar a operação/);
  assert.match(desktopSidebar, /setupMode \?/);
  assert.match(desktopSidebar, /<CashierOnboardingShortcut/);
  assert.match(desktopSidebar, /Conclua dados do restaurante, horários e cardápio/);
  assert.match(mobileSidebar, /<CashierOnboardingShortcut mobile/);
  assert.match(mobileSidebar, /Você está na implantação inicial/);
  assert.match(mobileSidebar, /!setupMode &&/);
  assert.match(onboardingShortcut, /Abrir configuração fiscal/);
  assert.match(onboardingShortcut, /setItem\('koma_active_tab', 'impressao_salao'\)/);
  assert.match(onboardingShortcut, /setItem\('koma_active_subtab', 'integracoes'\)/);
  assert.match(onboardingShortcut, /window\.location\.href = '\/\?view=caixa'/);
  assert.match(integrationsSettings, /CashierFiscalSettings/);
  assert.match(integrationsSettings, />\s*Fiscal\s*</);
});

test('initial setup reuses the same cashier online-menu screens and Mercado Pago integration owner', () => {
  assert.match(onboarding, /subTab: 'cardapio_perfil'/);
  assert.match(onboarding, /subTab: 'cardapio_pedidos'/);
  assert.match(onboarding, /subTab: 'cardapio_pagamentos'/);
  assert.match(onlineMenu, /cardapio_perfil: 'perfil'/);
  assert.match(onlineMenu, /cardapio_pedidos: 'pedidos'/);
  assert.match(onlineMenu, /cardapio_pagamentos: 'pagamentos'/);
  assert.match(onlineMenu, /setActiveTab\('impressao_salao'\)/);
  assert.match(onlineMenu, /setActiveSubTab\('integracoes'\)/);
});

test('hosted management routes and canonical app both use the onboarding boundary', () => {
  assert.match(main, /isHostedManagementEntryRoute/);
  assert.match(main, /OnboardingAwareOperationalEntry/);
  assert.match(hostedEntry, /OnboardingOperationalBoundary/);
  assert.match(unifiedEntry, /OnboardingOperationalBoundary/);
});

test('resume route fails safely when the browser no longer has an admin session', () => {
  assert.match(activation, /Entre novamente para continuar/);
  assert.match(activation, /A implantação inicial continua salva/);
  assert.match(activation, /window\.location\.href = '\/\?view=caixa'/);
});

test('onboarding status request cannot trap first access in infinite loading', () => {
  assert.match(onboarding, /const ONBOARDING_LOAD_TIMEOUT_MS = 10_000/);
  assert.match(onboarding, /const controller = new AbortController\(\)/);
  assert.match(onboarding, /setTimeout\(\(\) => controller\.abort\(\), ONBOARDING_LOAD_TIMEOUT_MS\)/);
  assert.match(onboarding, /signal: controller\.signal/);
  assert.match(onboarding, /A implantação demorou para responder/);
  assert.match(onboarding, /clearTimeout\(timeoutId\)/);
  assert.match(gateHook, /ONBOARDING_GATE_TIMEOUT_MS = 10_000/);
  assert.match(gateHook, /setTimeout\(\(\) => controller\.abort\(\), ONBOARDING_GATE_TIMEOUT_MS\)/);
  assert.match(gateHook, /if \(cancelled\) return;\s*setRequiredComplete\(false\);\s*setState\('error'\)/);
  assert.match(gateHook, /clearTimeout\(timeoutId\)/);
});

test('onboarding uses canonical server progress, canonical modes and optional Mercado Pago', () => {
  assert.match(onboarding, /\/api\/onboarding\/status/);
  for (const label of [
    'Complete os dados do restaurante',
    'Defina os horários de funcionamento',
    'Publique o primeiro produto',
    'Conecte o Mercado Pago para Pix online',
    'Valide com um pedido de teste',
  ]) {
    assert.match(onboarding, new RegExp(label));
  }
  assert.match(onboarding, /daysRemaining/);
  assert.match(onboarding, /Salvar modalidades/);
  assert.match(onboarding, /order_types/);
  assert.match(onboarding, /Cardápio Online funciona com pagamento no atendimento sem Mercado Pago/);
  assert.match(onboarding, /Depois de iniciar/);
});

test('onboarding route is composed once into the existing root router', () => {
  assert.match(routeComposition, /from \.onboarding import router as _onboarding_router/);
  assert.match(routeComposition, /_root_router\.router\.include_router\(_onboarding_router\)/);
});


test('audited support mode bypasses customer onboarding without mutating tenant setup', () => {
  assert.match(boundary, /SUPPORT_SESSION_STORAGE_KEY/);
  assert.match(boundary, /readInternalSupportMode/);
  assert.match(boundary, /enabled: isManagementSetupOwner && !internalSupportMode/);
  assert.match(boundary, /internalSupportMode && setupMode/);
  assert.match(boundary, /sessionStorage\.removeItem\(ONBOARDING_SETUP_MODE_KEY\)/);
  assert.match(boundary, /if \(internalSupportMode \|\| setupMode\) return <>\{children\}<\/>/);
});
