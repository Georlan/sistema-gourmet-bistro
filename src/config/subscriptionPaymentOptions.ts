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
    label: 'Cartão de crédito',
    status: 'available',
    statusLabel: 'Disponível',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Autorize hoje sem cobrança. Seus 7 dias grátis começam só depois da implantação essencial.',
    landingSummary: '7 dias grátis completos depois de configurar o essencial, antes da primeira cobrança automática no cartão.',
    previewTitle: 'Cartão de crédito',
    previewDescription: 'O cartão é autorizado sem cobrança da mensalidade fixa no momento da contratação. Enquanto o restaurante configura dados, horários e cardápio, o trial fica preservado. Ao concluir os 3 passos essenciais, começam os 7 dias grátis e a primeira cobrança automática fica para D+7.',
    selectable: true,
  },
  {
    id: 'pix_automatic',
    label: 'Pix Automático · em validação',
    status: 'validating',
    statusLabel: 'Em validação',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Autorize uma vez no banco sem cobrança. Os 7 dias grátis começam só após a implantação essencial.',
    landingSummary: 'Pix Automático com autorização única e 7 dias grátis completos depois da configuração inicial.',
    previewTitle: 'Pix Automático · em validação',
    previewDescription: 'O cliente autoriza a recorrência uma única vez no banco. Não existe Pix à vista antecipado nem dias de bônus: a recorrência fica preservada durante a implantação e os 7 dias grátis começam somente depois dos 3 passos essenciais.',
    selectable: false,
  },
  {
    id: 'nupay',
    label: 'NuPay',
    status: 'coming_soon',
    statusLabel: 'Em breve',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Quando homologado, seguirá a mesma regra: autorize sem cobrança e preserve os 7 dias até concluir a implantação.',
    landingSummary: 'Autorização pelo app do Nubank com trial preservado durante a configuração inicial.',
    previewTitle: 'NuPay · em breve',
    previewDescription: 'NuPay exige integração própria com a infraestrutura NuPay/Nubank. Só será disponibilizado se suportar autorização recorrente e a regra canônica do KÔMA: R$ 0 de mensalidade fixa hoje, implantação sem consumir trial e 7 dias grátis completos antes da primeira cobrança.',
    selectable: false,
  },
  {
    id: 'mercado_pago',
    label: 'Mercado Pago',
    status: 'coming_soon',
    statusLabel: 'Em breve',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Quando homologado, seguirá a mesma regra: trial preservado até a implantação essencial terminar.',
    landingSummary: 'Carteira/saldo somente se o provedor permitir autorização recorrente com trial preservado durante o setup.',
    previewTitle: 'Mercado Pago · em breve',
    previewDescription: 'Carteira, saldo ou crédito do Mercado Pago só entram no checkout se puderem cumprir o mesmo contrato recorrente do KÔMA: autorização sem cobrança, implantação sem consumir trial e 7 dias grátis completos antes da primeira cobrança automática.',
    selectable: false,
  },
  {
    id: 'annual_installments',
    label: 'Anual parcelado no cartão',
    status: 'study',
    statusLabel: 'Em estudo',
    billingCycles: ['anual'],
    checkoutSummary: 'Só entra se puder preservar o trial durante a implantação e iniciar os 7 dias grátis depois do setup essencial.',
    landingSummary: 'Parcelamento anual em estudo sem consumir trial durante a configuração inicial.',
    previewTitle: 'Anual parcelado no cartão · em estudo',
    previewDescription: 'A opção só será oferecida se o provedor suportar autorização recorrente sem cobrar a mensalidade fixa durante a implantação e preservar os 7 dias grátis completos para depois do setup essencial. O KÔMA não exibirá pagamento antecipado disfarçado de trial nem dias de bônus.',
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
