import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'src/components/MesaDetailsModalBase.tsx'), 'utf8');

test('mesa is the primary visual anchor of the salon modal header', () => {
  const contextIndex = source.indexOf('>Atendimento</span>');
  const tableIndex = source.indexOf('table.nome?.trim()');
  const elapsedIndex = source.indexOf('{elapsedTime}');

  assert.ok(contextIndex >= 0, 'operational context should be visible');
  assert.ok(tableIndex > contextIndex, 'table identity should follow the context eyebrow');
  assert.ok(elapsedIndex > tableIndex, 'elapsed time must remain secondary to table identity');
  assert.match(source, /<h2[^>]*>[\s\S]*?table.nome\?\.trim\(\)[\s\S]*?Mesa \$\{table.id\}/);
  const css = readFileSync(path.join(root, 'src/components/mesas/waiterOperational.css'), 'utf8');
  assert.match(css, /\.kw-flow-title h2[^}]*font-size:1\.625rem/);
  assert.match(css, /\.kw-flow-meta[^}]*font-size:\.6875rem/);
  assert.match(source, /aria-label="Voltar ao mapa de mesas"/);
  assert.match(source, /aria-label="Fechar detalhes da mesa"/);
  assert.doesNotMatch(source, />Ocupada</);
  assert.doesNotMatch(source, />Permanência</);
  assert.match(source, /Tempo na mesa/);
});
