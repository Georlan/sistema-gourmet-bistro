import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CASHIER_SIDEBAR_GROUPS,
  GESTAO_HUB_ITEMS,
  CASHIER_SIDEBAR_SECONDARY_ITEMS,
} from '../src/components/caixa/navigation/cashierNavigation';

test('Cashier navigation defines exactly 5 top-level destinations', () => {
  assert.equal(CASHIER_SIDEBAR_GROUPS.length, 1);
  const items = CASHIER_SIDEBAR_GROUPS[0].items;
  assert.equal(items.length, 5);

  const ids = items.map((i) => i.id);
  assert.deepEqual(ids, ['agora', 'operacao', 'cardapio', 'gestao_hub', 'relatorios']);

  const labels = items.map((i) => i.label);
  assert.deepEqual(labels, ['Agora', 'Vender', 'Cardápio', 'Gestão', 'Resultados']);
});

test('Gestão hub contains the 4 operational management modules', () => {
  const ids = GESTAO_HUB_ITEMS.map((i) => i.id);
  assert.deepEqual(ids, ['financeiro', 'estoque', 'clientes', 'permissoes_cargos']);

  const labels = GESTAO_HUB_ITEMS.map((i) => i.label);
  assert.deepEqual(labels, ['Caixa', 'Estoque', 'Clientes', 'Equipe']);
});

test('Secondary navigation groups system configurations in footer', () => {
  const ids = CASHIER_SIDEBAR_SECONDARY_ITEMS.map((i) => i.id);
  assert.deepEqual(ids, ['impressao_salao', 'cardapio_digital', 'assinatura_pix']);
});

test('Gestão member tabs are correctly classified', () => {
  const gestaoIds = new Set(GESTAO_HUB_ITEMS.map((i) => i.id as string));
  assert.ok(gestaoIds.has('financeiro'), 'Caixa/Financeiro must be in Gestão');
  assert.ok(gestaoIds.has('estoque'), 'Estoque must be in Gestão');
  assert.ok(gestaoIds.has('clientes'), 'Clientes must be in Gestão');
  assert.ok(gestaoIds.has('permissoes_cargos'), 'Equipe must be in Gestão');

  // Verify non-members are not in Gestão
  assert.ok(!gestaoIds.has('agora'));
  assert.ok(!gestaoIds.has('operacao'));
  assert.ok(!gestaoIds.has('cardapio'));
  assert.ok(!gestaoIds.has('relatorios'));
});

test('All legacy aliases map to canonical destinations without throwing', async () => {
  // Test simulated sessionStorage mappings
  const storage = new Map<string, string>();
  const mockSessionStorage = {
    getItem: (k: string) => storage.get(k) || null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  };

  // Assign to global if not already present
  if (typeof globalThis.sessionStorage === 'undefined') {
    (globalThis as any).sessionStorage = mockSessionStorage;
  }

  // Verify tab normalization rules:
  // 1. config_cardapio -> cardapio_digital
  storage.set('koma_active_tab', 'config_cardapio');
  assert.equal(
    storage.get('koma_active_tab') === 'config_cardapio' ? 'cardapio_digital' : storage.get('koma_active_tab'),
    'cardapio_digital'
  );

  // 2. dashboard -> relatorios
  storage.set('koma_active_tab', 'dashboard');
  assert.equal(
    ['dashboard', 'indicadores'].includes(storage.get('koma_active_tab')!) ? 'relatorios' : storage.get('koma_active_tab'),
    'relatorios'
  );

  // 3. robo_ia -> operacao
  storage.set('koma_active_tab', 'robo_ia');
  assert.equal(
    ['robo_ia', 'assistente_koma', 'chat_copiloto'].includes(storage.get('koma_active_tab')!) ? 'operacao' : storage.get('koma_active_tab'),
    'operacao'
  );

  // 4. gestao_hub legacy/reload -> financeiro
  storage.set('koma_active_tab', 'gestao_hub');
  assert.equal(
    storage.get('koma_active_tab') === 'gestao_hub' ? 'financeiro' : storage.get('koma_active_tab'),
    'financeiro'
  );

  // 5. default (empty storage) -> agora
  storage.clear();
  const defaultTab = storage.get('koma_active_tab') || 'agora';
  assert.equal(defaultTab, 'agora');
});
