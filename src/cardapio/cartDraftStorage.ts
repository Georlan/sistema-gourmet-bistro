import {
  canIncrementSelectionQuantity,
  selectionCount,
  type ModifierQuantityRules,
} from "../domain/modifierQuantity";
import type { BrandConfig, Product, ProductOption } from "./CardapioTypes";
import type { CardapioFulfillment, CartItem } from "./components/CardapioCartDrawer";
import type { PromotionPartSelection } from "./promotionComposition";

export const CART_DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

export interface StoredCartDraftPart {
  productId: string;
  productNameHint?: string;
  selectedOptionIds: Record<string, string[]>;
  notes: string;
  savedProductPriceCents: number;
  savedOptionPricesCents: Record<string, number>;
}

export interface StoredCartDraftItem {
  productId: string;
  productNameHint?: string;
  quantity: number;
  selectedOptionIds: Record<string, string[]>;
  notes: string;
  savedProductPriceCents: number;
  savedOptionPricesCents: Record<string, number>;
  promotionId?: string;
  promotionNameHint?: string;
  savedPromotionPriceCents?: number;
  promotionParts?: StoredCartDraftPart[];
}

export interface StoredCartDraft {
  v: 1;
  restaurantId: string;
  savedAt: number;
  fulfillment?: CardapioFulfillment | null;
  items: StoredCartDraftItem[];
}

export interface RestoredCartDraft {
  items: CartItem[];
  fulfillment: CardapioFulfillment | null;
  issues: string[];
  skippedItems: number;
}

const cartDraftKey = (restaurantId: string | number) =>
  `koma_cart_draft:${String(restaurantId)}`;

const toCents = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
};

const isValidFulfillment = (value: unknown): value is CardapioFulfillment =>
  value === "delivery" || value === "pickup" || value === "dine_in";

const serializeSelectedOptions = (
  selectedOptions: Record<string, ProductOption[]>,
): { selectedOptionIds: Record<string, string[]>; savedOptionPricesCents: Record<string, number> } => {
  const selectedOptionIds: Record<string, string[]> = {};
  const savedOptionPricesCents: Record<string, number> = {};
  for (const [groupId, options] of Object.entries(selectedOptions || {})) {
    if (!Array.isArray(options) || options.length === 0) continue;
    selectedOptionIds[groupId] = options.map((opt) => String(opt.id));
    for (const opt of options) {
      savedOptionPricesCents[String(opt.id)] = toCents(opt.extraPrice);
    }
  }
  return { selectedOptionIds, savedOptionPricesCents };
};

export function serializeCartDraft(
  restaurantId: string | number,
  cart: readonly CartItem[],
  fulfillment?: CardapioFulfillment | null,
  now: number = Date.now(),
): StoredCartDraft {
  const items: StoredCartDraftItem[] = cart.map((item) => {
    const { selectedOptionIds, savedOptionPricesCents } = serializeSelectedOptions(item.selectedOptions);
    const base: StoredCartDraftItem = {
      productId: String(item.product.id),
      productNameHint: String(item.product.name || "").slice(0, 80),
      quantity: Math.max(1, Math.min(99, Math.trunc(Number(item.quantity) || 1))),
      selectedOptionIds,
      notes: String(item.notes || "").slice(0, 240),
      savedProductPriceCents: toCents(item.product.price),
      savedOptionPricesCents,
    };
    if (item.promotionId && Array.isArray(item.promotionParts)) {
      base.promotionId = String(item.promotionId);
      base.promotionNameHint = String(item.product.name || "").slice(0, 80);
      base.savedPromotionPriceCents = toCents(item.product.price);
      base.promotionParts = item.promotionParts.map((part) => {
        const serializedPart = serializeSelectedOptions(part.selectedOptions);
        return {
          productId: String(part.product.id),
          productNameHint: String(part.product.name || "").slice(0, 80),
          selectedOptionIds: serializedPart.selectedOptionIds,
          notes: String(part.notes || "").slice(0, 240),
          savedProductPriceCents: toCents(part.product.price),
          savedOptionPricesCents: serializedPart.savedOptionPricesCents,
        };
      });
    }
    return base;
  });

  return {
    v: 1,
    restaurantId: String(restaurantId),
    savedAt: now,
    fulfillment: isValidFulfillment(fulfillment) ? fulfillment : null,
    items,
  };
}

export function clearCartDraft(restaurantId: string | number): void {
  try {
    sessionStorage.removeItem(cartDraftKey(restaurantId));
  } catch {
    // Storage indisponível (navegação privada/restrita) não deve bloquear a compra.
  }
}

export function saveCartDraft(
  restaurantId: string | number,
  cart: readonly CartItem[],
  fulfillment?: CardapioFulfillment | null,
): void {
  if (!cart.length) {
    clearCartDraft(restaurantId);
    return;
  }
  try {
    const payload = serializeCartDraft(restaurantId, cart, fulfillment);
    sessionStorage.setItem(cartDraftKey(restaurantId), JSON.stringify(payload));
  } catch {
    // Storage indisponível ou cheio não deve impedir a montagem da sacola.
  }
}

export function loadCartDraft(
  restaurantId: string | number,
  now: number = Date.now(),
): StoredCartDraft | null {
  const key = cartDraftKey(restaurantId);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCartDraft> | null;
    if (
      !parsed
      || typeof parsed !== "object"
      || parsed.v !== 1
      || String(parsed.restaurantId) !== String(restaurantId)
      || !Array.isArray(parsed.items)
      || !Number.isFinite(Number(parsed.savedAt))
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    const age = now - Number(parsed.savedAt);
    if (age < -60_000 || age > CART_DRAFT_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return {
      v: 1,
      restaurantId: String(restaurantId),
      savedAt: Number(parsed.savedAt),
      fulfillment: isValidFulfillment(parsed.fulfillment) ? parsed.fulfillment : null,
      items: parsed.items,
    };
  } catch {
    clearCartDraft(restaurantId);
    return null;
  }
}

type CurrentGroup = {
  id: string;
  title: string;
  minSelection: number;
  maxSelection: number;
  selectionMode?: "porcoes" | "tipos";
  options: Array<ProductOption & { active?: boolean }>;
};

function currentGroups(product: Product): CurrentGroup[] {
  if (product.modifierGroups?.length) {
    return product.modifierGroups.map((group) => ({
      id: String(group.id),
      title: group.name,
      minSelection: typeof group.minSelection === "number" ? group.minSelection : (group.type === "obrigatorio" ? 1 : 0),
      maxSelection: Math.max(group.maxSelection || 1, 1),
      selectionMode: group.selectionMode,
      options: group.options.map((option) => ({
        id: String(option.id),
        name: option.name,
        extraPrice: option.extraPrice,
        active: option.active,
      })),
    }));
  }
  return (product.modifiers || []).map((modifier) => ({
    id: String(modifier.id),
    title: modifier.title,
    minSelection: modifier.required ? 1 : 0,
    maxSelection: Math.max(modifier.maxSelection || 1, 1),
    selectionMode: modifier.selectionMode,
    options: modifier.options.map((option) => ({
      id: String(option.id),
      name: option.name,
      extraPrice: option.extraPrice,
    })),
  }));
}

const rulesForGroup = (group: CurrentGroup): ModifierQuantityRules => ({
  optionIds: group.options.filter((option) => option.active !== false).map((option) => option.id),
  minSelection: group.minSelection,
  maxSelection: group.maxSelection,
  selectionMode: group.selectionMode,
});

function revalidateProductComposition(
  product: Product,
  selectedOptionIds: Record<string, string[]>,
  savedOptionPricesCents: Record<string, number>,
  issues: string[],
): { selectedOptions: Record<string, ProductOption[]>; valid: boolean } {
  const groups = currentGroups(product);
  const selectedOptions: Record<string, ProductOption[]> = {};
  groups.forEach((group) => { selectedOptions[group.id] = []; });

  for (const [groupId, optionIds] of Object.entries(selectedOptionIds || {})) {
    if (!Array.isArray(optionIds)) continue;
    const group = groups.find((candidate) => candidate.id === String(groupId));
    if (!group) {
      if (optionIds.length > 0) {
        issues.push(`${product.name}: um grupo de complementos foi alterado no cardápio.`);
      }
      continue;
    }
    const rules = rulesForGroup(group);
    for (const rawOptionId of optionIds) {
      const optionId = String(rawOptionId);
      const currentOption = group.options.find((opt) => opt.id === optionId && opt.active !== false);
      if (!currentOption) {
        issues.push(`${product.name}: uma opção escolhida não está mais disponível.`);
        continue;
      }
      const currentSelection = selectedOptions[group.id] || [];
      const currentIds = currentSelection.map((opt) => opt.id);
      if (!canIncrementSelectionQuantity(rules, currentIds, currentOption.id)) {
        issues.push(`${product.name}: o limite de “${group.title}” foi atualizado no cardápio.`);
        continue;
      }
      const savedOptCents = savedOptionPricesCents?.[optionId];
      if (Number.isFinite(savedOptCents) && toCents(currentOption.extraPrice) !== savedOptCents) {
        issues.push(`${product.name}: o valor de “${currentOption.name}” foi atualizado.`);
      }
      selectedOptions[group.id] = [
        ...currentSelection,
        {
          id: currentOption.id,
          name: currentOption.name,
          extraPrice: currentOption.extraPrice,
        },
      ];
    }
  }

  const unsatisfied = groups.filter((group) => {
    const selectedIds = (selectedOptions[group.id] || []).map((opt) => opt.id);
    return selectionCount(rulesForGroup(group), selectedIds) < group.minSelection;
  });

  if (unsatisfied.length > 0) {
    issues.push(
      `${product.name}: precisa escolher novamente ${unsatisfied.map((group) => `“${group.title}”`).join(", ")}.`,
    );
    return { selectedOptions, valid: false };
  }

  return { selectedOptions, valid: true };
}

export function restoreCartDraftFromCatalog(
  draft: StoredCartDraft,
  brand: Pick<BrandConfig, "id" | "products" | "promotions" | "promotionProducts">,
  now: number = Date.now(),
): RestoredCartDraft {
  if (String(draft.restaurantId) !== String(brand.id)) {
    return { items: [], fulfillment: null, issues: [], skippedItems: 0 };
  }

  const issues: string[] = [];
  let skippedItems = 0;
  const restored = new Map<string, CartItem>();
  const allCatalogProducts = [...(brand.products || []), ...(brand.promotionProducts || [])];

  for (const storedItem of draft.items || []) {
    if (!storedItem || typeof storedItem !== "object") continue;
    const quantity = Math.max(1, Math.min(99, Math.trunc(Number(storedItem.quantity) || 1)));

    if (storedItem.promotionId) {
      const campaign = (brand.promotions || []).find((offer) => String(offer.id) === String(storedItem.promotionId));
      const expired = Boolean(campaign?.fim_em && Date.parse(campaign.fim_em) <= now);
      if (
        !campaign
        || expired
        || !Array.isArray(storedItem.promotionParts)
        || storedItem.promotionParts.length === 0
        || storedItem.promotionParts.length !== campaign.componentes.length
      ) {
        skippedItems += quantity;
        issues.push(`${storedItem.promotionNameHint || "Promoção"}: não está mais disponível.`);
        continue;
      }
      const rebuiltParts: PromotionPartSelection[] = [];
      let partsValid = true;
      for (let partIndex = 0; partIndex < storedItem.promotionParts.length; partIndex += 1) {
        const storedPart = storedItem.promotionParts[partIndex];
        const allowedIds = (campaign.componentes[partIndex] || []).map(String);
        const livePartProduct = allowedIds.includes(String(storedPart.productId))
          ? allCatalogProducts.find(
              (candidate) => String(candidate.id) === String(storedPart.productId) && candidate.isAvailable !== false,
            )
          : undefined;
        if (!livePartProduct) {
          partsValid = false;
          issues.push(`${campaign.nome}: ${storedPart.productNameHint || "um item"} não está mais disponível.`);
          break;
        }
        const revalidated = revalidateProductComposition(
          livePartProduct,
          storedPart.selectedOptionIds || {},
          storedPart.savedOptionPricesCents || {},
          issues,
        );
        if (!revalidated.valid) {
          partsValid = false;
          break;
        }
        rebuiltParts.push({
          product: livePartProduct,
          quantity: 1,
          selectedOptions: revalidated.selectedOptions,
          notes: String(storedPart.notes || "").trim(),
        });
      }
      if (!partsValid) {
        skippedItems += quantity;
        continue;
      }
      if (
        Number.isFinite(storedItem.savedPromotionPriceCents)
        && toCents(campaign.preco) !== storedItem.savedPromotionPriceCents
      ) {
        issues.push(`${campaign.nome}: o preço da promoção foi atualizado.`);
      }
      const options: Record<string, ProductOption[]> = {};
      rebuiltParts.forEach((part, index) => {
        Object.entries(part.selectedOptions).forEach(([groupId, selections]) => {
          options[`${index}:${groupId}`] = selections;
        });
      });
      const virtualProduct: Product = {
        id: `promotion:${campaign.id}`,
        name: campaign.nome,
        description: campaign.descricao,
        price: campaign.preco,
        category: "Promoções",
        image: rebuiltParts[0]?.product.image || "",
        isAvailable: true,
      };
      const partsSignature = rebuiltParts
        .map((part) => {
          const optIds = Object.values(part.selectedOptions)
            .flatMap((list) => list.map((opt) => opt.id))
            .sort()
            .join(",");
          return `${part.product.id}:${optIds}:${part.notes}`;
        })
        .join("|");
      const promoItemId = `promotion:${campaign.id}:${partsSignature}`;
      const existingPromo = restored.get(promoItemId);
      if (existingPromo) {
        existingPromo.quantity = Math.min(99, existingPromo.quantity + quantity);
      } else {
        restored.set(promoItemId, {
          id: promoItemId,
          product: virtualProduct,
          quantity,
          selectedOptions: options,
          notes: "",
          promotionId: campaign.id,
          promotionParts: rebuiltParts,
        });
      }
      continue;
    }

    const liveProduct = (brand.products || []).find(
      (candidate) => String(candidate.id) === String(storedItem.productId) && candidate.isAvailable !== false,
    );
    if (!liveProduct) {
      skippedItems += quantity;
      issues.push(`${storedItem.productNameHint || "Um item"} não está mais disponível.`);
      continue;
    }

    if (
      Number.isFinite(storedItem.savedProductPriceCents)
      && toCents(liveProduct.price) !== storedItem.savedProductPriceCents
    ) {
      issues.push(`O preço de ${liveProduct.name} foi atualizado no cardápio.`);
    }

    const revalidated = revalidateProductComposition(
      liveProduct,
      storedItem.selectedOptionIds || {},
      storedItem.savedOptionPricesCents || {},
      issues,
    );
    if (!revalidated.valid) {
      skippedItems += quantity;
      continue;
    }

    const optionIds = Object.values(revalidated.selectedOptions)
      .flatMap((list) => list.map((opt) => opt.id))
      .sort()
      .join("-");
    const notes = String(storedItem.notes || "").trim();
    const itemId = `${liveProduct.id}-${optionIds}-${notes}`;
    const existing = restored.get(itemId);
    if (existing) {
      existing.quantity = Math.min(99, existing.quantity + quantity);
    } else {
      restored.set(itemId, {
        id: itemId,
        product: liveProduct,
        quantity,
        selectedOptions: revalidated.selectedOptions,
        notes,
      });
    }
  }

  return {
    items: [...restored.values()],
    fulfillment: draft.fulfillment ?? null,
    issues: [...new Set(issues)],
    skippedItems,
  };
}
