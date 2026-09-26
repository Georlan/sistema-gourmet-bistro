import productContract from '../../product-contract.json';

export type SubscriptionPlanId = 'pocket' | 'pro' | 'premium';

export type SubscriptionFeatureId = 'printing' | 'kds' | 'waiter_app' | 'loyalty' | 'coupons' | 'courier_app' | 'inventory' | 'advanced_reports';
export type SubscriptionEntitlements = Partial<Record<SubscriptionFeatureId, boolean>>;

const PLAN_FEATURES: Record<SubscriptionPlanId, ReadonlySet<SubscriptionFeatureId>> = {
  pocket: new Set(productContract.plans.pocket.capabilities as SubscriptionFeatureId[]),
  pro: new Set(productContract.plans.pro.capabilities as SubscriptionFeatureId[]),
  premium: new Set(productContract.plans.premium.capabilities as SubscriptionFeatureId[]),
};

export function subscriptionHasFeature(
  planId: SubscriptionPlanId,
  feature: SubscriptionFeatureId,
  entitlements?: SubscriptionEntitlements | null,
): boolean {
  const explicit = entitlements?.[feature];
  if (typeof explicit === 'boolean') return explicit;
  return PLAN_FEATURES[planId].has(feature);
}

/**
 * Operational surfaces never infer access from the plan slug. The backend
 * resolves plan + explicit RestauranteCapability overrides and returns the
 * effective entitlement set for the authenticated tenant. Missing state is
 * therefore denied until that authoritative response arrives.
 */
export function operationalEntitlementEnabled(
  entitlements: SubscriptionEntitlements | null | undefined,
  feature: SubscriptionFeatureId,
): boolean {
  return entitlements?.[feature] === true;
}

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
export const COMMERCIAL_PRICING_VERSION = '2026-09-pocket-annual';

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
    name: productContract.plans.pocket.name,
    price: productContract.plans.pocket.price,
    splitFeeRate: productContract.plans.pocket.split_fee_rate,
    tagline: productContract.plans.pocket.tagline,
    features: [...productContract.plans.pocket.features],
    limitations: [...productContract.plans.pocket.limitations],
  },
  {
    id: 'pro',
    name: productContract.plans.pro.name,
    price: productContract.plans.pro.price,
    splitFeeRate: productContract.plans.pro.split_fee_rate,
    tagline: productContract.plans.pro.tagline,
    recommended: productContract.plans.pro.recommended,
    features: [...productContract.plans.pro.features],
    limitations: [...productContract.plans.pro.limitations],
  },
  {
    id: 'premium',
    name: productContract.plans.premium.name,
    price: productContract.plans.premium.price,
    splitFeeRate: productContract.plans.premium.split_fee_rate,
    tagline: productContract.plans.premium.tagline,
    features: [...productContract.plans.premium.features],
    limitations: [...productContract.plans.premium.limitations],
  },
];

export interface FeatureComparisonRow {
  category: string;
  feature: string;
  pocket: boolean | string;
  pro: boolean | string;
  premium: boolean | string;
}

export const PLAN_COMPARISON_MATRIX: FeatureComparisonRow[] = productContract.comparison_matrix as FeatureComparisonRow[];

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
