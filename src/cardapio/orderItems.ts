import type { ProductOption } from './CardapioTypes';
import type { CartItem } from './components/CardapioCartDrawer';

export interface CardapioOrderItemPayload {
  produto_id: string;
  quantidade: number;
  modificador_ids: string[];
  observacao: string;
  cliente_nome: string;
}

const summarizeOptionNames = (options: readonly ProductOption[]) => {
  const summary = new Map<string, { name: string; quantity: number }>();
  options.forEach((option) => {
    const current = summary.get(option.id);
    if (current) {
      current.quantity += 1;
      return;
    }
    summary.set(option.id, { name: option.name, quantity: 1 });
  });
  return Array.from(summary.values()).map(({ name, quantity }) => (
    quantity > 1 ? `${quantity}x ${name}` : name
  ));
};

/** Preserve selected option identities; the server owns prices and tenant validation. */
export function buildCardapioOrderItems(
  cart: readonly CartItem[],
  customerName: string,
): CardapioOrderItemPayload[] {
  const makeItem = (productId: string, quantity: number, options: Record<string, ProductOption[]>, notes: string) => {
    const selectedOptions = Object.values(options).flat();
    const optionNames = summarizeOptionNames(selectedOptions).filter(Boolean);
    return {
      produto_id: productId,
      quantidade: quantity,
      modificador_ids: selectedOptions.map((option) => option.id),
      observacao: [
        notes.trim(),
        optionNames.length > 0 ? `Opções: ${optionNames.join(', ')}` : '',
      ].filter(Boolean).join(' - '),
      cliente_nome: customerName,
    };
  };
  return cart.flatMap((item) => item.promotionParts
    ? item.promotionParts.map((part) => makeItem(part.product.id, 1, part.selectedOptions, part.notes))
    : [makeItem(item.product.id, item.quantity, item.selectedOptions, item.notes)]);
}


/** Adapt draft choices to the same presentation used by persisted orders. */
export function cardapioCompositionSource(item: CartItem) {
  return {
    composicao_agrupada: item.product.marmitaria === true,
    modificadores: Object.entries(item.selectedOptions).flatMap(([groupId, options]) => {
      const name = item.product.modifierGroups?.find(group => group.id === groupId)?.name
        || item.product.modifiers?.find(group => group.id === groupId)?.title;
      return options.map(option => ({ id: option.id, nome: option.name, preco: option.extraPrice, grupo_id: groupId, grupo_nome: name }));
    }),
  };
}

/** Positions of the actual combo parts in the flattened order, never loose extras. */
export function buildCardapioPromotionItemIndices(cart: readonly CartItem[]): number[] | undefined {
  let offset = 0;
  const indices: number[] = [];
  for (const item of cart) {
    const count = item.promotionParts?.length ?? 1;
    if (item.promotionId && item.promotionParts) {
      indices.push(...item.promotionParts.map((_, index) => offset + index));
    }
    offset += count;
  }
  return indices.length ? indices : undefined;
}
