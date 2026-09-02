import { useEffect, useState } from 'react';
import type { CashierTab } from '../cashierContracts';
import {
  getCashierNavigationAction,
  getCashierNavigationParentId,
  getCashierNavigationTarget,
} from './cashierNavigation';

type BoundaryProps = {
  hasOnlineMenu: boolean;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
};

/** Owns persisted navigation and mobile drawer lifecycle, independent of operational controllers. */
export function useCashierNavigation({ hasOnlineMenu, showToast }: BoundaryProps) {
  const [activeTab, setActiveTab] = useState<CashierTab>(() => {
    const saved = sessionStorage.getItem('koma_active_tab');
    if (saved === 'config_cardapio' || saved === 'configuracoes_cardapio') return 'cardapio_digital';
    if (saved === 'dashboard' || saved === 'indicadores') return 'relatorios';
    if (saved === 'robo_ia' || saved === 'assistente_koma' || saved === 'chat_copiloto') return 'operacao';
    return (saved as CashierTab) || 'operacao';
  });

  const [activeSubTab, setActiveSubTab] = useState<string>(() => {
    const saved = sessionStorage.getItem('koma_active_subtab');
    const savedTab = sessionStorage.getItem('koma_active_tab');
    if (!saved) return 'pedidos';
    if (saved === 'fila_pedidos') return 'pedidos';
    if (saved === 'terminal_balcao' || saved === 'pdv') return 'balcao';
    if (saved === 'layout_salao' || saved === 'salon') return 'mesas';
    if (['insumos', 'estoque_insumos'].includes(saved)) return 'insumos';
    if (savedTab === 'estoque' && ['xml', 'notas', 'entradas', 'movimentacoes', 'historico'].includes(saved))
      return 'historico';
    if (savedTab === 'estoque' && ['contagem', 'inventario'].includes(saved)) return 'inventario';
    // Caixa mappings
    if (['fluxo', 'turno_atual'].includes(saved)) return 'turno_atual';
    if (['ajustes', 'ajustes_caixa', 'movimentacoes', 'suprimento', 'sangria'].includes(saved))
      return 'movimentacoes';
    if (['conferencia', 'conferencia_cega', 'fechamento'].includes(saved)) return 'fechamento';
    if (['demonstrativo_dre', 'dre', 'fluxo_caixa', 'financeiro'].includes(saved)) return 'financeiro';
    // Relatórios mappings — 'equipe' is now a valid sub-tab in relatórios
    if (
      [
        'visao_geral',
        'metas',
        'vendas',
        'indicadores',
        'dashboard',
        'relatorio_garçons',
        'faturamento_garcom',
      ].includes(saved)
    )
      return 'visao_geral';
    if (['equipe', 'desempenho_equipe', 'relatorio_garcons'].includes(saved)) return 'equipe';
    if (['produtos', 'produtos_mais_vendidos', 'top10', 'mais_vendidos'].includes(saved)) return 'produtos';
    if (['financeiro', 'dre', 'demonstrativo_dre'].includes(saved)) return 'financeiro';
    // Equipe lateral mappings
    if (['pessoas', 'convites'].includes(saved)) return 'pessoas';
    if (['cargos', 'cargos_permissoes', 'permissoes'].includes(saved)) return 'cargos_permissoes';
    // Clientes mappings
    if (['clientes', 'crm', 'banco_clientes'].includes(saved)) return 'clientes';
    if (['fidelidade', 'programa_fidelidade'].includes(saved)) return 'fidelidade';
    if (['cupons', 'cupom', 'descontos', 'cupons_desconto'].includes(saved)) return 'clientes';
    // Legacy assistant routes were prototypes; return users to the real order queue.
    if (
      [
        'chat_copiloto',
        'chat',
        'robo_ia',
        'prompt',
        'prompt_atendente',
        'configuracao',
        'simulador',
        'simulador_chat',
      ].includes(saved)
    )
      return 'pedidos';
    // Placeholders redirection
    if (['fiscal', 'notas_fiscais'].includes(saved)) return 'turno_atual';
    if (['recuperador', 'carrinhos_abandonados'].includes(saved)) return 'clientes';
    return saved;
  });

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
    sessionStorage.setItem('koma_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    let sanitized = activeSubTab;
    if (activeTab === 'cardapio' && activeSubTab === 'disponibilidade') {
      sanitized = 'produtos';
      setActiveSubTab('produtos');
    }
    if (activeTab === 'relatorios' || activeTab === 'dashboard') {
      if (
        ['metas', 'vendas', 'indicadores', 'relatorio_geral', 'faturamento_garcom'].includes(activeSubTab)
      ) {
        sanitized = 'visao_geral';
        setActiveSubTab('visao_geral');
      } else if (['produtos_mais_vendidos', 'top10', 'mais_vendidos'].includes(activeSubTab)) {
        sanitized = 'produtos';
        setActiveSubTab('produtos');
      } else if (['desempenho', 'relatorio_garcons', 'relatorio_garçons'].includes(activeSubTab)) {
        sanitized = 'equipe';
        setActiveSubTab('equipe');
      }
    }
    sessionStorage.setItem('koma_active_subtab', sanitized);
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

  const isExactChildActive = (navigationId: string) => {
    const parentId = getCashierNavigationParentId(navigationId);
    const target = getCashierNavigationTarget(navigationId);
    if (!parentId || !target || activeTab !== target.tab) return false;

    if (navigationId === 'caixa_turno_atual') return ['turno_atual', 'fluxo'].includes(activeSubTab);
    if (navigationId === 'caixa_movimentacoes') {
      return ['movimentacoes', 'ajustes', 'ajustes_caixa', 'suprimento', 'sangria'].includes(activeSubTab);
    }
    if (navigationId === 'caixa_fechamento') {
      return ['fechamento', 'conferencia', 'conferencia_cega'].includes(activeSubTab);
    }

    return activeSubTab === target.subTab;
  };

  const isSidebarTabActive = (tabId: string) => {
    if (getCashierNavigationParentId(tabId)) return isExactChildActive(tabId);

    return tabId === 'cardapio_digital'
      ? activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital'
      : tabId === 'permissoes_cargos'
        ? activeTab === 'permissoes_cargos' || (activeTab === 'configuracoes' && activeSubTab === 'equipe')
        : tabId === 'impressao_salao'
          ? activeTab === 'impressao_salao' ||
            (activeTab === 'configuracoes' && activeSubTab === 'impressoras')
          : tabId === 'assinatura_pix'
            ? activeTab === 'assinatura_pix' || (activeTab === 'configuracoes' && activeSubTab === 'planos')
            : tabId === 'relatorios'
              ? activeTab === 'relatorios' || activeTab === 'dashboard'
              : activeTab === tabId;
  };

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
    if (navigationId === 'permissoes_cargos' && ['pessoas', 'desempenho'].includes(activeSubTab)) {
      setActiveTab('permissoes_cargos');
      return;
    }
    if (navigationId === 'relatorios' && ['visao_geral', 'financeiro', 'produtos'].includes(activeSubTab)) {
      setActiveTab('relatorios');
      return;
    }

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
