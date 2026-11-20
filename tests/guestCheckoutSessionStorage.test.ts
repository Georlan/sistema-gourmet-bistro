import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    address: '',
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
  assert.equal(loaded?.address, '');
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

test('cart drawer no longer reads or writes guest PII through localStorage directly', () => {
  const source = readFileSync('src/cardapio/components/CardapioCartDrawer.tsx', 'utf8');
  assert.match(source, /loadGuestCheckoutContact/);
  assert.match(source, /saveGuestCheckoutContact/);
  assert.doesNotMatch(source, /localStorage\./);
  assert.doesNotMatch(source, /koma_guest_checkout/);
});


test('guest checkout never restores a previous delivery address', async () => {
  const { sessionStorage } = installStorage();
  const { loadGuestCheckoutContact } = await import('../src/cardapio/guestCheckoutSession');
  const key = 'koma_guest_checkout:12';

  sessionStorage.setItem(key, JSON.stringify({
    name: 'Cliente recorrente',
    phone: '85999990000',
    email: '',
    address: 'Avenida Antiga, 999',
  }));

  const loaded = loadGuestCheckoutContact(12);
  assert.equal(loaded?.address, '');
});


test('retired 90-day data is purged rather than used for guest checkout', async () => {
  const { localStorage, sessionStorage } = installStorage();
  const { loadGuestCheckoutContact } = await import('../src/cardapio/guestCheckoutSession');
  localStorage.setItem('koma_remembered_contact:7', JSON.stringify({
    version: 1, expiresAt: Date.now() + 86400000,
    contact: { name: 'Ana', phone: '85999991111' },
  }));
  assert.equal(loadGuestCheckoutContact(7), null);
  assert.equal(localStorage.getItem('koma_remembered_contact:7'), null);
  assert.equal(sessionStorage.getItem('koma_guest_checkout:7'), null);
});

test('visitor contact remains within its tab and restaurant', async () => {
  const { sessionStorage, localStorage } = installStorage();
  const { saveGuestCheckoutContact, loadGuestCheckoutContact, clearGuestCheckoutContact } = await import('../src/cardapio/guestCheckoutSession');
  const contact = { name: 'Ana', phone: '85999991111', email: '', address: '' };
  saveGuestCheckoutContact(7, contact);
  assert.deepEqual(loadGuestCheckoutContact(7), contact);
  assert.equal(loadGuestCheckoutContact(8), null);
  assert.equal(localStorage.getItem('koma_remembered_contact:7'), null);
  sessionStorage.clear();
  assert.equal(loadGuestCheckoutContact(7), null);
  saveGuestCheckoutContact(7, contact);
  clearGuestCheckoutContact(7);
  assert.equal(loadGuestCheckoutContact(7), null);
});

test('blocked browser storage never crashes auth prefill', async () => {
  const blocked = { getItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: blocked });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: blocked });
  const { loadGuestCheckoutContact } = await import('../src/cardapio/guestCheckoutSession');
  assert.equal(loadGuestCheckoutContact(7), null);
});
