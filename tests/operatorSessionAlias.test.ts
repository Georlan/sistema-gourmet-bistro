import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authSession = readFileSync('src/utils/authSession.ts', 'utf8');
const caixaService = readFileSync('src/config/caixaService.ts', 'utf8');
const onlineControl = readFileSync('src/components/caixa/online-menu/OnlineOrderEmergencyControl.tsx', 'utf8');
const supportBanner = readFileSync('src/components/app/SupportSessionBanner.tsx', 'utf8');
const operationalCatalog = readFileSync('src/components/app/data/useOperationalCatalog.ts', 'utf8');
const suspensionBoundary = readFileSync('src/components/auth/TenantSuspensionBoundary.tsx', 'utf8');
const contractDocuments = readFileSync('src/components/assinatura/ContractDocumentsPanel.tsx', 'utf8');
const mesaDetails = readFileSync('src/components/MesaDetailsModal.tsx', 'utf8');

test('runtime auth no longer persists the generic localStorage token alias', () => {
  assert.doesNotMatch(authSession, /localStorage\.setItem\(['"]token['"]/);
  assert.match(authSession, /localStorage\.removeItem\(['"]token['"]\)/);
});

test('auth session exposes a portal-scoped operational accessor for migration away from browser storage', () => {
  assert.match(authSession, /export function getOperationalAccessToken/);
  assert.match(authSession, /portal === ['"]garcom['"]/);
});

test('operational helpers use centralized token accessors instead of generic alias fallback', () => {
  for (const source of [caixaService, onlineControl]) {
    assert.match(source, /getOperatorAccessToken/);
    assert.doesNotMatch(source, /localStorage\.getItem\(['"]token['"]\)/);
  }
});

test('high-value operational consumers no longer read Caixa or waiter bearer aliases directly', () => {
  for (const source of [supportBanner, operationalCatalog, suspensionBoundary, contractDocuments, mesaDetails]) {
    assert.match(source, /getOperat(?:or|ional)AccessToken/);
    assert.doesNotMatch(source, /localStorage\.getItem\([^\n)]*koma_(?:caixa|waiter)_token/);
    assert.doesNotMatch(source, /localStorage\.getItem\(['"]token['"]\)/);
  }
});
