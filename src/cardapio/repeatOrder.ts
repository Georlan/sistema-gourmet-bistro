import type { Product, ProductOption } from "./CardapioTypes";
import type { CartItem } from "./components/CardapioCartDrawer";
import type { CustomerHistoryOrder } from "./components/CardapioCustomerOrderHistory";

export interface RepeatOrderResult {
  items: CartItem[];
  issues: string[];
  skippedItems: number;
}

type CurrentGroup = {
  id: string;
  title: string;
  minSelection: number;
  maxSelection: number;
  options: Array<ProductOption & { active?: boolean }>;
};

function currentGroups(product: Product): CurrentGroup[] {
  if (product.modifierGroups?.length) {
    return product.modifierGroups.map((group) => ({
      id: group.id,
      title: group.name,
      minSelection: Math.max(group.minSelection || 0, group.type === "obrigatorio" ? 1 : 0),
      maxSelection: Math.max(group.maxSelection || 1, 1),
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        extraPrice: option.extraPrice,
        active: option.active,
      })),
    }));
  }

  return (product.modifiers || []).map((modifier) => ({
    id: modifier.id,
    title: modifier.title,
    minSelection: modifier.required ? 1 : 0,
    maxSelection: Math.max(modifier.maxSelection || 1, 1),
    options: modifier.options,
  }));
}

export function rebuildOrderFromCurrentCatalog(
  order: CustomerHistoryOrder,
  products: Product[],
): RepeatOrderResult {
  const issues: string[] = [];
  let skippedItems = 0;
  const rebuilt = new Map<string, CartItem>();

  for (const historicalItem of order.itens || []) {
    const product = products.find((candidate) => String(candidate.id) === String(historicalItem.produto_id));
    if (!product || product.isAvailable === false) {
      skippedItems += Math.max(1, Number(historicalItem.quantidade) || 1);
      issues.push(`${historicalItem.nome}: não está mais disponível.`);
      continue;
    }

    const groups = currentGroups(product);
    const selectedOptions: Record<string, ProductOption[]> = {};
    groups.forEach((group) => { selectedOptions[group.id] = []; });

    for (const historicalModifier of historicalItem.modificadores || []) {
      const preferredGroup = historicalModifier.grupo_id
        ? groups.find((group) => group.id === historicalModifier.grupo_id)
        : undefined;
      const group = preferredGroup || groups.find((candidate) => (
        candidate.options.some((option) => option.id === historicalModifier.opcao_id)
      ));
      const currentOption = group?.options.find((option) => (
        option.id === historicalModifier.opcao_id && option.active !== false
      ));

      if (!group || !currentOption) {
        issues.push(`${product.name}: o adicional “${historicalModifier.opcao_nome}” mudou ou saiu do cardápio.`);
        continue;
      }

      const currentSelection = selectedOptions[group.id] || [];
      if (currentSelection.length >= group.maxSelection) {
        issues.push(`${product.name}: o limite atual de “${group.title}” foi reduzido.`);
        continue;
      }
      if (!currentSelection.some((option) => option.id === currentOption.id)) {
        selectedOptions[group.id] = [...currentSelection, {
          id: currentOption.id,
          name: currentOption.name,
          extraPrice: currentOption.extraPrice,
        }];
      }
    }

    const unsatisfied = groups.filter((group) => (
      (selectedOptions[group.id] || []).length < group.minSelection
    ));
    if (unsatisfied.length > 0) {
      skippedItems += Math.max(1, Number(historicalItem.quantidade) || 1);
      issues.push(
        `${product.name}: precisa escolher novamente ${unsatisfied.map((group) => `“${group.title}”`).join(", ")}.`,
      );
      continue;
    }

    const optionIds = Object.values(selectedOptions)
      .flatMap((options) => options.map((option) => option.id))
      .sort()
      .join("-");
    const notes = String(historicalItem.observacao || "").trim();
    const itemId = `${product.id}-${optionIds}-${notes}`;
    const quantity = Math.max(1, Number(historicalItem.quantidade) || 1);
    const existing = rebuilt.get(itemId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      rebuilt.set(itemId, {
        id: itemId,
        product,
        quantity,
        selectedOptions,
        notes,
      });
    }
  }

  return {
    items: [...rebuilt.values()],
    issues: [...new Set(issues)],
    skippedItems,
  };
}
