import type { Product as CardapioProduct, ProductModifier } from '../../../cardapio/CardapioTypes';
import type { PromotionPartSelection } from '../../../cardapio/promotionComposition';
import type { CatalogModifierGroup } from '../../../catalog/catalog';
import { getEffectiveProductPrice } from '../../../domain/productMerchandising';
import type { Product } from '../../../types';
import { normalizeSlotQuantities, type PromotionType } from '../../../utils/promotionFormHelpers';
import { pdvProductNeedsRequiredChoices } from './pdvProductChoices';

export interface PdvPromotion {
  id: string;
  nome: string;
  descricao?: string;
  preco: number;
  tipo?: PromotionType;
  brinde_nome?: string | null;
  componentes: string[][];
  quantidades?: number[];
  ativo: boolean;
  inicio_em?: string | null;
  fim_em?: string | null;
  status?: 'agendada' | 'ativa' | 'pausada' | 'encerrada';
}

export interface PdvPromotionCartItemLike {
  quantity: number;
  promotionId?: string;
}

export function filterActivePdvPromotions(
  promotions: PdvPromotion[],
  nowMs: number = Date.now(),
): PdvPromotion[] {
  return promotions.filter((promo) => {
    if (promo.status) {
      return promo.status === 'ativa';
    }
    if (promo.ativo === false) return false;
    const startMs = promo.inicio_em ? Date.parse(promo.inicio_em) : NaN;
    if (Number.isFinite(startMs) && nowMs < startMs) return false;
    const endMs = promo.fim_em ? Date.parse(promo.fim_em) : NaN;
    if (Number.isFinite(endMs) && nowMs > endMs) return false;
    return true;
  });
}

export function extractPdvPromotionOrderFields(
  cartItems: PdvPromotionCartItemLike[],
): {
  promocao_id: string | undefined;
  promocao_item_indices: number[] | undefined;
} {
  const firstPromoId = cartItems.find((item) => Boolean(item.promotionId))?.promotionId;
  if (!firstPromoId) {
    return { promocao_id: undefined, promocao_item_indices: undefined };
  }

  const indices: number[] = [];
  let flatIndex = 0;
  for (const item of cartItems) {
    const qty = Math.max(0, Number(item.quantity || 0));
    for (let i = 0; i < qty; i += 1) {
      if (item.promotionId === firstPromoId) {
        indices.push(flatIndex);
      }
      flatIndex += 1;
    }
  }

  if (indices.length === 0) {
    return { promocao_id: undefined, promocao_item_indices: undefined };
  }

  return {
    promocao_id: firstPromoId,
    promocao_item_indices: indices,
  };
}

export function findPromotionStepProducts(
  promo: PdvPromotion,
  products: Product[],
): Product[] {
  return promo.componentes
    .map((ids) => products.find((candidate) => ids.includes(String(candidate.id))))
    .filter((product): product is Product => Boolean(product));
}

export function isSingleItemSimpleDiscountPromotion(
  promo: PdvPromotion,
  products: Product[],
): Product | null {
  if (promo.componentes.length !== 1) return null;
  const quantities = normalizeSlotQuantities(1, promo.quantidades);
  if (quantities[0] !== 1) return null;
  if (promo.tipo && promo.tipo !== 'desconto_item') return null;

  const product = products.find((candidate) => promo.componentes[0].includes(String(candidate.id)));
  if (!product) return null;
  if (pdvProductNeedsRequiredChoices(product)) return null;
  return product;
}

type ProductWithModifiers = Product & { grupos_modificadores?: CatalogModifierGroup[] };

export function toCardapioProduct(product: Product): CardapioProduct {
  const groups = ((product as ProductWithModifiers).grupos_modificadores || []).map<ProductModifier>((group) => {
    const min = group.min_selecoes ?? 0;
    const max = group.max_selecoes ?? 1;
    return {
      id: group.id,
      title: group.nome,
      name: group.nome,
      min,
      max,
      maxSelection: max,
      required: min > 0,
      options: (group.opcoes || []).map((opt) => ({
        id: opt.id,
        name: opt.nome,
        extraPrice: Number(opt.preco_adicional || 0),
        isAvailable: opt.ativo !== false,
      })),
    };
  });

  const effective = getEffectiveProductPrice(Number(product.preco || 0), product.preco_promocional);
  return {
    id: String(product.id),
    name: product.nome,
    description: product.descricao || '',
    price: effective.effectivePrice,
    image: product.imagem || '',
    category: product.categoria || 'Cardápio',
    isAvailable: product.ativo !== false,
    modifiers: groups,
  };
}

export function partSelectionToPdvCartFields(part: PromotionPartSelection) {
  const selectedOptions = Object.values(part.selectedOptions).flat();
  return {
    productId: part.product.id,
    obs: part.notes || '',
    modifierIds: selectedOptions.map((opt) => opt.id),
    modifiers: selectedOptions.map((opt) => ({
      id: opt.id,
      nome: opt.name,
      preco: Number(opt.extraPrice || 0),
    })),
  };
}
