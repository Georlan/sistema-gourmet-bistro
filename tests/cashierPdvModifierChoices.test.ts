import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogModifierGroup } from '../src/catalog/catalog';
import { CashierPdvModifierChoices } from '../src/components/caixa/pdv/CashierPdvModifierChoices';

const group: CatalogModifierGroup = {
  id: 'extras',
  nome: 'Adicionais',
  min_selecoes: 1,
  max_selecoes: 2,
  tipo: 'obrigatorio',
  modo_selecao: 'tipos',
  recomendado: true,
  opcoes: [
    { id: 'bacon', grupo_id: 'extras', nome: 'Bacon', preco_adicional: 2, ativo: true },
    { id: 'queijo', grupo_id: 'extras', nome: 'Queijo', preco_adicional: 3, ativo: true },
    { id: 'ovo', grupo_id: 'extras', nome: 'Ovo', preco_adicional: 1, ativo: true },
  ],
};

const render = (selectedIds: string[]) => renderToStaticMarkup(
  createElement(CashierPdvModifierChoices, {
    groups: [group],
    selectedIds,
    onQuantityChange: () => {},
  }),
);

test('PDV modifier picker renders mandatory status and canonical selection count', () => {
  const html = render([]);
  assert.match(html, /Obrigatório/);
  assert.match(html, /0\/2/);
  assert.match(html, /data-testid="modifier-group"/);
  assert.match(html, /aria-label="Selecionar Bacon"/);
  assert.match(html, /Adicionar uma unidade de Bacon/);
});

test('PDV modifier picker does not offer a third distinct type at its limit', () => {
  const html = render(['bacon', 'queijo']);
  assert.match(html, /Concluído/);
  assert.match(html, /2\/2/);
  assert.match(html, /aria-label="Selecionar Ovo"[^>]*disabled/);
  assert.match(html, /Adicionar uma unidade de Ovo"[^>]*disabled/);
});

test('PDV modifier picker uses enabled steppers for selected quantities', () => {
  const html = render(['bacon']);
  assert.match(html, /aria-pressed="true" aria-label="Selecionado: Bacon"/);
  assert.match(html, /Remover uma unidade de Bacon/);
  assert.match(html, /\+ R\$\s*2,00/);
});
