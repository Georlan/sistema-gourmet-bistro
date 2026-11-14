import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hookSource = readFileSync(
  'src/components/caixa/smartpos/useCashierSmartPos.ts',
  'utf8',
);

test('useCashierSmartPos evita refetch ao voltar para Pedidos sem dirty/offline timeout e preserva listeners em outras abas', () => {
  assert.match(hookSource, /const dirtyRef = useRef\(true\);/);
  assert.match(hookSource, /const lastFetchedAtRef = useRef\(0\);/);
  assert.match(
    hookSource,
    /if \(dirtyRef\.current \|\| lastFetchedAtRef\.current === 0 \|\| offlineIntervalElapsed\) \{\s*refresh\.invalidate\(\);\s*\}/,
  );
  assert.match(hookSource, /window\.addEventListener\('koma_smartpos_updated', markDirty\);/);
  assert.match(hookSource, /if \(orderUpdateAffects\(event, 'payments'\)\) dirtyRef\.current = true;/);
  assert.match(hookSource, /dirtyRef\.current = false;\s*lastFetchedAtRef\.current = Date\.now\(\);/);
});
