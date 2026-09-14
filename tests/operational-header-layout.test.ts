import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const component = source('../src/components/shared/OperationalBanner.tsx');
const css = source('../src/components/shared/operationalHeader.css');

const indexCss = source('../src/index.css');
const lowHeightCss = source('../src/components/caixa/navigation/cashierLowHeight.css');

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

test('cabeçalho operacional compacto não é suprimido no mobile nem perde ênfase em monitores baixos', () => {
  assert.match(css, /\.orders-hero\.operational-header\s*\{[^}]*display:\s*flex\s*!important;/);
  assert.match(indexCss, /\.orders-hero:not\(\.operational-header\)\s*\{\s*display:\s*none\s*!important;/);
  assert.match(lowHeightCss, /\.orders-workspace\s+\.orders-hero:not\(\.operational-header\)\s+h1\s+em\s*\{\s*display:\s*none;/);
});

test('KPIs do cabeçalho se acomodam no mobile sem deixar o último indicador parcialmente cortado', () => {
  const mobile = css.split('@media (max-width: 560px)', 2)[1] ?? '';
  assert.match(mobile, /\.operational-header__metrics\s*\{[^}]*display:\s*grid;/);
  assert.match(mobile, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(5\.25rem,\s*1fr\)\);/);
  assert.match(mobile, /\.operational-header__metrics\s*\{[^}]*overflow:\s*visible;/);
  assert.match(mobile, /\.operational-header__metric\s*\{[^}]*min-width:\s*0;/);
  assert.match(mobile, /\.operational-header__metric\s+dt\s*\{[^}]*text-overflow:\s*ellipsis;/);
});

test('coluna do kanban declara container-type para manter cards legíveis em qualquer largura', () => {
  assert.match(indexCss, /\.orders-column\s*\{[^}]*container-type:\s*inline-size;/);
});
