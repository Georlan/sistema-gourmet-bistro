import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { productRequiresConfiguration } from '../src/components/MenuPanel';
import type { Product } from '../src/types';

const product = (groups: any[]): Product => ({
  id: 'p-1',
  nome: 'Prato teste',
  preco: 25,
  categoria: 'Pratos',
  grupos_modificadores: groups,
} as unknown as Product);

test('produto com escolha obrigatória nunca usa quick add inválido', () => {
  const required = product([{
    id: 'g-1',
    nome: 'Ponto',
    min_selecoes: 1,
    max_selecoes: 1,
    opcoes: [{ id: 'o-1', nome: 'Ao ponto', preco_adicional: 0, ativo: true }],
  }]);
  const optional = product([{
    id: 'g-2',
    nome: 'Extra',
    min_selecoes: 0,
    max_selecoes: 2,
    opcoes: [{ id: 'o-2', nome: 'Molho', preco_adicional: 2, ativo: true }],
  }]);

  assert.equal(productRequiresConfiguration(required), true);
  assert.equal(productRequiresConfiguration(optional), false);
});

test('revisão e envio mostram mesa, quantidade e valor na ação principal', () => {
  const source = readFileSync(new URL('../src/components/MenuPanel.tsx', import.meta.url), 'utf8');

  assert.match(source, /Mesa \{tableId\} · Revisar pedido/);
  assert.match(source, /Revisar \$\{totalDraftQty\} \$\{itemWord\} · R\$ \$\{money\(draftTotal\)\}/);
  assert.match(source, /Lançar \$\{totalDraftQty\} \$\{itemWord\} · R\$ \$\{money\(draftTotal\)\}/);
  assert.match(source, /Total deste lançamento/);
  assert.doesNotMatch(source, />Ver pedido </);
});

test('mutação do rascunho fica travada enquanto o lançamento está em andamento', () => {
  const source = readFileSync(new URL('../src/components/MenuPanel.tsx', import.meta.url), 'utf8');

  assert.match(source, /if \(isSubmitting\) return;/);
  assert.match(source, /disabled=\{isSubmitting\}/);
  assert.match(source, /aria-busy=\{isSubmitting\}/);
  assert.match(source, /Enviando pedido…/);
});

test('catálogo explicita configuração obrigatória antes de adicionar', () => {
  const source = readFileSync(new URL('../src/components/MenuPanel.tsx', import.meta.url), 'utf8');

  assert.match(source, /productRequiresConfiguration\(product\)/);
  assert.match(source, /Escolhas obrigatórias/);
  assert.match(source, /Escolher opções/);
  assert.match(source, /Complete as escolhas/);
});
