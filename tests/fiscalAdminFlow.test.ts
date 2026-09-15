import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fiscal = readFileSync(
  new URL('../src/components/caixa/settings/CashierFiscalSettings.tsx', import.meta.url),
  'utf8',
);
const integrations = readFileSync(
  new URL('../src/components/caixa/settings/CashierIntegrationsSettings.tsx', import.meta.url),
  'utf8',
);

test('fiscal admin flow exposes profile, credential, preflight and activation contracts', () => {
  assert.match(fiscal, /\/api\/onboarding\/fiscal\/profile/);
  assert.match(fiscal, /\/api\/onboarding\/fiscal\/credentials/);
  assert.match(fiscal, /\/api\/onboarding\/fiscal\/preflight\?mode=/);
  assert.match(fiscal, /\/api\/onboarding\/fiscal\/\$\{enable \? 'enable' : 'disable'\}/);
  assert.match(fiscal, /'foundation'/);
  assert.match(fiscal, /'activation'/);
  assert.match(fiscal, /'issuance'/);
});

test('A1 and CSC stay ephemeral in browser and are cleared after successful upload', () => {
  assert.doesNotMatch(fiscal, /localStorage/);
  assert.doesNotMatch(fiscal, /sessionStorage/);
  assert.match(fiscal, /type="password"/);
  assert.match(fiscal, /certificate_pfx_base64/);
  assert.match(fiscal, /setCertificateFile\(null\)/);
  assert.match(fiscal, /setCertificatePassword\(''\)/);
  assert.match(fiscal, /setCscId\(''\)/);
  assert.match(fiscal, /setCsc\(''\)/);
  assert.match(fiscal, /fileInputRef\.current\.value = ''/);
});

test('fiscal screen makes official reference lineage and RTC blocker visible', () => {
  assert.match(fiscal, /activeSnapshotId/);
  assert.match(fiscal, /observedSnapshotId/);
  assert.match(fiscal, /rfb-rtc-calculator-local/);
  assert.match(fiscal, /Dependência oficial pendente: Calculadora RTC/);
  assert.match(fiscal, /não emitimos|não emite uma nota/i);
});

test('technical settings expose a dedicated Fiscal tab without replacing existing integrations', () => {
  assert.match(integrations, /CashierFiscalSettings/);
  assert.match(integrations, />\s*Fiscal\s*</);
  assert.match(integrations, /MercadoPagoConnectionCard/);
  assert.match(integrations, /activeTab === 'fiscal'/);
});
