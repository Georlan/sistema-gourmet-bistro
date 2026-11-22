import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogPromotion, Product } from '../src/cardapio/CardapioTypes.ts';

register('./helpers/staticAssetsLoader.mjs', import.meta.url);

const { MenuPromotionsShowcase } = await import('../src/cardapio/v2/MenuPromotionsShowcase.tsx');
const promotionsCss = readFileSync(
  new URL('../src/cardapio/v2/menuPromotions.css', import.meta.url),
  'utf8',
);

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const formatPrice = (value: number) => currencyFormatter.format(value);

const catalogProducts: Product[] = [
  {
    id: 'p1',
    name: 'Smash Duplo',
    description: 'Pão brioche e dois blends',
    price: 28,
    image: 'https://cdn.example.com/smash.jpg',
    category: 'Burgers',
  },
  {
    id: 'p2',
    name: 'Batata Rústica',
    description: 'Porção média',
    price: 16,
    image: 'https://cdn.example.com/batata.jpg',
    category: 'Acompanhamentos',
  },
  {
    id: 'p3',
    name: 'Refrigerante sem foto',
    description: 'Lata 350ml',
    price: 7,
    image: '',
    category: 'Bebidas',
  },
];

const makePromo = (
  index: number,
  overrides: Partial<CatalogPromotion> = {},
): CatalogPromotion => ({
  id: `promo-${index}`,
  nome: `Oferta ${index}`,
  descricao: `Descrição real da oferta ${index}`,
  preco: 29.9 + index,
  tipo: index % 2 === 0 ? 'compre_ganhe' : 'combo',
  componentes: [['p1']],
  imagem_url: `https://cdn.example.com/promo-${index}.jpg`,
  ...overrides,
});

const renderShowcase = (promotions: CatalogPromotion[], id?: string) =>
  renderToStaticMarkup(
    createElement(MenuPromotionsShowcase, {
      id,
      promotions,
      promotionCatalogProducts: catalogProducts,
      formatPrice,
    }),
  ).replace(/\u00a0/g, ' ');

test('0 promoções não renderiza seção, arco decorativo, contador ou espaço vazio', () => {
  const html = renderShowcase([]);
  assert.equal(html, '');
  assert.doesNotMatch(html, /km-promo-showcase|km-highlights|km-promo-arc-svg/);
});

test('1 promoção renderiza layout single editorial com concordância singular "1 oferta"', () => {
  const promo = makePromo(1, {
    nome: 'Combo Smash da Casa',
    descricao: 'Burger artesanal acompanhado de fritas crocantes',
    preco: 39.9,
    tipo: 'combo',
  });
  const html = renderShowcase([promo]);

  assert.match(html, /id="cardapio-promotions-home"/);
  assert.match(html, /id="km-highlights"/);
  assert.match(html, /data-promo-layout="single"/);
  assert.match(html, /km-promo-showcase--single/);
  assert.match(html, /km-promo-track--single/);
  assert.match(html, /km-promo-card--single/);
  assert.match(html, />1 oferta</);
  assert.doesNotMatch(html, /1 ofertas/);
  assert.match(html, /Oferta especial/);
  assert.match(html, /Combo Smash da Casa/);
  assert.match(html, /R\$ 39,90/);
  assert.match(html, />Aproveitar</);
  assert.doesNotMatch(html, /de R\$|%\s*OFF/i);
  assert.match(html, /loading="eager"/);
});

test('2 promoções renderiza layout pair com concordância plural "2 ofertas" e tag Compre e ganhe', () => {
  const html = renderShowcase([
    makePromo(1, { tipo: 'combo', preco: 35 }),
    makePromo(2, { tipo: 'compre_ganhe', preco: 48.5 }),
  ]);

  assert.match(html, /data-promo-layout="pair"/);
  assert.match(html, /km-promo-showcase--pair/);
  assert.match(html, /km-promo-track--pair/);
  assert.match(html, /km-promo-card--pair/);
  assert.match(html, />2 ofertas</);
  assert.match(html, /Oferta especial/);
  assert.match(html, /Compre e ganhe/);
  assert.match(html, /R\$ 35,00/);
  assert.match(html, /R\$ 48,50/);
});

test('3 e 5 promoções renderizam layout carousel com priority apenas nas 2 primeiras imagens', () => {
  const threeHtml = renderShowcase([makePromo(1), makePromo(2), makePromo(3)]);
  assert.match(threeHtml, /data-promo-layout="carousel"/);
  assert.match(threeHtml, /km-promo-showcase--carousel/);
  assert.match(threeHtml, /km-promo-track--carousel/);
  assert.match(threeHtml, /km-promo-card--carousel/);
  assert.match(threeHtml, />3 ofertas</);
  assert.equal((threeHtml.match(/loading="eager"/g) || []).length, 2);
  assert.equal((threeHtml.match(/loading="lazy"/g) || []).length, 1);

  const fiveHtml = renderShowcase([
    makePromo(1),
    makePromo(2),
    makePromo(3),
    makePromo(4),
    makePromo(5),
  ]);
  assert.match(fiveHtml, /data-promo-layout="carousel"/);
  assert.match(fiveHtml, />5 ofertas</);
  assert.equal((fiveHtml.match(/loading="eager"/g) || []).length, 2);
  assert.equal((fiveHtml.match(/loading="lazy"/g) || []).length, 3);
});

test('variações extremas: título longo, sem descrição, sem imagem própria e sem imagem no catálogo', () => {
  const longTitle = 'Combo Especial Super Completo Família com Dois Hambúrgueres Duplos Artesanais Batata e Bebida';
  const html = renderShowcase([
    makePromo(1, {
      nome: longTitle,
      descricao: '   ',
      imagem_url: null,
      componentes: [['p2']],
    }),
    makePromo(2, {
      nome: 'Oferta Sem Foto',
      descricao: '',
      imagem_url: '',
      componentes: [['p3']],
    }),
  ], 'custom-promos-id');

  assert.match(html, /id="custom-promos-id"/);
  assert.match(html, new RegExp(longTitle));
  // Sem descrição real não renderiza <p class="km-promo-card__desc">
  assert.doesNotMatch(html, /km-promo-card__desc/);
  // Fallback para imagem do componente p2 quando promo.imagem_url está ausente
  assert.match(html, /src="https:\/\/cdn\.example\.com\/batata\.jpg"/);
  // Sem imagem no componente p3 usa placeholder SVG seguro e marca media--empty
  assert.match(html, /km-promo-card__media--empty/);
  assert.match(html, /src="data:image\/svg\+xml/);
});

test('menuPromotions.css aplica breakpoints e tokens --km-* sem cores fixas nem backdrop-blur', () => {
  assert.match(promotionsCss, /grid-template-columns:\s*minmax\(176px,\s*236px\)\s*minmax\(0,\s*1fr\)/);
  assert.match(promotionsCss, /@media\s*\(min-width:\s*520px\)/);
  assert.match(promotionsCss, /@media\s*\(min-width:\s*560px\)/);
  assert.match(promotionsCss, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(promotionsCss, /flex:\s*0\s+0\s+min\(78%,\s*272px\)/);
  assert.match(promotionsCss, /flex:\s*0\s+0\s+clamp\(228px,\s*72vw,\s*264px\)/);
  assert.match(promotionsCss, /flex:\s*0\s+0\s+252px/);
  assert.match(promotionsCss, /scroll-snap-type:\s*x\s+mandatory/);
  assert.match(promotionsCss, /-webkit-line-clamp:\s*2/);
  assert.doesNotMatch(promotionsCss, /#[0-9a-fA-F]{3,8}|rgba?\(|backdrop-filter|blur\(/);
});
