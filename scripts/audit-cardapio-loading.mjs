import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Vite's real production graph for the public menu: includes shared JS and CSS closure.
const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));
const entries = Object.keys(manifest).filter(
  (key) =>
    manifest[key].isDynamicEntry
    && (manifest[key].src === 'src/cardapio/CardapioPage.tsx' || manifest[key].name === 'CardapioPage'),
);
assert.equal(entries.length, 1, 'Expected one CardapioPage dynamic entry');
const [entry] = entries;

const visited = new Set();
const cssSet = new Set();
function visit(key) {
  if (visited.has(key)) return;
  assert.ok(manifest[key], 'Missing build entry: ' + key);
  visited.add(key);
  for (const cssFile of manifest[key].css || []) cssSet.add(cssFile);
  for (const dependency of manifest[key].imports || []) visit(dependency);
}
visit(entry);

// Ensure root app entry CSS (e.g. index.html -> app-*.css) is also accounted for, since Cardapio loads inside index.html.
const rootEntry = manifest['index.html'];
if (rootEntry) {
  for (const cssFile of rootEntry.css || []) cssSet.add(cssFile);
}

const forbiddenInPublicMenu = [
  'src/components/CaixaPanel.tsx',
  'src/super-admin/SuperAdminGate.tsx',
  'src/landing/LandingPage.tsx',
  'src/components/caixa/pdv/CashierPdvView.tsx',
  'src/components/caixa/reports/CashierReports.tsx',
];
for (const file of forbiddenInPublicMenu) {
  assert.ok(!visited.has(file), 'Operational/admin/landing module leaked into Cardapio eager graph: ' + file);
}

const measure = (file) => {
  const bytes = readFileSync('dist/' + file);
  return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
};

const jsFiles = [...visited].map((key) => measure(manifest[key].file));
const cssFiles = [...cssSet].map(measure);

const jsRawBytes = jsFiles.reduce((total, f) => total + f.bytes, 0);
const jsGzipBytes = jsFiles.reduce((total, f) => total + f.gzipBytes, 0);
const cssRawBytes = cssFiles.reduce((total, f) => total + f.bytes, 0);
const cssGzipBytes = cssFiles.reduce((total, f) => total + f.gzipBytes, 0);

// Permanent performance budgets with ~5-8% headroom over verified baseline (827 kB JS / 284 kB CSS).
assert.ok(jsFiles.length <= 32, `Cardapio eager JS chunk count (${jsFiles.length}) exceeded 32`);
assert.ok(jsRawBytes <= 860_000, `Cardapio eager JS (${jsRawBytes} B) exceeded 860 kB budget`);
assert.ok(jsGzipBytes <= 255_000, `Cardapio eager JS gzip (${jsGzipBytes} B) exceeded 255 kB budget`);
assert.ok(cssRawBytes <= 300_000, `Cardapio eager CSS (${cssRawBytes} B) exceeded 300 kB budget`);
assert.ok(cssGzipBytes <= 46_000, `Cardapio eager CSS gzip (${cssGzipBytes} B) exceeded 46 kB budget`);

console.log(
  JSON.stringify(
    {
      method: 'Production JS+CSS eager dependency closure for CardapioPage; gzip per file.',
      jsChunks: jsFiles.length,
      jsRawBytes,
      jsGzipBytes,
      cssChunks: cssFiles.length,
      cssRawBytes,
      cssGzipBytes,
      cssFiles,
    },
    null,
    2,
  ),
);
