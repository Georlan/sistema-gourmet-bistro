import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/components/MesaDetailsModal.tsx', import.meta.url),
  'utf8',
);

test('modal operacional do garçom fecha por Escape e remove o listener no unmount', () => {
  assert.match(source, /if \(event\.key !== 'Escape'\) return;/);
  assert.match(source, /event\.preventDefault\(\);\s*props\.onClose\(\);/);
  assert.match(source, /document\.addEventListener\('keydown', handleKeyDown\);/);
  assert.match(source, /return \(\) => document\.removeEventListener\('keydown', handleKeyDown\);/);
});
