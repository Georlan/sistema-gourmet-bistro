import assert from 'node:assert/strict';
import test from 'node:test';

import { getRestaurantMapsUrl } from '../src/cardapio/getRestaurantMapsUrl';

test('Plus Code informado sem URL abre rota externa sem transformar o + em espaço', () => {
  assert.equal(
    getRestaurantMapsUrl('Q4H9+CQ, Limoeiro do Norte - CE, 62930-000'),
    'https://www.google.com/maps/dir/?api=1&destination=Q4H9%2BCQ%2C%20Limoeiro%20do%20Norte%20-%20CE%2C%2062930-000',
  );
});

test('endereço comum vira navegação válida ao Google Maps', () => {
  assert.equal(
    getRestaurantMapsUrl('Rua Central, 101, Fortaleza - CE'),
    'https://www.google.com/maps/dir/?api=1&destination=Rua%20Central%2C%20101%2C%20Fortaleza%20-%20CE',
  );
});

test('links oficiais Google Maps são preservados', () => {
  const originals = [
    'https://maps.google.com/?q=restaurante',
    'https://www.google.com/maps/place/JE+Lanches',
    'https://maps.app.goo.gl/abcdefgh',
    'https://goo.gl/maps/abcdef',
  ];
  for (const value of originals) assert.equal(getRestaurantMapsUrl(value), value);
  assert.equal(
    getRestaurantMapsUrl('www.google.com/maps/place/JE+Lanches'),
    'https://www.google.com/maps/place/JE+Lanches',
  );
});

test('links externos desconhecidos e protocolos inseguros não entram no href', () => {
  for (const value of [
    'javascript:alert(1)',
    '//example.com/path',
    'https://example.com/maps',
    'https://maps.google.com.evil.com/path',
    'http://maps.google.com/?q=local',
    'data:text/html,hello',
    '',
    '   ',
  ]) assert.equal(getRestaurantMapsUrl(value), null, value);
  assert.equal(getRestaurantMapsUrl(undefined), null);
});
