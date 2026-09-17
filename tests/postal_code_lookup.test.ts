import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePostalCode,
  ViaCepPostalCodeLookupProvider,
} from '../src/integrations/postalCode/postalCodeLookup';

const response = (status: number, payload: unknown) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

test('normaliza CEP com ou sem máscara e rejeita tamanho inválido sem consultar', async () => {
  let calls = 0;
  const provider = new ViaCepPostalCodeLookupProvider(async () => {
    calls += 1;
    return response(200, {});
  });
  assert.equal(normalizePostalCode(' 60000-000 '), '60000000');
  assert.equal(await provider.lookup('6000A'), null);
  assert.equal(calls, 0);
});

test('mapeia resposta válida sem criar coordenadas ou dados privados', async () => {
  const provider = new ViaCepPostalCodeLookupProvider(async () => response(200, {
    cep: '60000-000',
    logradouro: '  Rua   Central ',
    bairro: ' Centro ',
    localidade: 'Fortaleza',
    uf: 'ce',
  }));
  assert.deepEqual(await provider.lookup('60000000'), {
    postalCode: '60000000',
    street: 'Rua Central',
    neighborhood: 'Centro',
    city: 'Fortaleza',
    state: 'CE',
  });
});

test('falha segura para HTTP, CEP desconhecido, resposta incompleta e CEP divergente', async () => {
  for (const [status, payload] of [
    [404, {}],
    [429, {}],
    [500, {}],
    [200, { erro: true }],
    [200, { cep: '60000-000', localidade: '', uf: 'CE' }],
    [200, { cep: '60165-121', localidade: 'Fortaleza', uf: 'CE' }],
  ] as const) {
    const provider = new ViaCepPostalCodeLookupProvider(async () => response(status, payload));
    assert.equal(await provider.lookup('60000000'), null);
  }
});

test('propaga timeout/erro de rede para a UI aplicar fallback manual', async () => {
  const provider = new ViaCepPostalCodeLookupProvider(async () => {
    throw new TypeError('offline');
  });
  await assert.rejects(provider.lookup('60000000'), /offline/);
});

test('aborta consulta lenta no prazo configurado', async () => {
  const provider = new ViaCepPostalCodeLookupProvider((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
  }), 5);
  await assert.rejects(provider.lookup('60000000'), /timeout/);
});
