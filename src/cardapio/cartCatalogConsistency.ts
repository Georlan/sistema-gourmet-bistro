import { selectionWithinRules, type ModifierQuantityRules } from '../domain/modifierQuantity';
import { getEffectiveProductPrice } from '../domain/productMerchandising';
import type { CatalogPromotion, Product } from './CardapioTypes';
import type { CartItem } from './components/CardapioCartDrawer';

type PublicOption = { id?: unknown; ativo?: boolean; preco_adicional?: unknown };
type PublicGroup = {
  id?: unknown;
  tipo?: unknown;
  min_selecoes?: unknown;
  max_selecoes?: unknown;
  modo_selecao?: unknown;
  opcoes?: PublicOption[];
};
type PublicProduct = {
  id?: unknown;
  ativo?: boolean;
  preco?: unknown;
  preco_promocional?: number | null;
  grupos_modificadores?: PublicGroup[];
};
type PublicPromotion = {
  id?: unknown;
  preco?: unknown;
  fim_em?: unknown;
};

export interface CartItemCatalogDrift {
  itemId: string;
  productName: string;
  reason: 'unavailable' | 'price_changed' | 'options_changed' | 'promotion_changed';
  message: string;
  canEdit: boolean;
}

const money = (value: unknown) => Math.round(Number(value) * 100);

const formatBrl = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(value);

function groupHasRuleConstraints(group: PublicGroup): boolean {
  return (
    group.min_selecoes != null
    || group.max_selecoes != null
    || group.tipo === 'obrigatorio'
    || group.modo_selecao === 'porcoes'
    || group.modo_selecao === 'tipos'
  );
}

function publicGroupViolated(group: PublicGroup, selectedIds: string[]): boolean {
  if (!groupHasRuleConstraints(group)) return false;
  const activeOptionIds = (group.opcoes || [])
    .filter((option) => option.ativo !== false)
    .map((option) => String(option.id));
  const minSelection = group.min_selecoes != null
    ? Math.max(0, Number(group.min_selecoes) || 0)
    : (group.tipo === 'obrigatorio' ? 1 : 0);
  const maxSelection = group.max_selecoes != null
    ? Math.max(1, Number(group.max_selecoes) || 1)
    : Math.max(1, minSelection, selectedIds.length);
  const selectionMode = group.modo_selecao === 'porcoes' || group.modo_selecao === 'tipos'
    ? group.modo_selecao
    : undefined;

  if (group.max_selecoes != null && maxSelection === 1 && selectedIds.length > 1) {
    return true;
  }

  const rules: ModifierQuantityRules = {
    optionIds: activeOptionIds,
    minSelection,
    maxSelection,
    selectionMode,
  };
  return !selectionWithinRules(rules, selectedIds);
}

function isPromotionExpired(fimEm: unknown, now: number): boolean {
  if (typeof fimEm !== 'string' || !fimEm.trim()) return false;
  const parsed = Date.parse(fimEm);
  return Number.isFinite(parsed) && parsed <= now;
}

/**
 * Public catalogue snapshots are authoritative for the available composition.
 * Never silently remove a customer choice: ask them to review the affected item.
 * The backend still validates all products, tenants, rules, and prices at write time.
 */
export function findOutdatedCartProducts(
  cart: readonly CartItem[],
  snapshot: unknown,
  now: number = Date.now(),
): string[] {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Resposta inválida do cardápio.');
  }
  const data = snapshot as { produtos?: unknown; produtos_promocionais?: unknown; promocoes?: unknown };
  if (!Array.isArray(data.produtos)) {
    throw new Error('Resposta inválida do cardápio.');
  }
  const products = [...data.produtos, ...(Array.isArray(data.produtos_promocionais) ? data.produtos_promocionais : [])] as PublicProduct[];
  const byId = new Map(products.map(product => [String(product.id), product]));
  const hasPromotions = Array.isArray(data.promocoes);
  const promotionsById = hasPromotions
    ? new Map((data.promocoes as PublicPromotion[]).map((promo) => [String(promo.id), promo]))
    : null;
  const outdated = new Set<string>();

  const checkItem = (
    productId: string,
    productName: string,
    originalPrice: number,
    selected: CartItem['selectedOptions'],
    useEffectivePrice: boolean,
  ) => {
    const fresh = byId.get(productId);
    if (!fresh || fresh.ativo === false || !Number.isFinite(Number(fresh.preco))) {
      outdated.add(productName);
      return;
    }
    const freshComparablePrice = useEffectivePrice
      ? getEffectiveProductPrice(Number(fresh.preco), fresh.preco_promocional).effectivePrice
      : Number(fresh.preco);
    if (money(freshComparablePrice) !== money(originalPrice)) {
      outdated.add(productName);
      return;
    }
    for (const [groupId, choices] of Object.entries(selected)) {
      if (!choices.length) continue;
      const group = fresh.grupos_modificadores?.find(g => String(g.id) === groupId);
      if (!group || !Array.isArray(group.opcoes) || choices.some(choice => {
        const option = group.opcoes!.find(o => String(o.id) === choice.id);
        return !option || option.ativo === false || money(option.preco_adicional ?? 0) !== money(choice.extraPrice);
      })) {
        outdated.add(productName);
        return;
      }
    }
    for (const group of fresh.grupos_modificadores || []) {
      const groupId = String(group.id);
      const selectedIds = (selected[groupId] || []).map((choice) => String(choice.id));
      if (publicGroupViolated(group, selectedIds)) {
        outdated.add(productName);
        return;
      }
    }
  };

  for (const item of cart) {
    if (item.promotionId && promotionsById) {
      const campaign = promotionsById.get(String(item.promotionId));
      if (
        !campaign
        || isPromotionExpired(campaign.fim_em, now)
        || !Number.isFinite(Number(campaign.preco))
        || money(campaign.preco) !== money(item.product.price)
      ) {
        outdated.add(item.product.name);
      }
    }
    if (item.promotionParts) {
      for (const part of item.promotionParts) {
        checkItem(part.product.id, part.product.name, part.product.price, part.selectedOptions, false);
      }
    } else {
      const itemEffectivePrice = getEffectiveProductPrice(
        item.product.price,
        item.product.promotionalPrice,
      ).effectivePrice;
      checkItem(item.product.id, item.product.name, itemEffectivePrice, item.selectedOptions, true);
    }
  }
  return [...outdated];
}

function liveProductGroups(product: Product): PublicGroup[] {
  if (product.modifierGroups?.length) {
    return product.modifierGroups.map((group) => ({
      id: group.id,
      tipo: group.type,
      min_selecoes: group.minSelection,
      max_selecoes: group.maxSelection,
      modo_selecao: group.selectionMode,
      opcoes: group.options.map((option) => ({
        id: option.id,
        ativo: option.active !== false,
        preco_adicional: option.extraPrice,
      })),
    }));
  }
  return (product.modifiers || []).map((modifier) => ({
    id: modifier.id,
    tipo: modifier.required ? 'obrigatorio' : 'opcional',
    min_selecoes: modifier.required ? 1 : 0,
    max_selecoes: modifier.maxSelection,
    modo_selecao: modifier.selectionMode,
    opcoes: modifier.options.map((option) => ({
      id: option.id,
      ativo: true,
      preco_adicional: option.extraPrice,
    })),
  }));
}

function checkProductOptionsDrift(
  live: Product,
  selected: CartItem['selectedOptions'],
): boolean {
  const groups = liveProductGroups(live);
  for (const [groupId, choices] of Object.entries(selected || {})) {
    if (!choices.length) continue;
    const group = groups.find((candidate) => String(candidate.id) === String(groupId));
    if (!group || !Array.isArray(group.opcoes)) return true;
    const invalidChoice = choices.some((choice) => {
      const option = group.opcoes!.find((candidate) => String(candidate.id) === String(choice.id));
      return !option || option.ativo === false || money(option.preco_adicional ?? 0) !== money(choice.extraPrice);
    });
    if (invalidChoice) return true;
  }
  for (const group of groups) {
    const selectedIds = (selected?.[String(group.id)] || []).map((choice) => String(choice.id));
    if (publicGroupViolated(group, selectedIds)) return true;
  }
  return false;
}

/**
 * Inspect cart draft items against the live in-memory catalogue so the cart drawer
 * can surface stale prices, paused items, or changed modifier rules before checkout.
 */
export function inspectCartAgainstLiveCatalog(
  cart: readonly CartItem[],
  products: readonly Product[],
  promotions?: readonly CatalogPromotion[],
  promotionProducts?: readonly Product[],
  now: number = Date.now(),
): Map<string, CartItemCatalogDrift> {
  const drifts = new Map<string, CartItemCatalogDrift>();
  if (!cart.length || (products.length === 0 && (!promotionProducts || promotionProducts.length === 0))) {
    return drifts;
  }

  const regularById = new Map(products.map((product) => [String(product.id), product]));
  const allById = new Map(
    [...products, ...(promotionProducts || [])].map((product) => [String(product.id), product]),
  );

  for (const item of cart) {
    if (item.promotionId && item.promotionParts) {
      if (Array.isArray(promotions)) {
        const campaign = promotions.find((offer) => String(offer.id) === String(item.promotionId));
        if (!campaign || isPromotionExpired(campaign.fim_em, now)) {
          drifts.set(item.id, {
            itemId: item.id,
            productName: item.product.name,
            reason: 'promotion_changed',
            message: 'Esta promoção não está mais disponível. Remova este item para continuar.',
            canEdit: false,
          });
          continue;
        }
        if (money(campaign.preco) !== money(item.product.price)) {
          drifts.set(item.id, {
            itemId: item.id,
            productName: item.product.name,
            reason: 'promotion_changed',
            message: `Preço da promoção atualizado para ${formatBrl(campaign.preco)}. Toque em Editar montagem para atualizar.`,
            canEdit: true,
          });
          continue;
        }
      }

      let partDrift: CartItemCatalogDrift | null = null;
      for (const part of item.promotionParts) {
        const livePart = allById.get(String(part.product.id));
        if (!livePart || livePart.isAvailable === false) {
          partDrift = {
            itemId: item.id,
            productName: item.product.name,
            reason: 'unavailable',
            message: `Um item desta promoção (${part.product.name}) ficou indisponível. Remova para continuar.`,
            canEdit: false,
          };
          break;
        }
        if (
          money(livePart.price) !== money(part.product.price)
          || checkProductOptionsDrift(livePart, part.selectedOptions)
        ) {
          partDrift = {
            itemId: item.id,
            productName: item.product.name,
            reason: 'options_changed',
            message: 'As opções ou valores desta promoção mudaram no cardápio. Toque em Editar montagem para atualizar.',
            canEdit: true,
          };
          break;
        }
      }
      if (partDrift) drifts.set(item.id, partDrift);
      continue;
    }

    const live = regularById.get(String(item.product.id));
    if (!live || live.isAvailable === false) {
      drifts.set(item.id, {
        itemId: item.id,
        productName: item.product.name,
        reason: 'unavailable',
        message: 'Este produto não está mais disponível no cardápio atual. Remova para continuar.',
        canEdit: false,
      });
      continue;
    }

    if (checkProductOptionsDrift(live, item.selectedOptions)) {
      drifts.set(item.id, {
        itemId: item.id,
        productName: item.product.name,
        reason: 'options_changed',
        message: 'Opções ou regras deste item mudaram no cardápio. Toque em Editar montagem para atualizar.',
        canEdit: true,
      });
      continue;
    }

    const liveEffectivePrice = getEffectiveProductPrice(live.price, live.promotionalPrice).effectivePrice;
    const itemEffectivePrice = getEffectiveProductPrice(item.product.price, item.product.promotionalPrice).effectivePrice;
    if (money(liveEffectivePrice) !== money(itemEffectivePrice)) {
      drifts.set(item.id, {
        itemId: item.id,
        productName: item.product.name,
        reason: 'price_changed',
        message: `Preço atualizado para ${formatBrl(liveEffectivePrice)} no cardápio atual. Toque em Editar montagem para confirmar.`,
        canEdit: true,
      });
    }
  }

  return drifts;
}
