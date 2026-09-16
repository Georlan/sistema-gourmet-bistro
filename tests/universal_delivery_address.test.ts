import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryAddressDraftToSnapshot,
  formatDeliveryAddressLegacy,
  getDeliveryAddressValidationError,
  parseDeliveryAddressLegacy,
  updateDeliveryAddressGeographicField,
} from '../src/domain/deliveryAddress';
import { placePredictionToAddressDraft } from '../src/integrations/googleMaps/placesAddress';

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
      latitude: null,
      longitude: null,
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

  it('preserva coordenadas válidas vindas de geocodificação', () => {
    const snapshot = deliveryAddressDraftToSnapshot({
      ...completeDraft(),
      latitude: -3.7319,
      longitude: -38.5267,
    });

    assert.equal(snapshot?.latitude, -3.7319);
    assert.equal(snapshot?.longitude, -38.5267);
  });

  it('invalida coordenadas quando o usuário corrige um campo geográfico', () => {
    const geocoded = {
      ...completeDraft(),
      latitude: -3.7319,
      longitude: -38.5267,
    };

    const corrected = updateDeliveryAddressGeographicField(geocoded, 'numero', '125');
    assert.equal(corrected.numero, '125');
    assert.equal(corrected.latitude, null);
    assert.equal(corrected.longitude, null);
  });

  it('rejeita coordenadas parciais ou fora dos limites', () => {
    assert.equal(
      getDeliveryAddressValidationError({ ...completeDraft(), latitude: -3.7319 }),
      'Latitude e longitude devem ser informadas juntas.',
    );
    assert.equal(
      getDeliveryAddressValidationError({ ...completeDraft(), latitude: -91, longitude: -38.5267 }),
      'Latitude inválida.',
    );
    assert.equal(
      getDeliveryAddressValidationError({ ...completeDraft(), latitude: 0, longitude: 0 }),
      'As coordenadas não podem ser 0,0.',
    );
  });

  it('preserva coordenadas ao editar complemento e referência', () => {
    const geocoded = {
      ...completeDraft(),
      latitude: -3.7319,
      longitude: -38.5267,
    };
    assert.equal({ ...geocoded, complemento: 'Bloco B' }.latitude, -3.7319);
    assert.equal({ ...geocoded, referencia: 'Portão azul' }.longitude, -38.5267);
  });

  it('converte uma sugestão do Google para o mesmo rascunho universal sem apagar complemento', async () => {
    const components = [
      { longText: 'Avenida Beira Mar', types: ['route'] },
      { longText: '1000', types: ['street_number'] },
      { longText: 'Meireles', types: ['sublocality_level_1'] },
      { longText: 'Fortaleza', types: ['administrative_area_level_2'] },
      { longText: 'Ceará', shortText: 'CE', types: ['administrative_area_level_1'] },
      { longText: '60165-121', types: ['postal_code'] },
    ];
    const suggestion = {
      placePrediction: {
        toPlace: () => ({
          addressComponents: components,
          location: { lat: () => -3.725, lng: () => -38.496 },
          fetchFields: async () => undefined,
        }),
      },
    };

    const draft = await placePredictionToAddressDraft(suggestion, completeDraft());
    assert.deepEqual(draft, {
      ...completeDraft(),
      logradouro: 'Avenida Beira Mar',
      numero: '1000',
      bairro: 'Meireles',
      cidade: 'Fortaleza',
      uf: 'CE',
      cep: '60165121',
      latitude: -3.725,
      longitude: -38.496,
    });
  });
});
