import type { PaymentMethodGroup } from './CardapioTypes';

export const PAYMENT_LABELS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
};
export type PaymentMethod = keyof typeof PAYMENT_LABELS;

export const PAYMENT_UNAVAILABLE_MESSAGE = 'O restaurante ainda não disponibilizou formas de pagamento para pedidos pelo cardápio. Entre em contato com a loja.';
export const PAYMENT_RESELECT_MESSAGE = 'Escolha uma forma de pagamento disponível para este restaurante.';

// Accept known labels/legacy codes only: a generic "Cartão" must not imply credit AND debit.
const PAYMENT_ALIASES: Record<string, PaymentMethod> = {
  pix: 'pix',
  dinheiro: 'dinheiro',
  credito: 'cartao_credito',
  'cartao credito': 'cartao_credito',
  'cartao de credito': 'cartao_credito',
  debito: 'cartao_debito',
  'cartao debito': 'cartao_debito',
  'cartao de debito': 'cartao_debito',
};

export function getAvailablePaymentMethods(groups?: PaymentMethodGroup[]): PaymentMethod[] {
  const result: PaymentMethod[] = [];
  for (const group of groups ?? []) {
    if (typeof group?.type !== 'string') continue;
    const label = group.type.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ');
    const method = Object.hasOwn(PAYMENT_ALIASES, label) ? PAYMENT_ALIASES[label] : undefined;
    if (method && !result.includes(method)) result.push(method);
  }
  return result;
}

export function getPaymentSelectionError(method: PaymentMethod | null | undefined, available: PaymentMethod[]): string | null {
  if (available.length === 0) return PAYMENT_UNAVAILABLE_MESSAGE;
  return method && available.includes(method) ? null : PAYMENT_RESELECT_MESSAGE;
}

export function resolvePaymentSelection(
  selection: { restaurantId: string; method: PaymentMethod | null },
  restaurantId: string | number,
  available: PaymentMethod[],
): PaymentMethod | null {
  return selection.restaurantId === String(restaurantId) && !getPaymentSelectionError(selection.method, available)
    ? selection.method : null;
}
