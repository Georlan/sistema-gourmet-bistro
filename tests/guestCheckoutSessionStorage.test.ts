import assert from 'node:assert/strict';
import test from 'node:test';

const makeStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
    removeItem(key: string) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
};

const installStorage = () => {
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: sessionStorage });
  return { localStorage, sessionStorage };
};

test('guest checkout contact is saved only in sessionStorage', async () => {
  const { localStorage, sessionStorage } = installStorage();
  const { saveGuestCheckoutContact } = await import('../src/cardapio/guestCheckoutSession');

  saveGuestCheckoutContact(7, {
    name: 'Cliente QA',
    phone: '(85) 99999-1111',
    email: 'QA@EXAMPLE.COM ',
    address: 'Rua QA, 123',
  });

  const key = 'koma_guest_checkout:7';
  assert.equal(localStorage.getItem(key), null);
  assert.deepEqual(JSON.parse(sessionStorage.getItem(key) || '{}'), {
    name: 'Cliente QA',
    phone: '85999991111',
    email: 'qa@example.com',
    address: 'Rua QA, 123',
  });
});

test('legacy localStorage guest checkout contact migrates once and is erased durably', async () => {
  const { localStorage, sessionStorage } = installStorage();
  const { loadGuestCheckoutContact } = await import('../src/cardapio/guestCheckoutSession');
  const key = 'koma_guest_checkout:11';

  localStorage.setItem(key, JSON.stringify({
    name: 'Antigo',
    phone: '85988887777',
    email: 'antigo@example.com',
    address: 'Rua Antiga',
  }));

  const loaded = loadGuestCheckoutContact(11);
  assert.equal(localStorage.getItem(key), null);
  assert.equal(sessionStorage.getItem(key) !== null, true);
  assert.equal(loaded?.phone, '85988887777');
});

test('clearing guest checkout contact erases both current and legacy storage', async () => {
  const { localStorage, sessionStorage } = installStorage();
  const { clearGuestCheckoutContact } = await import('../src/cardapio/guestCheckoutSession');
  const key = 'koma_guest_checkout:5';

  localStorage.setItem(key, 'legacy');
  sessionStorage.setItem(key, 'current');
  clearGuestCheckoutContact(5);

  assert.equal(localStorage.getItem(key), null);
  assert.equal(sessionStorage.getItem(key), null);
});
