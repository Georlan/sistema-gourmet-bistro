import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** Mechanical source cleanup only. Dynamic classes and shadowed imports stay untouched. */
export function simplifyStaticClasses(source, filename = 'view.tsx') {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = file.statements.filter(ts.isImportDeclaration).filter(node =>
    node.moduleSpecifier.text === 'clsx' && node.importClause?.name,
  );
  const names = new Set(imports.map(node => node.importClause.name.text));
  const edits = [];
  const visit = (node, callback) => { callback(node); ts.forEachChild(node, child => visit(child, callback)); };
  // Conservatively skip a file with a local binding of the imported name.
  visit(file, node => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node))
      && node.name && [...names].some(name => node.name.getText(file).split(/\W+/).includes(name))) {
      names.clear();
    }
  });
  visit(file, node => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !names.has(node.expression.text)
      || !node.arguments.length || !node.arguments.every(ts.isStringLiteral)) return;
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, node.getText(file));
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) return;
    }
    const value = node.arguments.map(argument => argument.text).filter(Boolean).join(' ');
    // Keep a JS string expression: quotes, ampersands and Tailwind selectors need no JSX re-encoding.
    edits.push({ start: node.getStart(file), end: node.end, text: JSON.stringify(value) });
  });
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  const updated = ts.createSourceFile(filename, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const unusedImports = [];
  for (const statement of updated.statements.filter(ts.isImportDeclaration)) {
    const clause = statement.importClause;
    if (statement.moduleSpecifier.text !== 'clsx' || !clause?.name || clause.namedBindings || !names.has(clause.name.text)) continue;
    let references = 0;
    visit(updated, node => { if (ts.isIdentifier(node) && node.text === clause.name.text) references++; });
    if (references === 1) unusedImports.push(statement);
  }
  for (const statement of unusedImports.reverse()) {
    output = output.slice(0, statement.getStart(updated)) + output.slice(statement.end);
  }
  return { output, replacements: edits.length, savedBytes: Buffer.byteLength(source) - Buffer.byteLength(output) };
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = directory + '/' + entry.name;
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const write = process.argv.includes('--write');
  const files = [];
  for (const path of sourceFiles('src')) {
    const result = simplifyStaticClasses(readFileSync(path, 'utf8'), path);
    if (result.output === readFileSync(path, 'utf8')) continue;
    if (write) writeFileSync(path, result.output);
    files.push({ path, replacements: result.replacements, savedBytes: result.savedBytes });
  }
  console.log(JSON.stringify({ mode: write ? 'write' : 'check', files,
    replacements: files.reduce((sum, file) => sum + file.replacements, 0),
    savedBytes: files.reduce((sum, file) => sum + file.savedBytes, 0),
  }, null, 2));
}
