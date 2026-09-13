export type SubscriptionBillingCycle = 'mensal' | 'anual';

export type SubscriptionPaymentOptionStatus =
  | 'available'
  | 'validating'
  | 'coming_soon'
  | 'study';

export type SubscriptionPaymentOptionId =
  | 'credit_card'
  | 'pix_automatic'
  | 'nupay'
  | 'mercado_pago'
  | 'annual_installments'
  | 'boleto';

export type SubscriptionPaymentOption = {
  id: SubscriptionPaymentOptionId;
  label: string;
  status: SubscriptionPaymentOptionStatus;
  statusLabel: 'Disponível' | 'Em validação' | 'Em breve' | 'Em estudo';
  billingCycles: readonly SubscriptionBillingCycle[];
  checkoutSummary: string;
  landingSummary: string;
  previewTitle: string;
  previewDescription: string;
  selectable: boolean;
};

export const SUBSCRIPTION_TRIAL_DAYS = 7;

export const SUBSCRIPTION_PAYMENT_OPTIONS: readonly SubscriptionPaymentOption[] = [
  {
    id: 'credit_card',
    label: 'Cartão de crédito · em validação',
    status: 'validating',
    statusLabel: 'Em validação',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Autorize hoje, use 7 dias grátis e só então comece a cobrança automática.',
    landingSummary: '7 dias grátis antes da primeira cobrança automática no cartão.',
    previewTitle: 'Cartão de crédito · em validação',
    previewDescription: 'O cartão é autorizado sem cobrança da mensalidade fixa no momento da contratação. A primeira cobrança automática acontece somente após os 7 dias grátis e segue no ciclo escolhido até o cancelamento.',
    selectable: false,
  },
  {
    id: 'pix_automatic',
    label: 'Pix Automático · em validação',
    status: 'validating',
    statusLabel: 'Em validação',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Autorize uma vez no banco, use 7 dias grátis e só então comece a cobrança automática por Pix.',
    landingSummary: 'Pix Automático com autorização única e primeira cobrança depois dos 7 dias grátis.',
    previewTitle: 'Pix Automático · em validação',
    previewDescription: 'O cliente autoriza a recorrência uma única vez no banco. Não existe Pix à vista antecipado nem dias de bônus: a mensalidade fixa fica em R$ 0 durante os primeiros 7 dias e a primeira cobrança automática ocorre somente depois do trial.',
    selectable: false,
  },
  {
    id: 'nupay',
    label: 'NuPay',
    status: 'coming_soon',
    statusLabel: 'Em breve',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Quando homologado, seguirá a mesma regra: autorize hoje, 7 dias grátis e cobrança automática depois.',
    landingSummary: 'Autorização pelo app do Nubank com 7 dias grátis antes da primeira cobrança automática.',
    previewTitle: 'NuPay · em breve',
    previewDescription: 'NuPay exige integração própria com a infraestrutura NuPay/Nubank. Só será disponibilizado se suportar autorização recorrente e a regra canônica do KÔMA: R$ 0 de mensalidade fixa hoje, 7 dias grátis e cobrança automática depois.',
    selectable: false,
  },
  {
    id: 'mercado_pago',
    label: 'Mercado Pago',
    status: 'coming_soon',
    statusLabel: 'Em breve',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Quando homologado, seguirá 7 dias grátis antes da primeira cobrança automática.',
    landingSummary: 'Carteira/saldo somente se o provedor permitir autorização recorrente com trial.',
    previewTitle: 'Mercado Pago · em breve',
    previewDescription: 'Carteira, saldo ou crédito do Mercado Pago só entram no checkout se puderem cumprir o mesmo contrato recorrente do KÔMA: autorização hoje, 7 dias grátis e primeira cobrança automática depois.',
    selectable: false,
  },
  {
    id: 'annual_installments',
    label: 'Anual parcelado no cartão',
    status: 'study',
    statusLabel: 'Em estudo',
    billingCycles: ['anual'],
    checkoutSummary: 'Só entra se puder respeitar os 7 dias grátis e iniciar a cobrança automática depois do trial.',
    landingSummary: 'Parcelamento anual em estudo sem cobrança antes do término do trial.',
    previewTitle: 'Anual parcelado no cartão · em estudo',
    previewDescription: 'A opção só será oferecida se o provedor suportar autorização recorrente sem cobrar a mensalidade fixa durante os 7 dias grátis. O KÔMA não exibirá pagamento antecipado disfarçado de trial nem dias de bônus.',
    selectable: false,
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
