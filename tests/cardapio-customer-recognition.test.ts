import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  isCompleteBrazilianPhone,
  recognizePublicCustomer,
} from '../src/cardapio/customerRecognition.ts';


test('reconhecimento só consulta telefone brasileiro completo', () => {
  assert.equal(isCompleteBrazilianPhone('(85) 99999-1234'), true);
  assert.equal(isCompleteBrazilianPhone('(85) 3333-1234'), true);
  assert.equal(isCompleteBrazilianPhone('8599999'), false);
});


test('reconhecimento público envia apenas tenant e telefone normalizado', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown = null;
  try {
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ found: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const found = await recognizePublicCustomer(17, '(85) 99999-1234');
    assert.equal(found, true);
    assert.deepEqual(requestBody, {
      restaurante_id: 17,
      telefone: '85999991234',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('checkout mantém telefone antes do nome e sinaliza reconhecimento sem expor perfil', () => {
  const source = readFileSync(
    new URL('../src/cardapio/components/CardapioCartDrawer.tsx', import.meta.url),
    'utf8',
  );

  assert.ok(source.indexOf('id="input-guest-phone"') < source.indexOf('id="input-guest-name"'));
  assert.match(source, /recognizePublicCustomer/);
  assert.match(source, /Cliente reconhecido neste restaurante/);
  assert.doesNotMatch(source, /recognizedCustomerName|recognizedCustomerAddress|recognizedCustomerBalance/);
});
