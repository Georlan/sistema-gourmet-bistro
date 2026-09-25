import { useEffect, useState } from 'react';
import { ONBOARDING_SETUP_MODE_KEY } from '../../onboarding/FirstAccessOnboarding';
import type { CashierTab } from '../cashierContracts';
import {
  type SubscriptionEntitlements,
  type SubscriptionPlanId,
} from '../../../config/subscriptionPlans';
import './cashierSetupMode.css';
import {
  getCashierNavigationAction,
  getCashierNavigationTarget,
  isCashierNavigationActive,
  normalizeCashierNavigationState,
  normalizeCashierTargetForEntitlements,
} from './cashierNavigation';

type BoundaryProps = {
  hasOnlineMenu: boolean;
  planId: SubscriptionPlanId;
  entitlements?: SubscriptionEntitlements;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
};

const SETUP_DIRECT_TABS = new Set<CashierTab>(['cardapio', 'cardapio_digital']);

/**
 * A implantação reutiliza as telas canônicas do Caixa, mas só libera os
 * destinos necessários para configurar o restaurante. Integrações técnicas
 * são permitidas apenas na tela dedicada (ex.: Mercado Pago); o restante da
 * operação continua bloqueado até os 4 itens essenciais e o início do período grátis.
 */
function setupAllowsState(tab: CashierTab, subTab: string): boolean {
  return SETUP_DIRECT_TABS.has(tab)
    || (tab === 'impressao_salao' && subTab === 'integracoes');
}

function readSetupMode(): boolean {
  try {
    return sessionStorage.getItem(ONBOARDING_SETUP_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Owns persisted navigation and mobile drawer lifecycle, independent of operational controllers. */
export function useCashierNavigation({ hasOnlineMenu, planId, entitlements, showToast }: BoundaryProps) {
  const [setupMode] = useState(readSetupMode);
  const normalizePlanTarget = (target: { tab: CashierTab; subTab: string }) =>
    normalizeCashierTargetForEntitlements(target, entitlements);
  const [initialNavigation] = useState(() => {
    const restored = normalizePlanTarget(normalizeCashierNavigationState(
      sessionStorage.getItem('koma_active_tab'),
      sessionStorage.getItem('koma_active_subtab'),
    ));
    if (setupMode && !setupAllowsState(restored.tab, restored.subTab)) {
      return { tab: 'cardapio_digital' as CashierTab, subTab: 'cardapio_perfil' };
    }
    return restored;
  });
  const [activeTab, setActiveTab] = useState<CashierTab>(initialNavigation.tab);
  const [activeSubTab, setActiveSubTab] = useState<string>(initialNavigation.subTab);

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
    if (setupMode && !setupAllowsState(activeTab, activeSubTab)) {
      setActiveTab('cardapio_digital');
      setActiveSubTab('cardapio_perfil');
      return;
    }

    const normalized = normalizePlanTarget(normalizeCashierNavigationState(activeTab, activeSubTab));
    if (normalized.tab !== activeTab) setActiveTab(normalized.tab);
    if (normalized.subTab !== activeSubTab) setActiveSubTab(normalized.subTab);
    sessionStorage.setItem('koma_active_tab', normalized.tab);
    sessionStorage.setItem('koma_active_subtab', normalized.subTab);
  }, [activeSubTab, activeTab, setupMode, planId, entitlements]);

  const setupAllowsTarget = (tab: CashierTab, subTab: string) =>
    !setupMode || setupAllowsState(tab, subTab);

  const applyNavigationTarget = (navigationId: string) => {
    const rawTarget = getCashierNavigationTarget(navigationId);
    if (rawTarget) {
      const target = normalizePlanTarget(rawTarget);
      if (!setupAllowsTarget(target.tab, target.subTab)) {
        showToast('Finalize a implantação inicial antes de acessar a operação.', 'info');
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
    if (setupMode && !SETUP_DIRECT_TABS.has(tabId as CashierTab)) {
      showToast('Finalize a implantação inicial antes de acessar a operação.', 'info');
      return;
    }
    if (!applyNavigationTarget(tabId)) setActiveTab(tabId as CashierTab);
  };

  const isSidebarTabActive = (tabId: string) => {
    if (tabId === 'vendas_cozinha' && activeTab === 'operacao' && activeSubTab === 'preparo') return true;
    return isCashierNavigationActive(tabId, activeTab, activeSubTab);
  };

  const handleSidebarNavigation = (navigationId: string, closeMobile = false) => {
    if (closeMobile) setIsMobileSidebarOpen(false);

    if (navigationId === 'cardapio_digital' && !hasOnlineMenu) {
      if (setupMode) {
        showToast('O cardápio online precisa estar disponível para concluir a implantação.', 'info');
        return;
      }
      const subscription = getCashierNavigationTarget('assinatura_pix');
      if (subscription) {
        setActiveTab(subscription.tab);
        setActiveSubTab(subscription.subTab);
      }
      showToast(
        'O cardápio digital está incluído em todos os planos. Consulte a ativação com o suporte.',
        'info',
      );
      return;
    }

    if (navigationId === 'operacao' && activeTab === 'operacao') return;
    if (navigationId === 'financeiro' && activeTab === 'financeiro') return;
    if (navigationId === 'cardapio' && activeTab === 'cardapio') return;
    if (navigationId === 'estoque' && activeTab === 'estoque') return;
    if (navigationId === 'clientes' && activeTab === 'clientes') return;
    if (navigationId === 'relatorios' && (activeTab === 'relatorios' || activeTab === 'dashboard')) {
      if (setupMode) return;
      setActiveTab('relatorios');
      return;
    }
    if (navigationId === 'permissoes_cargos' && activeTab === 'permissoes_cargos') return;

    if (getCashierNavigationAction(navigationId) === 'open-counter') {
      if (setupMode) {
        showToast('O Caixa será liberado depois dos 4 itens essenciais e do início do período grátis.', 'info');
        return;
      }
      window.dispatchEvent(new Event('koma-navigation-open-counter'));
    }
    applyNavigationTarget(navigationId);
  };

  return {
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
