import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

for (const consumer of ['vite', 'tinyglobby', 'fdir']) {
  test(`file matching used by ${consumer} keeps build globs and rejects repeated groups`, () => {
    const fromConsumer = createRequire(require.resolve(consumer));
    const match = fromConsumer('picomatch');
    assert.equal(match('src/**/*.{ts,tsx}')('src/components/Cashier.tsx'), true);
    assert.equal(match('src/**/*.{ts,tsx}')('src/components/Cashier.css'), false);
    assert.equal(match('assets/@(light|dark).svg')('assets/dark.svg'), true);
    for (const pattern of ['files/+(ab).ts', 'files/*(ab).ts']) {
      assert.throws(() => match.makeRe(pattern), /Repeated extglob groups are disabled/);
    }
  });
}
