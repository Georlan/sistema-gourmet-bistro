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
});

test('Signups tab mounts readiness before manual release operations', () => {
  assert.match(signups, /SuperAdminHomologationReadiness/);
  assert.match(signups, /<SuperAdminHomologationReadiness \/>/);
  assert.match(signups, /awaiting_release/);
  assert.match(signups, /Liberar acesso/);
  assert.match(signups, /Confira o painel de Homologação SaaS acima/);
});
