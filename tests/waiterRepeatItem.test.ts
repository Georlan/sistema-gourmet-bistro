import assert from 'node:assert/strict';
import test from 'node:test';
import { planWaiterRepeat, findRepeatedDraft } from '../src/domain/waiterRepeatItem';
import type { DraftItem, OrderItem, Product } from '../src/types';
import type { CatalogModifierGroup } from '../src/catalog/catalog';
const item: OrderItem = { id: 'old', produtoId: 'juice', nome: 'Suco', preco: 9, clienteNome: '', observacao: '', status: 'entregue' };
const product = (groups: CatalogModifierGroup[] = []) => ({ id: 'juice', nome: 'Suco', preco: 12, ativo: true, grupos_modificadores: groups }) as unknown as Product;
const group: CatalogModifierGroup = { id: 'extra', nome: 'Extra', min_selecoes: 0, max_selecoes: 3, modo_selecao: 'porcoes', tipo: 'opcional', opcoes: [{ id: 'ice', grupo_id: 'extra', nome: 'Gelo', preco_adicional: 2, ativo: true }] };
test('repetição reconstrói uma unidade com preço atual sem mudar o consumo histórico', () => {
  const original = Object.freeze({ ...item });
  const plan = planWaiterRepeat(original, product());
  assert.equal(plan.kind, 'quick');
  if (plan.kind !== 'quick') return;
  assert.equal(plan.unitPrice, 12);
  assert.equal(plan.client, 'Consumo Geral');
  assert.equal(original.preco, 9);
});
test('cliente, observação e quantidades repetidas de adicionais são preservados com preço atual', () => {
  const custom = { ...item, clienteNome: 'Ana', observacao: 'Pouco açúcar', modificadores: [{ id: 'ice', nome: 'Gelo', preco: 1 }, { id: 'ice', nome: 'Gelo', preco: 1 }] };
  const plan = planWaiterRepeat(custom, product([group]));
  assert.equal(plan.kind, 'quick');
  if (plan.kind !== 'quick') return;
  assert.equal(plan.client, 'Ana');assert.equal(plan.observation, 'Pouco açúcar');assert.equal(plan.unitPrice, 16);
  assert.deepEqual(plan.product.__selectedModifierIds, ['ice', 'ice']);
});
test('opção removida e nova escolha obrigatória pedem configuração, nunca adição silenciosa', () => {
  const removed = planWaiterRepeat({ ...item, modificadores: [{ id: 'removed', nome: 'Antigo', preco: 1 }] }, product([group]));
  assert.equal(removed.kind, 'configure');
  if (removed.kind === 'configure') assert.deepEqual(removed.configuration.modifierIds, []);
  assert.equal(planWaiterRepeat(item, product([{ ...group, min_selecoes: 1 }])).kind, 'configure');
  assert.equal(planWaiterRepeat({ ...item, modificadores: Array.from({ length: 4 }, () => ({ id: 'ice', nome: 'Gelo', preco: 2 })) }, product([group])).kind, 'configure');
});
test('produto ausente, pausado, preço inválido e composição agrupada não usam atalho', () => {
  assert.equal(planWaiterRepeat(item).kind, 'unavailable');
  assert.equal(planWaiterRepeat(item, { ...product(), ativo: false }).kind, 'unavailable');
  assert.equal(planWaiterRepeat(item, { ...product(), preco: NaN }).kind, 'unavailable');
  assert.equal(planWaiterRepeat({ ...item, composicao_agrupada: true }, product()).kind, 'unavailable');
  assert.equal(planWaiterRepeat({ ...item, status: 'cancelado' }, product()).kind, 'unavailable');
});
test('junta somente linhas com cliente, composição, observação e preço exatamente compatíveis', () => {
  const plan = planWaiterRepeat(item, product());if (plan.kind !== 'quick') throw Error('Expected quick');
  const draft: DraftItem = { id: 'draft', produtoId: 'juice', nome: 'Suco', preco: 12, quantidade: 2, clienteNome: 'Consumo Geral', observacao: '' };
  assert.equal(findRepeatedDraft([draft], plan)?.id, 'draft');
  for (const changed of [{ preco: 9 }, { clienteNome: 'Ana' }, { observacao: 'Sem gelo' }, { modificadorIds: ['ice'] }, { modificadoresSelecionados: [{ id: 'ice' }] }]) {
    assert.equal(findRepeatedDraft([{ ...draft, ...changed }], plan), undefined);
  }
});
