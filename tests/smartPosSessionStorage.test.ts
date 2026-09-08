import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  SMARTPOS_SESSION_KEY,
  clearSmartPosSession,
  getSmartPosSession,
  saveSmartPosSession,
} from '../src/smartpos/smartPosSession';

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

const user = {
  id: 'smartpos-user',
  nome: 'Operador SmartPOS',
  role: 'caixa' as const,
  restaurante_id: 1,
};

test('nova sessão SmartPOS mantém bearer somente em sessionStorage', () => {
  saveSmartPosSession('smartpos-secret', user);

  assert.match(sessionStorage.getItem(SMARTPOS_SESSION_KEY) || '', /smartpos-secret/);
  assert.equal(localStorage.getItem(SMARTPOS_SESSION_KEY), null);
  assert.equal(getSmartPosSession()?.token, 'smartpos-secret');
});

test('sessão SmartPOS antiga é migrada e removida do localStorage', () => {
  localStorage.setItem(SMARTPOS_SESSION_KEY, JSON.stringify({
    token: 'legacy-smartpos-secret',
    user,
    expiresAt: Date.now() + 60_000,
  }));

  assert.equal(getSmartPosSession()?.token, 'legacy-smartpos-secret');
  assert.equal(localStorage.getItem(SMARTPOS_SESSION_KEY), null);
  assert.match(sessionStorage.getItem(SMARTPOS_SESSION_KEY) || '', /legacy-smartpos-secret/);
});

test('sessão inválida ou expirada é removida dos dois storages', () => {
  localStorage.setItem(SMARTPOS_SESSION_KEY, JSON.stringify({
    token: 'expired-secret',
    user,
    expiresAt: Date.now() - 1,
  }));
  sessionStorage.setItem(SMARTPOS_SESSION_KEY, JSON.stringify({
    token: 'expired-secret',
    user,
    expiresAt: Date.now() - 1,
  }));

  assert.equal(getSmartPosSession(), null);
  assert.equal(localStorage.getItem(SMARTPOS_SESSION_KEY), null);
  assert.equal(sessionStorage.getItem(SMARTPOS_SESSION_KEY), null);
});

test('clearSmartPosSession remove ambas as formas por compatibilidade', () => {
  localStorage.setItem(SMARTPOS_SESSION_KEY, 'legacy');
  sessionStorage.setItem(SMARTPOS_SESSION_KEY, 'scoped');

  clearSmartPosSession();

  assert.equal(localStorage.getItem(SMARTPOS_SESSION_KEY), null);
  assert.equal(sessionStorage.getItem(SMARTPOS_SESSION_KEY), null);
});
