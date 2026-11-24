import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
