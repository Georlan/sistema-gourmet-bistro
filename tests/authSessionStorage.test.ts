import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  clearOperatorSession,
  clearWaiterSession,
  getOperationalAccessToken,
  getOperatorSession,
  saveOperatorSession,
  saveWaiterSession,
} from '../src/utils/authSession';

function createMockStorage() {
  const values: Record<string, string> = {};
  return {
    getItem: (key: string) => values[key] || null,
    setItem: (key: string, value: string) => { values[key] = String(value); },
    removeItem: (key: string) => { delete values[key]; },
    clear: () => { Object.keys(values).forEach((key) => delete values[key]); },
  };
}

(globalThis as any).localStorage = createMockStorage();
(globalThis as any).sessionStorage = createMockStorage();

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test('saveOperatorSession persiste bearer e identidade mínima somente na sessão da aba', () => {
  saveOperatorSession('test-access-token', {
    id: 'user-1',
    nome: 'Operador QA',
    role: 'caixa',
    cargo: 'caixa',
    restaurante_id: 1,
    email: 'nao-deve-persistir@example.test',
    telefone: '85999999999',
    endereco: 'Rua privada',
    password_hash: 'nunca-aqui',
  });

  const raw = sessionStorage.getItem('koma_operator_session') || '';
  const parsed = JSON.parse(raw);
  assert.deepEqual(parsed.user, {
    id: 'user-1',
    nome: 'Operador QA',
    role: 'caixa',
    cargo: 'caixa',
    restaurante_id: 1,
  });
  assert.equal(parsed.token, 'test-access-token');
  assert.doesNotMatch(raw, /nao-deve-persistir|85999999999|Rua privada|nunca-aqui/);
  assert.equal(localStorage.getItem('koma_operator_session'), null);
  assert.equal(localStorage.getItem('koma_caixa_token'), null);
  assert.equal(localStorage.getItem('token'), null);
});

test('getOperatorSession migra sessão legada com PII para sessionStorage e apaga a cópia durável', () => {
  localStorage.setItem('koma_operator_session', JSON.stringify({
    token: 'legacy-access-token',
    expiresAt: Date.now() + 60_000,
    user: {
      id: 'legacy-user',
      nome: 'Legado',
      role: 'gerente',
      restaurante_id: 2,
      email: 'legacy@example.test',
      telefone: '85111111111',
      endereco: 'Endereço antigo',
    },
  }));

  const session = getOperatorSession();
  assert.equal(session?.user.id, 'legacy-user');
  assert.equal(session?.user.role, 'gerente');
  assert.equal(localStorage.getItem('koma_operator_session'), null);

  const migrated = sessionStorage.getItem('koma_operator_session') || '';
  assert.doesNotMatch(migrated, /legacy@example\.test|85111111111|Endereço antigo/);
});

test('alias legado do caixa é migrado uma vez e nunca permanece no localStorage', () => {
  localStorage.setItem('koma_caixa_token', 'legacy-caixa-token');
  localStorage.setItem('koma_caixa_id', 'cashier-1');
  localStorage.setItem('koma_caixa_name', 'Caixa Antigo');
  localStorage.setItem('koma_caixa_role', 'caixa');

  assert.equal(getOperationalAccessToken('caixa'), 'legacy-caixa-token');
  assert.equal(localStorage.getItem('koma_caixa_token'), null);
  assert.equal(sessionStorage.getItem('koma_caixa_token'), 'legacy-caixa-token');
  assert.equal(getOperatorSession()?.user.id, 'cashier-1');
});

test('garçom usa sessão da aba e migra aliases duráveis antigos', () => {
  saveWaiterSession('waiter-token', { id: 'w-1', nome: 'Garçom QA', role: 'garcom' });
  assert.equal(getOperationalAccessToken('garcom'), 'waiter-token');
  assert.equal(sessionStorage.getItem('koma_waiter_token'), 'waiter-token');
  assert.equal(localStorage.getItem('koma_waiter_token'), null);

  clearWaiterSession();
  assert.equal(sessionStorage.getItem('koma_waiter_token'), null);
});

test('sessão expirada é removida dos storages e aliases operacionais', () => {
  sessionStorage.setItem('koma_operator_session', JSON.stringify({
    token: 'expired-token',
    expiresAt: Date.now() - 1,
    user: { id: 'expired-user', role: 'caixa' },
  }));
  sessionStorage.setItem('koma_caixa_token', 'expired-token');
  localStorage.setItem('koma_caixa_id', 'expired-user');

  assert.equal(getOperatorSession(), null);
  assert.equal(sessionStorage.getItem('koma_operator_session'), null);
  assert.equal(sessionStorage.getItem('koma_caixa_token'), null);
  assert.equal(localStorage.getItem('koma_caixa_id'), null);
});

test('clearOperatorSession remove snapshots e aliases sem tocar preferências duráveis', () => {
  sessionStorage.setItem('koma_operator_session', '{"token":"x"}');
  sessionStorage.setItem('koma_caixa_token', 'x');
  localStorage.setItem('koma_settings_vFinal_v3', '{"tema":"claro"}');

  clearOperatorSession();

  assert.equal(sessionStorage.getItem('koma_operator_session'), null);
  assert.equal(sessionStorage.getItem('koma_caixa_token'), null);
  assert.ok(localStorage.getItem('koma_settings_vFinal_v3'));
});
