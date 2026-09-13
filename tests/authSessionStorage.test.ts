import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test, { beforeEach } from 'node:test';

import {
  clearOperatorSession,
  getOperatorAccessToken,
  getOperatorSession,
  getPersistedOperationalPortal,
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

function fakeJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'qa-user', exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.signature`;
}

(globalThis as any).localStorage = createMockStorage();
(globalThis as any).sessionStorage = createMockStorage();

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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
  assert.equal(localStorage.getItem('koma_caixa_token'), 'test-access-token');
  assert.equal(localStorage.getItem('koma_waiter_token'), null);
  assert.equal(sessionStorage.getItem('koma_active_operational_portal'), 'caixa');
  assert.equal(getPersistedOperationalPortal(), 'caixa');
});

test('sessão canônica de garçom usa apenas aliases de garçom', () => {
  saveOperatorSession('waiter-access-token', {
    id: 'waiter-1',
    nome: 'Garçom QA',
    role: 'garcom',
    restaurante_id: 3,
  });

  assert.equal(localStorage.getItem('koma_waiter_token'), 'waiter-access-token');
  assert.equal(localStorage.getItem('koma_waiter_id'), 'waiter-1');
  assert.equal(localStorage.getItem('koma_waiter_name'), 'Garçom QA');
  assert.equal(localStorage.getItem('koma_user_role'), 'garcom');
  assert.equal(localStorage.getItem('koma_caixa_token'), null);
  assert.equal(sessionStorage.getItem('koma_active_operational_portal'), 'garcom');
  assert.equal(getPersistedOperationalPortal(), 'garcom');
});

test('caixa e garçom coexistem em abas diferentes e logout de uma não derruba a outra', () => {
  saveOperatorSession('waiter-tab-token', {
    id: 'waiter-tab',
    nome: 'Garçom Aba',
    role: 'garcom',
    restaurante_id: 3,
  });

  assert.equal(localStorage.getItem('koma_waiter_token'), 'waiter-tab-token');
  assert.equal(localStorage.getItem('koma_operator_session_garcom') != null, true);

  // Simula outra aba do mesmo navegador: localStorage é compartilhado,
  // sessionStorage é independente.
  sessionStorage.clear();
  saveOperatorSession('cashier-tab-token', {
    id: 'cashier-tab',
    nome: 'Caixa Aba',
    role: 'caixa',
    restaurante_id: 3,
  });

  assert.equal(localStorage.getItem('koma_waiter_token'), 'waiter-tab-token');
  assert.equal(localStorage.getItem('koma_caixa_token'), 'cashier-tab-token');
  assert.equal(localStorage.getItem('koma_operator_session_garcom') != null, true);
  assert.equal(localStorage.getItem('koma_operator_session_caixa') != null, true);
  assert.equal(getPersistedOperationalPortal(), 'caixa');

  clearOperatorSession();

  assert.equal(localStorage.getItem('koma_caixa_token'), null);
  assert.equal(localStorage.getItem('koma_operator_session_caixa'), null);
  assert.equal(localStorage.getItem('koma_waiter_token'), 'waiter-tab-token');
  assert.ok(localStorage.getItem('koma_operator_session_garcom'));
  assert.equal(getPersistedOperationalPortal(), null);

  // Volta para a aba original do Garçom.
  sessionStorage.clear();
  sessionStorage.setItem('koma_active_operational_portal', 'garcom');
  assert.equal(getPersistedOperationalPortal(), 'garcom');
  assert.equal(getOperatorAccessToken(), 'waiter-tab-token');
});

test('reload restaura garçom enquanto o JWT ainda estiver válido, mesmo após a antiga janela local', () => {
  const expSeconds = Math.floor(Date.now() / 1000) + (10 * 24 * 60 * 60);
  const token = fakeJwt(expSeconds);

  localStorage.setItem('koma_operator_session', JSON.stringify({
    token,
    expiresAt: Date.now() - 1,
    user: {
      id: 'waiter-jwt',
      nome: 'Garçom JWT',
      role: 'garcom',
      restaurante_id: 3,
    },
  }));
  localStorage.setItem('koma_waiter_token', token);
  localStorage.setItem('koma_waiter_id', 'waiter-jwt');
  localStorage.setItem('koma_waiter_name', 'Garçom JWT');
  localStorage.setItem('koma_user_role', 'garcom');

  const session = getOperatorSession();

  assert.ok(session);
  assert.equal(session?.expiresAt, expSeconds * 1000);
  assert.equal(getPersistedOperationalPortal(), 'garcom');
  assert.equal(JSON.parse(localStorage.getItem('koma_operator_session_garcom') || '{}').expiresAt, expSeconds * 1000);
});

test('logout de garçom não ressuscita alias a partir da sessão canônica', () => {
  saveOperatorSession('waiter-access-token', {
    id: 'waiter-1',
    nome: 'Garçom QA',
    role: 'garcom',
    restaurante_id: 3,
  });

  localStorage.removeItem('koma_waiter_token');
  localStorage.removeItem('koma_waiter_id');
  localStorage.removeItem('koma_waiter_name');
  localStorage.removeItem('koma_user_role');

  assert.equal(getOperatorAccessToken(), '');
  assert.equal(getPersistedOperationalPortal(), null);
  assert.equal(localStorage.getItem('koma_waiter_token'), null);
  assert.ok(localStorage.getItem('koma_operator_session_garcom'));
});

test('token legado isolado de garçom não escolhe sozinho a entrada canônica', () => {
  localStorage.setItem('koma_waiter_token', 'legacy-waiter-token');
  localStorage.setItem('koma_waiter_id', 'legacy-waiter');
  localStorage.setItem('koma_user_role', 'garcom');

  assert.equal(getPersistedOperationalPortal(), null);
  assert.equal(localStorage.getItem('koma_waiter_token'), 'legacy-waiter-token');
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
  localStorage.setItem('koma_caixa_token', 'legacy-access-token');

  const session = getOperatorSession();
  assert.equal(session?.user.id, 'legacy-user');
  assert.equal(session?.user.role, 'gerente');

  const migrated = localStorage.getItem('koma_operator_session_caixa') || '';
  assert.doesNotMatch(migrated, /legacy@example\.test|85111111111|Endereço antigo/);
});

test('sessão expirada remove somente aliases do portal expirado', () => {
  localStorage.setItem('koma_operator_session', JSON.stringify({
    token: 'expired-token',
    expiresAt: Date.now() - 1,
    user: { id: 'expired-user', role: 'caixa' },
  }));
  localStorage.setItem('koma_caixa_token', 'expired-token');
  localStorage.setItem('koma_caixa_id', 'expired-user');
  localStorage.setItem('koma_waiter_token', 'live-waiter-token');
  localStorage.setItem('koma_waiter_id', 'live-waiter');

  assert.equal(getOperatorSession(), null);
  assert.equal(localStorage.getItem('koma_operator_session'), null);
  assert.equal(localStorage.getItem('koma_caixa_token'), null);
  assert.equal(localStorage.getItem('koma_caixa_id'), null);
  assert.equal(localStorage.getItem('koma_waiter_token'), 'live-waiter-token');
  assert.equal(localStorage.getItem('koma_waiter_id'), 'live-waiter');
});

test('clearOperatorSession sem contexto limpa credenciais globais sem tocar preferências', () => {
  localStorage.setItem('koma_operator_session', '{"token":"x"}');
  localStorage.setItem('koma_operator_session_caixa', '{"token":"x"}');
  localStorage.setItem('koma_operator_session_garcom', '{"token":"waiter-x"}');
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
    'koma_operator_session_caixa',
    'koma_operator_session_garcom',
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
