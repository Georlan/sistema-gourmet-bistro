import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function listFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(full));
    else results.push(full);
  }
  return results;
}

test('nenhum arquivo de teste fica escondido dentro de src/ fora da descoberta do runner', () => {
  const srcRoot = new URL('../src', import.meta.url).pathname;
  const hiddenTests = listFiles(srcRoot).filter(file => /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/.test(file));
  assert.deepEqual(hiddenTests, []);
});

test('ferramentas exclusivas de build ficam em devDependencies e não em dependencies', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const deps = pkg.dependencies ?? {};
  const devDeps = pkg.devDependencies ?? {};
  for (const tool of ['vite', '@tailwindcss/vite', '@vitejs/plugin-react']) {
    assert.equal(tool in deps, false, `${tool} não deve estar em dependencies`);
    assert.equal(tool in devDeps, true, `${tool} deve estar em devDependencies`);
  }
});

test('assets de mock-preview não retornam para public/ e telas secundárias permanecem lazy em App.tsx', () => {
  assert.equal(existsSync(new URL('../public/mock-preview', import.meta.url)), false, 'public/mock-preview não deve ser publicado no bundle');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /^import\s+\{\s*MesaDetailsModal\s*\}\s+from/m);
  assert.doesNotMatch(app, /^import\s+\{\s*MesasView\s*\}\s+from/m);
  assert.doesNotMatch(app, /^import\s+\{\s*KitchenPanel\s*\}\s+from/m);
});
