import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  getOperatorSession,
  getPersistedOperationalPortal,
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

test('sessão canônica antiga de garçom corrige aliases gravados como Caixa', () => {
  localStorage.setItem('koma_operator_session', JSON.stringify({
    token: 'waiter-migrated-token',
    expiresAt: Date.now() + 60_000,
    user: {
      id: 'waiter-migrated',
      nome: 'Garçom Migrado',
      role: 'garcom',
      restaurante_id: 5,
    },
  }));
  localStorage.setItem('koma_caixa_token', 'waiter-migrated-token');
  localStorage.setItem('koma_caixa_id', 'waiter-migrated');
  localStorage.setItem('koma_caixa_role', 'garcom');

  const session = getOperatorSession();

  assert.equal(session?.user.role, 'garcom');
  assert.equal(localStorage.getItem('koma_caixa_token'), null);
  assert.equal(localStorage.getItem('koma_caixa_id'), null);
  assert.equal(localStorage.getItem('koma_waiter_token'), 'waiter-migrated-token');
  assert.equal(localStorage.getItem('koma_waiter_id'), 'waiter-migrated');
  assert.equal(getPersistedOperationalPortal(), 'garcom');
});
