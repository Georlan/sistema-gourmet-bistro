export type SubscriptionPlanId = 'pocket' | 'pro' | 'premium';

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  name: string;
  price: number;
  tagline: string;
  recommended?: boolean;
  features: string[];
  limitations: string[];
  quotas: {
    iaChefRespostas: number;
    whatsappDisparos: number;
  };
  rates: {
    pixInApp: string;
    creditCard: string;
  };
}

export const ONLINE_MENU_ADDON = {
  name: 'Cardápio Online Kôma',
  price: 49,
  description: 'Link e QR Code próprios, pedidos online e gaveta de aceite no caixa.'
} as const;

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'pocket',
    name: 'Kôma Pocket',
    price: 79,
    tagline: 'O essencial para organizar uma operação de salão pequena.',
    features: [
      'Kanban com mesas, comandas e balcão',
      'Gestão de cardápio e caixa simplificados',
      'Relatórios operacionais básicos'
    ],
    limitations: [
      'Sem impressão automática de cozinha',
      'Cardápio online opcional (addon)'
    ],
    quotas: {
      iaChefRespostas: 100,
      whatsappDisparos: 100
    },
    rates: {
      pixInApp: '0,99%',
      creditCard: '2,49% + R$ 0,39'
    }
  },
  {
    id: 'pro',
    name: 'Kôma Pro',
    price: 149,
    tagline: 'Operação completa de salão, cozinha e gestão de equipe.',
    recommended: true,
    features: [
      'Tudo do Pocket',
      'Impressão automática de cozinha e fechamento',
      'Gestão de equipe, cargos e permissões RLS',
      'Relatórios financeiros e DRE completos',
      'Pedidos de delivery e retirada no Kanban'
    ],
    limitations: [
      `Cardápio online opcional por R$ ${ONLINE_MENU_ADDON.price}/mês`
    ],
    quotas: {
      iaChefRespostas: 500,
      whatsappDisparos: 500
    },
    rates: {
      pixInApp: '0,79%',
      creditCard: '1,99% + R$ 0,29'
    }
  },
  {
    id: 'premium',
    name: 'Kôma Premium',
    price: 249,
    tagline: 'Venda online, QR Code e automação total sem limites.',
    features: [
      'Tudo do Pro',
      'Cardápio online e QR Code de mesa INCLUSOS',
      'Gaveta de aceite para pedidos digitais',
      'Pix in-app com menor taxa do mercado',
      'Integrações com canais externos e iFood',
      'Suporte prioritário 24/7'
    ],
    limitations: [],
    quotas: {
      iaChefRespostas: 2500,
      whatsappDisparos: 2000
    },
    rates: {
      pixInApp: '0,49%',
      creditCard: '1,49% + R$ 0,19'
    }
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
  { category: 'Inteligência Artificial', feature: 'Chef Virtual Kôma (Copiloto IA)', pocket: '100 resp/mês', pro: '500 resp/mês', premium: '2.500 resp/mês' },
  { category: 'Notificações', feature: 'Alertas no WhatsApp (Disparos Automáticos)', pocket: '100 msgs/mês', pro: '500 msgs/mês', premium: '2.000 msgs/mês' },
  { category: 'Taxas Gateway (Asaas)', feature: 'Taxa Pix In-App por transação', pocket: '0,99%', pro: '0,79%', premium: '0,49%' },
  { category: 'Taxas Gateway (Asaas)', feature: 'Taxa Cartão de Crédito Online', pocket: '2,49% + R$0,39', pro: '1,99% + R$0,29', premium: '1,49% + R$0,19' }
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
