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
export const IMPLEMENTATION_FEE = 199;

export interface SubscriptionAddon {
  id: 'online_menu' | 'delivery_app' | 'loyalty';
  name: string;
  price: number;
  description: string;
  includedIn: readonly SubscriptionPlanId[];
}

export const ONLINE_MENU_ADDON = {
  id: 'online_menu',
  name: 'Cardápio Digital Kôma',
  price: 49,
  description: 'Link e QR Code com pedidos no PDV, sem depender do app do entregador.',
  includedIn: ['pro', 'premium'],
} as const satisfies SubscriptionAddon;

export const DELIVERY_APP_ADDON = {
  id: 'delivery_app',
  name: 'App do entregador',
  price: 49,
  description: 'Pedidos, endereço, valor a cobrar e confirmação de entrega. Sem rastreamento GPS ao vivo.',
  includedIn: ['premium'],
} as const satisfies SubscriptionAddon;

export const LOYALTY_ADDON = {
  id: 'loyalty',
  name: 'Fidelidade e cupons',
  price: 69,
  description: 'Pontos, cashback e cupons para incentivar a próxima compra.',
  includedIn: ['premium'],
} as const satisfies SubscriptionAddon;

export const SUBSCRIPTION_ADDONS: readonly SubscriptionAddon[] = [
  ONLINE_MENU_ADDON,
  DELIVERY_APP_ADDON,
  LOYALTY_ADDON,
];

export function getPlanAddons(planId: SubscriptionPlanId) {
  return SUBSCRIPTION_ADDONS.map(addon => ({
    ...addon,
    included: addon.includedIn.includes(planId),
  }));
}

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

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'pocket',
    name: 'Kôma Pocket',
    price: 119,
    implementationFee: IMPLEMENTATION_FEE,
    tagline: 'Mesas e delivery organizados, mesmo sem impressora.',
    features: [
      'Mesas, comandas e balcão',
      'Retirada e delivery no mesmo caixa',
      'Fila de preparo na tela, sem impressora',
      'Caixa, fechamento e resumo de vendas',
      'Clientes e histórico de pedidos',
    ],
    limitations: [
      'Sem impressão automática de cozinha',
      'Cardápio digital, app do entregador e fidelidade opcionais',
    ]
  },
  {
    id: 'pro',
    name: 'Kôma Pro',
    price: 229,
    implementationFee: IMPLEMENTATION_FEE,
    tagline: 'Venda online e conecte sua equipe à gestão.',
    recommended: true,
    features: [
      'Tudo do Pocket',
      'Cardápio digital e QR Code com pedidos no PDV',
      'KDS e impressão automática',
      'Estoque, fichas técnicas e financeiro',
      'Garçom, permissões e relatórios completos',
    ],
    limitations: [
      'App do entregador e fidelidade opcionais',
    ]
  },
  {
    id: 'premium',
    name: 'Kôma Premium',
    price: 329,
    implementationFee: IMPLEMENTATION_FEE,
    tagline: 'Gestão, entregas e fidelização no mesmo pacote.',
    features: [
      'Tudo do Pro',
      'App do entregador incluído',
      'Pontos, cashback e cupons incluídos',
      'Cardápio digital já incluído no pacote',
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
  { category: 'Cardápio Digital', feature: 'Cardápio Online & Pedidos via QR Code', pocket: `${formatCurrency(ONLINE_MENU_ADDON.price)}/mês`, pro: true, premium: true },
  { category: 'Cardápio Digital', feature: 'Aceite de Pedidos Digitais no PDV', pocket: 'Com adicional de cardápio', pro: true, premium: true },
  { category: 'Entrega', feature: 'App do Entregador', pocket: `${formatCurrency(DELIVERY_APP_ADDON.price)}/mês`, pro: `${formatCurrency(DELIVERY_APP_ADDON.price)}/mês`, premium: true },
  { category: 'Clientes', feature: 'Cadastro e Histórico de Clientes', pocket: true, pro: true, premium: true },
  { category: 'Clientes', feature: 'Pontos, Cashback e Cupons', pocket: `${formatCurrency(LOYALTY_ADDON.price)}/mês`, pro: `${formatCurrency(LOYALTY_ADDON.price)}/mês`, premium: true },
  { category: 'Suporte', feature: 'Atendimento Prioritário', pocket: false, pro: false, premium: true },
  { category: 'Notificações', feature: 'Notificações automáticas de pedidos via WhatsApp', pocket: true, pro: true, premium: true }
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
