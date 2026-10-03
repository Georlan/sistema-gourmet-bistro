import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrandConfig } from '../src/cardapio/CardapioTypes';
import { getFulfillmentAvailability, resolveFulfillmentSelection } from '../src/cardapio/fulfillment';

const brand = (patch: Partial<BrandConfig> = {}) => ({
  id: '2', activeOrderTypes: ['delivery', 'retirada', 'consumo_local'], deliveryEnabled: true, ...patch,
} as BrandConfig);

test('new order prefers enabled delivery over pickup', () => {
  assert.equal(resolveFulfillmentSelection(brand()), 'delivery');
});
test('delivery disabled by either public setting falls back to pickup', () => {
  assert.equal(resolveFulfillmentSelection(brand({ deliveryEnabled: false })), 'pickup');
  assert.equal(resolveFulfillmentSelection(brand({ activeOrderTypes: ['retirada'] })), 'pickup');
});
test('preserves valid persisted pickup and delivery choices', () => {
  assert.equal(resolveFulfillmentSelection(brand(), 'pickup'), 'pickup');
  assert.equal(resolveFulfillmentSelection(brand(), 'delivery'), 'delivery');
});
test('invalid persisted choice uses delivery, pickup, then existing dine-in fallback', () => {
  assert.equal(resolveFulfillmentSelection(brand({ activeOrderTypes: ['delivery'] }), 'pickup'), 'delivery');
  assert.equal(resolveFulfillmentSelection(brand({ deliveryEnabled: false }), 'delivery'), 'pickup');
  assert.equal(resolveFulfillmentSelection(brand({ activeOrderTypes: ['consumo_local'] }), 'delivery'), 'dine_in');
  assert.equal(resolveFulfillmentSelection(brand({ activeOrderTypes: [] }), 'pickup'), null);
});
test('async configuration selects nothing prematurely and preserves a choice after loading', () => {
  assert.equal(resolveFulfillmentSelection(undefined), null);
  assert.equal(resolveFulfillmentSelection(undefined, 'pickup'), null);
  assert.deepEqual(getFulfillmentAvailability(undefined), { delivery: false, pickup: false, dine_in: false });
  assert.equal(resolveFulfillmentSelection(brand()), 'delivery');
  assert.equal(resolveFulfillmentSelection(brand(), 'pickup'), 'pickup');
});
test('legacy loaded configuration keeps its existing enabled modalities', () => {
  assert.equal(resolveFulfillmentSelection(brand({ activeOrderTypes: undefined, deliveryEnabled: undefined })), 'delivery');
});
