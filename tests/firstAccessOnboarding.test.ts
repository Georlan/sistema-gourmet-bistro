import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const activation = source('../src/components/CaixaAtivarPage.tsx');
const onboarding = source('../src/components/onboarding/FirstAccessOnboarding.tsx');
const routeComposition = source('../backend/app/routes/__init__.py');

test('new admin activation enters guided onboarding instead of raw cashier', () => {
  assert.match(activation, /userRole === 'admin'/);
  assert.match(activation, /<FirstAccessOnboarding/);
  assert.match(activation, /saveOperatorSession\(accessToken, sessionUser\)/);
});

test('onboarding is advisory and can always be skipped to cashier', () => {
  assert.match(onboarding, /nenhuma etapa abaixo bloqueia o uso do Caixa/);
  assert.match(onboarding, /Ir para o Caixa/);
  assert.match(onboarding, /sessionStorage\.setItem\('koma_active_tab'/);
  assert.match(onboarding, /window\.location\.href = '\/\?view=caixa'/);
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
});

test('onboarding route is composed once into the existing root router', () => {
  assert.match(routeComposition, /from \.onboarding import router as _onboarding_router/);
  assert.match(routeComposition, /_root_router\.router\.include_router\(_onboarding_router\)/);
});
