import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrandConfig } from '../src/cardapio/CardapioTypes';
register('./helpers/staticAssetsLoader.mjs', import.meta.url);
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hostname: 'localhost', protocol: 'http:' } } });
const { default: CardapioCartDrawer } = await import('../src/cardapio/components/CardapioCartDrawer');
const { default: CardapioBenefitsDrawer } = await import('../src/cardapio/components/CardapioBenefitsDrawer');

const noop = () => {};
const product = { id: 'test-pudding', name: 'Pudim', price: 8, description: '', image: '', category: 'Sobremesas' };
const brand = (benefits?: BrandConfig['benefits']): BrandConfig => ({
  id: '96571', name: 'Restaurante', slogan: '', logo: '', bannerImage: '', phone: '', address: '',
  categories: [], products: [product], colors: { primary: '#00b894', background: '#090a0f' },
  paymentMethods: [{ type: 'Dinheiro', accepted: [] }], benefits,
});
function cart(benefits?: BrandConfig['benefits']) {
  return renderToStaticMarkup(createElement(CardapioCartDrawer, {
    cart: [{ id: 'cart-pudding', product, quantity: 1, selectedOptions: {}, notes: '' }],
    restaurantId: '96571', brandConfig: brand(benefits), user: { name: 'Cliente', cashback: 20, saldo_cashback: 20 },
    initialCouponCode: 'PRIVADO', onClose: noop, onUpdateQty: noop, onRemoveItem: noop, onPlaceOrder: noop,
  }));
}

test('checkout omite descontos e saldo legado sem capacidades, inclusive enquanto o contrato está ausente', () => {
  for (const capabilities of [undefined, { coupons: false, loyalty: false, cashback: false }]) {
    const html = cart(capabilities);
    assert.doesNotMatch(html, /cart-discounts|Código do cupom|Saldo de Cashback|Pix é pago agora/);
    assert.match(html, /3\. Como quer pagar/);
    assert.match(html, /4\. Identificação/);
  }
});

test('checkout distingue cupom de cashback e mantém formulários habilitados', () => {
  const couponOnly = cart({ coupons: true, loyalty: false, cashback: false });
  assert.match(couponOnly, /Código do cupom/);
  assert.doesNotMatch(couponOnly, /Saldo de Cashback/);
  const cashbackOnly = cart({ coupons: false, loyalty: true, cashback: true });
  assert.doesNotMatch(cashbackOnly, /Código do cupom/);
  assert.match(cashbackOnly, /Saldo de Cashback/);
});

test('painel de benefícios mostra apenas a modalidade habilitada', () => {
  const drawer = (capabilities: BrandConfig['benefits']) => renderToStaticMarkup(createElement(CardapioBenefitsDrawer, {
    restaurantId: '96571', isOpen: true, capabilities, onClose: noop, onAuthClick: noop, onUseCoupon: noop,
  }));
  assert.equal(drawer({ coupons: false, loyalty: false, cashback: false }), '');
  const html = drawer({ coupons: true, loyalty: false, cashback: false });
  assert.match(html, /Ofertas/);
  assert.doesNotMatch(html, />Créditos<|>Pontos</);
});
