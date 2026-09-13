import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readiness = readFileSync(
  new URL('../src/super-admin/SuperAdminHomologationReadiness.tsx', import.meta.url),
  'utf8',
);
const signups = readFileSync(
  new URL('../src/super-admin/SuperAdminSignupsTab.tsx', import.meta.url),
  'utf8',
);

test('SuperAdmin exposes an actionable SaaS homologation cockpit', () => {
  assert.match(readiness, /\/api\/super-admin\/homologation\/readiness/);
  assert.match(readiness, /Prontidão da homologação SaaS/);
  assert.match(readiness, /Abrir checkout Pro anual/);
  assert.match(readiness, /\/contratar\/pro\?cobranca=anual/);
  assert.match(readiness, /Webhook Mercado Pago/);
  assert.match(readiness, /Copiar webhook/);
  assert.match(readiness, /Roteiro manual/);
  assert.match(readiness, /Ações necessárias \(bloqueadores\)/);
  assert.match(readiness, /KOMA_SAAS_CHECKOUT_ENABLED=false/);
});

test('Signups tab mounts readiness before manual release operations', () => {
  assert.match(signups, /SuperAdminHomologationReadiness/);
  assert.match(signups, /<SuperAdminHomologationReadiness \/>/);
  assert.match(signups, /awaiting_release/);
  assert.match(signups, /Liberar acesso/);
  assert.match(signups, /Confira o painel de Homologação SaaS acima/);
});

test('PlanContractPage explains why checkout is paused when test gateway is unconfigured', () => {
  const contractPage = readFileSync(
    new URL('../src/legal/PlanContractPage.tsx', import.meta.url),
    'utf8',
  );
  assert.match(contractPage, /KOMA_SAAS_CHECKOUT_ENABLED=false/);
  assert.match(contractPage, /credenciais TEST do gateway/);
});

