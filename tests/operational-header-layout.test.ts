import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { OperationalBanner } from '../src/components/shared/OperationalBanner';

const props = { id: 'orders-heading', eyebrow: 'OPERAÇÃO', title: 'Pedidos', accent: 'por etapa', description: 'Consulte os pedidos.', metrics: [{ label: 'valor em aberto', value: 'R$ 185' }] };

test('workspace adapter removes the visible banner and slogan inside the cashier', () => {
  const html = renderToStaticMarkup(createElement(OperationalBanner, props));
  assert.match(html, /id="orders-heading" class="sr-only"/);
  assert.doesNotMatch(html, /orders-hero|operational-header|por etapa|R\$ 185/);
});

test('all consumers retain their accessible heading without an indicators widget', () => {
  const html = renderToStaticMarkup(createElement(OperationalBanner, props));
  assert.match(html, /<h1[^>]*>Pedidos<\/h1>/);
  assert.doesNotMatch(html, /<details|<summary|<button|valor em aberto|R\$ 185/);
});

test('kanban columns preserve their container-based card layout', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /\.orders-column\s*\{[^}]*container-type:\s*inline-size;/);
});
