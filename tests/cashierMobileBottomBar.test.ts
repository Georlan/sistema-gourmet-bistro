import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CashierMobileBottomBar } from '../src/components/caixa/navigation/CashierMobileBottomBar';

const renderDock = (overrides: Partial<ComponentProps<typeof CashierMobileBottomBar>> = {}) =>
  renderToStaticMarkup(
    createElement(CashierMobileBottomBar, {
      activeTab: 'operacao',
      activeSubTab: 'pedidos',
      onNavigate: () => {},
      onOpenMenu: () => {},
      ...overrides,
    }),
  );

test('mobile dock preserves five recognizable accessible destinations', () => {
  const markup = renderDock();
  assert.match(markup, /aria-label="Navegação móvel principal"/);
  assert.equal((markup.match(/class="cashier-mobile-bottom-bar__action"/g) ?? []).length, 5);
  for (const label of ['Pedidos', '+ Pedido', 'Cozinha', 'Caixa']) {
    assert.match(markup, new RegExp(`aria-label="${label.replace('+', '\\+')}"`));
  }
  assert.match(markup, /aria-label="Abrir menu completo"/);
  assert.match(markup, /aria-current="page" aria-label="Pedidos"/);
});

test('mobile dock reflects current operation and pocket preparation label', () => {
  const markup = renderDock({ activeSubTab: 'preparo', dedicatedKds: false });
  assert.match(markup, /aria-current="page" aria-label="Preparo"/);
  assert.doesNotMatch(markup, /aria-current="page" aria-label="Pedidos"/);
  assert.doesNotMatch(markup, /aria-label="Cozinha"/);
});

test('mobile dock caps operational counts and exposes the shift status to assistive technology', () => {
  const markup = renderDock({ activeTab: 'financeiro', orderCount: 125, kitchenCount: 7, shiftOpen: true });
  assert.match(markup, /99\+/);
  assert.match(markup, /cashier-mobile-bottom-bar__count--kitchen/);
  assert.match(markup, /aria-current="page" aria-label="Caixa"/);
  assert.match(markup, /aria-describedby="cashier-mobile-shift-status"/);
  assert.match(markup, /Turno aberto/);
});
