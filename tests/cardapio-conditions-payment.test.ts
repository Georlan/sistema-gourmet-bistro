import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrandConfig } from '../src/cardapio/CardapioTypes';
import { CardapioConditionsSummary, CardapioDeliveryInfo } from '../src/cardapio/components/CardapioOrderConditions';
import CardapioPaymentSummary, { PAYMENT_LABELS } from '../src/cardapio/components/CardapioPaymentSummary';

const brand = (extra: Partial<BrandConfig> = {}): BrandConfig => ({
  id: '901', name: 'Loja de teste', slogan: '', logo: '', bannerImage: '', phone: '', address: '',
  colors: { primary: '#00b894', background: '#090a0f' }, categories: [], products: [], ...extra,
});
const render = (view: React.ReactElement) => renderToStaticMarkup(view).replace(/\u00a0/g, ' ');

test('resumo mostra mínimo configurado e acesso às taxas sem sacola', () => {
  const html = render(createElement(CardapioConditionsSummary, { brand: brand({ pedidoMinimo: 30 }), onOpen: () => {} }));
  assert.match(html, /Condições do pedido/);
  assert.match(html, /Mínimo para entrega/);
  assert.match(html, /R\$ 30,00/);
  assert.match(html, /Taxas de entrega/);
  assert.match(html, /min-h-11/);
});

test('delivery pausado anuncia somente retirada e não publica taxas ou mínimo', () => {
  const paused = brand({
    deliveryEnabled: false,
    pedidoMinimo: 30,
    taxaEntregaPadrao: 12,
    tabelaTaxasBairros: [{ bairro: 'Centro', taxa: 5 }],
  });
  const summary = render(createElement(CardapioConditionsSummary, { brand: paused, onOpen: () => {} }));
  const details = render(createElement(CardapioDeliveryInfo, { brand: paused }));
  assert.match(summary, /Somente retirada/);
  assert.match(details, /entrega está pausada/);
  assert.doesNotMatch(`${summary}${details}`, /R\$|Pedido mínimo|Taxa padrão|Taxas por bairro/);
});

test('sem mínimo não anuncia valor inventado ou mínimo zero', () => {
  for (const pedidoMinimo of [undefined, 0]) {
    const html = render(createElement(CardapioConditionsSummary, { brand: brand({ pedidoMinimo }), onOpen: () => {} }));
    assert.doesNotMatch(html, /Pedido mínimo|R\$/);
    assert.match(html, /Taxas de entrega/);
  }
});

test('botão de taxas aciona apenas o callback de consulta', () => {
  let calls = 0;
  const view = CardapioConditionsSummary({ brand: brand(), onOpen: () => calls++ });
  const button = React.Children.toArray(view.props.children).find((node) => React.isValidElement(node) && node.type === 'button') as React.ReactElement<{ onClick: () => void }>;
  button.props.onClick();
  assert.equal(calls, 1);
});

test('consulta mantém bairros gratuitos, valores, nomes longos e limiar da loja', () => {
  const html = render(createElement(CardapioDeliveryInfo, { brand: brand({ pedidoMinimo: 30, freteGratisValor: 75, tabelaTaxasBairros: [{ bairro: 'Centro', taxa: 5 }, { bairro: 'Bairro com nome muito longo', taxa: 0 }] }) }));
  for (const value of ['R$ 30,00', 'R$ 75,00', 'R$ 5,00', 'Bairro com nome muito longo', 'Grátis']) assert.ok(html.includes(value));
  assert.match(html, /break-words/);
});

test('mesmo bairro de outra loja exibe a própria taxa', () => {
  const html = render(createElement(CardapioDeliveryInfo, { brand: brand({ id: '902', tabelaTaxasBairros: [{ bairro: 'Centro', taxa: 9 }] }) }));
  assert.match(html, /R\$ 9,00/);
  assert.doesNotMatch(html, /R\$ 5,00/);
});

test('sem tabela informa estimativa existente; sem valor não inventa taxa ou prazo', () => {
  const configured = render(createElement(CardapioDeliveryInfo, { brand: brand({ taxaEntregaPadrao: 12 }) }));
  assert.match(configured, /Taxa padrão estimada/);
  assert.match(configured, /R\$ 12,00/);
  const absent = render(createElement(CardapioDeliveryInfo, { brand: brand() }));
  assert.match(absent, /Consulte a taxa de entrega na sacola/);
  assert.doesNotMatch(absent, /R\$|minutos|Grátis/);
});

test('revisão apresenta a forma realmente escolhida e momento do pagamento', () => {
  for (const [method, label] of Object.entries(PAYMENT_LABELS)) {
    const html = render(createElement(CardapioPaymentSummary, { method: method as keyof typeof PAYMENT_LABELS, fulfillment: 'delivery' }));
    assert.ok(html.includes(label));
    if (method === 'pix') {
      assert.match(html, /online agora/);
      assert.match(html, /só aparece para o restaurante após a confirmação automática/);
      assert.doesNotMatch(html, /na entrega|Não há cobrança online/);
    } else {
      assert.match(html, /na entrega/);
      assert.match(html, /Não há cobrança online/);
    }
  }
});

test('troco é mostrado como valor entregue, somente para dinheiro', () => {
  const cash = render(createElement(CardapioPaymentSummary, { method: 'dinheiro', fulfillment: 'pickup', changeFor: 100 }));
  assert.match(cash, /Troco para R\$ 100,00/);
  assert.match(cash, /na retirada/);
  const pix = render(createElement(CardapioPaymentSummary, { method: 'pix', fulfillment: 'pickup', changeFor: 100 }));
  assert.doesNotMatch(pix, /Troco|100/);
  const exact = render(createElement(CardapioPaymentSummary, { method: 'dinheiro', fulfillment: 'pickup' }));
  assert.match(exact, /Sem troco solicitado/);
});

test('consulta fica antes das categorias e usa a loja ativa', () => {
  const page = readFileSync(new URL('../src/cardapio/CardapioPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /<CardapioConditionsSummary brand=\{activeBrand\} onOpen=\{\(\) => setIsStoreInfoOpen\(true\)\}/);
  assert.ok(page.indexOf('<CardapioConditionsSummary') < page.indexOf('<CardapioCategoryNav'));
});

test('controles de pagamento configurados mantêm seleção e troco acessíveis', () => {
  const cart = readFileSync(new URL('../src/cardapio/components/CardapioCartDrawer.tsx', import.meta.url), 'utf8');
  assert.match(cart, /<CardapioPaymentOptions available=\{availablePayments\} selected=\{paymentDetail\} onSelect=\{selectPayment\}/);
  assert.match(cart, /htmlFor="payment-change-for"/);
  assert.match(cart, /id="payment-change-for"/);
  assert.match(cart, /if \(method !== 'dinheiro'\) \{\s*setPrecisaTroco\(false\);\s*setTrocoPara\(""\)/);
  const checkout = readFileSync(new URL('../src/cardapio/components/CardapioDigital.tsx', import.meta.url), 'utf8');
  assert.match(checkout, /method=\{paymentMethodDetail\} fulfillment=\{deliveryMethod\} changeFor=\{trocoPara\}/);
  assert.match(checkout, /forma_pagamento_detalhe: paymentMethodDetail/);
});
