import type { CartItem } from './components/CardapioCartDrawer';

export interface CardapioOrderItemPayload {
  produto_id: string;
  quantidade: number;
  modificador_ids: string[];
  observacao: string;
  cliente_nome: string;
}

/** Preserve selected option identities; the server owns prices and tenant validation. */
export function buildCardapioOrderItems(
  cart: readonly CartItem[],
  customerName: string,
): CardapioOrderItemPayload[] {
  return cart.map((item) => {
    const selectedOptions = Object.values(item.selectedOptions).flat();
    const optionNames = selectedOptions.map((option) => option.name).filter(Boolean);

    return {
      produto_id: item.product.id,
      quantidade: item.quantity,
      // These IDs belong to options, not groups. Quantity is applied by the server.
      modificador_ids: selectedOptions.map((option) => option.id),
      observacao: [
        item.notes.trim(),
        optionNames.length > 0 ? `Opções: ${optionNames.join(', ')}` : '',
      ].filter(Boolean).join(' - '),
      cliente_nome: customerName,
    };
  });
}
