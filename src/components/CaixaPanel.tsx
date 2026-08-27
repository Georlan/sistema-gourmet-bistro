import { CardapioAssetUploader } from './CardapioAssetUploader';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { KomaLogo } from './KomaLogo';
import { KomaEmptyState } from './shared/KomaEmptyState';
import { LoginButton } from '../../components/shadcnblocks/login-button';
import {
  DollarSign, ArrowUpRight, Lock, Users,
  Receipt, ShoppingCart, Percent, CreditCard, Check, AlertTriangle,
  Clock, X, RefreshCw, Edit3, Trash2, Plus, ChevronLeft, ChevronRight,
  MapPin, ClipboardList, BarChart2, Package, Shield, ShieldCheck, Star,
  Printer, Info, Smartphone,
  Gift, Tag, TrendingUp, Heart, Globe, Menu, Maximize2, Minimize2,
  SlidersHorizontal, Upload, Copy, Search, Sun, Moon, Volume2, VolumeX, Bell, User } from 'lucide-react';
import { Order, OrderItem, CaixaTurno, CaixaMovimentacao, Pagamento, Table, Product, EntradaEstoque, MovimentacaoEstoque, SessaoContagemEstoque, CaixaTurnoResumo, FechamentoCaixaResult, Distribuidor, FichaTecnicaProduto, Insumo, SystemUser } from '../types';
import { EntradaManualModal } from './estoque/EntradaManualModal';
import MoneyInput from './MoneyInput';
import { EstoqueHistoricoTab } from './estoque/EstoqueHistoricoTab';
import { MovimentacaoEstoqueModal } from './estoque/MovimentacaoEstoqueModal';
import { EstoqueContagemTab } from './estoque/EstoqueContagemTab';
import { ContagemEstoqueModal } from './estoque/ContagemEstoqueModal';
import { EstoqueIngredientesTab } from './estoque/EstoqueIngredientesTab';
import { EstoqueFornecedoresTab } from './estoque/EstoqueFornecedoresTab';
import { FichaTecnicaModal } from './estoque/FichaTecnicaModal';
import { CaixaTurnoAtualTab } from './caixa/CaixaTurnoAtualTab';
import { CaixaMovimentacoesTab } from './caixa/CaixaMovimentacoesTab';
import { SangriaModal } from './caixa/SangriaModal';
import { SuprimentoModal } from './caixa/SuprimentoModal';
import { ManagerPinModal } from './ManagerPinModal';
import { CaixaFechamentoTab } from './caixa/CaixaFechamentoTab';
import { RelatorioFinanceiroTab } from './relatorios/RelatorioFinanceiroTab';
import { RelatoriosVisaoGeralTab } from './relatorios/RelatoriosVisaoGeralTab';
import { RelatoriosProdutosTab } from './relatorios/RelatoriosProdutosTab';
import { EquipeDesempenhoTab } from './equipe/EquipeDesempenhoTab';
import { EquipeCargosTab } from './equipe/EquipeCargosTab';
import { EquipePessoasTab } from './equipe/EquipePessoasTab';
import { normalizeOperationalTimestamp } from '../domain';
import { PrintMonitorPanel } from './printing/PrintMonitorPanel';
import { CardapioCategoriasTab } from './cardapio/CardapioCategoriasTab';
import { CardapioProdutosTab } from './cardapio/CardapioProdutosTab';
import ComplementosTab from './cardapio/ComplementosTab';
import CuponsTab from './clientes/CuponsTab';
import { CategoriaModal } from './cardapio/CategoriaModal';
import { AssinaturaPixTab } from './assinatura/AssinaturaPixTab';
import { OperationalBanner } from './shared/OperationalBanner';
import { normalizeCatalogSnapshot, type CatalogCategory } from '../catalog/catalog';
import { getProductPresets, obterNomeCategoria, smartSearchMatch } from '../domain';
import { formatBackendTime, localCalendarDate } from '../utils/dateTime';
import { clearOperatorSession } from '../utils/authSession';
import { API } from '../config/caixaService';
import { KOMA_THEME_CHANGED_EVENT, nextKomaTheme, persistKomaTheme, readKomaTheme, type KomaTheme } from '../config/theme';
import { makeOperationKey, operationalFetch } from '../utils/operationalRequest';
import {
  ONLINE_MENU_ADDON,
  SUBSCRIPTION_PLANS,
  getSubscriptionPlan,
  normalizeSubscriptionPlan
} from '../config/subscriptionPlans';
import {
  formatWhatsAppPhone,
  openWhatsAppMessage,
  buildPedidoConfirmadoMsg,
  buildStatusUpdateMsg,
  buildPixMsg
} from '../config/whatsappUtils';
import clsx from 'clsx';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarFooter,
  SidebarRail,
  SidebarTrigger
} from '@/components/ui/sidebar';


interface CaixaPanelProps {
  orders: Order[];
  onRefreshOrders: () => Promise<void>;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeWaiterNome: string;
  salonTables: Table[];
  onCreateMesa: (id: number, capacidade: number, nome?: string) => Promise<void>;
  onUpdateMesa: (id: number, capacidade?: number, nome?: string) => Promise<void>;
  onDeleteMesa: (id: number) => Promise<void>;
  pagamentosPendentes?: any[];
  onRefreshPagamentosPendentes?: () => Promise<void>;
  isWsConnected?: boolean;
  turnoResumo: CaixaTurnoResumo | null;
  isTurnoResumoLoading: boolean;
  onRefreshTurnoResumo: () => Promise<void>;
  liveProdutos?: Product[];
  liveCategorias?: CatalogCategory[];
  catalogReady?: boolean;
  onRefreshCategorias?: () => Promise<void>;
  restauranteConfig?: any;
  fetchError?: string | null;
  onOptimisticUpdateItemStatus?: (itemId: string | string[], newStatus: 'preparando' | 'pronto' | 'entregue') => void;
  onOptimisticAddOrder?: (newOrder: any) => void;
  onRemovePendingPaymentOptimistic?: (pagamentoId: string) => void;
}

const CASHIER_SIDEBAR_GROUPS = [
  {
    category: 'Operação',
    items: [
      { id: 'operacao', label: 'Vendas', icon: ShoppingCart },
      { id: 'financeiro', label: 'Caixa', icon: DollarSign }
    ]
  },
  {
    category: 'Cadastros',
    items: [
      { id: 'cardapio', label: 'Cardápio', icon: ClipboardList },
      { id: 'estoque', label: 'Estoque', icon: Package },
      { id: 'clientes', label: 'Clientes', icon: Users }
    ]
  },
  {
    category: 'Gestão',
    items: [
      { id: 'relatorios', label: 'Relatórios', icon: TrendingUp },
      { id: 'permissoes_cargos', label: 'Equipe', icon: ShieldCheck }
    ]
  },
  {
    category: 'Sistema',
    items: [
      { id: 'impressao_salao', label: 'Configurações', icon: SlidersHorizontal }
    ]
  }
] as const;

const CASHIER_SIDEBAR_SECONDARY_ITEMS = [
  { id: 'cardapio_digital', label: 'Cardápio online', icon: Globe },
  { id: 'assinatura_pix', label: 'Assinatura e planos', icon: CreditCard },
] as const;

// Operational view models used by the cashier screens.
interface Courier {
  id: number;
  nome: string;
  telefone: string;
  placa: string;
  status: 'disponivel' | 'em_entrega' | 'indisponivel';
  corridas: number;
}

interface AccountItem {
  id: number;
  descricao: string;
  valor: number;
  vencimento: string;
  status: 'pago' | 'pendente' | 'atrasado';
  tipo: 'pagar' | 'receber';
}

interface DeliveryOrderView {
  id: string;
  cliente: string;
  telefone: string;
  itens: string;
  total: number;
  canal: 'ifood' | 'site' | 'whats' | 'smartpos';
  origemOperacional: 'smartpos' | 'cardapio' | 'caixa' | 'garcom' | 'desconhecida';
  isQuickSale: boolean;
  quantidadeItens: number;
  modalidade: 'delivery' | 'retirada';
  pago: boolean;
  status: 'pendente' | 'analise' | 'producao' | 'pronto' | 'transito';
  endereco?: string;
  criadoEm: string;
  created_at?: string;
  numeroPedido?: number;
}

type KanbanDetailItem = {
  nome: string;
  observacao: string;
  clienteNome: string;
  status: string;
  quantidade: number;
};

function humanOrderNumber(order: any): string {
  const rawId = String(order?.comandaId || order?.id || '');
  if (rawId.startsWith('temp-')) return '…';
  const number = Number(order?.numeroPedido ?? order?.numero_pedido);
  if (Number.isFinite(number) && number > 0) return String(number);
  return String(order?.comandaId || order?.id || '—').slice(-4).toUpperCase();
}

function groupKanbanDetailItems(items: any[]): KanbanDetailItem[] {
  const grouped = new Map<string, KanbanDetailItem>();
  (Array.isArray(items) ? items : []).forEach((item: any) => {
    if (String(item?.status || '').toLowerCase() === 'cancelado') return;
    const nome = String(item?.nome || item?.produto?.nome || 'Item');
    const observacao = String(item?.observacao || '').trim();
    const clienteNome = String(item?.cliente_nome || item?.clienteNome || 'Consumo Geral').trim();
    const status = String(item?.status || 'preparando').toLowerCase();
    const key = [nome, observacao, clienteNome, status].join('\u0000');
    const current = grouped.get(key);
    if (current) {
      current.quantidade += 1;
    } else {
      grouped.set(key, { nome, observacao, clienteNome, status, quantidade: 1 });
    }
  });
  return Array.from(grouped.values());
}

function operationalOriginLabel(origin?: string): string {
  if (origin === 'smartpos') return 'SmartPOS';
  if (origin === 'cardapio') return 'Cardápio online';
  if (origin === 'caixa') return 'Caixa';
  if (origin === 'garcom') return 'Garçom';
  return 'Kôma';
}

function deliveryStatusLabel(status?: string, modalidade?: string): string {
  if (status === 'producao') return 'Em preparo';
  if (status === 'pronto') return modalidade === 'delivery' ? 'Pronto para envio' : 'Pronto para retirada';
  if (status === 'transito') return modalidade === 'delivery' ? 'Em rota' : 'Aguardando retirada';
  if (status === 'pendente' || status === 'analise') return 'Aguardando aceite';
  return 'Em atendimento';
}

interface SmartPosCashPaymentView {
  intent_id: string;
  status: string;
  metodo?: string;
  provider_last_error?: string | null;
  pagamento_id?: string | null;
}

interface SmartPosCashRow {
  mesa_id: number;
  estado_operacional:
    | 'em_preparo'
    | 'pronto'
    | 'aguardando_pagamento'
    | 'pagamento_processando'
    | 'aprovado_pendente_liquidacao';
  origem_smartpos?: boolean;
  pagamento?: SmartPosCashPaymentView | null;
}

interface SmartPosCardState {
  label: string;
  chipClass: 'is-muted' | 'is-primary' | 'is-attention';
  blocksPayment: boolean;
  ctaLabel?: string;
  intentId?: string;
  canReconcile?: boolean;
}

interface LoyaltyCustomer {
  id: string;
  cliente: string;
  nome?: string;
  telefone: string;
  endereco?: string;
  pontos: number;
  saldoCashback: number;
  saldo_pontos?: number;
  saldo_cashback?: number;
  historico?: any[];
}

const aplicarMascaraTelefoneInput = (valor: string) => {
  const apenasNumeros = valor.replace(/\D/g, '').slice(0, 11);
  if (apenasNumeros.length === 0) return '';
  if (apenasNumeros.length <= 2) return `(${apenasNumeros}`;
  if (apenasNumeros.length <= 6) return `(${apenasNumeros.slice(0, 2)}) ${apenasNumeros.slice(2)}`;
  if (apenasNumeros.length <= 10) return `(${apenasNumeros.slice(0, 2)}) ${apenasNumeros.slice(2, 6)}-${apenasNumeros.slice(6)}`;
  return `(${apenasNumeros.slice(0, 2)}) ${apenasNumeros.slice(2, 7)}-${apenasNumeros.slice(7)}`;
};

const formatarTelefoneTabela = (tel?: string) => {
  if (!tel) return '-';
  const limpo = tel.replace(/\D/g, '');
  if (limpo.length === 11) {
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
  } else if (limpo.length === 10) {
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 6)}-${limpo.slice(6)}`;
  }
  return tel; // Retorna o valor original se contiver letras (como os usuários legados 'georlan', 'caixa1')
};

const isTableCheckoutOrder = (order: Order | null | undefined) => {
  if (!order || Number(order.mesaId) <= 0) return false;
  const normalizedType = String(order.tipo || '').toLowerCase();
  return !['delivery', 'entrega', 'retirada'].includes(normalizedType);
};

const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

const formatCompactCurrency = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
}).format(Number(value) || 0);

const formatOldestAge = (values: unknown[]) => {
  const MIN_VALID_EPOCH = 1577836800000; // 2020-01-01T00:00:00Z
  const now = Date.now();
  const timestamps = values
    .map(v => normalizeOperationalTimestamp(v, now))
    .filter((value): value is number => value !== null && value >= MIN_VALID_EPOCH && value <= now + 60_000);
  if (timestamps.length === 0) return '—';
  const elapsedMinutes = Math.max(0, Math.floor((now - Math.min(...timestamps)) / 60_000));
  if (elapsedMinutes < 1) return 'Agora';
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

const formatClockTime = (value: unknown) => {
  const timestamp = normalizeOperationalTimestamp(value);
  if (timestamp === null) return '—';
  return new Date(timestamp).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const splitProductLabel = (label: string) => {
  const match = String(label || '').match(/^(\d{2,4})\s*[-–]\s*(.+)$/);
  return match ? { code: match[1], name: match[2] } : { code: '', name: label };
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
  onRemovePendingPaymentOptimistic
}: CaixaPanelProps) {
  const restId = Number(restauranteConfig?.restaurante_id || restauranteConfig?.id);
  const isRestaurant2Test = restId === 2;
  const currentPlanId = normalizeSubscriptionPlan(
    isRestaurant2Test ? 'premium' : (restauranteConfig?.plano_efetivo ?? restauranteConfig?.plano)
  );
  const currentPlan = getSubscriptionPlan(currentPlanId);
  const hasPrinting = currentPlanId !== 'pocket';
  const hasOnlineMenu = currentPlanId === 'premium' || restauranteConfig?.cardapio_online_addon === true;
  const pendingPaymentsTotal = useMemo(
    () => pagamentosPendentes.reduce((total, payment) => total + (Number(payment?.valor) || 0), 0),
    [pagamentosPendentes],
  );
  const cashSalesPerHour = turnoResumo?.status === 'aberto' && turnoResumo.tempo_aberto_minutos > 0
    ? turnoResumo.total_vendas / (turnoResumo.tempo_aberto_minutos / 60)
    : 0;
  const cashShiftHealth = turnoResumo?.turno_esquecido
    ? 'Revisar agora'
    : turnoResumo?.status === 'aberto'
      ? 'Regular'
      : 'Sem turno';
  const latestReceiptTime = formatClockTime(
    turnoResumo?.atividades_recentes?.find(activity => activity.tipo === 'recebimento')?.criado_em,
  );


  // Fullscreen / Modo PDV state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => typeof document !== 'undefined' && !!document.fullscreenElement);

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

  // Turno & Sync state
  const [turno, setTurno] = useState<CaixaTurno | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const isProcessingPaymentRef = React.useRef(false); // Synchronous guard against double-click
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [toastData, setToastData] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [planNoticeBanner, setPlanNoticeBanner] = useState<string | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastData({ msg, type });
    setTimeout(() => setToastData(null), 3000);
  };
  const [activeTab, setActiveTab] = useState<
    'operacao' | 'cardapio' | 'estoque' | 'financeiro' | 'clientes' | 'relatorios' | 'configuracoes' | 'permissoes_cargos' | 'impressao_salao' | 'assinatura_pix' | 'cardapio_digital' | 'dashboard'
  >(() => {
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
    if (savedTab === 'estoque' && ['xml', 'notas', 'entradas', 'movimentacoes', 'historico'].includes(saved)) return 'historico';
    if (savedTab === 'estoque' && ['contagem', 'inventario'].includes(saved)) return 'inventario';
    // Caixa mappings
    if (['fluxo', 'turno_atual'].includes(saved)) return 'turno_atual';
    if (['ajustes', 'ajustes_caixa', 'movimentacoes', 'suprimento', 'sangria'].includes(saved)) return 'movimentacoes';
    if (['conferencia', 'conferencia_cega', 'fechamento'].includes(saved)) return 'fechamento';
    if (['demonstrativo_dre', 'dre', 'fluxo_caixa', 'financeiro'].includes(saved)) return 'financeiro';
    // Relatórios mappings — 'equipe' is now a valid sub-tab in relatórios
    if (['visao_geral', 'metas', 'vendas', 'indicadores', 'dashboard', 'relatorio_garçons', 'faturamento_garcom'].includes(saved)) return 'visao_geral';
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
    if (['chat_copiloto', 'chat', 'robo_ia', 'prompt', 'prompt_atendente', 'configuracao', 'simulador', 'simulador_chat'].includes(saved)) return 'pedidos';
    // Placeholders redirection
    if (['fiscal', 'notas_fiscais'].includes(saved)) return 'turno_atual';
    if (['recuperador', 'carrinhos_abandonados'].includes(saved)) return 'clientes';
    return saved;
  });

  const [smartPosCashRows, setSmartPosCashRows] = useState<SmartPosCashRow[]>([]);
  const [isReconcilingSmartPos, setIsReconcilingSmartPos] = useState(false);
  const [smartPosRecoveryError, setSmartPosRecoveryError] = useState('');
  const smartPosAuthorization = authHeaders.Authorization || authHeaders.authorization || '';
  const smartPosCashByTable = useMemo(
    () => new Map(smartPosCashRows.map(row => [Number(row.mesa_id), row])),
    [smartPosCashRows],
  );

  const refreshSmartPosCashProjection = useCallback(async () => {
    if (activeSubTab !== 'pedidos' || !smartPosAuthorization) {
      setSmartPosCashRows([]);
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/auth/smartpos/caixa/operacao`, {
        headers: { Authorization: smartPosAuthorization },
        cache: 'no-store',
      });
      if (response.status === 401 || response.status === 403) {
        setSmartPosCashRows([]);
        return;
      }
      if (!response.ok) return;
      const data = await response.json().catch(() => []);
      setSmartPosCashRows(Array.isArray(data) ? data : []);
    } catch {
      // A fila principal continua utilizável; o próximo refresh reconcilia o indicador.
    }
  }, [activeSubTab, apiBaseUrl, smartPosAuthorization]);

  useEffect(() => {
    if (activeSubTab !== 'pedidos' || !smartPosAuthorization) {
      setSmartPosCashRows([]);
      return;
    }

    void refreshSmartPosCashProjection();
    // O WebSocket já reconcilia eventos operacionais. Este fallback mais lento
    // evita milhares de leituras durante um expediente e pausa em aba oculta.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSmartPosCashProjection();
    }, 30_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshSmartPosCashProjection();
    };
    window.addEventListener('focus', refreshWhenVisible);
    window.addEventListener('koma_orders_updated', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      window.removeEventListener('koma_orders_updated', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [activeSubTab, refreshSmartPosCashProjection, smartPosAuthorization]);

  const getSmartPosCardState = useCallback((order: Order): SmartPosCardState | null => {
    const mesaId = Number(order?.mesaId || 0);
    if (mesaId <= 0) return null;
    const row = smartPosCashByTable.get(mesaId);
    if (!row) return null;

    if (row.pagamento?.provider_last_error) {
      return {
        label: 'MAQUININHA · ATENÇÃO',
        chipClass: 'is-attention',
        blocksPayment: true,
        ctaLabel: 'Revisar pagamento',
        intentId: row.pagamento.intent_id,
      };
    }
    if (row.estado_operacional === 'aprovado_pendente_liquidacao') {
      return {
        label: 'MAQUININHA · FINALIZANDO',
        chipClass: 'is-primary',
        blocksPayment: true,
        ctaLabel: 'Revisar pagamento',
        intentId: row.pagamento?.intent_id,
        canReconcile: true,
      };
    }
    if (row.estado_operacional === 'pagamento_processando') {
      return {
        label: 'MAQUININHA · PROCESSANDO',
        chipClass: 'is-primary',
        blocksPayment: true,
        ctaLabel: 'Acompanhar pagamento',
        intentId: row.pagamento?.intent_id,
      };
    }
    if (row.origem_smartpos) {
      return {
        label: 'MAQUININHA',
        chipClass: 'is-muted',
        blocksPayment: false,
      };
    }
    return null;
  }, [smartPosCashByTable]);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [mobileOrdersStage, setMobileOrdersStage] = useState<'salon' | 'digital' | 'closing'>('salon');
  const [balcaoMobileView, setBalcaoMobileView] = useState<'produtos' | 'carrinho'>('produtos');
  const [pdvProductDetailId, setPdvProductDetailId] = useState<string | null>(null);

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

  const [selectedKanbanOrder, setSelectedKanbanOrder] = useState<any>(null);
  const [cancelConsumptionTarget, setCancelConsumptionTarget] = useState<{
    scope: 'order' | 'table' | 'digital';
    mesaId: number;
    orderId?: string;
    comandas: number;
    itens: number;
    total: number;
    itemIds: string[];
  } | null>(null);
  const [cancelTableReason, setCancelTableReason] = useState('');
  const [isCancellingTable, setIsCancellingTable] = useState(false);
  const [tableTransferTargetId, setTableTransferTargetId] = useState('');
  const [isTransferringTable, setIsTransferringTable] = useState(false);

  const openCancelTableConfirmation = (mesaId: number) => {
    const tableOrders = orders.filter(order => Number(order.mesaId) === Number(mesaId));
    const activeItems = tableOrders.flatMap(order => order.itens || [])
      .filter(item => (item.status as string) !== 'cancelado');
    setCancelConsumptionTarget({
      scope: 'table',
      mesaId,
      comandas: tableOrders.length,
      itens: activeItems.length,
      total: activeItems.reduce((sum, item) => sum + (Number(item.preco) || 0), 0),
      itemIds: activeItems.map(item => String(item.id)).filter(Boolean),
    });
    setCancelTableReason('');
    setSelectedKanbanOrder(null);
  };

  const openCancelOrderConfirmation = (order: any) => {
    const activeItems = (order?.itens || []).filter(
      (item: any) => String(item?.status || '').toLowerCase() !== 'cancelado' && item?.id,
    );
    const normalizedType = String(order?.modalidade || order?.tipo || '').toLowerCase();
    const isDigitalOrder = Number(order?.mesaId || 0) <= 0
      || ['delivery', 'entrega', 'retirada'].includes(normalizedType);
    const comandaIds = new Set(
      activeItems.map((item: any) => String(item.comandaId || order.comandaId || order.id)).filter(Boolean),
    );
    setCancelConsumptionTarget({
      scope: isDigitalOrder ? 'digital' : 'order',
      mesaId: Number(order.mesaId || 0),
      orderId: isDigitalOrder ? String(order.id || order.comandaId || '') : undefined,
      comandas: isDigitalOrder ? 1 : comandaIds.size,
      itens: activeItems.length || Number(order.quantidadeItens || 0),
      total: Number(order.total) || activeItems.reduce((sum: number, item: any) => sum + (Number(item.preco) || 0), 0),
      itemIds: activeItems.map((item: any) => String(item.id)),
    });
    setCancelTableReason('');
    setSelectedKanbanOrder(null);
  };

  const handleCancelTableConsumption = async () => {
    if (!cancelConsumptionTarget || cancelTableReason.trim().length < 3 || isCancellingTable) return;
    setIsCancellingTable(true);
    try {
      const isOrderScope = cancelConsumptionTarget.scope === 'order';
      const isDigitalScope = cancelConsumptionTarget.scope === 'digital';
      const response = isDigitalScope
        ? await fetch(
            `${apiBaseUrl}/comandas/${encodeURIComponent(cancelConsumptionTarget.orderId || '')}/delivery/status?status_novo=recusado`,
            { method: 'PUT', headers: authHeaders },
          )
        : await fetch(`${apiBaseUrl}/mesas/${cancelConsumptionTarget.mesaId}/${isOrderScope ? 'cancelar-itens' : 'cancelar-consumo'}`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              motivo: cancelTableReason.trim(),
              ...(isOrderScope ? { item_ids: cancelConsumptionTarget.itemIds } : {}),
            }),
          });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail || 'Não foi possível cancelar o pedido.');

      const cancelledOrderId = cancelConsumptionTarget.orderId;
      setCancelConsumptionTarget(null);
      setCancelTableReason('');
      if (isDigitalScope) {
        setDeliveryOrders(current => current.filter(order => String(order.id) !== String(cancelledOrderId)));
        window.dispatchEvent(new Event('koma_orders_updated'));
        showToast('Pedido cancelado e removido da operação ativa.', 'success');
      } else {
        await onRefreshOrders();
        showToast(
          isOrderScope
            ? `${data.itens_cancelados} item(ns) deste pedido cancelado(s).${data.mesa_liberada ? ` Mesa ${data.mesa_id} liberada.` : ' Os demais pedidos da mesa foram preservados.'}`
            : `Mesa ${data.mesa_id} liberada. ${data.itens_cancelados} item(ns) cancelado(s), sem lançamento no caixa.`,
          'success',
        );
      }
    } catch (error: any) {
      showToast(error?.message || 'Não foi possível cancelar o pedido.', 'error');
    } finally {
      setIsCancellingTable(false);
    }
  };

  const handleTransferTableFromSalon = async (order: any) => {
    const sourceMesaId = Number(order?.mesaId || 0);
    const targetMesaId = Number(tableTransferTargetId || 0);
    const primaryComandaId = String(order?.comandaId || order?.id || '');
    if (!sourceMesaId || !targetMesaId || !primaryComandaId || isTransferringTable) return;
    setIsTransferringTable(true);
    try {
      const response = await fetch(`${apiBaseUrl}/comandas/${primaryComandaId}/transferir/${targetMesaId}`, {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail || 'Não foi possível transferir a mesa.');
      setSelectedKanbanOrder(null);
      setTableTransferTargetId('');
      await onRefreshOrders();
      showToast(`Mesa ${sourceMesaId} transferida para a Mesa ${targetMesaId}.`, 'success');
    } catch (error: any) {
      showToast(error?.message || 'Não foi possível transferir a mesa.', 'error');
    } finally {
      setIsTransferringTable(false);
    }
  };

  const buildTableCheckoutOrder = (tableComandas: Order[]): Order | null => {
    if (tableComandas.length === 0) return null;

    const primaryComanda = tableComandas[0];
    const combinedItems = tableComandas.flatMap(comanda => {
      const arr = Array.isArray(comanda?.itens) ? comanda.itens : Array.isArray(comanda?.items) ? comanda.items : [];
      return arr.map((item: any) => ({
        id: item.id,
        produtoId: item.produto_id || item.produtoId,
        nome: item.nome || `Item ${item.produto_id || item.produtoId}`,
        preco: item.preco_unit || item.preco,
        observacao: item.observacao || '',
        clienteNome: item.cliente_nome || item.clienteNome || 'Consumo Geral',
        status: item.status,
        pago: item.pago,
        comandaId: comanda.id
      }));
    });

    return {
      ...primaryComanda,
      valorPago: tableComandas.reduce(
        (sum, comanda) => sum + Number(comanda.valorPago || 0),
        0
      ),
      itens: combinedItems,
      comandaIds: tableComandas.map(comanda => comanda.id)
    } as Order;
  };

  const getTableMovementContext = (order: Order | any) => {
    const mesaId = Number(order?.mesaId || 0);
    if (mesaId <= 0) {
      return { mergedMesaIds: [] as number[], transferredFromMesaIds: [] as number[] };
    }

    const relatedOrders = (orders || []).filter(candidate => {
      const normalizedType = String(candidate.tipo || '').toLowerCase();
      return Number(candidate.mesaId) === mesaId
        && !(candidate as any).fechada
        && !['delivery', 'entrega', 'retirada'].includes(normalizedType);
    });
    const movementSources = relatedOrders.length > 0 ? relatedOrders : [order];
    const mergedMesaIds = Array.from(new Set(
      movementSources
        .map(candidate => Number(candidate.mesaOrigemId || 0))
        .filter(originId => originId > 0 && originId !== mesaId)
    )).sort((a, b) => a - b);
    const transferredFromMesaIds = Array.from(new Set(
      movementSources
        .map(candidate => Number(candidate.mesaTransferidaDe || 0))
        .filter(originId => originId > 0 && originId !== mesaId)
    )).sort((a, b) => a - b);

    return { mergedMesaIds, transferredFromMesaIds };
  };


  // Configurações do cardápio online Whitelabel
  const [cardapioStatusOverride, setCardapioStatusOverride] = useState<string>('Automático');
  const [cardapioCorPrimaria, setCardapioCorPrimaria] = useState<string>('#00b894');
  const [cardapioCorFundo, setCardapioCorFundo] = useState<string>('#090a0f');
  const [cardapioLogoUrl, setCardapioLogoUrl] = useState<string>('');
  const [cardapioBannerUrl, setCardapioBannerUrl] = useState<string>('');
  const [cardapioSobreNos, setCardapioSobreNos] = useState<string>('');
  const [cardapioEndereco, setCardapioEndereco] = useState<string>('');
  const [isSavingCardapioConfig, setIsSavingCardapioConfig] = useState<boolean>(false);

  // ============================================================================
  // ⚡ FILTRAGEM DINÂMICA DAS COMANDAS DE MESA PARA O KANBAN
  // ============================================================================

  // Col 1 — somente pedidos vinculados a uma mesa física, lançados pelo garçom ou caixa.
  const tableOrdersInProduction = useMemo(() => {
    const list: any[] = [];
    (orders || []).forEach(comanda => {
      const normalizedType = String(comanda.tipo || '').toLowerCase();
      const isTableOrder = Number(comanda.mesaId) > 0
        && !['delivery', 'entrega', 'retirada'].includes(normalizedType);
      if (!isTableOrder) return;
      if ((comanda as any).statusComanda === 'aguardando_pagamento') return;
      const itemsByLancamento: Record<string, OrderItem[]> = {};
      const itensArr = Array.isArray(comanda?.itens) ? comanda.itens : Array.isArray(comanda?.items) ? comanda.items : [];
      itensArr.forEach(item => {
        const lid = item.lancamentoId || comanda.id;
        if (!itemsByLancamento[lid]) itemsByLancamento[lid] = [];
        itemsByLancamento[lid].push(item);
      });
      Object.entries(itemsByLancamento).forEach(([lid, items]) => {
        const preparingItems = items.filter(i => i.status === 'preparando');
        if (preparingItems.length > 0) {
          const mesaEntity = (salonTables || []).find(t => t.id === comanda.mesaId);
          const rawTableTimestamp =
            (comanda as any).aberta_em ||
            (comanda as any).data_abertura ||
            (comanda as any).aberto_em ||
            (mesaEntity as any)?.aberta_em ||
            (mesaEntity as any)?.data_abertura ||
            (mesaEntity as any)?.created_at ||
            comanda.created_at ||
            comanda.timestamp ||
            (comanda as any).criadoEm;

          list.push({
            id: lid,
            comandaId: comanda.id,
            numeroPedido: comanda.numeroPedido,
            origemOperacional: comanda.origemOperacional,
            mesaId: comanda.mesaId,
            mesaOrigemId: comanda.mesaOrigemId,
            mesaTransferidaDe: comanda.mesaTransferidaDe,
            identificador: (comanda as any).identificador ?? null,
            garcomNome: comanda.garcomNome,
            tipo: comanda.tipo,
            aberta_em: rawTableTimestamp,
            data_abertura: (comanda as any).data_abertura || rawTableTimestamp,
            aberto_em: (comanda as any).aberto_em || rawTableTimestamp,
            created_at: comanda.created_at || (comanda as any).criadoEm || rawTableTimestamp,
            timestamp: normalizeOperationalTimestamp(comanda.timestamp || rawTableTimestamp) ?? Date.now(),
            criadoEm: (comanda as any).criadoEm || comanda.created_at,
            mesa: mesaEntity,
            itens: preparingItems
          });
        }
      });
    });
    return list;
  }, [orders, salonTables]);

  // Col 3 — Fechar conta: mesas com status 'aguardando_pagamento' (conta pedida) ou itens prontos individualmente
  // Unifica comandas da mesma mesa em um único card de pagamento.
  const tableOrdersReady = useMemo(() => {
    const list: any[] = [];
    const groupedByMesa: Record<number, Array<{ comanda: any; itens: any[]; contaPedida: boolean }>> = {};

    (orders || []).forEach(comanda => {
      const normalizedType = String(comanda.tipo || '').toLowerCase();
      const isTableOrder = Number(comanda.mesaId) > 0
        && !['delivery', 'entrega', 'retirada'].includes(normalizedType);
      if (!isTableOrder) return;

      const itensArr = Array.isArray(comanda?.itens) ? comanda.itens : Array.isArray(comanda?.items) ? comanda.items : [];
      const unpaid = itensArr.filter(i => (i.status as string) !== 'cancelado' && !i.pago);
      const readyItems = itensArr.filter(item => item.status === 'pronto' && !item.pago);
      const contaPedida = (comanda as any).statusComanda === 'aguardando_pagamento';

      if (contaPedida && unpaid.length > 0) {
        if (!groupedByMesa[comanda.mesaId]) {
          groupedByMesa[comanda.mesaId] = [];
        }
        groupedByMesa[comanda.mesaId].push({ comanda, itens: unpaid, contaPedida: true });
      } else if (readyItems.length > 0) {
        if (!groupedByMesa[comanda.mesaId]) {
          groupedByMesa[comanda.mesaId] = [];
        }
        groupedByMesa[comanda.mesaId].push({ comanda, itens: readyItems, contaPedida: false });
      }
    });

    Object.entries(groupedByMesa).forEach(([mesaIdStr, entries]) => {
      const mesaId = Number(mesaIdStr);
      const allItems: any[] = [];
      entries.forEach(e => {
        (e.itens || []).forEach((it: any) => {
          allItems.push({
            ...it,
            comandaId: e.comanda.id
          });
        });
      });

      const hasContaPedida = entries.some(e => e.contaPedida);
      const relatedTableOrders = (orders || []).filter(o => Number(o.mesaId) === mesaId && !(o as any).fechada);
      const itensEmPreparoCount = relatedTableOrders.reduce((count, relatedOrder) => {
        const arr = Array.isArray(relatedOrder?.itens)
          ? relatedOrder.itens
          : Array.isArray(relatedOrder?.items)
            ? relatedOrder.items
            : [];
        return count + arr.filter(item => item.status === 'preparando' && !item.pago).length;
      }, 0);

      const firstComanda = entries[0].comanda;
      const mesaEntity = (salonTables || []).find(t => t.id === mesaId);

      let oldestComandaTime: any = null;
      entries.forEach(e => {
        const cTime =
          (e.comanda as any).aberta_em ||
          (e.comanda as any).data_abertura ||
          (e.comanda as any).aberto_em ||
          e.comanda.created_at ||
          e.comanda.timestamp ||
          (e.comanda as any).criadoEm;
        if (!oldestComandaTime) {
          oldestComandaTime = cTime;
        } else if (cTime) {
          const t1 = normalizeOperationalTimestamp(cTime) ?? Number.NaN;
          const t2 = normalizeOperationalTimestamp(oldestComandaTime) ?? Number.NaN;
          if (!isNaN(t1) && (isNaN(t2) || t1 < t2)) {
            oldestComandaTime = cTime;
          }
        }
      });

      if (!oldestComandaTime && mesaEntity) {
        oldestComandaTime = (mesaEntity as any).aberta_em || (mesaEntity as any).data_abertura || (mesaEntity as any).created_at;
      }

      list.push({
        id: firstComanda.id, // ID real da comanda principal para rotear requisições
        comandaId: firstComanda.id,
        numeroPedido: firstComanda.numeroPedido,
        numeroPedidos: Array.from(new Set(
          entries
            .map(entry => Number(entry.comanda.numeroPedido))
            .filter(number => Number.isFinite(number) && number > 0)
        )),
        origemOperacional: firstComanda.origemOperacional,
        mesaId: mesaId,
        mesaOrigemId: firstComanda.mesaOrigemId,
        mesaTransferidaDe: firstComanda.mesaTransferidaDe,
        identificador: firstComanda.identificador ?? null,
        garcomNome: firstComanda.garcomNome,
        tipo: firstComanda.tipo,
        aberta_em: oldestComandaTime || (firstComanda as any).aberta_em,
        data_abertura: (firstComanda as any).data_abertura || oldestComandaTime,
        aberto_em: (firstComanda as any).aberto_em || oldestComandaTime,
        created_at: firstComanda.created_at || (firstComanda as any).criadoEm || oldestComandaTime,
        timestamp: normalizeOperationalTimestamp(firstComanda.timestamp || oldestComandaTime) ?? Date.now(),
        criadoEm: (firstComanda as any).criadoEm || firstComanda.created_at,
        mesa: mesaEntity,
        valorPago: entries.reduce((sum, e) => sum + (e.comanda.valorPago || 0), 0),
        itens: allItems,
        contaPedida: hasContaPedida,
        temItensEmPreparo: itensEmPreparoCount > 0,
        itensEmPreparoCount,
        comandaIds: entries.map(e => e.comanda.id)
      });
    });

    return list;
  }, [orders, salonTables]);

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

  const [loyaltyUsers, setLoyaltyUsers] = useState<LoyaltyCustomer[]>([]);
  const [clientesSearch, setClientesSearch] = useState('');
  const filteredLoyaltyUsers = useMemo(() => {
    const term = clientesSearch.trim().toLocaleLowerCase('pt-BR');
    if (!term) return loyaltyUsers;
    return loyaltyUsers.filter(user => `${user.cliente} ${user.telefone}`.toLocaleLowerCase('pt-BR').includes(term));
  }, [clientesSearch, loyaltyUsers]);

  const handleSaveFidelidadeConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiBaseUrl}/fidelidade/config`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(fidelidadeConfig)
      });
      if (res.ok) {
        showToast('Configurações do Programa de Fidelidade salvas com sucesso!');
      } else {
        showToast('Falha ao salvar as configurações.', 'error');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Config Salão sub-tab
  const [printingSettingsTab, setPrintingSettingsTab] = useState<
    'impressao' | 'mesas' | 'garcom' | 'taxa'
  >('impressao');
  const [configSalSubTab, setConfigSalSubTab] = useState<'pedido' | 'fechamento' | 'atendimento'>('pedido');

  // System waiters (users CRUD) list loaded from API
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
  const systemUsersRequestRef = useRef<Promise<void> | null>(null);

  // Modals state
  const [showAbrirModal, setShowAbrirModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);

  const identifiedCustomer = useMemo(() => {
    if (!selectedOrder) return null;

    // 1. Direct phone on selectedOrder
    const directPhone = (
      selectedOrder.clientePhone
      || (selectedOrder as any).delivery_telefone
      || (selectedOrder as any).telefone
      || (selectedOrder as any).cliente?.telefone
      || ''
    ).trim();

    // 2. Direct client ID
    const directClientId = selectedOrder.clienteId || (selectedOrder as any).cliente_id;
    if (directClientId) {
      const user = loyaltyUsers.find(u => String(u.id) === String(directClientId));
      if (user) {
        return {
          id: user.id,
          nome: user.cliente || user.nome || selectedOrder.identificador || 'Cliente',
          telefone: user.telefone || directPhone || '',
          saldoCashback: Number(user.saldoCashback ?? user.saldo_cashback ?? 0),
          pontos: Number(user.pontos ?? user.saldo_pontos ?? 0),
        };
      }
    }

    if (directPhone) {
      const cleanPhone = directPhone.replace(/\D/g, '');
      const user = loyaltyUsers.find(u => (u.telefone || '').replace(/\D/g, '') === cleanPhone);
      if (user) {
        return {
          id: user.id,
          nome: user.cliente || user.nome || selectedOrder.identificador || 'Cliente',
          telefone: user.telefone,
          saldoCashback: Number(user.saldoCashback ?? user.saldo_cashback ?? 0),
          pontos: Number(user.pontos ?? user.saldo_pontos ?? 0),
        };
      }
      return {
        id: null,
        nome: selectedOrder.identificador || 'Cliente',
        telefone: directPhone,
        saldoCashback: 0,
        pontos: 0,
      };
    }

    // 3. Match by item.clienteNome or selectedOrder.identificador in loyaltyUsers
    const nameToMatch = (selectedOrder.identificador || '').trim().toLowerCase();
    if (nameToMatch && nameToMatch !== 'consumo geral') {
      const user = loyaltyUsers.find(u =>
        (u.cliente || '').trim().toLowerCase() === nameToMatch
        || (u.nome || '').trim().toLowerCase() === nameToMatch
      );
      if (user && user.telefone) {
        return {
          id: user.id,
          nome: user.cliente || user.nome,
          telefone: user.telefone,
          saldoCashback: Number(user.saldoCashback ?? user.saldo_cashback ?? 0),
          pontos: Number(user.pontos ?? user.saldo_pontos ?? 0),
        };
      }
    }

    // 4. Check items for client name that matches a registered customer with phone
    for (const item of (selectedOrder.itens || [])) {
      const itName = (item.clienteNome || '').trim().toLowerCase();
      if (itName && itName !== 'consumo geral') {
        const user = loyaltyUsers.find(u =>
          (u.cliente || '').trim().toLowerCase() === itName
          || (u.nome || '').trim().toLowerCase() === itName
        );
        if (user && user.telefone) {
          return {
            id: user.id,
            nome: user.cliente || user.nome,
            telefone: user.telefone,
            saldoCashback: Number(user.saldoCashback ?? user.saldo_cashback ?? 0),
            pontos: Number(user.pontos ?? user.saldo_pontos ?? 0),
          };
        }
      }
    }

    return null;
  }, [selectedOrder, loyaltyUsers]);

  // Otimizações / Estoque / Desempenho States
  const [waitersPerformance, setWaitersPerformance] = useState<{ nome_garcon: string, pedidos_atendidos: number, comissao_acumulada: number }[]>([]);
  const [generalStats, setGeneralStats] = useState<any>(null);
  const [estoqueInsumos, setEstoqueInsumos] = useState<Insumo[]>([]);
  const [notasEntrada, setNotasEntrada] = useState<{ id: string, numero_nota: string, chave_acesso: string, data_emissao: string, valor_total: number, distribuidor: { nome_fantasia: string, cnpj: string } | null }[]>([]);
  const [distribuidores, setDistribuidores] = useState<Distribuidor[]>([]);
  const [entradasEstoque, setEntradasEstoque] = useState<EntradaEstoque[]>([]);
  const [movimentacoesEstoque, setMovimentacoesEstoque] = useState<MovimentacaoEstoque[]>([]);
  const [sessoesContagemEstoque, setSessoesContagemEstoque] = useState<SessaoContagemEstoque[]>([]);
  const [fichasTecnicas, setFichasTecnicas] = useState<FichaTecnicaProduto[]>([]);
  const [showFichaTecnicaModal, setShowFichaTecnicaModal] = useState(false);
  const estoqueInsights = useMemo(() => {
    const low = estoqueInsumos.filter(item => Number(item.estoque_atual || 0) <= Number(item.estoque_minimo || 0)).length;
    const negative = estoqueInsumos.filter(item => Number(item.estoque_atual || 0) < 0).length;
    const activeProducts = fichasTecnicas.filter(item => item.produto_ativo).length;
    const linkedProducts = fichasTecnicas.filter(item => item.produto_ativo && item.itens.length > 0).length;
    const inventoryValue = estoqueInsumos.reduce((sum, item) => sum + Math.max(0, Number(item.estoque_atual || 0)) * Number(item.preco_medio_custo || 0), 0);
    const drafts = sessoesContagemEstoque.filter(item => item.status === 'rascunho').length;
    return { low, negative, activeProducts, linkedProducts, inventoryValue, drafts };
  }, [estoqueInsumos, fichasTecnicas, sessoesContagemEstoque]);
  const [showEntradaManualModal, setShowEntradaManualModal] = useState<boolean>(false);
  const [showMovimentacaoModal, setShowMovimentacaoModal] = useState<boolean>(false);
  const [showContagemModal, setShowContagemModal] = useState<boolean>(false);
  const [selectedContagemId, setSelectedContagemId] = useState<string | null>(null);

  // Caixa Reorganization States
  const [caixaMovimentacoes, setCaixaMovimentacoes] = useState<CaixaMovimentacao[]>([]);
  const [isCaixaMovimentacoesLoading, setIsCaixaMovimentacoesLoading] = useState(false);
  const caixaMovimentacoesRequestRef = useRef(0);
  const [fechamentoResult, setFechamentoResult] = useState<FechamentoCaixaResult | null>(null);
  const [showSangriaModal, setShowSangriaModal] = useState<boolean>(false);
  const [showSuprimentoModal, setShowSuprimentoModal] = useState<boolean>(false);
  const [xmlUploadState, setXmlUploadState] = useState<{ loading: boolean, result: any | null, error: string | null, isDragging: boolean }>({ loading: false, result: null, error: null, isDragging: false });
  const xmlFileInputRef = useRef<HTMLInputElement>(null);
  const [horariosPico, setHorariosPico] = useState<{ dia_semana_label: string, dia_semana: number, hora: string, total_pedidos: number }[]>([]);
  const [fidelidadeConfig, setFidelidadeConfig] = useState({
    ativo: true,
    tipo_recompensa: 'PONTOS', // PONTOS | CASHBACK
    taxa_conversao: 1.0,
    valor_ponto_em_dinheiro: 0.05
  });

  const [searchQuery, setSearchQuery] = useState('');

  const getPeriodString = () => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - parseInt(desempenhoRange));
    const format = (d: Date) => d.toLocaleDateString('pt-BR');
    return `${format(startDate)} - ${format(endDate)}`;
  };

  const handleExportReports = () => {
    if (!generalStats) return;
    const period = getPeriodString();
    
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += `Relatório Consolidado de Vendas - Koma\n`;
    csvContent += `Período:;${period}\n\n`;
    
    csvContent += `MÉTRICAS GERAIS\n`;
    csvContent += `Indicador;Valor\n`;
    csvContent += `Vendas Líquidas;R$ ${generalStats.faturamento.toFixed(2)}\n`;
    csvContent += `Líquido de Hoje;R$ ${generalStats.faturamento_hoje.toFixed(2)}\n`;
    csvContent += `Ticket Médio;R$ ${generalStats.ticket_medio.toFixed(2)}\n`;
    csvContent += `Total de Pedidos;${generalStats.total_pedidos}\n`;
    csvContent += `Clientes Ativos;${generalStats.clientes_ativos}\n`;
    csvContent += `Qualidade do Cardápio;${generalStats.qualidade_cardapio}%\n\n`;
    
    csvContent += `PEDIDOS POR MODALIDADE\n`;
    csvContent += `Modalidade;Pedidos\n`;
    csvContent += `Entrega (Delivery);${generalStats.pedidos_modalidade?.delivery ?? 0}\n`;
    csvContent += `Consumo no Local (Mesa);${generalStats.pedidos_modalidade?.local ?? 0}\n`;
    csvContent += `Retirada (Balcão);${generalStats.pedidos_modalidade?.balcao ?? 0}\n\n`;
    
    csvContent += `TOP 5 ITENS MAIS PEDIDOS\n`;
    csvContent += `Rank;Item;Saídas;Preço Unitário\n`;
    (generalStats.top_itens ?? []).forEach((item: any) => {
      csvContent += `${item.rank};${item.name};${item.count};R$ ${item.price.toFixed(2)}\n`;
    });
    csvContent += "\n";
    
    csvContent += `DESEMPENHO DOS GARÇONS\n`;
    csvContent += `Garçom;Pedidos Atendidos;Comissão Acumulada (10%)\n`;
    waitersPerformance.forEach((w: any) => {
      csvContent += `${w.nome_garcon};${w.pedidos_atendidos};R$ ${w.comissao_acumulada.toFixed(2)}\n`;
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_consolidado_${desempenhoRange}_dias.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Table management states
  const [showAddMesaModal, setShowAddMesaModal] = useState(false);
  const [newMesaId, setNewMesaId] = useState('');
  const [newMesaCap, setNewMesaCap] = useState('4');
  const [newMesaNome, setNewMesaNome] = useState('');
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  const [editTableCap, setEditTableCap] = useState('');
  const [editTableNome, setEditTableNome] = useState('');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [tableStatusFilter, setTableStatusFilter] = useState<'all' | 'free' | 'occupied' | 'payment'>('all');
  const [tableMutation, setTableMutation] = useState<'create' | 'update' | 'delete' | null>(null);
  const [tableFormError, setTableFormError] = useState('');

  const salonTableCards = useMemo(() => (salonTables || []).map((table) => {
    const mergedIntoMesaId = orders.find(order => order.mesaOrigemId === table.id)?.mesaId || null;
    const isMerged = mergedIntoMesaId !== null;
    const displayMesaId = isMerged ? mergedIntoMesaId : table.id;
    const tableOrders = orders.filter(order => {
      const normalizedOrderStatus = String(order.status || '').trim().toLowerCase();
      return order.mesaId === displayMesaId
        && !['fechada', 'fechado', 'cancelada', 'cancelado', 'finalizada', 'finalizado'].includes(normalizedOrderStatus);
    });
    const normalizedTableStatus = String(table.status || '').trim().toLowerCase();
    const hasOperationalStatus = [
      'ocupada',
      'ocupado',
      'pronta',
      'pronto',
      'aguardando_pagamento',
      'para_receber',
    ].includes(normalizedTableStatus);
    const isOccupied = tableOrders.length > 0 || hasOperationalStatus;
    const hasPendingPayment = ['aguardando_pagamento', 'para_receber'].includes(normalizedTableStatus)
      || tableOrders.some(order => order.statusComanda === 'aguardando_pagamento')
      || pagamentosPendentes.some(payment => (
        tableOrders.some(order => order.id === payment.comanda_id)
      ));
    const total = tableOrders.reduce((sum, order) => (
      sum + (order.itens || []).reduce((itemsTotal, item) => itemsTotal + Number(item.preco || 0), 0)
    ), 0);

    return {
      table,
      displayMesaId,
      tableOrders,
      isMerged,
      isOccupied,
      hasPendingPayment,
      total,
    };
  }), [orders, pagamentosPendentes, salonTables]);

  const tableStatusCounts = useMemo(() => ({
    all: salonTableCards.length,
    free: salonTableCards.filter(card => !card.isOccupied && !card.isMerged).length,
    occupied: salonTableCards.filter(card => card.isOccupied && !card.hasPendingPayment).length,
    payment: salonTableCards.filter(card => card.hasPendingPayment).length,
  }), [salonTableCards]);

  const salonInsights = useMemo(() => {
    const activeCards = salonTableCards.filter(card => card.isOccupied && !card.isMerged);
    const openValue = activeCards.reduce((total, card) => total + card.total, 0);
    const timestamps = activeCards.flatMap(card => card.tableOrders.map(order => (
      (order as any).aberta_em
      || (order as any).data_abertura
      || (order as any).aberto_em
      || order.created_at
      || order.timestamp
      || (order as any).criadoEm
    )));
    return {
      occupancy: salonTableCards.length > 0
        ? Math.round((activeCards.length / salonTableCards.length) * 100)
        : 0,
      openValue,
      oldestService: formatOldestAge(timestamps),
    };
  }, [salonTableCards]);

  const pdvTableOptions = useMemo(() => salonTableCards
    .map((card) => {
      const normalizedStatus = String(card.table.status || '').trim().toLowerCase();
      const isOccupied = card.isOccupied
        || card.hasPendingPayment
        || ['ocupada', 'ocupado', 'pronta', 'pronto', 'aguardando_pagamento'].includes(normalizedStatus);

      return {
        ...card,
        isOccupied,
        label: card.table.nome?.trim() || `Mesa ${card.table.id}`,
      };
    })
    .sort((left, right) => left.table.id - right.table.id), [salonTableCards]);

  const pdvOccupiedTableCount = pdvTableOptions.filter(option => option.isOccupied).length;

  const visibleSalonTableCards = useMemo(() => salonTableCards.filter((card) => {
    if (tableStatusFilter === 'free') return !card.isOccupied && !card.isMerged;
    if (tableStatusFilter === 'occupied') return card.isOccupied && !card.hasPendingPayment;
    if (tableStatusFilter === 'payment') return card.hasPendingPayment;
    return true;
  }), [salonTableCards, tableStatusFilter]);

  const editingTableRuntime = editingTable
    ? salonTableCards.find(card => card.table.id === editingTable.id)
    : undefined;

  // Product & Category management states
  const [apiCategorias, setApiCategorias] = useState<any[]>([]);
  const [showProductModal, setShowProductModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [cardapioCategoryFocus, setCardapioCategoryFocus] = useState<string | null>(null);
  const [editingCrmUser, setEditingCrmUser] = useState<any>(null);
  const [crmFormNome, setCrmFormNome] = useState('');
  const [crmFormTelefone, setCrmFormTelefone] = useState('');
  const [crmFormPontos, setCrmFormPontos] = useState<number>(0);
  const [crmFormCashback, setCrmFormCashback] = useState<number>(0);
  const [showNewCrmModal, setShowNewCrmModal] = useState(false);
  const [newCrmNome, setNewCrmNome] = useState('');
  const [newCrmTelefone, setNewCrmTelefone] = useState('');
  const [newCrmSaldo, setNewCrmSaldo] = useState<number | ''>(0);
  
  // Form states for Product Modal
  const [prodFormId, setProdFormId] = useState('');
  const [prodFormNome, setProdFormNome] = useState('');
  const [prodFormPreco, setProdFormPreco] = useState<number | ''>('');
  const [prodFormCategoriaId, setProdFormCategoriaId] = useState('');
  const [prodFormDescricao, setProdFormDescricao] = useState('');
  const [prodFormImagem, setProdFormImagem] = useState('');
  const [prodFormImagem2, setProdFormImagem2] = useState('');
  const [prodFormImagem3, setProdFormImagem3] = useState('');
  const [prodFormAtivo, setProdFormAtivo] = useState(true);

  // Insumos manual management states
  const [showNewInsumoModal, setShowNewInsumoModal] = useState(false);
  const [showEditInsumoModal, setShowEditInsumoModal] = useState(false);
  const [showAjusteInsumoModal, setShowAjusteInsumoModal] = useState(false);
  const [selectedInsumo, setSelectedInsumo] = useState<any>(null);
  const [insumoFormNome, setInsumoFormNome] = useState('');
  const [insumoFormMinimo, setInsumoFormMinimo] = useState<number>(10);
  const [insumoFormMaximo, setInsumoFormMaximo] = useState<number>(50);
  const [insumoFormUnidade, setInsumoFormUnidade] = useState('un');
  const [insumoFormCusto, setInsumoFormCusto] = useState<number>(0);
  const [ajusteQtd, setAjusteQtd] = useState<number>(0);
  const [ajusteTipo, setAjusteTipo] = useState<'ENTRADA' | 'SAIDA'>('ENTRADA');
  const [ajusteJustificativa, setAjusteJustificativa] = useState('');

  // Distribuidores manual management states
  const [showNewDistModal, setShowNewDistModal] = useState(false);
  const [showEditDistModal, setShowEditDistModal] = useState(false);
  const [selectedDist, setSelectedDist] = useState<any>(null);
  const [distFormNomeFantasia, setDistFormNomeFantasia] = useState('');
  const [distFormRazaoSocial, setDistFormRazaoSocial] = useState('');
  const [distFormCnpj, setDistFormCnpj] = useState('');
  const [distFormLeadTime, setDistFormLeadTime] = useState<number>(3);

  // Form states
  const [saldoInicial, setSaldoInicial] = useState<number | ''>(100);

  // Counted values for closing cashier

  // Checkout payment states
  const [checkoutServiceTax, setCheckoutServiceTax] = useState(true);
  const [taxaServicoAtiva, setTaxaServicoAtiva] = useState(true);
  const [serviceTaxRate, setServiceTaxRate] = useState(10); // Customizable service rate percentage
  const [unificarViasDelivery, setUnificarViasDelivery] = useState(false);
  const [splitPeople, setSplitPeople] = useState('1');
  const [paymentMetodo, setPaymentMetodo] = useState<'dinheiro' | 'pix' | 'cartao' | 'cartao_debito' | 'cartao_credito'>('pix');
  const [paymentValor, setPaymentValor] = useState<number | ''>('');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  const updateConfiguracoes = async (updates: {
    taxa_servico_ativa?: boolean;
    taxa_servico_padrao?: number;
    unificar_vias_delivery?: boolean;
    impressao_nome_restaurante?: string;
    impressao_nome_posicao?: 'cabecalho' | 'rodape' | 'oculto';
    impressao_mensagem_rodape?: string;
    perm_garcom_delivery?: boolean;
    perm_garcom_editar?: boolean;
    perm_garcom_taxas?: boolean;
    perm_garcom_cancelar?: boolean;
    perm_garcom_status?: boolean;
    perm_garcom_abrir_vazia?: boolean;
    perm_garcom_print?: boolean;
    perm_garcom_fechar?: boolean;
    perm_garcom_desconto?: boolean;
    perm_garcom_acrescimo?: boolean;
    perm_garcom_pessoas?: boolean;
    perm_garcom_transferir_mesa?: boolean;
    perm_garcom_transferir_item?: boolean;
    perm_garcom_chamar?: boolean;
    perm_garcom_ociosas?: boolean;
  }) => {
    const isPrintPersonalizationUpdate = [
      'impressao_nome_restaurante',
      'impressao_nome_posicao',
      'impressao_mensagem_rodape',
      'unificar_vias_delivery'
    ].some(key => key in updates);
    if (isPrintPersonalizationUpdate) setPrintSettingsSaveState('saving');
    // 1. Atualização Otimista Instantânea (0ms) de todos os toggles
    if (updates.taxa_servico_ativa !== undefined) {
      setCheckoutServiceTax(updates.taxa_servico_ativa);
      setTaxaServicoAtiva(updates.taxa_servico_ativa);
    }
    if (updates.taxa_servico_padrao !== undefined) setServiceTaxRate(updates.taxa_servico_padrao);
    if (updates.unificar_vias_delivery !== undefined) setUnificarViasDelivery(updates.unificar_vias_delivery);
    if (updates.impressao_nome_restaurante !== undefined) setPrintHeader(updates.impressao_nome_restaurante);
    if (updates.impressao_nome_posicao !== undefined) setPrintNamePosition(updates.impressao_nome_posicao);
    if (updates.impressao_mensagem_rodape !== undefined) setPrintFooter(updates.impressao_mensagem_rodape);
    if (updates.perm_garcom_delivery !== undefined) setPermDelivery(updates.perm_garcom_delivery);
    if (updates.perm_garcom_editar !== undefined) setPermEdit(updates.perm_garcom_editar);
    if (updates.perm_garcom_taxas !== undefined) setPermAddCharges(updates.perm_garcom_taxas);
    if (updates.perm_garcom_cancelar !== undefined) setPermCancel(updates.perm_garcom_cancelar);
    if (updates.perm_garcom_status !== undefined) setPermShowStatus(updates.perm_garcom_status);
    if (updates.perm_garcom_abrir_vazia !== undefined) setPermOpenEmpty(updates.perm_garcom_abrir_vazia);
    if (updates.perm_garcom_print !== undefined) setPermAutoPrint(updates.perm_garcom_print);
    if (updates.perm_garcom_fechar !== undefined) setPermCloseAccount(updates.perm_garcom_fechar);
    if (updates.perm_garcom_desconto !== undefined) setPermDiscount(updates.perm_garcom_desconto);
    if (updates.perm_garcom_acrescimo !== undefined) setPermSurcharge(updates.perm_garcom_acrescimo);
    if (updates.perm_garcom_pessoas !== undefined) setPermPeopleCount(updates.perm_garcom_pessoas);
    if (updates.perm_garcom_transferir_mesa !== undefined) setPermTransferTables(updates.perm_garcom_transferir_mesa);
    if (updates.perm_garcom_transferir_item !== undefined) setPermTransferItems(updates.perm_garcom_transferir_item);
    if (updates.perm_garcom_chamar !== undefined) setPermClientCall(updates.perm_garcom_chamar);
    if (updates.perm_garcom_ociosas !== undefined) setPermShowIdleTables(updates.perm_garcom_ociosas);

    try {
      const res = await fetch(`${apiBaseUrl}/caixa/configuracoes`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        await fetchConfiguracoes();
        showToast(
          payload?.detail || 'Não foi possível salvar esta configuração.',
          'error'
        );
        if (isPrintPersonalizationUpdate) setPrintSettingsSaveState('error');
        return false;
      }
      if (isPrintPersonalizationUpdate) setPrintSettingsSaveState('saved');
      return true;
    } catch (e) {
      console.error('Error saving configurations:', e);
      await fetchConfiguracoes();
      showToast('Falha de conexão ao salvar a configuração.', 'error');
      if (isPrintPersonalizationUpdate) setPrintSettingsSaveState('error');
      return false;
    }
  };

  // Toggle automatics
  const [autoAccept, setAutoAccept] = useState(false);

  // Search terms
  const [pdvSearch, setPdvSearch] = useState('');
  const [pdvSelectedCategory, setPdvSelectedCategory] = useState<string>('todos');
  const pdvCategoryScrollRef = useRef<HTMLDivElement>(null);
  const pdvCategoryDragRef = useRef({
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  });
  const pdvCategorySuppressClickRef = useRef(false);
  const [pdvCategoryScrollState, setPdvCategoryScrollState] = useState({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updatePdvCategoryScrollState = useCallback(() => {
    const element = pdvCategoryScrollRef.current;
    if (!element) return;
    const maxScrollLeft = Math.max(element.scrollWidth - element.clientWidth, 0);
    setPdvCategoryScrollState({
      hasOverflow: maxScrollLeft > 2,
      canScrollLeft: element.scrollLeft > 2,
      canScrollRight: element.scrollLeft < maxScrollLeft - 2,
    });
  }, []);

  const scrollPdvCategories = useCallback((direction: -1 | 1) => {
    const element = pdvCategoryScrollRef.current;
    if (!element) return;
    element.scrollBy({
      left: direction * Math.max(element.clientWidth * 0.72, 240),
      behavior: 'smooth',
    });
  }, []);

  const handlePdvCategoryWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const element = pdvCategoryScrollRef.current;
    if (!element || element.scrollWidth <= element.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    const maxScrollLeft = element.scrollWidth - element.clientWidth;
    const canMove = delta < 0
      ? element.scrollLeft > 0
      : element.scrollLeft < maxScrollLeft;
    if (!canMove) return;
    event.preventDefault();
    element.scrollLeft += delta;
  }, []);

  const handlePdvCategoryPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const element = pdvCategoryScrollRef.current;
    if (!element || element.scrollWidth <= element.clientWidth) return;
    pdvCategoryDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: element.scrollLeft,
      moved: false,
    };
    element.setPointerCapture(event.pointerId);
  }, []);

  const handlePdvCategoryPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = pdvCategoryScrollRef.current;
    const drag = pdvCategoryDragRef.current;
    if (!element || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 4) drag.moved = true;
    if (!drag.moved) return;
    element.scrollLeft = drag.startScrollLeft - distance;
  }, []);

  const finishPdvCategoryDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = pdvCategoryScrollRef.current;
    const drag = pdvCategoryDragRef.current;
    if (!element || drag.pointerId !== event.pointerId) return;
    pdvCategorySuppressClickRef.current = drag.moved;
    if (drag.moved) {
      window.setTimeout(() => {
        pdvCategorySuppressClickRef.current = false;
      }, 0);
    }
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    pdvCategoryDragRef.current.pointerId = -1;
  }, []);

  // PDV Local Cart state
  const [pdvCart, setPdvCart] = useState<{ product: Product; quantity: number; obs: string; client: string }[]>([]);
  const [pdvCustomerName, setPdvCustomerName] = useState('');
  const [pdvCustomerPhone, setPdvCustomerPhone] = useState('');
  const [pdvCustomerId, setPdvCustomerId] = useState<string | null>(null);
  const [pdvCustomerLookup, setPdvCustomerLookup] = useState<'idle' | 'loading' | 'found' | 'new'>('idle');
  const [pdvCustomerCPF, setPdvCustomerCPF] = useState('');
  const [paymentCPF, setPaymentCPF] = useState('');
  const [pdvOrderType, setPdvOrderType] = useState<'retirada' | 'entrega' | 'mesa'>('retirada');
  const [pdvDeliveryAddress, setPdvDeliveryAddress] = useState('');
  const [pdvDeliveryTaxa, setPdvDeliveryTaxa] = useState<number>(0);
  const [pdvTargetMesaId, setPdvTargetMesaId] = useState<number>(0);
  const selectedPdvTableOption = pdvTableOptions.find(option => option.table.id === pdvTargetMesaId);
  const pdvCartItemCount = pdvCart.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    if (pdvOrderType === 'mesa') {
      setPdvCustomerId(null);
      setPdvCustomerLookup('idle');
      return;
    }
    const normalizedPhone = pdvCustomerPhone.replace(/\D/g, '');
    if (normalizedPhone.length < 10 || normalizedPhone.length > 11) {
      setPdvCustomerId(null);
      setPdvCustomerLookup('idle');
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPdvCustomerLookup('loading');
      try {
        const response = await fetch(
          `${apiBaseUrl}/fidelidade/clientes/lookup?telefone=${encodeURIComponent(normalizedPhone)}`,
          { headers: authHeaders, signal: controller.signal },
        );
        if (response.status === 404) {
          setPdvCustomerId(null);
          setPdvCustomerLookup('new');
          return;
        }
        if (!response.ok) {
          setPdvCustomerLookup('idle');
          return;
        }
        const customer = await response.json();
        setPdvCustomerId(String(customer.id));
        setPdvCustomerName(String(customer.cliente || customer.nome || ''));
        if (pdvOrderType === 'entrega' && customer.endereco) {
          setPdvDeliveryAddress(String(customer.endereco));
        }
        setPdvCustomerLookup('found');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setPdvCustomerLookup('idle');
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [pdvCustomerPhone, pdvOrderType, apiBaseUrl]);

  // Generate idempotency key when checkout order changes
  useEffect(() => {
    if (selectedOrder) {
      setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    } else {
      setIdempotencyKey('');
    }
  }, [selectedOrder]);

  // Auto-initialize paymentValor when checkout modal opens. Mesas priorizam itens prontos;
  // sem itens prontos, o operador precisa optar conscientemente por um adiantamento.
  useEffect(() => {
    if (showCheckoutModal && selectedOrder) {
      if (!paymentValor || Number(paymentValor || 0) <= 0) {
        const readyItemIds = selectedOrder.itens
          .filter(item => !item.pago && isItemReadyForCheckout(item))
          .map(item => item.id);
        const balance = isTableCheckoutOrder(selectedOrder)
          ? (readyItemIds.length > 0 ? getSelectedItemsTotal(selectedOrder, readyItemIds) : 0)
          : getCheckoutBalance(selectedOrder);
        if (balance > 0) {
          setPaymentValor(balance);
        }
      }
    } else if (!showCheckoutModal) {
      setPaymentValor('');
    }
  }, [showCheckoutModal, selectedOrder]);

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
  const [desempenhoRange, setDesempenhoRange] = useState<'7' | '15' | '30'>('7');

  // Waiter App Settings toggles (persisted via /caixa/configuracoes API)
  const [permDelivery, setPermDelivery] = useState(true);
  const [permEdit, setPermEdit] = useState(true);
  const [permAddCharges, setPermAddCharges] = useState(false);
  const [permCancel, setPermCancel] = useState(false);
  const [permShowStatus, setPermShowStatus] = useState(true);
  const [permOpenEmpty, setPermOpenEmpty] = useState(false);
  const [permAutoPrint, setPermAutoPrint] = useState(true);
  const [permPrintClose, setPermPrintClose] = useState(false);
  const [permCloseAccount, setPermCloseAccount] = useState(false);
  const [permDiscount, setPermDiscount] = useState(false);
  const [permSurcharge, setPermSurcharge] = useState(false);
  const [permPeopleCount, setPermPeopleCount] = useState(true);
  const [permTransferTables, setPermTransferTables] = useState(true);
  const [permTransferItems, setPermTransferItems] = useState(true);
  const [permClientCall, setPermClientCall] = useState(false);
  const [permShowIdleTables, setPermShowIdleTables] = useState(true);

  // Printer Messages State
  const [printHeader, setPrintHeader] = useState("Kôma Gourmet Bistrô");
  const [printFooter, setPrintFooter] = useState("");
  const [printNamePosition, setPrintNamePosition] = useState<'cabecalho' | 'rodape' | 'oculto'>('cabecalho');
  const [printSettingsSaveState, setPrintSettingsSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [isTestingPrinter, setIsTestingPrinter] = useState(false);

  const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrderView[]>([]);
  const [motoboys, setMotoboys] = useState<any[]>([]);
  const [selectedMotoboys, setSelectedMotoboys] = useState<{ [orderId: string]: string }>({});
  const [novoMotoboyNome, setNewMotoboyNome] = useState('');
  const [novoMotoboyTelefone, setNewMotoboyTelefone] = useState('');

  // ── Gaveta de Aceite (Floating Drawer) & Sistema de Áudio Unificado do Caixa ────
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem('@koma:sound_enabled') !== 'false';
  });

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('@koma:sound_enabled', String(next));
    if (next) {
      playOrderAlert('test');
    }
  };

  // Motor de Síntese Sonora Web Audio API — Independente, sem arquivo de áudio externo
  const playOrderAlert = useCallback((type: 'new_order' | 'bill_requested' | 'delivery_pending' | 'test' = 'new_order') => {
    if (type !== 'test' && (!soundEnabled || !audioUnlockedRef.current)) return;
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        // Fora de uma interação do usuário o navegador bloqueia resume().
        // O desbloqueio é feito pelo listener abaixo; não poluímos o console
        // nem criamos alertas parciais enquanto o áudio ainda está suspenso.
        if (type !== 'test') return;
        void ctx.resume().then(() => { audioUnlockedRef.current = true; }).catch(() => undefined);
      } else if (ctx.state === 'running') {
        audioUnlockedRef.current = true;
      }
      const t = ctx.currentTime;

      if (type === 'new_order') {
        // Um único bipe curto confirma um novo pedido. Outros eventos mantêm
        // assinaturas sonoras próprias, evitando a sensação de evento duplicado.
        const notes = [
          { freq: 783.99, start: 0, dur: 0.18, vol: 0.34 },
        ];
        notes.forEach(({ freq, start, dur, vol }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, t + start);
          gain.gain.setValueAtTime(0.001, t + start);
          gain.gain.exponentialRampToValueAtTime(vol, t + start + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t + start);
          osc.stop(t + start + dur + 0.05);
        });
      } else if (type === 'bill_requested') {
        // Alerta de mesa pedindo conta / pré-conta (Ding-Dong: C6 -> G5)
        const notes = [
          { freq: 1046.50, start: 0, dur: 0.14, vol: 0.35 },
          { freq: 783.99, start: 0.14, dur: 0.28, vol: 0.40 },
        ];
        notes.forEach(({ freq, start, dur, vol }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t + start);
          gain.gain.setValueAtTime(0.001, t + start);
          gain.gain.exponentialRampToValueAtTime(vol, t + start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t + start);
          osc.stop(t + start + dur + 0.05);
        });
      } else if (type === 'delivery_pending') {
        // Alerta de pedido online / WhatsApp / Retirada: 880 -> 1174 -> 880
        const notes = [
          { freq: 880.00, start: 0, dur: 0.10, vol: 0.30 },
          { freq: 1174.66, start: 0.12, dur: 0.14, vol: 0.38 },
          { freq: 880.00, start: 0.28, dur: 0.18, vol: 0.30 },
        ];
        notes.forEach(({ freq, start, dur, vol }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t + start);
          gain.gain.setValueAtTime(0.001, t + start);
          gain.gain.exponentialRampToValueAtTime(vol, t + start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t + start);
          osc.stop(t + start + dur + 0.05);
        });
      } else if (type === 'test') {
        // Teste de som: 3 notas ascendentes (C5 -> E5 -> G5)
        const notes = [
          { freq: 523.25, start: 0, dur: 0.10, vol: 0.25 },
          { freq: 659.25, start: 0.10, dur: 0.10, vol: 0.30 },
          { freq: 783.99, start: 0.20, dur: 0.22, vol: 0.35 },
        ];
        notes.forEach(({ freq, start, dur, vol }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t + start);
          gain.gain.setValueAtTime(0.001, t + start);
          gain.gain.exponentialRampToValueAtTime(vol, t + start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t + start);
          osc.stop(t + start + dur + 0.05);
        });
      }
    } catch (e) { /* audio context unavailable */ }
  }, [soundEnabled]);

  // Desbloqueia o contexto de áudio somente dentro de uma interação real.
  useEffect(() => {
    const unlock = () => {
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'running') {
          audioUnlockedRef.current = true;
          return;
        }
        void ctx.resume()
          .then(() => { audioUnlockedRef.current = ctx.state === 'running'; })
          .catch(() => { audioUnlockedRef.current = false; });
      } catch {
        audioUnlockedRef.current = false;
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Monitor universal de pedidos e mesas (Garçom / Caixa / Salão)
  const isInitialOrdersMountRef = useRef(true);
  const prevOrdersSignatureRef = useRef({
    itemsCount: 0,
    billRequestedCount: 0
  });

  useEffect(() => {
    const active = orders.filter(o =>
      !String(o.id || '').startsWith('temp-')
      && o.status !== 'fechada'
      && o.status !== 'cancelado'
    );
    const itemsCount = active.reduce((sum, o) => sum + (o.itens ? o.itens.length : 0), 0);
    const billRequestedCount = active.filter(o =>
      (o as any).status_comanda === 'aguardando_pagamento' ||
      (o as any).statusComanda === 'aguardando_pagamento' ||
      (o as any).contaPedida === true
    ).length;

    if (isInitialOrdersMountRef.current) {
      isInitialOrdersMountRef.current = false;
      prevOrdersSignatureRef.current = { itemsCount, billRequestedCount };
      return;
    }

    const prev = prevOrdersSignatureRef.current;
    if (billRequestedCount > prev.billRequestedCount) {
      playOrderAlert('bill_requested');
    } else if (itemsCount > prev.itemsCount) {
      // Uma comanda vazia é apenas sessão de mesa, não um pedido novo.
      // O som nasce somente quando os itens que também geram o card chegam.
      playOrderAlert('new_order');
    }

    prevOrdersSignatureRef.current = { itemsCount, billRequestedCount };
  }, [orders, playOrderAlert]);

  // Drawer Overlay do Operador/Login
  const [isOperatorDrawerOpen, setIsOperatorDrawerOpen] = useState(false);

  const handleLogoutOperator = () => {
    clearOperatorSession();
    localStorage.removeItem("koma_token");
    localStorage.removeItem("koma_user_id");
    localStorage.removeItem("koma_user_name");
    localStorage.removeItem("koma_user_role");
    localStorage.removeItem("koma_auth_token");
    window.location.reload();
  };

  // ── MÓDULO 3: SLA, Impressão Rápida e Expansão Compacta de Itens ──────────────
  const [nowTimestamp, setNowTimestamp] = useState<number>(() => Date.now());
  const [expandedCardIds, setExpandedCardIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTimestamp(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleCardExpansion = (cardId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedCardIds(prev => ({ ...prev, [cardId]: !prev[cardId] }));
  };

  useEffect(() => {
    const handleOrdersUpdated = () => {
      setNowTimestamp(Date.now());
    };
    window.addEventListener('koma_orders_updated', handleOrdersUpdated);
    return () => {
      window.removeEventListener('koma_orders_updated', handleOrdersUpdated);
    };
  }, []);

  // Função auxiliar para calcular e formatar o tempo real decorrido da mesa/pedido
  const getMinutosDecorridos = (card: any) => {
    const timestamp =
      card.mesa?.aberta_em ||
      card.mesa?.data_abertura ||
      card.mesa?.created_at ||
      card.aberta_em ||
      card.data_abertura ||
      card.aberto_em ||
      card.created_at ||
      card.timestamp ||
      card.criadoEm ||
      (Array.isArray(card.itens) && card.itens.length > 0 && Math.min(
        ...card.itens.map((i: any) => {
          const t = i.criadoEm || i.created_at || i.timestamp;
          return normalizeOperationalTimestamp(t) ?? Infinity;
        }).filter((t: number) => t < Infinity)
      ));

    if (!timestamp) return 'AGORA';

    const start = normalizeOperationalTimestamp(timestamp) ?? 0;

    if (!start || isNaN(start)) return 'AGORA';

    const now = Date.now();
    const diff = Math.max(0, Math.floor((now - start) / 60000));
    if (diff >= 2880) {
      const days = Math.floor(diff / 1440);
      return `${days}d ${Math.floor((diff % 1440) / 60)}h`;
    }
    if (diff >= 60) {
      return `${Math.floor(diff / 60)}h ${diff % 60}m`;
    }
    return diff === 0 ? 'AGORA' : `${diff} MIN`;
  };

  // Função robusta de parser e cálculo de tempo decorrido (evitando UTC/NaN e nunca usando updated_at)
  function calcularMinutosDecorridos(timestamp: any, agora: number): number {
    if (!timestamp) return 0;

    const dataInicio = normalizeOperationalTimestamp(timestamp, agora) ?? 0;

    if (!dataInicio || isNaN(dataInicio)) return 0;

    const diferencaMs = agora - dataInicio;
    const minutos = Math.floor(diferencaMs / (1000 * 60));

    return minutos > 0 ? minutos : 0;
  }

  // Cálculo de tempo de espera dinâmico (SLA) sincronizado entre Salão/Garçom e Caixa
  const getOrderSlaData = (order: any, now: number) => {
    const timeFormatted = getMinutosDecorridos(order);
    const timestampReal =
      order.mesa?.aberta_em ||
      order.mesa?.data_abertura ||
      order.mesa?.created_at ||
      order.aberta_em ||
      order.data_abertura ||
      order.aberto_em ||
      order.created_at ||
      order.timestamp ||
      order.criadoEm;

    const elapsedMinutes = calcularMinutosDecorridos(timestampReal, now);
    const labelText = timeFormatted;

    if (elapsedMinutes > 25) {
      return {
        minutes: elapsedMinutes,
        badgeClass: 'orders-card__time is-late',
        borderTopClass: 'is-late',
        label: labelText
      };
    } else if (elapsedMinutes >= 15) {
      return {
        minutes: elapsedMinutes,
        badgeClass: 'orders-card__time is-attention',
        borderTopClass: 'is-attention',
        label: labelText
      };
    } else {
      return {
        minutes: elapsedMinutes,
        badgeClass: 'orders-card__time is-normal',
        borderTopClass: 'is-normal',
        label: labelText
      };
    }
  };

  // Renderizador compacto de itens de alta densidade
  const renderCompactItemsList = (
    items: any,
    cardId: string,
    isExpanded: boolean,
    onToggle: (cardId: string, e: React.MouseEvent) => void
  ) => {
    let itemList: { name: string; qty: number }[] = [];

    if (Array.isArray(items)) {
      const counts: Record<string, number> = {};
      items.forEach(it => {
        const name = it.nome || 'Item';
        counts[name] = (counts[name] || 0) + 1;
      });
      itemList = Object.entries(counts).map(([name, qty]) => ({ name, qty }));
    } else if (typeof items === 'string') {
      const parts = items.split(/\+|\,/);
      itemList = parts.map(p => {
        const trimmed = p.trim();
        const match = trimmed.match(/^(\d+)x?\s*(.+)$/i);
        if (match) {
          return { qty: parseInt(match[1], 10), name: match[2].trim() };
        }
        return { qty: 1, name: trimmed };
      }).filter(it => it.name.length > 0);
    }

    if (itemList.length === 0) {
      return <p className={clsx('orders-card__items', 'font-medium', 'text-[11px]', 'text-koma-subtle', 'italic', 'p-2', 'rounded-lg')}>Nenhum item adicionado</p>;
    }

    const visibleItems = isExpanded ? itemList : itemList.slice(0, 3);
    const hiddenCount = itemList.length - 3;

    return (
      <div className={clsx('orders-card__items', 'space-y-0.5', 'p-2', 'rounded-lg')}>
        <ul className="space-y-0.5">
          {visibleItems.map((it, idx) => (
            <li key={idx} className={clsx('font-medium', 'text-xs', 'text-koma-secondary', 'flex', 'items-center', 'justify-between', 'font-sans', 'truncate')}>
              <span className="truncate">{it.qty}× {it.name}</span>
            </li>
          ))}
        </ul>
        {itemList.length > 3 && (
          <button
            type="button"
            onClick={(e) => onToggle(cardId, e)}
            className={clsx('mt-0.5', 'text-[11px]', 'font-bold', 'text-emerald-700 dark:text-emerald-400', 'hover:text-emerald-600 dark:text-emerald-300', 'underline', 'cursor-pointer', 'block', 'transition-all')}
          >
            {isExpanded ? "▲ Recolher itens" : `+ ${hiddenCount} mais itens (expandir)`}
          </button>
        )}
      </div>
    );
  };

  const getTableOrderPresentation = (order: Order) => {
    const mesaId = Number(order.mesaId || 0);
    const configuredName = salonTables.find(table => Number(table.id) === mesaId)?.nome?.trim();
    const activeItemCount = (order.itens || []).filter(item => item.status !== 'cancelado').length;
    const orderNumbers = Array.from(new Set(
      (order.numeroPedidos?.length ? order.numeroPedidos : [order.numeroPedido])
        .map(number => Number(number))
        .filter(number => Number.isFinite(number) && number > 0)
    ));
    const isPendingConfirmation = String(order.id || '').startsWith('temp-');
    const orderLabel = isPendingConfirmation
      ? 'Pedido em envio'
      : orderNumbers.length > 1
        ? `Pedidos ${orderNumbers.map(number => `#${number}`).join(' + ')}`
        : `Pedido #${orderNumbers[0] || humanOrderNumber(order)}`;

    return {
      shortLabel: mesaId > 0 ? `M${mesaId}` : 'B',
      title: configuredName || (mesaId > 0 ? `Mesa ${mesaId}` : 'Balcão'),
      subtitle: `${orderLabel} · ${activeItemCount} ${activeItemCount === 1 ? 'item' : 'itens'} · ${order.garcomNome || 'Atendimento'}`,
    };
  };

  // Impressão rápida de pré-conta do card no Kanban
  const handleQuickPrintOrder = async (order: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      let url = "";
      if (order.mesaId && Number(order.mesaId) > 0) {
        url = `${apiBaseUrl}/mesas/${order.mesaId}/imprimir-recibo?apenas_valores=false`;
      } else {
        url = `${apiBaseUrl}/comandas/${order.id}/imprimir-recibo`;
      }
      const response = await fetch(url, { method: 'POST', headers: authHeaders });
      if (response.ok) {
        showToast("Impressão via de conferência enviada para a fila!", "success");
        window.dispatchEvent(new Event('koma_print_monitor_refresh'));
      } else {
        const errData = await response.json().catch(() => null);
        showToast(errData?.detail || "Solicitação de impressão rápida concluída.", "info");
      }
    } catch (err) {
      console.error(err);
      showToast("Falha na comunicação com o servidor de impressão.", "error");
    }
  };



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

  const mapComandaToDeliveryView = (c: any): DeliveryOrderView => {
    const itemCounts: { [name: string]: number } = {};
    const itensArr = Array.isArray(c?.itens) ? c.itens : Array.isArray(c?.items) ? c.items : [];
    const activeItems = itensArr.filter((it: any) => it.status !== 'cancelado');
    activeItems.forEach((it: any) => {
      if (it.status !== 'cancelado') {
        const name = it.produto?.nome || it.nome || 'Item';
        itemCounts[name] = (itemCounts[name] || 0) + 1;
      }
    });
    const itensStr = Object.entries(itemCounts)
      .map(([name, qty]) => `${qty}x ${name}`)
      .join(' + ') || 'Nenhum item';

    const subtotal = activeItems
      .reduce((sum: number, it: any) => sum + (it.preco_unit || it.preco || 0), 0);
    const total = subtotal + (c.delivery_taxa || 0);

    const parsedTime = formatBackendTime(c.criado_em);
    const criadoEm = parsedTime === '—' ? '12:00' : parsedTime;

    const origins = (Array.isArray(c?.lancamentos) ? c.lancamentos : [])
      .map((launch: any) => String(launch?.origem || '').toLowerCase());
    const origemOperacional: DeliveryOrderView['origemOperacional'] = origins.includes('smartpos')
      ? 'smartpos'
      : origins.includes('cardapio')
        ? 'cardapio'
        : origins.includes('caixa')
          ? 'caixa'
          : origins.includes('garcom')
            ? 'garcom'
            : 'desconhecida';

    let canal: DeliveryOrderView['canal'] = origemOperacional === 'smartpos' ? 'smartpos' : 'site';
    if (c.identificador && c.identificador.toLowerCase().includes('ifood')) {
      canal = 'ifood';
    } else if (c.identificador && c.identificador.toLowerCase().includes('whats')) {
      canal = 'whats';
    }

    const rawAddress = String(c.delivery_endereco || '').trim();
    const rawType = String(c.tipo || '').toLowerCase();
    const modalidade = rawType === 'retirada' || /retirada\s+no\s+balc[aã]o/i.test(rawAddress)
      ? 'retirada'
      : 'delivery';
    const isQuickSale = modalidade === 'retirada' && (
      origemOperacional === 'smartpos'
      || (
        String(c.identificador || '').trim().toLowerCase() === 'balcão'
        && !String(c.delivery_telefone || '').trim()
      )
    );

    return {
      id: c.id,
      cliente: c.identificador || 'Cliente Sem Nome',
      telefone: c.delivery_telefone || '',
      itens: itensStr,
      total: total,
      canal: canal,
      origemOperacional,
      isQuickSale,
      quantidadeItens: activeItems.length,
      modalidade,
      pago: activeItems.length > 0 && activeItems.every((it: any) => Boolean(it.pago)),
      status: c.delivery_status || 'pendente',
      endereco: modalidade === 'delivery' ? rawAddress : '',
      criadoEm: criadoEm,
      created_at: c.criado_em,
      numeroPedido: c.numero_pedido
    };
  };

  const fetchDeliveryOrders = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/delivery/ativos`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        const mapped = data.map(mapComandaToDeliveryView);
        setDeliveryOrders(mapped);
      }
    } catch (err) {
      console.error('Error fetching delivery orders', err);
    }
  };

  // Monitor de pedidos delivery / online pendentes
  const prevDeliveryPendingCountRef = useRef<number | null>(null);
  useEffect(() => {
    const pendingCount = deliveryOrders.filter(o => o.status === 'pendente' || o.status === 'analise').length;
    if (prevDeliveryPendingCountRef.current === null) {
      prevDeliveryPendingCountRef.current = pendingCount;
      return;
    }
    if (pendingCount > prevDeliveryPendingCountRef.current && !isDrawerOpen) {
      playOrderAlert('delivery_pending');
    }
    prevDeliveryPendingCountRef.current = pendingCount;
  }, [deliveryOrders, isDrawerOpen, playOrderAlert]);

  const fetchMotoboys = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/motoboys/lista`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setMotoboys(data);
      }
    } catch (err) {
      console.error('Error fetching motoboys', err);
    }
  };

  useEffect(() => {
    fetchDeliveryOrders();
    fetchMotoboys();

    const handleDeliveryUpdate = () => {
      fetchDeliveryOrders();
    };

    window.addEventListener('koma_orders_updated', handleDeliveryUpdate);
    return () => {
      window.removeEventListener('koma_orders_updated', handleDeliveryUpdate);
    };
  }, [apiBaseUrl]);

  const openDeliveryOrderDetails = (order: DeliveryOrderView) => {
    const fullComanda = orders.find(o => o.id === order.id);
    const itemsMapped = fullComanda
      ? fullComanda.itens.map((it: any) => ({
          id: it.id,
          comandaId: fullComanda.id,
          nome: it.produto?.nome || it.nome || 'Item',
          preco: it.preco_unit || it.preco || 0,
          observacao: it.observacao || '',
          cliente_nome: it.cliente_nome || it.clienteNome || 'Consumo Geral',
          status: it.status,
          pago: it.pago,
          lancamentoId: it.lancamentoId || it.lancamento_id,
        }))
      : order.itens.split(' + ').map((itStr: string) => {
          const match = itStr.match(/^(\d+)x\s+(.+)$/);
          return {
            nome: match ? match[2] : itStr,
            observacao: '',
            cliente_nome: 'Consumo Geral',
            status: order.status === 'pronto' ? 'pronto' : (order.status === 'transito' ? 'entregue' : 'preparando'),
            lancamentoId: undefined,
          };
        });

    setSelectedKanbanOrder({
      id: order.id,
      comandaId: order.id,
      mesaId: 0,
      quantidadeItens: order.quantidadeItens,
      identificador: order.cliente,
      itens: itemsMapped,
      total: order.total,
      numeroPedido: order.numeroPedido,
      origemOperacional: order.origemOperacional,
      isQuickSale: order.isQuickSale,
      modalidade: order.modalidade,
      deliveryStatus: order.status,
      canal: order.canal,
      telefone: order.telefone,
      endereco: order.endereco,
      criadoEm: order.criadoEm,
      created_at: order.created_at,
      lancamentoId: itemsMapped.find((item: any) => item.lancamentoId)?.lancamentoId,
    });
  };

  const handleUpdateDeliveryStatus = async (orderId: string, statusNovo: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/delivery/status?status_novo=${statusNovo}`, {
        method: 'PUT',
        headers: authHeaders
      });
      if (res.ok) {
        fetchDeliveryOrders();
        onRefreshOrders();
        showToast('Status do pedido atualizado!');
        const targetOrder = (deliveryOrders as any[]).find(o => String(o.id) === String(orderId));
        if (targetOrder && (targetOrder.telefone || targetOrder.delivery_telefone)) {
          const phone = targetOrder.telefone || targetOrder.delivery_telefone;
          const nome = targetOrder.cliente || targetOrder.identificador || 'Cliente';
          const isDelivery = statusNovo === 'transito' || statusNovo === 'saiu_para_entrega';
          if (['pronto', 'transito', 'saiu_para_entrega'].includes(statusNovo)) {
            const msg = buildStatusUpdateMsg(nome, isDelivery);
            openWhatsAppMessage(phone, msg);
          }
        }
        return true;
      } else {
        showToast('Erro ao atualizar status do pedido.', 'error');
        return false;
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao atualizar status.', 'error');
      return false;
    }
  };

  const handleDespacharKanban = async (orderId: string, selectedMotoboyId: string) => {
    if (!selectedMotoboyId) {
      showToast('Selecione um motoboy para despachar o pedido!', 'info');
      return;
    }
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/despachar?motoboy_id=${selectedMotoboyId}`, {
        method: 'POST',
        headers: authHeaders
      });
      if (res.ok) {
        showToast('Pedido despachado com sucesso!');
        setSelectedKanbanOrder(null);
        fetchDeliveryOrders();
        onRefreshOrders();
      } else {
        const err = await res.json();
        showToast(`Erro ao despachar: ${err.detail}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao despachar.', 'error');
    }
  };

  const handleDespacharWhatsApp = async (order: any, selectedMotoboyId: string) => {
    if (!selectedMotoboyId) {
      showToast('Selecione um motoboy para despachar!', 'info');
      return;
    }
    const mb = motoboys.find(m => String(m.id) === String(selectedMotoboyId));
    if (!mb) {
      showToast('Motoboy não encontrado.', 'error');
      return;
    }

    try {
      const linkRes = await fetch(`${apiBaseUrl}/comandas/motoboys/${selectedMotoboyId}/gerar-link`, {
        method: 'POST',
        headers: authHeaders
      });
      let linkPwa = '';
      if (linkRes.ok) {
        const linkData = await linkRes.json();
        linkPwa = `${window.location.origin}${linkData.link}`;
      } else {
        linkPwa = `${window.location.origin}/entregador`;
      }

      const res = await fetch(`${apiBaseUrl}/comandas/${order.id}/despachar?motoboy_id=${selectedMotoboyId}`, {
        method: 'POST',
        headers: authHeaders
      });

      if (res.ok) {
        showToast('Pedido despachado! Abrindo WhatsApp...', 'success');
        if (typeof setSelectedKanbanOrder === 'function') setSelectedKanbanOrder(null);
        if (typeof fetchDeliveryOrders === 'function') fetchDeliveryOrders();
        if (typeof onRefreshOrders === 'function') onRefreshOrders();

        const mbTel = (mb.telefone || '').replace(/\D/g, '');
        const msg = `*NOVA ENTREGA - KÔMA*\n\n` +
          `*Pedido:* #${order.numero_pedido || order.id}\n` +
          `*Cliente:* ${order.cliente || order.identificador || 'Cliente'}\n` +
          `*Endereço:* ${order.endereco || order.delivery_endereco || 'Não informado'}\n` +
          `*Telefone Cliente:* ${order.telefone || order.delivery_telefone || 'Não informado'}\n` +
          `*Valor a Cobrar:* R$ ${(order.total || 0).toFixed(2)}\n\n` +
          `*Acesse o Painel do Entregador:* ${linkPwa}`;

        const waUrl = mbTel ? `https://wa.me/55${mbTel}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
        window.open(waUrl, '_blank');
      } else {
        const err = await res.json();
        showToast(`Erro ao despachar: ${err.detail}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao despachar.', 'error');
    }
  };

  const handleRevogarAcessoMotoboy = async (selectedMotoboyId: string) => {
    if (!selectedMotoboyId) {
      showToast('Selecione um motoboy para revogar o acesso!', 'info');
      return;
    }
    const mb = motoboys.find(m => String(m.id) === String(selectedMotoboyId));
    if (!mb) {
      showToast('Motoboy não encontrado.', 'error');
      return;
    }
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/motoboys/${selectedMotoboyId}/revogar-link`, {
        method: 'POST',
        headers: authHeaders
      });
      if (res.ok) {
        showToast(`Acesso do entregador '${mb.nome}' revogado com sucesso!`, 'success');
      } else {
        showToast('Não foi possível revogar o acesso.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao tentar revogar o acesso.', 'error');
    }
  };

  const handleFecharDelivery = async (orderId: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/fechar`, {
        method: 'PUT',
        headers: authHeaders
      });
      if (res.ok) {
        showToast('Comanda de delivery encerrada com sucesso!');
        setSelectedKanbanOrder(null);
        fetchDeliveryOrders();
        onRefreshOrders();
      } else {
        showToast('Erro ao fechar comanda.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao finalizar pedido.', 'error');
    }
  };

  const handleRecusarPedido = async (orderId: string) => {
    await handleUpdateDeliveryStatus(orderId, 'recusado');
  };

  const handleFinalizarPedido = async (orderId: string) => {
    await handleFecharDelivery(orderId);
  };

  const handleAddMotoboy = async (e: React.FormEvent, newMotoboyNome: string, newMotoboyTelefone: string) => {
    e.preventDefault();
    if (!newMotoboyNome.trim() || !newMotoboyTelefone.trim()) return;
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/motoboys`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: newMotoboyNome, telefone: newMotoboyTelefone, ativo: true })
      });
      if (res.ok) {
        showToast('Fretista cadastrado com sucesso!');
        await fetchMotoboys();
        setNewMotoboyNome('');
        setNewMotoboyTelefone('');
      } else {
        showToast('Erro ao cadastrar fretista.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao cadastrar fretista.', 'error');
    }
  };

  const [dynamicMenu, setDynamicMenu] = useState<Product[]>(() => {
    if (liveProdutos && liveProdutos.length > 0) return liveProdutos;
    return [];
  });
  // Real products loaded from backend
  const [apiProdutos, setApiProdutos] = useState<Product[]>([]);
  const suggestedProductCode = useMemo(() => {
    const numericCodes = apiProdutos
      .map((product) => String(product.id || '').trim())
      .filter((code) => /^\d+$/.test(code));
    const nextNumber = numericCodes.reduce((largest, code) => Math.max(largest, Number(code)), 0) + 1;
    const width = Math.max(3, ...numericCodes.map((code) => code.length));
    return String(nextNumber).padStart(width, '0');
  }, [apiProdutos]);

  // Fetch current shift status
  const fetchTurno = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${apiBaseUrl}/caixa/turno/atual`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setTurno(data);
      }
    } catch (err) {
      console.error('Error fetching shift status', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch registered users (team CRUD)
  const fetchSystemUsers = (): Promise<void> => {
    if (systemUsersRequestRef.current) return systemUsersRequestRef.current;
    const request = (async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/caixa/funcionarios`, { headers: authHeaders });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) setSystemUsers(data);
      } catch (error) {
        console.error('Error fetching system users:', error);
      }
    })();
    systemUsersRequestRef.current = request;
    void request.finally(() => {
      if (systemUsersRequestRef.current === request) systemUsersRequestRef.current = null;
    });
    return request;
  };

  const fetchConfiguracoes = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/configuracoes`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setCheckoutServiceTax(data.taxa_servico_ativa);
        setTaxaServicoAtiva(data.taxa_servico_ativa);
        setServiceTaxRate(data.taxa_servico_padrao);
        setUnificarViasDelivery(data.unificar_vias_delivery);
        setPrintHeader(data.impressao_nome_restaurante || "Kôma Gourmet Bistrô");
        setPrintNamePosition(data.impressao_nome_posicao || 'cabecalho');
        setPrintFooter(data.impressao_mensagem_rodape || "");
        setPermDelivery(data.perm_garcom_delivery);
        setPermEdit(data.perm_garcom_editar);
        setPermAddCharges(data.perm_garcom_taxas);
        setPermCancel(data.perm_garcom_cancelar);
        setPermShowStatus(data.perm_garcom_status);
        setPermOpenEmpty(data.perm_garcom_abrir_vazia);
        setPermAutoPrint(data.perm_garcom_print);
        setPermCloseAccount(data.perm_garcom_fechar);
        setPermDiscount(data.perm_garcom_desconto);
        setPermSurcharge(data.perm_garcom_acrescimo);
        setPermPeopleCount(data.perm_garcom_pessoas);
        setPermTransferTables(data.perm_garcom_transferir_mesa);
        setPermTransferItems(data.perm_garcom_transferir_item);
        setPermClientCall(data.perm_garcom_chamar);
        setPermShowIdleTables(data.perm_garcom_ociosas);
      }
    } catch (e) {
      console.error('Error fetching configurations', e);
    }
  };

  const fetchCardapioConfig = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/config-cardapio`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setCardapioStatusOverride(data.status_override || 'Automático');
        setCardapioCorPrimaria(data.cor_primaria || '#00b894');
        setCardapioCorFundo(data.cor_fundo || '#090a0f');
        setCardapioLogoUrl(data.logo_url || '');
        setCardapioBannerUrl(data.banner_url || '');
        setCardapioSobreNos(data.sobre_nos || '');
        setCardapioEndereco(data.endereco || '');
      }
    } catch (err) {
      console.error('Error fetching cardapio whitelabel config', err);
    }
  };

  const saveCardapioConfig = async () => {
    setIsSavingCardapioConfig(true);
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/config-cardapio`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status_override: cardapioStatusOverride,
          cor_primaria: cardapioCorPrimaria,
          cor_fundo: cardapioCorFundo,
          logo_url: cardapioLogoUrl,
          banner_url: cardapioBannerUrl,
          sobre_nos: cardapioSobreNos,
          endereco: cardapioEndereco
        })
      });
      if (res.ok) {
        if (typeof showToast === 'function') {
          showToast('Configurações do cardápio digital atualizadas com sucesso!', 'success');
        } else {
          alert('Configurações do cardápio digital atualizadas com sucesso!');
        }
      } else {
        const errD = await res.json().catch(() => ({}));
        const detail = errD.detail || errD.message || 'Falha ao salvar as configurações.';
        alert(`Falha ao salvar as configurações: ${detail}`);
      }
    } catch (err: any) {
      console.error('Error saving cardapio whitelabel config', err);
      alert(`Erro de conexão ao salvar configurações: ${err.message || err}`);
    } finally {
      setIsSavingCardapioConfig(false);
    }
  };

  const refreshLoyaltyUsers = async () => {
    try {
      // O backend aplica autenticação, tenant e RLS antes de devolver as fichas.
      const response = await fetch(`${apiBaseUrl}/fidelidade/clientes`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        throw new Error(`Falha ao carregar clientes (${response.status})`);
      }
      const clientes = await response.json();
      if (Array.isArray(clientes)) {
        const mapped: LoyaltyCustomer[] = clientes.map((c: any) => ({
          id: String(c.id || c.telefone),
          cliente: c.nome || c.cliente || 'Cliente',
          telefone: c.telefone || '',
          pontos: Number(c.saldo_pontos || 0),
          saldo_pontos: Number(c.saldo_pontos || 0),
          saldoCashback: Number(c.saldo_cashback || 0),
          saldo_cashback: Number(c.saldo_cashback || 0),
          historico: c.historico || []
        }));
        setLoyaltyUsers(mapped);
        return;
      }
    } catch (error) {
      console.error('Error fetching loyalty clients from API:', error);
    }
  };

  const handleUpdateClient = async (clienteId: string, newNome: string, newPhone: string, newSaldo?: number) => {
    try {
      const body: any = {
        cliente: newNome.trim(),
        telefone: newPhone.replace(/\D/g, ''),
      };
      if (newSaldo !== undefined && !isNaN(newSaldo)) {
        if (fidelidadeConfig.tipo_recompensa === 'PONTOS') {
          body.saldo_pontos = Math.round(newSaldo);
        } else {
          body.saldo_cashback = newSaldo;
        }
      }
      const res = await fetch(`${apiBaseUrl}/fidelidade/clientes/${clienteId}`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        showToast('Cliente atualizado com sucesso!');
        await refreshLoyaltyUsers();
        return true;
      } else {
        const err = await res.json();
        showToast(err.detail || 'Falha ao atualizar cliente.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Erro de conexão.', 'error');
    }
    return false;
  };

  const handleCreateClient = async (nome: string, telefone: string, saldoInicial: number) => {
    try {
      const body: any = {
        cliente: nome.trim(),
        telefone: telefone.replace(/\D/g, ''),
      };
      if (!isNaN(saldoInicial)) {
        if (fidelidadeConfig.tipo_recompensa === 'PONTOS') {
          body.saldo_pontos = Math.round(saldoInicial);
        } else {
          body.saldo_cashback = saldoInicial;
        }
      }
      const res = await fetch(`${apiBaseUrl}/fidelidade/clientes`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        showToast('Cliente cadastrado com sucesso!');
        await refreshLoyaltyUsers();
        return true;
      } else {
        const err = await res.json();
        showToast(err.detail || 'Erro ao cadastrar cliente.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Erro de conexão.', 'error');
    }
    return false;
  };

  const refreshEstoqueData = () => {
    fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setEstoqueInsumos(data); })
      .catch(err => console.error('Error fetching insumos:', err));

    fetch(`${apiBaseUrl}/estoque/distribuidores`, { headers: authHeaders })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setDistribuidores(data); })
      .catch(err => console.error('Error fetching distribuidores:', err));

    fetch(`${apiBaseUrl}/estoque/fichas-tecnicas`, { headers: authHeaders })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setFichasTecnicas(data); })
      .catch(err => console.error('Error fetching fichas tecnicas:', err));
  };

  const handleSaveInsumo = async (isNew: boolean) => {
    try {
      const url = isNew 
        ? `${apiBaseUrl}/estoque/insumos` 
        : `${apiBaseUrl}/estoque/insumos/${selectedInsumo.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const body: any = {
        nome: insumoFormNome,
        estoque_minimo: Number(insumoFormMinimo),
        estoque_maximo: Number(insumoFormMaximo),
        unidade_medida: insumoFormUnidade,
        preco_medio_custo: Number(insumoFormCusto)
      };

      const res = await fetch(url, {
        method,
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        alert(isNew ? 'Ingrediente cadastrado com sucesso!' : 'Ingrediente atualizado com sucesso!');
        setShowNewInsumoModal(false);
        setShowEditInsumoModal(false);
        refreshEstoqueData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao salvar ingrediente.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao salvar ingrediente.');
    }
  };

  const handleAjustarEstoque = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/estoque/insumos/${selectedInsumo.id}/ajustar`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quantidade: Number(ajusteQtd),
          tipo: ajusteTipo,
          justificativa: ajusteJustificativa
        })
      });

      if (res.ok) {
        alert('Ajuste de estoque realizado com sucesso!');
        setShowAjusteInsumoModal(false);
        refreshEstoqueData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao ajustar estoque.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao ajustar estoque.');
    }
  };

  const handleSaveDistribuidor = async (isNew: boolean) => {
    try {
      const url = isNew
        ? `${apiBaseUrl}/estoque/distribuidores`
        : `${apiBaseUrl}/estoque/distribuidores/${selectedDist.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const body: any = {
        nome_fantasia: distFormNomeFantasia,
        razao_social: distFormRazaoSocial || null,
        cnpj: distFormCnpj || null,
        lead_time_dias: Number(distFormLeadTime)
      };

      const res = await fetch(url, {
        method,
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        alert(isNew ? 'Distribuidor cadastrado com sucesso!' : 'Distribuidor atualizado com sucesso!');
        setShowNewDistModal(false);
        setShowEditDistModal(false);
        refreshEstoqueData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao salvar distribuidor.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao salvar distribuidor.');
    }
  };

  const handleDeleteDistribuidor = async (distId: string) => {
    if (!confirm('Deseja realmente excluir este distribuidor?')) return;
    try {
      const res = await fetch(`${apiBaseUrl}/estoque/distribuidores/${distId}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (res.ok) {
        alert('Distribuidor excluído com sucesso!');
        refreshEstoqueData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao excluir distribuidor.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão.');
    }
  };

  const fetchProdutos = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/produtos/catalogo`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      if (res.ok) {
        const catalog = normalizeCatalogSnapshot(await res.json());
        setApiProdutos(catalog.produtos);
        setDynamicMenu(catalog.produtos);
        setApiCategorias(catalog.categorias);
      }
    } catch (e) {
      console.error('Error fetching catalog snapshot', e);
    }
  };

  const fetchCategorias = async () => {
    await fetchProdutos();
  };

  useEffect(() => {
    fetchTurno();
    fetchDeliveryOrders();
    fetchMotoboys();
    fetchConfiguracoes();
  }, []);

  useEffect(() => {
    if (activeTab !== 'permissoes_cargos') return;
    const refreshTeam = () => void fetchSystemUsers();
    window.addEventListener('koma_team_updated', refreshTeam);
    return () => window.removeEventListener('koma_team_updated', refreshTeam);
  }, [activeTab, apiBaseUrl, authHeaders.Authorization]);

  // Contingência apenas quando o WebSocket estiver indisponível. Com a conexão
  // saudável, os eventos são a fonte de verdade e não há polling concorrente.
  useEffect(() => {
    if (isWsConnected || activeTab !== 'operacao') return;
    const refreshIfVisible = () => {
      if (!document.hidden) {
        fetchTurno();
        fetchDeliveryOrders();
        onRefreshOrders();
      }
    };
    const interval = setInterval(refreshIfVisible, 12000);
    return () => clearInterval(interval);
  }, [isWsConnected, activeTab, onRefreshOrders]);

  useEffect(() => {
    if (activeTab === 'permissoes_cargos' && ['pessoas', 'equipe', 'convites'].includes(activeSubTab)) {
      fetchSystemUsers();
    }
  }, [activeTab, activeSubTab]);

  // Caixa API Handlers
  const fetchTurnoResumo = onRefreshTurnoResumo;

  const fetchCaixaMovimentacoes = useCallback(async () => {
    const requestId = ++caixaMovimentacoesRequestRef.current;
    setIsCaixaMovimentacoesLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/movimentacoes`, { headers: authHeaders });
      if (!res.ok) throw new Error(`Falha ao consultar movimentações (${res.status})`);
      const data: CaixaMovimentacao[] = await res.json();
      if (requestId === caixaMovimentacoesRequestRef.current) {
        setCaixaMovimentacoes(data);
      }
    } catch (error) {
      if (requestId === caixaMovimentacoesRequestRef.current) {
        console.error('Erro ao buscar movimentações de caixa:', error);
      }
    } finally {
      if (requestId === caixaMovimentacoesRequestRef.current) {
        setIsCaixaMovimentacoesLoading(false);
      }
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    const handleCashUpdated = () => {
      void fetchCaixaMovimentacoes();
    };
    window.addEventListener('koma_cash_updated', handleCashUpdated);
    return () => window.removeEventListener('koma_cash_updated', handleCashUpdated);
  }, [fetchCaixaMovimentacoes]);

  const handleRegistrarSangria = async (payload: { valor: number; motivo: string; observacao: string }) => {
    const res = await fetch(`${apiBaseUrl}/caixa/sangria`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Erro ao registrar sangria.');
    }
    showToast('Sangria registrada com sucesso!');
    await fetchTurnoResumo();
    await fetchCaixaMovimentacoes();
  };

  const handleRegistrarSuprimento = async (payload: { valor: number; motivo: string; observacao: string }) => {
    const res = await fetch(`${apiBaseUrl}/caixa/suprimento`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Erro ao registrar suprimento.');
    }
    showToast('Suprimento registrado com sucesso!');
    await fetchTurnoResumo();
    await fetchCaixaMovimentacoes();
  };

  const handleConfirmarFechamento = async (payload: { declarado_dinheiro: number; declarado_cartao: number; declarado_pix: number; observacao: string }) => {
    const res = await fetch(`${apiBaseUrl}/caixa/fechamento`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Erro ao fechar caixa.');
    }
    const resultData = await res.json();
    setFechamentoResult(resultData);
    showToast('Turno de caixa encerrado com sucesso!');
    await fetchTurnoResumo();
  };

  // Fetch optimized statistics, stock, and reports
  useEffect(() => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - parseInt(desempenhoRange));
    const startStr = localCalendarDate(startDate);
    const endStr = localCalendarDate(endDate);

    if (activeTab === 'financeiro') {
      fetchTurnoResumo();
      fetchCaixaMovimentacoes();
    }
    if (activeTab === 'operacao' && ['equipe', 'relatorio_garçons'].includes(activeSubTab)) {
      fetch(`${apiBaseUrl}/garcons/relatorio?data_inicio=${startStr}&data_fim=${endStr}`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setWaitersPerformance(data);
        })
        .catch(err => console.error('Error fetching waiter report:', err));
    }
    if (activeTab === 'operacao' && ['visao_geral', 'vendas', 'produtos_mais_vendidos', 'desempenho', 'relatorio_geral', 'top10'].includes(activeSubTab)) {
      fetch(`${apiBaseUrl}/comandas/estatisticas/geral?data_inicio=${startStr}&data_fim=${endStr}`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (data && data.faturamento !== undefined) setGeneralStats(data);
        })
        .catch(err => console.error('Error fetching general stats report:', err));
    }
    if (activeTab === 'estoque') {
      fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setEstoqueInsumos(data); })
        .catch(err => console.error('Error fetching insumos:', err));

      fetch(`${apiBaseUrl}/estoque/notas`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setNotasEntrada(data); })
        .catch(err => console.error('Error fetching notas:', err));

      fetch(`${apiBaseUrl}/estoque/distribuidores`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setDistribuidores(data); })
        .catch(err => console.error('Error fetching distribuidores:', err));

      fetch(`${apiBaseUrl}/estoque/entradas`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setEntradasEstoque(data); })
        .catch(err => console.error('Error fetching entradas:', err));

      fetch(`${apiBaseUrl}/estoque/movimentacoes`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setMovimentacoesEstoque(data); })
        .catch(err => console.error('Error fetching movimentacoes:', err));

      fetch(`${apiBaseUrl}/estoque/contagens`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setSessoesContagemEstoque(data); })
        .catch(err => console.error('Error fetching contagens:', err));

      fetch(`${apiBaseUrl}/estoque/fichas-tecnicas`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setFichasTecnicas(data); })
        .catch(err => console.error('Error fetching fichas tecnicas:', err));
    }
    if ((activeTab === 'relatorios' || activeTab === 'dashboard') && ['metas', 'metas_previsoes'].includes(activeSubTab)) {
      fetch(`${apiBaseUrl}/comandas/estatisticas/pico`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setHorariosPico(data);
        })
        .catch(err => console.error('Error fetching peak hours:', err));
    }
    if (activeTab === 'clientes') {
      fetch(`${apiBaseUrl}/fidelidade/config`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (data && data.tipo_recompensa) setFidelidadeConfig(data);
        })
        .catch(err => console.error('Error fetching fidelity config:', err));

      void refreshLoyaltyUsers();
    }
    if (activeTab === 'cardapio') {
      fetchProdutos();
    }
    if (activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital') {
      fetchCardapioConfig();
    }
  }, [activeTab, activeSubTab, desempenhoRange]);

  useEffect(() => {
    // 1. Carga inicial dos clientes
    void refreshLoyaltyUsers();

    const handleCustomerEvent = () => {
      void refreshLoyaltyUsers();
    };
    window.addEventListener('koma_customers_updated', handleCustomerEvent);
    window.addEventListener('storage', handleCustomerEvent);

    return () => {
      window.removeEventListener('koma_customers_updated', handleCustomerEvent);
      window.removeEventListener('storage', handleCustomerEvent);
    };
  }, [apiBaseUrl]);

  // Sincronização em tempo real do cardápio via WebSocket / Props
  useEffect(() => {
    if (liveProdutos) {
      setApiProdutos(liveProdutos);
      setDynamicMenu(liveProdutos);
    }
  }, [liveProdutos]);

  useEffect(() => {
    if (liveCategorias) {
      setApiCategorias(liveCategorias);
    }
  }, [liveCategorias]);


  // Global Keyboard Shortcuts for PDV (Cashier)
  useEffect(() => {
    if (activeSubTab !== 'balcao') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

      if (e.key === 'F1') {
        e.preventDefault();
        const searchInput = document.getElementById('pdv-search-input');
        if (searchInput) {
          searchInput.focus();
          (searchInput as HTMLInputElement).select();
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        setPdvOrderType('retirada');
        setTimeout(() => {
          const phoneInput = document.getElementById('pdv-customer-phone-input');
          if (phoneInput) phoneInput.focus();
        }, 50);
      } else if (e.key === 'F3') {
        e.preventDefault();
        setPdvOrderType('mesa');
        setTimeout(() => {
          const mesaSelect = document.getElementById('pdv-mesa-select');
          if (mesaSelect) mesaSelect.focus();
        }, 50);
      } else if (e.key === 'F8') {
        e.preventDefault();
        setPdvOrderType('entrega');
        setTimeout(() => {
          const phoneInput = document.getElementById('pdv-customer-phone-input');
          if (phoneInput) phoneInput.focus();
        }, 50);
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (pdvCart.length > 0) {
          const submitBtn = document.getElementById('pdv-submit-btn');
          if (submitBtn) submitBtn.click();
        }
      } else if (e.key === 'Escape') {
        if (isInput) {
          target.blur();
        }
        setPdvSearch('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSubTab, pdvCart]);

  // Handle open cashier
  const handleAbrirCaixa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/turno/abrir`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ saldo_inicial: Number(saldoInicial || 0) })
      });
      if (res.ok) {
        setShowAbrirModal(false);
        fetchTurno();
      } else {
        const data = await res.json();
        setErrorMsg(data.detail || 'Erro ao abrir caixa');
      }
    } catch (err) {
      setErrorMsg('Erro de conexão ao servidor.');
    }
  };

  // Handle payment processing
  const handleProcessPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || isProcessingPaymentRef.current) return; // Sync ref guard
    const smartPosState = getSmartPosCardState(selectedOrder);
    if (smartPosState?.blocksPayment) {
      setSmartPosRecoveryError(
        'Revise a operação da maquininha antes de lançar outra baixa para esta mesa.'
      );
      return;
    }
    isProcessingPaymentRef.current = true;
    setErrorMsg('');
    setIsProcessingPayment(true);

    try {
      let valorPagamento = Number(paymentValor || 0);
      if (!Number.isFinite(valorPagamento) || valorPagamento <= 0) {
        const autoBalance = getCheckoutBalance(selectedOrder);
        if (autoBalance > 0) {
          valorPagamento = autoBalance;
        } else {
          throw new Error('Informe um valor de pagamento maior que zero.');
        }
      }

      const comandaIds: string[] = (selectedOrder as any).comandaIds || [selectedOrder.id];
      const isMesaPayment = isTableCheckoutOrder(selectedOrder);
      const effectiveIdempotencyKey = idempotencyKey
        || `idem-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      if (selectedItemIds.length > 0) {
        const totalSelecionado = getSelectedItemsTotal(
          selectedOrder,
          selectedItemIds
        );
        if (Math.abs(valorPagamento - totalSelecionado) > 0.01) {
          throw new Error(
            'Para pagar itens marcados, use o valor total da seleção. '
            + 'Limpe a seleção para lançar um valor livre.'
          );
        }
      }

      const effectiveClienteId = identifiedCustomer?.id || selectedOrder.clienteId || null;
      const effectiveCpfOrPhone = (identifiedCustomer?.telefone || paymentCPF).replace(/\D/g, '') || null;
      const effectiveClienteNome = identifiedCustomer?.nome || selectedOrder.identificador || null;

      if (isMesaPayment) {
        // A mesa é uma única conta monetária. O backend distribui esta baixa,
        // de forma atômica, entre todas as comandas abertas da mesa. A seleção
        // é opcional e serve para registrar quais itens foram quitados.
        const res = await operationalFetch(`${apiBaseUrl}/caixa/mesas/${selectedOrder.mesaId}/pagar`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            valor: valorPagamento,
            metodo: paymentMetodo,
            incluir_taxa_servico: taxaServicoAtiva && checkoutServiceTax,
            item_ids: selectedItemIds.length > 0 ? selectedItemIds : null,
            idempotency_key: effectiveIdempotencyKey,
            cliente_id: effectiveClienteId,
            cpf_cliente: effectiveCpfOrPhone,
            nome_cliente: effectiveClienteNome,
          })
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.detail || 'Erro ao registrar pagamento da mesa');
        }
      } else if (selectedItemIds.length > 0) {
        // Opção 1: Itens selecionados. Agrupa os IDs de itens pela comanda de origem
        const itemsByComanda: Record<string, { itemIds: string[]; subtotal: number }> = {};
        selectedItemIds.forEach(itemId => {
          const itemObj = selectedOrder.itens.find(i => i.id === itemId);
          if (itemObj) {
            const cid = itemObj.comandaId || selectedOrder.id;
            if (!itemsByComanda[cid]) {
              itemsByComanda[cid] = { itemIds: [], subtotal: 0 };
            }
            itemsByComanda[cid].itemIds.push(itemId);
            itemsByComanda[cid].subtotal += itemObj.preco;
          }
        });

        // Efetua o pagamento em cada comanda correspondente
        const comandaEntries = Object.entries(itemsByComanda);
        let idx = 0;
        const totalSubtotal = Object.values(itemsByComanda).reduce((sum, d) => sum + d.subtotal, 0);
        const originalVal = Number(paymentValor || 0);

        for (const [cid, data] of comandaEntries) {
          const isLast = idx === comandaEntries.length - 1;
          // Distribui o valor proporcionalmente baseado no subtotal
          const ratio = data.subtotal / totalSubtotal;
          const valToPay = isLast 
            ? originalVal - comandaEntries.slice(0, idx).reduce((sum, entry) => sum + (entry[1].subtotal / totalSubtotal) * originalVal, 0)
            : originalVal * ratio;

          const res = await operationalFetch(`${apiBaseUrl}/caixa/comandas/${cid}/pagar`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              valor: parseFloat(valToPay.toFixed(2)),
              metodo: paymentMetodo,
              item_ids: data.itemIds,
              idempotency_key: `${effectiveIdempotencyKey}-${cid}`,
              cliente_id: effectiveClienteId,
              cpf_cliente: effectiveCpfOrPhone,
              nome_cliente: effectiveClienteNome,
            })
          });
          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.detail || `Erro ao pagar itens da comanda ${cid}`);
          }
          idx++;
        }
      } else {
        // Opção 2: Valor geral. Liquida as comandas sequencialmente
        let remainingVal = Number(paymentValor || 0);

        for (const cid of comandaIds) {
          if (remainingVal <= 0.01) break;

          // Busca itens pendentes desta comanda no card unificado
          const comUnpaidItems = selectedOrder.itens.filter(i => i.comandaId === cid && !i.pago && i.status !== ('cancelado' as any));
          if (comUnpaidItems.length === 0) continue;

          const comSubtotal = comUnpaidItems.reduce((sum, item) => sum + item.preco, 0);
          const comTaxa = (taxaServicoAtiva && checkoutServiceTax) ? comSubtotal * (serviceTaxRate / 100) : 0;
          const comTotal = comSubtotal + comTaxa;

          // Valor a pagar para esta comanda
          const valToPay = Math.min(remainingVal, comTotal);

          const res = await operationalFetch(`${apiBaseUrl}/caixa/comandas/${cid}/pagar`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              valor: parseFloat(valToPay.toFixed(2)),
              metodo: paymentMetodo,
              item_ids: null,
              idempotency_key: `${effectiveIdempotencyKey}-${cid}`,
              cliente_id: effectiveClienteId,
              cpf_cliente: effectiveCpfOrPhone,
              nome_cliente: effectiveClienteNome,
            })
          });
          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.detail || `Erro ao registrar pagamento na comanda ${cid}`);
          }
          remainingVal -= valToPay;
        }
      }

      setPaymentValor('');
      setPaymentCPF('');
      setSelectedItemIds([]);
      setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

      setSelectedOrder(null);
      setShowCheckoutModal(false);
      await Promise.all([onRefreshOrders(), fetchTurno()]);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro de conexão ao servidor.');
    } finally {
      isProcessingPaymentRef.current = false;
      setIsProcessingPayment(false);
    }
  };

  const handleReconcileSmartPosPayment = async (intentId: string) => {
    if (!intentId || isReconcilingSmartPos) return;
    setIsReconcilingSmartPos(true);
    setSmartPosRecoveryError('');
    try {
      const response = await operationalFetch(
        `${apiBaseUrl}/auth/smartpos/payment-intents/${encodeURIComponent(intentId)}/reconciliar-liquidacao`,
        {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || 'Não foi possível concluir a liquidação da maquininha.');
      }

      setSelectedOrder(null);
      setShowCheckoutModal(false);
      showToast('Pagamento da maquininha conciliado com sucesso.', 'success');
      await Promise.all([
        onRefreshOrders(),
        fetchTurno(),
        refreshSmartPosCashProjection(),
      ]);
    } catch (err: any) {
      setSmartPosRecoveryError(err?.message || 'Falha ao reconciliar o pagamento aprovado.');
    } finally {
      setIsReconcilingSmartPos(false);
    }
  };

  // Free table instantly (Cashier power)
  // Add dynamic mesa CRUD handlers
  const handleAddMesaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tableMutation) return;
    const mesaId = Number.parseInt(newMesaId, 10);
    const capacidade = Number.parseInt(newMesaCap, 10);
    if (!Number.isFinite(mesaId) || mesaId <= 0) {
      setTableFormError('Informe um número de mesa maior que zero.');
      return;
    }
    if (!Number.isFinite(capacidade) || capacidade <= 0) {
      setTableFormError('Informe uma capacidade maior que zero.');
      return;
    }
    if (salonTables.some(table => table.id === mesaId)) {
      setTableFormError(`A Mesa ${mesaId} já existe no salão.`);
      return;
    }

    try {
      setTableMutation('create');
      setTableFormError('');
      await onCreateMesa(mesaId, capacidade, newMesaNome.trim() || undefined);
      setShowAddMesaModal(false);
      setNewMesaId('');
      setNewMesaCap('4');
      setNewMesaNome('');
      showToast(`Mesa ${mesaId} adicionada ao salão.`, 'success');
    } catch (err: any) {
      setTableFormError(err?.message || 'Não foi possível criar a mesa. Tente novamente.');
    } finally {
      setTableMutation(null);
    }
  };

  const openWaInvite = (telefone: string, nome: string, token: string) => {
    const link = `${window.location.origin}/ativar?token=${encodeURIComponent(token)}`;
    const msg = `Olá ${nome}! Você foi convidado para trabalhar no Kôma. Clique no link para criar sua senha e ativar sua conta: ${link}`;
    openWhatsAppMessage(telefone, msg);
  };

  const handleAddUser = async (payload: { nome: string; telefone: string; cargo: string }) => {
    const createdUser = await API.cadastrarFuncionario(payload);
    await fetchSystemUsers();
    if (createdUser?.token_convite) {
      openWaInvite(payload.telefone, createdUser.nome, createdUser.token_convite);
    } else {
      showToast('Pessoa cadastrada com sucesso!');
    }
  };

  const handleResendInvite = async (user: SystemUser) => {
    try {
      const res = await fetch(`${apiBaseUrl}/auth/usuarios/${user.id}/reenviar-convite`, {
        method: "POST",
        headers: authHeaders
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token_convite) {
          openWaInvite(data.telefone || user.telefone || '', data.nome || user.nome, data.token_convite);
        } else {
          showToast(`Link de convite gerado para ${user.nome}!`);
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Não foi possível reenviar o convite no momento.');
      }
    } catch (err: any) {
      console.error(err);
      showToast(err?.message || 'Erro de conexão.', 'error');
      throw err;
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Deseja realmente excluir este funcionário?")) return;
    try {
      const res = await fetch(`${apiBaseUrl}/auth/usuarios/${userId}`, {
        method: "DELETE",
        headers: authHeaders
      });
      if (res.ok) {
        showToast("Funcionário removido/desativado com sucesso!");
        await fetchSystemUsers();
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || "Erro ao remover a pessoa.");
      }
    } catch (err: any) {
      console.error(err);
      const message = err?.message || 'Erro ao conectar com o servidor para remover a pessoa.';
      showToast(message, 'error');
      throw err;
    }
  };

  // KDS Kitchen actions (status updates)
  const handleUpdateItemStatus = async (itemId: string, newStatus: 'preparando' | 'pronto' | 'entregue') => {
    // 1. Atualização Otimista Instantânea (0ms no front-end)
    if (onOptimisticUpdateItemStatus) {
      onOptimisticUpdateItemStatus(itemId, newStatus);
    }
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/itens/${itemId}/status?status=${newStatus}`, {
        method: "PUT",
        headers: authHeaders
      });
      if (!res.ok) {
        alert("Erro ao atualizar status na cozinha.");
        onRefreshOrders();
      }
    } catch (err) {
      console.error(err);
      onRefreshOrders();
    }
  };

  const isItemReadyForCheckout = (item: OrderItem, order?: Order | null) => {
    if (item.status === 'pronto' || item.status === 'entregue') return true;
    const currentOrder = order || selectedOrder;
    if (currentOrder && !isTableCheckoutOrder(currentOrder) && ['pronto', 'transito', 'saiu_para_entrega'].includes(String(currentOrder.deliveryStatus || currentOrder.status || ''))) {
      return (item.status as string) !== 'cancelado';
    }
    return false;
  };

  // Checkout calculations helper
  const getCheckoutTotals = (
    order: Order,
    includeServiceTax = checkoutServiceTax
  ) => {
    // Em mesa, Item.pago é apenas histórico visual: o saldo é financeiro e
    // corresponde ao consumo ativo menos Pagamento(s) aprovados.
    const chargeableItems = isTableCheckoutOrder(order)
      ? order.itens.filter(i => (i.status as string) !== 'cancelado')
      : order.itens.filter(i => !i.pago && (i.status as string) !== 'cancelado');
    const subtotal = chargeableItems.reduce((sum, item) => sum + item.preco, 0);
    const taxa = (taxaServicoAtiva && includeServiceTax) ? subtotal * (serviceTaxRate / 100) : 0;
    const total = subtotal + taxa;
    return { subtotal, taxa, total, chargeableItems };
  };

  const getCheckoutBalance = (
    order: Order,
    includeServiceTax = checkoutServiceTax
  ) => {
    const { total } = getCheckoutTotals(order, includeServiceTax);
    return Math.max(0, total - Number(order.valorPago || 0));
  };

  const getSelectedItemsTotal = (
    order: Order,
    itemIds: string[],
    includeServiceTax = checkoutServiceTax
  ) => {
    const selectedItems = order.itens.filter(item =>
      itemIds.includes(item.id)
      && !item.pago
      && (item.status as string) !== 'cancelado'
      && isItemReadyForCheckout(item)
    );
    const subtotal = selectedItems.reduce((sum, item) => sum + item.preco, 0);
    const taxa = (taxaServicoAtiva && includeServiceTax)
      ? subtotal * (serviceTaxRate / 100)
      : 0;
    const selectedTotal = subtotal + taxa;

    // Na mesa, uma baixa anterior sem vínculo com itens pode deixar o saldo
    // menor que a seleção. Nesse caso, o máximo devido continua sendo o saldo.
    return isTableCheckoutOrder(order)
      ? Math.min(selectedTotal, getCheckoutBalance(order, includeServiceTax))
      : selectedTotal;
  };

  // Handle local PDV cart item additions
  const handlePdvAddToCart = (product: Product) => {
    setPdvCart(prev => {
      const idx = prev.findIndex(item => item.product.id === product.id && item.client === 'Balcão');
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [...prev, { product, quantity: 1, obs: '', client: 'Balcão' }];
    });
  };

  const handlePdvUpdateCartQty = (idx: number, delta: number) => {
    setPdvCart(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], quantity: Math.max(1, copy[idx].quantity + delta) };
      return copy;
    });
  };

  const handlePdvRemoveCartItem = (idx: number) => {
    setPdvCart(prev => prev.filter((_, i) => i !== idx));
  };

  const isPdvSubmittingRef = React.useRef(false); // Synchronous guard for PDV order submission
  const pdvPendingOperationRef = React.useRef<{ fingerprint: string; key: string } | null>(null);

  // Submit Order from PDV Counter
  const handlePdvSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPdvSubmittingRef.current) return; // Sync ref guard (faster than isLoading state check)
    if (pdvCart.length === 0) {
      showToast("Seu carrinho de vendas está vazio.", 'info');
      return;
    }
    if (pdvOrderType === 'mesa' && (!pdvTargetMesaId || pdvTargetMesaId === 0)) {
      showToast("Selecione a mesa de destino antes de lançar o pedido.", 'info');
      return;
    }
    const normalizedCustomerPhone = pdvCustomerPhone.replace(/\D/g, '');
    if (pdvOrderType !== 'mesa' && ![10, 11].includes(normalizedCustomerPhone.length)) {
      showToast("Informe um celular válido com DDD.", 'info');
      return;
    }
    if (pdvOrderType !== 'mesa' && pdvCustomerName.trim().length < 2) {
      showToast("Informe o nome do cliente.", 'info');
      return;
    }
    isPdvSubmittingRef.current = true;
    setIsLoading(true);

    // Snapshots dos dados do pedido para envio (capturados antes de qualquer reset de estado)
    const cartItems = [...pdvCart];
    const customerName = pdvCustomerName;
    const mesaId = pdvTargetMesaId;
    const orderType = pdvOrderType;
    const customerPhone = pdvCustomerPhone;
    const customerId = pdvCustomerId;
    const deliveryAddress = pdvDeliveryAddress;
    const deliveryTaxa = pdvDeliveryTaxa;

    // ⚡ TRANSIÇÃO INSTANTÂNEA DE TELA (0ms delay)
    setActiveTab('operacao');
    setActiveSubTab('pedidos');
    showToast("Enviando pedido para a cozinha...", 'info');

    // ⚡ CRIAÇÃO OTIMISTA DO PEDIDO (Aparece imediatamente no Kanban a 0ms)
    if (onOptimisticAddOrder) {
      const tempId = `temp-${Date.now()}`;
      const tempItems = cartItems.flatMap((item, idx) =>
        Array.from({ length: item.quantity }, (_, qtyIdx) => ({
          id: `temp-item-${idx}-${qtyIdx}-${Date.now()}`,
          produtoId: item.product.id,
          nome: item.product.nome,
          preco: item.product.preco,
          observacao: item.obs || '',
          clienteNome: customerName || 'Consumo Geral',
          status: 'preparando',
          lancamentoId: `temp-l-${Date.now()}`
        }))
      );

      const optimisticOrder = {
        id: tempId,
        mesaId: orderType === 'mesa' ? (mesaId || 0) : 0,
        garcomId: 'c-01',
        garcomNome: activeWaiterNome || 'Caixa 1',
        timestamp: new Date(),
        tipo: orderType === 'mesa' ? 'Consumo no Local' : (orderType === 'entrega' ? 'Entrega' : 'Retirada'),
        valorPago: 0,
        identificador: customerName || null,
        statusComanda: null,
        deliveryStatus: orderType === 'mesa' ? null : 'producao',
        mesaOrigemId: null,
        mesaTransferidaDe: null,
        itens: tempItems
      };
      onOptimisticAddOrder(optimisticOrder);
    }

    // Reseta os campos do carrinho imediatamente
    setPdvCart([]);
    setPdvCustomerName('');
    setPdvCustomerPhone('');
    setPdvCustomerId(null);
    setPdvCustomerLookup('idle');
    setPdvCustomerCPF('');
    setPdvDeliveryAddress('');
    setPdvDeliveryTaxa(0);

    try {
      const itemsList = cartItems.flatMap(item =>
        Array.from({ length: item.quantity }, () => ({
          produto_id: item.product.id,
          observacao: item.obs || '',
          cliente_nome: customerName || 'Consumo Geral'
        }))
      );
      const salePayload = {
        cliente_id: orderType === 'mesa' ? undefined : customerId || undefined,
        mesa_id: orderType === 'mesa' ? mesaId : null,
        tipo: orderType === 'mesa' ? 'Consumo no Local' : (orderType === 'entrega' ? 'Entrega' : 'Retirada'),
        identificador: customerName || undefined,
        delivery_status: orderType === 'mesa' ? undefined : 'producao',
        delivery_telefone: orderType === 'mesa' ? undefined : customerPhone,
        delivery_endereco: orderType === 'entrega' ? deliveryAddress : undefined,
        delivery_taxa: orderType === 'entrega' ? Number(deliveryTaxa || 0) : 0.0,
        itens: itemsList,
      };
      const saleFingerprint = JSON.stringify(salePayload);
      if (pdvPendingOperationRef.current?.fingerprint !== saleFingerprint) {
        pdvPendingOperationRef.current = {
          fingerprint: saleFingerprint,
          key: makeOperationKey('cashier-sale'),
        };
      }

      const res = await operationalFetch(`${apiBaseUrl}/comandas/venda-direta`, {
        method: "POST",
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...salePayload,
          idempotency_key: pdvPendingOperationRef.current.key,
        })
      });

      if (res.ok) {
        pdvPendingOperationRef.current = null;
        showToast('Pedido confirmado e enviado à cozinha.', 'success');
        onRefreshOrders();
        fetchDeliveryOrders();
        window.dispatchEvent(new Event('koma_orders_updated'));
      } else {
        const err = await res.json();
        showToast(`Erro ao registrar venda: ${err.detail || 'Falha no servidor'}`, 'error');
        setPdvCart(prev => prev.length > 0 ? prev : cartItems);
        setPdvCustomerName(customerName);
        setPdvCustomerPhone(customerPhone);
        setPdvCustomerId(customerId);
        setPdvDeliveryAddress(deliveryAddress);
        setPdvDeliveryTaxa(deliveryTaxa);
      }
    } catch (err) {
      console.error(err);
      showToast("A rede falhou. O carrinho foi restaurado para você tentar novamente.", 'error');
      setPdvCart(prev => prev.length > 0 ? prev : cartItems);
      setPdvCustomerName(customerName);
      setPdvCustomerPhone(customerPhone);
      setPdvCustomerId(customerId);
      setPdvDeliveryAddress(deliveryAddress);
      setPdvDeliveryTaxa(deliveryTaxa);
    } finally {
      isPdvSubmittingRef.current = false;
      setIsLoading(false);
    }
  };

  // O navegador não detecta a impressora física. O teste passa pela mesma fila
  // dos pedidos e confirma, sem confundir o conector local com a impressora.
  const handleTestPrinter = async () => {
    if (isTestingPrinter) return;
    setIsTestingPrinter(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/print-agents/jobs/inject`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          document_type: 'fechamento',
          destination: 'FECHAMENTO',
          source_type: 'teste_painel',
          source_id: `teste-${Date.now()}`,
          payload_text: [
            '================================',
            ...(printNamePosition === 'cabecalho' && printHeader ? [printHeader] : []),
            '================================',
            'TESTE REAL DO KÔMA PRINT',
            new Date().toLocaleString('pt-BR'),
            '================================',
            printFooter || '',
            ...(printNamePosition === 'rodape' && printHeader ? [printHeader] : [])
          ].join('\n')
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail || 'Erro ao colocar o teste na fila.');
      }
      window.dispatchEvent(new Event('koma_print_monitor_refresh'));
    } catch (error) {
      console.error(error);
      showToast(
        error instanceof Error
          ? error.message
          : 'Não foi possível comunicar com a fila de impressão.',
        'error'
      );
    } finally {
      setIsTestingPrinter(false);
    }
  };

  // O mesmo snapshot ativo alimenta balcão, garçom e cardápio digital.
  // Produtos desativados permanecem no administrativo para preservar histórico,
  // mas nunca aparecem como vendáveis.
  const sellableProducts = useMemo(
    () => dynamicMenu.filter((product) => product.ativo !== false),
    [dynamicMenu]
  );
  const pdvCategories = useMemo(() => {
    const activeCategoryIds = new Set(
      sellableProducts.map((product) => product.categoria_id).filter(Boolean)
    );
    return apiCategorias.filter((category) => activeCategoryIds.has(category.id));
  }, [apiCategorias, sellableProducts]);
  const pdvMenuInsights = useMemo(() => {
    const itemCount = pdvCart.reduce((total, item) => total + item.quantity, 0);
    const cartTotal = pdvCart.reduce((total, item) => total + (item.product.preco * item.quantity), 0);
    const destination = pdvOrderType === 'mesa'
      ? (pdvTargetMesaId > 0 ? `Mesa ${pdvTargetMesaId}` : 'Escolher mesa')
      : pdvOrderType === 'entrega'
        ? 'Delivery'
        : 'Retirada';
    return {
      destination,
      itemCount,
      total: formatCompactCurrency(cartTotal),
      pausedCount: Math.max(0, dynamicMenu.length - sellableProducts.length),
    };
  }, [dynamicMenu.length, pdvCart, pdvOrderType, pdvTargetMesaId, sellableProducts.length]);
  const filteredProducts = useMemo(() => sellableProducts.filter((product) => {
    const category = apiCategorias.find((item) =>
      item.id === product.categoria_id
      || item.id === product.categoria
      || item.nome === product.categoria
    );
    const categoryName = category?.nome || product.categoria || '';
    const matchesCategory = pdvSelectedCategory === 'todos'
      || categoryName === pdvSelectedCategory
      || product.categoria_id === pdvSelectedCategory
      || product.categoria === pdvSelectedCategory;
    const matchesSearch = !pdvSearch
      || smartSearchMatch(`${product.nome} ${product.descricao || ''}`, pdvSearch);
    return matchesSearch && matchesCategory;
  }), [apiCategorias, pdvSearch, pdvSelectedCategory, sellableProducts]);

  useEffect(() => {
    if (
      pdvSelectedCategory !== 'todos'
      && !pdvCategories.some((category) => category.nome === pdvSelectedCategory)
    ) {
      setPdvSelectedCategory('todos');
    }
  }, [pdvCategories, pdvSelectedCategory]);

  useEffect(() => {
    updatePdvCategoryScrollState();
    const element = pdvCategoryScrollRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(updatePdvCategoryScrollState);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [activeSubTab, balcaoMobileView, pdvCategories, updatePdvCategoryScrollState]);

  // KDS Delay Timer Component
  const KDSTimer: React.FC<{ itemTimestamp?: string; status: string }> = ({ itemTimestamp, status }) => {
    const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

    useEffect(() => {
      if (!itemTimestamp || status !== 'preparando') return;

      const calculateElapsed = () => {
        const startTime = new Date(itemTimestamp).getTime();
        if (isNaN(startTime)) return;
        const now = Date.now();
        const diff = Math.max(0, Math.floor((now - startTime) / 1000));
        setElapsedSeconds(diff);
      };

      calculateElapsed();
      const interval = setInterval(calculateElapsed, 1000);
      return () => clearInterval(interval);
    }, [itemTimestamp, status]);

    if (status === 'pronto') {
      return (
        <span className={clsx('px-2', 'py-0.5', 'text-[8px]', 'font-bold', 'rounded', 'font-mono', 'bg-emerald-500/15', 'text-emerald-400', 'border', 'border-emerald-500/30')}>
          ✓ PRONTO
        </span>
      );
    }

    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    let colorClasses = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    let label = 'Em preparo';

    if (minutes >= 15) {
      colorClasses = 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border-rose-500/40 animate-pulse font-extrabold';
      label = 'Atrasado!';
    } else if (minutes >= 10) {
      colorClasses = 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30 font-bold';
      label = 'Atenção';
    }

    return (
      <div className={`px-2 py-0.5 text-[8px] font-mono font-bold rounded border flex items-center gap-1 ${colorClasses}`}>
        <Clock size={10} className="shrink-0" />
        <span>{formattedTime} ({label})</span>
      </div>
    );
  };

  // Extract all active kitchen items from orders database
  const activeKitchenItems = orders.flatMap(order =>
    order.itens
      .filter(item => item.status === 'preparando' || item.status === 'pronto')
      .filter(() => order.deliveryStatus !== 'pendente' && order.deliveryStatus !== 'recusado')
      .map(item => ({
        ...item,
        orderId: order.id,
        mesaId: order.mesaId,
        garcomNome: order.garcomNome,
        timestamp: (item as any).created_at || (item as any).timestamp || order.timestamp
      }))
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

    const mesaNum = String(
      card.mesa_numero || 
      card.mesa_id || 
      card.mesa?.numero || 
      card.mesaId || 
      ''
    );

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
    return tableOrdersInProduction.filter(order => matchesSearchQuery(order, searchQuery));
  }, [tableOrdersInProduction, searchQuery, matchesSearchQuery]);

  const filteredDigitalProduction = useMemo(() => {
    return deliveryOrders.filter(o => o.status === 'producao').filter(order => matchesSearchQuery(order, searchQuery));
  }, [deliveryOrders, searchQuery, matchesSearchQuery]);

  const filteredCol2Table = useMemo(() => {
    return tableOrdersReady.filter(order => matchesSearchQuery(order, searchQuery));
  }, [tableOrdersReady, searchQuery, matchesSearchQuery]);

  const filteredDeliveryFinalization = useMemo(() => {
    return deliveryOrders
      .filter(o => ['pronto', 'transito', 'saiu_para_entrega'].includes(o.status))
      .filter(order => matchesSearchQuery(order, searchQuery));
  }, [deliveryOrders, searchQuery, matchesSearchQuery]);

  const totalResultadosBusca = useMemo(() => {
    return filteredCol1.length + filteredDigitalProduction.length + filteredCol2Table.length + filteredDeliveryFinalization.length;
  }, [filteredCol1, filteredDigitalProduction, filteredCol2Table, filteredDeliveryFinalization]);

  const ordersStages = [
    { id: 'salon' as const, label: 'Salão', count: filteredCol1.length },
    { id: 'digital' as const, label: 'Balcão', count: filteredDigitalProduction.length },
    { id: 'closing' as const, label: 'Concluir', count: filteredCol2Table.length + filteredDeliveryFinalization.length },
  ];
  const effectiveMobileOrdersStage = mobileOrdersStage;
  const ordersColumnCounts = ordersStages.map(stage => stage.count);
  const activeOrdersColumns = ordersColumnCounts.filter(count => count > 0).length;
  const ordersColumnWeight = activeOrdersColumns === 1 ? 1.7 : activeOrdersColumns === 2 ? 1.25 : 1;
  const ordersColumnsTemplate = activeOrdersColumns === 0
    ? `repeat(${ordersStages.length}, minmax(0, 1fr))`
    : ordersColumnCounts
      .map(count => count === 0 ? 'minmax(0, 0.68fr)' : `minmax(0, ${ordersColumnWeight}fr)`)
      .join(' ');
  const ordersBoardStyle = {
    '--orders-columns': ordersColumnsTemplate
  } as React.CSSProperties;

  const activeDeliveryOrdersCount = useMemo(
    () => deliveryOrders.reduce(
      (count, order) => ['pendente', 'analise', 'producao', 'pronto', 'transito'].includes(order.status) ? count + 1 : count,
      0
    ),
    [deliveryOrders]
  );
  const sidebarOrderCount = tableOrdersInProduction.length + activeDeliveryOrdersCount + tableOrdersReady.length;
  const operationalOrderInsights = useMemo(() => {
    const activeDigitalOrders = deliveryOrders.filter(order => (
      ['pendente', 'analise', 'producao', 'pronto', 'transito'].includes(order.status)
    ));

    const activeTableList = [...tableOrdersInProduction, ...tableOrdersReady];

    const tableValue = activeTableList.reduce((total, order) => {
      const itens = Array.isArray(order.itens) ? order.itens : [];
      return total + itens.reduce((itemTotal: number, item: any) => {
        return itemTotal + (!item.pago && String(item.status) !== 'cancelado' ? Number(item.preco) || 0 : 0);
      }, 0);
    }, 0);

    const digitalValue = activeDigitalOrders.reduce(
      (total, order) => total + (!order.pago ? Number(order.total) || 0 : 0),
      0,
    );

    const timestamps = [
      ...activeTableList.map(order => order.aberta_em || order.data_abertura || order.aberto_em || order.timestamp || order.created_at || order.criadoEm),
      ...activeDigitalOrders.map(order => order.criadoEm),
    ];

    const pendingPaymentCount = pagamentosPendentes.length;
    const pendingAcceptanceCount = activeDigitalOrders.filter(order =>
      ['pendente', 'analise'].includes(order.status)
    ).length;
    const readyToFinishCount = tableOrdersReady.length;
    const overdueCount = [
      ...activeTableList,
      ...activeDigitalOrders,
    ].filter(order => getOrderSlaData(order, nowTimestamp).minutes >= 15).length;

    const actionMetric = pendingPaymentCount > 0
      ? { label: 'pagamentos para confirmar', value: pendingPaymentCount, needsAttention: true }
      : pendingAcceptanceCount > 0
        ? { label: 'pedidos para aceitar', value: pendingAcceptanceCount, needsAttention: true }
        : readyToFinishCount > 0
          ? { label: 'prontos para concluir', value: readyToFinishCount, needsAttention: true }
          : overdueCount > 0
            ? { label: 'pedidos há +15 min', value: overdueCount, needsAttention: true }
            : { label: 'sem pendências', value: 0, needsAttention: false };

    return {
      oldestOrder: formatOldestAge(timestamps),
      openValue: tableValue + digitalValue,
      actionMetric,
    };
  }, [deliveryOrders, nowTimestamp, pagamentosPendentes, tableOrdersInProduction, tableOrdersReady]);

  const isSidebarTabActive = (tabId: string) => (
    tabId === 'cardapio_digital' ? (activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital')
    : tabId === 'permissoes_cargos' ? (activeTab === 'permissoes_cargos' || (activeTab === 'configuracoes' && activeSubTab === 'equipe'))
    : tabId === 'impressao_salao' ? (activeTab === 'impressao_salao' || (activeTab === 'configuracoes' && activeSubTab === 'impressoras'))
    : tabId === 'assinatura_pix' ? (activeTab === 'assinatura_pix' || (activeTab === 'configuracoes' && activeSubTab === 'planos'))
    : tabId === 'relatorios' ? (activeTab === 'relatorios' || activeTab === 'dashboard')
    : activeTab === tabId
  );

  const handleSidebarNavigation = (tabId: string, closeMobile = false) => {
    if (closeMobile) setIsMobileSidebarOpen(false);

    if (tabId === 'cardapio_digital' && !hasOnlineMenu) {
      setActiveTab('assinatura_pix');
      setActiveSubTab('planos');
      showToast(
        currentPlanId === 'pro'
          ? `Ative o ${ONLINE_MENU_ADDON.name} ou migre para o Kôma Premium.`
          : 'O cardápio online está disponível no Kôma Pro como adicional e incluído no Premium.',
        'info'
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

  const selectedDetailItems = selectedKanbanOrder
    ? groupKanbanDetailItems(selectedKanbanOrder.itens)
    : [];
  const selectedOrderNumber = selectedKanbanOrder
    ? humanOrderNumber(selectedKanbanOrder)
    : '—';
  const selectedIsQuickSale = Boolean(selectedKanbanOrder?.isQuickSale)
    || (
      selectedKanbanOrder?.origemOperacional === 'smartpos'
      && Number(selectedKanbanOrder?.mesaId || 0) === 0
      && String(selectedKanbanOrder?.modalidade || selectedKanbanOrder?.tipo || '').toLowerCase() === 'retirada'
    );
  const selectedIsDigital = Boolean(selectedKanbanOrder)
    && ['retirada', 'entrega', 'delivery'].includes(String(selectedKanbanOrder?.modalidade || selectedKanbanOrder?.tipo || '').toLowerCase());
  const selectedOrderTotal = selectedKanbanOrder
    ? Number(selectedKanbanOrder.total ?? selectedKanbanOrder.itens?.reduce(
        (sum: number, item: any) => sum + Number(item.preco_unit || item.preco || 0),
        0,
      ) ?? 0)
    : 0;
  const selectedCanAdvanceDigital = selectedIsDigital
    && selectedKanbanOrder?.deliveryStatus === 'producao';
  const selectedCheckoutSmartPosState = selectedOrder
    ? getSmartPosCardState(selectedOrder)
    : null;

  return (
    <div className={`cashier-shell flex w-full bg-koma-page text-koma-foreground font-sans selection:bg-[#10b981]/30 text-xs ${fontSize === 'grande' ? 'font-large' : fontSize === 'gigante' ? 'font-huge' : ''
      }`}>

      {/* TOAST DE FEEDBACK NÃO-BLOQUEANTE */}
      {toastData && (
        <div className={clsx(
          "fixed bottom-6 right-6 z-[9999] font-bold px-5 py-3 rounded-2xl shadow-2xl text-sm animate-fade-in pointer-events-none border backdrop-blur-md",
          toastData.type === 'error' ? "bg-rose-900/90 border-rose-700/50 text-rose-100" :
          toastData.type === 'info' ? "bg-amber-900/90 border-amber-700/50 text-amber-100" :
          "bg-[#10b981] text-[#0B0B0C] border-[#10b981]"
        )}>
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
              className={clsx('cashier-sidebar', 'cashier-sidebar--mobile', 'relative', 'w-[17rem]', 'max-w-[88vw]', 'flex', 'flex-col', 'justify-between', 'shrink-0', 'h-full', 'z-10', 'shadow-2xl', 'overflow-y-auto')}
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
                      <strong>
                      {turno?.status === 'aberto' ? 'Caixa Aberto' : 'Caixa Fechado'}
                      </strong>
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
                    <SidebarGroupLabel className="cashier-nav-group-label">
                      {group.category}
                    </SidebarGroupLabel>
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
                                <span className="cashier-nav-icon"><Icon size={15} /></span>
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
                  {CASHIER_SIDEBAR_SECONDARY_ITEMS.map(item => {
                    const Icon = item.icon;
                    const isLocked = item.id === 'cardapio_digital' && !hasOnlineMenu;
                    return (
                      <button key={item.id} type="button" onClick={() => handleSidebarNavigation(item.id, true)} className="cashier-nav-item flex min-h-8 items-center gap-2 rounded-lg px-2 text-left text-[11px] font-semibold text-koma-subtle hover:bg-koma-raised hover:text-koma-foreground">
                        <span className="cashier-nav-icon"><Icon size={14} /></span>
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
                          aria-label={sz === 'padrao' ? 'Texto padrão' : sz === 'grande' ? 'Texto grande' : 'Texto muito grande'}
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

                <div className="cashier-operator">
                  <span className="cashier-operator__avatar">{activeWaiterNome?.trim().charAt(0).toUpperCase() || 'K'}</span>
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
        <Sidebar collapsible="icon" className={clsx('cashier-sidebar', 'hidden', 'lg:flex', 'flex-col', 'justify-between', 'shrink-0')}>
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
                  <strong>
                  {turno?.status === 'aberto' ? 'Caixa Aberto' : 'Caixa Fechado'}
                  </strong>
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
                <SidebarGroupLabel className="cashier-nav-group-label">
                  {group.category}
                </SidebarGroupLabel>
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
                            <span className="cashier-nav-icon"><Icon size={15} /></span>
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
              {CASHIER_SIDEBAR_SECONDARY_ITEMS.map(item => {
                const Icon = item.icon;
                const isLocked = item.id === 'cardapio_digital' && !hasOnlineMenu;
                return (
                  <button key={item.id} type="button" onClick={() => handleSidebarNavigation(item.id)} className="cashier-nav-item flex min-h-8 items-center gap-2 rounded-lg px-2 text-left text-[11px] font-semibold text-koma-subtle hover:bg-koma-raised hover:text-koma-foreground" title={item.label}>
                    <span className="cashier-nav-icon"><Icon size={14} /></span>
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
                      aria-label={sz === 'padrao' ? 'Texto padrão' : sz === 'grande' ? 'Texto grande' : 'Texto muito grande'}
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
              <span className="cashier-operator__avatar">{activeWaiterNome?.trim().charAt(0).toUpperCase() || 'K'}</span>
              <span className="cashier-operator__copy">
                <small>Operador</small>
                <strong>{activeWaiterNome}</strong>
              </span>
            </div>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

      {/* CONTENT AREA */}
      <main className={clsx('cashier-main', 'min-w-0', 'min-h-0', 'flex-1', 'bg-koma-canvas', 'flex', 'flex-col', 'w-full')}>
        {/* Top header bar */}
        <header className={clsx('cashier-topbar', 'h-14', 'border-b', 'border-koma-border', 'bg-koma-panel', 'px-4', 'sm:px-6', 'flex', 'items-center', 'justify-between', 'shrink-0')}>
          <div className={clsx('flex', 'items-center', 'gap-2', 'truncate')}>
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              className={clsx('lg:hidden', 'p-1.5', 'bg-koma-raised', 'hover:bg-koma-card', 'text-emerald-700', 'dark:text-emerald-400', 'rounded-xl', 'border', 'border-koma-border', 'flex', 'items-center', 'justify-center', 'cursor-pointer', 'shrink-0')}
              title="Abrir Menu do Caixa"
              aria-label="Abrir menu principal"
              aria-controls="mobile-caixa-sidebar"
              aria-expanded={isMobileSidebarOpen}
              id="btn-mobile-caixa-sidebar-open"
            >
              <Menu size={16} />
            </button>
            <SidebarTrigger className="hidden lg:flex" title="Recolher ou expandir menu" aria-label="Recolher ou expandir menu" />
            <h2 className={clsx('font-serif', 'font-bold', 'text-xs', 'sm:text-sm', 'tracking-tight', 'text-koma-foreground', 'truncate')}>
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

          {/* Botão MODO PDV / FULLSCREEN */}
          <div className={clsx('flex', 'items-center', 'gap-2', 'shrink-0')}>
            <button
              type="button"
              onClick={toggleFullscreen}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border',
                isFullscreen
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-400 hover:bg-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40 dark:hover:bg-emerald-500/30'
                  : 'bg-koma-raised text-koma-secondary border-koma-border hover:bg-koma-card hover:text-koma-foreground'
              )}
              title={isFullscreen ? "Sair do Modo PDV Tela Cheia" : "Entrar no Modo PDV Tela Cheia"}
              aria-label={isFullscreen ? "Sair do modo PDV em tela cheia" : "Entrar no modo PDV em tela cheia"}
              id="btn-modo-pdv-fullscreen"
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              <span className={clsx('hidden', 'sm:inline')}>{isFullscreen ? "Sair da Tela Cheia" : "Modo PDV"}</span>
            </button>
          </div>
        </header>

        {/* Sub-tabs Navigation Bar */}
        <div className={clsx('cashier-subnav', 'bg-koma-panel/80', 'backdrop-blur-md', 'border-b', 'border-koma-border', 'px-6', 'py-1.5', 'flex', 'gap-2', 'shrink-0', 'overflow-x-auto', 'scrollbar-none')}>
          {activeTab === 'operacao' && [
            { id: 'pedidos', label: 'Pedidos' },
            { id: 'balcao', label: 'Novo pedido' },
            { id: 'mesas', label: 'Salão' }
          ].map(sub => (
            <button
              key={sub.id}
              onClick={() => {
                if (sub.id === 'balcao') {
                  setPdvOrderType('retirada');
                  setPdvTargetMesaId(0);
                  setBalcaoMobileView('produtos');
                  setPdvProductDetailId(null);
                }
                setActiveSubTab(sub.id);
              }}
              className={clsx('cashier-subnav__button', activeSubTab === sub.id && 'is-active')}
            >
              {sub.label}
            </button>
          ))}

          {activeTab === 'cardapio' && [
            { id: 'produtos', label: 'Produtos', count: apiProdutos.length },
            { id: 'complementos', label: 'Complementos' },
            { id: 'categorias', label: 'Preparo e impressão', count: apiCategorias.length }
          ].map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={clsx('cashier-subnav__button', activeSubTab === sub.id && 'is-active')}
            >
              {sub.label}
              {sub.count !== undefined && (
                <span aria-hidden="true" className={clsx('ml-1.5', 'rounded-full', 'px-1.5', 'py-0.5', 'font-mono', 'text-[8px]', activeSubTab === sub.id ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-koma-raised text-koma-muted')}>{sub.count}</span>
              )}
            </button>
          ))}

          {activeTab === 'estoque' && [
            { id: 'insumos', label: 'Ingredientes' },
            { id: 'historico', label: 'Histórico' },
            { id: 'inventario', label: 'Inventário' },
            { id: 'fornecedores', label: 'Fornecedores' }
          ].map(sub => {
            const isSubActive = (
              (sub.id === 'historico' && ['historico', 'entradas', 'xml', 'notas_entrada', 'movimentacoes'].includes(activeSubTab)) ||
              (sub.id === 'inventario' && ['inventario', 'contagem'].includes(activeSubTab)) ||
              (sub.id === 'fornecedores' && ['fornecedores', 'distribuidores'].includes(activeSubTab)) ||
              activeSubTab === sub.id
            );
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

          {activeTab === 'financeiro' && [
            { id: 'turno_atual', label: 'Turno Atual' },
            { id: 'movimentacoes', label: 'Movimentações' },
            { id: 'fechamento', label: 'Fechamento' }
          ].map(sub => {
            const isSubActive = (
              (sub.id === 'turno_atual' && ['turno_atual', 'fluxo'].includes(activeSubTab)) ||
              (sub.id === 'movimentacoes' && ['movimentacoes', 'ajustes', 'ajustes_caixa', 'suprimento', 'sangria'].includes(activeSubTab)) ||
              (sub.id === 'fechamento' && ['fechamento', 'conferencia', 'conferencia_cega'].includes(activeSubTab)) ||
              activeSubTab === sub.id
            );
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

          {activeTab === 'clientes' && [
            { id: 'clientes', label: 'Clientes' },
            { id: 'fidelidade', label: 'Programa de Fidelidade' },
            { id: 'cupons', label: 'Cupons & Promoções' }
          ].map(sub => {
            const isSubActive = (
              (sub.id === 'clientes' && ['clientes', 'crm', 'banco_clientes'].includes(activeSubTab)) ||
              (sub.id === 'fidelidade' && ['fidelidade', 'programa_fidelidade'].includes(activeSubTab)) ||
              (sub.id === 'cupons' && ['cupons', 'cupom', 'promocoes', 'descontos'].includes(activeSubTab)) ||
              activeSubTab === sub.id
            );
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

          {(activeTab === 'relatorios' || activeTab === 'dashboard') && [
            { id: 'visao_geral', label: 'Visão Geral' },
            { id: 'financeiro', label: 'Financeiro' },
            { id: 'produtos', label: 'Produtos' },
            { id: 'equipe', label: 'Equipe' }
          ].map(sub => {
            const isSubActive = (
              (sub.id === 'visao_geral' && ['visao_geral', 'metas', 'vendas', 'indicadores'].includes(activeSubTab)) ||
              (sub.id === 'financeiro' && ['financeiro', 'dre', 'demonstrativo_dre'].includes(activeSubTab)) ||
              (sub.id === 'produtos' && ['produtos', 'produtos_mais_vendidos', 'top10'].includes(activeSubTab)) ||
              (sub.id === 'equipe' && ['equipe', 'desempenho_equipe'].includes(activeSubTab)) ||
              activeSubTab === sub.id
            );
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

          {(activeTab === 'permissoes_cargos') && [
            { id: 'pessoas', label: 'Pessoas' },
            { id: 'cargos_permissoes', label: 'Funções e acessos' }
          ].map(sub => {
            const isSubActive = (
              (sub.id === 'pessoas' && ['pessoas', 'equipe', 'convites'].includes(activeSubTab)) ||
              (sub.id === 'cargos_permissoes' && ['cargos_permissoes', 'cargos', 'permissoes'].includes(activeSubTab)) ||
              activeSubTab === sub.id
            );
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
            <div className={clsx('absolute', 'inset-0', 'bg-black/80', 'backdrop-blur-xs', 'z-30', 'flex', 'flex-col', 'items-center', 'justify-center', 'text-center', 'p-8', 'space-y-4')}>
              <div className={clsx('p-4', 'bg-koma-panel', 'rounded-full', 'border', 'border-amber-500/20', 'text-amber-500')}>
                <Lock size={32} />
              </div>
              <h3 className={clsx('font-serif', 'text-base', 'font-bold', 'text-koma-foreground')}>Turno de Caixa Fechado</h3>
              <p className={clsx('max-w-md', 'text-[10px]', 'text-koma-subtle', 'leading-relaxed')}>
                Você precisa abrir o caixa digitando o fundo de troco inicial da noite para poder acessar as telas de vendas e comandas.
              </p>
              <button
                onClick={() => setShowAbrirModal(true)}
                className={clsx('px-5', 'py-2.5', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'font-bold', 'rounded-xl', 'transition-all', 'cursor-pointer', 'text-[10px]', 'uppercase', 'tracking-wider')}
              >
                Abrir Caixa Agora
              </button>
            </div>
          )}

          {/* VIEW 1: MEUS PEDIDOS (Kanban) */}
          {activeSubTab === 'pedidos' && (
            <div className={clsx('orders-workspace', 'flex', 'flex-col', 'space-y-4')}>

              <OperationalBanner
                id="orders-heading"
                eyebrow="OPERAÇÃO"
                title="Pedidos"
                accent="por etapa"
                description="Clique no card para ver o pedido e escolher a próxima ação."
                metrics={[
                  { label: 'pedido mais antigo', value: operationalOrderInsights.oldestOrder },
                  { label: 'valor em aberto', value: formatCompactCurrency(operationalOrderInsights.openValue) },
                  {
                    label: operationalOrderInsights.actionMetric.label,
                    value: operationalOrderInsights.actionMetric.value,
                    valueClassName: operationalOrderInsights.actionMetric.needsAttention ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300',
                  },
                ]}
              />

              {/* ALERTA DE PAGAMENTO PENDENTE EM DINHEIRO (GARÇOM) */}
              {pagamentosPendentes.length > 0 && (
                <div className={clsx('bg-koma-card', 'border-2', 'border-amber-500/40', 'p-4', 'rounded-2xl', 'space-y-3', 'animate-pulse-subtle')}>
                  <div className={clsx('flex', 'items-center', 'gap-2', 'text-amber-500', 'font-bold', 'uppercase', 'tracking-wider', 'text-[10px]')}>
                    <AlertTriangle size={14} />
                    <span>Confirmação de Dinheiro Pendente ({pagamentosPendentes.length})</span>
                  </div>
                  <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-2', 'gap-3')}>
                    {pagamentosPendentes.map((pag) => {
                      const comandaMesa = orders.find(o => o.id === pag.comanda_id);
                      const mesaNum = comandaMesa ? comandaMesa.mesaId : '?';
                      return (
                        <div key={pag.id} className={clsx('bg-koma-canvas', 'border', 'border-koma-border', 'p-3', 'rounded-xl', 'flex', 'justify-between', 'items-center', 'gap-4', 'text-[11px]', 'text-left')}>
                          <div>
                            <span className={clsx('text-koma-subtle', 'block')}>Mesa {mesaNum}</span>
                            <span className={clsx('font-bold', 'text-koma-foreground', 'block')}>{formatCurrency(pag.valor)} em Dinheiro</span>
                            <span className={clsx('text-[9.5px]', 'text-emerald-700 dark:text-emerald-400', 'block', 'font-mono')}>Garçom solicitante: {pag.nome_cliente || 'Garçom'}</span>
                          </div>
                          <div className={clsx('flex', 'gap-2')}>
                            <button
                              type="button"
                              onClick={async () => {
                                if (onRemovePendingPaymentOptimistic) onRemovePendingPaymentOptimistic(pag.id);
                                try {
                                  const res = await fetch(`${apiBaseUrl}/caixa/pagamentos/${pag.id}/aprovar`, {
                                    method: 'POST',
                                    headers: authHeaders
                                  });
                                  if (res.ok) {
                                    showToast("Pagamento em dinheiro confirmado!");
                                    onRefreshOrders();
                                    if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
                                  } else {
                                    if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
                                  }
                                } catch (e) {
                                  console.error(e);
                                  if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
                                }
                              }}
                              className={clsx('px-3', 'py-1.5', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded-lg', 'font-bold', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                            >
                              Confirmar Recebimento
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (onRemovePendingPaymentOptimistic) onRemovePendingPaymentOptimistic(pag.id);
                                try {
                                  const res = await fetch(`${apiBaseUrl}/caixa/pagamentos/${pag.id}/recusar`, {
                                    method: 'POST',
                                    headers: authHeaders
                                  });
                                  if (res.ok) {
                                    showToast("Pagamento recusado.");
                                    onRefreshOrders();
                                    if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
                                  } else {
                                    if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
                                  }
                                } catch (e) {
                                  console.error(e);
                                  if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
                                }
                              }}
                              className={clsx('px-3', 'py-1.5', 'bg-rose-50', 'border', 'border-rose-300', 'text-rose-800', 'hover:bg-rose-700', 'hover:text-white', 'dark:bg-rose-950/30', 'dark:border-rose-900/35', 'dark:text-rose-300', 'dark:hover:bg-rose-900/50', 'rounded-lg', 'font-bold', 'text-[9px]', 'transition-all', 'cursor-pointer')}
                            >
                              Rejeitar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Controls bar with Search Input */}
              <div className={clsx('orders-toolbar', 'sticky', 'top-0', 'z-20')}>
                {/* Search Bar Component */}
                <div className={clsx('orders-search', 'relative')}>
                  <Search className={clsx('absolute', 'left-3', 'top-1/2', '-translate-y-1/2', 'w-4', 'h-4', 'text-koma-muted')} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar mesa, cliente, telefone ou item"
                    className="orders-search__input"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="orders-search__clear"
                      title="Limpar busca"
                      aria-label="Limpar busca"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {searchQuery.trim() !== '' && (
                  <span className="orders-search__result" aria-live="polite">
                    {totalResultadosBusca} {totalResultadosBusca === 1 ? 'resultado' : 'resultados'}
                  </span>
                )}

                <div className="orders-toolbar__actions">
                  <label className="orders-auto-accept">
                    <input
                      type="checkbox"
                      checked={autoAccept}
                      onChange={(e) => setAutoAccept(e.target.checked)}
                      className={clsx('sr-only', 'peer')}
                      aria-label="Aceitar pedidos online automaticamente"
                    />
                    <span className="orders-switch" aria-hidden="true"><span /></span>
                    <span className="orders-auto-accept__label">Aceitar pedidos online automaticamente</span>
                  </label>
                  <div className="orders-delivery-total">
                    <span>Balcão e delivery</span>
                    <strong>{formatCurrency(deliveryOrders.reduce((s, o) => s + o.total, 0))}</strong>
                  </div>
                  {/* Bell button — opens floating drawer */}
                  <button
                    type="button"
                    onClick={() => { setIsDrawerOpen(true); }}
                    className="orders-new-orders"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                    <span>Aguardando aceite</span>
                    {deliveryOrders.filter(o => o.status === 'pendente').length > 0 && (
                      <span className="orders-new-orders__count">
                        {deliveryOrders.filter(o => o.status === 'pendente').length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* ── FLOATING DRAWER: Pedidos Pendentes ─────────────────────────────── */}
              {isDrawerOpen && (
                <div
                  className={clsx('fixed', 'inset-0', 'z-50', 'flex')}
                  onClick={() => setIsDrawerOpen(false)}
                >
                  {/* Backdrop */}
                  <div className={clsx('absolute', 'inset-0', 'bg-black/60', 'backdrop-blur-sm')} />
                  {/* Drawer panel */}
                  <div
                    className={clsx('relative', 'ml-auto', 'h-full', 'w-full', 'max-w-sm', 'bg-koma-panel', 'border-l', 'border-koma-border', 'flex', 'flex-col', 'shadow-2xl')}
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Drawer header */}
                    <div className={clsx('flex', 'items-center', 'justify-between', 'px-5', 'py-4', 'border-b', 'border-koma-border', 'shrink-0')}>
                      <div>
                        <h2 className={clsx('font-bold', 'text-koma-foreground', 'text-sm')}>Pedidos aguardando aceite</h2>
                        <p className={clsx('text-[10px]', 'text-koma-subtle', 'mt-0.5')}>Aceite ou recuse cada pedido antes de produzir</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsDrawerOpen(false)}
                        className={clsx('p-1.5', 'rounded-lg', 'bg-koma-raised', 'border', 'border-koma-border', 'text-koma-subtle', 'hover:text-koma-foreground', 'cursor-pointer')}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>

                    {/* Drawer body */}
                    <div className={clsx('flex-1', 'overflow-y-auto', 'p-4', 'space-y-3')}>
                      {deliveryOrders.filter(o => o.status === 'pendente').length === 0 ? (
                        <div className={clsx('flex', 'flex-col', 'items-center', 'justify-center', 'h-40', 'text-koma-muted', 'text-[11px]', 'italic')}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={clsx('mb-3', 'opacity-40')}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                          Nenhum pedido pendente
                        </div>
                      ) : (
                        deliveryOrders.filter(o => o.status === 'pendente').map((order) => (
                          <div key={order.id} className={clsx('orders-pending-card', 'p-4', 'rounded-xl', 'space-y-3')}>
                            <div className={clsx('flex', 'justify-between', 'items-start')}>
                              <div>
                                <div className={clsx('flex', 'flex-wrap', 'gap-1', 'mb-1')}>
                                  <span className={clsx('orders-card__chip', 'is-primary')}>
                                    {order.modalidade === 'delivery' ? 'Delivery' : 'Retirada'}
                                  </span>
                                  <span className={clsx('orders-card__chip', 'is-muted')}>
                                    {order.canal}
                                  </span>
                                </div>
                                <strong className={clsx('text-koma-foreground', 'text-sm', 'block')}>{order.cliente}</strong>
                                <span className={clsx('text-[10px]', 'text-koma-subtle', 'block')}>{order.telefone}</span>
                              </div>
                              <div className="text-right">
                                <span className="orders-card__price">{formatCurrency(order.total)}</span>
                                <span className={clsx('text-[9px]', 'text-koma-muted')}>{order.criadoEm}</span>
                                {order.numeroPedido && <span className={clsx('text-[8px]', 'text-gray-600', 'font-mono', 'block')}>#{order.numeroPedido}</span>}
                              </div>
                            </div>

                            <p className={clsx('text-[10px]', 'text-koma-secondary', 'bg-koma-page', 'p-2', 'rounded', 'border', 'border-koma-border/30', 'leading-relaxed', 'font-mono')}>
                              {order.itens}
                            </p>

                            {order.endereco && (
                              <span className={clsx('text-[10px]', 'text-koma-subtle', 'flex', 'items-start', 'gap-1')}>
                                <MapPin size={11} className={clsx('shrink-0', 'text-emerald-600 dark:text-emerald-300/80', 'mt-0.5')} />
                                <span>{order.endereco}</span>
                              </span>
                            )}

                            <div className={clsx('flex', 'gap-2', 'pt-1')}>
                              <button
                                type="button"
                                onClick={async () => {
                                  await handleUpdateDeliveryStatus(order.id, 'producao');
                                  // Close drawer if no more pending
                                  if (deliveryOrders.filter(o => o.status === 'pendente').length <= 1) setIsDrawerOpen(false);
                                }}
                                className="orders-pending-card__accept"
                              >
                                ✓ Aceitar
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await handleRecusarPedido(order.id);
                                  if (deliveryOrders.filter(o => o.status === 'pendente').length <= 1) setIsDrawerOpen(false);
                                }}
                                className="orders-pending-card__reject"
                              >
                                Recusar
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="orders-mobile-stages" role="tablist" aria-label="Etapa dos pedidos">
                {ordersStages.map(stage => (
                  <button
                    key={stage.id}
                    type="button"
                    role="tab"
                    aria-selected={effectiveMobileOrdersStage === stage.id}
                    onClick={() => setMobileOrdersStage(stage.id)}
                    className={clsx('orders-mobile-stages__button', effectiveMobileOrdersStage === stage.id && 'is-active')}
                  >
                    <span>{stage.label}</span>
                    <strong>{stage.count}</strong>
                  </button>
                ))}
              </div>

              {/* Kanban operacional universal: mesas, pedidos online e finalização. */}
              <div
                className={clsx('orders-board', 'flex-1', 'gap-3', 'pb-3')}
                style={ordersBoardStyle}
              >


                {/* COLUMN 1: Em produção */}
                <div className={clsx('orders-column orders-column--salon flex flex-col overflow-hidden', effectiveMobileOrdersStage === 'salon' && 'is-mobile-active', filteredCol1.length === 0 && 'is-empty')}>
                  <div className={clsx('orders-column__header', 'px-4', 'py-2.5', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                    <div>
                      <span className="orders-column__number">01 / SALÃO</span>
                      <span className={clsx('font-bold', 'text-koma-foreground', 'font-sans', 'block', 'text-sm')}>Mesas em Atendimento</span>
                      <span className={clsx('text-xs', 'text-koma-subtle', 'block', 'mt-0.5', 'font-normal')}>Lançados pelo garçom ou caixa</span>
                    </div>
                    <span className="orders-column__count">
                      {filteredCol1.length}
                    </span>
                  </div>

                  <div className={clsx('orders-column__body', 'p-2.5', 'sm:p-3', 'flex-1', 'overflow-y-auto', 'space-y-2.5')}>
                    {filteredCol1.length === 0 ? (
                      <div className={clsx('orders-empty-state', 'py-16', 'text-center', 'text-koma-subtle', 'text-xs', 'space-y-1')}>
                        <ClipboardList size={20} className={clsx('mx-auto', 'opacity-70', 'mb-2', 'text-emerald-700', 'dark:text-emerald-400')} />
                        <p>{searchQuery ? "Nenhum pedido encontrado para a busca" : "Nenhum pedido local em produção"}</p>
                      </div>
                    ) : (
                      <>
                        {filteredCol1.map((order) => {
                          const preparingItems = order.itens.filter(item => item.status === 'preparando');
                          const tableMovement = getTableMovementContext(order);
                          const cardId = `prod-${order.id}`;
                          const sla = getOrderSlaData(order, nowTimestamp);
                          const isExpanded = !!expandedCardIds[cardId];
                          const totalVal = order.itens.reduce((sum: number, it: any) => sum + (it.preco_unit || it.preco || 0), 0);
                          const smartPosState = getSmartPosCardState(order);
                          const presentation = getTableOrderPresentation(order);

                          return (
                            <div 
                              key={`table-prod-${order.id}`} 
                              onClick={() => setSelectedKanbanOrder(order)}
                              onKeyDown={(event) => {
                                if (event.target !== event.currentTarget) return;
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  setSelectedKanbanOrder(order);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              aria-label={`${presentation.title}, ${presentation.subtitle}, ver detalhes`}
                              className={clsx(
                                'orders-card orders-card--salon rounded-xl p-2.5 sm:p-3 space-y-2 text-left cursor-pointer',
                                sla.borderTopClass
                              )}
                            >
                              <div className="orders-card__identity">
                                <div className="orders-card__number is-table">
                                  <Users size={15} />
                                  <strong>{presentation.shortLabel}</strong>
                                </div>
                                <div className="min-w-0">
                                  <strong className="orders-card__identity-title">{presentation.title}</strong>
                                  <span className="orders-card__identity-subtitle">{presentation.subtitle}</span>
                                  <div className="orders-card__identity-chips">
                                    <span className={clsx('orders-card__chip', sla.badgeClass)}>{sla.label}</span>
                                    <span className={clsx('orders-card__chip', 'is-primary')}>EM ATENDIMENTO</span>
                                    {smartPosState ? (
                                      <span className={clsx('orders-card__chip', smartPosState.chipClass)}>
                                        {smartPosState.label}
                                      </span>
                                    ) : (
                                      <span className={clsx('orders-card__chip', 'is-muted')}>
                                        {operationalOriginLabel(order.origemOperacional)}
                                      </span>
                                    )}
                                    {tableMovement.transferredFromMesaIds.length > 0 && (
                                      <span className={clsx('orders-card__chip', 'is-muted')}>
                                        ↪ Transferida da M{tableMovement.transferredFromMesaIds.join(', M')}
                                      </span>
                                    )}
                                    {tableMovement.mergedMesaIds.length > 0 && (
                                      <span className={clsx('orders-card__chip', 'is-muted')}>
                                        ⛓ Mesclada com M{tableMovement.mergedMesaIds.join(', M')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="orders-card__identity-side">
                                  <span className="orders-card__price">{formatCurrency(totalVal)}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => handleQuickPrintOrder(order, e)}
                                    className="orders-card__icon"
                                    title="Imprimir pré-conta / conferência"
                                    aria-label={`Imprimir conferência da ${presentation.title}`}
                                  >
                                    <Printer size={12} />
                                  </button>
                                </div>
                              </div>

                              {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion)}

                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (isLoading) return;
                                  const ids = preparingItems.map(item => item.id);
                                  if (onOptimisticUpdateItemStatus && ids.length > 0) {
                                    onOptimisticUpdateItemStatus(ids, 'pronto');
                                  }
                                  setIsLoading(true);
                                  try {
                                    await Promise.all(ids.map(id =>
                                      fetch(`${apiBaseUrl}/comandas/itens/${id}/status?status=pronto`, {
                                        method: "PUT",
                                        headers: authHeaders
                                      })
                                    ));
                                  } catch (err) {
                                    console.error(err);
                                    onRefreshOrders();
                                  } finally {
                                    setIsLoading(false);
                                  }
                                }}
                                className={clsx('orders-card__action', 'w-full', 'py-2', 'px-3', 'h-8', 'sm:h-9', 'font-bold', 'text-xs', 'sm:text-sm', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'flex', 'items-center', 'justify-center', 'gap-1.5')}
                              >
                                <Check size={13} />
                                <span>{preparingItems.length === 1 ? 'Marcar item como pronto' : 'Marcar itens como prontos'}</span>
                              </button>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>

                {/* COLUMN 2: pedidos sem mesa, de venda rápida, delivery ou retirada. */}
                <div className={clsx('orders-column orders-column--digital flex flex-col overflow-hidden', effectiveMobileOrdersStage === 'digital' && 'is-mobile-active', filteredDigitalProduction.length === 0 && 'is-empty')}>
                  <div className={clsx('orders-column__header', 'px-4', 'py-2.5', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                    <div>
                      <span className="orders-column__number">02 / SEM MESA</span>
                      <span className={clsx('font-bold', 'text-koma-foreground', 'font-sans', 'block', 'text-sm')}>Balcão e delivery</span>
                      <span className={clsx('text-xs', 'text-koma-subtle', 'block', 'mt-0.5', 'font-normal')}>Venda rápida, retirada e entrega</span>
                    </div>
                    <span className="orders-column__count">
                      {filteredDigitalProduction.length}
                    </span>
                  </div>

                  <div className={clsx('orders-column__body', 'p-2.5', 'sm:p-3', 'flex-1', 'overflow-y-auto', 'space-y-2.5')}>
                    {filteredDigitalProduction.length === 0 ? (
                      <div className={clsx('orders-empty-state', 'py-16', 'text-center', 'text-koma-subtle', 'text-xs', 'space-y-1')}>
                        <Globe size={20} className={clsx('mx-auto', 'opacity-40', 'mb-2', 'text-emerald-600 dark:text-emerald-300')} />
                        <p>{searchQuery ? "Nenhum pedido encontrado para a busca" : "Nenhum pedido online em preparo"}</p>
                      </div>
                    ) : (
                      <>
                        {filteredDigitalProduction.map((order) => {
                          const cardId = `sim-prod-${order.id}`;
                          const sla = getOrderSlaData(order, nowTimestamp);
                          const isExpanded = !!expandedCardIds[cardId];
                          const isDeliveryOrder = order.modalidade === 'delivery';
                          const badgeText = deliveryStatusLabel(order.status, order.modalidade).toUpperCase();
                          const buttonText = isDeliveryOrder ? 'SAIU PARA ENTREGA' : 'PRONTO PARA RETIRADA';

                          return (
                            <div 
                              key={order.id} 
                              onClick={() => openDeliveryOrderDetails(order)}
                              onKeyDown={(event) => {
                                if (event.target !== event.currentTarget) return;
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openDeliveryOrderDetails(order);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              aria-label={`${order.isQuickSale ? 'Venda rápida' : order.modalidade} pedido ${humanOrderNumber(order)}, ver detalhes`}
                              className={clsx(
                                'orders-card orders-card--digital rounded-xl p-2.5 sm:p-3 space-y-2 text-left cursor-pointer',
                                order.isQuickSale && 'orders-card--quick-sale',
                                sla.borderTopClass
                              )}
                            >
                              <div className="orders-card__identity">
                                <div className={clsx('orders-card__number', order.isQuickSale && 'is-quick-sale')}>
                                  {order.isQuickSale ? <Smartphone size={15} /> : <Globe size={15} />}
                                  <strong>#{humanOrderNumber(order)}</strong>
                                </div>
                                <div className="min-w-0">
                                  <strong className="orders-card__identity-title">
                                    {order.isQuickSale ? 'Venda rápida' : order.cliente}
                                  </strong>
                                  <span className="orders-card__identity-subtitle">
                                    {order.isQuickSale
                                      ? `Retirada no balcão · ${order.quantidadeItens} ${order.quantidadeItens === 1 ? 'item' : 'itens'}`
                                      : `${isDeliveryOrder ? 'Delivery' : 'Retirada'}${order.telefone ? ` · ${order.telefone}` : ''}`}
                                  </span>
                                  <div className="orders-card__identity-chips">
                                    <span className={clsx('orders-card__chip', sla.badgeClass)}>{sla.label}</span>
                                    <span className={clsx('orders-card__chip', 'is-primary')}>{badgeText}</span>
                                    <span className={clsx('orders-card__chip', 'is-muted')}>{operationalOriginLabel(order.origemOperacional)}</span>
                                  </div>
                                </div>
                                <div className="orders-card__identity-side">
                                  <span className="orders-card__price">{formatCurrency(order.total)}</span>
                                  <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={(e) => handleQuickPrintOrder(order, e)}
                                    className="orders-card__icon"
                                    title="Imprimir pré-conta / conferência"
                                    aria-label={`Imprimir conferência do pedido ${humanOrderNumber(order)}`}
                                  >
                                    <Printer size={12} />
                                  </button>
                                  </div>
                                </div>
                              </div>

                              {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion)}

                              {isDeliveryOrder && order.endereco && (
                                <span className={clsx('font-normal', 'text-xs', 'text-koma-subtle', 'flex', 'items-center', 'gap-1', 'truncate')}>
                                  <MapPin size={11} className={clsx('shrink-0', 'text-emerald-600 dark:text-emerald-300/80')} />
                                  <span className="truncate">{order.endereco}</span>
                                </span>
                              )}

                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (isLoading) return;
                                  handleUpdateDeliveryStatus(order.id, isDeliveryOrder ? 'transito' : 'pronto');
                                }}
                                className={clsx('orders-card__action', 'w-full', 'py-2', 'px-3', 'h-8', 'sm:h-9', 'font-bold', 'text-xs', 'sm:text-sm', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'flex', 'items-center', 'justify-center', 'gap-1.5')}
                              >
                                <Check size={13} />
                                <span>{buttonText === 'SAIU PARA ENTREGA' ? 'Saiu para entrega' : 'Pronto para retirada'}</span>
                              </button>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>

                {/* COLUMN 3: pagamento e finalização de todas as modalidades. */}
                <div className={clsx('orders-column orders-column--closing flex flex-col overflow-hidden', effectiveMobileOrdersStage === 'closing' && 'is-mobile-active', filteredCol2Table.length === 0 && filteredDeliveryFinalization.length === 0 && 'is-empty')}>
                  <div className={clsx('orders-column__header', 'px-4', 'py-2.5', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                    <div>
                      <span className="orders-column__number">03 / FECHAMENTO</span>
                      <span className={clsx('font-bold', 'text-koma-foreground', 'font-sans', 'block', 'text-sm')}>Itens prontos e conclusão</span>
                      <span className={clsx('text-xs', 'text-koma-subtle', 'block', 'mt-0.5', 'font-normal')}>Veja o que já pode ser recebido ou finalizado</span>
                    </div>
                    <span className="orders-column__count">
                      {filteredCol2Table.length + filteredDeliveryFinalization.length}
                    </span>
                  </div>

                  <div className={clsx('orders-column__body', 'p-2.5', 'sm:p-3', 'flex-1', 'overflow-y-auto', 'space-y-2.5')}>
                    {filteredCol2Table.length === 0 && filteredDeliveryFinalization.length === 0 ? (
                      <div className={clsx('orders-empty-state', 'py-16', 'text-center', 'text-koma-subtle', 'text-xs', 'space-y-1')}>
                        <Check size={20} className={clsx('mx-auto', 'opacity-40', 'mb-2', 'text-emerald-600 dark:text-emerald-300')} />
                        <p>{searchQuery ? "Nenhum pedido encontrado para a busca" : "Nenhum pedido aguardando finalização"}</p>
                      </div>
                    ) : (
                      <>
                        {/* 1. Mesas/Consumo Local aguardando pagamento */}
                        {filteredCol2Table.map((order) => {
                          const cardId = `ready-${order.id}`;
                          const sla = getOrderSlaData(order, nowTimestamp);
                          const isExpanded = !!expandedCardIds[cardId];
                          const contaPedida = !!(order as any).contaPedida;
                          const badgeText = contaPedida ? 'CONTA PEDIDA' : 'PRONTO / RECEBER';
                          const totalVal = order.itens.reduce((sum: number, it: any) => sum + (it.preco_unit || it.preco || 0), 0);
                          const tableMovement = getTableMovementContext(order);
                          const pendingTableItems = Number((order as any).itensEmPreparoCount || 0);
                          const readyTableItems = order.itens.filter(item => (item.status as string) !== 'cancelado').length;
                          const totalTableItems = readyTableItems + pendingTableItems;
                          const smartPosState = getSmartPosCardState(order);
                          const presentation = getTableOrderPresentation(order);

                          return (
                            <div
                              key={`close-${order.id}`}
                              onClick={() => setSelectedKanbanOrder(order)}
                              onKeyDown={(event) => {
                                if (event.target !== event.currentTarget) return;
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  setSelectedKanbanOrder(order);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              aria-label={`${presentation.title}, ${badgeText.toLowerCase()}, ver detalhes`}
                              className={clsx(
                                'orders-card orders-card--closing rounded-xl p-2.5 sm:p-3 space-y-2 text-left cursor-pointer',
                                sla.borderTopClass
                              )}
                            >
                              <div className="orders-card__identity">
                                <div className="orders-card__number is-table">
                                  <Users size={15} />
                                  <strong>{presentation.shortLabel}</strong>
                                </div>
                                <div className="min-w-0">
                                  <strong className="orders-card__identity-title">
                                    {pendingTableItems > 0 ? `Itens prontos · ${presentation.title}` : presentation.title}
                                  </strong>
                                  <span className="orders-card__identity-subtitle">
                                    {pendingTableItems > 0
                                      ? `${readyTableItems} de ${totalTableItems} ${totalTableItems === 1 ? 'item pronto' : 'itens prontos'} · ${presentation.subtitle}`
                                      : presentation.subtitle}
                                  </span>
                                  <div className="orders-card__identity-chips">
                                    <span className={clsx('orders-card__chip', sla.badgeClass)}>{sla.label}</span>
                                    <span className={clsx('orders-card__chip', contaPedida ? 'is-attention' : 'is-primary')}>{badgeText}</span>
                                    {smartPosState ? (
                                      <span className={clsx('orders-card__chip', smartPosState.chipClass)}>
                                        {smartPosState.label}
                                      </span>
                                    ) : (
                                      <span className={clsx('orders-card__chip', 'is-muted')}>
                                        {operationalOriginLabel(order.origemOperacional)}
                                      </span>
                                    )}
                                    {tableMovement.transferredFromMesaIds.length > 0 && (
                                      <span className={clsx('orders-card__chip', 'is-muted')}>
                                        ↪ Transferida da M{tableMovement.transferredFromMesaIds.join(', M')}
                                      </span>
                                    )}
                                    {tableMovement.mergedMesaIds.length > 0 && (
                                      <span className={clsx('orders-card__chip', 'is-muted')}>
                                        ⛓ Mesclada com M{tableMovement.mergedMesaIds.join(', M')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="orders-card__identity-side">
                                  <span className="orders-card__price" title={pendingTableItems > 0 ? 'Valor dos itens prontos' : 'Valor a receber'}>{formatCurrency(totalVal)}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => handleQuickPrintOrder(order, e)}
                                    className="orders-card__icon"
                                    title="Imprimir pré-conta / conferência"
                                    aria-label={`Imprimir conferência da ${presentation.title}`}
                                  >
                                    <Printer size={12} />
                                  </button>
                                </div>
                              </div>

                              {pendingTableItems > 0 && (
                                <div className={clsx('flex', 'items-center', 'gap-2', 'rounded-lg', 'border', 'border-koma-warning-border', 'bg-koma-warning-bg', 'px-2.5', 'py-2', 'text-[11px]', 'font-semibold', 'text-koma-warning-text')}>
                                  <Clock size={13} className="shrink-0" />
                                  <span>
                                    {pendingTableItems === 1 ? 'Outro item continua em preparo.' : `Outros ${pendingTableItems} itens continuam em preparo.`}
                                  </span>
                                </div>
                              )}

                              {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion)}

                              <button
                                type="button"
                                disabled={isLoading}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (isLoading) return;
                                  
                                  const tableComandas = orders.filter(
                                    o => Number(o.mesaId) === Number(order.mesaId)
                                      && isTableCheckoutOrder(o)
                                  );
                                  const checkoutOrder = buildTableCheckoutOrder(tableComandas);
                                  if (!checkoutOrder) return;

                                  const readyItemIds = checkoutOrder.itens
                                    .filter(item => !item.pago && isItemReadyForCheckout(item))
                                    .map(item => item.id);
                                  setSelectedOrder(checkoutOrder);
                                  setShowCheckoutModal(true);
                                  setCheckoutServiceTax(true);
                                  setSplitPeople('1');
                                  setSelectedItemIds(readyItemIds);
                                  setSmartPosRecoveryError('');
                                  const readyTotal = readyItemIds.length > 0
                                    ? getSelectedItemsTotal(checkoutOrder, readyItemIds, true)
                                    : 0;
                                  setPaymentValor(readyTotal > 0 ? readyTotal : '');
                                }}
                                className={clsx('orders-card__action', 'w-full', 'py-2', 'px-3', 'h-8', 'sm:h-9', 'font-bold', 'text-xs', 'sm:text-sm', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'flex', 'items-center', 'justify-center', 'gap-1.5')}
                              >
                                {smartPosState?.blocksPayment ? (
                                  <><Smartphone size={13} /><span>{smartPosState.ctaLabel}</span></>
                                ) : (
                                  <><Check size={13} /><span>{pendingTableItems > 0 ? 'Receber itens prontos' : 'Abrir pagamento'}</span></>
                                )}
                              </button>
                            </div>
                          );
                        })}

                        {/* 2. Delivery/Retirada em trânsito (aguardando retorno/pagamento) */}
                        {filteredDeliveryFinalization.map((order) => {
                          const cardId = `transito-${order.id}`;
                          const sla = getOrderSlaData(order, nowTimestamp);
                          const isExpanded = !!expandedCardIds[cardId];
                          const isDeliveryOrder = order.modalidade === 'delivery';
                          const badgeText = order.pago
                            ? 'PAGO'
                            : deliveryStatusLabel(order.status, order.modalidade).toUpperCase();

                          return (
                            <div 
                              key={`transito-${order.id}`} 
                              onClick={() => openDeliveryOrderDetails(order)}
                              onKeyDown={(event) => {
                                if (event.target !== event.currentTarget) return;
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openDeliveryOrderDetails(order);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              aria-label={`${order.isQuickSale ? 'Venda rápida' : order.modalidade} pedido ${humanOrderNumber(order)}, ver detalhes`}
                              className={clsx(
                                'orders-card orders-card--closing rounded-xl p-2.5 sm:p-3 space-y-2 text-left cursor-pointer',
                                order.isQuickSale && 'orders-card--quick-sale',
                                sla.borderTopClass
                              )}
                            >
                              <div className="orders-card__identity">
                                <div className={clsx('orders-card__number', order.isQuickSale && 'is-quick-sale')}>
                                  {order.isQuickSale ? <Smartphone size={15} /> : <Globe size={15} />}
                                  <strong>#{humanOrderNumber(order)}</strong>
                                </div>
                                <div className="min-w-0">
                                  <strong className="orders-card__identity-title">
                                    {order.isQuickSale ? 'Venda rápida' : order.cliente}
                                  </strong>
                                  <span className="orders-card__identity-subtitle">
                                    {order.isQuickSale
                                      ? `Retirada no balcão · ${order.quantidadeItens} ${order.quantidadeItens === 1 ? 'item' : 'itens'}`
                                      : `${isDeliveryOrder ? 'Delivery' : 'Retirada'}${order.telefone ? ` · ${order.telefone}` : ''}`}
                                  </span>
                                  <div className="orders-card__identity-chips">
                                    <span className={clsx('orders-card__chip', sla.badgeClass)}>{sla.label}</span>
                                    <span className={clsx('orders-card__chip', 'is-primary')}>{badgeText}</span>
                                    <span className={clsx('orders-card__chip', 'is-muted')}>{operationalOriginLabel(order.origemOperacional)}</span>
                                  </div>
                                </div>
                                <div className="orders-card__identity-side">
                                  <span className="orders-card__price">{formatCurrency(order.total)}</span>
                                  <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={(e) => handleQuickPrintOrder(order, e)}
                                    className="orders-card__icon"
                                    title="Imprimir pré-conta / conferência"
                                    aria-label={`Imprimir conferência do pedido ${humanOrderNumber(order)}`}
                                  >
                                    <Printer size={12} />
                                  </button>
                                  </div>
                                </div>
                              </div>

                              {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion)}

                              {isDeliveryOrder && order.endereco && (
                                <span className={clsx('font-normal', 'text-xs', 'text-koma-subtle', 'flex', 'items-center', 'gap-1', 'truncate')}>
                                  <MapPin size={11} className={clsx('shrink-0', 'text-emerald-600 dark:text-emerald-300/80')} />
                                  <span className="truncate">{order.endereco}</span>
                                </span>
                              )}

                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (isLoading) return;
                                  if (order.pago) {
                                    await handleFecharDelivery(order.id);
                                    return;
                                  }
                                  const fullOrder = orders.find(o => o.id === order.id);
                                  if (fullOrder) {
                                    const mappedOrder: Order = {
                                      ...fullOrder,
                                      deliveryStatus: (order.status === 'analise' ? 'pendente' : order.status) as Order['deliveryStatus'],
                                      itens: fullOrder.itens.map((item: any) => ({
                                        id: item.id,
                                        produtoId: item.produto_id || item.produtoId,
                                        nome: item.nome || `Item ${item.produtoId}`,
                                        preco: item.preco_unit || item.preco,
                                        observacao: item.observacao || '',
                                        clienteNome: item.cliente_nome || item.clienteNome || 'Consumo Geral',
                                        status: (item.status === 'preparando' && ['pronto', 'transito', 'saiu_para_entrega'].includes(order.status)) ? 'pronto' : item.status,
                                        pago: item.pago
                                      }))
                                    };
                                    const activeUnpaidItemIds = mappedOrder.itens
                                      .filter((item: any) => !item.pago && (item.status as string) !== 'cancelado')
                                      .map((item: any) => item.id);
                                    setSelectedOrder(mappedOrder);
                                    setShowCheckoutModal(true);
                                    setCheckoutServiceTax(false);
                                    setSplitPeople('1');
                                    setSelectedItemIds(activeUnpaidItemIds);
                                    const sub = mappedOrder.itens
                                      .filter((item: any) => !item.pago && (item.status as string) !== 'cancelado')
                                      .reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
                                    setPaymentValor(sub);
                                  } else {
                                    handleFinalizarPedido(order.id);
                                  }
                                }}
                                className={clsx('orders-card__action', 'w-full', 'py-2', 'px-3', 'h-8', 'sm:h-9', 'font-bold', 'text-xs', 'sm:text-sm', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'flex', 'items-center', 'justify-center', 'gap-1.5')}
                              >
                                <Check size={13} /><span>{order.pago ? 'Finalizar pedido' : 'Receber e finalizar'}</span>
                              </button>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* VIEW 2: PDV (Pedidos Balcão) */}
          {activeSubTab === 'balcao' && (
            <div className={clsx('orders-workspace', 'h-full', 'min-h-0', 'flex', 'flex-col', 'gap-3', 'sm:gap-4')}>
              <OperationalBanner
                id="counter-heading"
                eyebrow="VENDA"
                title="Novo pedido"
                accent="rápido e simples"
                description="Clique para adicionar. Passe o mouse ou use o ícone de detalhes para conferir ingredientes."
                metrics={pdvMenuInsights.pausedCount > 0 ? [
                  { label: 'destino', value: pdvMenuInsights.destination },
                  { label: 'itens', value: pdvMenuInsights.itemCount },
                  { label: 'total', value: pdvMenuInsights.total },
                  { label: pdvMenuInsights.pausedCount === 1 ? 'pausado' : 'pausados', value: pdvMenuInsights.pausedCount, valueClassName: 'text-amber-600 dark:text-amber-300' },
                ] : [
                  { label: 'destino', value: pdvMenuInsights.destination },
                  { label: 'itens', value: pdvMenuInsights.itemCount },
                  { label: 'total', value: pdvMenuInsights.total },
                ]}
              />

              <div className={clsx('min-h-0', 'flex-1', 'flex', 'flex-col', 'xl:flex-row', 'gap-3', 'sm:gap-4', 'overflow-hidden', 'relative')}>

              {/* Mobile sub-tab toggle */}
              <div className={clsx('flex', 'xl:hidden', 'gap-1', 'p-1', 'bg-white/[0.025]', 'border', 'border-koma-border', 'rounded-xl', 'shrink-0')}>
                <button
                  type="button"
                  onClick={() => setBalcaoMobileView('produtos')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    balcaoMobileView === 'produtos'
                      ? 'bg-emerald-600 text-white'
                      : 'text-koma-muted hover:text-koma-foreground'
                  }`}
                >
                  <Package size={14} />
                  <span>Escolher itens</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBalcaoMobileView('carrinho')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    balcaoMobileView === 'carrinho'
                      ? 'bg-emerald-600 text-white'
                      : 'text-koma-muted hover:text-koma-foreground'
                  }`}
                >
                  <ShoppingCart size={14} />
                  <span>Carrinho ({pdvCartItemCount})</span>
                </button>
              </div>

              {/* Product grid column */}
              <div className={`min-w-0 flex-1 ${balcaoMobileView === 'produtos' ? 'flex' : 'hidden xl:flex'} flex-col gap-3 overflow-hidden w-full`}>
                <div className={clsx('shrink-0', 'rounded-2xl', 'border', 'border-koma-border', 'bg-koma-panel', 'p-2.5', 'sm:p-3', 'space-y-2.5')}>
                  <div className="relative">
                    <Search size={15} className={clsx('absolute', 'left-3.5', 'top-1/2', '-translate-y-1/2', 'text-koma-muted')} />
                    <input
                      id="pdv-product-search-input"
                      type="text"
                      placeholder="Buscar item, descrição ou código"
                      value={pdvSearch}
                      onChange={(e) => setPdvSearch(e.target.value)}
                      className={clsx('w-full', 'bg-koma-input', 'border', 'border-koma-border', 'focus:border-emerald-500/60', 'text-koma-foreground', 'placeholder:text-koma-muted', 'rounded-xl', 'py-2.5', 'pl-10', 'pr-8', 'text-xs', 'outline-none', 'transition-all')}
                    />
                    {pdvSearch && (
                      <button
                        type="button"
                        onClick={() => setPdvSearch('')}
                        className={clsx('absolute', 'right-3', 'top-1/2', '-translate-y-1/2', 'text-koma-muted', 'hover:text-koma-foreground', 'p-1', 'rounded-lg')}
                        aria-label="Limpar busca de itens"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  <div className={clsx('flex', 'min-w-0', 'items-center', 'gap-1.5')}>
                    {pdvCategoryScrollState.hasOverflow && (
                      <button
                        type="button"
                        onClick={() => scrollPdvCategories(-1)}
                        disabled={!pdvCategoryScrollState.canScrollLeft}
                        aria-label="Ver categorias anteriores"
                        className={clsx('hidden', 'size-8', 'shrink-0', 'items-center', 'justify-center', 'rounded-lg', 'border', 'border-koma-border', 'bg-koma-panel', 'text-koma-muted', 'hover:text-koma-foreground', 'hover:bg-koma-raised', 'disabled:cursor-not-allowed', 'disabled:opacity-25', 'sm:flex')}
                      >
                        <ChevronLeft size={15} />
                      </button>
                    )}
                    <div
                      ref={pdvCategoryScrollRef}
                      onScroll={updatePdvCategoryScrollState}
                      onWheel={handlePdvCategoryWheel}
                      onPointerDown={handlePdvCategoryPointerDown}
                      onPointerMove={handlePdvCategoryPointerMove}
                      onPointerUp={finishPdvCategoryDrag}
                      onPointerCancel={finishPdvCategoryDrag}
                      onClickCapture={(event) => {
                        if (!pdvCategorySuppressClickRef.current) return;
                        event.preventDefault();
                        event.stopPropagation();
                        pdvCategorySuppressClickRef.current = false;
                      }}
                      className={clsx('flex', 'min-w-0', 'flex-1', 'cursor-grab', 'select-none', 'items-center', 'gap-1.5', 'overflow-x-auto', 'pb-0.5', 'active:cursor-grabbing', '[scrollbar-width:none]', '[&::-webkit-scrollbar]:hidden')}
                      aria-label="Filtrar por categoria"
                    >
                    <button
                      type="button"
                      onClick={() => { setPdvSelectedCategory('todos'); setPdvProductDetailId(null); }}
                      className={`h-8 px-3 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors border ${pdvSelectedCategory === 'todos'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : 'bg-transparent border-koma-border text-koma-muted hover:text-koma-foreground hover:bg-koma-raised'
                        }`}
                    >
                      Todos <span className={clsx('ml-1', 'opacity-75')}>{sellableProducts.length}</span>
                    </button>
                    {pdvCategories.map(catObj => (
                      <button
                        key={catObj.id || catObj.nome}
                        type="button"
                        onClick={() => { setPdvSelectedCategory(catObj.nome); setPdvProductDetailId(null); }}
                        className={`h-8 px-3 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors border ${pdvSelectedCategory === catObj.nome
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-transparent border-koma-border text-koma-muted hover:text-koma-foreground hover:bg-koma-raised'
                          }`}
                      >
                        {catObj.nome}
                      </button>
                    ))}
                    </div>
                    {pdvCategoryScrollState.hasOverflow && (
                      <button
                        type="button"
                        onClick={() => scrollPdvCategories(1)}
                        disabled={!pdvCategoryScrollState.canScrollRight}
                        aria-label="Ver próximas categorias"
                        className={clsx('hidden', 'size-8', 'shrink-0', 'items-center', 'justify-center', 'rounded-lg', 'border', 'border-koma-border', 'bg-koma-panel', 'text-koma-muted', 'hover:text-koma-foreground', 'hover:bg-koma-raised', 'disabled:cursor-not-allowed', 'disabled:opacity-25', 'sm:flex')}
                      >
                        <ChevronRight size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div className={clsx('flex-1', 'min-h-0', 'overflow-y-auto', 'pr-1', 'overscroll-contain')}>
                  {filteredProducts.length > 0 ? (
                  <div className={clsx('grid', 'grid-cols-2', 'sm:grid-cols-2', 'md:grid-cols-3', '2xl:grid-cols-4', 'gap-2', 'sm:gap-2.5', 'pb-2')}>
                    {filteredProducts.map((p) => {
                      const productLabel = splitProductLabel(p.nome);
                      const productDetailKey = String(p.id);
                      const hasProductDetails = Boolean(p.descricao || productLabel.code);
                      return (
                        <div
                          key={p.id}
                          className={clsx(
                            'group', 'relative', 'min-h-[96px]', 'sm:min-h-[112px]',
                            'bg-koma-panel', 'border', 'border-koma-border', 'hover:border-emerald-500/60',
                            'rounded-xl', 'sm:rounded-2xl', 'transition-colors', 'shadow-sm'
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setPdvProductDetailId(null);
                              handlePdvAddToCart(p);
                            }}
                            className={clsx(
                              'flex', 'h-full', 'w-full', 'flex-col', 'justify-between', 'gap-2', 'sm:gap-3',
                              'p-2.5', 'sm:p-3.5', 'text-left', 'cursor-pointer', 'rounded-xl', 'sm:rounded-2xl',
                              'focus:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-emerald-500/40'
                            )}
                            title={hasProductDetails
                              ? `Adicionar ${productLabel.name}. Use detalhes para ver ingredientes.`
                              : `Adicionar ${productLabel.name}`}
                          >
                            {p.imagem && (
                              <img src={p.imagem} alt="" loading="lazy" className={clsx('w-full', 'h-16', 'sm:h-20', 'object-cover', 'rounded-lg', 'sm:rounded-xl')} />
                            )}
                            <div className="min-h-[28px] sm:min-h-[34px] pr-6">
                              <h4 className={clsx('font-semibold', 'text-koma-foreground', 'text-xs', 'sm:text-[13px]', 'leading-snug', 'line-clamp-2')}>
                                {productLabel.name}
                              </h4>
                            </div>
                            <div className={clsx('flex', 'justify-between', 'items-center', 'border-t', 'border-koma-border', 'pt-2', 'sm:pt-2.5')}>
                              <span className={clsx('font-bold', 'text-emerald-700 dark:text-emerald-400', 'font-mono', 'text-xs')}>
                                R$ {p.preco.toFixed(2).replace('.', ',')}
                              </span>
                              <span className={clsx('inline-flex', 'items-center', 'gap-1', 'text-[9px]', 'font-bold', 'text-emerald-700 dark:text-[#4fe0bc]')}>
                                <Plus size={13} /> <span className="hidden min-[380px]:inline">Adicionar</span>
                              </span>
                            </div>
                          </button>

                          {hasProductDetails && (
                            <>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPdvProductDetailId(current => current === productDetailKey ? null : productDetailKey);
                                }}
                                aria-expanded={pdvProductDetailId === productDetailKey}
                                aria-controls={`pdv-product-details-${productDetailKey}`}
                                aria-label={`Ver ingredientes e detalhes de ${productLabel.name}`}
                                title="Ver ingredientes e detalhes"
                                className={clsx(
                                  'absolute', 'right-2', 'top-2', 'z-20', 'flex', 'size-7', 'items-center', 'justify-center',
                                  'rounded-lg', 'border', 'border-koma-border', 'bg-koma-card/95', 'text-koma-muted',
                                  'hover:border-emerald-500/40', 'hover:text-emerald-700', 'dark:hover:text-emerald-300'
                                )}
                              >
                                <Info size={13} />
                              </button>
                              <div
                                id={`pdv-product-details-${productDetailKey}`}
                                role="note"
                                className={clsx(
                                  'pointer-events-none', 'absolute', 'inset-x-2', 'top-10', 'z-10',
                                  'rounded-xl', 'border', 'border-koma-border', 'bg-koma-dialog/95', 'backdrop-blur-md',
                                  'p-2.5', 'text-left', 'shadow-xl', 'translate-y-1', 'opacity-0', 'transition-all',
                                  'group-hover:translate-y-0', 'group-hover:opacity-100',
                                  pdvProductDetailId === productDetailKey && 'translate-y-0 opacity-100'
                                )}
                              >
                                <span className={clsx('block', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-wider', 'text-emerald-700 dark:text-emerald-300')}>
                                  Ingredientes e detalhes
                                </span>
                                {productLabel.code && (
                                  <span className={clsx('mt-1', 'block', 'font-mono', 'text-[8px]', 'text-koma-muted')}>
                                    Cód. {productLabel.code}
                                  </span>
                                )}
                                <p className={clsx('mt-1', 'text-[10px]', 'leading-relaxed', 'text-koma-secondary')}>
                                  {p.descricao || 'Sem descrição cadastrada.'}
                                </p>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  ) : (
                    <div className={clsx('h-full', 'min-h-52', 'rounded-2xl', 'border', 'border-dashed', 'border-koma-border', 'bg-white/[0.015]', 'flex', 'flex-col', 'items-center', 'justify-center', 'text-center', 'px-6')}>
                      <Search size={22} className={clsx('text-koma-muted', 'mb-3')} />
                      <strong className={clsx('text-sm', 'text-koma-secondary')}>
                        {catalogReady ? 'Nenhum item encontrado' : 'Carregando cardápio…'}
                      </strong>
                      <span className={clsx('mt-1', 'text-[10px]', 'text-koma-muted')}>
                        {catalogReady && pdvSearch ? 'Tente buscar por outro nome ou escolha outra categoria.' : catalogReady ? 'Cadastre ou ative itens na área Cardápio.' : 'Os itens aparecerão aqui em instantes.'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Shopping cart sidebar */}
              <div className={`w-full xl:w-[350px] 2xl:w-[380px] bg-koma-panel border border-koma-border rounded-2xl ${balcaoMobileView === 'carrinho' ? 'flex' : 'hidden xl:flex'} ${pdvCart.length === 0 ? 'xl:self-start' : ''} flex-col overflow-hidden shrink-0 shadow-sm`}>
                <div className={clsx('bg-koma-raised', 'px-4', 'py-3.5', 'border-b', 'border-koma-border', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                  <span className={clsx('font-semibold', 'text-koma-foreground', 'flex', 'items-center', 'gap-2')}>
                    <span className={clsx('w-8', 'h-8', 'rounded-xl', 'bg-emerald-500/15', 'border', 'border-emerald-500/30', 'inline-flex', 'items-center', 'justify-center')}><ShoppingCart size={15} className="text-emerald-700 dark:text-emerald-400" /></span>
                    <span>Pedido atual</span>
                  </span>
                  <span className={clsx('bg-emerald-500/15', 'border', 'border-emerald-500/30', 'text-emerald-800 dark:text-emerald-300', 'font-bold', 'px-2.5', 'py-1', 'rounded-full', 'font-mono', 'text-[9px]')}>
                    {pdvCartItemCount} itens
                  </span>
                </div>

                <div className={clsx('flex-1', 'overflow-y-auto', 'p-3', 'space-y-2')}>
                  {pdvCart.length === 0 ? (
                    <div className={clsx('h-full', 'min-h-44', 'flex', 'flex-col', 'items-center', 'justify-center', 'text-center', 'px-6', 'text-koma-muted')}>
                      <ShoppingCart size={22} className={clsx('mb-3', 'opacity-60')} />
                      <p className={clsx('text-xs', 'font-semibold', 'text-koma-subtle')}>Comece escolhendo um item</p>
                      <p className={clsx('text-[9px]', 'mt-1')}>Selecione um item para montar o pedido.</p>
                    </div>
                  ) : (
                    pdvCart.map((item, idx) => (
                      <div key={`${item.product.id}-${idx}`} className={clsx('bg-white/[0.025]', 'p-3', 'rounded-xl', 'border', 'border-koma-border-subtle', 'space-y-2.5')}>
                        <div className={clsx('flex', 'justify-between', 'items-start')}>
                          <div className="space-y-0.5">
                            <strong className={clsx('text-koma-foreground', 'text-xs', 'block', 'truncate', 'max-w-48')}>{item.product.nome}</strong>
                            <span className={clsx('text-[9px]', 'text-[#4fe0bc]', 'font-mono')}>R$ {item.product.preco.toFixed(2).replace('.', ',')} / un.</span>
                          </div>
                          <button
                            onClick={() => handlePdvRemoveCartItem(idx)}
                            className={clsx('text-koma-muted', 'hover:text-rose-500', 'p-0.5', 'cursor-pointer')}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        <div className={clsx('flex', 'justify-between', 'items-center')}>
                          <div className={clsx('flex', 'items-center', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-lg', 'overflow-hidden')}>
                            <button
                              type="button"
                              onClick={() => handlePdvUpdateCartQty(idx, -1)}
                              className={clsx('px-2', 'py-1', 'text-koma-subtle', 'hover:text-koma-foreground', 'cursor-pointer', 'hover:bg-koma-raised')}
                            >
                              -
                            </button>
                            <span className={clsx('px-2', 'text-[10px]', 'font-bold', 'font-mono', 'text-koma-foreground')}>{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => handlePdvUpdateCartQty(idx, 1)}
                              className={clsx('px-2', 'py-1', 'text-koma-subtle', 'hover:text-koma-foreground', 'cursor-pointer', 'hover:bg-koma-raised')}
                            >
                              +
                            </button>
                          </div>
                          <input
                            type="text"
                            placeholder="Obs..."
                            value={item.obs}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPdvCart(prev => {
                                const c = [...prev];
                                c[idx].obs = val;
                                return c;
                              });
                            }}
                            className={clsx('w-24', 'px-1.5', 'py-1', 'text-[9px]', 'bg-koma-input', 'border', 'border-koma-border', 'rounded', 'focus:outline-none', 'focus:border-[#10b981]', 'text-koma-foreground')}
                          />
                        </div>

                        {/* Presets de Observação Dinâmicos do Terminal Balcão */}
                        {(() => {
                          const presets = getProductPresets(item.product);
                          if (presets.length === 0) return null;
                          const parts = item.obs ? item.obs.split(',').map(p => p.trim()) : [];
                          return (
                            <div className={clsx('flex', 'flex-wrap', 'gap-1', 'mt-2', 'justify-end')}>
                              {presets.map(preset => {
                                const isActive = parts.some(p => p.toLowerCase() === preset.toLowerCase());
                                return (
                                  <button
                                    key={preset}
                                    type="button"
                                    onClick={() => {
                                      const currentParts = item.obs ? item.obs.split(',').map(p => p.trim()) : [];
                                      const exists = currentParts.some(p => p.toLowerCase() === preset.toLowerCase());
                                      const updatedParts = exists
                                        ? currentParts.filter(p => p.toLowerCase() !== preset.toLowerCase() && p !== '')
                                        : [...currentParts.filter(p => p !== ''), preset];
                                      
                                      const updatedObs = updatedParts.join(', ');
                                      setPdvCart(prev => {
                                        const c = [...prev];
                                        c[idx].obs = updatedObs;
                                        return c;
                                      });
                                    }}
                                    className={`px-1.5 py-0.5 text-[8px] rounded border transition-colors cursor-pointer font-medium ${
                                      isActive
                                        ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                                        : 'bg-koma-raised hover:bg-emerald-600/25 text-koma-subtle hover:text-white border-koma-border'
                                    }`}
                                  >
                                    {isActive ? preset : `+${preset}`}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    ))
                  )}
                </div>

                {/* Subtotal e formulário de dados do cliente / modalidade */}
                <form
                  onSubmit={handlePdvSubmitOrder}
                  className={clsx('p-3', 'border-t', 'border-koma-border', 'space-y-3', 'bg-koma-panel/40', 'shrink-0')}
                >
                  <div className="space-y-1.5">
                    <label className={clsx('text-[8px]', 'text-koma-subtle', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Modalidade:</label>
                    <div className={clsx('grid', 'grid-cols-3', 'gap-1', 'bg-koma-input', 'p-1', 'rounded-xl', 'border', 'border-koma-border')}>
                      {[
                        { id: 'retirada', label: 'Retirada / Viagem' },
                        { id: 'entrega', label: 'Delivery' },
                        { id: 'mesa', label: 'Mesa' }
                      ].map(type => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => setPdvOrderType(type.id as any)}
                          className={`py-1.5 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer ${pdvOrderType === type.id
                            ? 'bg-[#10b981] text-zinc-950 font-extrabold'
                            : 'text-koma-subtle hover:text-koma-foreground'
                            }`}
                        >
                          {type.id === 'retirada' ? 'Retirada' : type.id === 'entrega' ? 'Delivery' : 'Mesa'}
                        </button>
                      ))}
                    </div>
                    <details className="mt-1 text-left text-[9px] text-koma-muted">
                      <summary className="w-fit cursor-pointer list-none font-semibold hover:text-koma-secondary">Ver atalhos de teclado</summary>
                      <span className="mt-1 block font-mono">F2 Retirada · F3 Mesa · F8 Delivery · F4 Finalizar</span>
                    </details>
                  </div>

                  {pdvOrderType === 'mesa' && (
                    <div className="space-y-2">
                      <div className={clsx('flex', 'items-center', 'justify-between', 'gap-3')}>
                        <label htmlFor="pdv-target-table" className={clsx('block', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-wider', 'text-koma-subtle')}>
                          Mesa de destino
                        </label>
                        <span className={clsx('text-[8px]', 'text-koma-muted')}>
                          {pdvOccupiedTableCount} em atendimento
                        </span>
                      </div>
                      <select
                        id="pdv-target-table"
                        value={pdvTargetMesaId || ''}
                        onChange={(e) => setPdvTargetMesaId(Number(e.target.value) || 0)}
                        aria-describedby="pdv-table-selection-help"
                        data-table-status={selectedPdvTableOption?.isOccupied ? 'occupied' : selectedPdvTableOption ? 'free' : 'unselected'}
                        className={clsx(
                          'min-h-10 w-full rounded-xl border px-3 text-[10px] font-semibold text-koma-foreground outline-none transition-colors focus:ring-2',
                          selectedPdvTableOption?.isOccupied
                            ? 'border-[#6b2d37] bg-[#1b1013] focus:border-[#8a3d49] focus:ring-[#6b2d37]/20'
                            : 'border-koma-border bg-koma-input focus:border-[#00b894]/70 focus:ring-[#00b894]/10'
                        )}
                        required
                      >
                        <option value="">Selecione uma mesa</option>
                        {pdvTableOptions.map(option => (
                          <option
                            key={option.table.id}
                            value={option.table.id}
                            data-table-status={option.isOccupied ? 'occupied' : 'free'}
                            style={{
                              backgroundColor: option.isOccupied ? '#1b1013' : '#090d0b',
                              color: option.isOccupied ? '#e4a3ac' : '#d4d4d8',
                            }}
                          >
                            {option.isOccupied ? '●' : '○'} {option.label}
                            {option.table.nome ? ` · Mesa ${option.table.id}` : ''}
                            {option.isOccupied
                              ? ` · em atendimento${option.total > 0 ? ` · R$ ${option.total.toFixed(2).replace('.', ',')}` : ''}`
                              : ' · livre'}
                          </option>
                        ))}
                      </select>

                      <div
                        id="pdv-table-selection-help"
                        className={clsx(
                          'flex min-h-10 items-center gap-2.5 rounded-xl border px-3 py-2 text-left',
                          selectedPdvTableOption?.isOccupied
                            ? 'border-rose-300 dark:border-[#6b2d37]/80 bg-rose-50/90 dark:bg-[#261317]'
                            : 'border-koma-border bg-koma-input'
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={clsx(
                            'h-2 w-2 shrink-0 rounded-full',
                            selectedPdvTableOption?.isOccupied
                              ? 'bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.2)]'
                              : selectedPdvTableOption
                                ? 'bg-emerald-500'
                                : 'bg-koma-muted'
                          )}
                        />
                        <div className="min-w-0">
                          <strong className={clsx(
                            'block text-[9px] font-semibold',
                            selectedPdvTableOption?.isOccupied ? 'text-rose-800 dark:text-[#e4a3ac]' : 'text-koma-foreground'
                          )}>
                            {!selectedPdvTableOption
                              ? 'Escolha onde este pedido será lançado'
                              : selectedPdvTableOption.isOccupied
                                ? `${selectedPdvTableOption.label} já está em atendimento`
                                : `${selectedPdvTableOption.label} está livre`}
                          </strong>
                          <span className={clsx('mt-0.5', 'block', 'text-[8px]', 'leading-relaxed', 'text-koma-muted')}>
                            {selectedPdvTableOption?.isOccupied
                              ? 'Você pode continuar: os novos itens serão adicionados ao atendimento da mesa.'
                              : selectedPdvTableOption
                                ? 'O primeiro lançamento abrirá o atendimento automaticamente.'
                                : 'Mesas ocupadas continuam disponíveis e aparecem identificadas na lista.'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {(pdvOrderType === 'retirada' || pdvOrderType === 'entrega') && (
                    <div className="space-y-2">
                      <div className={clsx('grid', 'grid-cols-2', 'gap-2')}>
                        <div className="space-y-1">
                          <label className={clsx('text-[8px]', 'text-koma-subtle', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Telefone:</label>
                          <input
                            id="pdv-customer-phone-input"
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel"
                            placeholder="(00) 00000-0000"
                            required={pdvCart.length > 0}
                            value={pdvCustomerPhone}
                            onChange={(e) => {
                              setPdvCustomerPhone(aplicarMascaraTelefoneInput(e.target.value));
                              setPdvCustomerId(null);
                            }}
                            className={clsx('w-full', 'px-2', 'py-1.5', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-lg', 'focus:outline-none', 'text-koma-foreground', 'text-[10px]')}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className={clsx('text-[8px]', 'text-koma-subtle', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Nome Cliente:</label>
                          <input
                            id="pdv-customer-name-input"
                            type="text"
                            autoComplete="name"
                            placeholder="Ex: Maria"
                            required={pdvCart.length > 0}
                            value={pdvCustomerName}
                            onChange={(e) => setPdvCustomerName(e.target.value)}
                            className={clsx('w-full', 'px-2', 'py-1.5', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-lg', 'focus:outline-none', 'text-koma-foreground', 'text-[10px]')}
                          />
                        </div>
                      </div>
                      {pdvCustomerLookup !== 'idle' && (
                        <p className={clsx(
                          'text-[8px]',
                          'font-bold',
                          pdvCustomerLookup === 'found' ? 'text-emerald-400' : 'text-koma-muted',
                        )}>
                          {pdvCustomerLookup === 'loading' && 'Buscando cliente...'}
                          {pdvCustomerLookup === 'found' && 'Cliente encontrado — nome e endereço preenchidos automaticamente.'}
                          {pdvCustomerLookup === 'new' && 'Novo número — o cliente será criado ao lançar o pedido.'}
                        </p>
                      )}
                      {pdvOrderType === 'entrega' && (
                        <div className="space-y-1">
                          <label className={clsx('text-[8px]', 'text-koma-subtle', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Endereço:</label>
                          <input
                            type="text"
                            placeholder="Rua, Número, Bairro"
                            required
                            value={pdvDeliveryAddress}
                            onChange={(e) => setPdvDeliveryAddress(e.target.value)}
                            className={clsx('w-full', 'px-2', 'py-1.5', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-lg', 'focus:outline-none', 'text-koma-foreground', 'text-[10px]')}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className={clsx('flex', 'justify-between', 'items-center', 'font-mono', 'border-t', 'border-koma-border', 'pt-2', 'text-[11px]', 'font-bold', 'text-koma-foreground')}>
                    <span>Total Pedido:</span>
                    <span className={clsx('text-emerald-700 dark:text-emerald-400', 'text-sm')}>
                      {formatCurrency(pdvCart.reduce((sum, item) => sum + (item.product.preco * item.quantity), 0))}
                    </span>
                  </div>

                  <button
                    id="pdv-submit-btn"
                    type="submit"
                    disabled={pdvCart.length === 0 || isLoading}
                    className={clsx('w-full', 'min-h-11', 'py-2', 'bg-[#00b894]', 'hover:bg-[#13c9a0]', 'text-[#06110d]', 'rounded-xl', 'border', 'border-transparent', 'font-bold', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer', 'flex', 'flex-col', 'items-center', 'justify-center', 'gap-0.5', 'disabled:cursor-not-allowed', 'disabled:border-[#272c29]', 'disabled:bg-koma-card', 'disabled:text-zinc-600')}
                  >
                    <div className={clsx('flex', 'items-center', 'gap-1')}>
                      <Check size={12} />
                      <span>Lançar Pedido</span>
                    </div>
                    <span className={clsx('text-[7.5px]', 'text-emerald-600 dark:text-emerald-300/80', 'font-mono', 'font-normal')}>Pressione [F4] para finalizar</span>
                  </button>
                </form>
              </div>

              {/* Floating Bottom Bar on Mobile when on Products tab */}
              {pdvCart.length > 0 && balcaoMobileView === 'produtos' && (
                <button
                  type="button"
                  onClick={() => setBalcaoMobileView('carrinho')}
                  className={clsx('xl:hidden', 'fixed', 'bottom-4', 'left-4', 'right-4', 'z-40', 'py-3', 'px-5', 'bg-[#00b894]', 'hover:bg-[#13c9a0]', 'text-[#06110d]', 'font-bold', 'rounded-2xl', 'shadow-2xl', 'flex', 'items-center', 'justify-between', 'border', 'border-[#4fe0bc]/30', 'animate-fade-in', 'cursor-pointer')}
                >
                  <span className={clsx('text-xs', 'flex', 'items-center', 'gap-2')}>
                    <ShoppingCart size={16} />
                    <span>{pdvCartItemCount} itens no carrinho</span>
                  </span>
                  <span className={clsx('text-xs', 'font-mono', 'font-extrabold', 'bg-black/30', 'px-3', 'py-1', 'rounded-xl')}>
                    {formatCurrency(pdvCart.reduce((sum, item) => sum + (item.product.preco * item.quantity), 0))} →
                  </span>
                </button>
              )}

              </div>
            </div>
          )}

          {/* VIEW 3: MAPA DE MESAS (Salão) */}
          {activeSubTab === 'mesas' && (
            <div className={clsx('orders-workspace', 'flex', 'h-full', 'min-h-0', 'flex-col', 'gap-3')}>
              <OperationalBanner
                id="tables-heading"
                eyebrow="SALÃO"
                title="Mesas"
                accent="por situação"
                description="A cor e o texto de cada mesa mostram o que precisa acontecer agora."
                metrics={[
                  { label: 'ocupação', value: `${salonInsights.occupancy}%` },
                  { label: 'consumo em aberto', value: formatCompactCurrency(salonInsights.openValue) },
                  { label: 'maior atendimento', value: salonInsights.oldestService },
                ]}
              />

              <section className={clsx('flex', 'min-h-0', 'flex-1', 'flex-col', 'overflow-hidden', 'rounded-[22px]', 'border', 'border-koma-border', 'bg-koma-panel')}>
                <div className={clsx('flex', 'flex-col', 'gap-2', 'border-b', 'border-koma-border', 'px-3', 'py-3', 'sm:flex-row', 'sm:items-center', 'sm:justify-between', 'sm:px-4')}>
                  <div className={clsx('flex', 'w-full', 'min-w-0', 'max-w-full', 'gap-1', 'overflow-x-auto', 'overscroll-x-contain', 'rounded-xl', 'bg-koma-page', 'p-1.5', 'pr-3', '[scrollbar-width:none]', '[&::-webkit-scrollbar]:hidden')}>
                    {[
                      { id: 'all' as const, label: 'Todas', count: tableStatusCounts.all, dot: 'bg-zinc-500' },
                      { id: 'free' as const, label: 'Livres', count: tableStatusCounts.free, dot: 'bg-[#45b995]' },
                      { id: 'occupied' as const, label: 'Em atendimento', count: tableStatusCounts.occupied, dot: 'bg-koma-danger-text' },
                      { id: 'payment' as const, label: 'Para receber', count: tableStatusCounts.payment, dot: 'bg-amber-500' },
                    ].map(filter => (
                      <button
                        key={filter.id}
                        type="button"
                        aria-pressed={tableStatusFilter === filter.id}
                        onClick={() => setTableStatusFilter(filter.id)}
                        className={clsx(
                          'shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-bold transition-colors',
                          tableStatusFilter === filter.id
                            ? filter.id === 'occupied'
                              ? 'bg-koma-danger-bg text-koma-danger-text'
                              : filter.id === 'payment'
                                ? 'bg-amber-100 text-amber-900 dark:bg-[#46212a] dark:text-[#efb2bc]'
                                : filter.id === 'free'
                                  ? 'bg-emerald-100 text-emerald-900 dark:bg-[#123c31] dark:text-[#6ee7b7]'
                                  : 'bg-koma-raised text-koma-foreground border border-koma-border'
                            : 'text-koma-muted hover:bg-black/5 dark:hover:bg-white/[0.04] hover:text-koma-secondary'
                        )}
                      >
                        <span className={clsx('mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle', filter.dot)} aria-hidden="true" />
                        {filter.label} <span className={clsx('ml-1', 'font-mono', 'opacity-70')}>{filter.count}</span>
                      </button>
                    ))}
                    <span className="w-2 shrink-0" aria-hidden="true" />
                  </div>
                </div>

                <div className={clsx('min-h-0', 'flex-1', 'overflow-y-auto', 'p-3', 'sm:p-4')}>
                  {salonTableCards.length === 0 ? (
                    <div className={clsx('flex', 'min-h-56', 'items-center', 'justify-center', 'text-center')}>
                      {fetchError ? (
                        <div className={clsx('max-w-md', 'space-y-2', 'rounded-2xl', 'border', 'border-rose-900/40', 'bg-rose-950/15', 'p-5')}>
                          <AlertTriangle className={clsx('mx-auto', 'text-rose-400')} size={20} />
                          <strong className={clsx('block', 'text-sm', 'text-koma-foreground')}>Não foi possível carregar o salão</strong>
                          <p className={clsx('break-words', 'font-mono', 'text-[10px]', 'leading-relaxed', 'text-koma-subtle')}>{fetchError}</p>
                        </div>
                      ) : (
                        <div className={clsx('space-y-2', 'text-koma-muted')}>
                          <ClipboardList className={clsx('mx-auto', 'text-emerald-700 dark:text-emerald-400')} size={22} />
                          <strong className={clsx('block', 'text-sm', 'text-koma-secondary')}>Nenhuma mesa cadastrada</strong>
                          <p className="text-xs">Revise a configuração do salão antes de iniciar a operação.</p>
                        </div>
                      )}
                    </div>
                  ) : visibleSalonTableCards.length === 0 ? (
                    <div className={clsx('flex', 'min-h-56', 'items-center', 'justify-center', 'text-center', 'text-xs', 'text-koma-muted')}>
                      Nenhuma mesa neste filtro.
                    </div>
                  ) : (
                    <div className={clsx('grid', 'grid-cols-2', 'gap-2', 'sm:grid-cols-3', 'sm:gap-2.5', 'xl:grid-cols-4', '2xl:grid-cols-6')}>
                      {visibleSalonTableCards.map((card) => {
                        const { table, displayMesaId, tableOrders, isMerged, isOccupied, hasPendingPayment, total } = card;
                        const tableOrderNumbers = Array.from(new Set(
                          tableOrders
                            .flatMap(order => order.numeroPedidos?.length ? order.numeroPedidos : [order.numeroPedido])
                            .map(number => Number(number))
                            .filter(number => Number.isFinite(number) && number > 0)
                        ));
                        const originId = tableOrders.find(order => order.mesaOrigemId && Number(order.mesaOrigemId) !== Number(displayMesaId))?.mesaOrigemId;
                        const transferredFromId = tableOrders.find(order => order.mesaTransferidaDe && Number(order.mesaTransferidaDe) !== Number(displayMesaId))?.mesaTransferidaDe;
                        const statusLabel = isMerged
                          ? 'Mesclada'
                          : hasPendingPayment
                            ? 'Para receber'
                            : isOccupied
                              ? 'Em atendimento'
                              : 'Livre';

                        return (
                          <article
                            key={table.id}
                            data-table-status={isMerged ? 'merged' : hasPendingPayment ? 'payment' : isOccupied ? 'occupied' : 'free'}
                            className={clsx(
                              'group flex min-h-[106px] sm:min-h-[148px] flex-col justify-between gap-2 sm:gap-3 rounded-xl sm:rounded-2xl border p-2.5 sm:p-3.5 transition-colors shadow-sm',
                              isMerged && 'border-dashed border-koma-border bg-black/10 dark:bg-black/20 opacity-65',
                              hasPendingPayment && 'border-amber-300 dark:border-[#74404b] bg-amber-50/90 dark:bg-[#241419] hover:border-amber-500',
                              isOccupied && !hasPendingPayment && 'border-koma-danger-border bg-koma-danger-bg hover:border-koma-danger-text',
                              !isOccupied && !isMerged && 'koma-table-free-card'
                            )}
                          >
                            <div className={clsx('flex', 'items-start', 'justify-between', 'gap-2')}>
                              <div className="min-w-0">
                                <span className={clsx('block', 'font-mono', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-[0.2em]', 'text-koma-muted')}>Mesa</span>
                                <div className={clsx('mt-0.5', 'flex', 'items-baseline', 'gap-2')}>
                                  <strong className={clsx('text-xl sm:text-2xl', 'font-extrabold', 'leading-none', 'text-koma-foreground')}>{table.id}</strong>
                                  {table.nome && table.nome !== `Mesa ${table.id}` && (
                                    <span className={clsx('line-clamp-1', 'break-words', 'text-[10px]', 'font-semibold', 'text-koma-secondary')}>{table.nome}</span>
                                  )}
                                </div>
                              </div>
                              {tableOrderNumbers.length > 0 && (
                                <span
                                  className={clsx('shrink-0', 'rounded-lg', 'border', 'border-koma-border', 'bg-black/10', 'px-2', 'py-1', 'font-mono', 'text-[9px]', 'font-extrabold', 'text-koma-secondary')}
                                  title={`Pedido ${tableOrderNumbers.map(number => `#${number}`).join(' + ')}`}
                                >
                                  Pedido {tableOrderNumbers[0]}{tableOrderNumbers.length > 1 ? ` +${tableOrderNumbers.length - 1}` : ''}
                                </span>
                              )}
                            </div>

                            <div className="space-y-1.5 sm:space-y-2">
                              <div className={clsx('flex', 'flex-wrap', 'items-center', 'gap-1.5')}>
                                <span className={clsx(
                                  'rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider',
                                  isMerged && 'border-koma-border bg-koma-card text-koma-muted',
                                  hasPendingPayment && 'border-amber-300 dark:border-[#8a4753] bg-amber-100 dark:bg-[#4b222b] text-amber-900 dark:text-[#efb2bc]',
                                  isOccupied && !hasPendingPayment && 'koma-badge-danger',
                                  !isOccupied && !isMerged && 'border-emerald-300 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                                )}>
                                  <span
                                    className={clsx(
                                      'mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle',
                                      hasPendingPayment ? 'bg-amber-500' : isOccupied ? 'bg-koma-danger-text' : 'bg-emerald-500'
                                    )}
                                    aria-hidden="true"
                                  />
                                  {statusLabel}
                                </span>
                                <span className={clsx('flex', 'items-center', 'gap-1', 'text-[9px]', 'text-koma-muted')}>
                                  <Users size={10} /> {table.capacidade || 4}
                                </span>
                              </div>

                              {isOccupied ? (
                                <div className={clsx('flex', 'items-end', 'justify-between', 'gap-2')}>
                                  {tableOrders.length > 0 ? (
                                    <>
                                      <span className={clsx('text-[9px]', 'text-koma-muted')}>Consumo</span>
                                      <strong className={clsx(
                                        'font-mono text-xs sm:text-sm',
                                        hasPendingPayment ? 'text-amber-800 dark:text-[#efb2bc]' : 'text-koma-danger-text'
                                      )}>
                                        {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                      </strong>
                                    </>
                                  ) : (
                                    <span className={clsx('text-[9px]', 'text-koma-muted')}>Sincronizando…</span>
                                  )}
                                </div>
                              ) : (
                                <span className={clsx('hidden', 'sm:block', 'text-[10px]', 'text-koma-muted')}>Pronta para receber clientes</span>
                              )}

                              {(originId || transferredFromId) && (
                                <span className={clsx('block', 'truncate', 'text-[9px]', 'text-koma-muted')}>
                                  {originId ? `Unida à M${originId}` : `Transf. M${transferredFromId}`}
                                </span>
                              )}
                            </div>

                            {!isMerged && (
                              <div className={clsx('flex', 'gap-1.5', 'border-t', 'border-koma-border', 'pt-2 sm:pt-2.5')}>
                                {isOccupied ? (
                                  hasPendingPayment ? (
                                    <button
                                      type="button"
                                      disabled={tableOrders.length === 0}
                                      onClick={() => {
                                        const checkoutOrder = buildTableCheckoutOrder(tableOrders);
                                        if (!checkoutOrder) return;
                                        setSelectedOrder(checkoutOrder);
                                        setShowCheckoutModal(true);
                                        setCheckoutServiceTax(true);
                                        setSplitPeople('1');
                                        setSelectedItemIds([]);
                                        const subtotal = checkoutOrder.itens
                                          .filter(item => (item.status as string) !== 'cancelado')
                                          .reduce((sum, item) => sum + item.preco, 0);
                                        const checkoutTotal = subtotal * (1.0 + (taxaServicoAtiva ? serviceTaxRate / 100 : 0));
                                        setPaymentValor(Math.max(0, checkoutTotal - Number(checkoutOrder.valorPago || 0)));
                                      }}
                                      className={clsx('flex', 'min-h-8 sm:min-h-9', 'flex-1', 'items-center', 'justify-center', 'gap-1', 'rounded-lg', 'koma-badge-warning', 'hover:bg-amber-200 dark:hover:bg-amber-900/40', 'px-2', 'text-[9px]', 'font-extrabold', 'uppercase', 'tracking-wide', 'transition-colors', 'disabled:cursor-wait', 'disabled:opacity-45', 'cursor-pointer')}
                                    >
                                      <CreditCard size={11} />
                                      Receber
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={tableOrders.length === 0}
                                      onClick={() => tableOrders[0] && setSelectedKanbanOrder({
                                        ...tableOrders[0],
                                        contextoSalao: true,
                                        itens: tableOrders.flatMap(order => order.itens || []),
                                        comandaIds: tableOrders.map(order => order.id),
                                      })}
                                      className={clsx('flex', 'min-h-8 sm:min-h-9', 'flex-1', 'items-center', 'justify-center', 'gap-1', 'rounded-lg', 'koma-table-occupied-action', 'px-2', 'text-[9px]', 'font-extrabold', 'uppercase', 'tracking-wide', 'transition-all', 'disabled:cursor-wait', 'disabled:opacity-45', 'cursor-pointer')}
                                    >
                                      <Receipt size={11} />
                                      Ver comanda
                                    </button>
                                  )
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPdvOrderType('mesa');
                                      setPdvTargetMesaId(table.id);
                                      setBalcaoMobileView('produtos');
                                      setActiveSubTab('balcao');
                                    }}
                                    className={clsx('flex', 'min-h-8 sm:min-h-9', 'flex-1', 'items-center', 'justify-center', 'gap-1', 'rounded-lg', 'koma-table-free-action', 'px-2', 'text-[9px]', 'font-extrabold', 'uppercase', 'tracking-wide', 'transition-colors', 'cursor-pointer', 'shadow-xs')}
                                  >
                                    <Plus size={11} />
                                    Abrir pedido
                                  </button>
                                )}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* VIEW 4: MEU DESEMPENHO (Analytics) */}
          {activeSubTab === 'desempenho' && (
            <div className="space-y-6">
              {/* Header metrics boxes */}
              <div className={clsx('grid', 'grid-cols-2', 'md:grid-cols-4', 'gap-4')}>
                <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-4', 'rounded-2xl')}>
                  <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-koma-subtle', 'block')}>Líquido de Hoje</span>
                  <strong className={clsx('text-xl', 'text-koma-foreground', 'font-mono', 'block', 'mt-1')}>
                    R$ ${(generalStats?.faturamento_hoje ?? 0.00).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                </div>
                <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-4', 'rounded-2xl')}>
                  <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-koma-subtle', 'block')}>Em análise agora</span>
                  <strong className={clsx('text-xl', 'text-amber-500', 'font-mono', 'block', 'mt-1')}>
                    {deliveryOrders.filter(o => o.status === 'analise').length}
                  </strong>
                </div>
                <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-4', 'rounded-2xl')}>
                  <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-koma-subtle', 'block')}>Em produção agora</span>
                  <strong className={clsx('text-xl', 'text-emerald-700 dark:text-emerald-400', 'font-mono', 'block', 'mt-1')}>
                    {deliveryOrders.filter(o => o.status === 'producao').length + activeKitchenItems.filter(i => i.status === 'preparando').length}
                  </strong>
                </div>
                <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-4', 'rounded-2xl')}>
                  <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-koma-subtle', 'block')}>Pronto para entrega</span>
                  <strong className={clsx('text-xl', 'text-emerald-500', 'font-mono', 'block', 'mt-1')}>
                    {deliveryOrders.filter(o => o.status === 'pronto').length}
                  </strong>
                </div>
              </div>

              {/* Date Filters & Middle Metrics */}
              <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-4', 'rounded-2xl', 'space-y-4')}>
                <div className={clsx('flex', 'justify-between', 'items-center', 'border-b', 'border-koma-border', 'pb-3')}>
                  <div className={clsx('flex', 'items-center', 'gap-2')}>
                    <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary')}>Relatório Consolidado</span>
                  </div>
                  <div className={clsx('flex', 'gap-1', 'bg-koma-page', 'p-1', 'rounded-xl', 'border', 'border-koma-border')}>
                    {[
                      { id: '7', label: 'Últimos 7 dias' },
                      { id: '15', label: 'Últimos 15 dias' },
                      { id: '30', label: 'Últimos 30 dias' }
                    ].map(r => (
                      <button
                        key={r.id}
                        onClick={() => setDesempenhoRange(r.id as any)}
                        className={`px-3 py-1 text-[9px] font-bold rounded-lg cursor-pointer transition-all ${desempenhoRange === r.id
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-koma-subtle hover:text-koma-foreground'
                          }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-3', 'gap-4', 'font-mono')}>
                  <div className={clsx('bg-koma-panel', 'p-3.5', 'rounded-xl', 'border', 'border-koma-border/50', 'flex', 'justify-between', 'items-center')}>
                    <div>
                      <span className={clsx('text-[8px]', 'font-bold', 'font-sans', 'text-koma-subtle', 'uppercase', 'tracking-widest', 'block')}>Receita Líquida</span>
                      <strong className={clsx('text-base', 'text-koma-foreground', 'mt-1', 'block')}>
                        R$ ${(generalStats?.faturamento ?? 0.00).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <span className={clsx('text-[10px]', 'text-emerald-400', 'font-bold', 'bg-emerald-500/10', 'px-2', 'py-0.5', 'rounded', 'flex', 'items-center', 'gap-0.5')}>
                      <ArrowUpRight size={10} /> Real
                    </span>
                  </div>

                  <div className={clsx('bg-koma-panel', 'p-3.5', 'rounded-xl', 'border', 'border-koma-border/50', 'flex', 'justify-between', 'items-center')}>
                    <div>
                      <span className={clsx('text-[8px]', 'font-bold', 'font-sans', 'text-koma-subtle', 'uppercase', 'tracking-widest', 'block')}>Pedidos</span>
                      <strong className={clsx('text-base', 'text-koma-foreground', 'mt-1', 'block')}>
                        {generalStats?.total_pedidos ?? 0}
                      </strong>
                    </div>
                    <span className={clsx('text-[10px]', 'text-emerald-400', 'font-bold', 'bg-emerald-500/10', 'px-2', 'py-0.5', 'rounded', 'flex', 'items-center', 'gap-0.5')}>
                      <ArrowUpRight size={10} /> Real
                    </span>
                  </div>

                  <div className={clsx('bg-koma-panel', 'p-3.5', 'rounded-xl', 'border', 'border-koma-border/50', 'flex', 'justify-between', 'items-center')}>
                    <div>
                      <span className={clsx('text-[8px]', 'font-bold', 'font-sans', 'text-koma-subtle', 'uppercase', 'tracking-widest', 'block')}>Ticket Médio</span>
                      <strong className={clsx('text-base', 'text-koma-foreground', 'mt-1', 'block')}>
                        R$ ${(generalStats?.ticket_medio ?? 0.00).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <span className={clsx('text-[10px]', 'text-emerald-400', 'font-bold', 'bg-emerald-500/10', 'px-2', 'py-0.5', 'rounded', 'flex', 'items-center', 'gap-0.5')}>
                      <ArrowUpRight size={10} /> Real
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom Gauges & Best Sellers List */}
              <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5')}>

                {/* 1. Cardapio Quality Gauge */}
                <div className={clsx('bg-koma-card/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'flex', 'flex-col', 'items-center', 'justify-between', 'text-center', 'space-y-4')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary', 'block', 'text-left', 'w-full', 'border-b', 'border-koma-border', 'pb-2')}>Qualidade do Cardápio</span>

                  <div className={clsx('relative', 'h-28', 'w-28', 'flex', 'items-center', 'justify-center')}>
                    <svg className={clsx('absolute', 'inset-0', 'transform', '-rotate-90')} viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="42" stroke="#27272A" strokeWidth="8" fill="transparent" />
                      <circle cx="50" cy="50" r="42" stroke="url(#gradient)" strokeWidth="8" fill="transparent" strokeDasharray="264" strokeDashoffset={264 - (264 * (generalStats?.qualidade_cardapio ?? 100)) / 100} strokeLinecap="round" />
                      <defs>
                        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#10b981" />
                          <stop offset="100%" stopColor="#10b981" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <span className={clsx('text-lg', 'font-bold', 'font-mono', 'text-koma-foreground')}>{generalStats?.qualidade_cardapio ?? 100}%</span>
                  </div>

                  <div className="space-y-1">
                    <strong className={clsx('text-koma-foreground', 'font-medium', 'block', 'text-xs')}>Cardápio Otimizado</strong>
                    <p className={clsx('text-[9px]', 'text-koma-muted')}>Seu cardápio possui ótimas descrições e fotos de alta resolução cadastrados.</p>
                  </div>
                </div>

                {/* 2. Modality Split Gauges */}
                <div className={clsx('bg-koma-card/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-3')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary', 'block', 'border-b', 'border-koma-border', 'pb-2')}>Pedidos por Modalidade</span>

                  <div className={clsx('space-y-2.5', 'pt-2')}>
                    {[
                      { name: "Entrega (Delivery)", count: generalStats?.pedidos_modalidade?.delivery ?? 0, max: Math.max(1, generalStats?.total_pedidos ?? 1), barColor: "bg-rose-600" },
                      { name: "Consumo no Local (Mesa)", count: generalStats?.pedidos_modalidade?.local ?? 0, max: Math.max(1, generalStats?.total_pedidos ?? 1), barColor: "bg-[#10b981]" },
                      { name: "Retirada (Balcão)", count: generalStats?.pedidos_modalidade?.balcao ?? 0, max: Math.max(1, generalStats?.total_pedidos ?? 1), barColor: "bg-emerald-600" }
                    ].map((mod, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className={clsx('flex', 'justify-between', 'text-[10px]')}>
                          <span className="text-koma-subtle">{mod.name}</span>
                          <strong className={clsx('text-koma-foreground', 'font-mono')}>{mod.count} pedidos</strong>
                        </div>
                        <div className={clsx('h-1.5', 'w-full', 'bg-koma-panel', 'rounded-full', 'overflow-hidden')}>
                          <div className={`h-full ${mod.barColor} rounded-full`} style={{ width: `${(mod.count / mod.max) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Top Items list */}
                <div className={clsx('bg-koma-card/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-3')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary', 'block', 'border-b', 'border-koma-border', 'pb-2')}>Top 5 Itens Mais Pedidos</span>

                  <div className={clsx('divide-y', 'divide-koma-border')}>
                    {(generalStats?.top_itens ?? []).map((item: any, idx: number) => (
                      <div key={idx} className={clsx('py-2', 'flex', 'justify-between', 'items-center')}>
                        <div className={clsx('flex', 'items-center', 'gap-2.5')}>
                          <span className={`h-5 w-5 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold ${idx === 0 ? 'bg-emerald-600 text-white' : idx === 1 ? 'bg-[#10b981] text-[#121214]' : 'bg-koma-panel text-koma-subtle'
                            }`}>{item.rank}</span>
                          <span className={clsx('font-medium', 'text-koma-foreground', 'block')}>{item.name}</span>
                        </div>
                        <span className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'font-mono')}>{item.count} saídas</span>
                      </div>
                    ))}
                    {(generalStats?.top_itens ?? []).length === 0 && (
                      <div className={clsx('py-8', 'text-center', 'text-koma-muted', 'italic', 'text-[10px]')}>Nenhum item vendido no período</div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* VIEW 5: COZINHA (KDS) */}
          {activeSubTab === 'kds' && (
            <div className={clsx('bg-koma-card/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-4')}>
              <div className={clsx('border-b', 'border-koma-border', 'pb-3', 'flex', 'items-center', 'justify-between')}>
                <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary')}>Painel de Produção da Cozinha</span>
                <span className={clsx('bg-emerald-500/15', 'text-emerald-700 dark:text-emerald-400', 'font-bold', 'px-2', 'py-0.5', 'rounded-full', 'font-mono', 'text-[9px]')}>
                  {activeKitchenItems.length} pratos ativos
                </span>
              </div>

              {activeKitchenItems.length === 0 ? (
                <div className={clsx('py-32', 'text-center', 'text-koma-muted', 'italic', 'space-y-1')}>
                  <p>Cozinha Limpa!</p>
                  <p className={clsx('text-[9px]', 'text-gray-600')}>Nenhum pedido aguardando preparo no momento</p>
                </div>
              ) : (
                <div className={clsx('grid', 'grid-cols-1', 'sm:grid-cols-2', 'md:grid-cols-3', 'xl:grid-cols-4', 'gap-4')}>
                  {activeKitchenItems.map((item) => (
                    <div
                      key={item.id}
                      className={`bg-koma-card border p-3 rounded-2xl space-y-3 flex flex-col justify-between ${item.status === 'pronto' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-koma-border'
                        }`}
                    >
                      <div className="space-y-2">
                        {/* Header */}
                        <div className={clsx('flex', 'justify-between', 'items-start')}>
                          <div>
                            <span className={clsx('text-[9px]', 'text-koma-subtle', 'font-bold', 'block')}>
                              Mesa {item.mesaId > 0 ? item.mesaId : "Balcão"}
                            </span>
                            <strong className={clsx('text-koma-foreground', 'text-xs', 'block', 'mt-0.5', 'truncate', 'w-32')}>{item.nome}</strong>
                          </div>
                          <KDSTimer itemTimestamp={(item as any).created_at || (item as any).timestamp || (item as any).preparando_desde} status={item.status} />
                        </div>

                        {/* Observations / details */}
                        {item.observacao && (
                          <div className={clsx('bg-koma-page', 'border', 'border-koma-border/50', 'p-2', 'rounded-lg', 'text-rose-400', 'font-bold', 'text-[10px]', 'leading-relaxed', 'font-mono')}>
                            Obs: {item.observacao}
                          </div>
                        )}
                        <span className={clsx('text-[9px]', 'text-koma-muted', 'block', 'truncate')}>Lançado por: {item.garcomNome}</span>
                      </div>

                      {/* Actions */}
                      <div className={clsx('pt-2', 'border-t', 'border-koma-border', 'shrink-0')}>
                        {item.status === 'preparando' ? (
                          <button
                            onClick={() => handleUpdateItemStatus(item.id, 'pronto')}
                            className={clsx('w-full', 'py-1.5', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-lg', 'text-[9px]', 'uppercase', 'tracking-wider', 'cursor-pointer')}
                          >
                            Marcar como Pronto
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUpdateItemStatus(item.id, 'entregue')}
                            className={clsx('w-full', 'py-1.5', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'font-bold', 'rounded-lg', 'text-[9px]', 'uppercase', 'tracking-wider', 'cursor-pointer')}
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
          {activeTab === 'permissoes_cargos' && ['pessoas', 'equipe', 'convites'].includes(activeSubTab) && (
            <EquipePessoasTab
              users={systemUsers}
              onCreate={handleAddUser}
              onResendInvite={handleResendInvite}
              onRemove={handleDeleteUser}
            />
          )}

          {/* VIEW: EQUIPE — CARGOS E PERMISSÕES (dados reais da API) */}
          {activeTab === 'permissoes_cargos' && ['cargos_permissoes', 'cargos', 'permissoes'].includes(activeSubTab) && (
            <EquipeCargosTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
          )}


          {/* VIEW 7: CONFIGURAÇÕES SALÃO (Impressão, App Garçom e Taxa) */}
          {(activeTab === 'impressao_salao' || activeSubTab === 'impressoras') && (
            <div className="space-y-5">
              <div className={clsx('flex', 'flex-wrap', 'gap-1.5', 'rounded-xl', 'border', 'border-koma-border', 'bg-koma-page', 'p-1', 'w-fit')}>
                {[
                  { id: 'impressao', label: 'Impressão', icon: Printer },
                  { id: 'mesas', label: 'Mesas', icon: Users },
                  { id: 'garcom', label: 'App do Garçom', icon: Smartphone },
                  { id: 'taxa', label: 'Taxa de Serviço', icon: Percent }
                ].map(tab => {
                  const Icon = tab.icon;
                  const selected = printingSettingsTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setPrintingSettingsTab(
                        tab.id as 'impressao' | 'mesas' | 'garcom' | 'taxa'
                      )}
                      className={`px-3 py-2 text-[9px] font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
                        selected
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-koma-subtle hover:text-koma-foreground'
                      }`}
                    >
                      <Icon size={12} />
                      {tab.label}
                      {tab.id === 'impressao' && !hasPrinting && (
                        <Lock size={10} className="text-amber-600 dark:text-amber-300" />
                      )}
                    </button>
                  );
                })}
              </div>

              {printingSettingsTab === 'impressao' && !hasPrinting && (
                <div className={clsx('bg-koma-card', 'border', 'border-amber-500/20', 'rounded-3xl', 'p-8', 'text-center', 'max-w-xl', 'mx-auto', 'space-y-3')}>
                  <Lock size={24} className={clsx('text-amber-400', 'mx-auto')} />
                  <h3 className={clsx('text-koma-foreground', 'font-bold')}>Impressão não incluída no Kôma Pocket</h3>
                  <p className={clsx('text-[10px]', 'text-koma-subtle')}>
                    App do Garçom e Taxa de Serviço continuam disponíveis nas abas acima. Migre para o Kôma Pro ou Premium para liberar impressão.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('assinatura_pix');
                      setActiveSubTab('planos');
                    }}
                    className={clsx('px-4', 'py-2', 'rounded-xl', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'text-[10px]', 'font-bold', 'uppercase', 'cursor-pointer')}
                  >
                    Comparar planos
                  </button>
                </div>
              )}

              {printingSettingsTab === 'mesas' && (
                <OperationalBanner
                  id="salon-tables-title"
                  eyebrow="CONFIGURAÇÕES / SALÃO"
                  title="Mesas"
                  accent="prontas para receber"
                  description="Capacidade e identificação do salão sem misturar configuração com comandas abertas."
                  metrics={[
                    { label: 'mesas cadastradas', value: salonTables.length },
                    {
                      label: 'lugares disponíveis',
                      value: salonTables.reduce((total, table) => total + (table.capacidade || 4), 0)
                    },
                    {
                      label: 'nomes personalizados',
                      value: salonTables.filter(table => Boolean(table.nome?.trim())).length
                    }
                  ]}
                />
              )}

              {printingSettingsTab === 'garcom' && (
                <OperationalBanner
                  id="waiter-app-title"
                  eyebrow="CONFIGURAÇÕES / EQUIPE"
                  title="Atendimento"
                  accent="com autonomia controlada"
                  description="Veja rapidamente o que a equipe pode fazer antes de ajustar cada permissão."
                  metrics={[
                    {
                      label: 'permissões ativas',
                      value: [
                        permDelivery, permEdit, permCancel, permShowStatus,
                        permAutoPrint, permCloseAccount, permTransferTables,
                        permTransferItems
                      ].filter(Boolean).length
                    },
                    { label: 'impressão de pedido', value: permAutoPrint ? 'Automática' : 'Manual' },
                    { label: 'fechamento no app', value: permCloseAccount ? 'Permitido' : 'Bloqueado' },
                    { label: 'integrações pendentes', value: 7 }
                  ]}
                />
              )}

              {printingSettingsTab === 'taxa' && (
                <OperationalBanner
                  id="service-tax-title"
                  eyebrow="CONFIGURAÇÕES / SERVIÇO"
                  title="Taxa"
                  accent={taxaServicoAtiva ? 'aplicada com clareza' : 'sob decisão do caixa'}
                  description="A regra é única para o salão e chega ao fechamento sem cálculo paralelo."
                  metrics={[
                    { label: 'estado atual', value: taxaServicoAtiva ? 'Ativa' : 'Inativa' },
                    { label: 'percentual padrão', value: taxaServicoAtiva ? `${serviceTaxRate}%` : '—' },
                    { label: 'aplicação', value: 'Fechamento' },
                    { label: 'alcance', value: 'Caixa e salão' }
                  ]}
                />
              )}

              {printingSettingsTab === 'mesas' && (
                <section className={clsx('overflow-hidden', 'rounded-[22px]', 'border', 'border-koma-border', 'bg-koma-panel')}>
                  <header className={clsx('flex', 'flex-col', 'gap-3', 'border-b', 'border-koma-border', 'px-4', 'py-4', 'sm:flex-row', 'sm:items-center', 'sm:justify-between', 'sm:px-5')}>
                    <div>
                      <h3 className={clsx('text-sm', 'font-bold', 'text-koma-foreground')}>Configuração das mesas</h3>
                      <p className={clsx('mt-1', 'text-[10px]', 'text-koma-muted')}>Cadastre, nomeie e defina a capacidade. A ocupação continua sendo controlada pelas comandas.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setTableFormError('');
                        setShowAddMesaModal(true);
                      }}
                      className={clsx('inline-flex', 'min-h-10', 'items-center', 'justify-center', 'gap-1.5', 'rounded-xl', 'bg-[#10b981]', 'px-4', 'text-[9px]', 'font-extrabold', 'uppercase', 'tracking-wider', 'text-[#07110e]', 'transition-colors', 'hover:bg-[#35c99a]')}
                    >
                      <Plus size={13} /> Adicionar mesa
                    </button>
                  </header>

                  {salonTables.length === 0 ? (
                    <div className={clsx('flex', 'min-h-48', 'flex-col', 'items-center', 'justify-center', 'px-5', 'text-center')}>
                      <Users size={22} className="text-koma-muted" />
                      <strong className={clsx('mt-3', 'text-xs', 'text-koma-secondary')}>Nenhuma mesa cadastrada</strong>
                      <span className={clsx('mt-1', 'text-[10px]', 'text-koma-muted')}>Adicione a primeira mesa para liberar a operação do salão.</span>
                    </div>
                  ) : (
                    <div className={clsx('grid', 'gap-2', 'p-4', 'sm:grid-cols-2', 'lg:grid-cols-3', '2xl:grid-cols-4')}>
                      {[...salonTables].sort((a, b) => a.id - b.id).map(table => (
                        <article key={table.id} className={clsx('flex', 'items-center', 'justify-between', 'gap-3', 'rounded-2xl', 'border', 'border-[#292e2c]', 'bg-koma-card', 'p-3.5')}>
                          <div className="min-w-0">
                            <span className={clsx('block', 'font-mono', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-[0.18em]', 'text-koma-muted')}>Mesa {table.id}</span>
                            <strong className={clsx('mt-0.5', 'block', 'truncate', 'text-xs', 'text-koma-foreground')}>{table.nome || `Mesa ${table.id}`}</strong>
                            <span className={clsx('mt-1', 'flex', 'items-center', 'gap-1', 'text-[9px]', 'text-koma-muted')}><Users size={10} /> {table.capacidade || 4} lugares</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTable(table);
                              setEditTableCap(String(table.capacidade || 4));
                              setEditTableNome(table.nome || '');
                              setIsConfirmingDelete(false);
                              setTableFormError('');
                            }}
                            aria-label={`Editar Mesa ${table.id}`}
                            className={clsx('rounded-lg', 'border', 'border-koma-border-subtle', 'bg-white/[0.025]', 'p-2', 'text-koma-muted', 'transition-colors', 'hover:border-emerald-500/30', 'hover:text-emerald-800 dark:text-emerald-300')}
                          >
                            <Edit3 size={13} />
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Service Tax config block moved to Salão e Impressão */}
              {printingSettingsTab === 'taxa' && (
              <div className={clsx('lg:col-span-3', 'bg-koma-card', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-3')}>
                <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary', 'block', 'pb-1', 'border-b', 'border-koma-border')}>Taxa de Serviço do Salão</span>

                <div className={clsx('flex', 'justify-between', 'items-center', 'pt-1')}>
                  <span className={clsx('text-[10px]', 'text-koma-secondary', 'font-semibold')}>Ativar Taxa de 10% de Serviço</span>
                  <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer')}>
                    <input
                      type="checkbox"
                      checked={taxaServicoAtiva}
                      onChange={(e) => {
                        setTaxaServicoAtiva(e.target.checked);
                        setCheckoutServiceTax(e.target.checked);
                        updateConfiguracoes({ taxa_servico_ativa: e.target.checked });
                      }}
                      className={clsx('sr-only', 'peer')}
                    />
                    <div className={clsx('w-9', 'h-5', 'bg-koma-raised', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-4', 'after:w-4', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                  </label>
                </div>

                {taxaServicoAtiva && (
                  <div className={clsx('space-y-1', 'pt-1.5', 'animate-scale-in', 'max-w-xs')}>
                    <label className={clsx('text-[8px]', 'text-koma-subtle', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Porcentagem Customizada (%):</label>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={serviceTaxRate}
                      onChange={(e) => {
                        const val = Math.max(1, parseInt(e.target.value) || 1);
                        setServiceTaxRate(val);
                        updateConfiguracoes({ taxa_servico_padrao: val });
                      }}
                      className={clsx('w-full', 'px-3', 'py-1.5', 'bg-koma-page', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'font-mono', 'text-[10px]')}
                    />
                  </div>
                )}
              </div>
              )}

              {printingSettingsTab === 'impressao' && hasPrinting && (
              <PrintMonitorPanel
                apiBaseUrl={apiBaseUrl}
                authHeaders={authHeaders}
                onTestPrint={handleTestPrinter}
                testInProgress={isTestingPrinter}
              />
              )}

              {/* Waiters permissions switches (Left Column) */}
              {printingSettingsTab === 'garcom' && (
              <div className={clsx('lg:col-span-2', 'bg-koma-card/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-4', 'flex', 'flex-col', 'overflow-hidden')}>
                <div className={clsx('border-b', 'border-koma-border', 'pb-3', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary')}>Configurações de Permissões do App do Garçom</span>
                </div>

                {/* Sub tabs inside configurations */}
                <div className={clsx('flex', 'gap-1.5', 'bg-koma-page', 'p-1', 'rounded-xl', 'border', 'border-koma-border', 'w-fit', 'shrink-0')}>
                  {[
                    { id: 'pedido', label: '1. Pedido' },
                    { id: 'fechamento', label: '2. Fechamento de Conta' },
                    { id: 'atendimento', label: '3. Atendimento' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setConfigSalSubTab(tab.id as any)}
                      className={`px-3 py-1.5 text-[9px] font-bold rounded-lg cursor-pointer transition-all ${configSalSubTab === tab.id
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-koma-subtle hover:text-koma-foreground'
                        }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Switch list */}
                <div className={clsx('flex-1', 'overflow-y-auto', 'pr-1', 'space-y-3.5', 'pt-2')}>

                  {configSalSubTab === 'pedido' && (
                    <div className={clsx('space-y-3.5', 'animate-scale-in')}>
                      {[
                        { title: "Permitir que garçom faça lançamentos de pedidos de delivery", desc: "Ao ativar, garçons podem criar comandas com canais externos no salão.", checked: permDelivery, available: true, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_delivery: val }) },
                        { title: "Permitir que Garçons editem pedidos", desc: "Permite atualizar observações ou acrescentar itens em comandas já enviadas.", checked: permEdit, available: true, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_editar: val }) },
                        { title: "Permitir que Garçons editem cobranças adicionais", desc: "Permite retirar/colocar taxas extras, como couvert artístico ou consumação mínima.", checked: permAddCharges, available: false, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_taxas: val }) },
                        { title: "Permitir que garçons cancelem pedidos", desc: "Permite o cancelamento direto de itens pelo aplicativo sem aprovação do gerente.", checked: permCancel, available: true, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_cancelar: val }) },
                        { title: "Permitir exibição de status de pedidos no mapa de mesas", desc: "Gera ícones de produção ('Em preparo', 'Pronto') sobre as mesas no mapa.", checked: permShowStatus, available: true, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_status: val }) },
                        { title: "Permitir que garçons abram comandas sem pedido", desc: "Permite reservar uma mesa com status 'ocupada' sem lançar nenhum item.", checked: permOpenEmpty, available: false, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_abrir_vazia: val }) },
                        { title: "Permitir impressão automática dos pedidos feitos pelo Garçom", desc: "Dispara a via térmica de produção no balcão imediatamente após o garçom confirmar.", checked: permAutoPrint, available: true, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_print: val }) }
                      ].map((item, idx) => (
                        <div key={idx} className={clsx('flex', 'justify-between', 'items-start', 'gap-4')}>
                          <div className="space-y-0.5">
                            <div className={clsx('flex', 'items-center', 'gap-2')}>
                              <strong className={clsx(item.available ? 'text-koma-foreground' : 'text-koma-subtle', 'block', 'font-semibold')}>{item.title}</strong>
                              {!item.available && <span className={clsx('rounded-full', 'border', 'border-amber-700/40', 'bg-amber-900/20', 'px-2', 'py-0.5', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-wide', 'text-amber-400')}>Integração pendente</span>}
                            </div>
                            <span className={clsx('text-[9px]', 'text-koma-muted', 'block', 'leading-relaxed')}>{item.desc}</span>
                          </div>
                          <label className={clsx('relative', 'inline-flex', 'items-center', item.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-45', 'shrink-0', 'mt-0.5')}>
                            <input type="checkbox" checked={item.checked} disabled={!item.available} onChange={(e) => item.onChange(e.target.checked)} className={clsx('sr-only', 'peer')} />
                            <div className={clsx('w-8', 'h-4.5', 'bg-koma-raised', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-3.5', 'after:w-3.5', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}

                  {configSalSubTab === 'fechamento' && (
                    <div className={clsx('space-y-3.5', 'animate-scale-in')}>
                      {[
                        { title: "Permitir que Garçom feche a conta", desc: "Autoriza o garçom a encerrar a mesa e dar a baixa definitiva no consumo.", checked: permCloseAccount, available: true, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_fechar: val }) },
                        { title: "Permitir que Garçom aplique desconto", desc: "Habilita a aplicação de porcentagem de desconto na conta final direto pelo aplicativo.", checked: permDiscount, available: false, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_desconto: val }) },
                        { title: "Permitir que Garçom aplique acréscimo", desc: "Habilita a adição de valores extras ou gorjetas no fechamento da conta pelo app.", checked: permSurcharge, available: false, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_acrescimo: val }) }
                      ].map((item, idx) => (
                        <div key={idx} className={clsx('flex', 'justify-between', 'items-start', 'gap-4')}>
                          <div className="space-y-0.5">
                            <div className={clsx('flex', 'items-center', 'gap-2')}>
                              <strong className={clsx(item.available ? 'text-koma-foreground' : 'text-koma-subtle', 'block', 'font-semibold')}>{item.title}</strong>
                              {!item.available && <span className={clsx('rounded-full', 'border', 'border-amber-700/40', 'bg-amber-900/20', 'px-2', 'py-0.5', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-wide', 'text-amber-400')}>Integração pendente</span>}
                            </div>
                            <span className={clsx('text-[9px]', 'text-koma-muted', 'block', 'leading-relaxed')}>{item.desc}</span>
                          </div>
                          <label className={clsx('relative', 'inline-flex', 'items-center', item.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-45', 'shrink-0', 'mt-0.5')}>
                            <input type="checkbox" checked={item.checked} disabled={!item.available} onChange={(e) => item.onChange(e.target.checked)} className={clsx('sr-only', 'peer')} />
                            <div className={clsx('w-8', 'h-4.5', 'bg-koma-raised', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-3.5', 'after:w-3.5', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}

                  {configSalSubTab === 'atendimento' && (
                    <div className={clsx('space-y-3.5', 'animate-scale-in')}>
                      {[
                        { title: "Permitir que o garçom informe quantas pessoas vão sentar à mesa", desc: "Abre pergunta inicial na abertura da mesa para cálculo automático do consumo/taxa individual.", checked: permPeopleCount, available: false, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_pessoas: val }) },
                        { title: "Permitir que Garçom transfira mesas e comandas", desc: "Permite realocar todo o consumo de uma mesa para outra mesa vazia.", checked: permTransferTables, available: true, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_transferir_mesa: val }) },
                        { title: "Permitir que Garçom transfira pedidos e pagamentos para mesas ocupadas", desc: "Mover itens isolados ou repassar contas a pagar entre comanda de clientes sentados.", checked: permTransferItems, available: true, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_transferir_item: val }) },
                        { title: "Permitir que Cliente chame Garçom na mesa", desc: "Dispara notificações no painel do garçom se o cliente apertar o botão no cardápio digital QR Code.", checked: permClientCall, available: false, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_chamar: val }) },
                        { title: "Permitir exibição de mesas ociosas", desc: "Destaca no mapa mesas sem novos pedidos há mais tempo.", checked: permShowIdleTables, available: false, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_ociosas: val }) }
                      ].map((item, idx) => (
                        <div key={idx} className={clsx('flex', 'justify-between', 'items-start', 'gap-4')}>
                          <div className="space-y-0.5">
                            <div className={clsx('flex', 'items-center', 'gap-2')}>
                              <strong className={clsx(item.available ? 'text-koma-foreground' : 'text-koma-subtle', 'block', 'font-semibold')}>{item.title}</strong>
                              {!item.available && <span className={clsx('rounded-full', 'border', 'border-amber-700/40', 'bg-amber-900/20', 'px-2', 'py-0.5', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-wide', 'text-amber-400')}>Integração pendente</span>}
                            </div>
                            <span className={clsx('text-[9px]', 'text-koma-muted', 'block', 'leading-relaxed')}>{item.desc}</span>
                          </div>
                          <label className={clsx('relative', 'inline-flex', 'items-center', item.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-45', 'shrink-0', 'mt-0.5')}>
                            <input type="checkbox" checked={item.checked} disabled={!item.available} onChange={(e) => item.onChange(e.target.checked)} className={clsx('sr-only', 'peer')} />
                            <div className={clsx('w-8', 'h-4.5', 'bg-koma-raised', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-3.5', 'after:w-3.5', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              </div>
              )}

              {/* Printer messages & test (Right Column) */}
              {printingSettingsTab === 'impressao' && hasPrinting && (
              <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'rounded-[22px]', 'p-5', 'grid', 'grid-cols-1', 'xl:grid-cols-2', 'gap-6', 'shadow-xs')}>
                <div className="space-y-4">
                  <div className={clsx('flex', 'items-start', 'justify-between', 'gap-3', 'border-b', 'border-koma-border', 'pb-3')}>
                    <div>
                      <h3 className={clsx('text-sm', 'font-bold', 'text-koma-foreground')}>Personalização do cupom</h3>
                      <p className={clsx('mt-1', 'text-[10px]', 'text-koma-muted')}>Uma configuração central para caixa, comandas e impressão automática.</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[8px] font-extrabold ${
                      printSettingsSaveState === 'error'
                        ? 'koma-badge-danger'
                        : printSettingsSaveState === 'dirty'
                          ? 'koma-badge-warning'
                          : 'koma-badge-success'
                    }`}>
                      {printSettingsSaveState === 'saving'
                        ? 'SALVANDO…'
                        : printSettingsSaveState === 'dirty'
                          ? 'ALTERAÇÕES PENDENTES'
                          : printSettingsSaveState === 'error'
                            ? 'NÃO FOI SALVO'
                            : 'SALVO NO RESTAURANTE'}
                    </span>
                  </div>

                  <div className={clsx('space-y-3', 'text-left')}>
                    <div className="space-y-1">
                      <label className={clsx('text-[9px]', 'font-bold', 'text-koma-muted', 'uppercase', 'tracking-wider', 'block')}>Nome do restaurante no cupom:</label>
                      <input
                        type="text"
                        value={printHeader}
                        maxLength={80}
                        onChange={(e) => {
                          setPrintHeader(e.target.value);
                          setPrintSettingsSaveState('dirty');
                        }}
                        onBlur={() => updateConfiguracoes({ impressao_nome_restaurante: printHeader })}
                        className={clsx('w-full', 'px-3.5', 'py-2.5', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'font-medium', 'focus:outline-none', 'focus:border-emerald-500/60')}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className={clsx('text-[9px]', 'font-bold', 'text-koma-muted', 'uppercase', 'tracking-wider', 'block')}>Onde imprimir o nome:</label>
                      <select
                        value={printNamePosition}
                        onChange={(e) => updateConfiguracoes({
                          impressao_nome_posicao: e.target.value as 'cabecalho' | 'rodape' | 'oculto'
                        })}
                        className={clsx('w-full', 'px-3.5', 'py-2.5', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'font-medium', 'focus:outline-none', 'focus:border-emerald-500/60')}
                      >
                        <option value="cabecalho">Cabeçalho — maior destaque</option>
                        <option value="rodape">Rodapé</option>
                        <option value="oculto">Não imprimir</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className={clsx('text-[9px]', 'font-bold', 'text-koma-muted', 'uppercase', 'tracking-wider', 'block')}>Mensagem adicional de rodapé:</label>
                      <input
                        type="text"
                        value={printFooter}
                        maxLength={160}
                        placeholder="Ex.: endereço, telefone ou agradecimento"
                        onChange={(e) => {
                          setPrintFooter(e.target.value);
                          setPrintSettingsSaveState('dirty');
                        }}
                        onBlur={() => updateConfiguracoes({ impressao_mensagem_rodape: printFooter })}
                        className={clsx('w-full', 'px-3.5', 'py-2.5', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'focus:outline-none', 'focus:border-emerald-500/60')}
                      />
                    </div>

                    <div className={clsx('flex', 'justify-between', 'items-center', 'pt-2')}>
                      <span className={clsx('text-xs', 'text-koma-foreground', 'font-medium')}>Unificar Vias de Delivery (Via Única)</span>
                      <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer')}>
                        <input
                          type="checkbox"
                          checked={unificarViasDelivery}
                          onChange={(e) => {
                            setUnificarViasDelivery(e.target.checked);
                            updateConfiguracoes({ unificar_vias_delivery: e.target.checked });
                          }}
                          className={clsx('sr-only', 'peer')}
                        />
                        <div className={clsx('w-9', 'h-5', 'bg-zinc-300', 'dark:bg-zinc-700', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-4', 'after:w-4', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                      </label>
                    </div>

                  </div>

                </div>

                {/* Prévia aproximada: a largura final depende da impressora. */}
                <div className="space-y-2">
                  <div className={clsx('flex', 'items-center', 'justify-between', 'gap-2')}>
                    <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary')}>
                      Prévia aproximada
                    </span>
                    <span className={clsx('rounded-full', 'border', 'border-koma-border', 'px-2', 'py-1', 'text-[8px]', 'text-koma-muted')}>
                      exemplo em escala
                    </span>
                  </div>
                  <div className={clsx('mx-auto', 'w-full', 'max-w-[380px]', 'bg-[#FFFFFC]', 'text-black', 'px-5', 'py-4', 'rounded-sm', 'border', 'border-gray-300', 'font-mono', 'text-[10px]', 'leading-[1.25]', 'shadow-[0_14px_30px_rgba(0,0,0,0.35)]')}>
                    {printNamePosition === 'cabecalho' && printHeader && (
                      <>
                        <div className={clsx('text-center', 'font-bold', 'uppercase', 'text-[12px]', 'leading-tight')}>
                          {printHeader}
                        </div>
                        <div className={clsx('border-t', 'border-dashed', 'border-gray-500', 'my-1.5')} />
                      </>
                    )}

                    <div className={clsx('text-center', 'font-bold', 'text-[12px]')}>
                      CONSUMO NO LOCAL
                    </div>
                    <div className={clsx('border-t', 'border-dashed', 'border-gray-500', 'my-1.5')} />
                    <div className={clsx('flex', 'justify-between')}>
                      <span>PEDIDO: #305</span>
                      <span>MESA: 3</span>
                    </div>
                    <div className={clsx('flex', 'justify-between')}>
                      <span>DATA: 28/07/2026</span>
                      <span>HORA: 18:01</span>
                    </div>
                    <div>GARÇOM: GEORLAN</div>
                    <div className={clsx('border-t', 'border-dashed', 'border-gray-500', 'my-1.5')} />

                    <div className="space-y-1">
                      <div className={clsx('flex', 'justify-between', 'gap-3')}>
                        <span>3x HAMBÚRGUER TRADICIONAL</span>
                        <span className="shrink-0">R$ 57,00</span>
                      </div>
                      <div className={clsx('pl-3', 'text-[8px]', 'text-gray-700')}>
                        OBS: SEM CHEDDAR
                      </div>
                      <div className={clsx('flex', 'justify-between', 'gap-3')}>
                        <span>2x HEINEKEN LONG NECK</span>
                        <span className="shrink-0">R$ 24,00</span>
                      </div>
                      <div className={clsx('flex', 'justify-between', 'gap-3')}>
                        <span>1x BAGUETE DE COSTELA</span>
                        <span className="shrink-0">R$ 36,00</span>
                      </div>
                      <div className={clsx('pl-3', 'text-[8px]', 'text-gray-700')}>
                        OBS: SEM SALADA
                      </div>
                    </div>

                    <div className={clsx('border-t', 'border-dashed', 'border-gray-500', 'my-1.5')} />
                    <div className={clsx('text-center', 'font-bold')}>CLIENTE: PAULO</div>
                    <div className={clsx('flex', 'justify-between', 'gap-3')}>
                      <span>1x CHEESE BACON</span>
                      <span className="shrink-0">R$ 25,00</span>
                    </div>
                    <div className={clsx('flex', 'justify-between', 'gap-3')}>
                      <span>1x HAMBÚRGUER SUÍNO</span>
                      <span className="shrink-0">R$ 19,00</span>
                    </div>
                    <div className={clsx('border-t', 'border-dashed', 'border-gray-500', 'my-1.5')} />
                    <div className={clsx('flex', 'justify-between')}>
                      <span>SUBTOTAL CONSUMO GERAL</span>
                      <span>R$ 117,00</span>
                    </div>
                    <div className={clsx('flex', 'justify-between')}>
                      <span>SUBTOTAL PAULO</span>
                      <span>R$ 44,00</span>
                    </div>
                    <div className={clsx('border-y', 'border-double', 'border-koma-border', 'my-1.5', 'py-1', 'flex', 'justify-between', 'font-bold', 'text-[11px]')}>
                      <span>TOTAL GERAL DA MESA</span>
                      <span>R$ 161,00</span>
                    </div>

                    <div className={clsx('text-center', 'text-[9px]', 'mt-2')}>
                      <span className="block">Gerenciado por Kôma</span>
                      <span className="block">Documento não fiscal</span>
                      {printFooter && (
                        <span className={clsx('block', 'mt-1', 'uppercase')}>{printFooter}</span>
                      )}
                      {printNamePosition === 'rodape' && printHeader && (
                        <span className={clsx('block', 'font-bold', 'mt-1', 'uppercase')}>
                          {printHeader}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className={clsx('text-[8px]', 'leading-relaxed', 'text-koma-muted')}>
                    O nome, a posição e o rodapé acima atualizam esta simulação. A impressão real usa o formatador do servidor e ajusta as quebras à largura da térmica.
                  </p>
                </div>

              </div>
              )}

            </div>
          )}

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
          {activeTab === 'clientes' && activeSubTab === 'fidelidade' && (
            <div className="space-y-4 text-left animate-fade-in">
              <OperationalBanner
                id="loyalty-heading"
                eyebrow="RELACIONAMENTO"
                title="Fidelidade"
                accent={fidelidadeConfig.ativo ? 'ativa e simples' : 'pronta para começar'}
                description="Defina uma regra fácil de explicar e acompanhe os pontos de cada cliente em uma única lista."
                metrics={[
                  { label: loyaltyUsers.length === 1 ? 'cliente participante' : 'clientes participantes', value: loyaltyUsers.length },
                  { label: 'situação', value: fidelidadeConfig.ativo ? 'Ativo' : 'Pausado', valueClassName: fidelidadeConfig.ativo ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300' },
                ]}
              />
              <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-2', 'gap-4', 'max-w-5xl')}>
              <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-5', 'rounded-2xl', 'space-y-4', 'h-fit')}>
                <div className="border-b border-koma-border pb-3">
                  <div><span className="block text-sm font-bold text-koma-foreground">Configuração do programa</span><span className="mt-0.5 block text-[10px] text-koma-muted">Defina como os clientes acumulam e resgatam benefícios.</span></div>
                </div>

                <form onSubmit={handleSaveFidelidadeConfig} className="space-y-4">
                  <div className={clsx('flex', 'items-center', 'justify-between')}>
                    <span className={clsx('text-[10px]', 'font-semibold', 'text-koma-secondary')}>{fidelidadeConfig.ativo ? 'Programa ativo' : 'Programa pausado'}</span>
                    <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer', 'shrink-0')}>
                      <input
                        type="checkbox"
                        checked={fidelidadeConfig.ativo}
                        onChange={(e) => setFidelidadeConfig(prev => ({ ...prev, ativo: e.target.checked }))}
                        className={clsx('sr-only', 'peer')}
                      />
                      <div className={clsx('w-8', 'h-4.5', 'bg-koma-raised', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-3.5', 'after:w-3.5', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                    </label>
                  </div>

                  <div className="space-y-1">
                    <label className={clsx('text-[9px]', 'font-bold', 'text-koma-secondary', 'uppercase', 'tracking-wider', 'block')}>Benefício oferecido</label>
                    <select
                      value={fidelidadeConfig.tipo_recompensa}
                      onChange={(e) => setFidelidadeConfig(prev => ({ ...prev, tipo_recompensa: e.target.value }))}
                      disabled={!fidelidadeConfig.ativo}
                      className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-page', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-[10px]', 'disabled:opacity-50')}
                    >
                      <option value="PONTOS">Pontos</option>
                      <option value="CASHBACK">Dinheiro de volta</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className={clsx('text-[9px]', 'font-bold', 'text-koma-secondary', 'uppercase', 'tracking-wider', 'block')}>
                      {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? 'Pontos ganhos a cada R$ 1' : 'Percentual devolvido ao cliente'}
                    </label>
                    <input
                      type="number"
                      value={fidelidadeConfig.taxa_conversao}
                      onChange={(e) => setFidelidadeConfig(prev => ({ ...prev, taxa_conversao: Number(e.target.value) }))}
                      disabled={!fidelidadeConfig.ativo}
                      className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-page', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'font-mono', 'text-[10px]', 'disabled:opacity-50')}
                    />
                  </div>

                  {fidelidadeConfig.tipo_recompensa === 'PONTOS' && (
                    <div className="space-y-1">
                      <label className={clsx('text-[9px]', 'font-bold', 'text-koma-secondary', 'uppercase', 'tracking-wider', 'block')}>Valor de cada ponto</label>
                      <input
                        type="number"
                        step="0.01"
                        value={fidelidadeConfig.valor_ponto_em_dinheiro}
                        onChange={(e) => setFidelidadeConfig(prev => ({ ...prev, valor_ponto_em_dinheiro: Number(e.target.value) }))}
                        disabled={!fidelidadeConfig.ativo}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-page', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'font-mono', 'text-[10px]', 'disabled:opacity-50')}
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    className="koma-btn-success flex min-h-10 w-full items-center justify-center rounded-xl text-[10px] font-bold"
                  >
                    Salvar programa
                  </button>
                </form>
              </div>

              <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'rounded-2xl', 'p-5', 'space-y-4', 'h-fit')}>
                <div className="border-b border-koma-border pb-3">
                  <span className="block text-sm font-bold text-koma-foreground">Como funciona</span>
                  <span className="mt-0.5 block text-[10px] text-koma-muted">Uma visão simples da regra aplicada nas próximas vendas identificadas.</span>
                </div>
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Exemplo em uma compra de R$ 100</span>
                  <strong className="mt-2 block font-mono text-xl text-koma-foreground">
                    {fidelidadeConfig.tipo_recompensa === 'PONTOS'
                      ? `${Math.max(0, fidelidadeConfig.taxa_conversao * 100).toFixed(0)} pontos`
                      : `R$ ${Math.max(0, fidelidadeConfig.taxa_conversao).toFixed(2)} de cashback`}
                  </strong>
                  <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
                    {fidelidadeConfig.tipo_recompensa === 'PONTOS'
                      ? `Cada ponto vale R$ ${Number(fidelidadeConfig.valor_ponto_em_dinheiro || 0).toFixed(2)} no resgate.`
                      : `O cliente recebe ${Number(fidelidadeConfig.taxa_conversao || 0).toFixed(2)}% do valor da compra.`}
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-koma-border bg-koma-raised px-3 py-2.5">
                  <span className="text-[10px] text-koma-muted">Clientes participantes</span>
                  <strong className="font-mono text-sm text-koma-foreground">{loyaltyUsers.length}</strong>
                </div>
                <button type="button" onClick={() => setActiveSubTab('clientes')} className="koma-btn-secondary inline-flex min-h-9 items-center justify-center px-3 text-[10px] font-bold">Ver pontos dos clientes</button>
              </div>
              </div>
            </div>
          )}

          {/* VIEW: RELATÓRIOS — VISÃO GERAL */}
          {(activeTab === 'relatorios' || activeTab === 'dashboard') && ['visao_geral', 'metas', 'vendas', 'indicadores', 'relatorio_geral', 'consolidado_vendas'].includes(activeSubTab) && (
            <RelatoriosVisaoGeralTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} showToast={showToast} />
          )}

          {/* VIEW: RELATÓRIOS — FINANCEIRO (DRE) */}
          {(activeTab === 'relatorios' || activeTab === 'dashboard') && ['financeiro', 'demonstrativo_dre', 'dre', 'fluxo_caixa'].includes(activeSubTab) && (
            <RelatorioFinanceiroTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
          )}

          {/* VIEW: RELATÓRIOS — PRODUTOS */}
          {(activeTab === 'relatorios' || activeTab === 'dashboard') && ['produtos', 'produtos_mais_vendidos', 'top10', 'mais_vendidos'].includes(activeSubTab) && (
            <RelatoriosProdutosTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} categorias={apiCategorias} showToast={showToast} />
          )}

          {/* VIEW: RELATÓRIOS — EQUIPE (reutiliza o mesmo componente de desempenho) */}
          {(activeTab === 'relatorios' || activeTab === 'dashboard') && activeSubTab === 'equipe' && (
            <EquipeDesempenhoTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} showToast={showToast} />
          )}

          {/* CATÁLOGO CENTRAL: produtos e disponibilidade usam o mesmo snapshot. */}
          {activeTab === 'cardapio' && activeSubTab === 'produtos' && (
            <div className="space-y-4">
            <OperationalBanner
              id="menu-products-heading"
              eyebrow="CATÁLOGO"
              title="Produtos"
              accent="fáceis de controlar"
              description="Escolha uma categoria e pause um item ou o grupo inteiro sem procurar em listas longas."
              metrics={[
                { label: 'produtos', value: apiProdutos.length },
                { label: 'disponíveis', value: apiProdutos.filter(item => item.ativo !== false).length },
                { label: apiProdutos.filter(item => item.ativo === false).length === 1 ? 'pausado' : 'pausados', value: apiProdutos.filter(item => item.ativo === false).length, valueClassName: apiProdutos.some(item => item.ativo === false) ? 'text-rose-600 dark:text-rose-300' : undefined },
                { label: 'categorias', value: apiCategorias.length },
              ]}
            />
            <CardapioProdutosTab
              produtos={apiProdutos}
              categorias={apiCategorias}
              catalogReady={catalogReady || apiProdutos.length > 0 || apiCategorias.length > 0}
              previewUrl={hasOnlineMenu && restauranteConfig?.restaurante_id
                ? `${window.location.origin}/cardapio?restaurante_id=${encodeURIComponent(String(restauranteConfig.restaurante_id))}`
                : undefined}
              onCreateProduct={() => {
                setEditingProduct(null);
                setProdFormId(suggestedProductCode);
                setProdFormNome('');
                setProdFormPreco('');
                setProdFormCategoriaId(apiCategorias[0]?.id || '');
                setProdFormDescricao('');
                setProdFormImagem('');
                setProdFormImagem2('');
                setProdFormImagem3('');
                setProdFormAtivo(true);
                setShowProductModal(true);
              }}
              onEditProduct={(product) => {
                setEditingProduct(product);
                setProdFormId(product.id);
                setProdFormNome(product.nome);
                setProdFormPreco(Number(product.preco) || 0);
                setProdFormCategoriaId(product.categoria_id || '');
                setProdFormDescricao(product.descricao || '');
                const gallery = product.imagens_galeria || [];
                setProdFormImagem(product.imagem || gallery[0] || '');
                setProdFormImagem2(gallery[1] || '');
                setProdFormImagem3(gallery[2] || '');
                setProdFormAtivo(product.ativo !== false);
                setShowProductModal(true);
              }}
              onDuplicateProduct={(product) => {
                setEditingProduct(null);
                setProdFormId(suggestedProductCode);
                setProdFormNome(`${product.nome} (Cópia)`);
                setProdFormPreco(Number(product.preco) || 0);
                setProdFormCategoriaId(product.categoria_id || '');
                setProdFormDescricao(product.descricao || '');
                const gallery = product.imagens_galeria || [];
                setProdFormImagem(product.imagem || gallery[0] || '');
                setProdFormImagem2(gallery[1] || '');
                setProdFormImagem3(gallery[2] || '');
                setProdFormAtivo(true);
                setShowProductModal(true);
              }}
              onRemoveProduct={async (product) => {
                if (!confirm(`Remover "${product.nome}" dos canais de venda? O histórico das vendas será preservado.`)) return;
                try {
                  const response = await fetch(`${apiBaseUrl}/produtos/${product.id}`, {
                    method: 'DELETE',
                    headers: authHeaders,
                  });
                  if (!response.ok) throw new Error('Não foi possível remover o produto.');
                  await fetchProdutos();
                  showToast('Produto removido dos canais de venda.');
                } catch (error) {
                  showToast(error instanceof Error ? error.message : 'Erro ao remover produto.', 'error');
                }
              }}
              onToggleProduct={async (product, ativo) => {
                const response = await fetch(`${apiBaseUrl}/produtos/${product.id}`, {
                  method: 'PUT',
                  headers: { ...authHeaders, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ativo }),
                });
                if (!response.ok) {
                  showToast('Não foi possível atualizar a disponibilidade.', 'error');
                  return;
                }
                await fetchProdutos();
                showToast(ativo ? 'Produto publicado.' : 'Produto pausado.');
              }}
              onSetCategoryAvailability={async (productIds, ativo) => {
                const response = await fetch(`${apiBaseUrl}/produtos/disponibilidade`, {
                  method: 'PATCH',
                  headers: { ...authHeaders, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ produto_ids: productIds, ativo }),
                });
                if (!response.ok) {
                  showToast('Não foi possível atualizar a categoria.', 'error');
                  return;
                }
                await fetchProdutos();
                showToast(ativo ? 'Produtos disponibilizados.' : 'Produtos pausados.');
              }}
              focusCategoryId={cardapioCategoryFocus}
              onFocusCategoryHandled={() => setCardapioCategoryFocus(null)}
            />
            </div>
          )}

          {/* ABA CATEGORIAS */}
          {activeTab === 'cardapio' && activeSubTab === 'categorias' && (
            <div className="space-y-4">
              <OperationalBanner
                id="menu-categories-heading"
                eyebrow="FLUXO DE PREPARO"
                title="Cada pedido"
                accent="vai ao lugar certo"
                description="Escolha quais categorias imprimem na cozinha, no bar ou não precisam de via de preparo."
              metrics={[
                { label: 'categorias', value: apiCategorias.length },
                { label: 'cozinha', value: apiCategorias.filter(category => category.destino_impressao === 'COZINHA').length },
                { label: 'bar', value: apiCategorias.filter(category => category.destino_impressao === 'BAR').length },
                { label: 'não imprimir', value: apiCategorias.filter(category => category.destino_impressao === 'NENHUM').length },
              ]}
            />
            <CardapioCategoriasTab
              apiCategorias={apiCategorias}
              apiProdutos={apiProdutos}
              apiBaseUrl={apiBaseUrl}
              authHeaders={authHeaders}
              fetchCategorias={fetchCategorias}
              showToast={showToast}
              onManageProducts={(categoryId) => {
                setCardapioCategoryFocus(categoryId);
                setActiveSubTab('produtos');
              }}
            />
            </div>
          )}

          {/* ABA COMPLEMENTOS */}
          {activeTab === 'cardapio' && ['complementos', 'adicionais', 'modificadores'].includes(activeSubTab) && (
            <div className="space-y-4">
              <ComplementosTab
                apiBaseUrl={apiBaseUrl}
                authHeaders={authHeaders}
                produtos={apiProdutos}
                onShowNotification={(msg, type) => showToast(msg, type === 'error' ? 'error' : 'success')}
              />
            </div>
          )}

          {/* ABA CUPONS */}
          {activeTab === 'clientes' && ['cupons', 'cupom', 'promocoes', 'descontos'].includes(activeSubTab) && (
            <div className="space-y-4">
              <CuponsTab
                apiBaseUrl={apiBaseUrl}
                authHeaders={authHeaders}
                onShowNotification={(msg, type) => showToast(msg, type === 'error' ? 'error' : 'success')}
              />
            </div>
          )}

          {/* LIVE VIEW: ESTOQUE DE INSUMOS */}
          {activeTab === 'estoque' && activeSubTab === 'insumos' && (
            <div className="space-y-4">
              <OperationalBanner
                id="stock-ingredients-heading"
                eyebrow={estoqueInsumos.length === 0 ? 'PRIMEIROS PASSOS' : 'ESTOQUE CONECTADO'}
                title={estoqueInsumos.length === 0 ? 'Estoque' : 'Reposição'}
                accent={estoqueInsumos.length === 0 ? 'pronto para configurar' : estoqueInsights.low > 0 ? 'pede atenção' : 'em dia'}
                description={estoqueInsumos.length === 0 ? 'Importe uma NF-e ou cadastre o primeiro ingrediente para começar o controle.' : estoqueInsights.linkedProducts > 0 ? 'Vendas com ficha técnica já baixam ingredientes automaticamente.' : 'Monte fichas técnicas para ativar a baixa automática nas vendas.'}
                metrics={estoqueInsumos.length === 0 ? [] : [
                  { label: 'ingredientes', value: estoqueInsumos.length },
                  { label: 'para repor', value: estoqueInsights.low, valueClassName: estoqueInsights.low > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300' },
                  { label: 'produtos integrados', value: `${estoqueInsights.linkedProducts}/${estoqueInsights.activeProducts}` },
                  { label: 'valor em estoque', value: formatCompactCurrency(estoqueInsights.inventoryValue) },
                ]}
              />
              <EstoqueIngredientesTab
                insumos={estoqueInsumos}
                fichasTecnicas={fichasTecnicas}
                onOpenRecipes={() => setShowFichaTecnicaModal(true)}
                onImportXml={() => {
                  setActiveSubTab('historico');
                  window.setTimeout(() => xmlFileInputRef.current?.click(), 0);
                }}
                onCreate={() => {
                  setInsumoFormNome('');
                  setInsumoFormMinimo(10);
                  setInsumoFormMaximo(50);
                  setInsumoFormUnidade('un');
                  setInsumoFormCusto(0);
                  setShowNewInsumoModal(true);
                }}
                onAdjust={insumo => {
                  setSelectedInsumo(insumo);
                  setAjusteQtd(0);
                  setAjusteTipo('ENTRADA');
                  setAjusteJustificativa('');
                  setShowAjusteInsumoModal(true);
                }}
                onEdit={insumo => {
                  setSelectedInsumo(insumo);
                  setInsumoFormNome(insumo.nome);
                  setInsumoFormMinimo(insumo.estoque_minimo);
                  setInsumoFormMaximo(insumo.estoque_maximo);
                  setInsumoFormUnidade(insumo.unidade_medida);
                  setInsumoFormCusto(insumo.preco_medio_custo);
                  setShowEditInsumoModal(true);
                }}
              />
            </div>
          )}

          {/* LIVE VIEW: HISTÓRICO UNIFICADO DE ESTOQUE */}
          {activeTab === 'estoque' && ['historico', 'entradas', 'xml', 'notas_entrada', 'movimentacoes'].includes(activeSubTab) && (
            <div className="space-y-4">
            <OperationalBanner
              id="stock-history-heading"
              eyebrow="HISTÓRICO DO ESTOQUE"
              title="Tudo que mudou"
              accent="em um só lugar"
              description="Compras, vendas, perdas, ajustes e inventários aparecem em uma única linha do tempo."
              metrics={movimentacoesEstoque.length === 0 && entradasEstoque.length === 0 ? [] : [
                { label: 'movimentos', value: movimentacoesEstoque.length },
                { label: 'entradas', value: entradasEstoque.length },
                { label: 'baixas por venda', value: movimentacoesEstoque.filter(item => item.origem === 'venda_automatica').length },
                { label: 'perdas', value: movimentacoesEstoque.filter(item => item.tipo === 'perda').length, valueClassName: movimentacoesEstoque.some(item => item.tipo === 'perda') ? 'text-amber-600 dark:text-amber-300' : undefined },
              ]}
            />
            <EstoqueHistoricoTab
              entradas={entradasEstoque}
              notasEntradaXml={notasEntrada}
              movimentacoes={movimentacoesEstoque}
              insumos={estoqueInsumos}
              isLoading={isLoading}
              onOpenNovaEntradaModal={() => setShowEntradaManualModal(true)}
              onOpenNovaMovimentacaoModal={() => setShowMovimentacaoModal(true)}
              onUploadXmlFile={async (file: File) => {
                if (!file || !file.name.endsWith('.xml')) {
                  setXmlUploadState(s => ({ ...s, error: 'Por favor, selecione um arquivo .xml válido.', result: null }));
                  return;
                }
                setXmlUploadState(s => ({ ...s, loading: true, error: null, result: null }));
                const formData = new FormData();
                formData.append('file', file);
                try {
                  const res = await fetch(`${apiBaseUrl}/estoque/importar-xml`, {
                    method: 'POST',
                    headers: authHeaders,
                    body: formData
                  });
                  const json = await res.json();
                  if (!res.ok) throw new Error(json.detail || 'Erro ao importar XML.');
                  setXmlUploadState(s => ({ ...s, loading: false, result: json }));
                  // Refresh all estoque data
                  fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setEstoqueInsumos(d); });
                  fetch(`${apiBaseUrl}/estoque/notas`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setNotasEntrada(d); });
                  fetch(`${apiBaseUrl}/estoque/entradas`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setEntradasEstoque(d); });
                  fetch(`${apiBaseUrl}/estoque/distribuidores`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setDistribuidores(d); });
                } catch (err: any) {
                  setXmlUploadState(s => ({ ...s, loading: false, error: err.message || 'Erro desconhecido.' }));
                }
              }}
              xmlUploadState={xmlUploadState}
              onResetXmlState={() => setXmlUploadState(s => ({ ...s, result: null, error: null }))}
              xmlFileInputRef={xmlFileInputRef}
              onRefresh={() => {
                fetch(`${apiBaseUrl}/estoque/entradas`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setEntradasEstoque(d); });
                fetch(`${apiBaseUrl}/estoque/movimentacoes`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setMovimentacoesEstoque(d); });
                fetch(`${apiBaseUrl}/estoque/notas`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setNotasEntrada(d); });
              }}
            />
            </div>
          )}

          {/* LIVE VIEW: CONTAGEM FÍSICA (INVENTÁRIO) */}
          {activeTab === 'estoque' && ['inventario', 'contagem'].includes(activeSubTab) && (
            <div className="space-y-4">
            <OperationalBanner
              id="stock-inventory-heading"
              eyebrow="CONFERÊNCIA"
              title={sessoesContagemEstoque.length === 0 ? 'Faça a primeira' : 'Estoque real'}
              accent={sessoesContagemEstoque.length === 0 ? 'conferência' : 'sob controle'}
              description={sessoesContagemEstoque.length === 0 ? 'Compare o estoque físico com o saldo do sistema e registre as diferenças com segurança.' : 'Conte fisicamente, salve como rascunho e aplique as diferenças somente ao confirmar.'}
              metrics={sessoesContagemEstoque.length === 0 ? [] : [
                { label: 'inventários', value: sessoesContagemEstoque.length },
                { label: 'rascunhos', value: estoqueInsights.drafts, valueClassName: estoqueInsights.drafts > 0 ? 'text-amber-600 dark:text-amber-300' : undefined },
                { label: 'ingredientes', value: estoqueInsumos.length },
              ]}
            />
            <EstoqueContagemTab
              contagens={sessoesContagemEstoque}
              isLoading={isLoading}
              onOpenNovaContagemModal={(sessaoId?: string) => {
                setSelectedContagemId(sessaoId || null);
                setShowContagemModal(true);
              }}
              onRefreshContagens={() => {
                fetch(`${apiBaseUrl}/estoque/contagens`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setSessoesContagemEstoque(d); });
              }}
            />
            </div>
          )}

          {/* LIVE VIEW: DISTRIBUIDORES */}
          {activeTab === 'estoque' && activeSubTab === 'fornecedores' && (
            <div className="space-y-4">
              <OperationalBanner
                id="stock-suppliers-heading"
                eyebrow="COMPRAS"
                title="Reposição"
                accent="mais previsível"
                description="Mantenha contatos e prazos de entrega organizados; fornecedores de NF-e entram automaticamente."
                metrics={distribuidores.length === 0 ? [] : [
                  { label: 'fornecedores', value: distribuidores.length },
                  { label: 'com CNPJ', value: distribuidores.filter(item => Boolean(item.cnpj)).length },
                  ...(distribuidores.length > 0 ? [{ label: 'prazo médio', value: `${Math.round(distribuidores.reduce((sum, item) => sum + Number(item.lead_time_dias || 0), 0) / distribuidores.length)} dias` }] : []),
                ]}
              />
              <EstoqueFornecedoresTab
                fornecedores={distribuidores}
                onCreate={() => {
                  setDistFormNomeFantasia('');
                  setDistFormRazaoSocial('');
                  setDistFormCnpj('');
                  setDistFormLeadTime(3);
                  setShowNewDistModal(true);
                }}
                onEdit={fornecedor => {
                  setSelectedDist(fornecedor);
                  setDistFormNomeFantasia(fornecedor.nome_fantasia || '');
                  setDistFormRazaoSocial(fornecedor.razao_social || '');
                  setDistFormCnpj(fornecedor.cnpj || '');
                  setDistFormLeadTime(fornecedor.lead_time_dias ?? 3);
                  setShowEditDistModal(true);
                }}
                onDelete={fornecedor => void handleDeleteDistribuidor(fornecedor.id)}
              />
            </div>
          )}

          {/* MÓDULO CAIXA REORGANIZADO */}
          {activeTab === 'financeiro' && (activeSubTab === 'turno_atual' || activeSubTab === 'fluxo') && (
            <div className={clsx('orders-workspace', 'space-y-4')}>
              <OperationalBanner
                id="cash-heading"
                eyebrow="CAIXA"
                title="Turno atual"
                accent={turnoResumo?.turno_esquecido ? 'precisa de revisão' : turnoResumo?.status === 'aberto' ? 'em ordem' : 'ainda fechado'}
                description={turnoResumo?.turno_esquecido ? 'Este turno está aberto há mais de 24 horas. Confira os valores e encerre quando possível.' : 'Veja o dinheiro, os recebimentos e o que precisa de atenção.'}
                metrics={[
                  { label: 'aberto há', value: turnoResumo?.status === 'aberto' ? formatDuration(turnoResumo.tempo_aberto_minutos) : '—' },
                  { label: 'ritmo de vendas', value: turnoResumo?.status === 'aberto' ? `${formatCompactCurrency(cashSalesPerHour)}/h` : '—' },
                  {
                    label: 'situação do turno',
                    value: cashShiftHealth,
                    valueClassName: turnoResumo?.turno_esquecido ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300',
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

          {activeTab === 'financeiro' && (activeSubTab === 'movimentacoes' || activeSubTab === 'ajustes' || activeSubTab === 'suprimento' || activeSubTab === 'sangria') && (
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
                  { label: 'aberto há', value: turnoResumo?.status === 'aberto' ? formatDuration(turnoResumo.tempo_aberto_minutos) : '—' },
                  { label: 'pagamentos pendentes', value: pagamentosPendentes.length, valueClassName: pagamentosPendentes.length > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300' },
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
          {activeTab === 'clientes' && ['clientes', 'crm', 'banco_clientes'].includes(activeSubTab) && (
            <div className={clsx('space-y-3.5', 'text-left', 'animate-fade-in')}>
              <OperationalBanner
                id="customers-heading"
                eyebrow="RELACIONAMENTO"
                title="Clientes"
                accent="em uma única lista"
                description="Encontre contatos rapidamente e acompanhe os benefícios sem repetir cadastros."
                metrics={[
                  { label: loyaltyUsers.length === 1 ? 'cliente' : 'clientes', value: loyaltyUsers.length },
                  { label: 'programa de fidelidade', value: fidelidadeConfig.ativo ? 'Ativo' : 'Pausado', valueClassName: fidelidadeConfig.ativo ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300' },
                ]}
              />
              <section className="koma-toolbar">
                <div className="koma-toolbar__search">
                  <Search size={14} aria-hidden="true" />
                  <input value={clientesSearch} onChange={event => setClientesSearch(event.target.value)} placeholder="Buscar por nome ou WhatsApp…" aria-label="Buscar clientes" />
                  {clientesSearch && <button type="button" onClick={() => setClientesSearch('')} aria-label="Limpar busca"><X size={13} /></button>}
                </div>
                {(clientesSearch || filteredLoyaltyUsers.length !== loyaltyUsers.length) && (
                  <p className="shrink-0 text-[10px] font-medium text-koma-muted"><strong className="font-mono text-koma-foreground">{filteredLoyaltyUsers.length}</strong> de {loyaltyUsers.length} {loyaltyUsers.length === 1 ? 'cliente' : 'clientes'}</p>
                )}
                <div className="koma-toolbar__actions">
                  <button
                    type="button"
                    onClick={() => {
                      setNewCrmNome('');
                      setNewCrmTelefone('');
                      setNewCrmSaldo(0);
                      setShowNewCrmModal(true);
                    }}
                    className="koma-btn-success"
                  >
                    <Plus size={14} /> Novo cliente
                  </button>
                </div>
              </section>

              <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'rounded-2xl', 'p-3', 'space-y-4', 'shadow-xs')}>
                {filteredLoyaltyUsers.length > 0 ? (
                  <div className={clsx('overflow-x-auto', 'border', 'border-koma-border', 'rounded-2xl')}>
                    <table className={clsx('w-full', 'text-left', 'text-xs')}>
                      <thead>
                        <tr className={clsx('bg-koma-raised', 'border-b', 'border-koma-border', 'text-koma-muted', 'uppercase', 'tracking-wider', 'font-extrabold', 'text-[9px]')}>
                          <th className="p-3.5">Nome do Cliente</th>
                          <th className="p-3.5">WhatsApp</th>
                          <th className={clsx('p-3.5', 'font-mono')}>Pontos disponíveis</th>
                          <th className={clsx('p-3.5', 'text-right')}>Ações</th>
                        </tr>
                      </thead>
                      <tbody className={clsx('divide-y', 'divide-koma-border')}>
                        {filteredLoyaltyUsers.map((user) => (
                          <tr key={user.id} className={clsx('hover:bg-koma-raised/50', 'transition-colors')}>
                            <td className={clsx('p-3.5', 'font-bold', 'text-koma-foreground')}>{user.cliente}</td>
                            <td className={clsx('p-3.5', 'font-mono', 'text-koma-muted', 'text-xs')}>{formatarTelefoneTabela(user.telefone)}</td>
                            <td className={clsx('p-3.5', 'font-mono', 'text-emerald-700 dark:text-emerald-400', 'font-extrabold', 'text-xs')}>
                              {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? `${user.pontos} pts` : `R$ ${user.saldoCashback.toFixed(2)}`}
                            </td>
                            <td className={clsx('p-3.5', 'text-right')}>
                              <button
                                onClick={() => {
                                  setEditingCrmUser(user);
                                  setCrmFormNome(user.cliente);
                                  setCrmFormTelefone(aplicarMascaraTelefoneInput(user.telefone));
                                  setCrmFormPontos(user.pontos || 0);
                                  setCrmFormCashback(user.saldoCashback || 0);
                                }}
                                className={clsx('px-3.5', 'py-1.5', 'koma-btn-secondary', 'rounded-xl', 'transition-all', 'cursor-pointer', 'font-bold', 'text-xs')}
                              >
                                Editar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <KomaEmptyState
                    icon={<Users size={24} className="text-koma-muted" />}
                    title={loyaltyUsers.length === 0 ? 'Nenhum cliente cadastrado ainda' : 'Nenhum cliente encontrado'}
                    description={loyaltyUsers.length === 0 ? 'Cadastre clientes ou aguarde os primeiros pedidos identificados no cardápio e balcão.' : 'Ajuste ou limpe a busca para ver outros clientes.'}
                    action={loyaltyUsers.length === 0 ? {
                      label: 'Cadastrar primeiro cliente',
                      onClick: () => {
                        setNewCrmNome('');
                        setNewCrmTelefone('');
                        setNewCrmSaldo(0);
                        setShowNewCrmModal(true);
                      },
                    } : { label: 'Limpar busca', onClick: () => setClientesSearch(''), variant: 'secondary' }}
                    variant="panel"
                  />
                )}
              </div>
            </div>
          )}

          {/* VIEW: FRETISTAS & LOGÍSTICA */}
          {activeSubTab === 'entregadores' && (
            <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5', 'animate-fade-in', 'text-left')}>

              {/* Painel de Entregas (Colunas da Esquerda) */}
              <div className={clsx('lg:col-span-2', 'bg-koma-card/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-5', 'flex', 'flex-col', 'overflow-hidden')}>
                <div className={clsx('border-b', 'border-koma-border', 'pb-3', 'shrink-0')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary', 'block', 'text-sm')}>Controle de Despacho e Entregas</span>
                  <span className={clsx('text-[9px]', 'text-koma-muted', 'block')}>Gerencie o fluxo de saída e entrega de pedidos de Delivery.</span>
                </div>

                {/* Pedidos Pendentes de Envio */}
                <div className={clsx('space-y-3', 'flex-1', 'overflow-y-auto')}>
                  <span className={clsx('text-[10px]', 'font-bold', 'text-emerald-700 dark:text-emerald-400', 'uppercase', 'tracking-wider', 'block')}>Pedidos para Despachar</span>

                  {deliveryOrders.filter(o => o.status === 'producao' || o.status === 'analise').length === 0 ? (
                    <div className={clsx('py-8', 'text-center', 'text-koma-muted', 'text-xs', 'italic', 'bg-koma-panel/20', 'border', 'border-koma-border/40', 'rounded-2xl')}>
                      Não há pedidos prontos ou em produção aguardando despacho no momento.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {deliveryOrders.filter(o => o.status === 'producao' || o.status === 'analise').map((order) => {
                        const motoboyId = selectedMotoboys[order.id] || '';
                        return (
                          <div key={order.id} className={clsx('p-4', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-2xl', 'flex', 'flex-col', 'sm:flex-row', 'justify-between', 'gap-3', 'text-xs')}>
                            <div className={clsx('space-y-1.5', 'flex-1')}>
                              <div className={clsx('flex', 'items-center', 'gap-2')}>
                                <span className={clsx('font-bold', 'text-koma-foreground', 'text-[11px]')}>Pedido {order.id}</span>
                                <span className={clsx('bg-emerald-500/15', 'text-emerald-700 dark:text-emerald-400', 'text-[8px]', 'font-bold', 'px-1.5', 'py-0.5', 'rounded', 'border', 'border-emerald-500/30', 'uppercase')}>
                                  {order.canal}
                                </span>
                              </div>
                              <span className={clsx('text-koma-secondary', 'font-bold', 'block')}>{order.cliente} • {order.telefone}</span>
                              <span className={clsx('text-koma-subtle', 'text-[10px]', 'block', 'leading-relaxed')}>{order.endereco}</span>
                              <span className={clsx('text-[9px]', 'text-koma-muted', 'block', 'font-mono')}>Itens: {order.itens}</span>
                            </div>

                            <div className={clsx('flex', 'flex-col', 'sm:items-end', 'justify-between', 'gap-2', 'shrink-0')}>
                              <span className={clsx('font-mono', 'font-bold', 'text-emerald-400', 'text-[11px]')}>R$ {order.total.toFixed(2)}</span>

                              <div className={clsx('flex', 'items-center', 'gap-2')}>
                                <select
                                  value={motoboyId}
                                  onChange={(e) => setSelectedMotoboys(prev => ({ ...prev, [order.id]: e.target.value }))}
                                  className={clsx('py-1.5', 'px-2', 'bg-koma-card', 'border', 'border-koma-border', 'text-koma-foreground', 'rounded-xl', 'text-[10px]', 'focus:outline-none', 'focus:border-[#10b981]')}
                                >
                                  <option value="">Selecione o Entregador...</option>
                                  {motoboys.filter(m => m.ativo).map(m => (
                                    <option key={m.id} value={m.id}>{m.nome}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={!motoboyId}
                                  onClick={() => handleDespacharKanban(order.id, motoboyId)}
                                  className={clsx('py-1.5', 'px-3', 'bg-emerald-600', 'hover:bg-emerald-500', 'disabled:opacity-50', 'text-white', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                                >
                                  Despachar
                                </button>
                                <button
                                  type="button"
                                  disabled={!motoboyId}
                                  onClick={() => handleDespacharWhatsApp(order, motoboyId)}
                                  className={clsx('py-1.5', 'px-2.5', 'bg-[#10b981]/20', 'hover:bg-[#10b981]/30', 'border', 'border-[#10b981]/40', 'disabled:opacity-40', 'text-emerald-600 dark:text-emerald-300', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer', 'flex', 'items-center', 'gap-1')}
                                  title="Despachar pedido e enviar link PWA pelo WhatsApp do Motoboy"
                                >
                                  WhatsApp
                                </button>
                                <button
                                  type="button"
                                  disabled={!motoboyId}
                                  onClick={() => handleRevogarAcessoMotoboy(motoboyId)}
                                  className={clsx('py-1.5', 'px-2.5', 'bg-rose-500/20', 'hover:bg-rose-500/30', 'border', 'border-rose-500/40', 'disabled:opacity-40', 'text-rose-600 dark:text-rose-300', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer', 'flex', 'items-center', 'gap-1')}
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
                  <span className={clsx('text-[10px]', 'font-bold', 'text-emerald-700 dark:text-emerald-400', 'uppercase', 'tracking-wider', 'block', 'pt-4')}>Em Trânsito (Entregas Ativas)</span>

                  {deliveryOrders.filter(o => o.status === 'pronto').length === 0 ? (
                    <div className={clsx('py-8', 'text-center', 'text-koma-muted', 'text-xs', 'italic', 'bg-koma-panel/20', 'border', 'border-koma-border/40', 'rounded-2xl')}>
                      Nenhum pedido em trânsito no momento.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {deliveryOrders.filter(o => o.status === 'pronto').map((order) => {
                        return (
                          <div key={order.id} className={clsx('p-4', 'bg-koma-panel/40', 'border', 'border-koma-border/40', 'rounded-2xl', 'flex', 'flex-col', 'sm:flex-row', 'justify-between', 'gap-3', 'text-xs')}>
                            <div className={clsx('space-y-1', 'flex-1')}>
                              <div className={clsx('flex', 'items-center', 'gap-2')}>
                                <span className={clsx('font-bold', 'text-koma-foreground', 'text-[11px]')}>Pedido {order.id}</span>
                                <span className={clsx('bg-emerald-500/10', 'text-emerald-400', 'text-[8px]', 'font-bold', 'px-1.5', 'py-0.5', 'rounded', 'border', 'border-emerald-500/20', 'uppercase', 'tracking-wider')}>
                                  Em Trânsito
                                </span>
                              </div>
                              <span className={clsx('text-koma-secondary', 'font-bold', 'block')}>{order.cliente} • {order.telefone}</span>
                              <span className={clsx('text-koma-subtle', 'text-[10px]', 'block', 'leading-relaxed')}>{order.endereco}</span>
                            </div>

                            <div className={clsx('flex', 'flex-col', 'sm:items-end', 'justify-between', 'gap-2', 'shrink-0')}>
                              <span className={clsx('font-mono', 'font-bold', 'text-emerald-400', 'text-[11px]')}>R$ {order.total.toFixed(2)}</span>

                              <button
                                type="button"
                                onClick={() => handleFinalizarPedido(order.id)}
                                className={clsx('py-1.5', 'px-3', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
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
              <div className={clsx('bg-koma-card/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-4', 'flex', 'flex-col', 'justify-between', 'overflow-hidden')}>
                <div className={clsx('space-y-4', 'flex-1', 'flex', 'flex-col', 'overflow-hidden')}>
                  <div className={clsx('border-b', 'border-koma-border', 'pb-3', 'shrink-0')}>
                    <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary', 'block', 'text-sm')}>Fretistas Cadastrados</span>
                    <span className={clsx('text-[9px]', 'text-koma-muted', 'block')}>Lista de motoboys e entregadores de plantão.</span>
                  </div>

                  <div className={clsx('flex-1', 'overflow-y-auto', 'space-y-2.5')}>
                    {motoboys.length === 0 ? (
                      <span className={clsx('text-xs', 'text-koma-muted', 'italic')}>Nenhum fretista cadastrado.</span>
                    ) : (
                      motoboys.map((m) => (
                        <div key={m.id} className={clsx('p-3', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'flex', 'items-center', 'justify-between', 'gap-2')}>
                          <div className="text-xs">
                            <span className={clsx('font-bold', 'text-koma-foreground', 'block')}>{m.nome}</span>
                            <span className={clsx('text-[10px]', 'text-koma-subtle', 'block', 'font-mono')}>{m.telefone}</span>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${m.ativo ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}>
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
                  <span className={clsx('text-[10px]', 'font-bold', 'text-emerald-700 dark:text-emerald-400', 'uppercase', 'tracking-wider', 'block')}>Novo Fretista</span>

                  <input
                    type="text"
                    required
                    placeholder="Nome do Entregador"
                    value={novoMotoboyNome}
                    onChange={(e) => setNewMotoboyNome(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-page', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
                  <input
                    type="text"
                    required
                    placeholder="Telefone (ex: 81 99999-8888)"
                    value={novoMotoboyTelefone}
                    onChange={(e) => setNewMotoboyTelefone(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-page', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'font-mono', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
                  <button
                    type="submit"
                    className={clsx('w-full', 'py-2', 'bg-emerald-600', 'hover:bg-[#9d2b3c]', 'text-white', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                  >
                    Adicionar Fretista
                  </button>
                </form>
              </div>

            </div>
          )}

          {/* CONFIGURAÇÃO CARDÁPIO DIGITAL WHITELABEL */}
          {(activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital') && !hasOnlineMenu && (
            <div className={clsx('bg-koma-card', 'border', 'border-amber-500/20', 'rounded-3xl', 'p-8', 'text-center', 'max-w-xl', 'mx-auto', 'space-y-3')}>
              <Lock size={24} className={clsx('text-amber-400', 'mx-auto')} />
              <h3 className={clsx('text-koma-foreground', 'font-bold')}>Cardápio online não incluído neste plano</h3>
              <p className={clsx('text-[10px]', 'text-koma-subtle')}>
                No Kôma Pro, ele pode ser contratado por R$ {ONLINE_MENU_ADDON.price}/mês. No Kôma Premium, link, QR Code e gaveta de aceite já estão incluídos.
              </p>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('assinatura_pix');
                  setActiveSubTab('planos');
                }}
                className={clsx('px-4', 'py-2', 'rounded-xl', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'text-[10px]', 'font-bold', 'uppercase', 'cursor-pointer')}
              >
                Ver opções
              </button>
            </div>
          )}

          {(activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital') && hasOnlineMenu && (
            <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-12', 'gap-6', 'max-w-6xl', 'mx-auto', 'text-left', 'animate-fade-in')}>
              {/* Coluna 1: Formulário de Configuração (7 cols) */}
              <div className={clsx('lg:col-span-7', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-3xl', 'p-6', 'space-y-6', 'shadow-xs')}>
                <div className={clsx('border-b', 'border-koma-border', 'pb-3')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-base', 'text-koma-foreground', 'block')}>Configurações do cardápio online</span>
                  <span className={clsx('text-[11px]', 'text-koma-muted', 'block', 'mt-1')}>Defina a aparência, as informações e o comportamento do cardápio que seus clientes acessam online.</span>
                </div>

                <div className="space-y-4">
                  {/* Status Override */}
                  <div className="space-y-1.5">
                    <label className={clsx('text-[10px]', 'font-bold', 'text-koma-muted', 'uppercase', 'tracking-wider', 'block')}>Status de Funcionamento:</label>
                    <select
                      value={cardapioStatusOverride}
                      onChange={(e) => setCardapioStatusOverride(e.target.value)}
                      className={clsx('w-full', 'px-3.5', 'py-2.5', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'font-medium', 'focus:outline-none', 'focus:border-emerald-500/60')}
                    >
                      <option value="Automático">Automático (Segue horários de funcionamento)</option>
                      <option value="Forçado Aberto">Forçado Aberto (Sempre aberto para pedidos)</option>
                      <option value="Forçado Fechado">Forçado Fechado (Sempre fechado/indisponível)</option>
                    </select>
                  </div>

                  {/* Cores */}
                  <div className={clsx('grid', 'grid-cols-1', 'sm:grid-cols-2', 'gap-4')}>
                    <div className="space-y-1.5">
                      <label className={clsx('text-[10px]', 'font-bold', 'text-koma-muted', 'uppercase', 'tracking-wider', 'block')}>Cor Primária (Destaques):</label>
                      <div className={clsx('flex', 'gap-2')}>
                        <input
                          type="color"
                          value={cardapioCorPrimaria}
                          onChange={(e) => setCardapioCorPrimaria(e.target.value)}
                          className={clsx('w-10', 'h-10', 'p-0', 'border', 'border-koma-border', 'rounded-xl', 'bg-transparent', 'cursor-pointer')}
                        />
                        <input
                          type="text"
                          value={cardapioCorPrimaria}
                          onChange={(e) => setCardapioCorPrimaria(e.target.value)}
                          className={clsx('flex-1', 'px-3.5', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'font-mono', 'focus:outline-none', 'focus:border-emerald-500/60')}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className={clsx('text-[10px]', 'font-bold', 'text-koma-muted', 'uppercase', 'tracking-wider', 'block')}>Cor de Fundo:</label>
                      <div className={clsx('flex', 'gap-2')}>
                        <input
                          type="color"
                          value={cardapioCorFundo}
                          onChange={(e) => setCardapioCorFundo(e.target.value)}
                          className={clsx('w-10', 'h-10', 'p-0', 'border', 'border-koma-border', 'rounded-xl', 'bg-transparent', 'cursor-pointer')}
                        />
                        <input
                          type="text"
                          value={cardapioCorFundo}
                          onChange={(e) => setCardapioCorFundo(e.target.value)}
                          className={clsx('flex-1', 'px-3.5', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'font-mono', 'focus:outline-none', 'focus:border-emerald-500/60')}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Upload de Logo e Banner para Supabase Storage via Endpoints Backend */}
                  <div className="space-y-4">
                    <CardapioAssetUploader
                      label="Logotipo do Restaurante"
                      type="logo"
                      currentUrl={cardapioLogoUrl}
                      apiBaseUrl={apiBaseUrl}
                      authHeaders={authHeaders}
                      onSuccess={(newUrl) => setCardapioLogoUrl(newUrl || '')}
                    />

                    <CardapioAssetUploader
                      label="Banner Promocional / Capa"
                      type="banner"
                      currentUrl={cardapioBannerUrl}
                      apiBaseUrl={apiBaseUrl}
                      authHeaders={authHeaders}
                      onSuccess={(newUrl) => setCardapioBannerUrl(newUrl || '')}
                    />
                  </div>

                  {/* Sobre Nós */}
                  <div className="space-y-1.5">
                    <label className={clsx('text-[10px]', 'font-bold', 'text-koma-muted', 'uppercase', 'tracking-wider', 'block')}>Sobre Nós:</label>
                    <textarea
                      value={cardapioSobreNos}
                      onChange={(e) => setCardapioSobreNos(e.target.value)}
                      rows={3}
                      placeholder="Breve história ou descrição do restaurante..."
                      className={clsx('w-full', 'px-3.5', 'py-2.5', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'focus:outline-none', 'focus:border-emerald-500/60')}
                    />
                  </div>

                  {/* Endereço */}
                  <div className="space-y-1.5">
                    <label className={clsx('text-[10px]', 'font-bold', 'text-koma-muted', 'uppercase', 'tracking-wider', 'block')}>Endereço Físico:</label>
                    <input
                      type="text"
                      value={cardapioEndereco}
                      onChange={(e) => setCardapioEndereco(e.target.value)}
                      placeholder="Rua Exemplo, 123 - Centro"
                      className={clsx('w-full', 'px-3.5', 'py-2.5', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'focus:outline-none', 'focus:border-emerald-500/60')}
                    />
                  </div>
                </div>

                {/* Botão de salvar */}
                <div className={clsx('pt-4', 'border-t', 'border-koma-border', 'flex', 'justify-end')}>
                  <button
                    type="button"
                    disabled={isSavingCardapioConfig}
                    onClick={saveCardapioConfig}
                    className={clsx('px-6', 'py-2.5', 'koma-btn-success', 'rounded-xl', 'text-xs', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer', 'shadow-sm', 'disabled:opacity-50')}
                  >
                    {isSavingCardapioConfig ? 'Salvando...' : 'Salvar configurações'}
                  </button>
                </div>
              </div>

              {/* Coluna 2: Live Mobile Mockup Preview (5 cols) */}
              <div className="lg:col-span-5 flex flex-col items-center">
                <div className="sticky top-6 w-full max-w-[320px] bg-koma-panel border border-koma-border rounded-[2.5rem] p-3 shadow-md space-y-3">
                  {/* Top Phone speaker */}
                  <div className="flex justify-center items-center gap-2 pt-1 pb-2">
                    <div className="w-12 h-1 bg-koma-border rounded-full" />
                    <div className="w-2.5 h-2.5 rounded-full bg-koma-border" />
                  </div>

                  {/* Phone Screen Canvas */}
                  <div
                    className="rounded-[1.75rem] overflow-hidden border border-koma-border/80 text-left transition-colors duration-300 min-h-[460px] flex flex-col"
                    style={{ backgroundColor: cardapioCorFundo || '#ffffff' }}
                  >
                    {/* Header Banner */}
                    <div
                      className="h-28 w-full bg-cover bg-center relative flex items-end p-3"
                      style={{
                        backgroundColor: cardapioCorPrimaria || '#00875f',
                        backgroundImage: cardapioBannerUrl ? `url(${cardapioBannerUrl})` : undefined,
                      }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                      <div className="relative z-10 flex items-center gap-2.5">
                        {cardapioLogoUrl ? (
                          <img src={cardapioLogoUrl} alt="Logo" className="w-10 h-10 rounded-xl object-contain bg-white p-0.5 border border-white/20 shadow-xs" />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-white text-zinc-900 font-bold flex items-center justify-center text-xs shadow-xs">
                            Kôma
                          </div>
                        )}
                        <div className="text-white">
                          <h5 className="font-bold text-xs leading-tight drop-shadow-xs">Restaurante Gourmet</h5>
                          <span
                            className="inline-block text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md mt-0.5"
                            style={{ backgroundColor: cardapioCorPrimaria || '#00875f', color: '#ffffff' }}
                          >
                            {cardapioStatusOverride === 'Forçado Fechado' ? 'Fechado' : 'Aberto'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Content Preview */}
                    <div className="p-3 space-y-3 flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        {/* Sobre nós snippet */}
                        {cardapioSobreNos && (
                          <p className="text-[10px] text-zinc-600 dark:text-zinc-300 line-clamp-2 leading-relaxed italic">
                            "{cardapioSobreNos}"
                          </p>
                        )}

                        {/* Dummy Menu Categories */}
                        <div className="flex gap-1.5 overflow-x-hidden pt-1">
                          <span
                            className="text-[9px] font-bold px-2.5 py-1 rounded-full text-white shadow-2xs"
                            style={{ backgroundColor: cardapioCorPrimaria || '#00875f' }}
                          >
                            Destaques
                          </span>
                          <span className="text-[9px] font-bold px-2.5 py-1 rounded-full bg-zinc-200/80 text-zinc-700">
                            Pratos
                          </span>
                          <span className="text-[9px] font-bold px-2.5 py-1 rounded-full bg-zinc-200/80 text-zinc-700">
                            Bebidas
                          </span>
                        </div>

                        {/* Dummy Menu Cards */}
                        <div className="space-y-1.5 pt-1">
                          <div className="p-2 rounded-xl bg-white/90 border border-zinc-200 shadow-2xs flex justify-between items-center text-zinc-900">
                            <div>
                              <strong className="block text-[10px] font-bold">Filé Mignon ao Molho Madeira</strong>
                              <span className="text-[8px] text-zinc-500">Acompanha arroz e batatas rústicas</span>
                              <span className="block text-[10px] font-bold font-mono mt-0.5" style={{ color: cardapioCorPrimaria || '#00875f' }}>
                                R$ 68,90
                              </span>
                            </div>
                            <div className="w-10 h-10 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center text-[8px] text-zinc-400">
                              Foto
                            </div>
                          </div>

                          <div className="p-2 rounded-xl bg-white/90 border border-zinc-200 shadow-2xs flex justify-between items-center text-zinc-900">
                            <div>
                              <strong className="block text-[10px] font-bold">Salmão Grelhado com Legumes</strong>
                              <span className="text-[8px] text-zinc-500">Salmão fresco com azeite de ervas</span>
                              <span className="block text-[10px] font-bold font-mono mt-0.5" style={{ color: cardapioCorPrimaria || '#00875f' }}>
                                R$ 74,50
                              </span>
                            </div>
                            <div className="w-10 h-10 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center text-[8px] text-zinc-400">
                              Foto
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Bottom Order Bar */}
                      <div
                        className="w-full py-2 px-3 rounded-xl text-white font-bold text-[10px] flex justify-between items-center shadow-xs"
                        style={{ backgroundColor: cardapioCorPrimaria || '#00875f' }}
                      >
                        <span>Ver Sacola (2 itens)</span>
                        <span className="font-mono">R$ 143,40</span>
                      </div>
                    </div>
                  </div>

                  <span className="text-[9px] text-koma-subtle block text-center font-medium">
                    Preview em tempo real do Cardápio Whitelabel
                  </span>
                </div>
              </div>
            </div>
          )}

        </div>
      </main >

      {/* 1. MODAL: ABRIR CAIXA */}
      {
        showAbrirModal && (
          <div
            onClick={(e) => { if (e.target === e.currentTarget) setShowAbrirModal(false); }}
            className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'cursor-pointer')}
          >
            <form onSubmit={handleAbrirCaixa} className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'rounded-3xl', 'w-full', 'max-w-sm', 'p-6', 'space-y-5', 'shadow-2xl', 'animate-scale-in')}>
              <div className={clsx('flex', 'justify-between', 'items-center', 'border-b', 'border-koma-border', 'pb-3')}>
                <h3 className={clsx('font-serif', 'font-bold', 'text-lg', 'text-koma-foreground')}>Abertura de Caixa</h3>
                <button type="button" onClick={() => setShowAbrirModal(false)} className={clsx('p-1', 'hover:bg-koma-raised', 'rounded-full', 'text-koma-subtle', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}><X size={16} /></button>
              </div>

              <div className="space-y-1.5">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-secondary', 'uppercase', 'tracking-wider', 'block')}>Fundo de Troco Inicial (R$):</label>
                <div className="relative">
                  <span className={clsx('absolute', 'left-3.5', 'top-3', 'text-koma-subtle', 'font-mono')}>R$</span>
                  <MoneyInput
                    required
                    value={saldoInicial}
                    onValueChange={setSaldoInicial}
                    className={clsx('w-full', 'pl-9', 'pr-4', 'py-2.5', 'bg-koma-card', 'border', 'border-koma-border', 'rounded-xl', 'focus:outline-none', 'focus:ring-2', 'focus:ring-[#10b981]/20', 'focus:border-[#10b981]', 'text-koma-foreground', 'font-mono')}
                  />
                </div>
              </div>

              {errorMsg && (
                <div className={clsx('bg-rose-500/10', 'border', 'border-rose-500/25', 'text-rose-400', 'p-2.5', 'rounded-xl', 'text-center', 'font-medium', 'block')}>
                  {errorMsg}
                </div>
              )}

              <div className={clsx('flex', 'gap-2.5')}>
                <button type="button" onClick={() => setShowAbrirModal(false)} className={clsx('flex-1', 'py-2.5', 'bg-koma-card', 'hover:bg-koma-raised', 'border', 'border-koma-border', 'text-koma-foreground', 'rounded-xl', 'transition-all', 'cursor-pointer', 'font-bold')}>Cancelar</button>
                <button type="submit" className={clsx('flex-1', 'py-2.5', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded-xl', 'transition-all', 'cursor-pointer', 'font-bold', 'shadow-md')}>Confirmar Abertura</button>
              </div>
            </form>
          </div>
        )
      }

      {/* 4. MODAL: LIQUIDAÇÃO DE CONTA */}
      {
        selectedOrder && showCheckoutModal && (
          <div
            className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'overflow-y-auto')}
            onClick={() => setShowCheckoutModal(false)}
          >
            <div
              className={clsx('bg-koma-input/95', 'backdrop-blur-xl', 'rounded-3xl', 'border', 'border-koma-accent/15', 'shadow-2xl', 'w-full', 'max-w-3xl', 'overflow-hidden', 'max-h-[90vh]', 'flex', 'flex-col', 'my-4')}
              onClick={(e) => e.stopPropagation()}
            >

              <div className={clsx('bg-koma-raised', 'text-koma-foreground', 'p-5', 'flex', 'justify-between', 'items-center', 'shrink-0', 'border-b', 'border-koma-border')}>
                <div>
                  <span className={clsx('text-[10px]', 'font-bold', 'text-emerald-700 dark:text-emerald-400', 'uppercase', 'tracking-wider', 'block')}>Checkout / Caixa</span>
                  <h3 className={clsx('font-serif', 'text-lg', 'font-bold', 'text-koma-foreground')}>
                    {selectedOrder.mesaId > 0 ? `Mesa ${selectedOrder.mesaId}` : `Pedido Balcão`}
                  </h3>
                  {selectedOrder.mesaOrigemId && Number(selectedOrder.mesaOrigemId) !== Number(selectedOrder.mesaId) && (
                    <span className={clsx('inline-flex', 'items-center', 'gap-1', 'mt-1', 'px-2', 'py-0.5', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'bg-emerald-500/10', 'text-emerald-600 dark:text-emerald-300', 'border', 'border-emerald-500/25', 'rounded-full')}>
                      🔗 Mesclado de Mesa {selectedOrder.mesaOrigemId}
                    </span>
                  )}
                  {selectedOrder.mesaTransferidaDe && Number(selectedOrder.mesaTransferidaDe) !== Number(selectedOrder.mesaId) && (
                    <span className={clsx('inline-flex', 'items-center', 'gap-1', 'mt-1', 'px-2', 'py-0.5', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'bg-purple-500/10', 'text-purple-300', 'border', 'border-purple-500/25', 'rounded-full')}>
                      🔗 Transferido da Mesa {selectedOrder.mesaTransferidaDe}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowCheckoutModal(false)}
                  className={clsx('p-1.5', 'hover:bg-koma-raised', 'rounded-full', 'text-koma-subtle', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
                  title="Fechar (o pedido permanece na fila)"
                >
                  <X size={18} />
                </button>
              </div>

              {selectedCheckoutSmartPosState?.blocksPayment && (
                <div className={clsx(
                  'mx-5', 'mt-4', 'rounded-2xl', 'border', 'p-4', 'text-left',
                  selectedCheckoutSmartPosState.canReconcile
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-amber-500/30 bg-amber-500/10'
                )}>
                  <div className="flex items-start gap-3">
                    <Smartphone size={18} className="mt-0.5 shrink-0 text-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <strong className="block text-sm text-koma-foreground">
                        {selectedCheckoutSmartPosState.canReconcile
                          ? 'Pagamento aprovado aguardando conclusão'
                          : 'Pagamento em andamento na maquininha'}
                      </strong>
                      <p className="mt-1 text-[11px] leading-relaxed text-koma-secondary">
                        {selectedCheckoutSmartPosState.canReconcile
                          ? 'A cobrança já foi aprovada. Conclua a liquidação idempotente antes de lançar outra baixa.'
                          : 'O Kôma bloqueia uma segunda cobrança, mas mantém esta tela aberta para acompanhamento e recuperação.'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedCheckoutSmartPosState.canReconcile && selectedCheckoutSmartPosState.intentId && (
                          <button
                            type="button"
                            disabled={isReconcilingSmartPos}
                            onClick={() => handleReconcileSmartPosPayment(selectedCheckoutSmartPosState.intentId!)}
                            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white disabled:cursor-wait disabled:opacity-60"
                          >
                            {isReconcilingSmartPos ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                            Concluir pagamento aprovado
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSmartPosRecoveryError('');
                            void refreshSmartPosCashProjection();
                          }}
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-koma-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-koma-secondary"
                        >
                          <RefreshCw size={13} /> Atualizar estado
                        </button>
                      </div>
                      {smartPosRecoveryError && (
                        <p className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-2.5 text-[10px] font-semibold text-rose-400">
                          {smartPosRecoveryError}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className={clsx('p-5', 'overflow-y-auto', 'flex-1', 'bg-koma-raised', 'grid', 'grid-cols-1', 'md:grid-cols-2', 'gap-5')}>
                <div className="space-y-4">
                  <div className={clsx('flex', 'items-center', 'justify-between', 'border-b', 'border-koma-border', 'pb-1.5')}>
                    <div>
                      <h4 className={clsx('font-serif', 'font-bold', 'text-koma-secondary')}>Extrato Consumo</h4>
                      <span className={clsx('text-[8px]', 'text-koma-muted')}>
                        Itens prontos já podem ser recebidos. Itens em preparo ficam visíveis, mas bloqueados até avançarem na cozinha.
                      </span>
                    </div>
                    {taxaServicoAtiva && (
                      <label className={clsx('flex', 'items-center', 'gap-1.5', 'text-[10px]', 'text-koma-subtle', 'font-bold', 'uppercase', 'tracking-wider', 'cursor-pointer')}>
                        <input
                          type="checkbox"
                          checked={checkoutServiceTax}
                          onChange={(e) => {
                            const includeServiceTax = e.target.checked;
                            setCheckoutServiceTax(includeServiceTax);
                            const nextValue = selectedItemIds.length > 0
                              ? getSelectedItemsTotal(
                                selectedOrder,
                                selectedItemIds,
                                includeServiceTax
                              )
                              : getCheckoutBalance(
                                selectedOrder,
                                includeServiceTax
                              );
                            setPaymentValor(nextValue);
                          }}
                          className={clsx('rounded', 'border-koma-border', 'text-emerald-500', 'focus:ring-emerald-500', 'h-3.5', 'w-3.5', 'bg-koma-card')}
                        />
                        <span>Taxa de {serviceTaxRate}%</span>
                      </label>
                    )}
                  </div>

                  <div className={clsx('space-y-2.5', 'max-h-[40vh]', 'overflow-y-auto', 'pr-1')}>
                    {selectedOrder.itens.map((item) => {
                      const isPaid = item.pago;
                      const isCancelled = (item.status as string) === 'cancelado';
                      const isReadyForCheckout = isItemReadyForCheckout(item);
                      const canSelect = !isPaid && !isCancelled && isReadyForCheckout;
                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (!canSelect) return;
                            setSplitPeople('1');
                            setSelectedItemIds(prev => {
                              const copy = [...prev];
                              const idx = copy.indexOf(item.id);
                              if (idx >= 0) {
                                copy.splice(idx, 1);
                              } else {
                                copy.push(item.id);
                              }
                              const nextValue = copy.length > 0
                                ? getSelectedItemsTotal(selectedOrder, copy)
                                : getCheckoutBalance(selectedOrder);
                              setPaymentValor(nextValue);
                              return copy;
                            });
                          }}
                          className={`flex items-start justify-between p-2.5 rounded-xl border border-transparent transition-all text-[11px] ${isCancelled
                            ? 'bg-rose-500/5 border-rose-500/10 text-rose-400 opacity-60'
                            : isPaid
                            ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400'
                            : !isReadyForCheckout
                              ? 'bg-amber-500/5 border-amber-500/15 text-koma-secondary cursor-not-allowed opacity-80'
                              : selectedItemIds.includes(item.id)
                                ? 'bg-emerald-500/15 border-emerald-500/30 cursor-pointer shadow-inner'
                                : 'bg-koma-card/60 border-koma-border/50 hover:border-koma-border cursor-pointer'
                            }`}
                        >
                          <div className={clsx('flex', 'gap-2', 'items-start', 'flex-1', 'min-w-0')}>
                            {canSelect && (
                              <div className={`mt-0.5 h-3.5 w-3.5 rounded border border-koma-border flex items-center justify-center shrink-0 bg-koma-card ${selectedItemIds.includes(item.id) ? 'border-[#10b981] bg-emerald-500/15' : ''
                                }`}>
                                {selectedItemIds.includes(item.id) && <Check size={10} className="text-emerald-700 dark:text-emerald-400" />}
                              </div>
                            )}
                            <div className={clsx('min-w-0', 'space-y-0.5')}>
                              <span className={clsx('font-semibold', 'text-koma-foreground', 'block', 'truncate')}>{item.nome}</span>
                              <span className={clsx('text-[9px]', 'text-koma-subtle', 'block')}>Cliente: {item.clienteNome}</span>
                              {!isPaid && !isCancelled && !isReadyForCheckout && (
                                <span className={clsx('text-[8px]', 'font-semibold', 'text-amber-600', 'dark:text-amber-300', 'block')}>
                                  Em preparo · avance na cozinha antes de baixar este item
                                </span>
                              )}
                            </div>
                          </div>

                          <div className={clsx('text-right', 'pl-3', 'shrink-0', 'font-mono')}>
                            <span className={clsx('font-bold', 'text-koma-secondary')}>R$ {item.preco.toFixed(2)}</span>
                            {isPaid && <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'block', 'font-bold', 'text-emerald-500', 'font-sans', 'mt-0.5')}>Pago</span>}
                            {isCancelled && <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'block', 'font-bold', 'text-rose-500', 'font-sans', 'mt-0.5')}>Cancelado</span>}
                            {!isPaid && !isCancelled && !isReadyForCheckout && <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'block', 'font-bold', 'text-amber-600', 'dark:text-amber-300', 'font-sans', 'mt-0.5')}>Em preparo</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(() => {
                    const { subtotal, taxa } = getCheckoutTotals(selectedOrder);
                    const currentBalance = getCheckoutBalance(selectedOrder);
                    const selectedTotal = selectedItemIds.length > 0
                      ? getSelectedItemsTotal(selectedOrder, selectedItemIds)
                      : 0;
                    const projectedBalance = Math.max(0, currentBalance - selectedTotal);
                    return (
                      <div className={clsx('bg-koma-card/60', 'border', 'border-koma-border', 'p-4', 'rounded-2xl', 'font-mono', 'text-[11px]', 'space-y-2')}>
                        <div className={clsx('flex', 'justify-between')}>
                          <span className={clsx('font-sans', 'text-koma-subtle')}>
                            {isTableCheckoutOrder(selectedOrder) ? 'Consumo da Mesa:' : 'Total Itens em Aberto:'}
                          </span>
                          <span className="text-koma-secondary">R$ {subtotal.toFixed(2)}</span>
                        </div>
                        {taxaServicoAtiva && checkoutServiceTax && (
                          <div className={clsx('flex', 'justify-between')}>
                            <span className={clsx('font-sans', 'text-koma-subtle')}>Taxa Serviço ({serviceTaxRate}%):</span>
                            <span className="text-koma-secondary">R$ {taxa.toFixed(2)}</span>
                          </div>
                        )}
                        {selectedItemIds.length > 0 && (
                          <div className={clsx('flex', 'justify-between', 'text-emerald-700 dark:text-emerald-400', 'font-bold', 'border-t', 'border-koma-border/40', 'pt-2')}>
                            <span className="font-sans">Total Selecionado:</span>
                            <span>R$ {selectedTotal.toFixed(2)}</span>
                          </div>
                        )}
                        {selectedOrder.valorPago && selectedOrder.valorPago > 0 ? (
                          <div className={clsx('flex', 'justify-between', 'text-emerald-400')}>
                            <span className={clsx('font-sans', 'font-bold')}>Total Pago Parcial:</span>
                            <span className="font-bold">R$ {selectedOrder.valorPago.toFixed(2)}</span>
                          </div>
                        ) : null}
                        <div className={clsx('flex', 'justify-between', 'border-t', 'border-koma-border', 'pt-2', 'text-sm', 'text-emerald-700 dark:text-emerald-400', 'font-bold')}>
                          <span className="font-sans">{selectedItemIds.length > 0 ? 'Restará após receber:' : 'Saldo restante:'}</span>
                          <span>R$ {(selectedItemIds.length > 0 ? projectedBalance : currentBalance).toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* BOTÕES DE REIMPRESSÃO DO EXTRATO */}
                  <div className={clsx('bg-koma-card/40', 'border', 'border-koma-border/50', 'p-4', 'rounded-2xl', 'space-y-3', 'text-left')}>
                    <span className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Reimpressão de Extrato</span>
                    <div className={clsx('flex', 'gap-2')}>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const url = `${apiBaseUrl}/mesas/${selectedOrder.mesaId}/imprimir-recibo?apenas_valores=false`;
                            
                            const response = await fetch(url, {
                              method: 'POST',
                              headers: authHeaders
                            });
                            if (response.ok) {
                              window.dispatchEvent(
                                new Event('koma_print_monitor_refresh')
                              );
                            } else {
                              const err = await response.json();
                              alert(`Erro ao imprimir: ${err.detail}`);
                            }
                          } catch (err) {
                            console.error(err);
                            alert("Erro de conexão ao imprimir extrato.");
                          }
                        }}
                        className={clsx('flex-1', 'py-2', 'bg-koma-panel', 'hover:bg-koma-raised', 'border', 'border-koma-border', 'rounded-xl', 'text-[10px]', 'font-bold', 'text-koma-foreground', 'transition-all', 'cursor-pointer', 'text-center')}
                        title="Imprime a via térmica completa com todos os itens consumidos"
                      >
                        Extrato Completo
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const url = `${apiBaseUrl}/mesas/${selectedOrder.mesaId}/imprimir-recibo?apenas_valores=true`;
                            
                            const response = await fetch(url, {
                              method: 'POST',
                              headers: authHeaders
                            });
                            if (response.ok) {
                              window.dispatchEvent(
                                new Event('koma_print_monitor_refresh')
                              );
                            } else {
                              const err = await response.json();
                              alert(`Erro ao imprimir: ${err.detail}`);
                            }
                          } catch (err) {
                            console.error(err);
                            alert("Erro de conexão ao imprimir extrato resumido.");
                          }
                        }}
                        className={clsx('flex-1', 'py-2', 'bg-koma-panel', 'hover:bg-koma-raised', 'border', 'border-koma-border', 'rounded-xl', 'text-[10px]', 'font-bold', 'text-koma-foreground', 'transition-all', 'cursor-pointer', 'text-center')}
                        title="Imprime apenas o resumo de subtotais e taxas de serviço para economizar papel"
                      >
                        Apenas Valores
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className={clsx('font-serif', 'font-bold', 'text-koma-secondary', 'border-b', 'border-koma-border', 'pb-1.5')}>Divisão e Recebimento</h4>

                  {selectedItemIds.length > 0 ? (
                    <div className={clsx('grid', 'grid-cols-2', 'gap-3', 'bg-koma-card', 'p-3', 'rounded-2xl', 'border', 'border-koma-border')}>
                      <div>
                        <span className={clsx('text-[9px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Itens prontos</span>
                        <strong className={clsx('mt-1', 'block', 'text-sm', 'text-koma-foreground', 'font-mono')}>{selectedItemIds.length}</strong>
                      </div>
                      <div className="text-right">
                        <span className={clsx('text-[9px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Recebendo agora</span>
                        <strong className={clsx('mt-1', 'block', 'text-sm', 'text-emerald-700 dark:text-emerald-300', 'font-mono')}>
                          R$ {getSelectedItemsTotal(selectedOrder, selectedItemIds).toFixed(2)}
                        </strong>
                      </div>
                    </div>
                  ) : (
                    <div className={clsx('grid', 'grid-cols-2', 'gap-3', 'bg-koma-card', 'p-3', 'rounded-2xl', 'border', 'border-koma-border')}>
                      <div className="space-y-1">
                        <label className={clsx('text-[9px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Pessoas:</label>
                        <input
                          type="number"
                          min="1"
                          value={splitPeople}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSplitPeople(val);
                            const peopleNum = parseInt(val, 10) || 1;
                            setPaymentValor((getCheckoutBalance(selectedOrder) / peopleNum));
                          }}
                          className={clsx('w-full', 'px-3', 'py-1.5', 'text-xs', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'focus:outline-none', 'text-koma-foreground', 'text-center', 'font-mono')}
                        />
                      </div>
                      <div className={clsx('space-y-1', 'flex', 'flex-col', 'justify-end', 'text-right')}>
                        <span className={clsx('text-[9px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Valor por pessoa:</span>
                        <span className={clsx('text-sm', 'font-bold', 'text-koma-foreground', 'font-mono', 'leading-relaxed')}>
                          R$ {(() => {
                            const peopleNum = parseInt(splitPeople, 10) || 1;
                            return (getCheckoutBalance(selectedOrder) / peopleNum).toFixed(2);
                          })()}
                        </span>
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleProcessPayment} className={clsx('space-y-4', 'bg-koma-card/40', 'p-4', 'rounded-2xl', 'border', 'border-koma-border/50')}>
                    <span className={clsx('text-[10px]', 'font-bold', 'text-emerald-700 dark:text-emerald-400', 'uppercase', 'tracking-wider', 'block')}>Receber Pagamento</span>

                    <div className="space-y-1.5">
                      <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Método de Baixa:</label>
                      <div className={clsx('flex', 'gap-1.5', 'p-1', 'bg-koma-card', 'border', 'border-koma-border', 'rounded-xl', 'shrink-0', 'flex-wrap')}>
                        <button
                          type="button"
                          onClick={() => setPaymentMetodo('pix')}
                          className={`flex-1 min-w-[50px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'pix' ? 'bg-emerald-600 text-white shadow-sm' : 'text-koma-subtle hover:text-white'
                            }`}
                        >
                          Pix
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMetodo('dinheiro')}
                          className={`flex-1 min-w-[60px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'dinheiro' ? 'bg-emerald-600 text-white shadow-sm' : 'text-koma-subtle hover:text-white'
                            }`}
                        >
                          Dinheiro
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMetodo('cartao_debito')}
                          className={`flex-1 min-w-[70px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'cartao_debito' ? 'bg-emerald-600 text-white shadow-sm' : 'text-koma-subtle hover:text-white'
                            }`}
                        >
                          C. Débito
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMetodo('cartao_credito')}
                          className={`flex-1 min-w-[70px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'cartao_credito' ? 'bg-emerald-600 text-white shadow-sm' : 'text-koma-subtle hover:text-white'
                            }`}
                        >
                          C. Crédito
                        </button>
                      </div>
                    </div>

                    <div className={clsx('space-y-1.5', 'font-sans')}>
                      <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Valor a Lançar (R$):</label>
                      <div className={clsx('flex', 'gap-2')}>
                        <div className={clsx('relative', 'flex-1')}>
                          <span className={clsx('absolute', 'left-3.5', 'top-2.5', 'text-koma-subtle', 'font-mono', 'text-[11px]')}>R$</span>
                          <MoneyInput
                            required
                            value={paymentValor}
                            onValueChange={setPaymentValor}
                            readOnly={selectedItemIds.length > 0}
                            title={selectedItemIds.length > 0
                              ? 'O valor é calculado automaticamente pelos itens selecionados.'
                              : 'Digite qualquer valor para abater do saldo.'}
                            className={clsx(
                              'w-full',
                              'pl-9',
                              'pr-4',
                              'py-2',
                              'text-xs',
                              'bg-koma-card',
                              'border',
                              'border-koma-border',
                              'rounded-xl',
                              'focus:outline-none',
                              'focus:border-[#10b981]',
                              'text-koma-foreground',
                              'font-mono',
                              selectedItemIds.length > 0 && 'cursor-not-allowed text-emerald-600 dark:text-emerald-300'
                            )}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedOrder) return;
                            setSplitPeople('1');
                            if (selectedItemIds.length > 0) {
                              setSelectedItemIds([]);
                              setPaymentValor('');
                            } else {
                              setPaymentValor(getCheckoutBalance(selectedOrder));
                            }
                          }}
                          className={clsx(
                            'px-3.5',
                            'py-2',
                            'bg-emerald-500/15',
                            'hover:bg-[#10b981]/25',
                            'border',
                            'border-emerald-500/30',
                            'rounded-xl',
                            'text-[10px]',
                            'font-bold',
                            'text-emerald-700 dark:text-emerald-400',
                            'transition-all',
                            'cursor-pointer',
                            'whitespace-nowrap'
                          )}
                        >
                          {selectedItemIds.length > 0 ? 'Adiantar outro valor' : 'Usar saldo total'}
                        </button>
                      </div>
                      <span className={clsx('text-[8px]', 'text-koma-muted', 'block', 'mt-1.5', 'leading-normal')}>
                        <strong>Dica:</strong> {selectedItemIds.length > 0
                          ? 'Os itens prontos marcados serão baixados juntos. “Adiantar outro valor” limpa a seleção e libera um valor manual.'
                          : isTableCheckoutOrder(selectedOrder)
                            ? 'Sem itens marcados, o lançamento é um adiantamento sobre o saldo geral da mesa; itens em preparo continuam sem baixa individual.'
                            : 'Para pagamentos múltiplos, digite qualquer valor e faça as baixas em sequência.'}
                      </span>
                    </div>

                    {/* BOTÕES DE ATALHO DE CÉDULAS (CASH SHORTCUTS) */}
                    <div className="space-y-1">
                      <label className={clsx('text-[8px]', 'font-bold', 'text-koma-muted', 'uppercase', 'tracking-wider', 'block')}>Atalhos de Cédulas:</label>
                      <div className={clsx('flex', 'flex-wrap', 'gap-1')}>
                        {[2, 5, 10, 20, 50, 100, 200].map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => {
                              setSelectedItemIds([]);
                              setPaymentValor(val);
                            }}
                            className={clsx('px-2.5', 'py-1', 'bg-koma-panel', 'hover:bg-koma-raised', 'border', 'border-koma-border', 'rounded-lg', 'text-[9px]', 'font-bold', 'text-koma-secondary', 'font-mono', 'transition-all', 'cursor-pointer', 'hover:border-gray-500', 'hover:text-koma-foreground')}
                          >
                            R$ {val}
                          </button>
                        ))}
                      </div>
                    </div>

                    {identifiedCustomer && identifiedCustomer.telefone ? (
                      <div className={clsx(
                        'p-2.5',
                        'rounded-xl',
                        'border',
                        'border-emerald-500/25',
                        'bg-emerald-500/10',
                        'text-koma-foreground',
                        'space-y-1'
                      )}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-emerald-400">
                            <Check size={11} className="stroke-[3]" />
                            <span>Cliente Identificado</span>
                          </div>
                          {(Number(identifiedCustomer.saldoCashback || 0) > 0 || Number(identifiedCustomer.pontos || 0) > 0) && (
                            <span className="text-[9px] font-bold text-emerald-300">
                              Cashback: R$ {Number(identifiedCustomer.saldoCashback || 0).toFixed(2)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-xs font-bold pt-0.5">
                          <span className="text-white flex items-center gap-1.5 min-w-0">
                            <User size={12} className="text-emerald-400 shrink-0" />
                            <span className="truncate">{identifiedCustomer.nome}</span>
                          </span>
                          <span className="font-mono text-emerald-300 text-[11px] shrink-0 ml-2">
                            {aplicarMascaraTelefoneInput(identifiedCustomer.telefone)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className={clsx('space-y-1.5', 'font-sans')}>
                        <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>
                          Celular do cliente (Opcional - Fidelidade):
                        </label>
                        <input
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel"
                          value={paymentCPF}
                          onChange={(e) => setPaymentCPF(aplicarMascaraTelefoneInput(e.target.value))}
                          placeholder="(00) 00000-0000"
                          className={clsx('w-full', 'px-3', 'py-2', 'text-xs', 'bg-koma-card', 'border', 'border-koma-border', 'rounded-xl', 'focus:outline-none', 'focus:border-[#10b981]', 'text-koma-foreground')}
                        />
                      </div>
                    )}

                    {/* TROCO EM TEMPO REAL */}
                    {(() => {
                      if (!selectedOrder) return null;
                      const restante = getCheckoutBalance(selectedOrder);
                      const inputVal = Number(paymentValor || 0) || 0;
                      if (paymentMetodo === 'dinheiro' && inputVal > restante) {
                        const troco = inputVal - restante;
                        return (
                          <div className={clsx(
                            'bg-emerald-950/45',
                            'border',
                            'border-emerald-800/40',
                            'text-emerald-600 dark:text-emerald-300',
                            'p-3',
                            'rounded-xl',
                            'text-xs',
                            'font-mono',
                            'flex',
                            'justify-between',
                            'items-center',
                            'shadow-md',
                            'shadow-emerald-950/20'
                          )}>
                            <span className={clsx('font-bold', 'uppercase', 'text-[9px]', 'tracking-wider', 'text-emerald-400')}>Troco devido:</span>
                            <span className={clsx('font-extrabold', 'text-sm', 'text-emerald-600 dark:text-emerald-300')}>R$ {troco.toFixed(2)}</span>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {selectedItemIds.length > 0 && (
                      <div className={clsx('bg-emerald-500/15', 'border', 'border-emerald-500/30', 'text-emerald-700 dark:text-emerald-400', 'p-2.5', 'rounded-xl', 'text-[10px]', 'flex', 'items-center', 'justify-between', 'gap-2')}>
                        <span>
                          Pagando <strong>{selectedItemIds.length} item(ns)</strong> selecionado(s).
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedItemIds([]);
                            setSplitPeople('1');
                            setPaymentValor('');
                          }}
                          className={clsx('shrink-0', 'rounded-lg', 'border', 'border-emerald-500/30', 'px-2', 'py-1', 'text-[8px]', 'font-bold', 'uppercase', 'hover:bg-emerald-500/15')}
                        >
                          Outro valor
                        </button>
                      </div>
                    )}

                    {errorMsg && (
                      <div className={clsx('bg-rose-500/10', 'border', 'border-rose-500/25', 'text-rose-400', 'p-2.5', 'rounded-xl', 'text-center', 'font-medium', 'block')}>
                        {errorMsg}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={selectedCheckoutSmartPosState?.blocksPayment || isProcessingPayment}
                      className={clsx('w-full', 'py-3', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded-xl', 'font-bold', 'flex', 'items-center', 'justify-center', 'gap-1.5', 'shadow-md', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'text-[10px]', 'disabled:cursor-not-allowed', 'disabled:opacity-50')}
                    >
                      <Check size={14} />
                      <span>
                        {selectedItemIds.length > 0
                          ? (isTableCheckoutOrder(selectedOrder) ? 'Receber itens prontos' : 'Receber itens selecionados')
                          : (isTableCheckoutOrder(selectedOrder) ? 'Registrar adiantamento' : 'Lançar pagamento / baixa')}
                      </span>
                    </button>
                  </form>
                </div>
              </div>

            </div>
          </div>
        )
      }

      {/* 5. MODAL: ADICIONAR MESA */}
      {
        showAddMesaModal && (
          <div
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !tableMutation) setShowAddMesaModal(false);
            }}
            className={clsx('fixed', 'inset-0', 'z-50', 'flex', 'items-center', 'justify-center', 'bg-black/80', 'p-4', 'backdrop-blur-sm')}
          >
            <form onSubmit={handleAddMesaSubmit} className={clsx('w-full', 'max-w-md', 'overflow-hidden', 'rounded-[24px]', 'border', 'border-[#2b312e]', 'bg-koma-card', 'shadow-2xl', 'animate-scale-in')}>
              <div className={clsx('flex', 'items-start', 'justify-between', 'border-b', 'border-[#2b312e]', 'px-5', 'py-4', 'sm:px-6')}>
                <div className={clsx('flex', 'items-center', 'gap-3')}>
                  <span className={clsx('flex', 'h-10', 'w-10', 'items-center', 'justify-center', 'rounded-xl', 'border', 'border-emerald-500/30', 'bg-emerald-500/15', 'text-emerald-800 dark:text-emerald-300')}>
                    <Plus size={18} />
                  </span>
                  <div>
                    <span className={clsx('block', 'font-mono', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-[0.2em]', 'text-emerald-700 dark:text-emerald-400')}>Estrutura do salão</span>
                    <h3 className={clsx('mt-0.5', 'text-lg', 'font-bold', 'text-koma-foreground')}>Adicionar mesa</h3>
                    <p className={clsx('mt-0.5', 'text-[10px]', 'text-koma-muted')}>Ela ficará disponível no caixa e no app do garçom.</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={tableMutation !== null}
                  onClick={() => setShowAddMesaModal(false)}
                  aria-label="Fechar"
                  className={clsx('rounded-lg', 'p-2', 'text-koma-muted', 'transition-colors', 'hover:bg-white/[0.05]', 'hover:text-koma-foreground', 'disabled:opacity-40')}
                >
                  <X size={16} />
                </button>
              </div>

              <div className={clsx('space-y-4', 'px-5', 'py-5', 'sm:px-6')}>
                <div className={clsx('grid', 'grid-cols-2', 'gap-3')}>
                  <label className="space-y-1.5">
                    <span className={clsx('block', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'text-koma-subtle')}>Número da mesa</span>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Ex: 31"
                    value={newMesaId}
                    onChange={(e) => { setNewMesaId(e.target.value); setTableFormError(''); }}
                    className={clsx('w-full', 'rounded-xl', 'border', 'border-[#303633]', 'bg-koma-panel', 'px-3', 'py-3', 'font-mono', 'text-sm', 'text-koma-foreground', 'outline-none', 'transition-colors', 'placeholder:text-zinc-700', 'focus:border-[#10b981]/60')}
                  />
                  </label>
                  <label className="space-y-1.5">
                    <span className={clsx('block', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'text-koma-subtle')}>Lugares</span>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Ex: 4"
                    value={newMesaCap}
                    onChange={(e) => { setNewMesaCap(e.target.value); setTableFormError(''); }}
                    className={clsx('w-full', 'rounded-xl', 'border', 'border-[#303633]', 'bg-koma-panel', 'px-3', 'py-3', 'font-mono', 'text-sm', 'text-koma-foreground', 'outline-none', 'transition-colors', 'placeholder:text-zinc-700', 'focus:border-[#10b981]/60')}
                  />
                  </label>
                </div>

                <label className={clsx('block', 'space-y-1.5')}>
                  <span className={clsx('block', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'text-koma-subtle')}>Nome de referência <span className={clsx('normal-case', 'text-koma-muted')}>(opcional)</span></span>
                  <input
                    type="text"
                    maxLength={80}
                    placeholder="Ex.: Varanda, Deck ou Mesa VIP"
                    value={newMesaNome}
                    onChange={(e) => { setNewMesaNome(e.target.value); setTableFormError(''); }}
                    className={clsx('w-full', 'rounded-xl', 'border', 'border-[#303633]', 'bg-koma-panel', 'px-3', 'py-3', 'text-sm', 'text-koma-foreground', 'outline-none', 'transition-colors', 'placeholder:text-zinc-700', 'focus:border-[#10b981]/60')}
                  />
                </label>

                {tableFormError && (
                  <div role="alert" className={clsx('flex', 'gap-2', 'rounded-xl', 'border', 'border-rose-900/40', 'bg-rose-950/20', 'p-3', 'text-[11px]', 'leading-relaxed', 'text-rose-600 dark:text-rose-300')}>
                    <AlertTriangle className={clsx('mt-0.5', 'shrink-0')} size={14} />
                    {tableFormError}
                  </div>
                )}

                <div className={clsx('flex', 'flex-col-reverse', 'gap-2', 'pt-1', 'sm:flex-row')}>
                  <button
                    type="button"
                    disabled={tableMutation !== null}
                    onClick={() => setShowAddMesaModal(false)}
                    className={clsx('min-h-11', 'flex-1', 'rounded-xl', 'border', 'border-[#303633]', 'bg-koma-panel', 'px-4', 'text-xs', 'font-bold', 'text-koma-subtle', 'transition-colors', 'hover:text-koma-foreground', 'disabled:opacity-40')}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={tableMutation !== null}
                    className={clsx('flex', 'min-h-11', 'flex-1', 'items-center', 'justify-center', 'gap-2', 'rounded-xl', 'bg-[#10b981]', 'px-4', 'text-xs', 'font-extrabold', 'text-[#07110e]', 'transition-colors', 'hover:bg-[#35c99a]', 'disabled:cursor-wait', 'disabled:opacity-60')}
                  >
                    {tableMutation === 'create' ? <RefreshCw className="animate-spin" size={14} /> : <Check size={14} />}
                    {tableMutation === 'create' ? 'Adicionando…' : 'Adicionar mesa'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )
      }

      {/* 5.1 MODAL: EDITAR / EXCLUIR MESA */}
      {
        editingTable && (
          <div
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !tableMutation) {
                setEditingTable(null);
                setIsConfirmingDelete(false);
              }
            }}
            className={clsx('fixed', 'inset-0', 'z-50', 'flex', 'items-center', 'justify-center', 'bg-black/80', 'p-4', 'backdrop-blur-sm')}
          >
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (tableMutation) return;
                const capacity = Number.parseInt(editTableCap, 10);
                if (!Number.isFinite(capacity) || capacity <= 0) {
                  setTableFormError('Informe uma capacidade maior que zero.');
                  return;
                }
                try {
                  setTableMutation('update');
                  setTableFormError('');
                  await onUpdateMesa(editingTable.id, capacity, editTableNome.trim() || `Mesa ${editingTable.id}`);
                  showToast(`Mesa ${editingTable.id} atualizada.`, 'success');
                  setEditingTable(null);
                } catch (err: any) {
                  setTableFormError(err?.message || 'Não foi possível atualizar a mesa.');
                } finally {
                  setTableMutation(null);
                }
              }}
              className={clsx('w-full', 'max-w-md', 'overflow-hidden', 'rounded-[24px]', 'border', 'border-[#2b312e]', 'bg-koma-card', 'shadow-2xl', 'animate-scale-in')}
            >
              <div className={clsx('flex', 'items-start', 'justify-between', 'border-b', 'border-[#2b312e]', 'px-5', 'py-4', 'sm:px-6')}>
                <div className={clsx('flex', 'items-center', 'gap-3')}>
                  <span className={clsx('flex', 'h-10', 'w-10', 'items-center', 'justify-center', 'rounded-xl', 'border', 'border-emerald-500/30', 'bg-emerald-500/15', 'font-mono', 'text-base', 'font-extrabold', 'text-emerald-800 dark:text-emerald-300')}>
                    {editingTable.id}
                  </span>
                  <div>
                    <span className={clsx('block', 'font-mono', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-[0.2em]', 'text-emerald-700 dark:text-emerald-400')}>Configuração da mesa</span>
                    <h3 className={clsx('mt-0.5', 'text-lg', 'font-bold', 'text-koma-foreground')}>Editar Mesa {editingTable.id}</h3>
                    <p className={clsx('mt-0.5', 'text-[10px]', 'text-koma-muted')}>
                      {editingTableRuntime?.isOccupied ? 'Em atendimento agora' : 'Livre e disponível no salão'}
                    </p>
                  </div>
                </div>
                <button 
                  type="button" 
                  disabled={tableMutation !== null}
                  onClick={() => {
                    setEditingTable(null);
                    setIsConfirmingDelete(false);
                  }} 
                  aria-label="Fechar"
                  className={clsx('rounded-lg', 'p-2', 'text-koma-muted', 'transition-colors', 'hover:bg-white/[0.05]', 'hover:text-koma-foreground', 'disabled:opacity-40')}
                >
                  <X size={16} />
                </button>
              </div>

              <div className={clsx('space-y-4', 'px-5', 'py-5', 'sm:px-6')}>
                {isConfirmingDelete ? (
                <div className={clsx('space-y-4', 'rounded-2xl', 'border', 'border-rose-900/40', 'bg-rose-950/20', 'p-4', 'text-center')}>
                  <span className={clsx('mx-auto', 'flex', 'h-10', 'w-10', 'items-center', 'justify-center', 'rounded-full', 'bg-rose-500/10', 'text-rose-400')}><Trash2 size={17} /></span>
                  <div>
                    <strong className={clsx('block', 'text-sm', 'text-koma-foreground')}>Remover Mesa {editingTable.id}?</strong>
                    <p className={clsx('mt-1', 'text-[11px]', 'leading-relaxed', 'text-koma-subtle')}>
                      Ela sairá do salão em todos os dispositivos. O histórico de pedidos será preservado.
                  </p>
                  </div>
                  <div className={clsx('flex', 'gap-2')}>
                    <button 
                      type="button" 
                      onClick={() => setIsConfirmingDelete(false)} 
                      disabled={tableMutation !== null}
                      className={clsx('min-h-10', 'flex-1', 'rounded-xl', 'border', 'border-[#303633]', 'bg-koma-panel', 'text-xs', 'font-bold', 'text-koma-subtle', 'transition-colors', 'hover:text-koma-foreground', 'disabled:opacity-40')}
                    >
                      Manter mesa
                    </button>
                    <button 
                      type="button" 
                      onClick={async () => {
                        if (tableMutation) return;
                        try {
                          setTableMutation('delete');
                          setTableFormError('');
                          await onDeleteMesa(editingTable.id);
                          showToast(`Mesa ${editingTable.id} removida do salão.`, 'success');
                          setEditingTable(null);
                          setIsConfirmingDelete(false);
                        } catch (err: any) {
                          setTableFormError(err?.message || 'Não foi possível remover a mesa.');
                          setIsConfirmingDelete(false);
                        } finally {
                          setTableMutation(null);
                        }
                      }}
                      disabled={tableMutation !== null}
                      className={clsx('flex', 'min-h-10', 'flex-1', 'items-center', 'justify-center', 'gap-2', 'rounded-xl', 'bg-rose-600', 'text-xs', 'font-bold', 'text-koma-foreground', 'transition-colors', 'hover:bg-rose-500', 'disabled:cursor-wait', 'disabled:opacity-60')}
                    >
                      {tableMutation === 'delete' && <RefreshCw className="animate-spin" size={13} />}
                      {tableMutation === 'delete' ? 'Removendo…' : 'Remover'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={clsx('space-y-4', 'text-left')}>
                    <label className={clsx('block', 'space-y-1.5')}>
                      <span className={clsx('block', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'text-koma-subtle')}>Nome de referência</span>
                      <input
                        type="text"
                        maxLength={80}
                        placeholder={`Mesa ${editingTable.id}`}
                        value={editTableNome}
                        onChange={(e) => { setEditTableNome(e.target.value); setTableFormError(''); }}
                        className={clsx('w-full', 'rounded-xl', 'border', 'border-[#303633]', 'bg-koma-panel', 'px-3', 'py-3', 'text-sm', 'text-koma-foreground', 'outline-none', 'transition-colors', 'placeholder:text-zinc-700', 'focus:border-[#10b981]/60')}
                      />
                      <span className={clsx('block', 'text-[9px]', 'text-koma-muted')}>Use um nome simples, como “Varanda” ou “Deck”.</span>
                    </label>

                    <label className={clsx('block', 'space-y-1.5')}>
                      <span className={clsx('block', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'text-koma-subtle')}>Capacidade</span>
                      <div className="relative">
                        <Users className={clsx('absolute', 'left-3', 'top-1/2', '-translate-y-1/2', 'text-koma-muted')} size={14} />
                      <input
                        type="number"
                        min="1"
                        required
                        placeholder="Ex: 4"
                        value={editTableCap}
                        onChange={(e) => { setEditTableCap(e.target.value); setTableFormError(''); }}
                        className={clsx('w-full', 'rounded-xl', 'border', 'border-[#303633]', 'bg-koma-panel', 'py-3', 'pl-9', 'pr-3', 'font-mono', 'text-sm', 'text-koma-foreground', 'outline-none', 'transition-colors', 'placeholder:text-zinc-700', 'focus:border-[#10b981]/60')}
                      />
                      </div>
                    </label>
                  </div>

                  {tableFormError && (
                    <div role="alert" className={clsx('flex', 'gap-2', 'rounded-xl', 'border', 'border-rose-900/40', 'bg-rose-950/20', 'p-3', 'text-[11px]', 'leading-relaxed', 'text-rose-600 dark:text-rose-300')}>
                      <AlertTriangle className={clsx('mt-0.5', 'shrink-0')} size={14} />
                      {tableFormError}
                    </div>
                  )}

                  <div className={clsx('space-y-3', 'pt-1')}>
                    <div className={clsx('flex', 'flex-col-reverse', 'gap-2', 'sm:flex-row')}>
                      <button 
                        type="button" 
                        onClick={() => setEditingTable(null)} 
                        disabled={tableMutation !== null}
                        className={clsx('min-h-11', 'flex-1', 'rounded-xl', 'border', 'border-[#303633]', 'bg-koma-panel', 'px-4', 'text-xs', 'font-bold', 'text-koma-subtle', 'transition-colors', 'hover:text-koma-foreground', 'disabled:opacity-40')}
                      >
                        Cancelar
                      </button>
                      <button 
                        type="submit"
                        disabled={tableMutation !== null}
                        className={clsx('flex', 'min-h-11', 'flex-1', 'items-center', 'justify-center', 'gap-2', 'rounded-xl', 'bg-[#10b981]', 'px-4', 'text-xs', 'font-extrabold', 'text-[#07110e]', 'transition-colors', 'hover:bg-[#35c99a]', 'disabled:cursor-wait', 'disabled:opacity-60')}
                      >
                        {tableMutation === 'update' ? <RefreshCw className="animate-spin" size={14} /> : <Check size={14} />}
                        {tableMutation === 'update' ? 'Salvando…' : 'Salvar alterações'}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsConfirmingDelete(true)}
                      disabled={Boolean(editingTableRuntime?.isOccupied) || tableMutation !== null}
                      className={clsx('flex', 'min-h-10', 'w-full', 'items-center', 'justify-center', 'gap-1.5', 'rounded-xl', 'border', 'border-rose-900/30', 'bg-rose-950/10', 'px-3', 'text-[10px]', 'font-bold', 'text-rose-400', 'transition-colors', 'hover:bg-rose-950/25', 'disabled:cursor-not-allowed', 'disabled:border-zinc-800', 'disabled:bg-transparent', 'disabled:text-zinc-600')}
                    >
                      <Trash2 size={12} />
                      {editingTableRuntime?.isOccupied ? 'Finalize o atendimento para remover' : 'Remover mesa do salão'}
                    </button>
                  </div>
                </>
              )}
              </div>
            </form>
          </div>
        )
      }

      {/* 6. MODAL: INSPECIONAR E REIMPRIMIR PEDIDO DO KANBAN */}
      {selectedKanbanOrder && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedKanbanOrder(null); }}
          className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'cursor-pointer')}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="kanban-detail-title" className={clsx('orders-detail-modal', 'w-full', 'max-w-md', 'rounded-3xl', 'p-5', 'space-y-4', 'text-left', 'relative', 'animate-scale-in')}>
            <div className="orders-detail-modal__hero">
              <div className={clsx('orders-detail-modal__number', selectedIsQuickSale && 'is-quick-sale')}>
                {selectedIsQuickSale ? <Smartphone size={18} /> : selectedKanbanOrder.mesaId > 0 ? <Users size={18} /> : <ShoppingCart size={18} />}
                <strong>{selectedKanbanOrder.mesaId > 0 ? `M${selectedKanbanOrder.mesaId}` : `#${selectedOrderNumber}`}</strong>
              </div>
              <div className="min-w-0 flex-1">
                <span className="orders-detail-modal__eyebrow">
                  {selectedIsQuickSale ? 'Venda rápida' : selectedKanbanOrder.mesaId > 0 ? 'Atendimento do salão' : selectedKanbanOrder.modalidade === 'delivery' ? 'Delivery' : 'Retirada'}
                </span>
                <h3 id="kanban-detail-title" className="orders-detail-modal__title">
                  {selectedIsQuickSale
                    ? `Pedido #${selectedOrderNumber}`
                    : selectedKanbanOrder.mesaId > 0
                      ? `Mesa ${selectedKanbanOrder.mesaId}`
                      : selectedKanbanOrder.identificador || `Pedido #${selectedOrderNumber}`}
                </h3>
                <div className="orders-detail-modal__status-line">
                  <span>{operationalOriginLabel(selectedKanbanOrder.origemOperacional)}</span>
                  <span aria-hidden="true">•</span>
                  <strong>{deliveryStatusLabel(selectedKanbanOrder.deliveryStatus, selectedKanbanOrder.modalidade)}</strong>
                </div>
              </div>
              <div className="orders-detail-modal__hero-side">
                <strong>{formatCurrency(selectedOrderTotal)}</strong>
              <button
                type="button"
                onClick={() => setSelectedKanbanOrder(null)}
                  className="orders-detail-modal__close"
                  aria-label="Fechar detalhes"
              >
                <X size={16} />
              </button>
              </div>
            </div>

            <div className="orders-detail-modal__metrics">
              <div><span>Pedido</span><strong>#{selectedOrderNumber}</strong></div>
              <div><span>Horário</span><strong>{selectedKanbanOrder.criadoEm || formatBackendTime(selectedKanbanOrder.created_at) || '—'}</strong></div>
              <div><span>Itens</span><strong>{selectedDetailItems.reduce((sum, item) => sum + item.quantidade, 0)}</strong></div>
            </div>

            {/* Itens e info extras */}
            <div className="space-y-3">
              {selectedKanbanOrder.mesaOrigemId && Number(selectedKanbanOrder.mesaOrigemId) !== Number(selectedKanbanOrder.mesaId) && (
                <div className={clsx('bg-emerald-950/20', 'p-3', 'rounded-2xl', 'border', 'border-emerald-900/40', 'text-xs', 'text-emerald-600 dark:text-emerald-300', 'flex', 'items-center', 'justify-between', 'shadow-sm', 'font-sans')}>
                  <div>
                    <strong className={clsx('text-emerald-400', 'block', 'text-[9px]', 'uppercase', 'tracking-wider', 'font-bold')}>Consumo Mesclado:</strong>
                    <span className="leading-relaxed">Este lote possui consumo mesclado da <strong>Mesa {selectedKanbanOrder.mesaOrigemId}</strong> para a <strong>Mesa {selectedKanbanOrder.mesaId}</strong>.</span>
                  </div>
                  <span className={clsx('text-lg', 'shrink-0', 'pl-2')}>🔗</span>
                </div>
              )}

              {selectedKanbanOrder.mesaTransferidaDe && Number(selectedKanbanOrder.mesaTransferidaDe) !== Number(selectedKanbanOrder.mesaId) && (
                <div className={clsx('bg-purple-950/20', 'p-3', 'rounded-2xl', 'border', 'border-purple-900/40', 'text-xs', 'text-purple-300', 'flex', 'items-center', 'justify-between', 'shadow-sm', 'font-sans', 'animate-pulse-subtle')}>
                  <div>
                    <strong className={clsx('text-purple-400', 'block', 'text-[9px]', 'uppercase', 'tracking-wider', 'font-bold')}>Consumo Transferido:</strong>
                    <span className="leading-relaxed">Este lote foi transferido da <strong>Mesa {selectedKanbanOrder.mesaTransferidaDe}</strong> para a <strong>Mesa {selectedKanbanOrder.mesaId}</strong>.</span>
                  </div>
                  <span className={clsx('text-lg', 'shrink-0', 'pl-2')}>🔄</span>
                </div>
              )}

              {selectedKanbanOrder.identificador && !selectedIsQuickSale && (
                <div className="orders-detail-modal__customer">
                  <div>
                    <span>Cliente</span>
                    <strong>{selectedKanbanOrder.identificador}</strong>
                  </div>
                  {selectedKanbanOrder.telefone && <span>{selectedKanbanOrder.telefone}</span>}
                </div>
              )}

              <div className="space-y-2">
                <div className="orders-detail-modal__section-title">
                  <span>Itens do pedido</span>
                  <strong>{selectedDetailItems.reduce((sum, item) => sum + item.quantidade, 0)} no total</strong>
                </div>
                <div className="orders-detail-modal__items">
                {selectedDetailItems.map((item, idx) => (
                  <div key={`${item.nome}-${item.observacao}-${idx}`} className="orders-detail-modal__item">
                    <span className="orders-detail-modal__quantity">{item.quantidade}×</span>
                    <div className="min-w-0 flex-1">
                      <strong>{item.nome}</strong>
                      {item.observacao && <span className="orders-detail-modal__observation">{item.observacao}</span>}
                      {item.clienteNome !== 'Consumo Geral' && item.clienteNome.toLowerCase() !== 'balcão' && (
                        <span className="orders-detail-modal__for">Para: {item.clienteNome}</span>
                      )}
                    </div>
                    <span className={clsx('orders-detail-modal__item-status', item.status === 'pronto' && 'is-ready')}>
                      {item.status === 'preparando' ? 'Em preparo' : item.status === 'pronto' ? 'Pronto' : item.status}
                    </span>
                  </div>
                ))}
                </div>
              </div>

              {/* Botões de impressão */}
              <div className={clsx('flex', 'flex-col', 'gap-2', 'pt-1')}>
                {selectedCanAdvanceDigital && (
                  <button
                    type="button"
                    onClick={async () => {
                      const isDelivery = selectedKanbanOrder.modalidade === 'delivery';
                      const updated = await handleUpdateDeliveryStatus(selectedKanbanOrder.id, isDelivery ? 'transito' : 'pronto');
                      if (updated) setSelectedKanbanOrder(null);
                    }}
                    className="orders-detail-modal__primary-action"
                  >
                    <Check size={15} />
                    <span>{selectedKanbanOrder.modalidade === 'delivery' ? 'Marcar saída para entrega' : 'Marcar pronto para retirada'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const printUrl = selectedKanbanOrder.lancamentoId
                        ? `${apiBaseUrl}/comandas/lancamentos/${selectedKanbanOrder.lancamentoId}/reimprimir`
                        : `${apiBaseUrl}/comandas/${selectedKanbanOrder.comandaId || selectedKanbanOrder.id}/imprimir-recibo`;
                      const res = await fetch(printUrl, {
                        method: "POST",
                        headers: authHeaders
                      });
                      if (res.ok) {
                        window.dispatchEvent(
                          new Event('koma_print_monitor_refresh')
                        );
                        setSelectedKanbanOrder(null);
                      } else {
                        showToast("Erro ao solicitar reimpressão.", 'error');
                      }
                    } catch (err) {
                      console.error(err);
                      showToast("Erro ao solicitar reimpressão.", 'error');
                    }
                  }}
                  className="orders-detail-modal__reprint"
                >
                  <Printer size={13} />
                  <span>Reimprimir produção</span>
                </button>

                {Boolean(selectedKanbanOrder.mesaId && selectedKanbanOrder.mesaId > 0) && (
                  <div className={clsx('space-y-2', 'w-full')}>
                    <div className={clsx('flex', 'gap-2', 'w-full')}>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const url = `${apiBaseUrl}/mesas/${selectedKanbanOrder.mesaId}/imprimir-recibo?apenas_valores=false`;
                          const response = await fetch(url, { method: 'POST', headers: authHeaders });
                          if (response.ok) {
                            window.dispatchEvent(
                              new Event('koma_print_monitor_refresh')
                            );
                            setSelectedKanbanOrder(null);
                          } else {
                            const errD = await response.json();
                            showToast(`Erro: ${errD.detail}`, 'error');
                          }
                        } catch (err) {
                          console.error(err);
                          showToast("Erro ao imprimir comanda inteira.", 'error');
                        }
                      }}
                      className={clsx('flex-1', 'py-2.5', 'bg-koma-panel', 'hover:bg-koma-raised', 'text-koma-secondary', 'hover:text-koma-foreground', 'font-bold', 'text-xs', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'text-center', 'flex', 'items-center', 'justify-center', 'gap-1.5', 'border', 'border-koma-border', 'shadow-lg')}
                    >
                      <Printer size={13} />
                      <span>Comanda Inteira</span>
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const url = `${apiBaseUrl}/mesas/${selectedKanbanOrder.mesaId}/imprimir-recibo?apenas_valores=true`;
                          const response = await fetch(url, { method: 'POST', headers: authHeaders });
                          if (response.ok) {
                            window.dispatchEvent(
                              new Event('koma_print_monitor_refresh')
                            );
                            setSelectedKanbanOrder(null);
                          } else {
                            const errD = await response.json();
                            showToast(`Erro: ${errD.detail}`, 'error');
                          }
                        } catch (err) {
                          console.error(err);
                          showToast("Erro ao imprimir apenas valores.", 'error');
                        }
                      }}
                      className={clsx('flex-1', 'py-2.5', 'bg-koma-panel', 'hover:bg-koma-raised', 'text-koma-secondary', 'hover:text-koma-foreground', 'font-bold', 'text-xs', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'text-center', 'flex', 'items-center', 'justify-center', 'gap-1.5', 'border', 'border-koma-border', 'shadow-lg')}
                    >
                      <Printer size={13} />
                      <span>Só Valores</span>
                    </button>
                    </div>
                    {selectedKanbanOrder.contextoSalao && (
                      <div className={clsx('flex', 'gap-2', 'w-full')}>
                        <select
                          aria-label="Mesa de destino"
                          value={tableTransferTargetId}
                          onChange={(event) => setTableTransferTargetId(event.target.value)}
                          disabled={isTransferringTable}
                          className={clsx('min-h-10', 'min-w-0', 'flex-1', 'rounded-xl', 'border', 'border-koma-border', 'bg-koma-panel', 'px-3', 'text-xs', 'font-bold', 'text-koma-secondary', 'outline-none', 'focus:border-emerald-500/60')}
                        >
                          <option value="">Transferir para…</option>
                          {salonTables
                            .filter(table => Number(table.id) !== Number(selectedKanbanOrder.mesaId))
                            .map(table => <option key={table.id} value={table.id}>Mesa {table.id}{table.nome ? ` · ${table.nome}` : ''}</option>)}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleTransferTableFromSalon(selectedKanbanOrder)}
                          disabled={!tableTransferTargetId || isTransferringTable}
                          className={clsx('flex', 'min-h-10', 'items-center', 'justify-center', 'gap-2', 'rounded-xl', 'border', 'border-emerald-500/30', 'bg-emerald-500/10', 'px-3', 'text-[10px]', 'font-bold', 'text-emerald-700 dark:text-emerald-300', 'hover:bg-emerald-500/20', 'disabled:cursor-not-allowed', 'disabled:opacity-40')}
                        >
                          {isTransferringTable ? <RefreshCw className="animate-spin" size={13} /> : <ArrowUpRight size={13} />}
                          Transferir
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => selectedKanbanOrder.contextoSalao
                        ? openCancelTableConfirmation(Number(selectedKanbanOrder.mesaId))
                        : openCancelOrderConfirmation(selectedKanbanOrder)}
                      className={clsx('flex', 'min-h-10', 'w-full', 'items-center', 'justify-center', 'gap-2', 'rounded-xl', 'border', 'border-rose-300 dark:border-rose-900/40', 'bg-rose-50 dark:bg-rose-950/20', 'px-3', 'text-[10px]', 'font-bold', 'text-rose-700 dark:text-rose-300', 'transition-colors', 'hover:bg-rose-100 dark:hover:bg-rose-950/40')}
                    >
                      <Trash2 size={13} />
                      {selectedKanbanOrder.contextoSalao ? 'Cancelar toda a mesa e liberar' : 'Cancelar somente este pedido'}
                    </button>
                  </div>
                )}
                {Number(selectedKanbanOrder.mesaId || 0) <= 0 && (
                  <button
                    type="button"
                    onClick={() => openCancelOrderConfirmation(selectedKanbanOrder)}
                    className={clsx('flex', 'min-h-10', 'w-full', 'items-center', 'justify-center', 'gap-2', 'rounded-xl', 'border', 'border-rose-300 dark:border-rose-900/40', 'bg-rose-50 dark:bg-rose-950/20', 'px-3', 'text-[10px]', 'font-bold', 'text-rose-700 dark:text-rose-300', 'transition-colors', 'hover:bg-rose-100 dark:hover:bg-rose-950/40')}
                  >
                    <Trash2 size={13} />
                    Cancelar pedido
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {cancelConsumptionTarget && (
        <div className={clsx('fixed', 'inset-0', 'z-[60]', 'flex', 'items-center', 'justify-center', 'bg-black/90', 'p-4', 'backdrop-blur-sm')}>
          <div role="dialog" aria-modal="true" aria-labelledby="cancel-table-title" className={clsx('w-full', 'max-w-md', 'space-y-4', 'rounded-3xl', 'border', 'border-rose-900/50', 'bg-koma-card', 'p-5', 'shadow-2xl')}>
            <div className={clsx('flex', 'items-start', 'justify-between', 'gap-3', 'border-b', 'border-koma-border-subtle', 'pb-4')}>
              <div>
                <span className={clsx('font-mono', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-[0.18em]', 'text-rose-400')}>Ação irreversível</span>
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
              <button type="button" onClick={() => setCancelConsumptionTarget(null)} disabled={isCancellingTable} className={clsx('rounded-lg', 'p-2', 'text-koma-muted', 'hover:bg-white/[0.05]', 'hover:text-koma-foreground', 'disabled:opacity-40')} aria-label="Fechar">
                <X size={16} />
              </button>
            </div>

            <div className={clsx('grid', 'grid-cols-3', 'gap-2')}>
              <div className={clsx('rounded-xl', 'border', 'border-koma-border-subtle', 'bg-black/20', 'p-3')}><strong className={clsx('block', 'font-mono', 'text-sm', 'text-koma-foreground')}>{cancelConsumptionTarget.comandas}</strong><span className={clsx('text-[9px]', 'text-koma-muted')}>comandas</span></div>
              <div className={clsx('rounded-xl', 'border', 'border-koma-border-subtle', 'bg-black/20', 'p-3')}><strong className={clsx('block', 'font-mono', 'text-sm', 'text-koma-foreground')}>{cancelConsumptionTarget.itens}</strong><span className={clsx('text-[9px]', 'text-koma-muted')}>itens</span></div>
              <div className={clsx('rounded-xl', 'border', 'border-koma-border-subtle', 'bg-black/20', 'p-3')}><strong className={clsx('block', 'font-mono', 'text-sm', 'text-rose-600 dark:text-rose-300')}>{cancelConsumptionTarget.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong><span className={clsx('text-[9px]', 'text-koma-muted')}>cancelados</span></div>
            </div>

            <label className={clsx('block', 'space-y-1.5')}>
              <span className={clsx('text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'text-koma-subtle')}>Motivo obrigatório</span>
              <textarea
                autoFocus
                maxLength={300}
                rows={3}
                value={cancelTableReason}
                onChange={event => setCancelTableReason(event.target.value)}
                placeholder="Ex.: pedido lançado por engano"
                className={clsx('w-full', 'resize-none', 'rounded-xl', 'border', 'border-[#343936]', 'bg-koma-panel', 'px-3', 'py-2.5', 'text-sm', 'text-koma-foreground', 'outline-none', 'placeholder:text-zinc-700', 'focus:border-rose-500/60')}
              />
            </label>

            <div className={clsx('flex', 'flex-col-reverse', 'gap-2', 'sm:flex-row')}>
              <button type="button" onClick={() => setCancelConsumptionTarget(null)} disabled={isCancellingTable} className={clsx('min-h-11', 'flex-1', 'rounded-xl', 'border', 'border-[#343936]', 'text-xs', 'font-bold', 'text-koma-subtle', 'hover:text-koma-foreground', 'disabled:opacity-40')}>{cancelConsumptionTarget.scope === 'digital' ? 'Manter pedido' : 'Manter atendimento'}</button>
              <button type="button" onClick={handleCancelTableConsumption} disabled={cancelTableReason.trim().length < 3 || isCancellingTable} className={clsx('flex', 'min-h-11', 'flex-1', 'items-center', 'justify-center', 'gap-2', 'rounded-xl', 'bg-rose-600', 'px-3', 'text-xs', 'font-extrabold', 'text-koma-foreground', 'hover:bg-rose-500', 'disabled:cursor-not-allowed', 'disabled:opacity-40')}>
                {isCancellingTable ? <RefreshCw className="animate-spin" size={14} /> : <Trash2 size={14} />}
                {isCancellingTable ? 'Cancelando…' : cancelConsumptionTarget.scope === 'table' ? 'Cancelar e liberar' : 'Cancelar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. MODAL: ADICIONAR / EDITAR PRODUTO */}
      {showProductModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowProductModal(false); }}
          className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-2', 'sm:p-4', 'overflow-hidden', 'cursor-pointer')}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="product-modal-title" className={clsx('w-full', 'max-w-xl', 'max-h-[calc(100dvh-1rem)]', 'sm:max-h-[calc(100dvh-2rem)]', 'overflow-y-auto', 'bg-koma-card', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'sm:p-6', 'space-y-4', 'text-left', 'shadow-2xl', 'relative', 'animate-scale-in', 'cursor-default')}>
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <div>
                <div className="flex items-center gap-2">
                  <h3 id="product-modal-title" className="text-base font-bold text-koma-foreground">
                    {editingProduct ? 'Editar produto' : 'Novo produto'}
                  </h3>
                  {editingProduct && <span className="rounded-full border border-koma-border bg-koma-raised px-2 py-0.5 font-mono text-[9px] text-koma-muted">#{editingProduct.id}</span>}
                </div>
                <p className="mt-0.5 text-[10px] text-koma-muted">As alterações aparecem no caixa, atendimento e cardápio online.</p>
              </div>
              <button 
                type="button" 
                onClick={() => setShowProductModal(false)} 
                aria-label="Fechar"
                className={clsx('p-1', 'text-koma-subtle', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (isLoading) return;
                setIsLoading(true);
                try {
                  const galeriaUrls = [prodFormImagem, prodFormImagem2, prodFormImagem3].map(u => u.trim()).filter(Boolean);
                  const payload = {
                    nome: prodFormNome.trim(),
                    categoria_id: prodFormCategoriaId,
                    preco: Number(prodFormPreco || 0),
                    descricao: prodFormDescricao.trim(),
                    imagem: galeriaUrls[0] || prodFormImagem || '',
                    imagens_galeria: galeriaUrls,
                    ativo: prodFormAtivo
                  };

                  let res;
                  if (editingProduct) {
                    res = await fetch(`${apiBaseUrl}/produtos/${editingProduct.id}`, {
                      method: 'PUT',
                      headers: { ...authHeaders, 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload)
                    });
                  } else {
                    res = await fetch(`${apiBaseUrl}/produtos/`, {
                      method: 'POST',
                      headers: { ...authHeaders, 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        id: prodFormId,
                        ...payload
                      })
                    });
                  }

                  if (res.ok) {
                    await fetchProdutos();
                    setShowProductModal(false);
                    showToast(editingProduct ? 'Produto atualizado.' : 'Produto criado.');
                  } else {
                    const errData = await res.json().catch(() => ({}));
                    showToast(errData.detail || 'Não foi possível salvar o produto.', 'error');
                  }
                } catch (err) {
                  console.error(err);
                  showToast('Erro de conexão ao salvar produto.', 'error');
                } finally {
                  setIsLoading(false);
                }
              }}
              className={clsx('space-y-5', 'text-xs')}
            >
              {apiCategorias.length === 0 && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[10px] text-amber-800 dark:text-amber-200">
                  <span>Crie uma categoria antes de salvar o primeiro produto.</span>
                  <button type="button" onClick={() => setShowCategoryModal(true)} className="shrink-0 font-bold underline underline-offset-2">Criar categoria</button>
                </div>
              )}
              {!editingProduct && (
                <div className="space-y-1.5">
                  <label htmlFor="product-code" className={clsx('text-[10px]', 'font-bold', 'text-koma-secondary', 'block')}>Código do produto</label>
                  <input
                    type="text"
                    id="product-code"
                    required
                    placeholder="Ex.: 001"
                    value={prodFormId}
                    onChange={(e) => setProdFormId(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
                  <p className="text-[9px] leading-relaxed text-koma-muted">Sugerimos o próximo código livre. Você pode trocar agora; depois de criado, ele não muda.</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="product-name" className={clsx('text-[10px]', 'font-bold', 'text-koma-secondary', 'block')}>Nome do produto</label>
                <input
                  type="text"
                  id="product-name"
                  required
                  placeholder="Ex: Cheeseburger Duplo"
                  value={prodFormNome}
                  onChange={(e) => setProdFormNome(e.target.value)}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
              </div>

              <div className={clsx('grid', 'grid-cols-1', 'sm:grid-cols-2', 'gap-3')}>
                <div className="space-y-1.5">
                  <label htmlFor="product-price" className={clsx('text-[10px]', 'font-bold', 'text-koma-secondary', 'block')}>Preço de venda</label>
                  <MoneyInput
                    id="product-price"
                    required
                    placeholder="25.90"
                    value={prodFormPreco}
                    onValueChange={setProdFormPreco}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono', 'text-[11px]')}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="product-category" className={clsx('text-[10px]', 'font-bold', 'text-koma-secondary', 'block')}>Categoria</label>
                  <div className={clsx('flex', 'gap-1.5')}>
                    <select
                      id="product-category"
                      required
                      value={prodFormCategoriaId}
                      onChange={(e) => setProdFormCategoriaId(e.target.value)}
                      className={clsx('flex-1', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                    >
                      <option value="" disabled>Selecione...</option>
                      {apiCategorias.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.nome}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowCategoryModal(true)}
                      title="Criar nova categoria"
                      aria-label="Criar nova categoria"
                      className={clsx('inline-flex', 'items-center', 'gap-1', 'px-2.5', 'bg-emerald-500/15', 'hover:bg-[#10b981]/20', 'text-emerald-700 dark:text-emerald-400', 'border', 'border-emerald-500/30', 'rounded-xl', 'font-bold', 'text-[9px]', 'cursor-pointer', 'transition-colors')}
                    >
                      <Plus size={13} /> Nova
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="product-description" className={clsx('text-[10px]', 'font-bold', 'text-koma-secondary', 'block')}>Descrição para o cliente</label>
                <textarea
                  id="product-description"
                  placeholder="Hambúrguer bovino 150g, queijo cheddar derretido..."
                  value={prodFormDescricao}
                  onChange={(e) => setProdFormDescricao(e.target.value)}
                  rows={2}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
                <p className="text-[9px] text-koma-muted">Use uma frase curta com os principais ingredientes. Ela também ajuda na busca.</p>
              </div>

              <details className="group overflow-hidden rounded-xl border border-koma-border bg-koma-panel">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-3 text-[10px] font-bold text-koma-secondary">
                  <span>
                    Fotos do produto
                    <span className="ml-1 font-normal text-koma-muted">
                      {([prodFormImagem, prodFormImagem2, prodFormImagem3].filter((url) => url.trim()).length > 0)
                        ? `(${[prodFormImagem, prodFormImagem2, prodFormImagem3].filter((url) => url.trim()).length} adicionada${[prodFormImagem, prodFormImagem2, prodFormImagem3].filter((url) => url.trim()).length === 1 ? '' : 's'})`
                        : '(opcional)'}
                    </span>
                  </span>
                  <span className="text-[9px] font-medium text-koma-muted group-open:hidden">
                    {[prodFormImagem, prodFormImagem2, prodFormImagem3].some((url) => url.trim()) ? 'Ver fotos' : 'Adicionar fotos'}
                  </span>
                  <span className="hidden text-[9px] font-medium text-koma-muted group-open:inline">Ocultar</span>
                </summary>
                <div className="space-y-2 border-t border-koma-border p-3">
                  <p className="text-[9px] leading-relaxed text-koma-muted">Cole o endereço de até três fotos. A primeira será a imagem principal.</p>
                <input
                  type="text"
                  placeholder="Foto principal: https://…"
                  value={prodFormImagem}
                  onChange={(e) => setProdFormImagem(e.target.value)}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
                <input
                  type="text"
                  placeholder="Segunda foto: https://…"
                  value={prodFormImagem2}
                  onChange={(e) => setProdFormImagem2(e.target.value)}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
                <input
                  type="text"
                  placeholder="Terceira foto: https://…"
                  value={prodFormImagem3}
                  onChange={(e) => setProdFormImagem3(e.target.value)}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
                </div>
              </details>

              <label htmlFor="prod-form-ativo" className={clsx('flex', 'cursor-pointer', 'items-center', 'justify-between', 'gap-3', 'rounded-xl', 'border', 'border-koma-border', 'bg-koma-panel', 'p-3')}>
                <span>
                  <strong className="block text-[10px] text-koma-foreground">Disponível para venda</strong>
                  <span className="mt-0.5 block text-[9px] text-koma-muted">Desative para manter o produto cadastrado sem oferecê-lo nos canais de venda.</span>
                </span>
                <input
                  type="checkbox"
                  id="prod-form-ativo"
                  checked={prodFormAtivo}
                  onChange={(e) => setProdFormAtivo(e.target.checked)}
                  className={clsx('rounded', 'border-koma-border', 'text-emerald-500', 'focus:ring-emerald-500', 'h-4', 'w-4', 'bg-koma-card')}
                />
              </label>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className={clsx('flex-1', 'py-2', 'bg-koma-card', 'hover:bg-koma-raised', 'border', 'border-koma-border', 'text-koma-foreground', 'rounded-xl', 'font-bold', 'cursor-pointer', 'transition-colors')}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isLoading || apiCategorias.length === 0}
                  className={clsx('flex-1', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'font-bold', 'cursor-pointer', 'transition-colors', 'disabled:opacity-50')}
                >
                  {isLoading ? 'Salvando…' : editingProduct ? 'Salvar alterações' : 'Criar produto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CRIAR/EDITAR CATEGORIA */}
      <CategoriaModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        apiBaseUrl={apiBaseUrl}
        authHeaders={authHeaders}
        onSuccess={async (category) => {
          if (onRefreshCategorias) {
            await onRefreshCategorias();
          } else {
            await fetchCategorias();
          }
          setProdFormCategoriaId(category.id);
        }}
        showToast={showToast}
      />

      {editingCrmUser && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setEditingCrmUser(null); }}
          className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'overflow-y-auto', 'cursor-pointer')}
        >
          <div className={clsx('w-full', 'max-w-md', 'bg-koma-card', 'border', 'border-koma-border', 'rounded-3xl', 'p-6', 'space-y-4', 'text-left', 'shadow-2xl', 'relative', 'animate-scale-in', 'my-8')}>
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>
                Editar Cliente CRM
              </h3>
              <button 
                type="button" 
                onClick={() => setEditingCrmUser(null)} 
                className={clsx('p-1', 'text-koma-subtle', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!crmFormNome.trim() || !crmFormTelefone.trim()) {
                  alert('Preencha todos os campos!');
                  return;
                }
                const newSaldo = fidelidadeConfig.tipo_recompensa === 'PONTOS' ? crmFormPontos : crmFormCashback;
                const updated = await handleUpdateClient(editingCrmUser.id, crmFormNome, crmFormTelefone, newSaldo);
                if (updated) setEditingCrmUser(null);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Telefone / WhatsApp:</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  required
                  autoFocus
                  placeholder="(00) 00000-0000"
                  value={crmFormTelefone}
                  onChange={(e) => setCrmFormTelefone(aplicarMascaraTelefoneInput(e.target.value))}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
              </div>

              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Nome:</label>
                <input
                  type="text"
                  required
                  value={crmFormNome}
                  onChange={(e) => setCrmFormNome(e.target.value)}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
              </div>

              {/* EDITABLE FIELDS */}
              <div className={clsx('grid', 'grid-cols-2', 'gap-4')}>
                {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? (
                  <div className={clsx('space-y-1', 'col-span-2')}>
                    <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Saldo de Pontos (Ajuste):</label>
                    <input
                      type="number"
                      required
                      value={crmFormPontos}
                      onChange={(e) => setCrmFormPontos(Number(e.target.value))}
                      className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono', 'text-xs')}
                    />
                  </div>
                ) : (
                  <div className={clsx('space-y-1', 'col-span-2')}>
                    <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Saldo Cashback R$ (Ajuste):</label>
                    <MoneyInput
            required
            value={crmFormCashback}
            onValueChange={(value) => setCrmFormCashback(Number(value || 0))}
            className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono', 'text-xs')}
          />
                  </div>
                )}
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setEditingCrmUser(null)}
                  className={clsx('flex-1', 'py-2', 'bg-koma-card', 'hover:bg-koma-raised', 'border', 'border-koma-border', 'text-koma-foreground', 'rounded-xl', 'font-bold', 'cursor-pointer', 'transition-colors')}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx('flex-1', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'font-bold', 'cursor-pointer', 'transition-colors')}
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewCrmModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewCrmModal(false); }}
          className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'overflow-y-auto', 'cursor-pointer')}
        >
          <div className={clsx('w-full', 'max-w-md', 'bg-koma-card', 'border', 'border-koma-border', 'rounded-3xl', 'p-6', 'space-y-4', 'text-left', 'shadow-2xl', 'relative', 'animate-scale-in', 'my-8')}>
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>
                Cadastrar Novo Cliente
              </h3>
              <button 
                type="button" 
                onClick={() => setShowNewCrmModal(false)} 
                className={clsx('p-1', 'text-koma-subtle', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newCrmNome.trim() || !newCrmTelefone.trim()) {
                  alert('Preencha todos os campos!');
                  return;
                }
                const created = await handleCreateClient(newCrmNome, newCrmTelefone, Number(newCrmSaldo || 0));
                if (created) setShowNewCrmModal(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Telefone / WhatsApp:</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  required
                  autoFocus
                  placeholder="(00) 00000-0000"
                  value={newCrmTelefone}
                  onChange={(e) => setNewCrmTelefone(aplicarMascaraTelefoneInput(e.target.value))}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
              </div>

              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Nome:</label>
                <input
                  type="text"
                  required
                  value={newCrmNome}
                  onChange={(e) => setNewCrmNome(e.target.value)}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
              </div>

              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>
                  {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? 'Pontos Iniciais:' : 'Cashback Inicial R$:'}
                </label>
                {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? (
        <input
          type="number"
          step="1"
          value={newCrmSaldo}
          onChange={(e) => setNewCrmSaldo(e.target.value === '' ? '' : Number(e.target.value))}
          className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono', 'text-xs')}
        />
      ) : (
        <MoneyInput
          value={newCrmSaldo}
          onValueChange={setNewCrmSaldo}
          className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono', 'text-xs')}
        />
      )}
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowNewCrmModal(false)}
                  className={clsx('flex-1', 'py-2', 'border', 'border-koma-border', 'hover:border-koma-border', 'bg-zinc-950', 'text-koma-subtle', 'hover:text-koma-foreground', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx('flex-1', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewInsumoModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewInsumoModal(false); }}
          className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'overflow-y-auto', 'cursor-pointer')}
        >
          <div className={clsx('w-full', 'max-w-md', 'bg-koma-dialog', 'border', 'border-koma-border', 'rounded-3xl', 'p-6', 'space-y-4', 'text-left', 'shadow-2xl', 'relative', 'animate-scale-in', 'my-8')}>
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>
                Cadastrar Novo Ingrediente
              </h3>
              <button 
                type="button" 
                onClick={() => setShowNewInsumoModal(false)} 
                className={clsx('p-1', 'text-koma-subtle', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!insumoFormNome.trim() || !insumoFormUnidade.trim()) {
                  alert('Preencha os campos obrigatórios!');
                  return;
                }
                await handleSaveInsumo(true);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Nome do Ingrediente:</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Contra Filé"
                    value={insumoFormNome}
                    onChange={(e) => setInsumoFormNome(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
              </div>

              <div className={clsx('grid', 'grid-cols-3', 'gap-4')}>
                <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Unidade:</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: kg, un, l"
                    value={insumoFormUnidade}
                    onChange={(e) => setInsumoFormUnidade(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
                </div>

                <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Mínimo:</label>
                  <input
                    type="number"
                    required
                    value={insumoFormMinimo}
                    onChange={(e) => setInsumoFormMinimo(Number(e.target.value))}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono')}
                  />
                </div>

                <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Máximo:</label>
                  <input
                    type="number"
                    required
                    value={insumoFormMaximo}
                    onChange={(e) => setInsumoFormMaximo(Number(e.target.value))}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono')}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Preço de Custo Médio (R$):</label>
                <MoneyInput
                  required
                  value={insumoFormCusto}
                  onValueChange={(value) => setInsumoFormCusto(Number(value || 0))}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono', 'text-xs')}
                />
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowNewInsumoModal(false)}
                  className={clsx('flex-1', 'py-2', 'border', 'border-koma-border', 'hover:border-koma-border', 'bg-koma-raised', 'text-koma-subtle', 'hover:text-koma-foreground', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx('flex-1', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-zinc-950', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Criar Ingrediente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditInsumoModal && selectedInsumo && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowEditInsumoModal(false); }}
          className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'overflow-y-auto', 'cursor-pointer')}
        >
          <div className={clsx('w-full', 'max-w-md', 'bg-koma-dialog', 'border', 'border-koma-border', 'rounded-3xl', 'p-6', 'space-y-4', 'text-left', 'shadow-2xl', 'relative', 'animate-scale-in', 'my-8')}>
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>
                Editar Ingrediente
              </h3>
              <button 
                type="button" 
                onClick={() => setShowEditInsumoModal(false)} 
                className={clsx('p-1', 'text-koma-subtle', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!insumoFormNome.trim() || !insumoFormUnidade.trim()) {
                  alert('Preencha os campos obrigatórios!');
                  return;
                }
                await handleSaveInsumo(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Nome do Ingrediente:</label>
                <input
                  type="text"
                  required
                  value={insumoFormNome}
                  onChange={(e) => setInsumoFormNome(e.target.value)}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
              </div>

              <div className={clsx('grid', 'grid-cols-3', 'gap-4')}>
                <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Unidade:</label>
                  <input
                    type="text"
                    required
                    value={insumoFormUnidade}
                    onChange={(e) => setInsumoFormUnidade(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
                </div>

                <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Mínimo:</label>
                  <input
                    type="number"
                    required
                    value={insumoFormMinimo}
                    onChange={(e) => setInsumoFormMinimo(Number(e.target.value))}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono')}
                  />
                </div>

                <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Máximo:</label>
                  <input
                    type="number"
                    required
                    value={insumoFormMaximo}
                    onChange={(e) => setInsumoFormMaximo(Number(e.target.value))}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono')}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Preço de Custo Médio (R$):</label>
                <MoneyInput
                  required
                  value={insumoFormCusto}
                  onValueChange={(value) => setInsumoFormCusto(Number(value || 0))}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono', 'text-xs')}
                />
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowEditInsumoModal(false)}
                  className={clsx('flex-1', 'py-2', 'border', 'border-koma-border', 'hover:border-koma-border', 'bg-koma-raised', 'text-koma-subtle', 'hover:text-koma-foreground', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx('flex-1', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-zinc-950', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAjusteInsumoModal && selectedInsumo && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowAjusteInsumoModal(false); }}
          className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'overflow-y-auto', 'cursor-pointer')}
        >
          <div className={clsx('w-full', 'max-w-md', 'bg-koma-dialog', 'border', 'border-koma-border', 'rounded-3xl', 'p-6', 'space-y-4', 'text-left', 'shadow-2xl', 'relative', 'animate-scale-in', 'my-8')}>
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>
                Ajustar Estoque: {selectedInsumo.nome}
              </h3>
              <button 
                type="button" 
                onClick={() => setShowAjusteInsumoModal(false)} 
                className={clsx('p-1', 'text-koma-subtle', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (ajusteQtd <= 0) {
                  alert('A quantidade do ajuste deve ser maior que zero!');
                  return;
                }
                await handleAjustarEstoque();
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Tipo de Ajuste:</label>
                <div className={clsx('grid', 'grid-cols-2', 'gap-2')}>
                  <button
                    type="button"
                    onClick={() => setAjusteTipo('ENTRADA')}
                    className={clsx(
                      'py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer',
                      ajusteTipo === 'ENTRADA'
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 font-bold'
                        : 'bg-koma-raised border-koma-border text-koma-subtle hover:text-koma-foreground font-bold'
                    )}
                  >
                    Entrada (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAjusteTipo('SAIDA')}
                    className={clsx(
                      'py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer',
                      ajusteTipo === 'SAIDA'
                        ? 'bg-red-500/10 border-red-500/60 text-red-400 font-bold'
                        : 'bg-koma-raised border-koma-border text-koma-subtle hover:text-koma-foreground font-bold'
                    )}
                  >
                    Saída (-)
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Quantidade ({selectedInsumo.unidade_medida}):</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={ajusteQtd}
                  onChange={(e) => setAjusteQtd(Number(e.target.value))}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono', 'text-xs')}
                />
              </div>

              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Justificativa:</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Ajuste de inventário / Perda por validade"
                  value={ajusteJustificativa}
                  onChange={(e) => setAjusteJustificativa(e.target.value)}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-input', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowAjusteInsumoModal(false)}
                  className={clsx('flex-1', 'py-2', 'border', 'border-koma-border', 'hover:border-koma-border', 'bg-koma-raised', 'text-koma-subtle', 'hover:text-koma-foreground', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx('flex-1', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-zinc-950', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Confirmar Ajuste
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewDistModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewDistModal(false); }}
          className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'overflow-y-auto', 'cursor-pointer')}
        >
          <div className={clsx('w-full', 'max-w-md', 'bg-koma-card', 'border', 'border-koma-border', 'rounded-3xl', 'p-6', 'space-y-4', 'text-left', 'shadow-2xl', 'relative', 'animate-scale-in', 'my-8')}>
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>
                Cadastrar Novo Fornecedor
              </h3>
              <button 
                type="button" 
                onClick={() => setShowNewDistModal(false)} 
                className={clsx('p-1', 'text-koma-subtle', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!distFormNomeFantasia.trim()) {
                  alert('Preencha os campos obrigatórios!');
                  return;
                }
                await handleSaveDistribuidor(true);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Nome Fantasia:</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Ambev"
                    value={distFormNomeFantasia}
                    onChange={(e) => setDistFormNomeFantasia(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
              </div>

              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Razão Social:</label>
                <input
                  type="text"
                  placeholder="ex: Companhia de Bebidas das Américas"
                  value={distFormRazaoSocial}
                  onChange={(e) => setDistFormRazaoSocial(e.target.value)}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
              </div>

              <div className={clsx('grid', 'grid-cols-2', 'gap-4')}>
                <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>CNPJ:</label>
                  <input
                    type="text"
                    placeholder="00.000.000/0000-00"
                    value={distFormCnpj}
                    onChange={(e) => setDistFormCnpj(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono', 'text-xs')}
                  />
                </div>

                <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Lead Time (dias):</label>
                  <input
                    type="number"
                    required
                    value={distFormLeadTime}
                    onChange={(e) => setDistFormLeadTime(Number(e.target.value))}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono')}
                  />
                </div>
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowNewDistModal(false)}
                  className={clsx('flex-1', 'py-2', 'border', 'border-koma-border', 'hover:border-koma-border', 'bg-zinc-955', 'text-koma-subtle', 'hover:text-koma-foreground', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx('flex-1', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditDistModal && selectedDist && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowEditDistModal(false); }}
          className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'overflow-y-auto', 'cursor-pointer')}
        >
          <div className={clsx('w-full', 'max-w-md', 'bg-koma-card', 'border', 'border-koma-border', 'rounded-3xl', 'p-6', 'space-y-4', 'text-left', 'shadow-2xl', 'relative', 'animate-scale-in', 'my-8')}>
            <div className={clsx('flex', 'justify-between', 'items-center', 'pb-2', 'border-b', 'border-koma-border')}>
              <h3 className={clsx('font-serif', 'text-sm', 'font-bold', 'text-koma-foreground')}>
                Editar Fornecedor: {selectedDist.nome_fantasia}
              </h3>
              <button 
                type="button" 
                onClick={() => setShowEditDistModal(false)} 
                className={clsx('p-1', 'text-koma-subtle', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!distFormNomeFantasia.trim()) {
                  showToast('Preencha o nome fantasia!', 'info');
                  return;
                }
                await handleSaveDistribuidor(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Nome Fantasia:</label>
                <input
                  type="text"
                  required
                  value={distFormNomeFantasia}
                  onChange={(e) => setDistFormNomeFantasia(e.target.value)}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
              </div>

              <div className="space-y-1">
                <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Razão Social:</label>
                <input
                  type="text"
                  value={distFormRazaoSocial}
                  onChange={(e) => setDistFormRazaoSocial(e.target.value)}
                  className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]')}
                />
              </div>

              <div className={clsx('grid', 'grid-cols-2', 'gap-4')}>
                <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>CNPJ:</label>
                  <input
                    type="text"
                    value={distFormCnpj}
                    onChange={(e) => setDistFormCnpj(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono', 'text-xs')}
                  />
                </div>

                <div className="space-y-1">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'uppercase', 'tracking-wider', 'block')}>Lead Time (dias):</label>
                  <input
                    type="number"
                    required
                    value={distFormLeadTime}
                    onChange={(e) => setDistFormLeadTime(Number(e.target.value))}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-koma-panel', 'border', 'border-koma-border', 'rounded-xl', 'text-koma-foreground', 'focus:outline-none', 'focus:border-[#10b981]', 'font-mono')}
                  />
                </div>
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowEditDistModal(false)}
                  className={clsx('flex-1', 'py-2', 'border', 'border-koma-border', 'hover:border-koma-border', 'bg-zinc-950', 'text-koma-subtle', 'hover:text-koma-foreground', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={clsx('flex-1', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showFichaTecnicaModal && (
        <FichaTecnicaModal
          produtos={apiProdutos}
          insumos={estoqueInsumos}
          fichas={fichasTecnicas}
          onClose={() => setShowFichaTecnicaModal(false)}
          onSave={async (produtoId, itens) => {
            try {
              const response = await fetch(`${apiBaseUrl}/estoque/fichas-tecnicas/${produtoId}`, {
                method: 'PUT',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ itens }),
              });
              const data = await response.json();
              if (!response.ok) throw new Error(data.detail || 'Não foi possível salvar a ficha técnica.');
              setFichasTecnicas(current => {
                const remaining = current.filter(item => item.produto_id !== produtoId);
                return [...remaining, data].sort((left, right) => left.produto_nome.localeCompare(right.produto_nome, 'pt-BR'));
              });
              showToast('Ficha técnica salva. As próximas vendas já baixarão o estoque.');
              return true;
            } catch (error) {
              showToast(error instanceof Error ? error.message : 'Erro ao salvar ficha técnica.', 'error');
              return false;
            }
          }}
        />
      )}

      {/* MODAL DE ENTRADA MANUAL DE ESTOQUE */}
      {showEntradaManualModal && (
        <EntradaManualModal
          distribuidores={distribuidores}
          insumos={estoqueInsumos}
          onClose={() => setShowEntradaManualModal(false)}
          onSubmit={async (payload) => {
            const res = await fetch(`${apiBaseUrl}/estoque/entradas/manual`, {
              method: 'POST',
              headers: { ...authHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.detail || 'Erro ao gravar entrada manual.');
            showToast('✓ Entrada manual gravada com sucesso!');
            // Refresh stock data
            fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setEstoqueInsumos(d); });
            fetch(`${apiBaseUrl}/estoque/entradas`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setEntradasEstoque(d); });
            fetch(`${apiBaseUrl}/estoque/movimentacoes`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setMovimentacoesEstoque(d); });
          }}
        />
      )}

      {/* MODAL DE MOVIMENTAÇÃO DE ESTOQUE (PERDA / AJUSTES) */}
      {showMovimentacaoModal && (
        <MovimentacaoEstoqueModal
          insumos={estoqueInsumos}
          onClose={() => setShowMovimentacaoModal(false)}
          onSubmit={async (payload) => {
            const res = await fetch(`${apiBaseUrl}/estoque/movimentacoes`, {
              method: 'POST',
              headers: { ...authHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.detail || 'Erro ao salvar movimentação.');
            showToast('✓ Movimentação de estoque gravada!');
            // Refresh stock data
            fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setEstoqueInsumos(d); });
            fetch(`${apiBaseUrl}/estoque/movimentacoes`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setMovimentacoesEstoque(d); });
          }}
        />
      )}

      {/* MODAL DE INVENTÁRIO FÍSICO / CONTAGEM */}
      {showContagemModal && (
        <ContagemEstoqueModal
          insumos={estoqueInsumos}
          existingSessao={selectedContagemId ? sessoesContagemEstoque.find(s => s.id === selectedContagemId) : null}
          onClose={() => {
            setShowContagemModal(false);
            setSelectedContagemId(null);
          }}
          onSaveDraft={async (payload) => {
            const url = selectedContagemId ? `${apiBaseUrl}/estoque/contagens/${selectedContagemId}` : `${apiBaseUrl}/estoque/contagens`;
            const method = selectedContagemId ? 'PUT' : 'POST';
            const res = await fetch(url, {
              method,
              headers: { ...authHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.detail || 'Erro ao salvar rascunho de contagem.');
            showToast('✓ Rascunho de contagem salvo com sucesso!');
            fetch(`${apiBaseUrl}/estoque/contagens`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setSessoesContagemEstoque(d); });
          }}
          onConfirm={async (payload) => {
            const url = selectedContagemId ? `${apiBaseUrl}/estoque/contagens/${selectedContagemId}` : `${apiBaseUrl}/estoque/contagens`;
            const method = selectedContagemId ? 'PUT' : 'POST';
            const res = await fetch(url, {
              method,
              headers: { ...authHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.detail || 'Erro ao confirmar contagem.');
            showToast('✓ Contagem confirmada e estoques ajustados!');
            fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setEstoqueInsumos(d); });
            fetch(`${apiBaseUrl}/estoque/movimentacoes`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setMovimentacoesEstoque(d); });
            fetch(`${apiBaseUrl}/estoque/contagens`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setSessoesContagemEstoque(d); });
          }}
        />
      )}

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
        <SuprimentoModal
          onClose={() => setShowSuprimentoModal(false)}
          onSubmit={handleRegistrarSuprimento}
        />
      )}

      {/* OPERATOR MENU DRAWER OVERLAY */}
      {isOperatorDrawerOpen && (
        <div className={clsx('fixed', 'inset-0', 'z-[9998]', 'flex', 'justify-start', 'animate-fade-in')}>
          {/* Backdrop escuro com clique para fechar */}
          <div
            onClick={() => setIsOperatorDrawerOpen(false)}
            className={clsx('fixed', 'inset-0', 'bg-black/80', 'backdrop-blur-sm', 'transition-opacity', 'cursor-pointer')}
          />

          {/* Drawer Lateral - Modernized Shadcn Dark Theme */}
          <div className={clsx('relative', 'w-80', 'max-w-[85vw]', 'h-full', 'bg-koma-card', 'border-r', 'border-koma-border', 'shadow-2xl', 'flex', 'flex-col', 'justify-between', 'z-10', 'overflow-y-auto', 'p-5', 'text-koma-foreground', 'font-sans')}>
            <div className="space-y-5">
              {/* Header do Drawer */}
              <div className={clsx('flex', 'items-center', 'justify-between', 'border-b', 'border-koma-border', 'pb-4')}>
                <div className={clsx('flex', 'items-center', 'gap-2.5')}>
                  <div className={clsx('p-2', 'rounded-xl', 'bg-emerald-500/10', 'border', 'border-emerald-500/30', 'text-emerald-400')}>
                    <SlidersHorizontal size={18} />
                  </div>
                  <div>
                    <h3 className={clsx('font-bold', 'text-base', 'text-koma-foreground', 'font-serif')}>Opções do Caixa</h3>
                    <span className={clsx('text-xs', 'text-koma-subtle', 'block')}>Sessão e Preferências</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOperatorDrawerOpen(false)}
                  className={clsx('p-1.5', 'text-koma-subtle', 'hover:text-koma-foreground', 'bg-koma-panel', 'hover:bg-koma-raised', 'border', 'border-koma-border', 'rounded-xl', 'cursor-pointer', 'transition-all')}
                  title="Fechar Menu"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 1. SEÇÃO GARÇOM / OPERADOR EM ATENDIMENTO */}
              <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'rounded-2xl', 'p-4', 'space-y-3.5', 'shadow-md')}>
                <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'text-koma-subtle', 'font-extrabold', 'block')}>
                  Garçom / Operador em Atendimento
                </span>
                <div className={clsx('flex', 'items-center', 'gap-3')}>
                  <div className={clsx('h-12', 'w-12', 'rounded-2xl', 'bg-gradient-to-br', 'from-emerald-600', 'to-teal-800', 'flex', 'items-center', 'justify-center', 'font-bold', 'text-koma-foreground', 'text-lg', 'shadow-md', 'shrink-0', 'font-serif', 'border', 'border-emerald-500/30')}>
                    {(activeWaiterNome || "G").charAt(0).toUpperCase()}
                  </div>
                  <div className={clsx('min-w-0', 'flex-1')}>
                    <strong className={clsx('font-bold', 'text-base', 'text-koma-foreground', 'block', 'truncate')}>
                      {activeWaiterNome || "Georlan"}
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
                    .filter(o => o.mesaId && Number(o.mesaId) > 0 && o.status !== 'fechada' && o.status !== 'cancelado')
                    .map(o => Number(o.mesaId))
                );
                const liveTotalTablesCount = (salonTables && salonTables.length > 0) ? salonTables.length : 30;
                const liveOccupiedTablesCount = (salonTables && salonTables.length > 0)
                  ? salonTables.filter(t => {
                      const tableNum = Number(t.id || t.numero);
                      return liveOccupiedMesaIds.has(tableNum) || t.status === 'ocupada' || t.status === 'occupied' || t.status === 'fechamento';
                    }).length
                  : liveOccupiedMesaIds.size;
                const liveFreeTablesCount = Math.max(0, liveTotalTablesCount - liveOccupiedTablesCount);

                return (
                  <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'rounded-2xl', 'p-4', 'space-y-3', 'shadow-md')}>
                    <div className={clsx('flex', 'items-center', 'justify-between')}>
                      <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'text-koma-subtle', 'font-extrabold', 'block')}>
                        Status do Salão ao Vivo
                      </span>
                      <span className={clsx('text-[9px]', 'font-mono', 'text-emerald-400', 'bg-emerald-500/10', 'border', 'border-emerald-500/30', 'px-2', 'py-0.5', 'rounded-full', 'font-bold', 'uppercase', 'flex', 'items-center', 'gap-1')}>
                        <span className={clsx('w-1.5', 'h-1.5', 'rounded-full', 'bg-emerald-400', 'animate-ping')} />
                        Tempo Real
                      </span>
                    </div>
                    <div className={clsx('grid', 'grid-cols-3', 'gap-2')}>
                      <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-2.5', 'rounded-xl', 'text-center', 'shadow-xs')}>
                        <span className={clsx('text-[9px]', 'text-koma-subtle', 'block', 'font-medium')}>LIVRES</span>
                        <strong className={clsx('text-lg', 'font-bold', 'text-emerald-400', 'font-mono')}>
                          {liveFreeTablesCount}
                        </strong>
                      </div>
                      <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-2.5', 'rounded-xl', 'text-center', 'shadow-xs')}>
                        <span className={clsx('text-[9px]', 'text-koma-subtle', 'block', 'font-medium')}>OCUPADAS</span>
                        <strong className={clsx('text-lg', 'font-bold', 'text-amber-400', 'font-mono')}>
                          {liveOccupiedTablesCount}
                        </strong>
                      </div>
                      <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-2.5', 'rounded-xl', 'text-center', 'shadow-xs')}>
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
              <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'rounded-2xl', 'p-4', 'space-y-2.5', 'shadow-md')}>
                <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'text-koma-subtle', 'font-extrabold', 'block')}>
                  Atalhos de Atendimento
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (onRefreshOrders) onRefreshOrders();
                    showToast("Salão e pedidos sincronizados em tempo real!", "success");
                  }}
                  className={clsx('w-full', 'py-2.5', 'px-3', 'bg-koma-card', 'hover:bg-koma-raised/50', 'border', 'border-koma-border', 'text-koma-secondary', 'hover:text-koma-foreground', 'rounded-xl', 'text-xs', 'font-bold', 'transition-all', 'cursor-pointer', 'flex', 'items-center', 'justify-between', 'group')}
                >
                  <div className={clsx('flex', 'items-center', 'gap-2')}>
                    <RefreshCw size={14} className={clsx('text-emerald-400', 'group-hover:rotate-180', 'transition-transform', 'duration-500')} />
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
                  className={clsx('w-full', 'py-2.5', 'px-3', 'bg-koma-card', 'hover:bg-koma-raised/50', 'border', 'border-koma-border', 'text-koma-secondary', 'hover:text-koma-foreground', 'rounded-xl', 'text-xs', 'font-bold', 'transition-all', 'cursor-pointer', 'flex', 'items-center', 'justify-between', 'group')}
                >
                  <div className={clsx('flex', 'items-center', 'gap-2')}>
                    {isFullscreen ? <Minimize2 size={14} className="text-sky-400" /> : <Maximize2 size={14} className="text-sky-400" />}
                    <span>{isFullscreen ? "Sair do Modo PDV" : "Modo PDV Imersivo"}</span>
                  </div>
                  <ChevronRight size={14} className={clsx('text-koma-muted', 'group-hover:text-koma-foreground')} />
                </button>
              </div>

              {/* 4. SEÇÃO EXIBIÇÃO E PREFERÊNCIAS */}
              <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'rounded-2xl', 'p-4', 'space-y-3', 'shadow-md')}>
                <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'text-koma-subtle', 'font-extrabold', 'block')}>
                  Exibição e Preferências
                </span>
                
                <div className="space-y-1.5">
                  <span className={clsx('text-xs', 'text-koma-secondary', 'font-medium', 'block')}>Tamanho da Fonte:</span>
                  <div className={clsx('grid', 'grid-cols-3', 'gap-1', 'bg-koma-card', 'p-1', 'rounded-xl', 'border', 'border-koma-border')}>
                    {(['padrao', 'grande', 'gigante'] as const).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => changeFontSize(sz)}
                        className={`py-1 rounded-lg text-xs font-bold uppercase transition-all cursor-pointer ${fontSize === sz
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
                      {soundEnabled ? <Volume2 size={15} className="text-emerald-400" /> : <VolumeX size={15} className="text-rose-400" />}
                      <span className="text-xs text-koma-secondary font-medium">Sons e Alertas do Caixa</span>
                    </div>
                    <button
                      type="button"
                      onClick={toggleSound}
                      className={clsx(
                        'px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border',
                        soundEnabled
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20'
                      )}
                    >
                      {soundEnabled ? 'Ativado' : 'Mudo'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      playOrderAlert('test');
                      showToast("🔊 Teste de som emitido na saída do computador!", "info");
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
