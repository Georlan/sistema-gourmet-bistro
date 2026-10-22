/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Product } from './CardapioTypes';

export type ProductClassification = 'main' | 'side' | 'beverage' | 'dessert' | 'other';

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
  const cat = normalize(product.category);
  const name = normalize(product.name);

  if (BEVERAGE_MATCHER.test(cat) || BEVERAGE_MATCHER.test(name)) return 'beverage';
  if (SIDE_MATCHER.test(cat) || SIDE_MATCHER.test(name)) return 'side';
  if (DESSERT_MATCHER.test(cat) || DESSERT_MATCHER.test(name)) return 'dessert';
  if (MAIN_MATCHER.test(cat) || MAIN_MATCHER.test(name)) return 'main';
  return 'other';
}

export interface PairingRecommendationsParams {
  catalog: Product[];
  cartProductIds?: (string | number)[];
  focusedProductId?: string | number | null;
  limit?: number;
}

/**
 * Retorna produtos contextuais e complementares ao pedido do cliente,
 * priorizando acompanhamentos, bebidas e sobremesas de forma balanceada.
 *
 * Invariantes:
 * - Nunca recomenda o produto atualmente em foco.
 * - Nunca recomenda produtos já adicionados na sacola.
 * - Nunca recomenda produtos indisponíveis (isAvailable === false).
 * - Retorna lista determinística e respeita o limite solicitado.
 */
export function getPairingRecommendations({
  catalog,
  cartProductIds = [],
  focusedProductId = null,
  limit = 4,
}: PairingRecommendationsParams): Product[] {
  if (!catalog || catalog.length === 0 || limit <= 0) return [];

  const excludedIds = new Set(cartProductIds.map(String));
  if (focusedProductId != null) {
    excludedIds.add(String(focusedProductId));
  }

  // Apenas produtos disponíveis e não excluídos
  const eligible = catalog.filter(
    (p) => p.isAvailable !== false && !excludedIds.has(String(p.id))
  );

  if (eligible.length === 0) return [];

  // Mapear produtos por categoria
  const sides: Product[] = [];
  const beverages: Product[] = [];
  const desserts: Product[] = [];
  const others: Product[] = [];
  const mains: Product[] = [];

  for (const product of eligible) {
    const classification = classifyProduct(product);
    if (classification === 'side') sides.push(product);
    else if (classification === 'beverage') beverages.push(product);
    else if (classification === 'dessert') desserts.push(product);
    else if (classification === 'main') mains.push(product);
    else others.push(product);
  }

  // Avaliar o que já está na sacola para balancear
  const cartProducts = catalog.filter((p) =>
    cartProductIds.map(String).includes(String(p.id))
  );
  const cartClassifications = new Set(cartProducts.map(classifyProduct));
  const hasBeverageInCart = cartClassifications.has('beverage');
  const hasSideInCart = cartClassifications.has('side');

  const result: Product[] = [];
  const selectedIds = new Set<string>();

  const pushIfEligible = (prod?: Product) => {
    if (!prod) return;
    if (result.length >= limit) return;
    if (selectedIds.has(String(prod.id))) return;
    selectedIds.add(String(prod.id));
    result.push(prod);
  };

  // 1. Se não tem acompanhamento no carrinho, oferecer o primeiro acompanhamento disponível
  if (!hasSideInCart && sides.length > 0) {
    pushIfEligible(sides[0]);
  }

  // 2. Se não tem bebida no carrinho, oferecer a primeira bebida disponível
  if (!hasBeverageInCart && beverages.length > 0) {
    pushIfEligible(beverages[0]);
  }

  // 3. Oferecer sobremesa
  if (desserts.length > 0) {
    pushIfEligible(desserts[0]);
  }

  // 4. Preencher com demais bebidas e acompanhamentos alternativos
  const candidatePool = [
    ...beverages.slice(hasBeverageInCart ? 0 : 1),
    ...sides.slice(hasSideInCart ? 0 : 1),
    ...desserts.slice(1),
    ...others,
    ...mains,
  ];

  for (const candidate of candidatePool) {
    if (result.length >= limit) break;
    pushIfEligible(candidate);
  }

  return result;
}
