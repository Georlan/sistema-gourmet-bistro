import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path: string) => ts.createSourceFile(path, readFileSync(new URL('../' + path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const app = read('src/App.tsx');
const owners = ['data/useOperationalCatalog', 'data/useOperationalOrders', 'data/useOperationalTables', 'drafts/useOperationalDrafts'];
function descendants(node: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [];
  function visit(n: ts.Node) { nodes.push(n); ts.forEachChild(n, visit); }
  visit(node); return nodes;
}
const calls = (node: ts.Node) => descendants(node).filter(ts.isCallExpression);

test('App wires persistent operational owners without reacquiring their action bodies', () => {
  const names = calls(app).map(call => call.expression.getText());
  for (const owner of owners) assert.ok(names.includes(owner.split('/').at(-1)!));
  const moved = new Set(['fetchTables', 'fetchLiveCatalog', 'fetchOrdersFromAPI', 'fetchOrderByIdFromAPI', 'handleSubmitDraft', 'handleEditDraftItems', 'mapBackendComandaToOrder']);
  for (const declaration of descendants(app).filter(ts.isVariableDeclaration)) {
    if (ts.isIdentifier(declaration.name)) assert.ok(!moved.has(declaration.name.text), declaration.name.text);
  }
  assert.ok(names.filter(name => name === 'useState').length <= 29);
  assert.ok(names.filter(name => name === 'useEffect').length <= 15);
  assert.ok(names.filter(name => name === 'fetch').length <= 15);
  assert.ok(names.filter(name => name === 'operationalFetch').length <= 5);
});

test('shared owners have concrete dependencies and private request/submission guards', () => {
  for (const owner of owners) {
    const file = read('src/components/app/' + owner + '.ts');
    for (const statement of file.statements.filter(ts.isImportDeclaration)) {
      assert.doesNotMatch((statement.moduleSpecifier as ts.StringLiteral).text, /(?:^|\/)(?:App|CaixaPanel|domain)$/);
    }
    const hook = file.statements.find(ts.isFunctionDeclaration)!;
    const exportedState = hook.body!.statements.filter(ts.isReturnStatement).at(-1)!.getText();
    assert.doesNotMatch(exportedState, /isSubmittingRef|AbortControllerRef|catalogRequestRef|targetedOrderRequestRef|optimisticItemStatusRef/);
  }
  const drafts = read('src/components/app/drafts/useOperationalDrafts.ts').text;
  assert.match(drafts, /ReturnType<typeof useOperationalOrders>/);
  assert.ok(drafts.indexOf('if (isSubmittingRef.current) return') < drafts.indexOf('await operationalFetch'));
  assert.match(drafts, /finally\s*\{\s*isSubmittingRef.current = false;/);
  assert.ok(drafts.indexOf('if (!launchRes.ok)') < drafts.indexOf('clearPersistedOperationKey(launchStorageKey, launchIdempotencyKey)'));
});

test('catalog listeners and polling keep their cleanup next to their owner', () => {
  const catalog = read('src/components/app/data/useOperationalCatalog.ts');
  const effects = calls(catalog).filter(call => call.expression.getText() === 'useEffect');
  assert.equal(effects.length, 2);
  const polling = effects.find(effect => effect.getText().includes('setInterval'))!.getText();
  assert.match(polling, /if \(!isAuthenticated\) return/);
  assert.match(polling, /if \(isWsConnected\) return/);
  assert.match(polling, /clearInterval\(interval\)/);
  const connectivity = effects.find(effect => effect.getText().includes('addEventListener'))!.getText();
  for (const [event, callback] of [['online', 'handleOnline'], ['offline', 'handleOffline']]) {
    assert.ok(connectivity.includes(`addEventListener('${event}', ${callback})`));
    assert.ok(connectivity.includes(`removeEventListener('${event}', ${callback})`));
  }
});
