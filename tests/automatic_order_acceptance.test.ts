import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const panel = readFileSync('src/components/CaixaPanel.tsx', 'utf8');
const workspace = readFileSync('src/components/caixa/orders/CaixaOrdersWorkspace.tsx', 'utf8');
const policyHook = readFileSync(
  'src/components/caixa/orders/useOnlineOrderAutoAcceptPolicy.ts',
  'utf8',
);

test('autoaceite é uma política persistida no backend, não um executor do navegador', () => {
  assert.match(panel, /useOnlineOrderAutoAcceptPolicy/);
  assert.match(policyHook, /\/api\/online-orders\/control/);
  assert.match(policyHook, /\/api\/online-orders\/auto-accept/);
  assert.match(policyHook, /payload\?\.auto_accept/);
  assert.equal(workspace.includes('useAutomaticOrderAcceptance'), false);
  assert.equal(workspace.includes('AutomaticOrderAcceptanceEffect'), false);
});
