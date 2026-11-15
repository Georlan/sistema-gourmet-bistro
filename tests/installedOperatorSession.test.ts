import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isInstalledOperationalApp } from '../src/utils/installedOperatorSession';

const installed = readFileSync('src/utils/installedOperatorSession.ts', 'utf8');
const auth = readFileSync('src/utils/authSession.ts', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');
const entry = readFileSync('src/components/auth/UnifiedOperationalEntry.tsx', 'utf8');

function inWindow(hostname: string, standalone: boolean, fn: () => void): void {
  const original = (globalThis as any).window;
  (globalThis as any).window = {
    location: { hostname },
    navigator: { standalone: false },
    matchMedia: () => ({ matches: standalone }),
  };
  try {
    fn();
  } finally {
    (globalThis as any).window = original;
  }
}

test('persistent credentials are restricted to installed operational app, not browser tabs or public menu', () => {
  inWindow('app.komafood.com.br', true, () => assert.equal(isInstalledOperationalApp(), true));
  inWindow('app.komafood.com.br', false, () => assert.equal(isInstalledOperationalApp(), false));
  inWindow('restaurante-a.komafood.com.br', true, () => assert.equal(isInstalledOperationalApp(), false));
  inWindow('komafood.com.br', true, () => assert.equal(isInstalledOperationalApp(), false));
});

test('PWA persistence encrypts JWT with nonexportable AES-GCM key, never localStorage', () => {
  assert.match(installed, /indexedDB\.open\(DB_NAME, 1\)/);
  assert.match(installed, /crypto\.subtle\.generateKey\(\{ name: 'AES-GCM', length: 256 \}, false/);
  assert.match(installed, /crypto\.subtle\.encrypt/);
  assert.match(installed, /crypto\.subtle\.decrypt/);
  assert.match(installed, /payload\?\.restaurante_id !== session\.user\.restaurante_id/);
  assert.match(installed, /String\(payload\?\.sub \|\| ''\) !== String\(session\.user\.id \|\| ''\)/);
  // localStorage guarda apenas o marcador de saída, nunca a credencial.
  assert.match(installed, /localStorage\.setItem\(SIGNED_OUT_KEY, '1'\)/);
  assert.doesNotMatch(installed, /localStorage\.setItem\([^,]+,\s*(?:session\.token|token|session)\b/);
  assert.match(installed, /sessionStorage\.getItem\('koma_operational_logged_out'\)/);
});

test('installed session is saved at login and store switch, removed on explicit logout', () => {
  assert.match(auth, /void rememberInstalledOperatorSession\(session\)/);
  assert.match(auth, /if \(notify\) \{[\s\S]*void forgetInstalledOperatorSession\(\)/);
  assert.match(auth, /sessionStorage/);
  assert.match(entry, /saveOperatorSession\(token, user\);[\s\S]*await waitForInstalledOperatorSessionWrite\(\)/);
  assert.match(main, /await initializeTabSessionOwnership\(\)/);
  assert.match(main, /const restored = await loadInstalledOperatorSession\(\)/);
  assert.match(main, /saveOperatorSession\(restored\.token, restored\.user\)/);
  assert.doesNotMatch(main, /await loadInstalledOperatorSession\(\);\s*const isPublicMenuEntry/);
});
