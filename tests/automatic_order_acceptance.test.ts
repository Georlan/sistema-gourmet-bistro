import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const panel = readFileSync('src/components/CaixaPanel.tsx', 'utf8');
const workspace = readFileSync('src/components/caixa/orders/CaixaOrdersWorkspace.tsx', 'utf8');

test('autoaceite é uma política persistida no backend, não um executor do navegador', () => {
  assert.match(panel, /\/api\/online-orders\/control/);
  assert.match(panel, /\/api\/online-orders\/auto-accept/);
  assert.match(panel, /payload\?\.auto_accept/);
  assert.equal(workspace.includes('useAutomaticOrderAcceptance'), false);
  assert.equal(workspace.includes('AutomaticOrderAcceptanceEffect'), false);
});
