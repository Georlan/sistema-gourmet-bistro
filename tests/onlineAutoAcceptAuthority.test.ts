import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const panel = source('../src/components/CaixaPanel.tsx');
const workspace = source('../src/components/caixa/orders/CaixaOrdersWorkspace.tsx');
const policyHook = source('../src/components/caixa/orders/useOnlineAutoAcceptPolicy.ts');
const webAdapter = source('../backend/app/adapters/orders/web_adapter.py');
const paymentService = source('../backend/app/services/online_payments/service.py');
const scheduled = source('../backend/app/services/scheduled_orders.py');

test('autoaccept toggle is a persisted backend policy, not a browser writer', () => {
  assert.match(panel, /useOnlineAutoAcceptPolicy/);
  assert.match(policyHook, /\/api\/online-orders\/control/);
  assert.match(policyHook, /\/api\/online-orders\/auto-accept/);
  assert.match(policyHook, /payload\?\.auto_accept === true/);
  assert.doesNotMatch(workspace, /useAutomaticOrderAcceptance/);
  assert.doesNotMatch(workspace, /AutomaticOrderAcceptanceEffect/);
});

test('all online release paths delegate to backend autoaccept authority', () => {
  for (const content of [webAdapter, paymentService, scheduled]) {
    assert.match(content, /auto_accept_online_order_if_enabled/);
  }
});
