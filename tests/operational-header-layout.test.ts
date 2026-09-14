import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const component = source('../src/components/shared/OperationalBanner.tsx');
const css = source('../src/components/shared/operationalHeader.css');

test('cabeçalhos operacionais não renderizam mais o hero decorativo antigo', () => {
  assert.match(component, /operational-header/);
  assert.doesNotMatch(component, /orders-eyebrow/);
  assert.doesNotMatch(component, /orders-hero__copy/);
  assert.doesNotMatch(component, /orders-hero__metrics/);

  assert.match(css, /\.orders-hero\.operational-header::before\s*\{\s*display:\s*none;/);
  assert.match(css, /background:\s*transparent;/);
  assert.match(css, /box-shadow:\s*none;/);
});

test('informações úteis continuam disponíveis em uma linha compacta', () => {
  assert.match(component, /operational-header__metrics/);
  assert.match(component, /metric\.value/);
  assert.match(component, /metric\.label/);
  assert.match(component, /className="sr-only">\{eyebrow\}\. \{description\}/);

  const minHeight = Number(css.match(/\.orders-hero\.operational-header\s*\{[^}]*min-height:\s*([\d.]+)rem/)?.[1]);
  assert.ok(Number.isFinite(minHeight));
  assert.ok(minHeight <= 2.5, 'cabeçalho operacional deve permanecer compacto');
});
