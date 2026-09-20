export type SubscriptionBillingCycle = 'mensal' | 'anual';

export type SubscriptionPaymentOptionStatus = 'available';

export type SubscriptionPaymentOptionId =
  | 'credit_card'
  | 'pix'
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
    checkoutSummary: 'Autorize hoje sem cobrança. Seus 7 dias grátis começam quando você iniciar explicitamente a operação após concluir a configuração.',
    landingSummary: 'Cartão recorrente com 7 dias grátis completos a partir do início explícito da operação.',
    previewTitle: 'Cartão de crédito',
    previewDescription: 'O cartão é autorizado sem cobrar a mensalidade fixa hoje. Depois de concluir a configuração, você escolhe quando iniciar a operação; nesse clique começam os 7 dias grátis e as cobranças seguintes são automáticas.',
    selectable: true,
    automaticRenewal: true,
  },
  {
    id: 'pix',
    label: 'Pix',
    status: 'available',
    statusLabel: 'Disponível',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Pix universal por QR Code e Copia e Cola, pagável em qualquer banco/PSP Pix. R$ 0 hoje.',
    landingSummary: 'Pix universal sem conta Mercado Pago obrigatória: mensal gera novo QR a cada vencimento; anual gera um único QR do valor anual depois do trial.',
    previewTitle: 'Pix universal',
    previewDescription: 'O KÔMA não cria cobrança antecipada. Depois da implantação essencial e dos 7 dias grátis, o plano mensal gera um novo QR Code/Pix Copia e Cola a cada vencimento; no plano anual, um único Pix do total anual quita os próximos 12 meses.',
    selectable: true,
    automaticRenewal: false,
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
