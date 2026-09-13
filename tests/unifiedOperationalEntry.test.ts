import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('main routes every canonical staff URL through the unified operational entry', () => {
  const main = source('../src/main.tsx');
  assert.match(main, /function isCanonicalOperationalEntryRoute\(\)/);
  assert.match(main, /if \(!isOperationalAppHost\(\)\) return false/);
  assert.match(main, /isPublicMenuRoute\(\) \|\| isPublicCommercialRoute\(\)/);
  assert.match(main, /pathname\.startsWith\("\/smartpos"\)/);
  assert.match(main, /const isUnifiedOperationalRoute = isCanonicalOperationalEntryRoute\(\)/);
  assert.match(main, /UnifiedOperationalEntry/);
  assert.doesNotMatch(main, /return pathname === ["']\/["']/);
  assert.doesNotMatch(main, /resolvedHost\.surface === ["']garcom["']/);
  assert.doesNotMatch(main, /resolvedHost\.surface === ["']caixa["']/);
});

test('canonical app entry strips hidden legacy path and query before mounting', () => {
  const main = source('../src/main.tsx');
  assert.match(main, /isUnifiedOperationalRoute[\s\S]*window\.location\.pathname !== "\/"/);
  assert.match(main, /window\.location\.search/);
  assert.match(main, /window\.location\.hash/);
  assert.match(main, /window\.history\.replaceState\(window\.history\.state, "", "\/"\)/);
});

test('legacy cashier and waiter tenant hosts converge to the canonical team entry', () => {
  const main = source('../src/main.tsx');
  assert.match(main, /function redirectLegacyOperationalStaffHost\(\)/);
  assert.match(main, /parseTenantSubdomain\(subdomain\)/);
  assert.match(main, /parsed\?\.surface === "caixa" \|\| parsed\?\.surface === "garcom"/);
  assert.match(main, /window\.location\.replace\(KOMA_OPERATIONAL_APP_URL\)/);
  assert.match(main, /isCanonicalOperationalEntryRoute\(\) \|\| isLegacyOperationalRedirect/);
});

test('canonical app shell bypasses stale browser/service-worker caches', () => {
  const main = source('../src/main.tsx');
  assert.match(main, /updateViaCache:\s*["']none["']/);

  const headers = source('../public/_headers');
  assert.match(headers, /\/index\.html[\s\S]*Cache-Control: no-store, no-cache, must-revalidate, max-age=0/);
  assert.match(headers, /\/koma-sw\.js[\s\S]*Cache-Control: no-store, no-cache, must-revalidate, max-age=0/);
  assert.match(headers, /\/assets\/\*[\s\S]*Cache-Control: public, max-age=31536000, immutable/);
});

test('canonical app restores a valid persisted staff session only in the tab that owns its portal', () => {
  const entry = source('../src/components/auth/UnifiedOperationalEntry.tsx');
  const authSession = source('../src/utils/authSession.ts');

  assert.match(entry, /getPersistedOperationalPortal/);
  assert.match(entry, /useState<OperationalPortal \| null>\([\s\S]*\(\) => getPersistedOperationalPortal\(\)/);
  assert.match(authSession, /sessionStorage/);
  assert.match(authSession, /koma_active_operational_portal/);
  assert.match(authSession, /if \(tabPortal\) \{/);
});

test('logout from resolved portal clears only that portal and returns its tab to team login', () => {
  const entry = source('../src/components/auth/UnifiedOperationalEntry.tsx');
  const login = source('../src/components/auth/OperationalLogin.tsx');

  assert.match(entry, /if \(!localStorage\.getItem\(tokenKey\)\) \{[\s\S]*clearOperatorSession\(activePortal\);[\s\S]*setActivePortal\(null\)/);
  assert.match(entry, /250\)/);
  assert.match(login, /portal !== 'unified' && isOperationalAppHost\(\)/);
  assert.match(login, /Retornando ao acesso da equipe/);
});

test('unified login lets backend identity choose restaurant and role choose portal without clearing the other portal', () => {
  const entry = source('../src/components/auth/UnifiedOperationalEntry.tsx');

  assert.match(entry, /username:\s*username\.trim\(\)\.toLowerCase\(\)/);
  assert.match(entry, /if \(restaurantId\) requestPayload\.restaurante_id = Number\(restaurantId\)/);
  assert.match(entry, /restaurant_selection_required/);
  assert.match(entry, /const restauranteId = Number\(data\?\.usuario\?\.restaurante_id\)/);
  assert.match(entry, /role === 'garcom'/);
  assert.match(entry, /MANAGEMENT_ROLES\.has\(role\)/);
  assert.doesNotMatch(entry, /clearOperatorSession\(\);/);
  assert.match(entry, /saveOperatorSession\(data\.access_token, \{ \.\.\.data\.usuario, role \}\)/);
  assert.doesNotMatch(entry, /localStorage\.setItem\('koma_waiter_token'/);
});

test('unified operational entry passes the authenticated portal directly to App without a URL race', () => {
  const entry = source('../src/components/auth/UnifiedOperationalEntry.tsx');
  const app = source('../src/App.tsx');
  assert.match(entry, /<OperationalApp initialPortal=\{portal\} \/>/);
  assert.doesNotMatch(entry, /params\.set\('view', 'caixa'\)/);
  assert.doesNotMatch(entry, /requestAnimationFrame/);
  assert.match(app, /initialPortal\?: OperationalPortal/);
  assert.match(app, /if \(initialPortal\) \{[\s\S]*return initialPortal;/);

  const login = source('../src/components/auth/OperationalLogin.tsx');
  assert.match(login, /Acesso da equipe/);
  assert.match(login, /identifica automaticamente o estabelecimento e o perfil de acesso/);
});

test('operational staff links and mockups eliminate legacy URLs in favor of app.komafood.com.br', () => {
  const modal = source('../src/super-admin/SuperAdminNewTenantModal.tsx');
  assert.match(modal, /getOperationalAppUrl\(\)/);
  assert.match(modal, /getTenantPublicMenuUrl\(created\.subdomain\)/);
  assert.doesNotMatch(modal, /-caixa\.komafood\.com\.br/);
  assert.doesNotMatch(modal, /-garcom\.komafood\.com\.br/);

  const desktopFrame = source('../src/landing/product/DesktopFrame.tsx');
  assert.match(desktopFrame, /app\.komafood\.com\.br/);
  assert.doesNotMatch(desktopFrame, /sistema-gourmet-bistro\.pages\.dev/);

  const landing = source('../src/landing/LandingPage.tsx');
  assert.match(landing, /https:\/\/komafood\.com\.br\//);
  assert.doesNotMatch(landing, /https:\/\/komafood\.com\.br\/landing/);
  assert.doesNotMatch(landing, /sistema-gourmet-bistro\.pages\.dev/);

  const pairing = source('../print-agent/pairing.py');
  assert.match(pairing, /https:\/\/app\.komafood\.com\.br\//);
  assert.match(pairing, /"https:\/\/app\.komafood\.com\.br"/);
});
