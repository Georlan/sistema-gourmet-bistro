export type SubscriptionPlanId = 'pocket' | 'pro' | 'premium';

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  name: string;
  price: number;
  tagline: string;
  recommended?: boolean;
  features: string[];
  limitations: string[];
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
    tagline: 'O essencial para organizar uma operação pequena.',
    features: [
      'Kanban com mesas, pedidos externos e pagamentos',
      'Caixa, mesas e balcão',
      'Cardápio e estoque essenciais',
      'Relatórios operacionais básicos'
    ],
    limitations: [
      'Sem impressão automática',
      'Sem cardápio online próprio'
    ]
  },
  {
    id: 'pro',
    name: 'Kôma Pro',
    price: 149,
    tagline: 'Operação completa de salão, cozinha e gestão.',
    recommended: true,
    features: [
      'Tudo do Pocket',
      'Impressão de cozinha e fechamento',
      'Equipe, cargos e permissões',
      'Estoque e relatórios completos',
      'Pedidos de delivery e retirada no Kanban'
    ],
    limitations: [
      `Cardápio online opcional por R$ ${ONLINE_MENU_ADDON.price}/mês`
    ]
  },
  {
    id: 'premium',
    name: 'Kôma Premium',
    price: 249,
    tagline: 'Venda online e automação incluídas no plano.',
    features: [
      'Tudo do Pro',
      'Cardápio online e QR Code incluídos',
      'Gaveta de aceite para pedidos digitais',
      'Integrações com canais externos',
      'Pix online e fidelidade avançada',
      'Suporte prioritário'
    ],
    limitations: []
  }
];

export function normalizeSubscriptionPlan(plan?: string | null): SubscriptionPlanId {
  const normalized = plan?.trim().toLowerCase();

  if (normalized === 'pocket') return 'pocket';
  if (normalized === 'pro') return 'pro';
  if (normalized === 'premium') return 'premium';

  // Planos legados são preservados como Premium durante a transição,
  // evitando retirar recursos de restaurantes que já usam cardápio online.
  if (normalized === 'bistro' || normalized === 'delivery' || normalized === 'gold' || normalized === 'platinum') {
    return 'premium';
  }

  return 'pocket';
}

export function getSubscriptionPlan(plan?: string | null): SubscriptionPlan {
  const normalized = normalizeSubscriptionPlan(plan);
  return SUBSCRIPTION_PLANS.find(item => item.id === normalized) ?? SUBSCRIPTION_PLANS[0];
}
