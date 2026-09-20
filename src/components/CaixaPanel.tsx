import clsx from 'clsx';
import { Loader2, Lock, Maximize2, Menu, MessageSquare, Minimize2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSubscriptionPlan,
  isAddonIncludedInPlan,
  normalizeSubscriptionPlan,
} from '../config/subscriptionPlans';
import {
  formatCashierOldestAge as formatOldestAge,
  getCashierTableOrderPresentation,
  getCashierOrderSlaData as getOrderSlaData,
  projectCashierDeliveryState,
  projectCashierTableSlices,
} from '../domain/cashierOrderProjection';
import { normalizeOperationalTimestamp } from '../domain/operationalTime';
import { clearOperatorSession } from '../utils/authSession';
import { AssinaturaPixTab } from './assinatura/AssinaturaPixTab';
import { CaixaFechamentoTab } from './caixa/CaixaFechamentoTab';
import { CaixaMovimentacoesTab } from './caixa/CaixaMovimentacoesTab';
import { CaixaTurnoAtualTab } from './caixa/CaixaTurnoAtualTab';
import type { CaixaPanelProps } from './caixa/cashierContracts';
import { formatCompactCurrency } from './caixa/cashierPresentation';
import { useCashierCatalog } from './caixa/catalog/useCashierCatalog';
import { CheckoutDialog } from './caixa/checkout/CheckoutDialog';
import { useCheckoutController } from './caixa/checkout/useCheckoutController';
import { useCashierCustomers } from './caixa/customers/useCashierCustomers';
import { CashierKitchen } from './caixa/kitchen/CashierKitchen';
import { DeferredCashierSection } from './caixa/loading/DeferredCashierSection';
import { CashierConversationsDrawer } from './caixa/chat/CashierConversationsDrawer';
import { useCashierChat } from './caixa/chat/useCashierChat';
import { CashierDesktopSidebar } from './caixa/navigation/CashierDesktopSidebar';
import { CashierMobileSidebar } from './caixa/navigation/CashierMobileSidebar';
import { CashierOperatorDrawer } from './caixa/navigation/CashierOperatorDrawer';
import { getCashierNavigationItem } from './caixa/navigation/cashierNavigation';
import { useCashierNavigation } from './caixa/navigation/useCashierNavigation';
import { useCashierPreferences } from './caixa/navigation/useCashierPreferences';
import { CaixaOrdersWorkspace } from './caixa/orders/CaixaOrdersWorkspace';
import { CashierCancelConsumptionDialog } from './caixa/orders/CashierCancelConsumptionDialog';
import { CashierCouriers } from './caixa/orders/CashierCouriers';
import { CashierPickups } from './caixa/orders/CashierPickups';
import type { CashierTableCard } from './caixa/orders/cashierWorkspaceTypes';
import { KanbanOrderDetails } from './caixa/orders/KanbanOrderDetails';
import { useCashierOrders } from './caixa/orders/useCashierOrders';
import { useCashierPdv } from './caixa/pdv/useCashierPdv';
import { useCashierAlerts } from './caixa/realtime/useCashierAlerts';
import { useCashierClock } from './caixa/realtime/useCashierClock';
import { useCashierRealtime } from './caixa/realtime/useCashierRealtime';
import { CaixaSalonTab } from './caixa/salao/CaixaSalonTab';
import { useCashierSalonProjection } from './caixa/salao/useCashierSalonProjection';
import { SangriaModal } from './caixa/SangriaModal';
import { useCashierSettings } from './caixa/settings/useCashierSettings';
import { CashierOpenShiftDialog } from './caixa/shift/CashierOpenShiftDialog';
import { useCashShift } from './caixa/shift/useCashShift';
import { useCashierSmartPos } from './caixa/smartpos/useCashierSmartPos';
import { SuprimentoModal } from './caixa/SuprimentoModal';
import { OperationalBanner } from './shared/OperationalBanner';
import { SidebarProvider, SidebarTrigger } from './ui/sidebar';
const loadCashierInventory = () => import('./caixa/inventory/CashierInventory');
const loadCashierCatalog = () => import('./caixa/catalog/CashierCatalog');
const loadCashierCustomers = () => import('./caixa/customers/CashierCustomers');
const loadCashierSettings = () => import('./caixa/settings/CashierSettings');
const loadCashierOnlineMenu = () => import('./caixa/online-menu/CashierOnlineMenu');
const loadCashierTeam = () => import('./caixa/team/CashierTeam');
const loadCashierReports = () => import('./caixa/reports/CashierReports');
const loadCashierPdvView = () => import('./caixa/pdv/CashierPdvView');
const operationSubnavItems = getCashierNavigationItem('operacao')?.children ?? [];
const onlineMenuSubnavItems = getCashierNavigationItem('cardapio_digital')?.children ?? [];
const settingsSubnavItems = getCashierNavigationItem('impressao_salao')?.children ?? [];
const reportsSubnavItems = getCashierNavigationItem('relatorios')?.children ?? [];
const teamSubnavItems = getCashierNavigationItem('permissoes_cargos')?.children ?? [];
const subscriptionSubnavItems = getCashierNavigationItem('assinatura_pix')?.children ?? [];

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
  const isTurnoResumoReady = Boolean(turnoResumo) && !isTurnoResumoLoading;
  const cashSalesPerHour =
    turnoResumo?.status === 'aberto' && turnoResumo.tempo_aberto_minutos > 0
      ? turnoResumo.total_vendas / (turnoResumo.tempo_aberto_minutos / 60)
      : 0;
  const cashShiftHealth = !isTurnoResumoReady
    ? 'Sincronizando'
    : turnoResumo?.turno_esquecido
      ? 'Revisar agora'
      : turnoResumo?.status === 'aberto'
        ? 'Regular'
        : 'Sem turno';
  const latestReceiptTime = formatClockTime(
    turnoResumo?.atividades_recentes?.find((activity) => activity.tipo === 'recebimento')?.criado_em,
  );

  const {
    isFullscreen,
    setIsFullscreen,
    toggleFullscreen,
    fontSize,
    setFontSize,
    changeFontSize,
    theme,
    setTheme,
  } = useCashierPreferences();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [toastData, setToastData] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(
    null,
  );
  const [planNoticeBanner, setPlanNoticeBanner] = useState<string | null>(null);

  const {
    isChatDrawerOpen,
    setIsChatDrawerOpen,
    chatUnreadCount,
    chatUnreadStatus,
    chatRealtimeEvent,
    setChatUnreadCount,
  } = useCashierChat(apiBaseUrl, authHeaders.Authorization || "");

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastData({ msg, type });
    setTimeout(() => setToastData(null), 3000);
  };
  const {
    turno,
    turnoLoadState,
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

  const summaryShiftState = isTurnoResumoReady
    ? turnoResumo?.status === 'aberto'
      ? 'open'
      : 'closed'
    : null;
  const cashShiftUiState: 'open' | 'closed' | 'loading' | 'error' =
    turnoLoadState === 'loaded'
      ? turno?.status === 'aberto'
        ? 'open'
        : 'closed'
      : summaryShiftState ?? (turnoLoadState === 'error' ? 'error' : 'loading');

  const {
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
  } = useCashierNavigation({ hasOnlineMenu, showToast });

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
    deliveryOrdersLoadState,
    motoboys,
    motoboysLoadState,
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
    saveItemObservation,
    handleReprintSelectedKanbanProduction,
    handlePrintSelectedKanbanTable,
    handlePrintSelectedKanbanValues,
    handleInspectSalonTable,
    handleTransferSelectedKanbanTable,
    handleAssociateSelectedKanbanTable,
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
  const { soundEnabled, toggleSound, playOrderAlert } = useCashierAlerts({
    orders,
    deliveryOrders,
    isDrawerOpen,
  });

  const { nowTimestamp } = useCashierClock();

  const { tableOrdersInProduction, tableOrdersReady } = useMemo(
    () => projectCashierTableSlices(orders, salonTables, Date.now()),
    [orders, salonTables],
  );

  const catalog = useCashierCatalog({ liveProdutos, liveCategorias, onRefreshCategorias });
  const { apiProdutos, apiCategorias, dynamicMenu, suggestedProductCode, fetchProdutos, fetchCategorias } =
    catalog;
  const customers = useCashierCustomers({ apiBaseUrl, authHeaders });
  const { loyaltyUsers, refreshLoyaltyUsers } = customers;

  const [searchQuery, setSearchQuery] = useState('');

  const {
    tableStatusFilter,
    setTableStatusFilter,
    salonTableCards,
    tableStatusCounts,
    salonInsights,
    pdvTableOptions,
    visibleSalonTableCards,
  } = useCashierSalonProjection({ salonTables, orders, pagamentosPendentes, nowTimestamp });

  const settings = useCashierSettings({
    apiBaseUrl,
    authHeaders,
    showToast,
    setCheckoutServiceTax: (value) => setCheckoutServiceTax(value),
  });
  const { settingsLoadState, taxaServicoAtiva, serviceTaxRate, fetchConfiguracoes } = settings;

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
    settingsLoadState,
    isLoading,
    setErrorMsg,
    getSmartPosCardState,
    setSmartPosRecoveryError,
    fetchTurno,
    handleFecharDelivery,
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

  const handleFinalizeCourierOrder = async (orderId: string): Promise<boolean> => {
    const deliveryOrder = deliveryOrders.find((order) => order.id === orderId);
    if (!deliveryOrder) {
      showToast('Pedido não encontrado para finalizar.', 'error');
      return false;
    }
    await handleFinalizeDigitalOrder(deliveryOrder);
    return true;
  };

  const [autoAccept, setAutoAccept] = useState(false);

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
      if (onRefreshOrders) onRefreshOrders();
    };
    const handleOpenImpressoras = () => {
      setActiveTab('impressao_salao');
      setActiveSubTab('impressao');
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
  }, [onRefreshOrders, fetchProdutos]);

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
  const sidebarOrderCount =
    tableOrdersInProduction.length + activeDeliveryOrdersCount + tableOrdersReady.length;
  const operationalOrderInsights = useMemo(() => {
    const activeDigitalOrders = deliveryOrders.filter(
      (order) => projectCashierDeliveryState(order.status).active,
    );

    const activeTableList = [...tableOrdersInProduction, ...tableOrdersReady];

    const tableValue = activeTableList.reduce((total, order) => {
      const itens = Array.isArray(order.itens) ? order.itens : [];
      return (
        total +
        itens.reduce((itemTotal: number, item: any) => {
          return (
            itemTotal + (!item.pago && String(item.status) !== 'cancelado' ? Number(item.preco) || 0 : 0)
          );
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

  const handleOpenSalonTableOrder = (tableId: number) => {
    setPdvOrderType('dine_in');
    setPdvTargetMesaId(tableId);
    setBalcaoMobileView('produtos');
    setActiveSubTab('balcao');
  };
  useCashierRealtime({
    isWsConnected,
    activeTab,
    fetchTurno,
    fetchDeliveryOrders,
    fetchMotoboys,
    fetchConfiguracoes,
  });

  const selectedCheckoutSmartPosState = selectedOrder ? getSmartPosCardState(selectedOrder) : null;
  const selectedSalonCard = selectedKanbanOrder?.contextoSalao
    ? salonTableCards.find(card => card.table.id === Number(selectedKanbanOrder.mesaId) && !card.isMerged)
    : undefined;

  return (
    <div
      className={`cashier-shell flex w-full bg-koma-page text-koma-foreground font-sans selection:bg-[#10b981]/30 text-xs ${
        fontSize === 'grande' ? 'font-large' : fontSize === 'gigante' ? 'font-huge' : ''
      }`}
    >
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
      <SidebarProvider className="contents">
        <CashierMobileSidebar
          isMobileSidebarOpen={isMobileSidebarOpen}
          setIsMobileSidebarOpen={setIsMobileSidebarOpen}
          setIsOperatorDrawerOpen={setIsOperatorDrawerOpen}
          turno={turno}
          turnoLoadState={turnoLoadState}
          setShowAbrirModal={setShowAbrirModal}
          hasOnlineMenu={hasOnlineMenu}
          isSidebarTabActive={isSidebarTabActive}
          sidebarOrderCount={sidebarOrderCount}
          handleSidebarNavigation={handleSidebarNavigation}
          changeFontSize={changeFontSize}
          fontSize={fontSize}
          setTheme={setTheme}
          theme={theme}
          activeWaiterNome={activeWaiterNome}
        />

        <CashierDesktopSidebar
          setIsOperatorDrawerOpen={setIsOperatorDrawerOpen}
          turno={turno}
          turnoLoadState={turnoLoadState}
          setShowAbrirModal={setShowAbrirModal}
          hasOnlineMenu={hasOnlineMenu}
          isSidebarTabActive={isSidebarTabActive}
          sidebarOrderCount={sidebarOrderCount}
          handleSidebarNavigation={handleSidebarNavigation}
          changeFontSize={changeFontSize}
          fontSize={fontSize}
          setTheme={setTheme}
          theme={theme}
          activeWaiterNome={activeWaiterNome}
        />

        <main className={"cashier-main min-w-0 min-h-0 flex-1 bg-koma-canvas flex flex-col w-full"}>
          <header className={"cashier-topbar h-14 border-b border-koma-border bg-koma-panel px-4 sm:px-6 flex items-center justify-between shrink-0"}>
            <div className={"flex items-center gap-2 truncate"}>
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(true)}
                className={"lg:hidden p-1.5 bg-koma-raised hover:bg-koma-card text-emerald-700 dark:text-emerald-400 rounded-xl border border-koma-border flex items-center justify-center cursor-pointer shrink-0"}
                title="Abrir Menu do Caixa"
                aria-label="Abrir menu principal"
                aria-controls="mobile-caixa-sidebar"
                aria-expanded={isMobileSidebarOpen}
                id="btn-mobile-caixa-sidebar-open"
              >
                <Menu size={16} />
              </button>
              <SidebarTrigger className="hidden lg:flex" title="Recolher ou expandir menu" aria-label="Recolher ou expandir menu" />
              <h2 className={"font-serif font-bold text-xs sm:text-sm tracking-tight text-koma-foreground truncate"}>
                {(activeTab === 'relatorios' || activeTab === 'dashboard') && 'Relatórios'}
                {activeTab === 'operacao' && 'Vendas'}
                {activeTab === 'cardapio' && 'Cardápio'}
                {activeTab === 'estoque' && 'Estoque'}
                {activeTab === 'financeiro' && 'Caixa'}
                {activeTab === 'clientes' && 'Clientes'}
                {(activeTab === 'permissoes_cargos' || (activeTab === 'configuracoes' && activeSubTab === 'equipe')) && 'Equipe'}
                {(activeTab === 'impressao_salao' || (activeTab === 'configuracoes' && activeSubTab === 'impressoras')) && 'Configurações'}
                {(activeTab === 'assinatura_pix' || (activeTab === 'configuracoes' && activeSubTab === 'planos')) && 'Planos de Assinatura e Recebimento Pix'}
                {(activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital') && 'Configurações do cardápio online'}
              </h2>
            </div>

            <div className={"flex items-center gap-2 shrink-0"}>
              <button
                type="button"
                onClick={() => setIsChatDrawerOpen(true)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border relative',
                  chatUnreadCount > 0
                    ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300 hover:bg-emerald-500/25'
                    : 'bg-koma-raised text-koma-secondary border-koma-border hover:bg-koma-card hover:text-koma-foreground',
                )}
                title="Conversas dos Pedidos"
                aria-label={`Abrir conversas dos pedidos${chatUnreadCount > 0 ? `, ${chatUnreadCount} mensagens não lidas` : ""}`}
                id="btn-caixa-conversas-drawer"
              >
                <MessageSquare size={15} />
                <span>Conversas</span>
                {chatUnreadCount > 0 && (
                  <span role="status" aria-live="polite" className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-black text-[10px] font-black leading-tight">
                    {chatUnreadCount}
                  </span>
                )}
              </button>

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
                <span className={"hidden sm:inline"}>{isFullscreen ? 'Sair da Tela Cheia' : 'Modo PDV'}</span>
              </button>
            </div>
          </header>

          <div className="cashier-subnav bg-koma-panel/80 backdrop-blur-md border-b border-koma-border px-6 py-1.5 flex gap-2 shrink-0 overflow-x-auto scrollbar-none">
            {activeTab === 'operacao' && operationSubnavItems.map((sub) => (
              <button key={sub.id} onClick={() => handleSidebarNavigation(sub.id)} className={clsx('cashier-subnav__button', isSidebarTabActive(sub.id) && 'is-active')}>
                {sub.label}
              </button>
            ))}

            {activeTab === 'cardapio_digital' && onlineMenuSubnavItems.map((sub) => (
              <button key={sub.id} onClick={() => handleSidebarNavigation(sub.id)} className={clsx('cashier-subnav__button', isSidebarTabActive(sub.id) && 'is-active')}>
                {sub.label}
              </button>
            ))}

            {activeTab === 'impressao_salao' && settingsSubnavItems.map((sub) => (
              <button key={sub.id} onClick={() => handleSidebarNavigation(sub.id)} className={clsx('cashier-subnav__button', isSidebarTabActive(sub.id) && 'is-active')}>
                {sub.label}
              </button>
            ))}

            {activeTab === 'cardapio' && [
              { id: 'produtos', label: 'Produtos', count: apiProdutos.length },
              { id: 'complementos', label: 'Complementos' },
              { id: 'categorias', label: 'Preparo e impressão', count: apiCategorias.length },
            ].map((sub) => (
              <button key={sub.id} onClick={() => setActiveSubTab(sub.id)} className={clsx('cashier-subnav__button', activeSubTab === sub.id && 'is-active')}>
                {sub.label}
                {sub.count !== undefined && (
                  <span aria-hidden="true" className={clsx('ml-1.5','rounded-full','px-1.5','py-0.5','font-mono','text-[8px]', activeSubTab === sub.id ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-koma-raised text-koma-muted')}>
                    {sub.count}
                  </span>
                )}
              </button>
            ))}

            {activeTab === 'estoque' && [
              { id: 'insumos', label: 'Ingredientes' },
              { id: 'historico', label: 'Histórico' },
              { id: 'inventario', label: 'Inventário' },
              { id: 'fornecedores', label: 'Fornecedores' },
            ].map((sub) => {
              const isSubActive =
                (sub.id === 'historico' && ['historico', 'entradas', 'xml', 'notas_entrada', 'movimentacoes'].includes(activeSubTab)) ||
                (sub.id === 'inventario' && ['inventario', 'contagem'].includes(activeSubTab)) ||
                (sub.id === 'fornecedores' && ['fornecedores', 'distribuidores'].includes(activeSubTab)) ||
                activeSubTab === sub.id;
              return <button key={sub.id} onClick={() => setActiveSubTab(sub.id)} className={clsx('cashier-subnav__button', isSubActive && 'is-active')}>{sub.label}</button>;
            })}

            {activeTab === 'financeiro' && [
              { id: 'turno_atual', label: 'Turno Atual' },
              { id: 'movimentacoes', label: 'Movimentações' },
              { id: 'fechamento', label: 'Fechamento' },
            ].map((sub) => {
              const isSubActive =
                (sub.id === 'turno_atual' && ['turno_atual', 'fluxo'].includes(activeSubTab)) ||
                (sub.id === 'movimentacoes' && ['movimentacoes', 'ajustes', 'ajustes_caixa', 'suprimento', 'sangria'].includes(activeSubTab)) ||
                (sub.id === 'fechamento' && ['fechamento', 'conferencia', 'conferencia_cega'].includes(activeSubTab)) ||
                activeSubTab === sub.id;
              return <button key={sub.id} onClick={() => setActiveSubTab(sub.id)} className={clsx('cashier-subnav__button', isSubActive && 'is-active')}>{sub.label}</button>;
            })}

            {activeTab === 'clientes' && [
              { id: 'clientes', label: 'Clientes' },
              { id: 'fidelidade', label: 'Programa de Fidelidade' },
              { id: 'cupons', label: 'Cupons & Promoções' },
            ].map((sub) => {
              const isSubActive =
                (sub.id === 'clientes' && ['clientes', 'crm', 'banco_clientes'].includes(activeSubTab)) ||
                (sub.id === 'fidelidade' && ['fidelidade', 'programa_fidelidade'].includes(activeSubTab)) ||
                (sub.id === 'cupons' && ['cupons', 'cupom', 'promocoes', 'descontos'].includes(activeSubTab)) || activeSubTab === sub.id;
              return <button key={sub.id} onClick={() => setActiveSubTab(sub.id)} className={clsx('cashier-subnav__button', isSubActive && 'is-active')}>{sub.label}</button>;
            })}

            {(activeTab === 'relatorios' || activeTab === 'dashboard') && reportsSubnavItems.map((sub) => (
              <button
                key={sub.id}
                id={`relatorios-subtab-${sub.target.subTab}`}
                onClick={() => handleSidebarNavigation(sub.id)}
                className={clsx('cashier-subnav__button', isSidebarTabActive(sub.id) && 'is-active')}
              >
                {sub.label}
              </button>
            ))}

            {activeTab === 'permissoes_cargos' && teamSubnavItems.map((sub) => (
              <button
                key={sub.id}
                id={`equipe-subtab-${sub.target.subTab}`}
                onClick={() => handleSidebarNavigation(sub.id)}
                className={clsx('cashier-subnav__button', isSidebarTabActive(sub.id) && 'is-active')}
              >
                {sub.label}
              </button>
            ))}

            {activeTab === 'assinatura_pix' && subscriptionSubnavItems.map((sub) => (
              <button
                key={sub.id}
                id={`assinatura-subtab-${sub.target.subTab}`}
                onClick={() => handleSidebarNavigation(sub.id)}
                className={clsx('cashier-subnav__button', isSidebarTabActive(sub.id) && 'is-active')}
              >
                {sub.label}
              </button>
            ))}
          </div>

          <div className={"cashier-content min-w-0 min-h-0 flex-1 p-5 relative"}>
            {activeTab === 'operacao' && cashShiftUiState !== 'open' && ['pedidos', 'balcao', 'mesas', 'kds'].includes(activeSubTab) && (
              <div className={"absolute inset-0 bg-black/80 backdrop-blur-xs z-30 flex flex-col items-center justify-center text-center p-8 space-y-4"}>
                <div className={clsx('p-4 bg-koma-panel rounded-full border', cashShiftUiState === 'closed' ? 'border-amber-500/20 text-amber-500' : 'border-koma-border text-koma-muted')}>
                  {cashShiftUiState === 'loading' ? <Loader2 size={32} className="animate-spin" /> : <Lock size={32} />}
                </div>
                <h3 className={"font-serif text-base font-bold text-koma-foreground"}>
                  {cashShiftUiState === 'closed'
                    ? 'Turno de Caixa Fechado'
                    : cashShiftUiState === 'error'
                      ? 'Não foi possível confirmar o turno'
                      : 'Sincronizando turno de caixa'}
                </h3>
                <p className={"max-w-md text-[10px] text-koma-subtle leading-relaxed"}>
                  {cashShiftUiState === 'closed'
                    ? 'Você precisa abrir o caixa digitando o fundo de troco inicial da noite para poder acessar as telas de vendas e comandas.'
                    : cashShiftUiState === 'error'
                      ? 'O sistema não vai presumir que o caixa está aberto ou fechado enquanto o estado real estiver indisponível.'
                      : 'Confirmando o turno atual. Nenhum estado operacional é presumido antes da resposta do servidor.'}
                </p>
                {cashShiftUiState === 'closed' && (
                  <button onClick={() => setShowAbrirModal(true)} className={"px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all cursor-pointer text-[10px] uppercase tracking-wider"}>
                    Abrir Caixa Agora
                  </button>
                )}
                {cashShiftUiState === 'error' && (
                  <button onClick={() => void fetchTurno()} className={"px-5 py-2.5 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-foreground font-bold rounded-xl transition-all cursor-pointer text-[10px] uppercase tracking-wider"}>
                    Tentar novamente
                  </button>
                )}
              </div>
            )}

            {activeTab === 'operacao' && activeSubTab === 'pedidos' && (
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

            <DeferredCashierSection active={activeTab === 'operacao' && activeSubTab === 'balcao'} label="Novo pedido" load={loadCashierPdvView} sectionProps={{ activeSubTab, catalogReady, isLoading, pdvTableOptions, pdv }} />

            {activeTab === 'operacao' && activeSubTab === 'mesas' && (
              <CaixaSalonTab
                cards={salonTableCards}
                visibleCards={visibleSalonTableCards}
                counts={tableStatusCounts}
                insights={salonInsights}
                filter={tableStatusFilter}
                onFilterChange={setTableStatusFilter}
                fetchError={fetchError}
                actions={{ inspectTable: handleInspectSalonTable, openTableOrder: handleOpenSalonTableOrder }}
              />
            )}

            <DeferredCashierSection
              active={activeTab === 'relatorios' || activeTab === 'dashboard' || activeSubTab === 'desempenho'}
              label="Relatórios"
              load={loadCashierReports}
              sectionProps={{ apiBaseUrl, authHeaders, activeTab, activeSubTab, setActiveSubTab, showToast, deliveryOrders, activeKitchenItems, apiCategorias }}
            />

            <CashierKitchen activeSubTab={activeTab === 'operacao' ? activeSubTab : ''} activeKitchenItems={activeKitchenItems} handleUpdateItemStatus={handleUpdateItemStatus} />

            <CashierPickups
              activeSubTab={activeTab === 'operacao' ? activeSubTab : ''}
              deliveryOrders={deliveryOrders}
              deliveryOrdersLoadState={deliveryOrdersLoadState}
              apiBaseUrl={apiBaseUrl}
              authHeaders={authHeaders}
              now={nowTimestamp}
              handleAcceptPendingDeliveryOrder={handleAcceptPendingDeliveryOrder}
              handleRejectPendingDeliveryOrder={handleRejectPendingDeliveryOrder}
              handleAdvanceDigitalOrder={handleAdvanceDigitalOrder}
              handleFinalizeDigitalOrder={handleFinalizeDigitalOrder}
              openDeliveryOrderDetails={openDeliveryOrderDetails}
            />

            <DeferredCashierSection active={activeTab === 'permissoes_cargos'} label="Equipe" load={loadCashierTeam} sectionProps={{ apiBaseUrl, authHeaders, activeTab, activeSubTab, setActiveSubTab, showToast }} />

            <DeferredCashierSection
              active={activeTab === 'impressao_salao'}
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

            {activeTab === 'assinatura_pix' && (
              <AssinaturaPixTab
                currentPlanId={currentPlanId}
                hasPrinting={hasPrinting}
                hasOnlineMenu={hasOnlineMenu}
                activeSubTab={activeSubTab}
                setActiveSubTab={setActiveSubTab}
                isTestPlan={restauranteConfig?.plano_modo_teste === true || isRestaurant2Test}
                bannerNotice={planNoticeBanner}
              />
            )}

            <DeferredCashierSection active={activeTab === 'clientes'} label="Clientes" load={loadCashierCustomers} sectionProps={{ apiBaseUrl, authHeaders, activeTab, activeSubTab, setActiveSubTab, showToast, loyaltyUsers, refreshLoyaltyUsers }} />

            <DeferredCashierSection
              active={activeTab === 'cardapio'}
              label="Cardápio"
              load={loadCashierCatalog}
              sectionProps={{ apiBaseUrl, authHeaders, activeTab, activeSubTab, setActiveSubTab, showToast, apiProdutos, apiCategorias, suggestedProductCode, hasOnlineMenu, fetchProdutos, fetchCategorias, catalogReady, restauranteConfig, onRefreshCategorias }}
            />

            <DeferredCashierSection active={activeTab === 'estoque'} label="Estoque" load={loadCashierInventory} sectionProps={{ apiBaseUrl, authHeaders, activeTab, activeSubTab, setActiveSubTab, showToast, apiProdutos, isLoading }} />

            {activeTab === 'financeiro' && (activeSubTab === 'turno_atual' || activeSubTab === 'fluxo') && (
              <div className={"orders-workspace space-y-4"}>
                <OperationalBanner
                  id="cash-heading"
                  eyebrow="CAIXA"
                  title="Turno atual"
                  accent={
                    !isTurnoResumoReady
                      ? 'sincronizando'
                      : turnoResumo?.turno_esquecido
                        ? 'precisa de revisão'
                        : turnoResumo?.status === 'aberto'
                          ? 'em ordem'
                          : 'fechado'
                  }
                  description={
                    !isTurnoResumoReady
                      ? 'Confirmando o turno e os valores atuais antes de exibir um estado operacional.'
                      : turnoResumo?.turno_esquecido
                        ? 'Este turno está aberto há mais de 24 horas. Confira os valores e encerre quando possível.'
                        : 'Veja o dinheiro, os recebimentos e o que precisa de atenção.'
                  }
                  metrics={[
                    {
                      label: 'aberto há',
                      value: isTurnoResumoReady && turnoResumo?.status === 'aberto' ? formatDuration(turnoResumo.tempo_aberto_minutos) : '—',
                    },
                    {
                      label: 'ritmo de vendas',
                      value: isTurnoResumoReady && turnoResumo?.status === 'aberto' ? `${formatCompactCurrency(cashSalesPerHour)}/h` : '—',
                    },
                    {
                      label: 'situação do turno',
                      value: cashShiftHealth,
                      valueClassName: !isTurnoResumoReady
                        ? 'text-koma-muted'
                        : turnoResumo?.turno_esquecido
                          ? 'text-amber-600 dark:text-amber-300'
                          : turnoResumo?.status === 'aberto'
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : 'text-koma-muted',
                    },
                  ]}
                />
                <CaixaTurnoAtualTab
                  turnoResumo={turnoResumo}
                  isLoading={!isTurnoResumoReady || isTurnoResumoLoading}
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
              (activeSubTab === 'movimentacoes' || activeSubTab === 'ajustes' || activeSubTab === 'suprimento' || activeSubTab === 'sangria') && (
                <CaixaMovimentacoesTab movimentacoes={caixaMovimentacoes} turnoResumo={turnoResumo} isLoading={isCaixaMovimentacoesLoading} />
              )}

            {activeTab === 'financeiro' && (activeSubTab === 'fechamento' || activeSubTab === 'conferencia') && (
              <div className={"orders-workspace space-y-4"}>
                <OperationalBanner
                  id="cash-closing-heading"
                  eyebrow="CAIXA"
                  title="Fechamento"
                  accent={!isTurnoResumoReady ? 'sincronizando' : 'do seu jeito'}
                  description={!isTurnoResumoReady ? 'Confirmando o turno antes de habilitar a conferência.' : 'Use a conferência rápida ou faça uma conferência totalmente cega.'}
                  metrics={[
                    {
                      label: 'aberto há',
                      value: isTurnoResumoReady && turnoResumo?.status === 'aberto' ? formatDuration(turnoResumo.tempo_aberto_minutos) : '—',
                    },
                    {
                      label: 'pagamentos pendentes',
                      value: isTurnoResumoReady ? pagamentosPendentes.length : '—',
                      valueClassName: isTurnoResumoReady && pagamentosPendentes.length > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-koma-muted',
                    },
                    { label: 'valor pendente', value: isTurnoResumoReady ? formatCompactCurrency(pendingPaymentsTotal) : '—' },
                  ]}
                />
                {isTurnoResumoReady ? (
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
                ) : (
                  <div className="rounded-2xl border border-koma-border bg-koma-panel p-8 text-center text-koma-muted">
                    <Loader2 size={22} className="mx-auto mb-3 animate-spin" />
                    <p className="text-xs font-bold">Sincronizando turno antes do fechamento...</p>
                  </div>
                )}
              </div>
            )}

            <CashierCouriers
              activeSubTab={activeSubTab}
              deliveryOrders={deliveryOrders}
              deliveryOrdersLoadState={deliveryOrdersLoadState}
              selectedMotoboys={selectedMotoboys}
              setSelectedMotoboys={setSelectedMotoboys}
              motoboys={motoboys}
              motoboysLoadState={motoboysLoadState}
              handleDespacharKanban={handleDespacharKanban}
              handleRevogarAcessoMotoboy={handleRevogarAcessoMotoboy}
              handleFinalizarPedido={handleFinalizeCourierOrder}
              handleAcceptPendingDeliveryOrder={handleAcceptPendingDeliveryOrder}
              handleRejectPendingDeliveryOrder={handleRejectPendingDeliveryOrder}
              handleAdvanceDigitalOrder={handleAdvanceDigitalOrder}
              openDeliveryOrderDetails={openDeliveryOrderDetails}
              apiBaseUrl={apiBaseUrl}
              authHeaders={authHeaders}
              now={nowTimestamp}
              handleAddMotoboy={handleAddMotoboy}
              novoMotoboyNome={novoMotoboyNome}
              novoMotoboyTelefone={novoMotoboyTelefone}
              setNewMotoboyNome={setNewMotoboyNome}
              setNewMotoboyTelefone={setNewMotoboyTelefone}
            />

            <DeferredCashierSection
              active={activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital'}
              label="Cardápio online"
              load={loadCashierOnlineMenu}
              sectionProps={{ apiBaseUrl, authHeaders, activeSubTab, setActiveSubTab, setActiveTab, hasOnlineMenu }}
            />
          </div>
        </main>

        <CashierOpenShiftDialog
          showAbrirModal={showAbrirModal}
          setShowAbrirModal={setShowAbrirModal}
          handleAbrirCaixa={handleAbrirCaixa}
          saldoInicial={saldoInicial}
          setSaldoInicial={setSaldoInicial}
          errorMsg={errorMsg}
        />

        <CheckoutDialog controller={checkout} smartPos={smartPos} errorMsg={errorMsg} taxaServicoAtiva={taxaServicoAtiva} serviceTaxRate={serviceTaxRate} />

        {selectedKanbanOrder && (
          <KanbanOrderDetails
            order={selectedKanbanOrder}
            saveObservation={saveItemObservation}
            tableMovement={selectedKanbanOrder.contextoSalao ? getTableMovementContext(selectedKanbanOrder) : undefined}
            salonActions={selectedSalonCard ? {
              addConsumption: () => {
                handleOpenSalonTableOrder(selectedSalonCard.table.id);
                setSelectedKanbanOrder(null);
              },
              receive: () => {
                handleReceiveSalonTable(selectedSalonCard.tableOrders);
                setSelectedKanbanOrder(null);
              },
              canReceive: selectedSalonCard.tableOrders.length > 0,
            } : undefined}
            transfer={{ targetId: tableTransferTargetId, onTargetChange: setTableTransferTargetId, isTransferring: isTransferringTable, tables: salonTables }}
            actions={{
              close: () => setSelectedKanbanOrder(null),
              advanceDigitalOrder: handleAdvanceSelectedKanbanOrder,
              reprintProduction: handleReprintSelectedKanbanProduction,
              printFullTable: handlePrintSelectedKanbanTable,
              printTableValues: handlePrintSelectedKanbanValues,
              transferTable: handleTransferSelectedKanbanTable,
              associateTable: handleAssociateSelectedKanbanTable,
              cancelConsumption: handleCancelSelectedKanbanConsumption,
              cancelOrder: handleCancelSelectedKanbanOrder,
            }}
          />
        )}

        <CashierCancelConsumptionDialog
          cancelConsumptionTarget={cancelConsumptionTarget}
          setCancelConsumptionTarget={setCancelConsumptionTarget}
          isCancellingTable={isCancellingTable}
          cancelTableReason={cancelTableReason}
          setCancelTableReason={setCancelTableReason}
          handleCancelTableConsumption={handleCancelTableConsumption}
        />

        {showSangriaModal && (
          <SangriaModal
            saldoDisponivelDinheiro={isTurnoResumoReady ? (turnoResumo?.saldo_esperado_dinheiro || 0) : 0}
            onClose={() => setShowSangriaModal(false)}
            onSubmit={handleRegistrarSangria}
          />
        )}

        {showSuprimentoModal && (
          <SuprimentoModal onClose={() => setShowSuprimentoModal(false)} onSubmit={handleRegistrarSuprimento} />
        )}

        <CashierOperatorDrawer
          isOperatorDrawerOpen={isOperatorDrawerOpen}
          setIsOperatorDrawerOpen={setIsOperatorDrawerOpen}
          activeWaiterNome={activeWaiterNome}
          handleLogoutOperator={handleLogoutOperator}
          orders={orders}
          salonTables={salonTables}
          onRefreshOrders={onRefreshOrders}
          showToast={showToast}
          toggleFullscreen={toggleFullscreen}
          isFullscreen={isFullscreen}
          changeFontSize={changeFontSize}
          fontSize={fontSize}
          soundEnabled={soundEnabled}
          toggleSound={toggleSound}
          playOrderAlert={playOrderAlert}
        />

        <CashierConversationsDrawer
          key={authHeaders.Authorization}
          authorization={authHeaders.Authorization || ""}
          isOpen={isChatDrawerOpen}
          realtimeEvent={chatRealtimeEvent}
          realtimeHealth={chatUnreadStatus}
          draftScope={`${Number.isFinite(restId) ? restId : 'tenant'}:${turno?.id ?? 'no-shift'}`}
          onClose={() => setIsChatDrawerOpen(false)}
          onInspectOrder={(pedidoId) => {
            handleSidebarNavigation('vendas_pedidos');
            const target = deliveryOrders.find((o) => o.id === pedidoId);
            if (target) openDeliveryOrderDetails(target);
          }}
          onUnreadCountChange={setChatUnreadCount}
        />
      </SidebarProvider>
    </div>
  );
}

export const MemoizedCaixaPanel = React.memo(CaixaPanel);