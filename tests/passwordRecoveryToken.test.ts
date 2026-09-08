import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { consumeRecoveryTokenFromLocation } from '../src/components/auth/passwordRecoveryToken';

test('consumes reset token from fragment and removes it immediately', () => {
  const calls: unknown[][] = [];
  const location = { pathname: '/recuperar-senha', hash: '#token=secret-token&source=email' };
  const history = { replaceState: (...args: unknown[]) => { calls.push(args); } };

  assert.equal(consumeRecoveryTokenFromLocation(location as Location, history as History), 'secret-token');
  assert.deepEqual(calls, [[null, '', '/recuperar-senha']]);
});

test('does not consume fragments outside the password reset route', () => {
  let cleared = false;
  const location = { pathname: '/caixa', hash: '#token=secret-token' };
  const history = { replaceState: () => { cleared = true; } };

  assert.equal(consumeRecoveryTokenFromLocation(location as Location, history as History), '');
  assert.equal(cleared, false);
});

test('reset page handles same-document recovery links instead of relying on module import time', () => {
  const source = readFileSync('src/components/auth/PasswordResetPage.tsx', 'utf8');
  assert.match(source, /takeRecoveryToken\(\)/);
  assert.match(source, /addEventListener\('hashchange', captureToken\)/);
  assert.match(source, /setRecoveryToken\(''\)/);
  assert.doesNotMatch(source, /import\s*\{\s*recoveryToken\s*\}/);
});
