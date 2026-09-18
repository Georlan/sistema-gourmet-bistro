import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Pedidos online expõe gestão e histórico de clientes bloqueados sem ficar escondido', () => {
  const onlineMenu = source('../src/components/caixa/online-menu/CashierOnlineMenu.tsx');
  assert.match(onlineMenu, /OnlineOrderCustomerBlocks/);
  assert.match(onlineMenu, /cardapio_bloqueios: 'bloqueios'/);
  assert.match(onlineMenu, /activeSection === 'bloqueios'/);
  assert.match(onlineMenu, /<OnlineOrderCustomerBlocks apiBaseUrl=\{apiBaseUrl\} authHeaders=\{authHeaders\} \/>/);
});

test('gestão de bloqueios usa apenas as rotas autenticadas canônicas', () => {
  const blocks = source('../src/components/caixa/online-menu/OnlineOrderCustomerBlocks.tsx');
  assert.match(blocks, /\/api\/online-orders\/blocks/);
  assert.match(blocks, /\/release/);
  assert.match(blocks, /method: 'POST'/);
  assert.match(blocks, /authHeaders/);
  assert.doesNotMatch(blocks, /localStorage|sessionStorage|phone_hash/i);
});

test('liberação exige confirmação e mantém mensagem pública de bloqueio fora do painel', () => {
  const blocks = source('../src/components/caixa/online-menu/OnlineOrderCustomerBlocks.tsx');
  assert.match(blocks, /window\.confirm/);
  assert.match(blocks, /Desbloquear/);
  assert.match(blocks, /Bloqueio removido pela operação no painel KÔMA/);
  assert.match(blocks, /Histórico de bloqueios/);
  assert.match(blocks, /statusLabel/);
  assert.doesNotMatch(blocks, /Não foi possível receber um novo pedido com estes dados neste momento/);
});
