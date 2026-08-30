import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrandConfig } from '../src/cardapio/CardapioTypes';
import { getAvailablePaymentMethods, getPaymentSelectionError, resolvePaymentSelection, PAYMENT_UNAVAILABLE_MESSAGE, PAYMENT_RESELECT_MESSAGE, type PaymentMethod } from '../src/cardapio/paymentMethods';
import CardapioPaymentOptions from '../src/cardapio/components/CardapioPaymentOptions';
register('./helpers/staticAssetsLoader.mjs', import.meta.url);
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { location: { hostname: 'localhost', protocol: 'http:' } },
});
const { default: CardapioCartDrawer } = await import('../src/cardapio/components/CardapioCartDrawer');
const { default: CardapioDigital } = await import('../src/cardapio/components/CardapioDigital');

const groups = (...names: string[]) => names.map(type => ({ type, accepted: [] }));
const brand = (names: string[]): BrandConfig => ({
  id: '901', name: 'Loja de teste', slogan: '', logo: '', bannerImage: '', phone: '', address: '',
  colors: { primary: '#00b894', background: '#090a0f' }, categories: [], products: [], paymentMethods: groups(...names),
});
const cart = [{ id: 'local-1', product: { id: 'p1', name: 'Lanche', price: 25, description: '', category: 'Lanches', image: '' }, quantity: 1, selectedOptions: {}, notes: '' }];
const renderCart = (names: string[]) => renderToStaticMarkup(createElement(CardapioCartDrawer, {
  restaurantId: '901', brandConfig: brand(names), cart, user: null,
  onClose() {}, onUpdateQty() {}, onRemoveItem() {}, onPlaceOrder() {},
}));
const renderReview = (names: string[], method?: PaymentMethod, trocoPara?: number) => renderToStaticMarkup(createElement(CardapioDigital, {
  activeBrand: brand(names), cart, deliveryFee: 0, deliveryMethod: 'pickup', address: '', customerName: 'Teste local', customerPhone: '00000000000',
  paymentMethodDetail: method, trocoPara, onClose() {}, onOrderSuccess() {},
}));

test('normaliza quatro formas cadastradas, acentos, caixa, espaços e códigos legados', () => {
  assert.deepEqual(getAvailablePaymentMethods(groups(' Pix ', 'DINHEIRO', 'Cartão de Crédito', 'Cartão de Débito')), ['pix', 'dinheiro', 'cartao_credito', 'cartao_debito']);
  assert.deepEqual(getAvailablePaymentMethods(groups('CREDITO', 'Débito', 'cartao_credito', 'Cartao de debito', ' cartao   debito ')), ['cartao_credito', 'cartao_debito']);
});

test('não inventa pagamento para cadastro vazio, genérico ou desconhecido', () => {
  assert.deepEqual(getAvailablePaymentMethods(), []);
  assert.deepEqual(getAvailablePaymentMethods([]), []);
  assert.deepEqual(getAvailablePaymentMethods(groups('Cartão', 'Voucher', 'Pix online', 'Não aceita dinheiro', 'constructor', '__proto__')), []);
  assert.deepEqual(getAvailablePaymentMethods(groups('Voucher', 'Pix')), ['pix']);
});

test('somente as formas de cada loja são oferecidas, sem fallback de outra loja', () => {
  const a = getAvailablePaymentMethods(groups('Pix', 'Dinheiro'));
  const b = getAvailablePaymentMethods(groups('Cartão de débito'));
  assert.deepEqual(a, ['pix', 'dinheiro']);
  assert.deepEqual(b, ['cartao_debito']);
  assert.equal(resolvePaymentSelection({ restaurantId: '901', method: 'pix' }, 902, a), null);
  assert.equal(resolvePaymentSelection({ restaurantId: '901', method: 'pix' }, 901, b), null);
  assert.equal(resolvePaymentSelection({ restaurantId: '902', method: 'cartao_debito' }, 902, b), 'cartao_debito');
});

test('remoção da escolha e ausência de configuração são tratadas explicitamente', () => {
  assert.equal(getPaymentSelectionError('pix', []), PAYMENT_UNAVAILABLE_MESSAGE);
  assert.equal(getPaymentSelectionError(undefined, ['cartao_debito']), PAYMENT_RESELECT_MESSAGE);
  assert.equal(getPaymentSelectionError('dinheiro', ['pix']), PAYMENT_RESELECT_MESSAGE);
  assert.equal(getPaymentSelectionError('cartao_debito', ['cartao_debito']), null);
});

test('cada botão envia o código correto, com débito separado e seleção acessível', () => {
  const calls: PaymentMethod[] = [];
  const available: PaymentMethod[] = ['pix', 'dinheiro', 'cartao_credito', 'cartao_debito'];
  const view = CardapioPaymentOptions({ available, selected: 'cartao_debito', onSelect: method => calls.push(method) });
  const buttons = React.Children.toArray(view.props.children) as React.ReactElement<{ onClick: () => void; 'aria-pressed': boolean }>[];
  buttons.forEach(button => button.props.onClick());
  assert.deepEqual(calls, available);
  assert.deepEqual(buttons.map(button => button.props['aria-pressed']), [false, false, false, true]);
  assert.match(renderToStaticMarkup(view), /grid-cols-2/);
});

test('sacola de loja com apenas débito não inicia em Pix nem oferece crédito/dinheiro', () => {
  const html = renderCart(['Cartão de débito']);
  assert.match(html, /aria-pressed="true"[^]*Cartão de débito/);
  assert.doesNotMatch(html, />Pix<|>Dinheiro<|>Cartão de crédito<|Precisa de troco/);
});

test('sacola com dinheiro mostra troco e loja vazia não habilita revisão', () => {
  assert.match(renderCart(['Dinheiro']), /Precisa de troco/);
  for (const names of [[], ['Voucher']]) {
    const html = renderCart(names);
    assert.ok(html.includes(PAYMENT_UNAVAILABLE_MESSAGE));
    assert.match(html, /<button[^>]*disabled=""[^>]*id="btn-confirm-order"/);
    assert.doesNotMatch(html, />Pix<|>Dinheiro<|>Cartão de crédito<|>Cartão de débito</);
  }
});

test('revisão aceita débito configurado e não mostra troco indevido', () => {
  const html = renderReview(['Cartão de débito'], 'cartao_debito', 100);
  assert.match(html, /Cartão de débito/);
  assert.doesNotMatch(html, /Troco para|Confira o pagamento|<button[^>]*disabled=""[^>]*id="btn-place-order-final"/);
});

test('revisão bloqueia forma removida, ausente ou não cadastrada em vez de assumir Pix', () => {
  for (const [names, method] of [[['Dinheiro'], 'pix'], [[], 'pix'], [['Pix'], undefined]] as [string[], PaymentMethod | undefined][]) {
    const html = renderReview(names, method);
    assert.match(html, /role="alert"/);
    assert.match(html, /<button[^>]*disabled=""[^>]*id="btn-place-order-final"/);
    assert.doesNotMatch(html, /Pagamento escolhido/);
  }
});

test('proteções ficam antes dos callbacks/envio e troco é exclusivo de dinheiro', () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const drawer = source('../src/cardapio/components/CardapioCartDrawer.tsx');
  const review = source('../src/cardapio/components/CardapioDigital.tsx');
  assert.ok(drawer.indexOf('if (paymentError || !paymentDetail)') < drawer.indexOf('onPlaceOrder({'));
  assert.ok(review.indexOf('if (paymentError)') < review.indexOf('const response = await fetch'));
  assert.match(drawer, /trocoPara: paymentDetail === "dinheiro" && precisaTroco/);
  assert.match(review, /troco_para: paymentMethodDetail === "dinheiro" \? trocoPara : undefined/);
});
