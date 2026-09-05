import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'src/components/MesaDetailsModalBase.tsx'), 'utf8');

test('mesa is the primary visual anchor of the salon modal header', () => {
  const contextIndex = source.indexOf('Consumo no local');
  const tableIndex = source.indexOf('Mesa {table.id}{originStr}');
  const permanenceIndex = source.indexOf('Permanência');

  assert.ok(contextIndex >= 0, 'operational context should be visible');
  assert.ok(tableIndex > contextIndex, 'table identity should follow the context eyebrow');
  assert.ok(permanenceIndex > tableIndex, 'permanence must remain secondary to table identity');
  assert.match(source, /text-2xl sm:text-4xl[^\n]*font-extrabold/);
  assert.match(source, /aria-label="Voltar ao mapa de mesas"/);
  assert.match(source, /aria-label="Fechar detalhes da mesa"/);
});
