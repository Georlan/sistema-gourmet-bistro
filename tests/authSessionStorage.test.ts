import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  clearOperatorSession,
  getOperatorSession,
  saveOperatorSession,
} from '../src/utils/authSession';

function createMockStorage() {
  const values: Record<string, string> = {};
  return {
    getItem: (key: string) => values[key] || null,
    setItem: (key: string, value: string) => {
      values[key] = String(value);
    },
    removeItem: (key: string) => {
      delete values[key];
    },
    clear: () => {
      Object.keys(values).forEach((key) => delete values[key]);
    },
  };
}

(globalThis as any).localStorage = createMockStorage();

beforeEach(() => {
  localStorage.clear();
});

test('saveOperatorSession persiste somente identidade operacional mínima', () => {
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

  const raw = localStorage.getItem('koma_operator_session') || '';
  const parsed = JSON.parse(raw);
  assert.deepEqual(parsed.user, {
    id: 'user-1',
    nome: 'Operador QA',
    role: 'caixa',
    cargo: 'caixa',
    restaurante_id: 1,
  });
  assert.doesNotMatch(raw, /nao-deve-persistir|85999999999|Rua privada|nunca-aqui/);
  assert.equal(localStorage.getItem('token'), null);
});

test('getOperatorSession sanitiza sessão legada com PII no primeiro acesso', () => {
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

  const migrated = localStorage.getItem('koma_operator_session') || '';
  assert.doesNotMatch(migrated, /legacy@example\.test|85111111111|Endereço antigo/);
});

test('sessão expirada é removida junto de todos os aliases operacionais', () => {
  localStorage.setItem('koma_operator_session', JSON.stringify({
    token: 'expired-token',
    expiresAt: Date.now() - 1,
    user: { id: 'expired-user', role: 'caixa' },
  }));
  localStorage.setItem('koma_caixa_token', 'expired-token');
  localStorage.setItem('koma_caixa_id', 'expired-user');
  localStorage.setItem('koma_waiter_token', 'stale-waiter-token');
  localStorage.setItem('koma_waiter_id', 'stale-waiter');

  assert.equal(getOperatorSession(), null);
  assert.equal(localStorage.getItem('koma_operator_session'), null);
  assert.equal(localStorage.getItem('koma_caixa_token'), null);
  assert.equal(localStorage.getItem('koma_caixa_id'), null);
  assert.equal(localStorage.getItem('koma_waiter_token'), null);
  assert.equal(localStorage.getItem('koma_waiter_id'), null);
});

test('clearOperatorSession remove credenciais de caixa e garçom sem tocar preferências', () => {
  localStorage.setItem('koma_operator_session', '{"token":"x"}');
  localStorage.setItem('koma_caixa_token', 'x');
  localStorage.setItem('koma_caixa_id', 'cashier-1');
  localStorage.setItem('koma_waiter_token', 'waiter-x');
  localStorage.setItem('koma_waiter_id', 'waiter-1');
  localStorage.setItem('koma_waiter_name', 'Garçom QA');
  localStorage.setItem('koma_user_role', 'garcom');
  localStorage.setItem('koma_settings_vFinal_v3', '{"tema":"claro"}');

  clearOperatorSession();

  for (const key of [
    'koma_operator_session',
    'koma_caixa_token',
    'koma_caixa_id',
    'koma_waiter_token',
    'koma_waiter_id',
    'koma_waiter_name',
    'koma_user_role',
  ]) {
    assert.equal(localStorage.getItem(key), null);
  }
  assert.ok(localStorage.getItem('koma_settings_vFinal_v3'));
});
