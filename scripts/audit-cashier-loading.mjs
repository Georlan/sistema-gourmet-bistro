import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Vite's real production graph: include shared chunks, never just the entry size.
const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));
const entries = Object.keys(manifest).filter(key => manifest[key].isDynamicEntry
  && (manifest[key].src === 'src/components/CaixaPanel.tsx' || manifest[key].name === 'CaixaPanel'));
assert.equal(entries.length, 1, 'Expected one Caixa dynamic entry');
const [entry] = entries;
const visited = new Set();
function visit(key) {
  if (visited.has(key)) return;
  assert.ok(manifest[key], 'Missing build entry: ' + key);
  visited.add(key);
  for (const dependency of manifest[key].imports || []) visit(dependency);
}
visit(entry);
const deferred = [
  'inventory/CashierInventory', 'catalog/CashierCatalog', 'customers/CashierCustomers',
  'settings/CashierSettings', 'online-menu/CashierOnlineMenu', 'team/CashierTeam',
  'reports/CashierReports', 'pdv/CashierPdvView',
].map(file => 'src/components/caixa/' + file + '.tsx');
for (const file of deferred) {
  assert.ok(manifest[file]?.isDynamicEntry, 'Must remain a lazy production entry: ' + file);
  assert.ok(!visited.has(file), 'Administrative view returned to startup: ' + file);
}
const measure = key => {
  const file = manifest[key].file;
  const bytes = readFileSync('dist/' + file);
  return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
};
const initial = [...visited].map(measure);
const initialBytes = initial.reduce((total, file) => total + file.bytes, 0);
const initialGzipBytes = initial.reduce((total, file) => total + file.gzipBytes, 0);
// Explicit headroom over the measured extraction, not a target to fill.
assert.ok(measure(entry).bytes <= 400_000, 'Caixa entry exceeded its 400 kB budget');
assert.ok(initialBytes <= 1_350_000, 'Caixa eager JS graph exceeded its 1.35 MB budget');
console.log(JSON.stringify({
  method: 'Production JS eager dependency closure; gzip per file. Excludes CSS, images, API and browser timing.',
  initialBytes, initialGzipBytes, initial, deferred: deferred.map(measure),
}, null, 2));
