import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = (file: string) => ts.createSourceFile(file,
  readFileSync(new URL('../' + file, import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function descendants(node: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (child: ts.Node) => { nodes.push(child); ts.forEachChild(child, visit); };
  visit(node);
  return nodes;
}
const calls = (node: ts.Node) => descendants(node).filter(ts.isCallExpression);
const callName = (call: ts.CallExpression) => call.expression.getText().replace(/^React\./, '');
const ownerFiles = [
  'checkout/useCheckoutController.ts', 'orders/useCashierOrders.ts',
  'smartpos/useCashierSmartPos.ts', 'shift/useCashShift.ts',
  'realtime/useCashierAlerts.ts', 'realtime/useCashierClock.ts', 'realtime/useCashierRealtime.ts',
].map(file => 'src/components/caixa/' + file);
const root = source('src/components/CaixaPanel.tsx');

test('Caixa composition cannot reacquire payment, order, shift or SmartPOS action bodies', () => {
  const ownedActions = new Set([
    'handleProcessPayment', 'handleConfirmPendingCashPayment', 'handleRejectPendingCashPayment',
    'handleCancelTableConsumption', 'handleTransferTableFromSalon', 'handleUpdateItemStatus',
    'handleReconcileSmartPosPayment', 'handleAbrirCaixa', 'handleConfirmarFechamento',
    'handleRegistrarSangria', 'handleRegistrarSuprimento', 'buildTableCheckoutOrder',
  ]);
  for (const node of descendants(root).filter(ts.isVariableDeclaration)) {
    if (ts.isIdentifier(node.name) && ownedActions.has(node.name.text)) {
      assert.fail('Action body returned to composition: ' + node.name.text);
    }
  }
  for (const owner of ownerFiles) {
    const name = owner.split('/').at(-1)!.replace('.ts', '');
    assert.ok(calls(root).some(call => callName(call) === name), name + ' must be wired, not a dead extraction');
  }
});

test('legacy root has an explicit non-growing state/effect/request budget', () => {
  // Ratchet measured after ownership extraction; changing these budgets requires
  // an explicit architecture decision, not automatic snapshot regeneration.
  const names = calls(root).map(callName);
  assert.ok(names.filter(name => name === 'useState').length <= 141);
  assert.ok(names.filter(name => name === 'useEffect').length <= 17);
  assert.ok(names.filter(name => ['fetch', 'operationalFetch'].includes(name)).length <= 61);
});

test('checkout view is controlled and has no request, subscription or state authority', () => {
  const view = source('src/components/caixa/checkout/CheckoutDialog.tsx');
  const forbidden = new Set(['useState', 'useEffect', 'useReducer', 'fetch', 'operationalFetch',
    'setInterval', 'window.setInterval', 'window.addEventListener', 'document.addEventListener']);
  for (const call of calls(view)) assert.ok(!forbidden.has(callName(call)), callName(call));
  assert.match(root.text, /<CheckoutDialog\s/);
  assert.match(root.text, /controller=\{checkout\}/);
});

test('domain.ts stays a compatibility barrel and new owners use concrete modules', () => {
  const barrel = source('src/domain.ts');
  assert.ok(barrel.statements.length > 0);
  assert.ok(barrel.statements.every(ts.isExportDeclaration), 'No functions/state in compatibility barrel');
  for (const file of [...ownerFiles, 'src/components/caixa/checkout/CheckoutDialog.tsx']) {
    for (const declaration of source(file).statements.filter(ts.isImportDeclaration)) {
      const dependency = (declaration.moduleSpecifier as ts.StringLiteral).text;
      assert.ok(!/(^|\/)domain(?:\.ts)?$/.test(dependency), file + ' → ' + dependency);
      assert.ok(!dependency.includes('CaixaPanel'), file + ' must not depend on composition');
    }
  }
});

test('each owned listener and interval is paired with cleanup in its own effect', () => {
  let subscriptions = 0;
  let intervals = 0;
  for (const file of ownerFiles) {
    for (const effect of calls(source(file)).filter(call => callName(call) === 'useEffect')) {
      const callback = effect.arguments[0];
      assert.ok(ts.isArrowFunction(callback) && ts.isBlock(callback.body));
      const body = callback.body;
      const cleanup = body.statements.filter(ts.isReturnStatement)
        .flatMap(statement => statement.expression ? calls(statement.expression) : []);
      for (const call of calls(body)) {
        if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'addEventListener') {
          subscriptions++;
          const receiver = call.expression.expression.getText();
          assert.ok(cleanup.some(remove =>
            remove.expression.getText() === receiver + '.removeEventListener'
            && remove.arguments[0]?.getText() === call.arguments[0]?.getText()
            && remove.arguments[1]?.getText() === call.arguments[1]?.getText()), file + ': ' + call.getText());
        }
        if (['setInterval', 'window.setInterval'].includes(call.expression.getText())) {
          intervals++;
          assert.ok(ts.isVariableDeclaration(call.parent));
          const intervalId = call.parent.name.getText();
          assert.ok(cleanup.some(clear => /^(window\.)?clearInterval$/.test(clear.expression.getText())
            && clear.arguments[0]?.getText() === intervalId), file + ': interval without cleanup');
        }
      }
    }
  }
  assert.ok(subscriptions >= 8, 'Do not accidentally stop scanning subscriptions');
  assert.equal(intervals, 3);
});
