import { useEffect, useState } from 'react';
import type { CashierTab } from '../cashierContracts';
import {
  getCashierNavigationAction,
  getCashierNavigationTarget,
  isCashierNavigationActive,
  normalizeCashierNavigationState,
} from './cashierNavigation';

type BoundaryProps = {
  hasOnlineMenu: boolean;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
};

/** Owns persisted navigation and mobile drawer lifecycle, independent of operational controllers. */
export function useCashierNavigation({ hasOnlineMenu, showToast }: BoundaryProps) {
  const [initialNavigation] = useState(() => normalizeCashierNavigationState(
    sessionStorage.getItem('koma_active_tab'),
    sessionStorage.getItem('koma_active_subtab'),
  ));
  const [activeTab, setActiveTab] = useState<CashierTab>(initialNavigation.tab);
  const [activeSubTab, setActiveSubTab] = useState<string>(initialNavigation.subTab);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [mobileOrdersStage, setMobileOrdersStage] = useState<'salon' | 'digital' | 'closing'>('salon');

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
    const normalized = normalizeCashierNavigationState(activeTab, activeSubTab);
    if (normalized.tab !== activeTab) setActiveTab(normalized.tab);
    if (normalized.subTab !== activeSubTab) setActiveSubTab(normalized.subTab);
    sessionStorage.setItem('koma_active_tab', normalized.tab);
    sessionStorage.setItem('koma_active_subtab', normalized.subTab);
  }, [activeSubTab, activeTab]);

  const applyNavigationTarget = (navigationId: string) => {
    const target = getCashierNavigationTarget(navigationId);
    if (target) {
      setActiveTab(target.tab);
      setActiveSubTab(target.subTab);
      return true;
    }

    // Persisted aliases that are intentionally not visible in Navigation Tree v2.
    if (navigationId === 'dashboard') {
      setActiveTab('relatorios');
      setActiveSubTab('visao_geral');
      return true;
    }
    if (navigationId === 'configuracoes') {
      setActiveTab('configuracoes');
      setActiveSubTab('equipe');
      return true;
    }
    return false;
  };

  const handleTabChange = (tabId: string) => {
    if (!applyNavigationTarget(tabId)) setActiveTab(tabId as CashierTab);
  };

  const isSidebarTabActive = (tabId: string) =>
    isCashierNavigationActive(tabId, activeTab, activeSubTab);

  const handleSidebarNavigation = (navigationId: string, closeMobile = false) => {
    if (closeMobile) setIsMobileSidebarOpen(false);

    if (navigationId === 'cardapio_digital' && !hasOnlineMenu) {
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

    // Clicking an already active parent keeps its meaningful child instead of
    // unexpectedly returning the operator to the parent's default view.
    if (navigationId === 'operacao' && activeTab === 'operacao') return;
    if (navigationId === 'financeiro' && activeTab === 'financeiro') return;
    if (navigationId === 'cardapio' && activeTab === 'cardapio') return;
    if (navigationId === 'estoque' && activeTab === 'estoque') return;
    if (navigationId === 'clientes' && activeTab === 'clientes') return;
    if (navigationId === 'relatorios' && (activeTab === 'relatorios' || activeTab === 'dashboard')) {
      setActiveTab('relatorios');
      return;
    }
    if (navigationId === 'permissoes_cargos' && activeTab === 'permissoes_cargos') return;

    if (getCashierNavigationAction(navigationId) === 'open-counter') {
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
