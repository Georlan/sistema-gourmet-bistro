import { useEffect, useRef, useState } from 'react';
import { initAnalytics, trackOperationalAction, trackOperationalScreen } from '../../../analytics';
import { ONBOARDING_SETUP_MODE_KEY } from '../../onboarding/FirstAccessOnboarding';
import type { CashierTab } from '../cashierContracts';
import {
  type SubscriptionEntitlements,
  type SubscriptionPlanId,
} from '../../../config/subscriptionPlans';
import './cashierSetupMode.css';
import { operationalEntitlementEnabled } from '../../../config/subscriptionPlans';
import {
  getCashierNavigationAction,
  getCashierNavigationTarget,
  isCashierNavigationActive,
  isCashierSetupTargetAllowed,
  normalizeCashierNavigationState,
  normalizeCashierTargetForEntitlements,
} from './cashierNavigation';

type BoundaryProps = {
  hasOnlineMenu: boolean;
  planId: SubscriptionPlanId;
  entitlements?: SubscriptionEntitlements;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
};

/**
 * A implantação reutiliza telas canônicas de cadastro/configuração, mas não
 * libera vendas, caixa, relatórios ou outras rotinas operacionais antes da
 * liberação comercial.
 */
function readSetupMode(): boolean {
  try {
    return sessionStorage.getItem(ONBOARDING_SETUP_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

const LAST_RELATIONSHIP_KEY = 'koma_relationship_last_subtab';
const LAST_BENEFIT_KEY = 'koma_relationship_last_benefit';

/** Owns persisted navigation and mobile drawer lifecycle, independent of operational controllers. */
export function useCashierNavigation({ hasOnlineMenu, planId, entitlements, showToast }: BoundaryProps) {
  const [setupMode] = useState(readSetupMode);
  // Entitlements can arrive after the session is read. Keep a gated restoration
  // request in memory, without showing restricted benefit content prematurely.
  const pendingBenefitRestore = useRef<string | null>((() => {
    const tab = sessionStorage.getItem('koma_active_tab');
    const subTab = sessionStorage.getItem('koma_active_subtab');
    return tab === 'clientes' && (subTab === 'fidelidade' || subTab === 'cupons' || subTab === 'beneficios')
      ? subTab : null;
  })());
  const normalizePlanTarget = (target: { tab: CashierTab; subTab: string }) =>
    normalizeCashierTargetForEntitlements(target, entitlements);
  const [initialNavigation] = useState(() => {
    if (new URLSearchParams(window.location.search).has("pagbank")) {
      return { tab: "impressao_salao" as CashierTab, subTab: "integracoes" };
    }
    const restored = normalizePlanTarget(normalizeCashierNavigationState(
      sessionStorage.getItem('koma_active_tab'),
      sessionStorage.getItem('koma_active_subtab'),
    ));
    if (setupMode && !isCashierSetupTargetAllowed(restored.tab, restored.subTab)) {
      return { tab: 'cardapio_digital' as CashierTab, subTab: 'cardapio_perfil' };
    }
    return restored;
  });
  const [activeTab, setActiveTab] = useState<CashierTab>(initialNavigation.tab);
  const [activeSubTab, setActiveSubTab] = useState<string>(initialNavigation.subTab);

  useEffect(() => {
    let cancelled = false;
    void initAnalytics().then(active => {
      if (active && !cancelled) trackOperationalScreen(activeTab, activeSubTab);
    });
    return () => { cancelled = true; };
  }, [activeTab, activeSubTab]);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [mobileOrdersStage, setMobileOrdersStage] = useState<'salon' | 'digital' | 'closing'>('salon');

  useEffect(() => {
    if (setupMode) document.documentElement.setAttribute('data-koma-setup-mode', 'true');
    else document.documentElement.removeAttribute('data-koma-setup-mode');
    return () => document.documentElement.removeAttribute('data-koma-setup-mode');
  }, [setupMode]);

  useEffect(() => {
    if (!isMobileSidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileSidebarOpen(false);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMobileSidebarOpen]);

  useEffect(() => {
    if (setupMode && !isCashierSetupTargetAllowed(activeTab, activeSubTab)) {
      setActiveTab('cardapio_digital');
      setActiveSubTab('cardapio_perfil');
      return;
    }

    const normalized = normalizePlanTarget(normalizeCashierNavigationState(activeTab, activeSubTab));
    if (normalized.tab !== activeTab) setActiveTab(normalized.tab);
    if (normalized.subTab !== activeSubTab) setActiveSubTab(normalized.subTab);
    sessionStorage.setItem('koma_active_tab', normalized.tab);
    sessionStorage.setItem('koma_active_subtab', normalized.subTab);
    if (normalized.tab === 'clientes') {
      sessionStorage.setItem(LAST_RELATIONSHIP_KEY, normalized.subTab);
      if (normalized.subTab === 'fidelidade' || normalized.subTab === 'cupons') {
        sessionStorage.setItem(LAST_BENEFIT_KEY, normalized.subTab);
      }
    }
  }, [activeSubTab, activeTab, setupMode, planId, entitlements]);

  useEffect(() => {
    if (!entitlements || !pendingBenefitRestore.current) return;
    const requested = pendingBenefitRestore.current;
    pendingBenefitRestore.current = null;
    if (setupMode || activeTab !== 'clientes' || activeSubTab !== 'clientes') return;
    const restored = normalizePlanTarget({ tab: 'clientes', subTab: requested });
    if (restored.tab === 'clientes' && restored.subTab === requested) {
      setActiveSubTab(requested);
    }
  }, [entitlements, setupMode, activeTab, activeSubTab]);

  const setupAllowsTarget = (tab: CashierTab, subTab: string) =>
    !setupMode || isCashierSetupTargetAllowed(tab, subTab);

  const applyNavigationTarget = (navigationId: string) => {
    // Explicit navigation supersedes any pending on-load restoration.
    pendingBenefitRestore.current = null;
    let rawTarget = getCashierNavigationTarget(navigationId);
    // The parent is an entry point, not a reset button. Preserve the last workspace.
    if (navigationId === 'clientes' && activeTab !== 'clientes') {
      rawTarget = normalizeCashierNavigationState('clientes', sessionStorage.getItem(LAST_RELATIONSHIP_KEY) || 'oportunidades');
    }
    if (navigationId === 'clientes_beneficios') {
      const last = activeTab === 'clientes' && (activeSubTab === 'fidelidade' || activeSubTab === 'cupons')
        ? activeSubTab : sessionStorage.getItem(LAST_BENEFIT_KEY);
      const loyalty = operationalEntitlementEnabled(entitlements, 'loyalty');
      const coupons = operationalEntitlementEnabled(entitlements, 'coupons');
      const benefit = last === 'cupons' && coupons ? 'cupons'
        : last === 'fidelidade' && loyalty ? 'fidelidade'
        : loyalty ? 'fidelidade' : coupons ? 'cupons' : 'clientes';
      rawTarget = { tab: 'clientes', subTab: benefit };
    }
    if (rawTarget) {
      const target = normalizePlanTarget(rawTarget);
      if (!setupAllowsTarget(target.tab, target.subTab)) {
        showToast('Esta área será liberada depois da implantação inicial.', 'info');
        return false;
      }
      setActiveTab(target.tab);
      setActiveSubTab(target.subTab);
      return true;
    }

    if (navigationId === 'dashboard') {
      if (setupMode) return false;
      setActiveTab('relatorios');
      setActiveSubTab('visao_geral');
      return true;
    }
    if (navigationId === 'configuracoes') {
      if (setupMode) return false;
      setActiveTab('configuracoes');
      setActiveSubTab('equipe');
      return true;
    }
    return false;
  };

  const handleTabChange = (tabId: string) => {
    pendingBenefitRestore.current = null;
    if (applyNavigationTarget(tabId)) return;
    const candidate = normalizePlanTarget(normalizeCashierNavigationState(tabId, ''));
    if (setupMode && !isCashierSetupTargetAllowed(candidate.tab, candidate.subTab)) {
      showToast('Esta área será liberada depois da implantação inicial.', 'info');
      return;
    }
    setActiveTab(tabId as CashierTab);
  };

  const isSidebarTabActive = (tabId: string) => {
    if (tabId === 'vendas_cozinha' && activeTab === 'operacao' && activeSubTab === 'preparo') return true;
    return isCashierNavigationActive(tabId, activeTab, activeSubTab);
  };

  const handleSidebarNavigation = (navigationId: string, closeMobile = false) => {
    const target = getCashierNavigationTarget(navigationId);
    if (target) trackOperationalAction('cashier_navigation', navigationId, 'requested');
    if (closeMobile) setIsMobileSidebarOpen(false);

    if (navigationId === 'cardapio_digital' && !hasOnlineMenu) {
      if (setupMode) {
        if (target) trackOperationalAction('cashier_navigation', navigationId, 'blocked');
        showToast('O cardápio online precisa estar disponível para concluir a implantação.', 'info');
        return;
      }
      const subscription = getCashierNavigationTarget('assinatura_pix');
      if (subscription) {
        setActiveTab(subscription.tab);
        setActiveSubTab(subscription.subTab);
        if (target) trackOperationalAction('cashier_navigation', navigationId, 'succeeded');
      }
      showToast(
        'O cardápio digital está incluído em todos os planos. Consulte a ativação com o suporte.',
        'info',
      );
      return;
    }

    if (navigationId === 'operacao' && activeTab === 'operacao') {
      if (target) trackOperationalAction('cashier_navigation', navigationId, 'succeeded');
      return;
    }
    if (navigationId === 'financeiro' && activeTab === 'financeiro') {
      if (target) trackOperationalAction('cashier_navigation', navigationId, 'succeeded');
      return;
    }
    if (navigationId === 'cardapio' && activeTab === 'cardapio') {
      if (target) trackOperationalAction('cashier_navigation', navigationId, 'succeeded');
      return;
    }
    if (navigationId === 'estoque' && activeTab === 'estoque') {
      if (target) trackOperationalAction('cashier_navigation', navigationId, 'succeeded');
      return;
    }
    if (navigationId === 'clientes' && activeTab === 'clientes') {
      if (target) trackOperationalAction('cashier_navigation', navigationId, 'succeeded');
      return;
    }
    if (navigationId === 'relatorios' && (activeTab === 'relatorios' || activeTab === 'dashboard')) {
      if (setupMode) {
        if (target) trackOperationalAction('cashier_navigation', navigationId, 'blocked');
        return;
      }
      setActiveTab('relatorios');
      if (target) trackOperationalAction('cashier_navigation', navigationId, 'succeeded');
      return;
    }
    if (navigationId === 'permissoes_cargos' && activeTab === 'permissoes_cargos') {
      if (target) trackOperationalAction('cashier_navigation', navigationId, 'succeeded');
      return;
    }

    if (getCashierNavigationAction(navigationId) === 'open-counter') {
      if (setupMode) {
        if (target) trackOperationalAction('cashier_navigation', navigationId, 'blocked');
        showToast('O Caixa será liberado depois dos 4 itens essenciais e do início do período grátis.', 'info');
        return;
      }
      window.dispatchEvent(new Event('koma-navigation-open-counter'));
    }
    applyNavigationTarget(navigationId);
    if (target) trackOperationalAction('cashier_navigation', navigationId, 'succeeded');
  };

  return {
    setupMode,
    activeTab,
    setActiveTab,
    activeSubTab,
    setActiveSubTab,
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
    mobileOrdersStage,
    setMobileOrdersStage,
    handleTabChange,
    isSidebarTabActive,
    handleSidebarNavigation,
  };
}
