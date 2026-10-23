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

  // Mapear apenas complementos reais (bebidas, acompanhamentos, sobremesas e itens complementares)
  // Pratos principais (mains) são expressamente excluídos de recomendações complementares
  const sides: Product[] = [];
  const beverages: Product[] = [];
  const desserts: Product[] = [];
  const others: Product[] = [];

  for (const product of eligible) {
    const classification = classifyProduct(product);
    if (classification === 'side') sides.push(product);
    else if (classification === 'beverage') beverages.push(product);
    else if (classification === 'dessert') desserts.push(product);
    else if (classification === 'other') others.push(product);
  }

  // Avaliar o que já está na sacola para balancear sugestões
  const cartProductSet = new Set(cartProductIds.map(String));
  const cartProducts = catalog.filter((p) => cartProductSet.has(String(p.id)));
  const cartClassifications = new Set(cartProducts.map(classifyProduct));
  const hasBeverageInCart = cartClassifications.has('beverage');
  const hasSideInCart = cartClassifications.has('side');
  const hasDessertInCart = cartClassifications.has('dessert');

  const result: Product[] = [];
  const selectedIds = new Set<string>();

  const pushIfEligible = (prod?: Product) => {
    if (!prod) return;
    if (result.length >= limit) return;
    if (selectedIds.has(String(prod.id))) return;
    selectedIds.add(String(prod.id));
    result.push(prod);
  };

  // Separação entre complementos ainda NÃO adicionados vs já adicionados na sacola
  const unaddedSides = sides.filter((p) => !cartProductSet.has(String(p.id)));
  const unaddedBeverages = beverages.filter((p) => !cartProductSet.has(String(p.id)));
  const unaddedDesserts = desserts.filter((p) => !cartProductSet.has(String(p.id)));
  const unaddedOthers = others.filter((p) => !cartProductSet.has(String(p.id)));

  // 1. Se não tem acompanhamento no carrinho, oferecer acompanhamento
  if (!hasSideInCart && sides.length > 0) {
    pushIfEligible(sides[0]);
  }

  // 2. Se não tem bebida no carrinho, oferecer bebida
  if (!hasBeverageInCart && beverages.length > 0) {
    pushIfEligible(beverages[0]);
  }

  // 3. Se não tem sobremesa no carrinho, oferecer sobremesa
  if (!hasDessertInCart && desserts.length > 0) {
    pushIfEligible(desserts[0]);
  }

  // 4. Se excludeCartItems for falso, incluir os complementos já presentes na sacola para manter estabilidade dos cards
  if (!excludeCartItems) {
    if (hasSideInCart && sides.length > 0) pushIfEligible(sides[0]);
    if (hasBeverageInCart && beverages.length > 0) pushIfEligible(beverages[0]);
    if (hasDessertInCart && desserts.length > 0) pushIfEligible(desserts[0]);
  }

  // 5. Preencher com demais complementos
  const candidatePool = [
    ...beverages,
    ...sides,
    ...desserts,
    ...others,
  ];

  for (const candidate of candidatePool) {
    if (result.length >= limit) break;
    pushIfEligible(candidate);
  }

  return result;
}
