import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/super-admin/SuperAdminSignupsTab.tsx', 'utf8');

test('SuperAdmin oferece reemissão do convite inicial após liberação', () => {
  assert.match(source, /Reemitir convite inicial/);
  assert.match(source, /\/activation-invite/);
  assert.match(source, /O link anterior foi invalidado/);
});

test('status de cobrança usa linguagem de autorização recorrente', () => {
  assert.match(source, /payment_pending: 'Autorização pendente'/);
  assert.match(source, /payment_failed: 'Autorização recusada'/);
  assert.doesNotMatch(source, /payment_pending: 'Pagamento pendente'/);
});
