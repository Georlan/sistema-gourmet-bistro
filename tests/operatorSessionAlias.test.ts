import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authSession = readFileSync('src/utils/authSession.ts', 'utf8');
const storageBoundary = readFileSync('src/utils/sessionScopedBrowserStorage.ts', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');
const caixaService = readFileSync('src/config/caixaService.ts', 'utf8');
const onlineControl = readFileSync('src/components/caixa/online-menu/OnlineOrderEmergencyControl.tsx', 'utf8');
const supportBanner = readFileSync('src/components/app/SupportSessionBanner.tsx', 'utf8');
const operationalCatalog = readFileSync('src/components/app/data/useOperationalCatalog.ts', 'utf8');
const suspensionBoundary = readFileSync('src/components/auth/TenantSuspensionBoundary.tsx', 'utf8');
const contractDocuments = readFileSync('src/components/assinatura/ContractDocumentsPanel.tsx', 'utf8');
const mesaDetails = readFileSync('src/components/MesaDetailsModal.tsx', 'utf8');

test('canonical auth never writes operational bearer to durable storage', () => {
  assert.doesNotMatch(authSession, /localStorage\.setItem\([^\n)]*(?:token|koma_(?:caixa|waiter)_token)/i);
  assert.match(authSession, /sessionStorage/);
  assert.match(authSession, /readScopedWithLegacyMigration/);
});

test('browser boundary is installed before app bootstrap and redirects legacy aliases to sessionStorage', () => {
  assert.match(main, /import ["']\.\/utils\/sessionScopedBrowserStorage["']/);
  assert.match(storageBoundary, /OPERATIONAL_SESSION_KEYS/);
  assert.match(storageBoundary, /if \(isOperationalSessionKey\(key\)\)/);
  assert.doesNotMatch(storageBoundary, /this === durable/);
  assert.match(storageBoundary, /originalSetItem\.call\(scoped/);
  assert.match(storageBoundary, /originalRemoveItem\.call\(durable/);
});

test('auth session exposes portal-scoped accessors for caixa and garçom', () => {
  assert.match(authSession, /export function getOperationalAccessToken/);
  assert.match(authSession, /portal === 'garcom'/);
  assert.match(authSession, /export function saveWaiterSession/);
});

test('operational helpers use centralized token accessors instead of generic alias fallback', () => {
  for (const source of [caixaService, onlineControl]) {
    assert.match(source, /getOperatorAccessToken/);
    assert.doesNotMatch(source, /localStorage\.getItem\(['"]token['"]\)/);
  }
});

test('high-value operational consumers no longer read bearer aliases directly', () => {
  for (const source of [supportBanner, operationalCatalog, suspensionBoundary, contractDocuments, mesaDetails]) {
    assert.match(source, /getOperat(?:or|ional)AccessToken/);
    assert.doesNotMatch(source, /localStorage\.getItem\([^\n)]*koma_(?:caixa|waiter)_token/);
    assert.doesNotMatch(source, /localStorage\.getItem\(['"]token['"]\)/);
  }
});
