export type SubscriptionPlanId = 'pocket' | 'pro' | 'premium';

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  name: string;
  price: number;
  implementationFee: number;
  tagline: string;
  recommended?: boolean;
  features: string[];
  limitations: string[];
}

export const ANNUAL_DISCOUNT_RATE = 0.1;

export const ONLINE_MENU_ADDON = {
  name: 'Cardápio Digital Kôma',
  price: 49,
  description: 'Cardápio online com QR Code para receber pedidos diretamente no fluxo do restaurante.'
} as const;

export function getSubscriptionPricing(monthlyPrice: number) {
  const monthlyPriceInCents = Math.round(monthlyPrice * 100);
  const annualTotalInCents = Math.round(monthlyPriceInCents * 12 * (1 - ANNUAL_DISCOUNT_RATE));

  return {
    monthly: monthlyPriceInCents / 100,
    annualMonthlyEquivalent: annualTotalInCents / 12 / 100,
    annualTotal: annualTotalInCents / 100
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

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'pocket',
    name: 'Kôma Pocket',
    price: 99,
    implementationFee: 199,
    tagline: 'O essencial para organizar uma operação pequena.',
    features: [
      'Mesas, comandas e balcão',
      'Gestão de cardápio',
      'Frente de caixa',
      'Controle operacional básico',
      'Relatórios essenciais'
    ],
    limitations: [
      'Sem impressão automática de cozinha',
      'Cardápio Digital opcional (add-on)'
    ]
  },
  {
    id: 'pro',
    name: 'Kôma Pro',
    price: 199,
    implementationFee: 399,
    tagline: 'Tudo que você precisa para operar salão, cozinha e gestão em um só lugar.',
    recommended: true,
    features: [
      'Tudo do Pocket',
      'Impressão automática de cozinha e fechamento',
      'Gestão de equipe, cargos e permissões',
      'Estoque e controles operacionais completos',
      'Relatórios financeiros e gerenciais',
      'Pedidos para retirada e delivery',
      'Recursos avançados de operação'
    ],
    limitations: [
      `Cardápio Digital opcional por R$ ${ONLINE_MENU_ADDON.price}/mês`
    ]
  },
  {
    id: 'premium',
    name: 'Kôma Premium',
    price: 299,
    implementationFee: 699,
    tagline: 'Cardápio digital integrado e suporte prioritário.',
    features: [
      'Tudo do Pro',
      'Cardápio Digital + QR Code',
      'Pedidos digitais integrados ao fluxo do restaurante',
      'Suporte prioritário'
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
  { category: 'Impressão & Cozinha', feature: 'Impressão Automática de Vias na Cozinha (KDS)', pocket: false, pro: true, premium: true },
  { category: 'Gestão & Equipe', feature: 'Gestão de Funcionários e Permissões por Cargo', pocket: false, pro: true, premium: true },
  { category: 'Gestão & Equipe', feature: 'Relatórios Financeiros e DRE de Vendas', pocket: 'Básico', pro: 'Completo', premium: 'Completo' },
  { category: 'Cardápio Digital', feature: 'Cardápio Online & Pedidos via QR Code', pocket: 'R$ 49/mês', pro: 'R$ 49/mês', premium: '✓ Incluso' },
  { category: 'Cardápio Digital', feature: 'Gaveta de Aceite de Pedidos Digitais no PDV', pocket: false, pro: 'Com Addon', premium: true },
  { category: 'Notificações', feature: 'Contato manual por WhatsApp (wa.me)', pocket: true, pro: true, premium: true }
];

export function normalizeSubscriptionPlan(plan?: string | null): SubscriptionPlanId {
  const normalized = plan?.trim().toLowerCase();

  if (normalized === 'pocket') return 'pocket';
  if (normalized === 'pro') return 'pro';
  if (normalized === 'premium') return 'premium';

  // Planos legados preservados como Premium para não desativar funcionalidades
  if (normalized === 'bistro' || normalized === 'delivery' || normalized === 'gold' || normalized === 'platinum') {
    return 'premium';
  }

  return 'pocket';
}

export function getSubscriptionPlan(plan?: string | null): SubscriptionPlan {
  const normalized = normalizeSubscriptionPlan(plan);
  return SUBSCRIPTION_PLANS.find(item => item.id === normalized) ?? SUBSCRIPTION_PLANS[0];
}
