import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { OperationalBanner, OperationalSummaryProvider } from '../src/components/shared/OperationalBanner';

const props = { id: 'orders-heading', eyebrow: 'OPERAÇÃO', title: 'Pedidos', accent: 'por etapa', description: 'Consulte os pedidos.', metrics: [{ label: 'valor em aberto', value: 'R$ 185' }] };

test('workspace adapter removes the visible banner and slogan inside the cashier', () => {
  const html = renderToStaticMarkup(createElement(OperationalSummaryProvider, { scope: 'operacao:pedidos', children: createElement(OperationalBanner, props) }));
  assert.match(html, /id="orders-heading" class="sr-only"/);
  assert.doesNotMatch(html, /orders-hero|operational-header|por etapa|R\$ 185/);
});

test('standalone consumers retain their metrics on demand without a hero', () => {
  const html = renderToStaticMarkup(createElement(OperationalBanner, props));
  assert.match(html, /<details/);
  assert.match(html, /<summary[^>]*>Resumo/);
  assert.match(html, /valor em aberto/);
  assert.match(html, /R\$ 185/);
  assert.doesNotMatch(html, /orders-hero|por etapa/);
});

test('kanban columns preserve their container-based card layout', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /\.orders-column\s*\{[^}]*container-type:\s*inline-size;/);
});
