import { useEffect, useState } from 'react';
import type { CashierTab } from '../cashierContracts';

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
    return (saved as any) || 'operacao';
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

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId as any);
    switch (tabId) {
      case 'dashboard':
      case 'relatorios':
        setActiveSubTab('visao_geral');
        break;
      case 'operacao':
        setActiveSubTab('pedidos');
        break;
      case 'cardapio':
        setActiveSubTab('produtos');
        break;
      case 'estoque':
        setActiveSubTab('insumos');
        break;
      case 'financeiro':
        setActiveSubTab('turno_atual');
        break;
      case 'clientes':
        setActiveSubTab('clientes');
        break;
      case 'permissoes_cargos':
        setActiveSubTab('pessoas');
        break;
      case 'impressao_salao':
        setActiveSubTab('impressoras');
        break;
      case 'assinatura_pix':
        setActiveSubTab('planos');
        break;
      case 'cardapio_digital':
        setActiveSubTab('cardapio_digital');
        break;
      case 'configuracoes':
        setActiveSubTab('equipe');
        break;
    }
  };

  const isSidebarTabActive = (tabId: string) =>
    tabId === 'cardapio_digital'
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

  const handleSidebarNavigation = (tabId: string, closeMobile = false) => {
    if (closeMobile) setIsMobileSidebarOpen(false);

    if (tabId === 'cardapio_digital' && !hasOnlineMenu) {
      setActiveTab('assinatura_pix');
      setActiveSubTab('planos');
      showToast(
        'O cardápio digital está incluído em todos os planos. Consulte a ativação com o suporte.',
        'info',
      );
      return;
    }

    if (tabId === 'cardapio_digital') {
      setActiveTab('cardapio_digital');
      setActiveSubTab('cardapio_digital');
    } else if (tabId === 'permissoes_cargos') {
      setActiveTab('permissoes_cargos');
      if (!['pessoas', 'desempenho'].includes(activeSubTab)) setActiveSubTab('pessoas');
    } else if (tabId === 'impressao_salao') {
      setActiveTab('impressao_salao');
      setActiveSubTab('impressoras');
    } else if (tabId === 'assinatura_pix') {
      setActiveTab('assinatura_pix');
      setActiveSubTab('planos');
    } else if (tabId === 'relatorios') {
      setActiveTab('relatorios');
      if (!['visao_geral', 'financeiro', 'produtos'].includes(activeSubTab)) setActiveSubTab('visao_geral');
    } else {
      handleTabChange(tabId as any);
    }
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
