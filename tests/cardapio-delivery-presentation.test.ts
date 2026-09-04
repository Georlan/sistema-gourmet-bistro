import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getDeliveryMinimumRemaining, getDeliveryQuote } from '../src/cardapio/deliveryPresentation';

const neighborhoods = [{ bairro: 'Centro', taxa: 5 }, { bairro: 'Retiro', taxa: 0 }];

test('prévia de entrega tem taxa própria, independente da retirada selecionada', () => {
  assert.deepEqual(getDeliveryQuote({ taxaEntregaPadrao: 8 }, 25, ''), { fee: 8, awaitingNeighborhood: false });
});

test('bairro não selecionado preserva taxa padrão e explicita que é estimada', () => {
  assert.deepEqual(getDeliveryQuote({ taxaEntregaPadrao: 8, tabelaTaxasBairros: neighborhoods }, 25, ''), { fee: 8, awaitingNeighborhood: true });
});

test('bairro selecionado mantém taxa e comparação sem diferença entre maiúsculas', () => {
  assert.deepEqual(getDeliveryQuote({ taxaEntregaPadrao: 8, tabelaTaxasBairros: neighborhoods }, 25, 'CENTRO'), { fee: 5, awaitingNeighborhood: false });
});

test('bairro desconhecido não promete taxa confirmada nem muda o fallback existente', () => {
  assert.deepEqual(getDeliveryQuote({ taxaEntregaPadrao: 8, tabelaTaxasBairros: neighborhoods }, 25, 'Outro'), { fee: 8, awaitingNeighborhood: true });
});

test('taxa zero do bairro permanece gratuita', () => {
  assert.deepEqual(getDeliveryQuote({ tabelaTaxasBairros: neighborhoods }, 25, 'Retiro'), { fee: 0, awaitingNeighborhood: false });
});

test('limiar de frete grátis preserva cálculo por subtotal e precedência sobre bairro', () => {
  const config = { freteGratisValor: 75, taxaEntregaPadrao: 8, tabelaTaxasBairros: neighborhoods };
  assert.equal(getDeliveryQuote(config, 74.99, 'Centro').fee, 5);
  assert.deepEqual(getDeliveryQuote(config, 75, 'Centro'), { fee: 0, awaitingNeighborhood: false });
  assert.deepEqual(getDeliveryQuote(config, 75, ''), { fee: 0, awaitingNeighborhood: false });
});

test('taxa configurada zero não se confunde com configuração ausente no cálculo', () => {
  assert.equal(getDeliveryQuote({ taxaEntregaPadrao: 0 }, 25, '').fee, 0);
  assert.equal(getDeliveryQuote(undefined, 25, '').fee, 0);
});

test('cotações usam apenas a configuração fornecida de cada restaurante', () => {
  assert.equal(getDeliveryQuote({ tabelaTaxasBairros: [{ bairro: 'Centro', taxa: 9 }] }, 25, 'Centro').fee, 9);
  assert.equal(getDeliveryQuote({ tabelaTaxasBairros: neighborhoods }, 25, 'Centro').fee, 5);
});

test('pedido mínimo bloqueia somente entrega, nunca retirada', () => {
  assert.equal(getDeliveryMinimumRemaining({ pedidoMinimo: 30 }, 20, 'delivery'), 10);
  assert.equal(getDeliveryMinimumRemaining({ pedidoMinimo: 30 }, 20, 'pickup'), 0);
  assert.equal(getDeliveryMinimumRemaining({ pedidoMinimo: 30 }, 30, 'delivery'), 0);
});

const cart = readFileSync(new URL('../src/cardapio/components/CardapioCartDrawer.tsx', import.meta.url), 'utf8');

test('UI expõe seleção, nome acessível do bairro e endereço legível sem alterar checkout', () => {
  assert.match(cart, /aria-pressed=\{deliveryMethod === "pickup"\}/);
  assert.match(cart, /aria-pressed=\{deliveryMethod === "delivery"\}/);
  assert.match(cart, /htmlFor="delivery-neighborhood"/);
  assert.match(cart, /id="delivery-neighborhood"/);
  assert.match(cart, /autoComplete="street-address"/);
  assert.match(cart, /deliveryMethod === "delivery" \? deliveryQuote.fee : 0/);
});

test('resumo não promete total final, mostra mínimo e preserva bloqueio de loja pausada', () => {
  assert.match(cart, /<span>Total estimado<\/span>/);
  assert.match(cart, /remainingMinimum > 0 &&/);
  assert.match(cart, /disabled=\{!orderingEnabled \|\| availablePayments.length === 0\}/);
});

test('UI impede selecionar entrega desativada sem bloquear retirada', () => {
  assert.match(cart, /disabled=\{!deliveryEnabled\} aria-pressed=\{deliveryMethod === "delivery"\}/);
  assert.match(cart, /deliveryEnabled \? deliveryLabel : "Indisponível no momento"/);
  assert.match(cart, /deliveryMethod === "delivery" && pedidoMin > 0 && subtotal < pedidoMin/);
});

test('promoção ausente não renderiza zero solto na sacola', () => {
  assert.match(cart, /\{freeDeliveryThreshold > 0 && deliveryMethod === "delivery" &&/);
});
