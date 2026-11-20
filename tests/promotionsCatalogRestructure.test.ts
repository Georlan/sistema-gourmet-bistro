import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  getCashierNavigationChild,
  getCashierNavigationTarget,
  normalizeCashierNavigationState,
} from '../src/components/caixa/navigation/cashierNavigation';
import { buildSectionPersistedPayload, type RestaurantConfigSnapshot } from '../src/components/cardapio/CardapioDigitalSettingsPanel';
import {
  getEffectiveProductPrice,
  getProductBadgeLabel,
  normalizeProductBadge,
} from '../src/domain/productMerchandising';
import {
  buildBuyGetSuggestion,
  buildComboSuggestion,
  buildItemDiscountSuggestion,
  buildSchedulePreset,
  buildSimpleGiftSuggestion,
  getPromotionTypeLabel,
  inferPromotionType,
} from '../src/utils/promotionFormHelpers';
import { computeActivePromotions, getNextPromotionTransition } from '../src/cardapio/useActivePromotions';

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('Cardápio expõe subaba canônica Promoções e vitrine com aliases de busca', () => {
  const child = getCashierNavigationChild('cardapio_promocoes');
  assert.ok(child);
  assert.equal(child.label, 'Promoções e vitrine');
  assert.deepEqual(getCashierNavigationTarget('cardapio_promocoes'), {
    tab: 'cardapio',
    subTab: 'promocoes',
  });
  assert.deepEqual(child.searchAliases, [
    'promocoes',
    'ofertas',
    'combos',
    'destaque',
    'vitrine',
    'compre e ganhe',
  ]);
  assert.deepEqual(normalizeCashierNavigationState('cardapio', 'ofertas'), {
    tab: 'cardapio',
    subTab: 'promocoes',
  });
  assert.deepEqual(normalizeCashierNavigationState('cardapio', 'vitrine'), {
    tab: 'cardapio',
    subTab: 'promocoes',
  });
});

test('CardapioDigitalSettingsPanel isola payload por seção para evitar sobrescrita silenciosa', () => {
  const snapshot: RestaurantConfigSnapshot = {
    nome: '  Cantina Koma  ',
    subtitulo: ' Comida fresca ',
    sobre_nos: ' Feita no dia ',
    endereco: ' Rua A, 100 ',
    google_maps_url: ' https://maps.example ',
    status_override: 'Forçado Aberto',
    logo_url: ' https://cdn.example/logo.png ',
    banner_url: ' https://cdn.example/banner.png ',
    socials: { whatsapp: '85999999999', instagram: '@cantina' },
    horarios_funcionamento: [{ id: '1', days: 'Seg a Sex', hours: '11:00 - 15:00' }],
    formas_pagamento_aceitas: ['Pix', 'Dinheiro'],
    pedido_minimo: 25,
    pedido_minimo_retirada: false,
    frete_gratis_valor: 80,
    tipo_taxa_entrega: 'bairro',
    tabela_taxas_bairros: [{ id: 'b1', bairro: 'Centro', taxa: 6 }],
  };

  const perfilPayload = buildSectionPersistedPayload(snapshot, 'perfil');
  assert.deepEqual(Object.keys(perfilPayload).sort(), [
    'endereco',
    'google_maps_url',
    'nome',
    'sobre_nos',
    'socials',
    'subtitulo',
  ]);
  assert.equal(perfilPayload.nome, 'Cantina Koma');
  assert.equal('horarios_funcionamento' in perfilPayload, false);
  assert.equal('formas_pagamento_aceitas' in perfilPayload, false);
  assert.equal('pedido_minimo' in perfilPayload, false);

  const marcaPayload = buildSectionPersistedPayload(snapshot, 'marca');
  assert.deepEqual(marcaPayload, {
    logo_url: 'https://cdn.example/logo.png',
    banner_url: 'https://cdn.example/banner.png',
  });
});

test('productMerchandising calcula preço efetivo, desconto e selos válidos', () => {
  const discounted = getEffectiveProductPrice(30, 24);
  assert.equal(discounted.hasDiscount, true);
  assert.equal(discounted.effectivePrice, 24);
  assert.equal(discounted.originalPrice, 30);
  assert.equal(discounted.discountPercent, 20);

  const invalidPromo = getEffectiveProductPrice(30, 35);
  assert.equal(invalidPromo.hasDiscount, false);
  assert.equal(invalidPromo.effectivePrice, 30);
  assert.equal(invalidPromo.originalPrice, null);

  assert.equal(normalizeProductBadge('novidade'), 'novidade');
  assert.equal(normalizeProductBadge('mais_vendido'), 'mais_vendido');
  assert.equal(normalizeProductBadge('invalido'), null);
  assert.equal(getProductBadgeLabel('mais_vendido'), 'Mais pedido');
  assert.equal(getProductBadgeLabel('edicao_limitada'), 'Edição limitada');
});

test('modo Compre X e ganhe Y sugere preço igual ao item principal e nome claro', () => {
  const suggestion = buildBuyGetSuggestion(
    { id: 'p1', nome: 'Quentinha G', preco: 26 },
    { id: 'p2', nome: 'Pitchulinha', preco: 4.5 },
  );
  assert.deepEqual(suggestion, {
    nome: 'Compre Quentinha G e ganhe Pitchulinha',
    descricao: 'Na compra de Quentinha G, leve Pitchulinha de brinde.',
    preco: '26.00',
  });
  assert.equal(
    buildBuyGetSuggestion(
      { id: 'p1', nome: 'Quentinha G', preco: 26 },
      { id: 'p1', nome: 'Quentinha G', preco: 26 },
    ),
    null,
  );
});

test('atalhos rápidos de agendamento preenchem início e fim no fuso da loja', () => {
  const reference = new Date('2026-11-18T15:30:00Z'); // Quarta-feira 12:30 em America/Fortaleza
  assert.deepEqual(buildSchedulePreset('agora', 'America/Fortaleza', reference), {
    inicio: '',
    fim: '',
  });
  assert.deepEqual(buildSchedulePreset('hoje', 'America/Fortaleza', reference), {
    inicio: '2026-11-18T12:30',
    fim: '2026-11-18T23:59',
  });
  assert.deepEqual(buildSchedulePreset('amanha', 'America/Fortaleza', reference), {
    inicio: '2026-11-19T08:00',
    fim: '2026-11-19T23:59',
  });
  assert.deepEqual(buildSchedulePreset('fim_de_semana', 'America/Fortaleza', reference), {
    inicio: '2026-11-20T17:00',
    fim: '2026-11-22T23:59',
  });
});

test('useActivePromotions oculta ofertas futuras e agenda transição para inicio_em', () => {
  const nowMs = Date.parse('2026-11-18T12:00:00Z');
  const campaigns = [
    {
      id: 'ativa',
      nome: 'Combo Almoço',
      descricao: '',
      preco: 25,
      componentes: [['a'], ['b']],
      inicio_em: '2026-11-18T11:00:00Z',
      fim_em: '2026-11-18T15:00:00Z',
    },
    {
      id: 'futura',
      nome: 'Happy Hour',
      descricao: '',
      preco: 35,
      componentes: [['a'], ['c']],
      inicio_em: '2026-11-18T14:00:00Z',
      fim_em: '2026-11-18T18:00:00Z',
    },
  ];

  const active = computeActivePromotions(campaigns, nowMs);
  assert.deepEqual(active.map((c) => c.id), ['ativa']);

  const next = getNextPromotionTransition(campaigns, nowMs);
  assert.deepEqual(next, {
    nextAtMs: Date.parse('2026-11-18T14:00:00Z'),
    isStartBoundary: true,
  });
});

test('estrutura das abas remove categorias virtuais e duplicação de PromotionsSettings', () => {
  const productsTab = source('../src/components/cardapio/CardapioProdutosTab.tsx');
  assert.doesNotMatch(productsTab, /PROMOTIONS_VIRTUAL_CATEGORY|RECOMMENDATIONS_VIRTUAL_CATEGORY/);

  const onlineMenu = source('../src/components/caixa/online-menu/CashierOnlineMenu.tsx');
  assert.doesNotMatch(onlineMenu, /<PromotionsSettings/);

  const svg = source('../public/brand/cashier/promotions-empty-v1.svg');
  assert.match(svg, /viewBox="0 0 160 120"/);
  assert.match(svg, /fill="none"/);
  assert.doesNotMatch(svg, /<filter|<linearGradient|<radialGradient|<script|<style/i);
});

test('promoções universais suportam Compre e Ganhe (brinde simples ou produto), Combo (2-4 itens) e Desconto agendado', () => {
  const simpleGift = buildSimpleGiftSuggestion(
    { id: 'p1', nome: 'Burger Artesanal', preco: 32 },
    'Refrigerante lata',
  );
  assert.deepEqual(simpleGift, {
    nome: 'Compre Burger Artesanal e ganhe Refrigerante lata',
    descricao: 'Na compra de Burger Artesanal, leve Refrigerante lata de brinde.',
    preco: '32.00',
  });
  assert.equal(buildSimpleGiftSuggestion({ id: 'p1', nome: 'Burger', preco: 32 }, ' '), null);

  const discount = buildItemDiscountSuggestion({ id: 'p2', nome: 'Pizza Calabresa', preco: 54 });
  assert.deepEqual(discount, {
    nome: 'Oferta: Pizza Calabresa',
    descricao: 'Pizza Calabresa com preço promocional por tempo limitado.',
  });

  const combo3 = buildComboSuggestion([
    { id: 'p1', nome: 'Burger', preco: 28 },
    { id: 'p2', nome: 'Batata Frita', preco: 14 },
    { id: 'p3', nome: 'Suco Natural', preco: 10 },
  ]);
  assert.deepEqual(combo3, {
    nome: 'Combo Burger + Batata Frita + Suco Natural',
    descricao: 'Inclui Burger + Batata Frita + Suco Natural com preço especial de combo.',
  });

  assert.equal(inferPromotionType({ tipo: 'compre_ganhe', componentes: [['p1']] }), 'compre_ganhe');
  assert.equal(inferPromotionType({ brinde_nome: 'Sobremesa', componentes: [['p1']] }), 'compre_ganhe');
  assert.equal(inferPromotionType({ componentes: [['p1']] }), 'desconto_item');
  assert.equal(inferPromotionType({ componentes: [['p1'], ['p2']] }), 'combo');
  assert.equal(getPromotionTypeLabel('compre_ganhe'), 'Compre e ganhe');
  assert.equal(getPromotionTypeLabel('combo'), 'Combo promocional');
  assert.equal(getPromotionTypeLabel('desconto_item'), 'Desconto agendado');
});

test('PromotionsSettings e MarmitariaOfferTemplates não possuem hardcodes de tenant/produto/preço nem drawer de bebida oculta', () => {
  const settings = source('../src/components/cardapio/PromotionsSettings.tsx');
  const legacyTemplates = source('../src/components/cardapio/MarmitariaOfferTemplates.tsx');
  const publicPage = source('../src/cardapio/CardapioPage.tsx');
  const wizard = source('../src/cardapio/components/CardapioPromotionWizard.tsx');

  for (const content of [settings, legacyTemplates]) {
    assert.doesNotMatch(content, /pitulinha|pithulinha|pituchulinha|pitchulinha/i);
    assert.doesNotMatch(content, /R\$\s*22|R\$\s*16|22\.00|16\.00/);
    assert.doesNotMatch(content, /bebida-combo|Cadastrar bebida exclusiva para o combo|Criar bebida apenas para promoções/);
    assert.doesNotMatch(content, /backdrop-blur/);
  }

  assert.match(settings, /compre_ganhe/);
  assert.match(settings, /desconto_item/);
  assert.match(settings, /brinde_nome/);
  assert.match(publicPage, /componentes\.length >= 1 && p\.componentes\.length <= 4/);
  assert.match(wizard, /steps\.length < 1[\s\S]*steps\.length > 4/);
  assert.match(wizard, /Brinde incluso:/);
});
