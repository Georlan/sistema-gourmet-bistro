import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveryAreaError } from '../src/cardapio/deliveryArea';

const policy = {
  enabled: true,
  city: 'Limoeiro do Norte',
  state: 'CE',
  neighborhoods: ['Centro', 'Bairro de Fátima'],
};

const address = {
  logradouro: 'Rua A',
  numero: '10',
  complemento: '',
  bairro: 'Centro',
  cidade: 'Limoeiro do Norte',
  uf: 'CE',
  cep: '62930000',
  referencia: '',
};

test('área de entrega aceita cidade/bairro configurados e normaliza acentos', () => {
  assert.equal(deliveryAreaError(policy, address), null);
  assert.equal(deliveryAreaError(policy, { ...address, bairro: 'Bairro de Fatima' }), null);
});

test('restrição afeta somente a validação chamada para delivery e rejeita fora da área', () => {
  assert.match(deliveryAreaError(policy, { ...address, cidade: 'Magé', uf: 'RJ' }) || '', /fora da área de entrega/i);
  assert.match(deliveryAreaError(policy, { ...address, bairro: 'Zona Rural' }) || '', /fora da área de entrega/i);
  assert.equal(deliveryAreaError({ enabled: false }, { ...address, cidade: 'Magé', uf: 'RJ' }), null);
});
