import productContract from '../../product-contract.json';
import type { SubscriptionFeatureId } from '../config/subscriptionPlans';

export interface PlanAvailability {
  pocket: boolean;
  pro: boolean;
  premium: boolean;
}

export function getFeatureAvailability(feature: SubscriptionFeatureId): PlanAvailability {
  return {
    pocket: productContract.plans.pocket.capabilities.includes(feature),
    pro: productContract.plans.pro.capabilities.includes(feature),
    premium: productContract.plans.premium.capabilities.includes(feature),
  };
}

export function formatPlanBadge(availability: PlanAvailability): string {
  if (availability.pocket && availability.pro && availability.premium) {
    return 'TODOS OS PLANOS';
  }
  if (!availability.pocket && availability.pro && availability.premium) {
    return 'PRO E PREMIUM';
  }
  if (!availability.pocket && !availability.pro && availability.premium) {
    return 'PREMIUM';
  }
  return '';
}

export function formatPlanScopeText(availability: PlanAvailability): string {
  if (availability.pocket && availability.pro && availability.premium) {
    return 'todos os planos';
  }
  if (!availability.pocket && availability.pro && availability.premium) {
    return 'Pro e Premium';
  }
  if (!availability.pocket && !availability.pro && availability.premium) {
    return 'Premium';
  }
  return '';
}
