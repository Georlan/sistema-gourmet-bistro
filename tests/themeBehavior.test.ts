import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_KOMA_THEME,
  KOMA_THEME_CHANGED_EVENT,
  KOMA_THEME_STORAGE_KEY,
  applyKomaTheme,
  nextKomaTheme,
  persistKomaTheme,
  readKomaTheme,
} from '../src/config/theme';

test('theme reader accepts only canonical values and otherwise falls back safely', () => {
  const storage = (value: string | null) => ({
    getItem: (key: string) => key === KOMA_THEME_STORAGE_KEY ? value : null,
  });

  assert.equal(readKomaTheme(storage('light')), 'light');
  assert.equal(readKomaTheme(storage('dark')), 'dark');
  assert.equal(readKomaTheme(storage('sepia')), DEFAULT_KOMA_THEME);
  assert.equal(readKomaTheme(storage(null)), DEFAULT_KOMA_THEME);
});

test('theme application writes the canonical data attribute', () => {
  const attributes = new Map<string, string>();
  const root = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  } as unknown as HTMLElement;

  assert.equal(applyKomaTheme('light', root), 'light');
  assert.equal(attributes.get('data-koma-theme'), 'light');
});

test('persisting a theme stores, applies and broadcasts the shared change event', () => {
  const writes: Array<[string, string]> = [];
  const attributes = new Map<string, string>();
  const events: string[] = [];
  const previousDocument = (globalThis as any).document;
  const previousWindow = (globalThis as any).window;

  (globalThis as any).document = {
    documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    },
  };
  (globalThis as any).window = {
    dispatchEvent: (event: Event) => {
      events.push(event.type);
      return true;
    },
  };

  try {
    const result = persistKomaTheme('light', {
      setItem: (key: string, value: string) => writes.push([key, value]),
    });

    assert.equal(result, 'light');
    assert.deepEqual(writes, [[KOMA_THEME_STORAGE_KEY, 'light']]);
    assert.equal(attributes.get('data-koma-theme'), 'light');
    assert.deepEqual(events, [KOMA_THEME_CHANGED_EVENT]);
  } finally {
    if (previousDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = previousDocument;
    if (previousWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previousWindow;
  }
});

test('theme toggle remains a two-state operation', () => {
  assert.equal(nextKomaTheme('dark'), 'light');
  assert.equal(nextKomaTheme('light'), 'dark');
});
