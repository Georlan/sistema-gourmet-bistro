export type SubscriptionBillingCycle = 'mensal' | 'anual';

export type SubscriptionPaymentOptionStatus = 'available';

export type SubscriptionPaymentOptionId =
  | 'credit_card'
  | 'pix_automatic'
  | 'account_money';

export type SubscriptionPaymentOption = {
  id: SubscriptionPaymentOptionId;
  label: string;
  status: SubscriptionPaymentOptionStatus;
  statusLabel: 'Disponível';
  billingCycles: readonly SubscriptionBillingCycle[];
  checkoutSummary: string;
  landingSummary: string;
  previewTitle: string;
  previewDescription: string;
  selectable: boolean;
  automaticRenewal: boolean;
};

export const SUBSCRIPTION_TRIAL_DAYS = 7;

export const SUBSCRIPTION_PAYMENT_OPTIONS: readonly SubscriptionPaymentOption[] = [
  {
    id: 'credit_card',
    label: 'Cartão de crédito',
    status: 'available',
    statusLabel: 'Disponível',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Autorize hoje sem cobrança. Seus 7 dias grátis começam só depois da implantação essencial.',
    landingSummary: 'Cartão recorrente com 7 dias grátis completos depois de configurar o essencial.',
    previewTitle: 'Cartão de crédito',
    previewDescription: 'O cartão é autorizado sem cobrar a mensalidade fixa hoje. Depois da implantação essencial começam os 7 dias grátis e as cobranças seguintes são automáticas.',
    selectable: true,
    automaticRenewal: true,
  },
  {
    id: 'pix_automatic',
    label: 'Pix Automático',
    status: 'available',
    statusLabel: 'Disponível',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Autorize o Pix Automático hoje, sem cobrança. A primeira mensalidade só pode ocorrer depois da implantação e dos 7 dias grátis.',
    landingSummary: 'Pix Automático recorrente com autorização única e R$ 0 de mensalidade fixa hoje.',
    previewTitle: 'Pix Automático',
    previewDescription: 'A autorização da recorrência é concluída no ambiente seguro do Mercado Pago. O KÔMA valida o mandato Pix antes de liberar a assinatura e preserva R$ 0 hoje e os 7 dias grátis completos após a implantação essencial.',
    selectable: true,
    automaticRenewal: true,
  },
  {
    id: 'account_money',
    label: 'Saldo Mercado Pago',
    status: 'available',
    statusLabel: 'Disponível',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Autorize sua conta Mercado Pago hoje, sem cobrança da mensalidade fixa, e preserve os 7 dias grátis.',
    landingSummary: 'Cobrança recorrente pelo Saldo Mercado Pago para quem prefere usar a carteira do provedor.',
    previewTitle: 'Saldo Mercado Pago',
    previewDescription: 'A autorização ocorre no ambiente seguro do Mercado Pago. A mensalidade fixa continua R$ 0 hoje e a recorrência só começa depois da implantação essencial e dos 7 dias grátis.',
    selectable: true,
    automaticRenewal: true,
  },
] as const;

export function getSubscriptionPaymentOptions(
  billingCycle: SubscriptionBillingCycle,
): readonly SubscriptionPaymentOption[] {
  return SUBSCRIPTION_PAYMENT_OPTIONS.filter((option) =>
    option.billingCycles.includes(billingCycle),
  );
}

export function getSubscriptionPaymentOption(
  optionId: SubscriptionPaymentOptionId,
): SubscriptionPaymentOption {
  const option = SUBSCRIPTION_PAYMENT_OPTIONS.find((candidate) => candidate.id === optionId);
  if (!option) throw new Error(`Unknown subscription payment option: ${optionId}`);
  return option;
}

export function getAvailableSubscriptionPaymentOptions(
  billingCycle: SubscriptionBillingCycle,
): readonly SubscriptionPaymentOption[] {
  return getSubscriptionPaymentOptions(billingCycle).filter((option) => option.selectable);
}
