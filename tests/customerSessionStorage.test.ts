import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  clearCustomerSession,
  loadCustomerSession,
  saveCustomerSession,
  type CustomerSession,
} from '../src/cardapio/customerSession';

function createStorage() {
  const values: Record<string, string> = {};
  return {
    api: {
      getItem: (key: string) => values[key] ?? null,
      setItem: (key: string, value: string) => { values[key] = String(value); },
      removeItem: (key: string) => { delete values[key]; },
      clear: () => { Object.keys(values).forEach((key) => delete values[key]); },
    },
  };
}

const local = createStorage();
const session = createStorage();
(globalThis as any).localStorage = local.api;
(globalThis as any).sessionStorage = session.api;

const customerSession: CustomerSession = {
  token: 'customer-secret-token',
  profile: {
    id: 'customer-1',
    name: 'Cliente Privado',
    phone: '11999999999',
    email: 'private@example.test',
    address: 'Rua Privada, 123',
    points: 10,
    cashback: 4,
  },
};

beforeEach(() => {
  local.api.clear();
  session.api.clear();
});

test('new customer sessions are tab-scoped and never written to localStorage', () => {
  saveCustomerSession(1, customerSession);
  assert.equal(local.api.getItem('koma_customer_session:1'), null);
  assert.match(session.api.getItem('koma_customer_session:1') || '', /customer-secret-token/);
  assert.equal(loadCustomerSession(1)?.profile.email, 'private@example.test');
});

test('legacy localStorage session migrates once and is deleted from durable storage', () => {
  local.api.setItem('koma_customer_session:1', JSON.stringify(customerSession));
  const loaded = loadCustomerSession(1);
  assert.equal(loaded?.token, 'customer-secret-token');
  assert.equal(local.api.getItem('koma_customer_session:1'), null);
  assert.match(session.api.getItem('koma_customer_session:1') || '', /Cliente Privado/);
});

test('clear removes both current and legacy copies', () => {
  session.api.setItem('koma_customer_session:1', JSON.stringify(customerSession));
  local.api.setItem('koma_customer_session:1', JSON.stringify(customerSession));
  clearCustomerSession(1);
  assert.equal(session.api.getItem('koma_customer_session:1'), null);
  assert.equal(local.api.getItem('koma_customer_session:1'), null);
});
