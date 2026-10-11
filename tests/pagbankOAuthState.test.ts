import assert from 'node:assert/strict';
import test from 'node:test';
import { forgetPagBankState, matchesPagBankState, rememberPagBankState } from '../src/utils/pagbankOAuthState';

function storage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] || null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); }, clear: () => data.clear() };
}

test('PagBank return in another tab keeps state binding and rejects unrelated callbacks', () => {
  const original = [Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')];
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage() });
    rememberPagBankState('initiated-state');
    sessionStorage.clear(); // Bank opens a new tab with no sessionStorage copy.
    assert.equal(matchesPagBankState('foreign-state'), false);
    forgetPagBankState('foreign-state');
    assert.equal(matchesPagBankState('initiated-state'), true);
    forgetPagBankState('initiated-state');
    assert.equal(matchesPagBankState('initiated-state'), false);
  } finally {
    ['localStorage', 'sessionStorage'].forEach((key, i) => original[i]
      ? Object.defineProperty(globalThis, key, original[i]!) : Reflect.deleteProperty(globalThis, key));
  }
});

test('PagBank binding expires and cleanup preserves another concurrent authorization', () => {
  const original = [Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')];
  const now = Date.now;
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage() });
    Date.now = () => 1_000_000;
    rememberPagBankState('first');
    Date.now = () => 1_000_000 + 9 * 60_000;
    rememberPagBankState('second');
    forgetPagBankState('first');
    assert.equal(matchesPagBankState('second'), true);
    Date.now = () => 1_000_000 + 20 * 60_000;
    assert.equal(matchesPagBankState('second'), false);
    assert.equal(localStorage.length, 0);
    assert.equal(sessionStorage.length, 0);
  } finally {
    Date.now = now;
    ['localStorage', 'sessionStorage'].forEach((key, i) => original[i]
      ? Object.defineProperty(globalThis, key, original[i]!) : Reflect.deleteProperty(globalThis, key));
  }
});
