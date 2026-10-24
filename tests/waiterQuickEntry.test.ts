import assert from 'node:assert/strict';
import test from 'node:test';
import { getTableQuickClients, projectStandardQuickDrafts } from '../src/domain/waiterQuickEntry';
import type { DraftItem, Order } from '../src/types';
const item = (id: string, client: string, obs = '', extra = {}) => ({ id, produtoId: 'burger', nome: 'Hambúrguer', preco: 45, quantidade: 1, clienteNome: client, observacao: obs, ...extra }) as DraftItem;

test('atalho padrão isola clientes, observações e adicionais, mesmo se IDs faltarem', () => {
  const plain = item('plain', 'João');
  const items = [plain, item('ana', 'Ana'), item('obs', 'João', 'Sem cebola'), item('ids', 'João', '', { modificadorIds: ['cheese'] }), item('meta', 'João', '', { modificadoresSelecionados: [{ id: 'cheese' }] })];
  assert.deepEqual(projectStandardQuickDrafts(items, 'João').get('burger'), { item: plain, quantity: 1 });
  assert.equal(projectStandardQuickDrafts(items, 'Ana').get('burger')?.item.id, 'ana');
});
test('somente personalizados não viram alvo de incremento ou exclusão padrão', () => {
  assert.equal(projectStandardQuickDrafts([item('custom', 'Ana', 'Sem cebola')], 'Ana').size, 0);
});
test('quantidade projetada corresponde somente às linhas padrão compatíveis sem mutar rascunho', () => {
  const a = Object.freeze(item('a', 'João', '', { quantidade: 2 }));
  const b = Object.freeze(item('b', 'João', '', { quantidade: 3 }));
  assert.deepEqual(projectStandardQuickDrafts(Object.freeze([a, b]), 'João').get('burger'), { item: b, quantity: 5 });
});
test('cliente padrão vazio e Consumo Geral representam a mesa sem misturar nomes reais', () => {
  const a = item('a', 'Consumo Geral');
  assert.equal(projectStandardQuickDrafts([a, item('named', 'Ana')], '').get('burger')?.item.id, 'a');
  assert.equal(projectStandardQuickDrafts([a], 'Ana').size, 0);
});

test('seletor ignora consumo geral e vazios, mas encontra nomes nos pedidos e rascunhos da mesa', () => {
  const orders: Order[] = [{ id: 'check', mesaId: 10, garcomId: 'fixture', garcomNome: 'Teste', timestamp: 0, itens: [item('a', ' Ana '), item('default', ' consumo geral ')].map(entry => ({ ...entry, status: 'preparando' })) }];
  const drafts = [item('b', 'Ana'), item('c', 'João'), item('blank', ' '), item('default', '')];
  assert.deepEqual(getTableQuickClients(drafts, orders), ['Ana', 'João']);
  assert.deepEqual(getTableQuickClients([item('default', 'Consumo Geral')], []), []);
});


test('nomes pertencem só à mesa atual, sem cancelados ou cadastro residual após remover itens', () => {
  const orders: Order[] = [
    { id: 'a', mesaId: 10, garcomId: 'fixture', garcomNome: 'Teste', timestamp: 0,
      itens: [{ ...item('live', 'Ana'), status: 'entregue' }, { ...item('old', 'Antigo'), status: 'cancelado' }] },
    { id: 'b', mesaId: 11, garcomId: 'fixture', garcomNome: 'Teste', timestamp: 0,
      itens: [{ ...item('foreign', 'Outra mesa'), status: 'preparando' }] },
  ];
  assert.deepEqual(getTableQuickClients([item('duplicate', 'Ana'), item('draft', 'João')], orders, 10), ['Ana', 'João']);
  assert.deepEqual(getTableQuickClients([], [], 10), []);
  assert.deepEqual(getTableQuickClients([], orders, 12), []);
});
