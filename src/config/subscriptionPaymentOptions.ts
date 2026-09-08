export type SubscriptionBillingCycle = 'mensal' | 'anual';

export type SubscriptionPaymentOptionStatus =
  | 'available'
  | 'validating'
  | 'coming_soon'
  | 'study';

export type SubscriptionPaymentOptionId =
  | 'credit_card'
  | 'pix_annual'
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

export const SUBSCRIPTION_PAYMENT_OPTIONS: readonly SubscriptionPaymentOption[] = [
  {
    id: 'credit_card',
    label: 'Cartão de crédito · em validação',
    status: 'validating',
    statusLabel: 'Em validação',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Fluxo implementado via Mercado Pago; falta homologação das credenciais SaaS em produção.',
    landingSummary: 'Cartão de crédito em homologação para mensal e anual.',
    previewTitle: 'Cartão de crédito · em validação',
    previewDescription: 'O fluxo de tokenização e assinatura já existe no código, mas só será liberado como Disponível depois de configurar as credenciais SaaS do Mercado Pago e concluir um teste real de ponta a ponta.',
    selectable: false,
  },
  {
    id: 'pix_automatic',
    label: 'Pix Automático',
    status: 'coming_soon',
    statusLabel: 'Em breve',
    billingCycles: ['mensal'],
    checkoutSummary: 'Autorização única para cobranças mensais recorrentes.',
    landingSummary: 'Recorrência mensal com autorização única no banco.',
    previewTitle: 'Pix Automático · em breve',
    previewDescription: 'O cliente autorizará a recorrência uma vez no banco e as mensalidades futuras serão cobradas conforme o ciclo. Não usaremos comprovante de Pix agendado como confirmação de pagamento.',
    selectable: false,
  },
  {
    id: 'pix_annual',
    label: 'Pix',
    status: 'validating',
    statusLabel: 'Em validação',
    billingCycles: ['anual'],
    checkoutSummary: 'Pague pelo Pix de qualquer banco; recebimento na conta Mercado Pago do KÔMA.',
    landingSummary: 'Pix de qualquer banco com confirmação antes da ativação.',
    previewTitle: 'Pix · em validação',
    previewDescription: 'O cliente poderá pagar com Pix por qualquer banco ou carteira compatível. O QR Code será gerado pelo Mercado Pago e o restaurante só será ativado depois da confirmação real do pagamento.',
    selectable: false,
  },
  {
    id: 'nupay',
    label: 'NuPay',
    status: 'coming_soon',
    statusLabel: 'Em breve',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Autorização pelo app do Nubank, sem digitar cartão no KÔMA.',
    landingSummary: 'Autorização pelo app do Nubank quando a integração estiver homologada.',
    previewTitle: 'NuPay · em breve',
    previewDescription: 'NuPay exige integração própria com a infraestrutura NuPay/Nubank. Não vamos assumir que o valor liquida na conta Mercado Pago; a conciliação e o destino do recebimento serão definidos pela contratação real do NuPay for Business.',
    selectable: false,
  },
  {
    id: 'mercado_pago',
    label: 'Mercado Pago',
    status: 'coming_soon',
    statusLabel: 'Em breve',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Carteira, saldo ou crédito conforme disponibilidade do provedor.',
    landingSummary: 'Carteira, saldo ou crédito conforme disponibilidade do provedor.',
    previewTitle: 'Mercado Pago · em breve',
    previewDescription: 'Vamos avaliar saldo, carteira e crédito oferecido pelo próprio Mercado Pago. O KÔMA não vai subsidiar juros ou financiamento para oferecer esta opção.',
    selectable: false,
  },
  {
    id: 'annual_installments',
    label: 'Anual parcelado no cartão',
    status: 'study',
    statusLabel: 'Em estudo',
    billingCycles: ['anual'],
    checkoutSummary: 'Até 12x somente quando os juros do parcelamento ficarem com o comprador/provedor.',
    landingSummary: 'Parcelamento anual em estudo sem subsídio de juros pelo KÔMA.',
    previewTitle: 'Anual parcelado no cartão · em estudo',
    previewDescription: 'A meta é permitir até 12x e receber o total da venda anual conforme as regras do Mercado Pago, sem o KÔMA bancar os juros do parcelamento. Taxas normais do gateway e prazo de recebimento continuam sendo custos operacionais separados.',
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
