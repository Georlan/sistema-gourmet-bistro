import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('main routes the canonical app host through the unified operational entry', () => {
  const main = source('../src/main.tsx');
  assert.match(main, /isOperationalAppHost\(\)/);
  assert.match(main, /UnifiedOperationalEntry/);
});

test('unified login lets backend identity choose restaurant and role choose portal', () => {
  const entry = source('../src/components/auth/UnifiedOperationalEntry.tsx');

  assert.match(entry, /username:\s*username\.trim\(\)\.toLowerCase\(\)/);
  assert.match(entry, /if \(restaurantId\) requestPayload\.restaurante_id = Number\(restaurantId\)/);
  assert.match(entry, /restaurant_selection_required/);
  assert.match(entry, /const restauranteId = Number\(data\?\.usuario\?\.restaurante_id\)/);
  assert.match(entry, /role === 'garcom'/);
  assert.match(entry, /MANAGEMENT_ROLES\.has\(role\)/);
  assert.match(entry, /clearOperatorSession\(\)/);
  assert.match(entry, /saveOperatorSession\(data\.access_token/);
  assert.match(entry, /koma_waiter_token/);
});

test('unified operational URL stays tenantless after the management bridge initializes App', () => {
  const entry = source('../src/components/auth/UnifiedOperationalEntry.tsx');
  assert.match(entry, /params\.set\('view', 'caixa'\)/);
  assert.match(entry, /requestAnimationFrame/);
  assert.match(entry, /params\.delete\('view'\)/);

  const login = source('../src/components/auth/OperationalLogin.tsx');
  assert.match(login, /Acesso da equipe/);
  assert.match(login, /identifica automaticamente o estabelecimento e o perfil de acesso/);
});
