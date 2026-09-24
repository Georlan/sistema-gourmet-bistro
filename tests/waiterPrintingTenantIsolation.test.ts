import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const modal = readFileSync('src/components/MesaDetailsModalBase.tsx', 'utf8');
const consumption = readFileSync('src/components/mesas/MesaConsumptionPanel.tsx', 'utf8');
const waiterPermissions = readFileSync('backend/app/waiter_permissions.py', 'utf8');
const caixaRoute = readFileSync('backend/app/routes/caixa.py', 'utf8');

test('waiter printing capability is isolated by authenticated restaurant scope', () => {
  assert.match(app, /const activeRestaurantId = useMemo/);
  assert.match(app, /\$\{portal\}:\$\{activeRestaurantId \|\| 'legacy'\}:\$\{activeRole\}:\$\{activeWaiterId\}/);
  assert.match(app, /const requestScopeKey = operationalScopeKey/);
  assert.match(app, /requestScopeKey !== operationalScopeKeyRef\.current/);
  assert.match(app, /localStorage\.getItem\(tokenKey\) !== token/);
  assert.match(app, /responseRestaurantId !== requestRestaurantId/);
  assert.match(app, /setRestauranteConfig\(null\);[\s\S]*setIsConfigLoaded\(false\)/);
});

test('waiter print UI fails closed and only renders with explicit printing entitlement', () => {
  assert.match(modal, /const hasPrinting = restauranteConfig\?\.entitlements\?\.printing === true/);
  assert.match(consumption, /const hasPrinting = restauranteConfig\?\.entitlements\?\.printing === true/);
  assert.doesNotMatch(modal, /printing !== false/);
  assert.doesNotMatch(consumption, /printing !== false/);
  assert.match(modal, /\{hasPrinting && <MesaPrintDialogs/);
  assert.match(consumption, /\{hasPrinting && <div className="grid grid-cols-2 gap-2">/);
});

test('backend remains the authority for tenant and waiter printing permission', () => {
  assert.match(caixaRoute, /ConfiguracaoRestaurante\.restaurante_id == current_user\.restaurante_id/);
  assert.match(waiterPermissions, /permission == "perm_garcom_print"/);
  assert.match(waiterPermissions, /has_plan_entitlement\([\s\S]*ENTITLEMENT_PRINTING/);
  assert.match(waiterPermissions, /user\.restaurante_id != restaurante_id/);
});
