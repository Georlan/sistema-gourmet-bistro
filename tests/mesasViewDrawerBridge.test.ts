import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MesasView } from '../src/components/mesas/MesasView';

test('filtros do salão expõem ids estáveis para os atalhos do drawer', () => {
  const html = renderToStaticMarkup(createElement(MesasView, {
    salonTables: [],
    rows: [],
    tableFilter: 'todos',
    onFilterChange: () => {},
  }));

  for (const filter of ['todos', 'livres', 'ocupadas', 'prontas']) {
    assert.match(html, new RegExp(`id="waiter-filter-${filter}"`));
  }
});
