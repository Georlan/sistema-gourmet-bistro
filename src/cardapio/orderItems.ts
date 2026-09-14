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
  return cart.map((item) => {
    const selectedOptions = Object.values(item.selectedOptions).flat();
    const optionNames = summarizeOptionNames(selectedOptions).filter(Boolean);

    return {
      produto_id: item.product.id,
      quantidade: item.quantity,
      // IDs repetidos representam quantidade do mesmo adicional; o servidor é a fonte de verdade do preço.
      modificador_ids: selectedOptions.map((option) => option.id),
      observacao: [
        item.notes.trim(),
        optionNames.length > 0 ? `Opções: ${optionNames.join(', ')}` : '',
      ].filter(Boolean).join(' - '),
      cliente_nome: customerName,
    };
  });
}
