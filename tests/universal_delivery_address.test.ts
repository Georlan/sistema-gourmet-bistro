import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryAddressDraftToSnapshot,
  formatDeliveryAddressLegacy,
  getDeliveryAddressValidationError,
  parseDeliveryAddressLegacy,
} from '../src/domain/deliveryAddress';

const completeDraft = () => ({
  logradouro: ' Rua das Flores ',
  numero: ' 123 ',
  complemento: ' Apto 10 ',
  bairro: ' Centro ',
  cidade: ' Fortaleza ',
  uf: 'ce',
  cep: '60.000-000',
  referencia: ' Portaria lateral ',
});

describe('universal delivery address source', () => {
  it('normaliza o mesmo snapshot usado por Caixa e Cardápio', () => {
    const snapshot = deliveryAddressDraftToSnapshot(completeDraft());
    assert.deepEqual(snapshot, {
      logradouro: 'Rua das Flores',
      numero: '123',
      complemento: 'Apto 10',
      bairro: 'Centro',
      cidade: 'Fortaleza',
      uf: 'CE',
      cep: '60000000',
      referencia: 'Portaria lateral',
      latitude: null,
      longitude: null,
    });
  });

  it('gera formato legado compatível e consegue restaurar apenas o formato canônico do KÔMA', () => {
    const snapshot = deliveryAddressDraftToSnapshot(completeDraft());
    assert.ok(snapshot);

    const legacy = formatDeliveryAddressLegacy(snapshot);
    assert.equal(
      legacy,
      'Rua das Flores, 123, Apto 10, Centro, Fortaleza - CE, CEP 60000-000, Ref.: Portaria lateral',
    );
    assert.deepEqual(parseDeliveryAddressLegacy(legacy), {
      logradouro: 'Rua das Flores',
      numero: '123',
      complemento: 'Apto 10',
      bairro: 'Centro',
      cidade: 'Fortaleza',
      uf: 'CE',
      cep: '60000000',
      referencia: 'Portaria lateral',
    });
  });

  it('não tenta adivinhar endereço legado livre', () => {
    assert.equal(parseDeliveryAddressLegacy('Rua antiga perto da praça, casa azul'), null);
  });

  it('bloqueia snapshot incompleto antes do envio', () => {
    const draft = { ...completeDraft(), cep: '60000' };
    assert.equal(getDeliveryAddressValidationError(draft), 'Informe um CEP com 8 dígitos.');
    assert.equal(deliveryAddressDraftToSnapshot(draft), null);
  });
});
