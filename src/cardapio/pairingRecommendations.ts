/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Product } from './CardapioTypes';

export type ProductClassification = 'main' | 'side' | 'beverage' | 'dessert' | 'other';

export type CommercialRole =
  | 'Principal'
  | 'Acompanhamento'
  | 'Bebida'
  | 'Sobremesa'
  | 'Outro'
  | 'main'
  | 'side'
  | 'beverage'
  | 'dessert'
  | 'other';

const normalize = (value: string) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const BEVERAGE_MATCHER =
  /(^|\b)(bebida|bebidas|drink|drinks|refrigerante|refrigerantes|suco|sucos|cerveja|cervejas|chopp|agua|aguas|refri|cha|cha gelado|coca|guarana|soda|long neck)(\b|$)/i;

const SIDE_MATCHER =
  /(^|\b)(porcao|porcoes|acompanhamento|acompanhamentos|fritas|batata|batatas|farofa|mandioca|anel|aneis|onion|nugget|nuggets|molho|molhos|entrada|entradas|petisco|petiscos|adicional|adicionais|guarnicao|guarnicoes)(\b|$)/i;

const DESSERT_MATCHER =
  /(^|\b)(sobremesa|sobremesas|doce|doces|dessert|desserts|sorvete|sorvetes|pudim|acai|brownie|milkshake|milk-shake|torta|tortinha|petit gateau)(\b|$)/i;

const MAIN_MATCHER =
  /(^|\b)(burger|burgers|hamburguer|hamburgueres|pizza|pizzas|marmita|marmitas|marmitaria|prato|pratos|refeicao|refeicoes|lanche|lanches|sanduiche|sanduiches|combo|combos|smash|poke|salada|saladas)(\b|$)/i;

export function classifyProduct(product: Product): ProductClassification {
  // Classificação comercial explícita via propriedade ou metadata
  const explicitRole =
    (product as any).commercial_role ||
    (product as any).commercialRole ||
    (product as any).papel_comercial ||
    (product as any).papelComercial ||
    (product as any).metadata?.papel_comercial ||
    (product as any).metadata?.commercial_role;

  if (explicitRole && typeof explicitRole === 'string') {
    const norm = normalize(explicitRole);
    if (norm === 'principal' || norm === 'main') return 'main';
    if (norm === 'acompanhamento' || norm === 'side' || norm === 'porcao' || norm === 'porcoes') return 'side';
    if (norm === 'bebida' || norm === 'beverage' || norm === 'bebidas') return 'beverage';
    if (norm === 'sobremesa' || norm === 'dessert' || norm === 'sobremesas' || norm === 'doce') return 'dessert';
    if (norm === 'outro' || norm === 'other') return 'other';
  }

  const cat = normalize(product.category);
  const name = normalize(product.name);

  // Um ingrediente no nome nunca transforma um prato principal em complemento.
  if (MAIN_MATCHER.test(cat) || MAIN_MATCHER.test(name)) return 'main';
  if (BEVERAGE_MATCHER.test(cat) || BEVERAGE_MATCHER.test(name)) return 'beverage';
  if (SIDE_MATCHER.test(cat) || SIDE_MATCHER.test(name)) return 'side';
  if (DESSERT_MATCHER.test(cat) || DESSERT_MATCHER.test(name)) return 'dessert';
  if (MAIN_MATCHER.test(cat) || MAIN_MATCHER.test(name)) return 'main';
  return 'other';
}

/**
 * Identifica a subfamília ou sabor de um item para evitar recomendar múltiplos
 * produtos muito semelhantes (ex.: dois sucos de sabores diferentes) na mesma vitrine de sugestões.
 */
export function getProductFamilyDiscriminator(product: Product): string {
  const n = normalize(product.name);
  if (n.startsWith('suco')) return 'suco';
  if (n.startsWith('vitamina')) return 'vitamina';
  if (
    n.startsWith('refrigerante') ||
    n.includes('coca') ||
    n.includes('guarana') ||
    n.includes('sukita') ||
    n.includes('pepsi') ||
    n.includes('fanta')
  ) {
    return 'refrigerante';
  }
  if (n.includes('batata') || n.includes('frita')) return 'batata';
  if (n.includes('sorvete') || n.includes('pudim') || n.includes('acai') || n.includes('brownie')) return 'doce';
  return product.id ? String(product.id) : n;
}

function diversifyByFamily(products: Product[]): Product[] {
  const families: Record<string, Product[]> = {};
  for (const p of products) {
    const key = getProductFamilyDiscriminator(p);
    if (!families[key]) families[key] = [];
    families[key].push(p);
  }
  const keys = Object.keys(families);
  const result: Product[] = [];
  const maxLen = Math.max(0, ...keys.map((k) => families[k].length));
  for (let i = 0; i < maxLen; i++) {
    for (const key of keys) {
      if (families[key][i]) {
        result.push(families[key][i]);
      }
    }
  }
  return result;
}

export interface PairingRecommendationsParams {
  catalog: Product[];
  cartProductIds?: (string | number)[];
  focusedProductId?: string | number | null;
  limit?: number;
  excludeCartItems?: boolean;
}

/**
 * Retorna produtos contextuais e complementares ao pedido do cliente,
 * priorizando acompanhamentos, bebidas e sobremesas de forma balanceada.
 *
 * Invariantes:
 * - Nunca recomenda o produto atualmente em foco.
 * - Nunca recomenda pratos principais (mains como burgers/pizzas/marmitas) em seções de harmonização/upsell.
 * - Se excludeCartItems for false (padrão), mantém as recomendações estáveis sem fazer cards sumirem ao adicionar.
 * - Nunca recomenda produtos indisponíveis (isAvailable === false).
 * - Se não houver complementos relevantes suficientes, retorna menos ou zero itens (nunca preenche com burgers).
 */
export function getPairingRecommendations({
  catalog,
  cartProductIds = [],
  focusedProductId = null,
  limit = 4,
  excludeCartItems = false,
}: PairingRecommendationsParams): Product[] {
  if (!catalog || catalog.length === 0 || limit <= 0) return [];

  const excludedIds = new Set<string>();
  if (focusedProductId != null) {
    excludedIds.add(String(focusedProductId));
  }
  if (excludeCartItems) {
    for (const id of cartProductIds) {
      excludedIds.add(String(id));
    }
  }

  // Apenas produtos disponíveis e não excluídos
  const eligible = catalog.filter(
    (p) => p.isAvailable !== false && !excludedIds.has(String(p.id))
  );

  if (eligible.length === 0) return [];

  const groups = { side: [] as Product[], beverage: [] as Product[], dessert: [] as Product[] };
  for (const product of eligible) {
    const kind = classifyProduct(product);
    if (kind === 'side' || kind === 'beverage' || kind === 'dessert') groups[kind].push(product);
  }

  // Diversifica subfamílias para evitar recomendar múltiplos sabores da mesma família/bebida
  const diversifiedBeverages = diversifyByFamily(groups.beverage);
  const diversifiedSides = diversifyByFamily(groups.side);
  const diversifiedDesserts = diversifyByFamily(groups.dessert);

  // A lista persistente não depende da sacola: trocar + por quantidade não
  // desloca cards nem remove o item que o cliente acabou de adicionar.
  const kinds = ['side', 'beverage', 'dessert'] as const;
  const cartIds = new Set(cartProductIds.map(String));
  const present = new Set(catalog.filter(p => cartIds.has(String(p.id))).map(classifyProduct));
  const firstKinds = excludeCartItems ? kinds.filter(kind => !present.has(kind)) : kinds;

  const firstItems = firstKinds.map((kind) => {
    if (kind === 'side') return diversifiedSides[0];
    if (kind === 'beverage') return diversifiedBeverages[0];
    return diversifiedDesserts[0];
  });

  const candidates = [
    ...firstItems,
    ...diversifiedBeverages,
    ...diversifiedSides,
    ...diversifiedDesserts,
  ];
  const seen = new Set<string>();
  return candidates.filter((product): product is Product => {
    if (!product || seen.has(String(product.id))) return false;
    seen.add(String(product.id));
    return true;
  }).slice(0, limit);
}

/** Ordered tenant picks have priority in the cart. No duplicate family,
 * unavailable SKU, already bought item or guessed price can slip in. */
export function getCartRecommendationCandidates({
  catalog,
  cartProductIds = [],
  curatedProductIds = [],
  limit = 12,
}: {
  catalog: Product[];
  cartProductIds?: (string | number)[];
  curatedProductIds?: string[];
  limit?: number;
}): Product[] {
  if (limit <= 0 || catalog.length === 0) return [];
  const cartIds = new Set(cartProductIds.map(String));
  const familiesInCart = new Set(catalog
    .filter(product => cartIds.has(String(product.id)) && product.familia_id)
    .map(product => product.familia_id));
  const eligible = (product: Product) =>
    product.isAvailable !== false
    && !cartIds.has(String(product.id))
    && (!product.familia_id || !familiesInCart.has(product.familia_id));

  if (curatedProductIds.length) {
    const catalogById = new Map(catalog.map(product => [String(product.id), product]));
    const seen = new Set<string>();
    return curatedProductIds.flatMap(id => {
      const product = catalogById.get(String(id));
      if (!product || !eligible(product) || seen.has(String(product.id))) return [];
      seen.add(String(product.id));
      return [product];
    }).slice(0, limit);
  }

  return getPairingRecommendations({
    catalog, cartProductIds, limit: catalog.length, excludeCartItems: true,
  }).filter(eligible).slice(0, limit);
}
