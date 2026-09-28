import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  consumeCustomerRegistrationTokenFromLocation,
} from '../src/components/auth/customerRegistrationToken';

test('consumes customer registration token from fragment and removes it immediately', () => {
  const calls: unknown[][] = [];
  const location = {
    pathname: '/confirmar-cadastro',
    hash: '#token=71.opaque-registration-secret&source=email',
  };
  const history = {
    replaceState: (...args: unknown[]) => { calls.push(args); },
  };

  assert.equal(
    consumeCustomerRegistrationTokenFromLocation(location, history),
    '71.opaque-registration-secret',
  );
  assert.deepEqual(calls, [[null, '', '/confirmar-cadastro']]);
});

test('does not consume registration fragments outside confirmation route', () => {
  let cleared = false;
  const location = {
    pathname: '/cardapio',
    hash: '#token=71.opaque-registration-secret',
  };
  const history = { replaceState: () => { cleared = true; } };

  assert.equal(
    consumeCustomerRegistrationTokenFromLocation(location, history),
    '',
  );
  assert.equal(cleared, false);
});

test('customer signup no longer depends on WhatsApp OTP in the normal path', () => {
  const source = readFileSync('src/cardapio/components/CardapioAuthModal.tsx', 'utf8');
  assert.match(source, /\/cardapio\/clientes\/cadastro\/solicitar/);
  assert.match(source, /Enviamos um link de confirmação/);
  assert.doesNotMatch(source, /\/cardapio\/clientes\/otp\/solicitar/);
  assert.doesNotMatch(source, /Enviar código pelo WhatsApp/);
});
