import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeCustomerRegistrationTokenFromLocation,
} from '../src/components/auth/customerRegistrationToken';

test('consumes customer registration token from fragment and clears it immediately', () => {
  const calls: unknown[][] = [];
  const location = {
    pathname: '/confirmar-cadastro',
    hash: '#token=opaque-registration-secret&source=email',
  };
  const history = {
    replaceState: (...args: unknown[]) => { calls.push(args); },
  };

  assert.equal(
    consumeCustomerRegistrationTokenFromLocation(location, history),
    'opaque-registration-secret',
  );
  assert.deepEqual(calls, [[null, '', '/confirmar-cadastro']]);
});

test('does not consume registration fragments outside the confirmation route', () => {
  let cleared = false;
  const location = {
    pathname: '/cardapio',
    hash: '#token=opaque-registration-secret',
  };
  const history = {
    replaceState: () => { cleared = true; },
  };

  assert.equal(
    consumeCustomerRegistrationTokenFromLocation(location, history),
    '',
  );
  assert.equal(cleared, false);
});
