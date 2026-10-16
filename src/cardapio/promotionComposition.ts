import type { Product, ProductOption } from './CardapioTypes';

export interface PromotionPartSelection {
  product: Product;
  quantity: 1;
  selectedOptions: Record<string, ProductOption[]>;
  notes: string;
}

export interface PromotionCompositionStep {
  product: Product;
  label: string;
}

// Só verifica o estado do assistente. O Order Core deverá revalidar todos
// os IDs de produto/opção, preço, quantidade e disponibilidade em transação.
export function isValidPromotionParts(
  steps: PromotionCompositionStep[],
  parts: Array<PromotionPartSelection | null | undefined>,
): parts is PromotionPartSelection[] {
  return steps.length > 0
    && steps.length === parts.length
    && steps.every((step, index) => (
      step.product.isAvailable !== false
      && parts[index]?.quantity === 1
      && parts[index]?.product.id === step.product.id
    ));
}

export function selectedPromotionExtras(
  parts: Array<PromotionPartSelection | null | undefined>,
): number {
  return parts.reduce((subtotal, part) => (
    subtotal + (part
      ? Object.values(part.selectedOptions).flat().reduce((sum, option) => sum + (option.extraPrice || 0), 0)
      : 0)
  ), 0);
}
