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

test('new admin activation enters guided onboarding instead of raw cashier', () => {
  assert.match(activation, /userRole === 'admin'/);
  assert.match(activation, /<FirstAccessOnboarding/);
  assert.match(activation, /saveOperatorSession\(accessToken, sessionUser\)/);
});

test('activated management users can resume initial setup from the operational app', () => {
  assert.match(activation, /getOperatorSession\('caixa'\)/);
  assert.match(activation, /resumeRequested/);
  assert.match(activation, /Voltar para a implantação inicial/);
  assert.match(onboardingShortcut, /\/ativar\?resume=1/);
  assert.match(onboardingShortcut, /removeItem\(ONBOARDING_SETUP_MODE_KEY\)/);
  assert.match(desktopSidebar, /<CashierOnboardingShortcut/);
  assert.match(mobileSidebar, /<CashierOnboardingShortcut mobile/);
});

test('required onboarding persists and blocks normal operation until 3 of 3 is complete', () => {
  assert.match(onboarding, /Antes de liberar a operação, conclua os 3 passos essenciais/);
  assert.match(onboarding, /requiredComplete/);
  assert.match(onboarding, /Entrar no KÔMA/);
  assert.match(onboarding, /sessionStorage\.setItem\(ONBOARDING_SETUP_MODE_KEY, '1'\)/);
  assert.match(onboarding, /sessionStorage\.removeItem\(ONBOARDING_SETUP_MODE_KEY\)/);
  assert.match(boundary, /!gate\.requiredComplete/);
  assert.match(boundary, /<FirstAccessOnboarding/);
  assert.match(gateHook, /\/api\/onboarding\/status/);
});

test('setup mode exposes canonical configuration without exposing normal operation', () => {
  assert.match(navigation, /SETUP_DIRECT_TABS/);
  assert.match(navigation, /'cardapio'/);
  assert.match(navigation, /'cardapio_digital'/);
  assert.match(navigation, /tab === 'impressao_salao' && subTab === 'integracoes'/);
  assert.match(navigation, /Finalize a implantação inicial antes de acessar a operação/);
  assert.match(desktopSidebar, /setupMode \?/);
  assert.match(desktopSidebar, /Conclua dados do restaurante, horários e cardápio/);
  assert.match(mobileSidebar, /Você está na implantação inicial/);
  assert.match(mobileSidebar, /!setupMode &&/);
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
  assert.match(onboarding, /Tente novamente para continuar a implantação/);
  assert.match(onboarding, /clearTimeout\(timeoutId\)/);
});

test('onboarding uses canonical server progress and exposes the five launch steps', () => {
  assert.match(onboarding, /\/api\/onboarding\/status/);
  for (const label of [
    'Complete os dados do restaurante',
    'Defina os horários de funcionamento',
    'Monte o primeiro cardápio',
    'Conecte o Mercado Pago',
    'Faça um primeiro pedido de teste',
  ]) {
    assert.match(onboarding, new RegExp(label));
  }
  assert.match(onboarding, /daysRemaining/);
  assert.match(onboarding, /Atualizar progresso/);
  assert.match(onboarding, /Disponível depois/);
});

test('onboarding route is composed once into the existing root router', () => {
  assert.match(routeComposition, /from \.onboarding import router as _onboarding_router/);
  assert.match(routeComposition, /_root_router\.router\.include_router\(_onboarding_router\)/);
});
