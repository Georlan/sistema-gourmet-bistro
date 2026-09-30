import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contractPage = readFileSync('src/legal/PlanContractPageV2.tsx', 'utf8');
const signups = readFileSync('backend/app/routes/signups.py', 'utf8');
const provisioning = readFileSync('backend/app/services/restaurant_provisioning.py', 'utf8');
const migration = readFileSync(
  'backend/alembic/versions/z7d8e9f0a1b2_signup_operation_profile_bridge.py',
  'utf8',
);

test('commercial signup requires an explicit restaurant operation type', () => {
  assert.match(contractPage, /Tipo de operação/);
  assert.match(contractPage, /Pizzaria/);
  assert.match(contractPage, /Marmitaria \/ Quentinhas/);
  assert.match(contractPage, /Açaí/);
  assert.match(contractPage, /Churrasco/);
  assert.match(contractPage, /Outro tipo de operação/);
  assert.match(contractPage, /Selecione o tipo/);
  assert.match(contractPage, /operation_profile: form\.operationProfile/);
  assert.match(contractPage, /saved\.data\.operation_profile/);
});

test('operation type describes profile-specific catalog behavior without auto-creating products', () => {
  assert.match(contractPage, /pizzaria pode ter tamanhos, sabores e meio a meio/);
  assert.match(contractPage, /marmitaria usa composição por tamanho/);
});

test('backend validates and carries the commercial profile into provisioning', () => {
  assert.match(signups, /operation_profile: str = "generic"/);
  assert.match(signups, /"generic", "pizzaria", "acai", "churrasco", "marmitaria"/);
  assert.match(provisioning, /_operation_profile_for_contract/);
  assert.match(provisioning, /RestauranteOperationProfile/);
  assert.match(provisioning, /profile_key=operation_profile/);
  assert.match(provisioning, /"operation_profile": operation_profile/);
});

test('production database exposes only the encrypted signup payload through a narrow helper', () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /signup_payload_for_contract/);
  assert.match(migration, /JOIN public\.restaurant_signups/);
  assert.match(migration, /REVOKE ALL ON FUNCTION/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION/);
});
