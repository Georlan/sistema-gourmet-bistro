export type SubscriptionPlanId = 'pocket' | 'pro' | 'premium';

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  name: string;
  price: number;
  splitFeeRate: number;
  tagline: string;
  recommended?: boolean;
  features: string[];
  limitations: string[];
}

export const ANNUAL_DISCOUNT_RATE = 0.1;

export function getSubscriptionPricing(monthlyPrice: number) {
  const monthlyPriceInCents = Math.round(monthlyPrice * 100);
  const annualTotalInCents = Math.round(monthlyPriceInCents * 12 * (1 - ANNUAL_DISCOUNT_RATE));

  return {
    monthly: monthlyPriceInCents / 100,
    annualMonthlyEquivalent: annualTotalInCents / 12 / 100,
    annualTotal: annualTotalInCents / 100,
    annualSavings: (monthlyPriceInCents * 12 - annualTotalInCents) / 100,
  };
}

export function formatCurrency(value: number, options?: { showCurrency?: boolean }) {
  return new Intl.NumberFormat('pt-BR', {
    style: options?.showCurrency === false ? 'decimal' : 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatPercentage(rate: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rate);
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'pocket',
    name: 'Kôma Pocket',
    price: 89,
    splitFeeRate: 0.0179,
    tagline: 'Venda no salão e online sem complicação.',
    features: [
      'Mesas, comandas e balcão',
      'Cardápio digital e QR Code com pedidos no PDV',
      'Retirada e delivery no mesmo caixa',
      'Fila de preparo na tela, sem impressora',
      'Caixa, fechamento e resumo de vendas',
      'Clientes e histórico de pedidos',
    ],
    limitations: [
      'Sem KDS e impressão automática',
      'Sem estoque, fichas técnicas e financeiro completo',
      'Sem app do entregador e fidelidade',
    ]
  },
  {
    id: 'pro',
    name: 'Kôma Pro',
    price: 179,
    splitFeeRate: 0.0089,
    tagline: 'Controle operação, equipe, estoque e financeiro.',
    recommended: true,
    features: [
      'Tudo do Pocket',
      'KDS e impressão automática',
      'Estoque, fichas técnicas e financeiro',
      'Garçom web e permissões da equipe',
      'Relatórios completos para acompanhar o negócio',
    ],
    limitations: [
      'Sem app do entregador e fidelidade',
    ]
  },
  {
    id: 'premium',
    name: 'Kôma Premium',
    price: 269,
    splitFeeRate: 0.0039,
    tagline: 'Menor taxa, entregas e fidelização para escalar.',
    features: [
      'Tudo do Pro',
      'App do entregador incluído',
      'Pontos, cashback e cupons incluídos',
      'Suporte prioritário',
    ],
    limitations: []
  }
];

export interface FeatureComparisonRow {
  category: string;
  feature: string;
  pocket: boolean | string;
  pro: boolean | string;
  premium: boolean | string;
}

export const PLAN_COMPARISON_MATRIX: FeatureComparisonRow[] = [
  { category: 'Operação de Salão', feature: 'Kanban de Mesas, Comandas e Balcão', pocket: true, pro: true, premium: true },
  { category: 'Operação de Salão', feature: 'Caixa e Fechamento de Turno', pocket: true, pro: true, premium: true },
  { category: 'Operação de Salão', feature: 'Retirada e Delivery com Endereço, Taxa e Status', pocket: true, pro: true, premium: true },
  { category: 'Impressão & Cozinha', feature: 'Fila de Preparo na Tela, sem Impressora', pocket: true, pro: true, premium: true },
  { category: 'Impressão & Cozinha', feature: 'KDS Dedicado e Impressão Automática', pocket: false, pro: true, premium: true },
  { category: 'Gestão & Equipe', feature: 'Gestão de Funcionários e Permissões por Cargo', pocket: false, pro: true, premium: true },
  { category: 'Gestão & Equipe', feature: 'Relatórios Financeiros e DRE de Vendas', pocket: 'Básico', pro: 'Completo', premium: 'Completo' },
  { category: 'Gestão & Equipe', feature: 'Estoque e Fichas Técnicas', pocket: false, pro: true, premium: true },
  { category: 'Cardápio Digital', feature: 'Cardápio Online & Pedidos via QR Code', pocket: true, pro: true, premium: true },
  { category: 'Cardápio Digital', feature: 'Aceite de Pedidos Digitais no PDV', pocket: true, pro: true, premium: true },
  { category: 'Pagamento Online', feature: 'Taxa KÔMA por pedido online pago', pocket: '1,79%', pro: '0,89%', premium: '0,39%' },
  { category: 'Entrega', feature: 'App do Entregador', pocket: false, pro: false, premium: true },
  { category: 'Clientes', feature: 'Cadastro e Histórico de Clientes', pocket: true, pro: true, premium: true },
  { category: 'Clientes', feature: 'Pontos, Cashback e Cupons', pocket: false, pro: false, premium: true },
  { category: 'Suporte', feature: 'Atendimento Prioritário', pocket: false, pro: false, premium: true },
];

export function normalizeSubscriptionPlan(plan?: string | null): SubscriptionPlanId {
  const normalized = plan?.trim().toLowerCase();

  if (normalized === 'pocket') return 'pocket';
  if (normalized === 'pro') return 'pro';
  if (normalized === 'premium') return 'premium';

  // Planos legados preservados como Premium para não desativar funcionalidades.
  if (normalized === 'bistro' || normalized === 'delivery' || normalized === 'gold' || normalized === 'platinum') {
    return 'premium';
  }

  return 'pocket';
}

export function getSubscriptionPlan(plan?: string | null): SubscriptionPlan {
  const normalized = normalizeSubscriptionPlan(plan);
  return SUBSCRIPTION_PLANS.find(item => item.id === normalized) ?? SUBSCRIPTION_PLANS[0];
}

/**
 * Compatibilidade temporária com o CaixaPanel legado.
 * O cardápio online deixou de ser um add-on comercial e está incluído em todos os planos.
 */
export function isAddonIncludedInPlan(_planId: SubscriptionPlanId, featureId: 'online_menu') {
  return featureId === 'online_menu';
}
