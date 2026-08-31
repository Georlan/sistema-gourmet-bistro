import clsx from 'clsx';
import {
  Bell,
  ChevronRight,
  ClipboardList,
  CreditCard,
  DollarSign,
  Globe,
  Lock,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  Package,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sun,
  Trash2,
  TrendingUp,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getSubscriptionPlan, isAddonIncludedInPlan, normalizeSubscriptionPlan } from '../config/subscriptionPlans';
import {
  KOMA_THEME_CHANGED_EVENT,
  nextKomaTheme,
  persistKomaTheme,
  readKomaTheme,
  type KomaTheme,
} from '../config/theme';
import {
  formatCashierOldestAge as formatOldestAge,
  getCashierTableOrderPresentation,
  getCashierOrderSlaData as getOrderSlaData,
  projectCashierDeliveryState,
  projectCashierSalonTables,
  projectCashierTableSlices,
} from '../domain/cashierOrderProjection';
import { normalizeOperationalTimestamp } from '../domain/operationalTime';
import { clearOperatorSession } from '../utils/authSession';
import { AssinaturaPixTab } from './assinatura/AssinaturaPixTab';
import { LoginButton } from './auth/LoginButton';
import { CaixaFechamentoTab } from './caixa/CaixaFechamentoTab';
import { CaixaMovimentacoesTab } from './caixa/CaixaMovimentacoesTab';
import { CaixaTurnoAtualTab } from './caixa/CaixaTurnoAtualTab';
import type { CaixaPanelProps, CashierTab } from './caixa/cashierContracts';
import { formatCompactCurrency } from './caixa/cashierPresentation';
import { useCashierCatalog } from './caixa/catalog/useCashierCatalog';
import { CheckoutDialog } from './caixa/checkout/CheckoutDialog';
import { useCheckoutController } from './caixa/checkout/useCheckoutController';
import { useCashierCustomers } from './caixa/customers/useCashierCustomers';
import { KitchenTimer as KDSTimer } from './caixa/kitchen/KitchenTimer';
import { DeferredCashierSection } from './caixa/loading/DeferredCashierSection';
import { CaixaOrdersWorkspace } from './caixa/orders/CaixaOrdersWorkspace';
import type { CashierTableCard } from './caixa/orders/cashierWorkspaceTypes';
import { KanbanOrderDetails } from './caixa/orders/KanbanOrderDetails';
import { useCashierOrders } from './caixa/orders/useCashierOrders';
import { useCashierPdv } from './caixa/pdv/useCashierPdv';
import { useCashierAlerts } from './caixa/realtime/useCashierAlerts';
import { useCashierClock } from './caixa/realtime/useCashierClock';
import { useCashierRealtime } from './caixa/realtime/useCashierRealtime';
import { CaixaSalonTab } from './caixa/salao/CaixaSalonTab';
import { SangriaModal } from './caixa/SangriaModal';
import { useCashierSettings } from './caixa/settings/useCashierSettings';
import { useCashShift } from './caixa/shift/useCashShift';
import { useCashierSmartPos } from './caixa/smartpos/useCashierSmartPos';
import { SuprimentoModal } from './caixa/SuprimentoModal';
import { KomaLogo } from './KomaLogo';
import MoneyInput from './MoneyInput';
import { OperationalBanner } from './shared/OperationalBanner';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from './ui/sidebar';
const loadCashierInventory = () => import('./caixa/inventory/CashierInventory');
const loadCashierCatalog = () => import('./caixa/catalog/CashierCatalog');
const loadCashierCustomers = () => import('./caixa/customers/CashierCustomers');
const loadCashierSettings = () => import('./caixa/settings/CashierSettings');
const loadCashierOnlineMenu = () => import('./caixa/online-menu/CashierOnlineMenu');
const loadCashierTeam = () => import('./caixa/team/CashierTeam');
const loadCashierReports = () => import('./caixa/reports/CashierReports');
const loadCashierPdvView = () => import('./caixa/pdv/CashierPdvView');

const CASHIER_SIDEBAR_GROUPS = [
  {
    category: 'Operação',
    items: [
      { id: 'operacao', label: 'Vendas', icon: ShoppingCart },
      { id: 'financeiro', label: 'Caixa', icon: DollarSign },
    ],
  },
  {
    category: 'Cadastros',
    items: [
      { id: 'cardapio', label: 'Cardápio', icon: ClipboardList },
      { id: 'estoque', label: 'Estoque', icon: Package },
      { id: 'clientes', label: 'Clientes', icon: Users },
    ],
  },
  {
    category: 'Gestão',
    items: [
      { id: 'relatorios', label: 'Relatórios', icon: TrendingUp },
      { id: 'permissoes_cargos', label: 'Equipe', icon: ShieldCheck },
    ],
  },
  {
    category: 'Sistema',
    items: [{ id: 'impressao_salao', label: 'Configurações', icon: SlidersHorizontal }],
  },
] as const;

const CASHIER_SIDEBAR_SECONDARY_ITEMS = [
  { id: 'cardapio_digital', label: 'Cardápio online', icon: Globe },
  { id: 'assinatura_pix', label: 'Assinatura e planos', icon: CreditCard },
] as const;

const formatClockTime = (value: unknown) => {
  const timestamp = normalizeOperationalTimestamp(value);
  if (timestamp === null) return '—';
  return new Date(timestamp).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDuration = (minutes: number) => {
  const safeMinutes = Math.max(0, Number(minutes) || 0);
  if (safeMinutes < 60) return `${safeMinutes} min`;
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
};

export function CaixaPanel({
  orders = [],
  onRefreshOrders,
  apiBaseUrl,
  authHeaders,
  activeWaiterNome,
  salonTables = [],
  onCreateMesa,
  onUpdateMesa,
  onDeleteMesa,
  pagamentosPendentes = [],
  onRefreshPagamentosPendentes,
  isWsConnected = false,
  turnoResumo,
  isTurnoResumoLoading,
  onRefreshTurnoResumo,
  liveProdutos = [],
  liveCategorias = [],
  catalogReady = false,
  onRefreshCategorias,
  restauranteConfig,
  fetchError,
  onOptimisticUpdateItemStatus,
  onOptimisticAddOrder,
  onRemovePendingPaymentOptimistic,
}: CaixaPanelProps) {
  const restId = Number(restauranteConfig?.restaurante_id || restauranteConfig?.id);
  const isRestaurant2Test = restId === 2;
  const currentPlanId = normalizeSubscriptionPlan(
    isRestaurant2Test ? 'premium' : (restauranteConfig?.plano_efetivo ?? restauranteConfig?.plano),
  );
  const currentPlan = getSubscriptionPlan(currentPlanId);
  const hasPrinting = currentPlanId !== 'pocket';
  const hasOnlineMenu =
    isAddonIncludedInPlan(currentPlanId, 'online_menu') || restauranteConfig?.cardapio_online_addon === true;
  const pendingPaymentsTotal = useMemo(
    () => pagamentosPendentes.reduce((total, payment) => total + (Number(payment?.valor) || 0), 0),
    [pagamentosPendentes],
  );
  const cashSalesPerHour =
    turnoResumo?.status === 'aberto' && turnoResumo.tempo_aberto_minutos > 0
      ? turnoResumo.total_vendas / (turnoResumo.tempo_aberto_minutos / 60)
      : 0;
  const cashShiftHealth = turnoResumo?.turno_esquecido
    ? 'Revisar agora'
    : turnoResumo?.status === 'aberto'
      ? 'Regular'
      : 'Sem turno';
  const latestReceiptTime = formatClockTime(
    turnoResumo?.atividades_recentes?.find((activity) => activity.tipo === 'recebimento')?.criado_em,
  );

  // Fullscreen / Modo PDV state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    () => typeof document !== 'undefined' && !!document.fullscreenElement,
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      const docEl = document.documentElement as any;
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(() => {});
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      } else if (docEl.msRequestFullscreen) {
        docEl.msRequestFullscreen();
      }
    } else {
      const doc = document as any;
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen();
      }
    }
  };
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [toastData, setToastData] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [planNoticeBanner, setPlanNoticeBanner] = useState<string | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastData({ msg, type });
    setTimeout(() => setToastData(null), 3000);
  };
  const {
    turno,
    showAbrirModal,
    setShowAbrirModal,
    caixaMovimentacoes,
    isCaixaMovimentacoesLoading,
    fechamentoResult,
    showSangriaModal,
    setShowSangriaModal,
    showSuprimentoModal,
    setShowSuprimentoModal,
    saldoInicial,
    setSaldoInicial,
    fetchTurno,
    fetchTurnoResumo,
    fetchCaixaMovimentacoes,
    handleRegistrarSangria,
    handleRegistrarSuprimento,
    handleConfirmarFechamento,
    handleAbrirCaixa,
  } = useCashShift({
    apiBaseUrl,
    authHeaders,
    onRefreshTurnoResumo,
    showToast,
    setErrorMsg,
    setIsLoading,
  });

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
    if (['ajustes', 'ajustes_caixa', 'movimentacoes', 'suprimento', 'sangria'].includes(saved)) return 'movimentacoes';
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

  const smartPos = useCashierSmartPos({
    apiBaseUrl,
    authHeaders,
    onRefreshOrders,
    activeSubTab,
    showToast,
    fetchTurno,
    onReconciled: () => {
      setSelectedOrder(null);
      setShowCheckoutModal(false);
    },
  });
  const { setSmartPosRecoveryError, getSmartPosCardState } = smartPos;
  const {
    selectedKanbanOrder,
    setSelectedKanbanOrder,
    cancelConsumptionTarget,
    setCancelConsumptionTarget,
    cancelTableReason,
    setCancelTableReason,
    isCancellingTable,
    tableTransferTargetId,
    setTableTransferTargetId,
    isTransferringTable,
    handleCancelTableConsumption,
    getTableMovementContext,
    deliveryOrders,
    motoboys,
    selectedMotoboys,
    setSelectedMotoboys,
    novoMotoboyNome,
    setNewMotoboyNome,
    novoMotoboyTelefone,
    setNewMotoboyTelefone,
    isDrawerOpen,
    setIsDrawerOpen,
    handleQuickPrintOrder,
    fetchDeliveryOrders,
    fetchMotoboys,
    openDeliveryOrderDetails,
    handleDespacharKanban,
    handleRevogarAcessoMotoboy,
    handleFecharDelivery,
    handleFinalizarPedido,
    handleAddMotoboy,
    handleUpdateItemStatus,
    handleAcceptPendingDeliveryOrder,
    handleRejectPendingDeliveryOrder,
    handleMarkTableItemsReady,
    handleAdvanceDigitalOrder,
    handleAdvanceSelectedKanbanOrder,
    handleReprintSelectedKanbanProduction,
    handlePrintSelectedKanbanTable,
    handlePrintSelectedKanbanValues,
    handleInspectSalonTable,
    handleTransferSelectedKanbanTable,
    handleCancelSelectedKanbanConsumption,
    handleCancelSelectedKanbanOrder,
  } = useCashierOrders({
    orders,
    apiBaseUrl,
    authHeaders,
    onRefreshOrders,
    onOptimisticUpdateItemStatus,
    showToast,
    isLoading,
    setIsLoading,
  });
  const { soundEnabled, toggleSound, playOrderAlert } = useCashierAlerts({ orders, deliveryOrders, isDrawerOpen });

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
      if (['metas', 'vendas', 'indicadores', 'relatorio_geral', 'faturamento_garcom'].includes(activeSubTab)) {
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

  // Capture the fallback opening time once per received snapshot, not on each
  // presentation tick (an undated legacy card must not restart every 30s).
  const { nowTimestamp } = useCashierClock();

  const { tableOrdersInProduction, tableOrdersReady } = useMemo(
    () => projectCashierTableSlices(orders, salonTables, Date.now()),
    [orders, salonTables],
  );

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

  const catalog = useCashierCatalog({ apiBaseUrl, authHeaders, liveProdutos, liveCategorias });
  const { apiProdutos, apiCategorias, dynamicMenu, suggestedProductCode, fetchProdutos, fetchCategorias } = catalog;
  const customers = useCashierCustomers({ apiBaseUrl, authHeaders });
  const { loyaltyUsers, refreshLoyaltyUsers } = customers;

  const [searchQuery, setSearchQuery] = useState('');

  // Table management states

  const [tableStatusFilter, setTableStatusFilter] = useState<'all' | 'free' | 'occupied' | 'payment'>('all');

  const salonTableCards = useMemo(
    () => projectCashierSalonTables(salonTables, orders, pagamentosPendentes, nowTimestamp),
    [orders, pagamentosPendentes, salonTables, nowTimestamp],
  );

  const tableStatusCounts = useMemo(
    () => ({
      all: salonTableCards.length,
      free: salonTableCards.filter((card) => !card.isOccupied && !card.isMerged).length,
      occupied: salonTableCards.filter((card) => card.isOccupied && !card.hasPendingPayment).length,
      payment: salonTableCards.filter((card) => card.hasPendingPayment).length,
    }),
    [salonTableCards],
  );

  const salonInsights = useMemo(() => {
    const activeCards = salonTableCards.filter((card) => card.isOccupied && !card.isMerged);
    const openValue = activeCards.reduce((total, card) => total + card.total, 0);
    const timestamps = activeCards.flatMap((card) =>
      card.tableOrders.map(
        (order) =>
          (order as any).aberta_em ||
          (order as any).data_abertura ||
          (order as any).aberto_em ||
          order.created_at ||
          order.timestamp ||
          (order as any).criadoEm,
      ),
    );
    return {
      occupancy: salonTableCards.length > 0 ? Math.round((activeCards.length / salonTableCards.length) * 100) : 0,
      openValue,
      oldestService: formatOldestAge(timestamps, nowTimestamp),
    };
  }, [salonTableCards, nowTimestamp]);

  const pdvTableOptions = useMemo(
    () =>
      salonTableCards
        .map((card) => {
          const isOccupied = card.isOccupied || card.hasPendingPayment;

          return {
            ...card,
            isOccupied,
            label: card.table.nome?.trim() || `Mesa ${card.table.id}`,
          };
        })
        .sort((left, right) => left.table.id - right.table.id),
    [salonTableCards],
  );

  const visibleSalonTableCards = useMemo(
    () =>
      salonTableCards.filter((card) => {
        if (tableStatusFilter === 'free') return !card.isOccupied && !card.isMerged;
        if (tableStatusFilter === 'occupied') return card.isOccupied && !card.hasPendingPayment;
        if (tableStatusFilter === 'payment') return card.hasPendingPayment;
        return true;
      }),
    [salonTableCards, tableStatusFilter],
  );

  const settings = useCashierSettings({
    apiBaseUrl,
    authHeaders,
    showToast,
    setCheckoutServiceTax: (value) => setCheckoutServiceTax(value),
  });
  const { taxaServicoAtiva, serviceTaxRate, fetchConfiguracoes } = settings;

  const checkout = useCheckoutController({
    orders,
    apiBaseUrl,
    authHeaders,
    onRefreshOrders,
    onRemovePendingPaymentOptimistic,
    onRefreshPagamentosPendentes,
    showToast,
    loyaltyUsers,
    taxaServicoAtiva,
    serviceTaxRate,
    isLoading,
    setErrorMsg,
    getSmartPosCardState,
    setSmartPosRecoveryError,
    fetchTurno,
    handleFecharDelivery,
    handleFinalizarPedido,
  });
  const { handleConfirmPendingCashPayment, handleRejectPendingCashPayment } = checkout;
  const {
    selectedOrder,
    setSelectedOrder,
    setShowCheckoutModal,
    setCheckoutServiceTax,
    handleOpenTablePayment,
    handleFinalizeDigitalOrder,
    handleReceiveSalonTable,
  } = checkout;

  // Toggle automatics
  const [autoAccept, setAutoAccept] = useState(false);

  // Search terms

  // PDV Local Cart state

  // POS Drawer Custom Events (Sangria, Suprimento, Sync)
  useEffect(() => {
    const handleOpenSangria = () => {
      setActiveTab('financeiro');
      setActiveSubTab('turno_atual');
      setShowSangriaModal(true);
    };
    const handleOpenSuprimento = () => {
      setActiveTab('financeiro');
      setActiveSubTab('turno_atual');
      setShowSuprimentoModal(true);
    };
    const handleSyncAll = () => {
      fetchTurno();
      fetchProdutos();
      fetchCategorias();
      if (onRefreshOrders) onRefreshOrders();
    };
    const handleOpenImpressoras = () => {
      setActiveTab('impressao_salao');
    };

    window.addEventListener('koma-open-sangria', handleOpenSangria);
    window.addEventListener('koma-open-suprimento', handleOpenSuprimento);
    window.addEventListener('koma-sync-all', handleSyncAll);
    window.addEventListener('koma-open-impressoras', handleOpenImpressoras);

    return () => {
      window.removeEventListener('koma-open-sangria', handleOpenSangria);
      window.removeEventListener('koma-open-suprimento', handleOpenSuprimento);
      window.removeEventListener('koma-sync-all', handleSyncAll);
      window.removeEventListener('koma-open-impressoras', handleOpenImpressoras);
    };
  }, [onRefreshOrders]);

  // Date filters for Meu Desempenho

  // Drawer Overlay do Operador/Login
  const [isOperatorDrawerOpen, setIsOperatorDrawerOpen] = useState(false);

  const handleLogoutOperator = () => {
    clearOperatorSession();
    localStorage.removeItem('koma_token');
    localStorage.removeItem('koma_user_id');
    localStorage.removeItem('koma_user_name');
    localStorage.removeItem('koma_user_role');
    localStorage.removeItem('koma_auth_token');
    window.location.reload();
  };

  // ── MÓDULO 3: SLA, Impressão Rápida e Expansão Compacta de Itens ──────────────
  const [expandedCardIds, setExpandedCardIds] = useState<Record<string, boolean>>({});

  const toggleCardExpansion = (cardId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedCardIds((prev) => ({ ...prev, [cardId]: !prev[cardId] }));
  };

  const buildCashierTableCard = (order: CashierTableCard['order']): CashierTableCard => ({
    order,
    tableMovement: getTableMovementContext(order),
    smartPosState: getSmartPosCardState(order),
    presentation: getCashierTableOrderPresentation(order, salonTables),
  });

  const [fontSize, setFontSize] = useState<'padrao' | 'grande' | 'gigante'>(() => {
    return (localStorage.getItem('koma_font_size') as any) || 'padrao';
  });

  const changeFontSize = (size: 'padrao' | 'grande' | 'gigante') => {
    localStorage.setItem('koma_font_size', size);
    setFontSize(size);
    window.dispatchEvent(new Event('koma_font_size_changed'));
  };

  const [theme, setTheme] = useState<KomaTheme>(() => readKomaTheme());

  useEffect(() => {
    const handleStorageChange = () => {
      setTheme(readKomaTheme());

      const storedFontSize = localStorage.getItem('koma_font_size') as any;
      if (storedFontSize && ['padrao', 'grande', 'gigante'].includes(storedFontSize)) {
        setFontSize(storedFontSize);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('koma_font_size_changed', handleStorageChange);
    window.addEventListener(KOMA_THEME_CHANGED_EVENT, handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('koma_font_size_changed', handleStorageChange);
      window.removeEventListener(KOMA_THEME_CHANGED_EVENT, handleStorageChange);
    };
  }, []);

  // Fetch optimized statistics, stock, and reports
  useEffect(() => {
    if (activeTab === 'financeiro') {
      fetchTurnoResumo();
      fetchCaixaMovimentacoes();
    }
  }, [activeTab, activeSubTab]);

  const pdv = useCashierPdv({
    apiBaseUrl,
    authHeaders,
    activeTab,
    activeSubTab,
    setActiveTab,
    setActiveSubTab,
    showToast,
    setIsLoading,
    onRefreshOrders,
    onOptimisticAddOrder,
    activeWaiterNome,
    fetchDeliveryOrders,
    apiCategorias,
    dynamicMenu,
    pdvTableOptions,
  });
  const { setBalcaoMobileView, setPdvOrderType, setPdvTargetMesaId } = pdv;

  // O navegador não detecta a impressora física. O teste passa pela mesma fila
  // dos pedidos e confirma, sem confundir o conector local com a impressora.

  // O mesmo snapshot ativo alimenta balcão, garçom e cardápio digital.
  // Produtos desativados permanecem no administrativo para preservar histórico,
  // mas nunca aparecem como vendáveis.

  // Extract all active kitchen items from orders database
  const activeKitchenItems = orders.flatMap((order) =>
    order.itens
      .filter((item) => item.status === 'preparando' || item.status === 'pronto')
      .filter(() => order.deliveryStatus !== 'pendente' && order.deliveryStatus !== 'recusado')
      .map((item) => ({
        ...item,
        orderId: order.id,
        mesaId: order.mesaId,
        garcomNome: order.garcomNome,
        timestamp: (item as any).created_at || (item as any).timestamp || order.timestamp,
      })),
  );
  // Lógica de filtragem multi-campo em tempo real para cards do Kanban
  const matchesSearchQuery = useCallback((card: any, query: string) => {
    if (!query || !query.trim()) return true;
    const q = query.toLowerCase().trim();

    const cliente = (
      card.cliente ||
      card.nome_cliente ||
      card.clienteNome ||
      card.cliente_nome ||
      card.identificador ||
      ''
    ).toLowerCase();

    const mesaNome = (
      card.mesa_nome ||
      card.mesa?.nome ||
      (card.mesaId ? `mesa ${card.mesaId}` : '') ||
      ''
    ).toLowerCase();

    const mesaNum = String(card.mesa_numero || card.mesa_id || card.mesa?.numero || card.mesaId || '');

    const telefone = (card.telefone || card.celular || '').toLowerCase();

    let itensStr = '';
    if (Array.isArray(card.itens)) {
      itensStr = card.itens
        .map((i: any) => (i.nome || i.produto_nome || i.produtoNome || i.name || '').toLowerCase())
        .join(' ');
    } else if (typeof card.itens === 'string') {
      itensStr = card.itens.toLowerCase();
    }

    const garcom = (card.garcomNome || card.garcom || '').toLowerCase();
    const numeroPedido = String(card.numeroPedido || card.numero_pedido || card.id || '');

    return (
      cliente.includes(q) ||
      mesaNome.includes(q) ||
      (mesaNum !== '' && mesaNum === q) ||
      (mesaNum !== '' && `mesa ${mesaNum}`.includes(q)) ||
      (mesaNum !== '' && `m${mesaNum}`.includes(q)) ||
      telefone.includes(q) ||
      itensStr.includes(q) ||
      garcom.includes(q) ||
      numeroPedido.includes(q)
    );
  }, []);

  // Real-time filtered cards for Kanban columns
  const filteredCol1 = useMemo(() => {
    return tableOrdersInProduction.filter((order) => matchesSearchQuery(order, searchQuery));
  }, [tableOrdersInProduction, searchQuery, matchesSearchQuery]);

  const filteredDigitalProduction = useMemo(() => {
    return deliveryOrders
      .filter((o) => projectCashierDeliveryState(o.status).inProduction)
      .filter((order) => matchesSearchQuery(order, searchQuery));
  }, [deliveryOrders, searchQuery, matchesSearchQuery]);

  const filteredCol2Table = useMemo(() => {
    return tableOrdersReady.filter((order) => matchesSearchQuery(order, searchQuery));
  }, [tableOrdersReady, searchQuery, matchesSearchQuery]);

  const filteredDeliveryFinalization = useMemo(() => {
    return deliveryOrders
      .filter((o) => projectCashierDeliveryState(o.status).inFinalization)
      .filter((order) => matchesSearchQuery(order, searchQuery));
  }, [deliveryOrders, searchQuery, matchesSearchQuery]);

  const activeDeliveryOrdersCount = useMemo(
    () =>
      deliveryOrders.reduce(
        (count, order) => (projectCashierDeliveryState(order.status).active ? count + 1 : count),
        0,
      ),
    [deliveryOrders],
  );
  const sidebarOrderCount = tableOrdersInProduction.length + activeDeliveryOrdersCount + tableOrdersReady.length;
  const operationalOrderInsights = useMemo(() => {
    const activeDigitalOrders = deliveryOrders.filter((order) => projectCashierDeliveryState(order.status).active);

    const activeTableList = [...tableOrdersInProduction, ...tableOrdersReady];

    const tableValue = activeTableList.reduce((total, order) => {
      const itens = Array.isArray(order.itens) ? order.itens : [];
      return (
        total +
        itens.reduce((itemTotal: number, item: any) => {
          return itemTotal + (!item.pago && String(item.status) !== 'cancelado' ? Number(item.preco) || 0 : 0);
        }, 0)
      );
    }, 0);

    const digitalValue = activeDigitalOrders.reduce(
      (total, order) => total + (!order.pago ? Number(order.total) || 0 : 0),
      0,
    );

    const timestamps = [
      ...activeTableList.map(
        (order) =>
          order.aberta_em ||
          order.data_abertura ||
          order.aberto_em ||
          order.timestamp ||
          order.created_at ||
          order.criadoEm,
      ),
      ...activeDigitalOrders.map((order) => order.criadoEm),
    ];

    const pendingPaymentCount = pagamentosPendentes.length;
    const pendingAcceptanceCount = activeDigitalOrders.filter(
      (order) => projectCashierDeliveryState(order.status).awaitingAcceptance,
    ).length;
    const readyToFinishCount = tableOrdersReady.length;
    const overdueCount = [...activeTableList, ...activeDigitalOrders].filter(
      (order) => getOrderSlaData(order, nowTimestamp).minutes >= 15,
    ).length;

    const actionMetric =
      pendingPaymentCount > 0
        ? { label: 'pagamentos para confirmar', value: pendingPaymentCount, needsAttention: true }
        : pendingAcceptanceCount > 0
          ? { label: 'pedidos para aceitar', value: pendingAcceptanceCount, needsAttention: true }
          : readyToFinishCount > 0
            ? { label: 'prontos para concluir', value: readyToFinishCount, needsAttention: true }
            : overdueCount > 0
              ? { label: 'pedidos há +15 min', value: overdueCount, needsAttention: true }
              : { label: 'sem pendências', value: 0, needsAttention: false };

    return {
      oldestOrder: formatOldestAge(timestamps, nowTimestamp),
      openValue: tableValue + digitalValue,
      actionMetric,
    };
  }, [deliveryOrders, nowTimestamp, pagamentosPendentes, tableOrdersInProduction, tableOrdersReady]);

  const isSidebarTabActive = (tabId: string) =>
    tabId === 'cardapio_digital'
      ? activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital'
      : tabId === 'permissoes_cargos'
        ? activeTab === 'permissoes_cargos' || (activeTab === 'configuracoes' && activeSubTab === 'equipe')
        : tabId === 'impressao_salao'
          ? activeTab === 'impressao_salao' || (activeTab === 'configuracoes' && activeSubTab === 'impressoras')
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
      showToast('O cardápio digital está incluído em todos os planos. Consulte a ativação com o suporte.', 'info');
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

  const handleOpenSalonTableOrder = (tableId: number) => {
    setPdvOrderType('mesa');
    setPdvTargetMesaId(tableId);
    setBalcaoMobileView('produtos');
    setActiveSubTab('balcao');
  };
  useCashierRealtime({
    isWsConnected,
    onRefreshOrders,
    activeTab,
    fetchTurno,
    fetchDeliveryOrders,
    fetchMotoboys,
    fetchConfiguracoes,
  });

  const selectedCheckoutSmartPosState = selectedOrder ? getSmartPosCardState(selectedOrder) : null;

  return (
    <div
      className={`cashier-shell flex w-full bg-koma-page text-koma-foreground font-sans selection:bg-[#10b981]/30 text-xs ${
        fontSize === 'grande' ? 'font-large' : fontSize === 'gigante' ? 'font-huge' : ''
      }`}
    >
      {/* TOAST DE FEEDBACK NÃO-BLOQUEANTE */}
      {toastData && (
        <div
          className={clsx(
            'fixed bottom-6 right-6 z-[9999] font-bold px-5 py-3 rounded-2xl shadow-2xl text-sm animate-fade-in pointer-events-none border backdrop-blur-md',
            toastData.type === 'error'
              ? 'bg-rose-900/90 border-rose-700/50 text-rose-100'
              : toastData.type === 'info'
                ? 'bg-amber-900/90 border-amber-700/50 text-amber-100'
                : 'bg-[#10b981] text-[#0B0B0C] border-[#10b981]',
          )}
        >
          {toastData.msg}
        </div>
      )}
      {/* SHADCN SIDEBAR INTEGRATION FOR KÔMA */}
      <SidebarProvider className="contents">
        {/* MOBILE SIDEBAR */}
        {isMobileSidebarOpen && (
          <div className={clsx('fixed', 'inset-0', 'z-50', 'flex', 'lg:hidden', 'animate-fade-in')}>
            <div
              onClick={() => setIsMobileSidebarOpen(false)}
              className={clsx('fixed', 'inset-0', 'bg-black/80', 'backdrop-blur-sm')}
            />
            <aside
              id="mobile-caixa-sidebar"
              role="dialog"
              aria-modal="true"
              aria-label="Menu principal"
              className={clsx(
                'cashier-sidebar',
                'cashier-sidebar--mobile',
                'relative',
                'w-[17rem]',
                'max-w-[88vw]',
                'flex',
                'flex-col',
                'justify-between',
                'shrink-0',
                'h-full',
                'z-10',
                'shadow-2xl',
                'overflow-y-auto',
              )}
            >
              <SidebarHeader className={clsx('cashier-sidebar__header', 'p-3')}>
                <div className="cashier-sidebar__brand-row">
                  <div className="cashier-sidebar__brand">
                    <span className="cashier-sidebar__logo-wrap">
                      <KomaLogo size="md" />
                    </span>
                    <span className="cashier-sidebar__brand-copy">
                      <strong>Kôma</strong>
                      <small>Se você está com fome, Kôma</small>
                    </span>
                  </div>
                  <div className={clsx('flex', 'items-center', 'gap-1.5')}>
                    <button
                      type="button"
                      onClick={() => {
                        setIsOperatorDrawerOpen(true);
                        setIsMobileSidebarOpen(false);
                      }}
                      className="cashier-sidebar__utility-button"
                      title="Conta e preferências"
                      aria-label="Abrir conta e preferências"
                    >
                      <SlidersHorizontal size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsMobileSidebarOpen(false)}
                      className="cashier-sidebar__utility-button"
                      aria-label="Fechar menu"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Status do Turno */}
                <div className={clsx('cashier-shift-card', turno?.status === 'aberto' ? 'is-open' : 'is-closed')}>
                  <div className="cashier-shift-card__status">
                    <span className="cashier-shift-card__dot" />
                    <span className="cashier-shift-card__copy">
                      <small>Turno atual</small>
                      <strong>{turno?.status === 'aberto' ? 'Caixa Aberto' : 'Caixa Fechado'}</strong>
                    </span>
                  </div>
                  {turno?.status !== 'aberto' && (
                    <button
                      onClick={() => {
                        setShowAbrirModal(true);
                        setIsMobileSidebarOpen(false);
                      }}
                      className={clsx('cashier-shift-card__action', 'is-open')}
                    >
                      Abrir caixa
                    </button>
                  )}
                </div>
              </SidebarHeader>

              <SidebarContent className={clsx('cashier-sidebar__content', 'p-2')}>
                {CASHIER_SIDEBAR_GROUPS.map((group) => (
                  <SidebarGroup key={group.category}>
                    <SidebarGroupLabel className="cashier-nav-group-label">{group.category}</SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {group.items.map((tab) => {
                          const Icon = tab.icon;
                          const isLocked = tab.id === 'cardapio_digital' && !hasOnlineMenu;
                          const isActive = isSidebarTabActive(tab.id);
                          const orderCount = tab.id === 'operacao' ? sidebarOrderCount : 0;

                          return (
                            <SidebarMenuItem key={tab.id}>
                              <SidebarMenuButton
                                isActive={isActive}
                                onClick={() => handleSidebarNavigation(tab.id, true)}
                                className="cashier-nav-item"
                                title={tab.label}
                              >
                                <span className="cashier-nav-icon">
                                  <Icon size={15} />
                                </span>
                                <span className="cashier-nav-label">{tab.label}</span>
                                {orderCount > 0 && <SidebarMenuBadge>{orderCount}</SidebarMenuBadge>}
                                {isLocked && (
                                  <span className="cashier-nav-plan">
                                    <Lock size={9} />
                                    <span>Plano</span>
                                  </span>
                                )}
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          );
                        })}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                ))}
              </SidebarContent>

              <SidebarFooter className={clsx('cashier-sidebar__footer', 'p-3', 'flex', 'flex-col', 'gap-2')}>
                <div className="cashier-sidebar__secondary">
                  <span className="cashier-sidebar__secondary-label">Acesso rápido</span>
                  {CASHIER_SIDEBAR_SECONDARY_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isLocked = item.id === 'cardapio_digital' && !hasOnlineMenu;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSidebarNavigation(item.id, true)}
                        className="cashier-nav-item flex min-h-8 items-center gap-2 rounded-lg px-2 text-left text-[11px] font-semibold text-koma-subtle hover:bg-koma-raised hover:text-koma-foreground"
                      >
                        <span className="cashier-nav-icon">
                          <Icon size={14} />
                        </span>
                        <span className="cashier-nav-label">{item.label}</span>
                        {isLocked && <Lock size={10} className="ml-auto text-amber-500" />}
                      </button>
                    );
                  })}
                </div>
                <div className="cashier-display-controls">
                  <div className="cashier-font-control flex-1">
                    <span className="cashier-font-control__label">Texto</span>
                    <div className="cashier-font-control__options">
                      {(['padrao', 'grande', 'gigante'] as const).map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => changeFontSize(sz)}
                          className={clsx('cashier-font-control__button', fontSize === sz && 'is-active')}
                          aria-label={
                            sz === 'padrao' ? 'Texto padrão' : sz === 'grande' ? 'Texto grande' : 'Texto muito grande'
                          }
                          title={
                            sz === 'padrao' ? 'Texto padrão' : sz === 'grande' ? 'Texto grande' : 'Texto muito grande'
                          }
                        >
                          {sz === 'padrao' ? 'A' : sz === 'grande' ? 'A+' : 'A++'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="cashier-font-control">
                    <span className="cashier-font-control__label">Tema</span>
                    <div className="cashier-font-control__options">
                      <button
                        type="button"
                        onClick={() => {
                          setTheme(persistKomaTheme(nextKomaTheme(theme)));
                        }}
                        className={clsx('cashier-font-control__button', 'flex items-center justify-center py-1')}
                        aria-label="Alternar tema"
                        title="Alternar tema"
                      >
                        {theme === 'dark' ? <Moon size={12} /> : <Sun size={12} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="cashier-operator">
                  <span className="cashier-operator__avatar">
                    {activeWaiterNome?.trim().charAt(0).toUpperCase() || 'K'}
                  </span>
                  <span className="cashier-operator__copy">
                    <small>Operador</small>
                    <strong>{activeWaiterNome}</strong>
                  </span>
                </div>
              </SidebarFooter>
            </aside>
          </div>
        )}

        {/* DESKTOP SIDEBAR - SHADCN COMPOSABLE ARCHITECTURE */}
        <Sidebar
          collapsible="icon"
          className={clsx('cashier-sidebar', 'hidden', 'lg:flex', 'flex-col', 'justify-between', 'shrink-0')}
        >
          <SidebarHeader className={clsx('cashier-sidebar__header', 'p-3.5')}>
            <div className="cashier-sidebar__brand-row">
              <div className="cashier-sidebar__brand">
                <span className="cashier-sidebar__logo-wrap cashier-sidebar__logo-wrap--expanded">
                  <KomaLogo size="md" />
                </span>
                <span className="cashier-sidebar__logo-wrap cashier-sidebar__logo-wrap--compact" aria-hidden="true">
                  <KomaLogo size="md" contextualWordmark={false} alt="" />
                </span>
                <span className="cashier-sidebar__brand-copy">
                  <strong>Kôma</strong>
                  <small>Se você está com fome, Kôma</small>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsOperatorDrawerOpen(true)}
                className="cashier-sidebar__utility-button"
                title="Conta e preferências"
                aria-label="Abrir conta e preferências"
              >
                <SlidersHorizontal size={15} />
              </button>
            </div>

            {/* Quick status bar */}
            <div className={clsx('cashier-shift-card', turno?.status === 'aberto' ? 'is-open' : 'is-closed')}>
              <div className="cashier-shift-card__status">
                <span className="cashier-shift-card__dot" />
                <span className="cashier-shift-card__copy">
                  <small>Turno atual</small>
                  <strong>{turno?.status === 'aberto' ? 'Caixa Aberto' : 'Caixa Fechado'}</strong>
                </span>
              </div>
              {turno?.status !== 'aberto' && (
                <button
                  onClick={() => setShowAbrirModal(true)}
                  className={clsx('cashier-shift-card__action', 'is-open')}
                >
                  Abrir caixa
                </button>
              )}
            </div>
          </SidebarHeader>

          {/* Sidebar Content */}
          <SidebarContent className={clsx('cashier-sidebar__content', 'p-2')}>
            {CASHIER_SIDEBAR_GROUPS.map((group) => (
              <SidebarGroup key={group.category}>
                <SidebarGroupLabel className="cashier-nav-group-label">{group.category}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((tab) => {
                      const Icon = tab.icon;
                      const isLocked = tab.id === 'cardapio_digital' && !hasOnlineMenu;
                      const isActive = isSidebarTabActive(tab.id);
                      const orderCount = tab.id === 'operacao' ? sidebarOrderCount : 0;

                      return (
                        <SidebarMenuItem key={tab.id}>
                          <SidebarMenuButton
                            isActive={isActive}
                            onClick={() => handleSidebarNavigation(tab.id)}
                            className="cashier-nav-item"
                            title={tab.label}
                          >
                            <span className="cashier-nav-icon">
                              <Icon size={15} />
                            </span>
                            <span className="cashier-nav-label">{tab.label}</span>
                            {orderCount > 0 && <SidebarMenuBadge>{orderCount}</SidebarMenuBadge>}
                            {isLocked && (
                              <span className="cashier-nav-plan">
                                <Lock size={9} />
                                <span>Plano</span>
                              </span>
                            )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>

          {/* Sidebar Footer */}
          <SidebarFooter className={clsx('cashier-sidebar__footer', 'p-3', 'flex', 'flex-col', 'gap-2')}>
            <div className="cashier-sidebar__secondary">
              <span className="cashier-sidebar__secondary-label">Acesso rápido</span>
              {CASHIER_SIDEBAR_SECONDARY_ITEMS.map((item) => {
                const Icon = item.icon;
                const isLocked = item.id === 'cardapio_digital' && !hasOnlineMenu;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSidebarNavigation(item.id)}
                    className="cashier-nav-item flex min-h-8 items-center gap-2 rounded-lg px-2 text-left text-[11px] font-semibold text-koma-subtle hover:bg-koma-raised hover:text-koma-foreground"
                    title={item.label}
                  >
                    <span className="cashier-nav-icon">
                      <Icon size={14} />
                    </span>
                    <span className="cashier-nav-label">{item.label}</span>
                    {isLocked && <Lock size={10} className="ml-auto text-amber-500" />}
                  </button>
                );
              })}
            </div>
            <div className="cashier-display-controls">
              <div className="cashier-font-control flex-1">
                <span className="cashier-font-control__label">Texto</span>
                <div className="cashier-font-control__options">
                  {(['padrao', 'grande', 'gigante'] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => changeFontSize(sz)}
                      className={clsx('cashier-font-control__button', fontSize === sz && 'is-active')}
                      aria-label={
                        sz === 'padrao' ? 'Texto padrão' : sz === 'grande' ? 'Texto grande' : 'Texto muito grande'
                      }
                      title={sz === 'padrao' ? 'Texto padrão' : sz === 'grande' ? 'Texto grande' : 'Texto muito grande'}
                    >
                      {sz === 'padrao' ? 'A' : sz === 'grande' ? 'A+' : 'A++'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cashier-font-control">
                <span className="cashier-font-control__label">Tema</span>
                <div className="cashier-font-control__options">
                  <button
                    type="button"
                    onClick={() => {
                      setTheme(persistKomaTheme(nextKomaTheme(theme)));
                    }}
                    className={clsx('cashier-font-control__button', 'flex items-center justify-center py-1')}
                    aria-label="Alternar tema"
                    title="Alternar tema"
                  >
                    {theme === 'dark' ? <Moon size={12} /> : <Sun size={12} />}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setTheme(persistKomaTheme(nextKomaTheme(theme)))}
              className="cashier-sidebar__compact-theme"
              aria-label="Alternar tema"
              title="Alternar tema"
            >
              {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
            </button>

            <div className="cashier-operator">
              <span className="cashier-operator__avatar">
                {activeWaiterNome?.trim().charAt(0).toUpperCase() || 'K'}
              </span>
              <span className="cashier-operator__copy">
                <small>Operador</small>
                <strong>{activeWaiterNome}</strong>
              </span>
            </div>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        {/* CONTENT AREA */}
        <main
          className={clsx(
            'cashier-main',
            'min-w-0',
            'min-h-0',
            'flex-1',
            'bg-koma-canvas',
            'flex',
            'flex-col',
            'w-full',
          )}
        >
          {/* Top header bar */}
          <header
            className={clsx(
              'cashier-topbar',
              'h-14',
              'border-b',
              'border-koma-border',
              'bg-koma-panel',
              'px-4',
              'sm:px-6',
              'flex',
              'items-center',
              'justify-between',
              'shrink-0',
            )}
          >
            <div className={clsx('flex', 'items-center', 'gap-2', 'truncate')}>
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(true)}
                className={clsx(
                  'lg:hidden',
                  'p-1.5',
                  'bg-koma-raised',
                  'hover:bg-koma-card',
                  'text-emerald-700',
                  'dark:text-emerald-400',
                  'rounded-xl',
                  'border',
                  'border-koma-border',
                  'flex',
                  'items-center',
                  'justify-center',
                  'cursor-pointer',
                  'shrink-0',
                )}
                title="Abrir Menu do Caixa"
                aria-label="Abrir menu principal"
                aria-controls="mobile-caixa-sidebar"
                aria-expanded={isMobileSidebarOpen}
                id="btn-mobile-caixa-sidebar-open"
              >
                <Menu size={16} />
              </button>
              <SidebarTrigger
                className="hidden lg:flex"
                title="Recolher ou expandir menu"
                aria-label="Recolher ou expandir menu"
              />
              <h2
                className={clsx(
                  'font-serif',
                  'font-bold',
                  'text-xs',
                  'sm:text-sm',
                  'tracking-tight',
                  'text-koma-foreground',
                  'truncate',
                )}
              >
                {(activeTab === 'relatorios' || activeTab === 'dashboard') && 'Relatórios'}
                {activeTab === 'operacao' && 'Vendas'}
                {activeTab === 'cardapio' && 'Cardápio'}
                {activeTab === 'estoque' && 'Estoque'}
                {activeTab === 'financeiro' && 'Caixa'}
                {activeTab === 'clientes' && 'Clientes'}
                {(activeTab === 'permissoes_cargos' || (activeTab === 'configuracoes' && activeSubTab === 'equipe')) &&
                  'Equipe'}
                {(activeTab === 'impressao_salao' ||
                  (activeTab === 'configuracoes' && activeSubTab === 'impressoras')) &&
                  'Configurações'}
                {(activeTab === 'assinatura_pix' || (activeTab === 'configuracoes' && activeSubTab === 'planos')) &&
                  'Planos de Assinatura e Recebimento Pix'}
                {(activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital') &&
                  'Configurações do cardápio online'}
              </h2>
            </div>

            {/* Botão MODO PDV / FULLSCREEN */}
            <div className={clsx('flex', 'items-center', 'gap-2', 'shrink-0')}>
              <button
                type="button"
                onClick={toggleFullscreen}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border',
                  isFullscreen
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-400 hover:bg-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40 dark:hover:bg-emerald-500/30'
                    : 'bg-koma-raised text-koma-secondary border-koma-border hover:bg-koma-card hover:text-koma-foreground',
                )}
                title={isFullscreen ? 'Sair do Modo PDV Tela Cheia' : 'Entrar no Modo PDV Tela Cheia'}
                aria-label={isFullscreen ? 'Sair do modo PDV em tela cheia' : 'Entrar no modo PDV em tela cheia'}
                id="btn-modo-pdv-fullscreen"
              >
                {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                <span className={clsx('hidden', 'sm:inline')}>{isFullscreen ? 'Sair da Tela Cheia' : 'Modo PDV'}</span>
              </button>
            </div>
          </header>

          {/* Sub-tabs Navigation Bar */}
          <div
            className={clsx(
              'cashier-subnav',
              'bg-koma-panel/80',
              'backdrop-blur-md',
              'border-b',
              'border-koma-border',
              'px-6',
              'py-1.5',
              'flex',
              'gap-2',
              'shrink-0',
              'overflow-x-auto',
              'scrollbar-none',
            )}
          >
            {activeTab === 'operacao' &&
              [
                { id: 'pedidos', label: 'Pedidos' },
                { id: 'balcao', label: 'Novo pedido' },
                { id: 'mesas', label: 'Salão' },
              ].map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => {
                    if (sub.id === 'balcao') {
                      pdv.openCounter();
                    }
                    setActiveSubTab(sub.id);
                  }}
                  className={clsx('cashier-subnav__button', activeSubTab === sub.id && 'is-active')}
                >
                  {sub.label}
                </button>
              ))}

            {activeTab === 'cardapio' &&
              [
                { id: 'produtos', label: 'Produtos', count: apiProdutos.length },
                { id: 'complementos', label: 'Complementos' },
                { id: 'categorias', label: 'Preparo e impressão', count: apiCategorias.length },
              ].map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setActiveSubTab(sub.id)}
                  className={clsx('cashier-subnav__button', activeSubTab === sub.id && 'is-active')}
                >
                  {sub.label}
                  {sub.count !== undefined && (
                    <span
                      aria-hidden="true"
                      className={clsx(
                        'ml-1.5',
                        'rounded-full',
                        'px-1.5',
                        'py-0.5',
                        'font-mono',
                        'text-[8px]',
                        activeSubTab === sub.id
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-koma-raised text-koma-muted',
                      )}
                    >
                      {sub.count}
                    </span>
                  )}
                </button>
              ))}

            {activeTab === 'estoque' &&
              [
                { id: 'insumos', label: 'Ingredientes' },
                { id: 'historico', label: 'Histórico' },
                { id: 'inventario', label: 'Inventário' },
                { id: 'fornecedores', label: 'Fornecedores' },
              ].map((sub) => {
                const isSubActive =
                  (sub.id === 'historico' &&
                    ['historico', 'entradas', 'xml', 'notas_entrada', 'movimentacoes'].includes(activeSubTab)) ||
                  (sub.id === 'inventario' && ['inventario', 'contagem'].includes(activeSubTab)) ||
                  (sub.id === 'fornecedores' && ['fornecedores', 'distribuidores'].includes(activeSubTab)) ||
                  activeSubTab === sub.id;
                return (
                  <button
                    key={sub.id}
                    onClick={() => setActiveSubTab(sub.id)}
                    className={clsx('cashier-subnav__button', isSubActive && 'is-active')}
                  >
                    {sub.label}
                  </button>
                );
              })}

            {activeTab === 'financeiro' &&
              [
                { id: 'turno_atual', label: 'Turno Atual' },
                { id: 'movimentacoes', label: 'Movimentações' },
                { id: 'fechamento', label: 'Fechamento' },
              ].map((sub) => {
                const isSubActive =
                  (sub.id === 'turno_atual' && ['turno_atual', 'fluxo'].includes(activeSubTab)) ||
                  (sub.id === 'movimentacoes' &&
                    ['movimentacoes', 'ajustes', 'ajustes_caixa', 'suprimento', 'sangria'].includes(activeSubTab)) ||
                  (sub.id === 'fechamento' &&
                    ['fechamento', 'conferencia', 'conferencia_cega'].includes(activeSubTab)) ||
                  activeSubTab === sub.id;
                return (
                  <button
                    key={sub.id}
                    onClick={() => setActiveSubTab(sub.id)}
                    className={clsx('cashier-subnav__button', isSubActive && 'is-active')}
                  >
                    {sub.label}
                  </button>
                );
              })}

            {activeTab === 'clientes' &&
              [
                { id: 'clientes', label: 'Clientes' },
                { id: 'fidelidade', label: 'Programa de Fidelidade' },
                { id: 'cupons', label: 'Cupons & Promoções' },
              ].map((sub) => {
                const isSubActive =
                  (sub.id === 'clientes' && ['clientes', 'crm', 'banco_clientes'].includes(activeSubTab)) ||
                  (sub.id === 'fidelidade' && ['fidelidade', 'programa_fidelidade'].includes(activeSubTab)) ||
                  (sub.id === 'cupons' && ['cupons', 'cupom', 'promocoes', 'descontos'].includes(activeSubTab)) ||
                  activeSubTab === sub.id;
                return (
                  <button
                    key={sub.id}
                    onClick={() => setActiveSubTab(sub.id)}
                    className={clsx('cashier-subnav__button', isSubActive && 'is-active')}
                  >
                    {sub.label}
                  </button>
                );
              })}

            {(activeTab === 'relatorios' || activeTab === 'dashboard') &&
              [
                { id: 'visao_geral', label: 'Visão Geral' },
                { id: 'financeiro', label: 'Financeiro' },
                { id: 'produtos', label: 'Produtos' },
                { id: 'equipe', label: 'Equipe' },
              ].map((sub) => {
                const isSubActive =
                  (sub.id === 'visao_geral' &&
                    ['visao_geral', 'metas', 'vendas', 'indicadores'].includes(activeSubTab)) ||
                  (sub.id === 'financeiro' && ['financeiro', 'dre', 'demonstrativo_dre'].includes(activeSubTab)) ||
                  (sub.id === 'produtos' && ['produtos', 'produtos_mais_vendidos', 'top10'].includes(activeSubTab)) ||
                  (sub.id === 'equipe' && ['equipe', 'desempenho_equipe'].includes(activeSubTab)) ||
                  activeSubTab === sub.id;
                return (
                  <button
                    key={sub.id}
                    id={`relatorios-subtab-${sub.id}`}
                    onClick={() => setActiveSubTab(sub.id)}
                    className={clsx('cashier-subnav__button', isSubActive && 'is-active')}
                  >
                    {sub.label}
                  </button>
                );
              })}

            {activeTab === 'permissoes_cargos' &&
              [
                { id: 'pessoas', label: 'Pessoas' },
                { id: 'cargos_permissoes', label: 'Funções e acessos' },
              ].map((sub) => {
                const isSubActive =
                  (sub.id === 'pessoas' && ['pessoas', 'equipe', 'convites'].includes(activeSubTab)) ||
                  (sub.id === 'cargos_permissoes' &&
                    ['cargos_permissoes', 'cargos', 'permissoes'].includes(activeSubTab)) ||
                  activeSubTab === sub.id;
                return (
                  <button
                    key={sub.id}
                    id={`equipe-subtab-${sub.id}`}
                    onClick={() => setActiveSubTab(sub.id)}
                    className={clsx('cashier-subnav__button', isSubActive && 'is-active')}
                  >
                    {sub.label}
                  </button>
                );
              })}
          </div>

          {/* Dynamic Inner views */}
          <div className={clsx('cashier-content', 'min-w-0', 'min-h-0', 'flex-1', 'p-5', 'relative')}>
            {/* CASHIER CLOSED WARNING BANNER */}
            {turno?.status !== 'aberto' && ['pedidos', 'balcao', 'mesas', 'kds'].includes(activeSubTab) && (
              <div
                className={clsx(
                  'absolute',
                  'inset-0',
                  'bg-black/80',
                  'backdrop-blur-xs',
                  'z-30',
                  'flex',
                  'flex-col',
                  'items-center',
                  'justify-center',
                  'text-center',
                  'p-8',
                  'space-y-4',
                )}
              >
                <div
                  className={clsx(
                    'p-4',
                    'bg-koma-panel',
                    'rounded-full',
                    'border',
                    'border-amber-500/20',
                    'text-amber-500',
                  )}
                >
                  <Lock size={32} />
                </div>
                <h3 className={clsx('font-serif', 'text-base', 'font-bold', 'text-koma-foreground')}>
                  Turno de Caixa Fechado
                </h3>
                <p className={clsx('max-w-md', 'text-[10px]', 'text-koma-subtle', 'leading-relaxed')}>
                  Você precisa abrir o caixa digitando o fundo de troco inicial da noite para poder acessar as telas de
                  vendas e comandas.
                </p>
                <button
                  onClick={() => setShowAbrirModal(true)}
                  className={clsx(
                    'px-5',
                    'py-2.5',
                    'bg-emerald-600',
                    'hover:bg-emerald-700',
                    'text-white',
                    'font-bold',
                    'rounded-xl',
                    'transition-all',
                    'cursor-pointer',
                    'text-[10px]',
                    'uppercase',
                    'tracking-wider',
                  )}
                >
                  Abrir Caixa Agora
                </button>
              </div>
            )}

            {/* VIEW 1: MEUS PEDIDOS (Kanban) */}
            {activeSubTab === 'pedidos' && (
              <CaixaOrdersWorkspace
                columns={{
                  tableProduction: filteredCol1.map(buildCashierTableCard),
                  digitalProduction: filteredDigitalProduction,
                  tableClosing: filteredCol2Table.map(buildCashierTableCard),
                  digitalFinalization: filteredDeliveryFinalization,
                }}
                pendingCashPayments={pagamentosPendentes.map((pag) => {
                  const comandaMesa = orders.find((order) => order.id === pag.comanda_id);
                  return { ...pag, mesaNum: comandaMesa ? comandaMesa.mesaId : '?' };
                })}
                insights={operationalOrderInsights}
                search={{ query: searchQuery, onChange: setSearchQuery }}
                acceptance={{
                  orders: deliveryOrders,
                  automatic: autoAccept,
                  drawerOpen: isDrawerOpen,
                  onAutomaticChange: setAutoAccept,
                  onDrawerChange: setIsDrawerOpen,
                }}
                navigation={{
                  stage: mobileOrdersStage,
                  onStageChange: setMobileOrdersStage,
                  expandedCardIds,
                  onToggleCard: toggleCardExpansion,
                }}
                actions={{
                  confirmCashPayment: handleConfirmPendingCashPayment,
                  rejectCashPayment: handleRejectPendingCashPayment,
                  acceptDigitalOrder: handleAcceptPendingDeliveryOrder,
                  rejectDigitalOrder: handleRejectPendingDeliveryOrder,
                  inspectTableOrder: (order) => setSelectedKanbanOrder(order),
                  inspectDigitalOrder: openDeliveryOrderDetails,
                  printConference: handleQuickPrintOrder,
                  markTableItemsReady: handleMarkTableItemsReady,
                  advanceDigitalOrder: handleAdvanceDigitalOrder,
                  openTablePayment: handleOpenTablePayment,
                  finalizeDigitalOrder: handleFinalizeDigitalOrder,
                }}
                isLoading={isLoading}
                now={nowTimestamp}
              />
            )}

            {/* VIEW 2: PDV (Pedidos Balcão) */}
            <DeferredCashierSection
              active={activeSubTab === 'balcao'}
              label="Novo pedido"
              load={loadCashierPdvView}
              sectionProps={{ activeSubTab, catalogReady, isLoading, pdvTableOptions, pdv }}
            />

            {/* VIEW 3: MAPA DE MESAS (Salão) */}
            {activeSubTab === 'mesas' && (
              <CaixaSalonTab
                cards={salonTableCards}
                visibleCards={visibleSalonTableCards}
                counts={tableStatusCounts}
                insights={salonInsights}
                filter={tableStatusFilter}
                onFilterChange={setTableStatusFilter}
                fetchError={fetchError}
                actions={{
                  receiveTable: handleReceiveSalonTable,
                  inspectTable: handleInspectSalonTable,
                  openTableOrder: handleOpenSalonTableOrder,
                }}
              />
            )}

            {/* VIEW 4: MEU DESEMPENHO (Analytics) */}
            <DeferredCashierSection
              active={activeTab === 'relatorios' || activeTab === 'dashboard' || activeSubTab === 'desempenho'}
              label="Relatórios"
              load={loadCashierReports}
              sectionProps={{
                apiBaseUrl,
                authHeaders,
                activeTab,
                activeSubTab,
                setActiveSubTab,
                showToast,
                deliveryOrders,
                activeKitchenItems,
                apiCategorias,
              }}
            />

            {/* VIEW 5: COZINHA (KDS) */}
            {activeSubTab === 'kds' && (
              <div
                className={clsx('bg-koma-card/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-4')}
              >
                <div
                  className={clsx('border-b', 'border-koma-border', 'pb-3', 'flex', 'items-center', 'justify-between')}
                >
                  <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary')}>
                    Painel de Produção da Cozinha
                  </span>
                  <span
                    className={clsx(
                      'bg-emerald-500/15',
                      'text-emerald-700 dark:text-emerald-400',
                      'font-bold',
                      'px-2',
                      'py-0.5',
                      'rounded-full',
                      'font-mono',
                      'text-[9px]',
                    )}
                  >
                    {activeKitchenItems.length} pratos ativos
                  </span>
                </div>

                {activeKitchenItems.length === 0 ? (
                  <div className={clsx('py-32', 'text-center', 'text-koma-muted', 'italic', 'space-y-1')}>
                    <p>Cozinha Limpa!</p>
                    <p className={clsx('text-[9px]', 'text-gray-600')}>Nenhum pedido aguardando preparo no momento</p>
                  </div>
                ) : (
                  <div
                    className={clsx(
                      'grid',
                      'grid-cols-1',
                      'sm:grid-cols-2',
                      'md:grid-cols-3',
                      'xl:grid-cols-4',
                      'gap-4',
                    )}
                  >
                    {activeKitchenItems.map((item) => (
                      <div
                        key={item.id}
                        className={`bg-koma-card border p-3 rounded-2xl space-y-3 flex flex-col justify-between ${
                          item.status === 'pronto' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-koma-border'
                        }`}
                      >
                        <div className="space-y-2">
                          {/* Header */}
                          <div className={clsx('flex', 'justify-between', 'items-start')}>
                            <div>
                              <span className={clsx('text-[9px]', 'text-koma-subtle', 'font-bold', 'block')}>
                                Mesa {item.mesaId > 0 ? item.mesaId : 'Balcão'}
                              </span>
                              <strong
                                className={clsx(
                                  'text-koma-foreground',
                                  'text-xs',
                                  'block',
                                  'mt-0.5',
                                  'truncate',
                                  'w-32',
                                )}
                              >
                                {item.nome}
                              </strong>
                            </div>
                            <KDSTimer
                              itemTimestamp={
                                (item as any).created_at || (item as any).timestamp || (item as any).preparando_desde
                              }
                              status={item.status}
                            />
                          </div>

                          {/* Observations / details */}
                          {item.observacao && (
                            <div
                              className={clsx(
                                'bg-koma-page',
                                'border',
                                'border-koma-border/50',
                                'p-2',
                                'rounded-lg',
                                'text-rose-400',
                                'font-bold',
                                'text-[10px]',
                                'leading-relaxed',
                                'font-mono',
                              )}
                            >
                              Obs: {item.observacao}
                            </div>
                          )}
                          <span className={clsx('text-[9px]', 'text-koma-muted', 'block', 'truncate')}>
                            Lançado por: {item.garcomNome}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className={clsx('pt-2', 'border-t', 'border-koma-border', 'shrink-0')}>
                          {item.status === 'preparando' ? (
                            <button
                              onClick={() => handleUpdateItemStatus(item.id, 'pronto')}
                              className={clsx(
                                'w-full',
                                'py-1.5',
                                'bg-[#10b981]',
                                'hover:bg-[#059669]',
                                'text-[#121214]',
                                'font-bold',
                                'rounded-lg',
                                'text-[9px]',
                                'uppercase',
                                'tracking-wider',
                                'cursor-pointer',
                              )}
                            >
                              Marcar como Pronto
                            </button>
                          ) : (
                            <button
                              onClick={() => handleUpdateItemStatus(item.id, 'entregue')}
                              className={clsx(
                                'w-full',
                                'py-1.5',
                                'bg-emerald-600',
                                'hover:bg-emerald-700',
                                'text-white',
                                'font-bold',
                                'rounded-lg',
                                'text-[9px]',
                                'uppercase',
                                'tracking-wider',
                                'cursor-pointer',
                              )}
                            >
                              Marcar como Entregue
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* VIEW: EQUIPE — PESSOAS */}
            <DeferredCashierSection
              active={activeTab === 'permissoes_cargos'}
              label="Equipe"
              load={loadCashierTeam}
              sectionProps={{ apiBaseUrl, authHeaders, activeTab, activeSubTab, setActiveSubTab, showToast }}
            />

            {/* VIEW: EQUIPE — CARGOS E PERMISSÕES (dados reais da API) */}

            {/* VIEW 7: CONFIGURAÇÕES SALÃO (Impressão, App Garçom e Taxa) */}
            <DeferredCashierSection
              active={activeTab === 'impressao_salao' || activeSubTab === 'impressoras'}
              label="Configurações"
              load={loadCashierSettings}
              sectionProps={{
                apiBaseUrl,
                authHeaders,
                activeTab,
                activeSubTab,
                setActiveSubTab,
                showToast,
                setActiveTab,
                hasPrinting,
                salonTables,
                salonTableCards,
                onCreateMesa,
                onUpdateMesa,
                onDeleteMesa,
                setCheckoutServiceTax,
                settings,
              }}
            />

            {/* VIEW 9: PAGAMENTOS & PLANOS */}
            {activeSubTab === 'planos' && (
              <AssinaturaPixTab
                currentPlanId={currentPlanId}
                hasPrinting={hasPrinting}
                hasOnlineMenu={hasOnlineMenu}
                isTestPlan={restauranteConfig?.plano_modo_teste === true || isRestaurant2Test}
                bannerNotice={planNoticeBanner}
              />
            )}

            {/* VIEW: FIDELIDADE */}
            <DeferredCashierSection
              active={activeTab === 'clientes'}
              label="Clientes"
              load={loadCashierCustomers}
              sectionProps={{
                apiBaseUrl,
                authHeaders,
                activeTab,
                activeSubTab,
                setActiveSubTab,
                showToast,
                loyaltyUsers,
                refreshLoyaltyUsers,
              }}
            />

            {/* VIEW: RELATÓRIOS — VISÃO GERAL */}

            {/* VIEW: RELATÓRIOS — FINANCEIRO (DRE) */}

            {/* VIEW: RELATÓRIOS — PRODUTOS */}

            {/* VIEW: RELATÓRIOS — EQUIPE (reutiliza o mesmo componente de desempenho) */}

            {/* CATÁLOGO CENTRAL: produtos e disponibilidade usam o mesmo snapshot. */}
            <DeferredCashierSection
              active={activeTab === 'cardapio'}
              label="Cardápio"
              load={loadCashierCatalog}
              sectionProps={{
                apiBaseUrl,
                authHeaders,
                activeTab,
                activeSubTab,
                setActiveSubTab,
                showToast,
                apiProdutos,
                apiCategorias,
                suggestedProductCode,
                hasOnlineMenu,
                fetchProdutos,
                fetchCategorias,
                catalogReady,
                restauranteConfig,
                onRefreshCategorias,
              }}
            />

            {/* ABA CATEGORIAS */}

            {/* ABA COMPLEMENTOS */}

            {/* ABA CUPONS */}

            {/* LIVE VIEW: ESTOQUE DE INSUMOS */}
            <DeferredCashierSection
              active={activeTab === 'estoque'}
              label="Estoque"
              load={loadCashierInventory}
              sectionProps={{
                apiBaseUrl,
                authHeaders,
                activeTab,
                activeSubTab,
                setActiveSubTab,
                showToast,
                apiProdutos,
                isLoading,
              }}
            />

            {/* LIVE VIEW: HISTÓRICO UNIFICADO DE ESTOQUE */}

            {/* LIVE VIEW: CONTAGEM FÍSICA (INVENTÁRIO) */}

            {/* LIVE VIEW: DISTRIBUIDORES */}

            {/* MÓDULO CAIXA REORGANIZADO */}
            {activeTab === 'financeiro' && (activeSubTab === 'turno_atual' || activeSubTab === 'fluxo') && (
              <div className={clsx('orders-workspace', 'space-y-4')}>
                <OperationalBanner
                  id="cash-heading"
                  eyebrow="CAIXA"
                  title="Turno atual"
                  accent={
                    turnoResumo?.turno_esquecido
                      ? 'precisa de revisão'
                      : turnoResumo?.status === 'aberto'
                        ? 'em ordem'
                        : 'ainda fechado'
                  }
                  description={
                    turnoResumo?.turno_esquecido
                      ? 'Este turno está aberto há mais de 24 horas. Confira os valores e encerre quando possível.'
                      : 'Veja o dinheiro, os recebimentos e o que precisa de atenção.'
                  }
                  metrics={[
                    {
                      label: 'aberto há',
                      value: turnoResumo?.status === 'aberto' ? formatDuration(turnoResumo.tempo_aberto_minutos) : '—',
                    },
                    {
                      label: 'ritmo de vendas',
                      value: turnoResumo?.status === 'aberto' ? `${formatCompactCurrency(cashSalesPerHour)}/h` : '—',
                    },
                    {
                      label: 'situação do turno',
                      value: cashShiftHealth,
                      valueClassName: turnoResumo?.turno_esquecido
                        ? 'text-amber-600 dark:text-amber-300'
                        : 'text-emerald-600 dark:text-emerald-300',
                    },
                  ]}
                />
                <CaixaTurnoAtualTab
                  turnoResumo={turnoResumo}
                  isLoading={isTurnoResumoLoading}
                  pendingPaymentsCount={pagamentosPendentes.length}
                  pendingPaymentsTotal={pendingPaymentsTotal}
                  onNavigateToFechamento={() => setActiveSubTab('fechamento')}
                  onNavigateToMovimentacoes={() => setActiveSubTab('movimentacoes')}
                  onNavigateToPendingPayments={() => {
                    setActiveTab('operacao');
                    setActiveSubTab('pedidos');
                  }}
                  onOpenSangriaModal={() => setShowSangriaModal(true)}
                  onOpenSuprimentoModal={() => setShowSuprimentoModal(true)}
                  onOpenNovoTurnoModal={() => setShowAbrirModal(true)}
                />
              </div>
            )}

            {activeTab === 'financeiro' &&
              (activeSubTab === 'movimentacoes' ||
                activeSubTab === 'ajustes' ||
                activeSubTab === 'suprimento' ||
                activeSubTab === 'sangria') && (
                <CaixaMovimentacoesTab
                  movimentacoes={caixaMovimentacoes}
                  turnoResumo={turnoResumo}
                  isLoading={isCaixaMovimentacoesLoading}
                />
              )}

            {activeTab === 'financeiro' && (activeSubTab === 'fechamento' || activeSubTab === 'conferencia') && (
              <div className={clsx('orders-workspace', 'space-y-4')}>
                <OperationalBanner
                  id="cash-closing-heading"
                  eyebrow="CAIXA"
                  title="Fechamento"
                  accent="do seu jeito"
                  description="Use a conferência rápida ou faça uma conferência totalmente cega."
                  metrics={[
                    {
                      label: 'aberto há',
                      value: turnoResumo?.status === 'aberto' ? formatDuration(turnoResumo.tempo_aberto_minutos) : '—',
                    },
                    {
                      label: 'pagamentos pendentes',
                      value: pagamentosPendentes.length,
                      valueClassName:
                        pagamentosPendentes.length > 0
                          ? 'text-amber-600 dark:text-amber-300'
                          : 'text-emerald-600 dark:text-emerald-300',
                    },
                    { label: 'valor pendente', value: formatCompactCurrency(pendingPaymentsTotal) },
                  ]}
                />
                <CaixaFechamentoTab
                  isTurnoAberto={turnoResumo?.status === 'aberto'}
                  fechamentoResult={fechamentoResult}
                  turnoResumo={turnoResumo}
                  pendingPaymentsCount={pagamentosPendentes.length}
                  pendingPaymentsTotal={pendingPaymentsTotal}
                  onConfirmFechamento={handleConfirmarFechamento}
                  onOpenNovoTurnoModal={() => setShowAbrirModal(true)}
                  onNavigateToPendingPayments={() => {
                    setActiveTab('operacao');
                    setActiveSubTab('pedidos');
                  }}
                  onNavigateToOpenComandas={() => {
                    setActiveTab('operacao');
                    setActiveSubTab('pedidos');
                  }}
                />
              </div>
            )}

            {/* CRM CLIENTES — REAL DATA */}

            {/* VIEW: FRETISTAS & LOGÍSTICA */}
            {activeSubTab === 'entregadores' && (
              <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5', 'animate-fade-in', 'text-left')}>
                {/* Painel de Entregas (Colunas da Esquerda) */}
                <div
                  className={clsx(
                    'lg:col-span-2',
                    'bg-koma-card/60',
                    'border',
                    'border-koma-border',
                    'rounded-3xl',
                    'p-5',
                    'space-y-5',
                    'flex',
                    'flex-col',
                    'overflow-hidden',
                  )}
                >
                  <div className={clsx('border-b', 'border-koma-border', 'pb-3', 'shrink-0')}>
                    <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary', 'block', 'text-sm')}>
                      Controle de Despacho e Entregas
                    </span>
                    <span className={clsx('text-[9px]', 'text-koma-muted', 'block')}>
                      Gerencie o fluxo de saída e entrega de pedidos de Delivery.
                    </span>
                  </div>

                  {/* Pedidos Pendentes de Envio */}
                  <div className={clsx('space-y-3', 'flex-1', 'overflow-y-auto')}>
                    <span
                      className={clsx(
                        'text-[10px]',
                        'font-bold',
                        'text-emerald-700 dark:text-emerald-400',
                        'uppercase',
                        'tracking-wider',
                        'block',
                      )}
                    >
                      Pedidos para Despachar
                    </span>

                    {deliveryOrders.filter((o) => o.status === 'producao' || o.status === 'analise').length === 0 ? (
                      <div
                        className={clsx(
                          'py-8',
                          'text-center',
                          'text-koma-muted',
                          'text-xs',
                          'italic',
                          'bg-koma-panel/20',
                          'border',
                          'border-koma-border/40',
                          'rounded-2xl',
                        )}
                      >
                        Não há pedidos prontos ou em produção aguardando despacho no momento.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {deliveryOrders
                          .filter((o) => o.status === 'producao' || o.status === 'analise')
                          .map((order) => {
                            const motoboyId = selectedMotoboys[order.id] || '';
                            return (
                              <div
                                key={order.id}
                                className={clsx(
                                  'p-4',
                                  'bg-koma-panel',
                                  'border',
                                  'border-koma-border',
                                  'rounded-2xl',
                                  'flex',
                                  'flex-col',
                                  'sm:flex-row',
                                  'justify-between',
                                  'gap-3',
                                  'text-xs',
                                )}
                              >
                                <div className={clsx('space-y-1.5', 'flex-1')}>
                                  <div className={clsx('flex', 'items-center', 'gap-2')}>
                                    <span className={clsx('font-bold', 'text-koma-foreground', 'text-[11px]')}>
                                      Pedido {order.id}
                                    </span>
                                    <span
                                      className={clsx(
                                        'bg-emerald-500/15',
                                        'text-emerald-700 dark:text-emerald-400',
                                        'text-[8px]',
                                        'font-bold',
                                        'px-1.5',
                                        'py-0.5',
                                        'rounded',
                                        'border',
                                        'border-emerald-500/30',
                                        'uppercase',
                                      )}
                                    >
                                      {order.canal}
                                    </span>
                                  </div>
                                  <span className={clsx('text-koma-secondary', 'font-bold', 'block')}>
                                    {order.cliente} • {order.telefone}
                                  </span>
                                  <span className={clsx('text-koma-subtle', 'text-[10px]', 'block', 'leading-relaxed')}>
                                    {order.endereco}
                                  </span>
                                  <span className={clsx('text-[9px]', 'text-koma-muted', 'block', 'font-mono')}>
                                    Itens: {order.itens}
                                  </span>
                                </div>

                                <div
                                  className={clsx(
                                    'flex',
                                    'flex-col',
                                    'sm:items-end',
                                    'justify-between',
                                    'gap-2',
                                    'shrink-0',
                                  )}
                                >
                                  <span className={clsx('font-mono', 'font-bold', 'text-emerald-400', 'text-[11px]')}>
                                    R$ {order.total.toFixed(2)}
                                  </span>

                                  <div className={clsx('flex', 'items-center', 'gap-2')}>
                                    <select
                                      value={motoboyId}
                                      onChange={(e) =>
                                        setSelectedMotoboys((prev) => ({ ...prev, [order.id]: e.target.value }))
                                      }
                                      className={clsx(
                                        'py-1.5',
                                        'px-2',
                                        'bg-koma-card',
                                        'border',
                                        'border-koma-border',
                                        'text-koma-foreground',
                                        'rounded-xl',
                                        'text-[10px]',
                                        'focus:outline-none',
                                        'focus:border-[#10b981]',
                                      )}
                                    >
                                      <option value="">Selecione o Entregador...</option>
                                      {motoboys
                                        .filter((m) => m.ativo)
                                        .map((m) => (
                                          <option key={m.id} value={m.id}>
                                            {m.nome}
                                          </option>
                                        ))}
                                    </select>
                                    <button
                                      type="button"
                                      disabled={!motoboyId}
                                      onClick={() => handleDespacharKanban(order.id, motoboyId)}
                                      className={clsx(
                                        'py-1.5',
                                        'px-3',
                                        'bg-emerald-600',
                                        'hover:bg-emerald-500',
                                        'disabled:opacity-50',
                                        'text-white',
                                        'font-bold',
                                        'rounded-xl',
                                        'text-[10px]',
                                        'uppercase',
                                        'tracking-wider',
                                        'transition-colors',
                                        'cursor-pointer',
                                      )}
                                    >
                                      Despachar
                                    </button>
                                    <button
                                      type="button"
                                      disabled={!motoboyId}
                                      onClick={() => handleRevogarAcessoMotoboy(motoboyId)}
                                      className={clsx(
                                        'py-1.5',
                                        'px-2.5',
                                        'bg-rose-500/20',
                                        'hover:bg-rose-500/30',
                                        'border',
                                        'border-rose-500/40',
                                        'disabled:opacity-40',
                                        'text-rose-600 dark:text-rose-300',
                                        'font-bold',
                                        'rounded-xl',
                                        'text-[10px]',
                                        'uppercase',
                                        'tracking-wider',
                                        'transition-colors',
                                        'cursor-pointer',
                                        'flex',
                                        'items-center',
                                        'gap-1',
                                      )}
                                      title="Revogar todos os links ativos do entregador selecionado"
                                    >
                                      Revogar
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}

                    {/* Pedidos Em Trânsito */}
                    <span
                      className={clsx(
                        'text-[10px]',
                        'font-bold',
                        'text-emerald-700 dark:text-emerald-400',
                        'uppercase',
                        'tracking-wider',
                        'block',
                        'pt-4',
                      )}
                    >
                      Em Trânsito (Entregas Ativas)
                    </span>

                    {deliveryOrders.filter((o) => o.status === 'pronto').length === 0 ? (
                      <div
                        className={clsx(
                          'py-8',
                          'text-center',
                          'text-koma-muted',
                          'text-xs',
                          'italic',
                          'bg-koma-panel/20',
                          'border',
                          'border-koma-border/40',
                          'rounded-2xl',
                        )}
                      >
                        Nenhum pedido em trânsito no momento.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {deliveryOrders
                          .filter((o) => o.status === 'pronto')
                          .map((order) => {
                            return (
                              <div
                                key={order.id}
                                className={clsx(
                                  'p-4',
                                  'bg-koma-panel/40',
                                  'border',
                                  'border-koma-border/40',
                                  'rounded-2xl',
                                  'flex',
                                  'flex-col',
                                  'sm:flex-row',
                                  'justify-between',
                                  'gap-3',
                                  'text-xs',
                                )}
                              >
                                <div className={clsx('space-y-1', 'flex-1')}>
                                  <div className={clsx('flex', 'items-center', 'gap-2')}>
                                    <span className={clsx('font-bold', 'text-koma-foreground', 'text-[11px]')}>
                                      Pedido {order.id}
                                    </span>
                                    <span
                                      className={clsx(
                                        'bg-emerald-500/10',
                                        'text-emerald-400',
                                        'text-[8px]',
                                        'font-bold',
                                        'px-1.5',
                                        'py-0.5',
                                        'rounded',
                                        'border',
                                        'border-emerald-500/20',
                                        'uppercase',
                                        'tracking-wider',
                                      )}
                                    >
                                      Em Trânsito
                                    </span>
                                  </div>
                                  <span className={clsx('text-koma-secondary', 'font-bold', 'block')}>
                                    {order.cliente} • {order.telefone}
                                  </span>
                                  <span className={clsx('text-koma-subtle', 'text-[10px]', 'block', 'leading-relaxed')}>
                                    {order.endereco}
                                  </span>
                                </div>

                                <div
                                  className={clsx(
                                    'flex',
                                    'flex-col',
                                    'sm:items-end',
                                    'justify-between',
                                    'gap-2',
                                    'shrink-0',
                                  )}
                                >
                                  <span className={clsx('font-mono', 'font-bold', 'text-emerald-400', 'text-[11px]')}>
                                    R$ {order.total.toFixed(2)}
                                  </span>

                                  <button
                                    type="button"
                                    onClick={() => handleFinalizarPedido(order.id)}
                                    className={clsx(
                                      'py-1.5',
                                      'px-3',
                                      'bg-emerald-600',
                                      'hover:bg-emerald-700',
                                      'text-white',
                                      'font-bold',
                                      'rounded-xl',
                                      'text-[10px]',
                                      'uppercase',
                                      'tracking-wider',
                                      'transition-colors',
                                      'cursor-pointer',
                                    )}
                                  >
                                    Concluir Entrega
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Gerenciamento de Fretistas (Coluna da Direita) */}
                <div
                  className={clsx(
                    'bg-koma-card/60',
                    'border',
                    'border-koma-border',
                    'rounded-3xl',
                    'p-5',
                    'space-y-4',
                    'flex',
                    'flex-col',
                    'justify-between',
                    'overflow-hidden',
                  )}
                >
                  <div className={clsx('space-y-4', 'flex-1', 'flex', 'flex-col', 'overflow-hidden')}>
                    <div className={clsx('border-b', 'border-koma-border', 'pb-3', 'shrink-0')}>
                      <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary', 'block', 'text-sm')}>
                        Fretistas Cadastrados
                      </span>
                      <span className={clsx('text-[9px]', 'text-koma-muted', 'block')}>
                        Lista de motoboys e entregadores de plantão.
                      </span>
                    </div>

                    <div className={clsx('flex-1', 'overflow-y-auto', 'space-y-2.5')}>
                      {motoboys.length === 0 ? (
                        <span className={clsx('text-xs', 'text-koma-muted', 'italic')}>
                          Nenhum fretista cadastrado.
                        </span>
                      ) : (
                        motoboys.map((m) => (
                          <div
                            key={m.id}
                            className={clsx(
                              'p-3',
                              'bg-koma-panel',
                              'border',
                              'border-koma-border',
                              'rounded-xl',
                              'flex',
                              'items-center',
                              'justify-between',
                              'gap-2',
                            )}
                          >
                            <div className="text-xs">
                              <span className={clsx('font-bold', 'text-koma-foreground', 'block')}>{m.nome}</span>
                              <span className={clsx('text-[10px]', 'text-koma-subtle', 'block', 'font-mono')}>
                                {m.telefone}
                              </span>
                            </div>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                                m.ativo
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}
                            >
                              {m.ativo ? 'Ativo' : 'Inativo'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Cadastro de novo Motoboy */}
                  <form
                    onSubmit={(e) => handleAddMotoboy(e, novoMotoboyNome, novoMotoboyTelefone)}
                    className={clsx('pt-4', 'border-t', 'border-koma-border', 'space-y-3', 'shrink-0')}
                  >
                    <span
                      className={clsx(
                        'text-[10px]',
                        'font-bold',
                        'text-emerald-700 dark:text-emerald-400',
                        'uppercase',
                        'tracking-wider',
                        'block',
                      )}
                    >
                      Novo Fretista
                    </span>

                    <input
                      type="text"
                      required
                      placeholder="Nome do Entregador"
                      value={novoMotoboyNome}
                      onChange={(e) => setNewMotoboyNome(e.target.value)}
                      className={clsx(
                        'w-full',
                        'px-3',
                        'py-2',
                        'bg-koma-page',
                        'border',
                        'border-koma-border',
                        'rounded-xl',
                        'text-koma-foreground',
                        'text-xs',
                        'focus:outline-none',
                        'focus:border-[#10b981]',
                      )}
                    />
                    <input
                      type="text"
                      required
                      placeholder="Telefone (ex: 81 99999-8888)"
                      value={novoMotoboyTelefone}
                      onChange={(e) => setNewMotoboyTelefone(e.target.value)}
                      className={clsx(
                        'w-full',
                        'px-3',
                        'py-2',
                        'bg-koma-page',
                        'border',
                        'border-koma-border',
                        'rounded-xl',
                        'text-koma-foreground',
                        'text-xs',
                        'font-mono',
                        'focus:outline-none',
                        'focus:border-[#10b981]',
                      )}
                    />
                    <button
                      type="submit"
                      className={clsx(
                        'w-full',
                        'py-2',
                        'bg-emerald-600',
                        'hover:bg-[#9d2b3c]',
                        'text-white',
                        'font-bold',
                        'rounded-xl',
                        'text-[10px]',
                        'uppercase',
                        'tracking-wider',
                        'transition-colors',
                        'cursor-pointer',
                      )}
                    >
                      Adicionar Fretista
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* CONFIGURAÇÃO CARDÁPIO DIGITAL WHITELABEL */}
            <DeferredCashierSection
              active={activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital'}
              label="Cardápio online"
              load={loadCashierOnlineMenu}
              sectionProps={{
                apiBaseUrl,
                authHeaders,
                activeTab,
                activeSubTab,
                setActiveSubTab,
                showToast,
                setActiveTab,
                hasOnlineMenu,
              }}
            />
          </div>
        </main>

        {/* 1. MODAL: ABRIR CAIXA */}
        {showAbrirModal && (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowAbrirModal(false);
            }}
            className={clsx(
              'fixed',
              'inset-0',
              'bg-black/85',
              'backdrop-blur-xs',
              'z-50',
              'flex',
              'items-center',
              'justify-center',
              'p-4',
              'cursor-pointer',
            )}
          >
            <form
              onSubmit={handleAbrirCaixa}
              className={clsx(
                'bg-koma-panel',
                'border',
                'border-koma-border',
                'rounded-3xl',
                'w-full',
                'max-w-sm',
                'p-6',
                'space-y-5',
                'shadow-2xl',
                'animate-scale-in',
              )}
            >
              <div
                className={clsx('flex', 'justify-between', 'items-center', 'border-b', 'border-koma-border', 'pb-3')}
              >
                <h3 className={clsx('font-serif', 'font-bold', 'text-lg', 'text-koma-foreground')}>
                  Abertura de Caixa
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAbrirModal(false)}
                  className={clsx(
                    'p-1',
                    'hover:bg-koma-raised',
                    'rounded-full',
                    'text-koma-subtle',
                    'hover:text-koma-foreground',
                    'transition-colors',
                    'cursor-pointer',
                    'border',
                    'border-transparent',
                  )}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-1.5">
                <label
                  className={clsx(
                    'text-[10px]',
                    'font-bold',
                    'text-koma-secondary',
                    'uppercase',
                    'tracking-wider',
                    'block',
                  )}
                >
                  Fundo de Troco Inicial (R$):
                </label>
                <div className="relative">
                  <span className={clsx('absolute', 'left-3.5', 'top-3', 'text-koma-subtle', 'font-mono')}>R$</span>
                  <MoneyInput
                    required
                    value={saldoInicial}
                    onValueChange={setSaldoInicial}
                    className={clsx(
                      'w-full',
                      'pl-9',
                      'pr-4',
                      'py-2.5',
                      'bg-koma-card',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'focus:outline-none',
                      'focus:ring-2',
                      'focus:ring-[#10b981]/20',
                      'focus:border-[#10b981]',
                      'text-koma-foreground',
                      'font-mono',
                    )}
                  />
                </div>
              </div>

              {errorMsg && (
                <div
                  className={clsx(
                    'bg-rose-500/10',
                    'border',
                    'border-rose-500/25',
                    'text-rose-400',
                    'p-2.5',
                    'rounded-xl',
                    'text-center',
                    'font-medium',
                    'block',
                  )}
                >
                  {errorMsg}
                </div>
              )}

              <div className={clsx('flex', 'gap-2.5')}>
                <button
                  type="button"
                  onClick={() => setShowAbrirModal(false)}
                  className={clsx(
                    'flex-1',
                    'py-2.5',
                    'bg-koma-card',
                    'hover:bg-koma-raised',
                    'border',
                    'border-koma-border',
                    'text-koma-foreground',
                    'rounded-xl',
                    'transition-all',
                    'cursor-pointer',
                    'font-bold',
                  )}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx(
                    'flex-1',
                    'py-2.5',
                    'bg-emerald-600',
                    'hover:bg-emerald-700',
                    'text-white',
                    'rounded-xl',
                    'transition-all',
                    'cursor-pointer',
                    'font-bold',
                    'shadow-md',
                  )}
                >
                  Confirmar Abertura
                </button>
              </div>
            </form>
          </div>
        )}

        <CheckoutDialog
          controller={checkout}
          smartPos={smartPos}
          errorMsg={errorMsg}
          taxaServicoAtiva={taxaServicoAtiva}
          serviceTaxRate={serviceTaxRate}
        />

        {/* 5. MODAL: ADICIONAR MESA */}

        {/* 5.1 MODAL: EDITAR / EXCLUIR MESA */}

        {/* 6. MODAL: INSPECIONAR E REIMPRIMIR PEDIDO DO KANBAN */}
        {selectedKanbanOrder && (
          <KanbanOrderDetails
            order={selectedKanbanOrder}
            transfer={{
              targetId: tableTransferTargetId,
              onTargetChange: setTableTransferTargetId,
              isTransferring: isTransferringTable,
              tables: salonTables,
            }}
            actions={{
              close: () => setSelectedKanbanOrder(null),
              advanceDigitalOrder: handleAdvanceSelectedKanbanOrder,
              reprintProduction: handleReprintSelectedKanbanProduction,
              printFullTable: handlePrintSelectedKanbanTable,
              printTableValues: handlePrintSelectedKanbanValues,
              transferTable: handleTransferSelectedKanbanTable,
              cancelConsumption: handleCancelSelectedKanbanConsumption,
              cancelOrder: handleCancelSelectedKanbanOrder,
            }}
          />
        )}

        {cancelConsumptionTarget && (
          <div
            className={clsx(
              'fixed',
              'inset-0',
              'z-[60]',
              'flex',
              'items-center',
              'justify-center',
              'bg-black/90',
              'p-4',
              'backdrop-blur-sm',
            )}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancel-table-title"
              className={clsx(
                'w-full',
                'max-w-md',
                'space-y-4',
                'rounded-3xl',
                'border',
                'border-rose-900/50',
                'bg-koma-card',
                'p-5',
                'shadow-2xl',
              )}
            >
              <div
                className={clsx(
                  'flex',
                  'items-start',
                  'justify-between',
                  'gap-3',
                  'border-b',
                  'border-koma-border-subtle',
                  'pb-4',
                )}
              >
                <div>
                  <span
                    className={clsx(
                      'font-mono',
                      'text-[9px]',
                      'font-bold',
                      'uppercase',
                      'tracking-[0.18em]',
                      'text-rose-400',
                    )}
                  >
                    Ação irreversível
                  </span>
                  <h3 id="cancel-table-title" className={clsx('mt-1', 'text-lg', 'font-bold', 'text-koma-foreground')}>
                    {cancelConsumptionTarget.scope === 'table'
                      ? `Liberar Mesa ${cancelConsumptionTarget.mesaId} sem receber?`
                      : cancelConsumptionTarget.scope === 'digital'
                        ? 'Cancelar este pedido?'
                        : 'Cancelar somente este pedido?'}
                  </h3>
                  <p className={clsx('mt-1', 'text-[11px]', 'leading-relaxed', 'text-koma-subtle')}>
                    {cancelConsumptionTarget.scope === 'table'
                      ? 'Todos os pedidos da mesa serão cancelados. Esta opção existe apenas no Salão.'
                      : cancelConsumptionTarget.scope === 'digital'
                        ? 'O pedido sairá da operação ativa.'
                        : 'Somente os itens deste pedido serão cancelados; os demais pedidos da mesa serão preservados.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCancelConsumptionTarget(null)}
                  disabled={isCancellingTable}
                  className={clsx(
                    'rounded-lg',
                    'p-2',
                    'text-koma-muted',
                    'hover:bg-white/[0.05]',
                    'hover:text-koma-foreground',
                    'disabled:opacity-40',
                  )}
                  aria-label="Fechar"
                >
                  <X size={16} />
                </button>
              </div>

              <div className={clsx('grid', 'grid-cols-3', 'gap-2')}>
                <div className={clsx('rounded-xl', 'border', 'border-koma-border-subtle', 'bg-black/20', 'p-3')}>
                  <strong className={clsx('block', 'font-mono', 'text-sm', 'text-koma-foreground')}>
                    {cancelConsumptionTarget.comandas}
                  </strong>
                  <span className={clsx('text-[9px]', 'text-koma-muted')}>comandas</span>
                </div>
                <div className={clsx('rounded-xl', 'border', 'border-koma-border-subtle', 'bg-black/20', 'p-3')}>
                  <strong className={clsx('block', 'font-mono', 'text-sm', 'text-koma-foreground')}>
                    {cancelConsumptionTarget.itens}
                  </strong>
                  <span className={clsx('text-[9px]', 'text-koma-muted')}>itens</span>
                </div>
                <div className={clsx('rounded-xl', 'border', 'border-koma-border-subtle', 'bg-black/20', 'p-3')}>
                  <strong className={clsx('block', 'font-mono', 'text-sm', 'text-rose-600 dark:text-rose-300')}>
                    {cancelConsumptionTarget.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </strong>
                  <span className={clsx('text-[9px]', 'text-koma-muted')}>cancelados</span>
                </div>
              </div>

              <label className={clsx('block', 'space-y-1.5')}>
                <span className={clsx('text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'text-koma-subtle')}>
                  Motivo obrigatório
                </span>
                <textarea
                  autoFocus
                  maxLength={300}
                  rows={3}
                  value={cancelTableReason}
                  onChange={(event) => setCancelTableReason(event.target.value)}
                  placeholder="Ex.: pedido lançado por engano"
                  className={clsx(
                    'w-full',
                    'resize-none',
                    'rounded-xl',
                    'border',
                    'border-[#343936]',
                    'bg-koma-panel',
                    'px-3',
                    'py-2.5',
                    'text-sm',
                    'text-koma-foreground',
                    'outline-none',
                    'placeholder:text-zinc-700',
                    'focus:border-rose-500/60',
                  )}
                />
              </label>

              <div className={clsx('flex', 'flex-col-reverse', 'gap-2', 'sm:flex-row')}>
                <button
                  type="button"
                  onClick={() => setCancelConsumptionTarget(null)}
                  disabled={isCancellingTable}
                  className={clsx(
                    'min-h-11',
                    'flex-1',
                    'rounded-xl',
                    'border',
                    'border-[#343936]',
                    'text-xs',
                    'font-bold',
                    'text-koma-subtle',
                    'hover:text-koma-foreground',
                    'disabled:opacity-40',
                  )}
                >
                  {cancelConsumptionTarget.scope === 'digital' ? 'Manter pedido' : 'Manter atendimento'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelTableConsumption}
                  disabled={cancelTableReason.trim().length < 3 || isCancellingTable}
                  className={clsx(
                    'flex',
                    'min-h-11',
                    'flex-1',
                    'items-center',
                    'justify-center',
                    'gap-2',
                    'rounded-xl',
                    'bg-rose-600',
                    'px-3',
                    'text-xs',
                    'font-extrabold',
                    'text-koma-foreground',
                    'hover:bg-rose-500',
                    'disabled:cursor-not-allowed',
                    'disabled:opacity-40',
                  )}
                >
                  {isCancellingTable ? <RefreshCw className="animate-spin" size={14} /> : <Trash2 size={14} />}
                  {isCancellingTable
                    ? 'Cancelando…'
                    : cancelConsumptionTarget.scope === 'table'
                      ? 'Cancelar e liberar'
                      : 'Cancelar pedido'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 7. MODAL: ADICIONAR / EDITAR PRODUTO */}

        {/* MODAL CRIAR/EDITAR CATEGORIA */}

        {/* MODAL DE ENTRADA MANUAL DE ESTOQUE */}

        {/* MODAL DE MOVIMENTAÇÃO DE ESTOQUE (PERDA / AJUSTES) */}

        {/* MODAL DE INVENTÁRIO FÍSICO / CONTAGEM */}

        {/* MODAL DE SANGRIA */}
        {showSangriaModal && (
          <SangriaModal
            saldoDisponivelDinheiro={turnoResumo?.saldo_esperado_dinheiro || 0}
            onClose={() => setShowSangriaModal(false)}
            onSubmit={handleRegistrarSangria}
          />
        )}

        {/* MODAL DE SUPRIMENTO */}
        {showSuprimentoModal && (
          <SuprimentoModal onClose={() => setShowSuprimentoModal(false)} onSubmit={handleRegistrarSuprimento} />
        )}

        {/* OPERATOR MENU DRAWER OVERLAY */}
        {isOperatorDrawerOpen && (
          <div className={clsx('fixed', 'inset-0', 'z-[9998]', 'flex', 'justify-start', 'animate-fade-in')}>
            {/* Backdrop escuro com clique para fechar */}
            <div
              onClick={() => setIsOperatorDrawerOpen(false)}
              className={clsx(
                'fixed',
                'inset-0',
                'bg-black/80',
                'backdrop-blur-sm',
                'transition-opacity',
                'cursor-pointer',
              )}
            />

            {/* Drawer Lateral - Modernized Shadcn Dark Theme */}
            <div
              className={clsx(
                'relative',
                'w-80',
                'max-w-[85vw]',
                'h-full',
                'bg-koma-card',
                'border-r',
                'border-koma-border',
                'shadow-2xl',
                'flex',
                'flex-col',
                'justify-between',
                'z-10',
                'overflow-y-auto',
                'p-5',
                'text-koma-foreground',
                'font-sans',
              )}
            >
              <div className="space-y-5">
                {/* Header do Drawer */}
                <div
                  className={clsx('flex', 'items-center', 'justify-between', 'border-b', 'border-koma-border', 'pb-4')}
                >
                  <div className={clsx('flex', 'items-center', 'gap-2.5')}>
                    <div
                      className={clsx(
                        'p-2',
                        'rounded-xl',
                        'bg-emerald-500/10',
                        'border',
                        'border-emerald-500/30',
                        'text-emerald-400',
                      )}
                    >
                      <SlidersHorizontal size={18} />
                    </div>
                    <div>
                      <h3 className={clsx('font-bold', 'text-base', 'text-koma-foreground', 'font-serif')}>
                        Opções do Caixa
                      </h3>
                      <span className={clsx('text-xs', 'text-koma-subtle', 'block')}>Sessão e Preferências</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsOperatorDrawerOpen(false)}
                    className={clsx(
                      'p-1.5',
                      'text-koma-subtle',
                      'hover:text-koma-foreground',
                      'bg-koma-panel',
                      'hover:bg-koma-raised',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'cursor-pointer',
                      'transition-all',
                    )}
                    title="Fechar Menu"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* 1. SEÇÃO GARÇOM / OPERADOR EM ATENDIMENTO */}
                <div
                  className={clsx(
                    'bg-koma-panel',
                    'border',
                    'border-koma-border',
                    'rounded-2xl',
                    'p-4',
                    'space-y-3.5',
                    'shadow-md',
                  )}
                >
                  <span
                    className={clsx(
                      'text-[9px]',
                      'uppercase',
                      'tracking-wider',
                      'text-koma-subtle',
                      'font-extrabold',
                      'block',
                    )}
                  >
                    Garçom / Operador em Atendimento
                  </span>
                  <div className={clsx('flex', 'items-center', 'gap-3')}>
                    <div
                      className={clsx(
                        'h-12',
                        'w-12',
                        'rounded-2xl',
                        'bg-gradient-to-br',
                        'from-emerald-600',
                        'to-teal-800',
                        'flex',
                        'items-center',
                        'justify-center',
                        'font-bold',
                        'text-koma-foreground',
                        'text-lg',
                        'shadow-md',
                        'shrink-0',
                        'font-serif',
                        'border',
                        'border-emerald-500/30',
                      )}
                    >
                      {(activeWaiterNome || 'G').charAt(0).toUpperCase()}
                    </div>
                    <div className={clsx('min-w-0', 'flex-1')}>
                      <strong className={clsx('font-bold', 'text-base', 'text-koma-foreground', 'block', 'truncate')}>
                        {activeWaiterNome || 'Georlan'}
                      </strong>
                      <span className={clsx('text-xs', 'text-emerald-400', 'font-medium', 'block')}>
                        Operador de Caixa / Gerência
                      </span>
                    </div>
                  </div>

                  <LoginButton
                    variant="default"
                    iconType="logout"
                    onClick={handleLogoutOperator}
                    className={clsx('w-full', 'font-bold', 'uppercase', 'tracking-wider', 'text-xs', 'py-2.5')}
                  >
                    LOGOUT / TROCAR OPERADOR
                  </LoginButton>
                </div>

                {/* 2. SEÇÃO STATUS DO SALÃO AO VIVO */}
                {(() => {
                  const liveOccupiedMesaIds = new Set(
                    orders
                      .filter(
                        (o) => o.mesaId && Number(o.mesaId) > 0 && o.status !== 'fechada' && o.status !== 'cancelado',
                      )
                      .map((o) => Number(o.mesaId)),
                  );
                  const liveTotalTablesCount = salonTables && salonTables.length > 0 ? salonTables.length : 30;
                  const liveOccupiedTablesCount =
                    salonTables && salonTables.length > 0
                      ? salonTables.filter((t) => {
                          const tableNum = Number(t.id || t.numero);
                          return (
                            liveOccupiedMesaIds.has(tableNum) ||
                            t.status === 'ocupada' ||
                            t.status === 'occupied' ||
                            t.status === 'fechamento'
                          );
                        }).length
                      : liveOccupiedMesaIds.size;
                  const liveFreeTablesCount = Math.max(0, liveTotalTablesCount - liveOccupiedTablesCount);

                  return (
                    <div
                      className={clsx(
                        'bg-koma-panel',
                        'border',
                        'border-koma-border',
                        'rounded-2xl',
                        'p-4',
                        'space-y-3',
                        'shadow-md',
                      )}
                    >
                      <div className={clsx('flex', 'items-center', 'justify-between')}>
                        <span
                          className={clsx(
                            'text-[9px]',
                            'uppercase',
                            'tracking-wider',
                            'text-koma-subtle',
                            'font-extrabold',
                            'block',
                          )}
                        >
                          Status do Salão ao Vivo
                        </span>
                        <span
                          className={clsx(
                            'text-[9px]',
                            'font-mono',
                            'text-emerald-400',
                            'bg-emerald-500/10',
                            'border',
                            'border-emerald-500/30',
                            'px-2',
                            'py-0.5',
                            'rounded-full',
                            'font-bold',
                            'uppercase',
                            'flex',
                            'items-center',
                            'gap-1',
                          )}
                        >
                          <span className={clsx('w-1.5', 'h-1.5', 'rounded-full', 'bg-emerald-400', 'animate-ping')} />
                          Tempo Real
                        </span>
                      </div>
                      <div className={clsx('grid', 'grid-cols-3', 'gap-2')}>
                        <div
                          className={clsx(
                            'bg-koma-card',
                            'border',
                            'border-koma-border',
                            'p-2.5',
                            'rounded-xl',
                            'text-center',
                            'shadow-xs',
                          )}
                        >
                          <span className={clsx('text-[9px]', 'text-koma-subtle', 'block', 'font-medium')}>LIVRES</span>
                          <strong className={clsx('text-lg', 'font-bold', 'text-emerald-400', 'font-mono')}>
                            {liveFreeTablesCount}
                          </strong>
                        </div>
                        <div
                          className={clsx(
                            'bg-koma-card',
                            'border',
                            'border-koma-border',
                            'p-2.5',
                            'rounded-xl',
                            'text-center',
                            'shadow-xs',
                          )}
                        >
                          <span className={clsx('text-[9px]', 'text-koma-subtle', 'block', 'font-medium')}>
                            OCUPADAS
                          </span>
                          <strong className={clsx('text-lg', 'font-bold', 'text-amber-400', 'font-mono')}>
                            {liveOccupiedTablesCount}
                          </strong>
                        </div>
                        <div
                          className={clsx(
                            'bg-koma-card',
                            'border',
                            'border-koma-border',
                            'p-2.5',
                            'rounded-xl',
                            'text-center',
                            'shadow-xs',
                          )}
                        >
                          <span className={clsx('text-[9px]', 'text-koma-subtle', 'block', 'font-medium')}>TOTAL</span>
                          <strong className={clsx('text-lg', 'font-bold', 'text-sky-400', 'font-mono')}>
                            {liveTotalTablesCount}
                          </strong>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 3. SEÇÃO ATALHOS DE ATENDIMENTO */}
                <div
                  className={clsx(
                    'bg-koma-panel',
                    'border',
                    'border-koma-border',
                    'rounded-2xl',
                    'p-4',
                    'space-y-2.5',
                    'shadow-md',
                  )}
                >
                  <span
                    className={clsx(
                      'text-[9px]',
                      'uppercase',
                      'tracking-wider',
                      'text-koma-subtle',
                      'font-extrabold',
                      'block',
                    )}
                  >
                    Atalhos de Atendimento
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (onRefreshOrders) onRefreshOrders();
                      showToast('Salão e pedidos sincronizados em tempo real!', 'success');
                    }}
                    className={clsx(
                      'w-full',
                      'py-2.5',
                      'px-3',
                      'bg-koma-card',
                      'hover:bg-koma-raised/50',
                      'border',
                      'border-koma-border',
                      'text-koma-secondary',
                      'hover:text-koma-foreground',
                      'rounded-xl',
                      'text-xs',
                      'font-bold',
                      'transition-all',
                      'cursor-pointer',
                      'flex',
                      'items-center',
                      'justify-between',
                      'group',
                    )}
                  >
                    <div className={clsx('flex', 'items-center', 'gap-2')}>
                      <RefreshCw
                        size={14}
                        className={clsx(
                          'text-emerald-400',
                          'group-hover:rotate-180',
                          'transition-transform',
                          'duration-500',
                        )}
                      />
                      <span>Sincronizar Salão e Pedidos</span>
                    </div>
                    <ChevronRight size={14} className={clsx('text-koma-muted', 'group-hover:text-koma-foreground')} />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      toggleFullscreen();
                      setIsOperatorDrawerOpen(false);
                    }}
                    className={clsx(
                      'w-full',
                      'py-2.5',
                      'px-3',
                      'bg-koma-card',
                      'hover:bg-koma-raised/50',
                      'border',
                      'border-koma-border',
                      'text-koma-secondary',
                      'hover:text-koma-foreground',
                      'rounded-xl',
                      'text-xs',
                      'font-bold',
                      'transition-all',
                      'cursor-pointer',
                      'flex',
                      'items-center',
                      'justify-between',
                      'group',
                    )}
                  >
                    <div className={clsx('flex', 'items-center', 'gap-2')}>
                      {isFullscreen ? (
                        <Minimize2 size={14} className="text-sky-400" />
                      ) : (
                        <Maximize2 size={14} className="text-sky-400" />
                      )}
                      <span>{isFullscreen ? 'Sair do Modo PDV' : 'Modo PDV Imersivo'}</span>
                    </div>
                    <ChevronRight size={14} className={clsx('text-koma-muted', 'group-hover:text-koma-foreground')} />
                  </button>
                </div>

                {/* 4. SEÇÃO EXIBIÇÃO E PREFERÊNCIAS */}
                <div
                  className={clsx(
                    'bg-koma-panel',
                    'border',
                    'border-koma-border',
                    'rounded-2xl',
                    'p-4',
                    'space-y-3',
                    'shadow-md',
                  )}
                >
                  <span
                    className={clsx(
                      'text-[9px]',
                      'uppercase',
                      'tracking-wider',
                      'text-koma-subtle',
                      'font-extrabold',
                      'block',
                    )}
                  >
                    Exibição e Preferências
                  </span>

                  <div className="space-y-1.5">
                    <span className={clsx('text-xs', 'text-koma-secondary', 'font-medium', 'block')}>
                      Tamanho da Fonte:
                    </span>
                    <div
                      className={clsx(
                        'grid',
                        'grid-cols-3',
                        'gap-1',
                        'bg-koma-card',
                        'p-1',
                        'rounded-xl',
                        'border',
                        'border-koma-border',
                      )}
                    >
                      {(['padrao', 'grande', 'gigante'] as const).map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => changeFontSize(sz)}
                          className={`py-1 rounded-lg text-xs font-bold uppercase transition-all cursor-pointer ${
                            fontSize === sz
                              ? 'bg-emerald-500 text-zinc-950 shadow-md font-extrabold'
                              : 'text-koma-subtle hover:text-koma-foreground'
                          }`}
                        >
                          {sz === 'padrao' ? 'Padrão' : sz === 'grande' ? 'Grande' : 'Gigante'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Alertas Sonoros do Caixa */}
                  <div className="pt-2 border-t border-koma-border space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {soundEnabled ? (
                          <Volume2 size={15} className="text-emerald-400" />
                        ) : (
                          <VolumeX size={15} className="text-rose-400" />
                        )}
                        <span className="text-xs text-koma-secondary font-medium">Sons e Alertas do Caixa</span>
                      </div>
                      <button
                        type="button"
                        onClick={toggleSound}
                        className={clsx(
                          'px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border',
                          soundEnabled
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                            : 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20',
                        )}
                      >
                        {soundEnabled ? 'Ativado' : 'Mudo'}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        playOrderAlert('test');
                        showToast('🔊 Teste de som emitido na saída do computador!', 'info');
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-koma-card hover:bg-koma-raised border border-koma-border text-xs font-bold text-koma-foreground rounded-xl transition-all cursor-pointer"
                    >
                      <Bell size={13} className="text-amber-400" />
                      <span>Testar Caixa de Som (Bip)</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* RODAPÉ */}
              <div className={clsx('pt-5', 'border-t', 'border-koma-border', 'text-center', 'space-y-1')}>
                <span className={clsx('text-xs', 'font-bold', 'text-koma-subtle', 'block', 'font-mono')}>
                  Kôma v3.5 • Dark Engine
                </span>
                <span className={clsx('text-[10px]', 'text-koma-muted', 'block')}>
                  Sistema PDV Gourmet Multi-Tenant
                </span>
              </div>
            </div>
          </div>
        )}
      </SidebarProvider>
    </div>
  );
}

export const MemoizedCaixaPanel = React.memo(CaixaPanel);
