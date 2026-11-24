import {
  operationalEntitlementEnabled,
  type SubscriptionEntitlements,
  type SubscriptionFeatureId,
} from '../../../config/subscriptionPlans';
import {
  KOMA_NAVIGATE_GO_EVENT,
  PENDING_DEEP_LINK_KEY,
  capturePendingDeepLink,
  clearPendingDeepLink,
  consumePendingDeepLink,
  isValidDeepLinkSyntax,
  parseDeepLinkGoSyntax,
  peekPendingDeepLink,
  stripGoParamFromUrl,
} from '../../../utils/deepLinkStorage';
import {
  CASHIER_SIDEBAR_GROUPS,
  isCashierNavigationActive,
  isCashierSetupTargetAllowed,
  normalizeCashierNavigationState,
  normalizeCashierTargetForEntitlements,
  type CashierNavigationTarget,
} from './cashierNavigation';

export {
  KOMA_NAVIGATE_GO_EVENT,
  PENDING_DEEP_LINK_KEY,
  capturePendingDeepLink,
  clearPendingDeepLink,
  consumePendingDeepLink,
  peekPendingDeepLink,
  stripGoParamFromUrl,
};

export const CASHIER_DEEP_LINK_ROLES = new Set(['admin', 'gerente', 'caixa']);

export const DEEP_LINK_ROLE_RESTRICTION: Readonly<Record<string, readonly string[]>> = {
  assinatura_contrato_documentos: ['admin', 'gerente'],
  config_implantacao: ['admin', 'gerente'],
};

export interface DeepLinkCatalogEntry {
  id: string;
  label: string;
  parentId: string | null;
  target: CashierNavigationTarget;
  requiredFeatures: readonly SubscriptionFeatureId[];
  requiredAnyFeatures?: readonly SubscriptionFeatureId[];
  requiresEntitlementCheck: boolean;
}

function buildDeepLinkCatalog(): ReadonlyMap<string, DeepLinkCatalogEntry> {
  const entries = new Map<string, DeepLinkCatalogEntry>();
  for (const group of CASHIER_SIDEBAR_GROUPS) {
    for (const parent of group.items) {
      const parentFeatures: SubscriptionFeatureId[] = parent.requiredFeature ? [parent.requiredFeature] : [];
      entries.set(parent.id, {
        id: parent.id,
        label: parent.label,
        parentId: null,
        target: parent.target,
        requiredFeatures: parentFeatures,
        requiresEntitlementCheck: parentFeatures.length > 0,
      });

      for (const child of parent.children ?? []) {
        // Excluir entradas com action mutante (ex.: vendas_novo_pedido -> open-counter)
        // garante que abrir um link nunca execute alteração de estado.
        if (child.action) continue;
        const childFeatures = [...parentFeatures];
        if (child.requiredFeature && !childFeatures.includes(child.requiredFeature)) {
          childFeatures.push(child.requiredFeature);
        }
        entries.set(child.id, {
          id: child.id,
          label: child.label,
          parentId: parent.id,
          target: child.target,
          requiredFeatures: childFeatures,
          requiredAnyFeatures: child.requiredAnyFeatures,
          requiresEntitlementCheck:
            childFeatures.length > 0
            || Boolean(child.requiredAnyFeatures?.length)
            || child.id === 'vendas_cozinha',
        });
      }
    }
  }
  return entries;
}

const DEEP_LINK_CATALOG = buildDeepLinkCatalog();

export function isValidDeepLinkId(id: string | null | undefined): id is string {
  if (!isValidDeepLinkSyntax(id)) return false;
  return DEEP_LINK_CATALOG.has(id.trim().toLowerCase());
}

export function getDeepLinkCatalogEntry(id: string | null | undefined): DeepLinkCatalogEntry | undefined {
  if (!isValidDeepLinkId(id)) return undefined;
  return DEEP_LINK_CATALOG.get(id.trim().toLowerCase());
}

export function listAllowedDeepLinkIds(): string[] {
  return [...DEEP_LINK_CATALOG.keys()];
}

export function parseDeepLinkGoParam(search: string): string | null {
  const syntaxValid = parseDeepLinkGoSyntax(search);
  return syntaxValid && isValidDeepLinkId(syntaxValid) ? syntaxValid : null;
}

export type DeepLinkDeniedReason = 'invalid' | 'role' | 'entitlement' | 'onboarding_blocked';

export interface DeepLinkResolution {
  allowed: boolean;
  id?: string;
  label?: string;
  target?: CashierNavigationTarget;
  requiresSetupMode?: boolean;
  reason?: DeepLinkDeniedReason;
}

export function resolveDeepLinkTarget(
  goId: string | null | undefined,
  ctx: {
    role?: string | null;
    entitlements?: SubscriptionEntitlements;
    isSetupMode?: boolean;
    isOnboardingPending?: boolean;
  },
): DeepLinkResolution {
  const entry = getDeepLinkCatalogEntry(goId);
  if (!entry) {
    return { allowed: false, reason: 'invalid' };
  }

  const normalizedRole = String(ctx.role || '').trim().toLowerCase();
  if (!CASHIER_DEEP_LINK_ROLES.has(normalizedRole)) {
    return { allowed: false, reason: 'role' };
  }
  const restrictedRoles = DEEP_LINK_ROLE_RESTRICTION[entry.id];
  if (restrictedRoles && !restrictedRoles.includes(normalizedRole)) {
    return { allowed: false, reason: 'role' };
  }

  if (ctx.isOnboardingPending || ctx.isSetupMode) {
    if (!isCashierSetupTargetAllowed(entry.target.tab, entry.target.subTab)) {
      return { allowed: false, reason: 'onboarding_blocked' };
    }
  }

  for (const feature of entry.requiredFeatures) {
    if (!operationalEntitlementEnabled(ctx.entitlements, feature)) {
      return { allowed: false, reason: 'entitlement' };
    }
  }
  if (entry.requiredAnyFeatures?.length) {
    const anyEnabled = entry.requiredAnyFeatures.some((feature) =>
      operationalEntitlementEnabled(ctx.entitlements, feature),
    );
    if (!anyEnabled) {
      return { allowed: false, reason: 'entitlement' };
    }
  }

  const normalizedTarget = normalizeCashierTargetForEntitlements(entry.target, ctx.entitlements);
  if (
    normalizedTarget.tab !== entry.target.tab
    || (normalizedTarget.subTab !== entry.target.subTab && entry.id !== 'vendas_cozinha')
  ) {
    return { allowed: false, reason: 'entitlement' };
  }

  return {
    allowed: true,
    id: entry.id,
    label: entry.label,
    target: normalizedTarget,
    requiresSetupMode: Boolean(ctx.isOnboardingPending),
  };
}

/**
 * Resolves the canonical navigation ID for the current tab/subTab state.
 * Shared by deep linking and CustomerSupportWidget contextual reporting.
 */
export function resolveCurrentCashierNavigationId(
  activeTab: string | null | undefined,
  activeSubTab: string | null | undefined,
): string | null {
  const state = normalizeCashierNavigationState(activeTab, activeSubTab);
  const parents = CASHIER_SIDEBAR_GROUPS.flatMap((group) => group.items);

  for (const parent of parents) {
    for (const child of parent.children ?? []) {
      if (!child.navigationHidden && isCashierNavigationActive(child.id, state.tab, state.subTab)) {
        return child.id;
      }
    }
  }
  for (const parent of parents) {
    for (const child of parent.children ?? []) {
      if (child.navigationHidden && isCashierNavigationActive(child.id, state.tab, state.subTab)) {
        return child.id;
      }
    }
  }
  for (const parent of parents) {
    if (isCashierNavigationActive(parent.id, state.tab, state.subTab)) {
      return parent.id;
    }
  }
  return null;
}

export const WHATSAPP_SUPPORT_DEEP_LINKS: ReadonlyArray<{
  id: string;
  label: string;
  path: string;
}> = [
  { id: 'online_entrega', label: 'Entrega do Cardápio Online', path: '/?go=online_entrega' },
  { id: 'online_pagamentos', label: 'Pagamentos do Cardápio Online', path: '/?go=online_pagamentos' },
  { id: 'online_pedidos', label: 'Horários e regras de pedido', path: '/?go=online_pedidos' },
  { id: 'online_perfil', label: 'Loja e aparência', path: '/?go=online_perfil' },
  { id: 'online_divulgacao', label: 'Divulgação e QR Code', path: '/?go=online_divulgacao' },
  { id: 'cardapio_produtos', label: 'Produtos do Cardápio', path: '/?go=cardapio_produtos' },
  { id: 'cardapio_complementos', label: 'Complementos e opcionais', path: '/?go=cardapio_complementos' },
  { id: 'cardapio_promocoes', label: 'Promoções e vitrine', path: '/?go=cardapio_promocoes' },
  { id: 'config_impressao', label: 'Impressão', path: '/?go=config_impressao' },
  { id: 'config_mesas', label: 'Mesas do salão', path: '/?go=config_mesas' },
  { id: 'config_integracoes', label: 'Integrações (PagBank / Mercado Pago / WhatsApp)', path: '/?go=config_integracoes' },
  { id: 'caixa_turno_atual', label: 'Turno atual do Caixa', path: '/?go=caixa_turno_atual' },
  { id: 'vendas_pedidos', label: 'Painel de pedidos', path: '/?go=vendas_pedidos' },
];
