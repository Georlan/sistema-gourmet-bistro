import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChangedFiles, selectBackendTests, selectE2eSpecs } from '../scripts/focus-check.mjs';

const alwaysExists = () => true;

test('classifyChangedFiles skips backend on frontend-only changes and vice versa', () => {
  const fe = classifyChangedFiles(['src/cardapio/CardapioPage.tsx'], alwaysExists);
  assert.equal(fe.frontend, true);
  assert.equal(fe.backend, false);
  assert.equal(fe.alembic, false);
  assert.deepEqual(fe.backendTests, []);
  assert.deepEqual(fe.e2eSpecs, ['e2e/public-menu-order.spec.ts', 'e2e/cardapio-promotions.spec.ts']);

  const be = classifyChangedFiles(['backend/app/routes/orders.py'], alwaysExists);
  assert.equal(be.frontend, false);
  assert.equal(be.backend, true);
  assert.deepEqual(be.backendTests, [
    'backend/tests/test_atendimento_identity.py',
    'backend/tests/test_order_lifecycle_authority.py',
  ]);
  assert.deepEqual(be.e2eSpecs, []);
});

test('selectBackendTests includes directly changed SQLite tests while skipping postgres-only suites', () => {
  const tests = selectBackendTests([
    'backend/tests/test_custom_fix.py',
    'backend/tests/test_crm_migration_postgres.py',
  ], alwaysExists);
  assert.deepEqual(tests, ['backend/tests/test_custom_fix.py']);
});

test('selectE2eSpecs caps multi-domain specs at 4 while preserving directly modified specs', () => {
  const specs = selectE2eSpecs([
    'e2e/custom-regression.spec.ts',
    'src/cardapio/CardapioPage.tsx',
    'src/components/caixa/pdv/CashierPdvView.tsx',
    'src/components/auth/Login.tsx',
  ], alwaysExists);
  assert.equal(specs[0], 'e2e/custom-regression.spec.ts');
  assert.equal(specs.length, 4);
});
