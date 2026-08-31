import assert from 'node:assert/strict';
import test from 'node:test';
import clsx from 'clsx';
import ts from 'typescript';
import { simplifyStaticClasses } from '../scripts/simplify-static-classes.mjs';

test('static class cleanup preserves clsx output including empty strings, selectors and quotes', () => {
  for (const args of [['flex', 'gap-2'], ['', 'a', '', 'b'], ['[&>span]:hidden', 'content-["x"]'], ['a  b', ' c'], ['', '']]) {
    const source = 'import clsx from "clsx"; const x = clsx(' + args.map(value => JSON.stringify(value)).join(',') + ');';
    const { output, replacements } = simplifyStaticClasses(source);
    assert.equal(replacements, 1);
    const parsed = ts.createSourceFile('test.tsx', output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = parsed.statements.find(ts.isVariableStatement)!.declarationList.declarations[0];
    assert.equal((declaration.initializer as ts.StringLiteral).text, clsx(...args));
    assert.equal(simplifyStaticClasses(output).replacements, 0);
  }
});

test('cleanup leaves dynamic calls, comments outside calls and shadowed imports intact', () => {
  const dynamic = 'import clsx from "clsx"; /* useful note */ const x = clsx("a", ready && "b");';
  assert.equal(simplifyStaticClasses(dynamic).output, dynamic);
  const shadowed = 'import clsx from "clsx"; function view(clsx) { return clsx("a", "b"); }';
  assert.equal(simplifyStaticClasses(shadowed).output, shadowed);
  const unrelated = 'function clsx(a, b) { return a + b; } const x = clsx("a", "b");';
  assert.equal(simplifyStaticClasses(unrelated).output, unrelated);
  const commented = 'import clsx from "clsx"; const x = clsx("a", /* preserve rationale */ "b");';
  assert.equal(simplifyStaticClasses(commented).output, commented);
});
