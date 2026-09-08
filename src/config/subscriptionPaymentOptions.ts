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
    label: 'Cartão de crédito',
    status: 'available',
    statusLabel: 'Disponível',
    billingCycles: ['mensal', 'anual'],
    checkoutSummary: 'Ativação com cartão e 7 dias sem mensalidade fixa.',
    landingSummary: 'Cartão de crédito disponível para mensal e anual.',
    previewTitle: 'Cartão de crédito · disponível',
    previewDescription: 'Pagamento ativo no checkout. O KÔMA tokeniza o cartão pelo provedor e não armazena o número completo do cartão.',
    selectable: true,
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
    label: 'Pix anual à vista',
    status: 'validating',
    statusLabel: 'Em validação',
    billingCycles: ['anual'],
    checkoutSummary: 'Pagamento anual antecipado com ativação após confirmação.',
    landingSummary: 'Pix anual à vista, com ativação após confirmação.',
    previewTitle: 'Pix anual à vista · em validação',
    previewDescription: 'O fluxo final gerará QR Code e Pix copia e cola do total anual selecionado e só ativará o restaurante após confirmação do pagamento. Este preview não gera cobrança enquanto o método estiver em validação.',
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
    previewDescription: 'A experiência planejada é autorizar a compra pelo app do Nubank sem digitar dados do cartão no KÔMA. Parcelamento só será exibido quando vier das condições reais do provedor.',
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
    checkoutSummary: 'Parcelas conforme juros e condições do emissor, sem subsídio KÔMA.',
    landingSummary: 'Parcelamento anual em estudo, sem promessa de 12x sem juros.',
    previewTitle: 'Anual parcelado no cartão · em estudo',
    previewDescription: 'Vamos mostrar apenas parcelamentos cujos juros e condições sejam assumidos pelo comprador ou pelo provedor. Por enquanto, o KÔMA não subsidiará 12x sem juros.',
    selectable: false,
  },
  {
    id: 'boleto',
    label: 'Boleto bancário',
    status: 'study',
    statusLabel: 'Em estudo',
    billingCycles: ['anual'],
    checkoutSummary: 'Alternativa empresarial para pagamento anual antecipado.',
    landingSummary: 'Boleto anual em estudo para clientes empresariais.',
    previewTitle: 'Boleto anual · em estudo',
    previewDescription: 'Opção pensada para clientes empresariais que preferem pagamento bancário do anual. A ativação ocorrerá somente após a liquidação do valor anual.',
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
