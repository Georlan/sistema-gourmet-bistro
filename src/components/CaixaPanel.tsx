import { CardapioAssetUploader } from './CardapioAssetUploader';
import { supabase } from '../cardapio/SupabaseClient';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  DollarSign, ArrowUpRight, ArrowDownRight, Lock, Unlock, Users,
  Receipt, ShoppingCart, Percent, CreditCard, Check, AlertTriangle,
  Clock, X, RefreshCw, Edit3, Trash2, Plus, ChevronRight,
  MapPin, ClipboardList, BarChart2, Package, Shield, ShieldCheck, Star,
  MessageSquare, Send, Printer, Cpu, HelpCircle, Smartphone,
  Gift, Tag, TrendingUp, Heart, Globe, Menu, Maximize2, Minimize2,
  SlidersHorizontal, Upload, Copy, Search} from 'lucide-react';
import { Order, OrderItem, CaixaTurno, CaixaMovimentacao, Pagamento, Table, Product, EntradaEstoque, MovimentacaoEstoque, SessaoContagemEstoque, CaixaTurnoResumo, FechamentoCaixaResult } from '../types';
import { EstoqueEntradasTab } from './estoque/EstoqueEntradasTab';
import { EntradaManualModal } from './estoque/EntradaManualModal';
import { EstoqueMovimentacoesTab } from './estoque/EstoqueMovimentacoesTab';
import { MovimentacaoEstoqueModal } from './estoque/MovimentacaoEstoqueModal';
import { EstoqueContagemTab } from './estoque/EstoqueContagemTab';
import { ContagemEstoqueModal } from './estoque/ContagemEstoqueModal';
import { CaixaTurnoAtualTab } from './caixa/CaixaTurnoAtualTab';
import { CaixaMovimentacoesTab } from './caixa/CaixaMovimentacoesTab';
import { SangriaModal } from './caixa/SangriaModal';
import { SuprimentoModal } from './caixa/SuprimentoModal';
import { ManagerPinModal } from './ManagerPinModal';
import { FechamentoCegoModal } from './FechamentoCegoModal';
import { CaixaFechamentoTab } from './caixa/CaixaFechamentoTab';
import { RelatorioFinanceiroTab } from './relatorios/RelatorioFinanceiroTab';
import { RelatoriosVisaoGeralTab } from './relatorios/RelatoriosVisaoGeralTab';
import { RelatoriosProdutosTab } from './relatorios/RelatoriosProdutosTab';
import { EquipeDesempenhoTab } from './equipe/EquipeDesempenhoTab';
import { EquipeCargosTab } from './equipe/EquipeCargosTab';
import { PrintMonitorPanel } from './printing/PrintMonitorPanel';
import { CardapioCategoriasTab } from './cardapio/CardapioCategoriasTab';
import { CategoriaModal } from './cardapio/CategoriaModal';
import { AssistenteConfigTab } from './assistente/AssistenteConfigTab';
import { AssistenteSimuladorTab } from './assistente/AssistenteSimuladorTab';
import { AssinaturaPixTab } from './assinatura/AssinaturaPixTab';
import { PRODUCTS, CATEGORIES } from '../data';
import { getProductPresets, obterNomeCategoria, smartSearchMatch } from '../domain';
import { API } from '../config/caixaService';
import {
  ONLINE_MENU_ADDON,
  SUBSCRIPTION_PLANS,
  getSubscriptionPlan,
  normalizeSubscriptionPlan
} from '../config/subscriptionPlans';
import { ComandaActionsModal } from './ComandaActionsModal';
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
  SidebarFooter
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
  liveProdutos?: Product[];
  liveCategorias?: any[];
  onRefreshCategorias?: () => Promise<void>;
  restauranteConfig?: any;
  fetchError?: string | null;
  onOptimisticUpdateItemStatus?: (itemId: string | string[], newStatus: 'preparando' | 'pronto' | 'entregue') => void;
  onOptimisticAddOrder?: (newOrder: any) => void;
  onRemovePendingPaymentOptimistic?: (pagamentoId: string) => void;
}

// Simulated dynamic lists for tabs that don't need real backend persistence yet
interface Courier {
  id: number;
  nome: string;
  telefone: string;
  placa: string;
  status: 'disponivel' | 'em_entrega' | 'indisponivel';
  corridas: number;
}

interface DeliveryZone {
  id: number;
  bairro: string;
  taxa: number;
  tempo: string;
}

interface AccountItem {
  id: number;
  descricao: string;
  valor: number;
  vencimento: string;
  status: 'pago' | 'pendente' | 'atrasado';
  tipo: 'pagar' | 'receber';
}

interface SimulatedDeliveryOrder {
  id: string;
  cliente: string;
  telefone: string;
  itens: string;
  total: number;
  canal: 'ifood' | 'site' | 'whats';
  modalidade: 'delivery' | 'retirada';
  pago: boolean;
  status: 'pendente' | 'analise' | 'producao' | 'pronto' | 'transito';
  endereco?: string;
  criadoEm: string;
  numeroPedido?: number;
}

interface SystemUser {
  id: string;
  nome: string;
  telefone?: string;
  cargo?: string;
  usuario?: string;
  role?: string;
  status?: 'pendente_ativacao' | 'ativo' | 'inativo' | string;
  created_at?: string;
}

interface BotChatMessage {
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
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
  liveProdutos = [],
  liveCategorias = [],
  restauranteConfig,
  fetchError,
  onOptimisticUpdateItemStatus,
  onOptimisticAddOrder,
  onRemovePendingPaymentOptimistic
}: CaixaPanelProps) {
  const currentPlanId = normalizeSubscriptionPlan(
    restauranteConfig?.plano_efetivo ?? restauranteConfig?.plano
  );
  const currentPlan = getSubscriptionPlan(currentPlanId);
  const hasPrinting = currentPlanId !== 'pocket';
  const hasOnlineMenu = currentPlanId === 'premium' || restauranteConfig?.cardapio_online_addon === true;


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
  const handleSaveFidelityConfig = (e: any) => { e.preventDefault(); };
  const onRefreshCategorias = async () => {};
  const handleDespacharPedido = async (id: any, mId: any) => {};
  const handleCadastrarMotoboy = (e: any) => { e.preventDefault(); };

  const [activeTab, setActiveTab] = useState<
    'operacao' | 'cardapio' | 'estoque' | 'financeiro' | 'clientes' | 'relatorios' | 'assistente_koma' | 'configuracoes' | 'permissoes_cargos' | 'impressao_salao' | 'assinatura_pix' | 'cardapio_digital' | 'dashboard' | 'robo_ia'
  >(() => {
    const saved = sessionStorage.getItem('koma_active_tab');
    if (saved === 'config_cardapio' || saved === 'configuracoes_cardapio') return 'cardapio_digital';
    if (saved === 'dashboard' || saved === 'indicadores') return 'relatorios';
    if (saved === 'robo_ia' || saved === 'chat_copiloto') return 'assistente_koma';
    return (saved as any) || 'operacao';
  });

  const [activeSubTab, setActiveSubTab] = useState<string>(() => {
    const saved = sessionStorage.getItem('koma_active_subtab');
    if (!saved) return 'pedidos';
    if (saved === 'fila_pedidos') return 'pedidos';
    if (saved === 'terminal_balcao' || saved === 'pdv') return 'balcao';
    if (saved === 'layout_salao' || saved === 'salon') return 'mesas';
    if (['insumos', 'estoque_insumos'].includes(saved)) return 'insumos';
    if (['xml', 'notas', 'entradas'].includes(saved)) return 'xml';
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
    if (['clientes', 'crm', 'banco_clientes', 'fidelidade', 'programa_fidelidade'].includes(saved)) return 'clientes';
    if (['cupons', 'cupom', 'descontos', 'cupons_desconto'].includes(saved)) return 'cupons';
    // Assistente Kôma mappings
    if (['chat_copiloto', 'chat'].includes(saved)) return 'chat';
    if (['robo_ia', 'prompt', 'prompt_atendente', 'configuracao'].includes(saved)) return 'configuracao';
    if (['simulador', 'simulador_chat'].includes(saved)) return 'simulador';
    // Placeholders redirection
    if (['fiscal', 'notas_fiscais'].includes(saved)) return 'turno_atual';
    if (['recuperador', 'carrinhos_abandonados'].includes(saved)) return 'clientes';
    return saved;
  });

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [balcaoMobileView, setBalcaoMobileView] = useState<'produtos' | 'carrinho'>('produtos');

  useEffect(() => {
    sessionStorage.setItem('koma_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    let sanitized = activeSubTab;
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
  const [quickActionsOrder, setQuickActionsOrder] = useState<Order | null>(null);

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


  // Configurações do Cardápio Digital Whitelabel
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
  const tableOrdersInProduction = (() => {
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
            timestamp: comanda.timestamp || (typeof rawTableTimestamp === 'number' ? rawTableTimestamp : Date.parse(rawTableTimestamp || '')),
            criadoEm: (comanda as any).criadoEm || comanda.created_at,
            mesa: mesaEntity,
            itens: preparingItems
          });
        }
      });
    });
    return list;
  })();

  // Col 3 — Fechar conta: mesas com status 'aguardando_pagamento' (conta pedida) ou itens prontos individualmente
  // Unifica comandas da mesma mesa em um único card de pagamento.
  const tableOrdersReady = (() => {
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
      const temItensEmPreparo = (orders || [])
        .filter(o => o.mesaId === mesaId)
        .some(o => {
          const arr = Array.isArray(o?.itens) ? o.itens : Array.isArray(o?.items) ? o.items : [];
          return arr.some(i => i.status === 'preparando');
        });

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
          const t1 = typeof cTime === 'number' ? cTime : Date.parse(cTime);
          const t2 = typeof oldestComandaTime === 'number' ? oldestComandaTime : Date.parse(oldestComandaTime);
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
        timestamp: firstComanda.timestamp || (typeof oldestComandaTime === 'number' ? oldestComandaTime : Date.parse(oldestComandaTime || '')),
        criadoEm: (firstComanda as any).criadoEm || firstComanda.created_at,
        mesa: mesaEntity,
        valorPago: entries.reduce((sum, e) => sum + (e.comanda.valorPago || 0), 0),
        itens: allItems,
        contaPedida: hasContaPedida,
        temItensEmPreparo: temItensEmPreparo,
        comandaIds: entries.map(e => e.comanda.id)
      });
    });

    return list;
  })();

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
      case 'robo_ia':
      case 'assistente_koma':
        setActiveSubTab('chat');
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

  const [coupons, setCoupons] = useState([
    { id: "c-1", codigo: "KOMA10", tipo: "percentual", valor: 10, ativo: true }
  ]);
  const [newCouponCode, setNewCouponCode] = useState("");
  const [newCouponVal, setNewCouponVal] = useState(10);
  const [newCouponTipo, setNewCouponTipo] = useState<'percentual' | 'fixo'>('percentual');

  const [cashbackPercent, setCashbackPercent] = useState(5);
  const [cashbackActive, setCashbackActive] = useState(true);
  const [cashbackHistory, setCashbackHistory] = useState<{ id: number; cliente: string; valorCompra: number; cashbackGerado: number; data: string; }[]>([]);
  const [abandonedCarts, setAbandonedCarts] = useState<{ id: number; cliente: string; telefone: string; itens: string; total: number; abandonadoEm: string; status: string; }[]>([]);
  const [loyaltyUsers, setLoyaltyUsers] = useState<LoyaltyCustomer[]>([]);
  const [compreGanheRules, setCompreGanheRules] = useState<{ id: number; titulo: string; descricao: string; ativa: boolean; }[]>([]);

  const handleRecuperarCart = (id: number, cliente: string, telefone: string) => {
    const msg = `Olá, ${cliente || 'Cliente'}! Notamos que seu pedido no *Kôma* não foi concluído. 🍔\n\nEstamos à disposição para te ajudar a finalizar seu pedido com o melhor atendimento!`;
    openWhatsAppMessage(telefone, msg);
    setAbandonedCarts(prev => prev.map(c => c.id === id ? { ...c, status: 'recuperado' } : c));
  };

  const handleAddCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCouponCode.trim()) return;
    setCoupons(prev => [
      ...prev,
      { id: 'c-' + Date.now(), codigo: newCouponCode.trim().toUpperCase(), tipo: newCouponTipo, valor: newCouponVal, ativo: true }
    ]);
    setNewCouponCode("");
  };

  const handleSaveFidelidadeConfig = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/fidelidade/configuracao`, {
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
    'impressao' | 'garcom' | 'taxa'
  >('impressao');
  const [configSalSubTab, setConfigSalSubTab] = useState<'pedido' | 'fechamento' | 'atendimento'>('pedido');

  // System waiters (users CRUD) list loaded from API
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
  const [newUserNome, setNewUserNome] = useState('');
  const [newUserTelefone, setNewUserTelefone] = useState('');
  const [newUserRole, setNewUserRole] = useState('garcom');

  // Modals state
  const [showAbrirModal, setShowAbrirModal] = useState(false);
  const [showFecharModal, setShowFecharModal] = useState(false);
  const [showMovModal, setShowMovModal] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdIntervalRef = useRef<number | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);

  // Otimizações / Estoque / Desempenho States
  const [waitersPerformance, setWaitersPerformance] = useState<{ nome_garcon: string, pedidos_atendidos: number, comissao_acumulada: number }[]>([]);
  const [generalStats, setGeneralStats] = useState<any>(null);
  const [estoqueInsumos, setEstoqueInsumos] = useState<{ id: string, nome: string, estoque_atual: number, estoque_minimo: number, estoque_maximo: number, unidade_medida: string, preco_medio_custo: number }[]>([]);
  const [estoqueSugestoes, setEstoqueSugestoes] = useState<{ id: string, nome: string, estoque_atual: number, estoque_minimo: number, estoque_maximo: number, unidade_medida: string, quantidade_sugerida: number }[]>([]);
  const [notasEntrada, setNotasEntrada] = useState<{ id: string, numero_nota: string, chave_acesso: string, data_emissao: string, valor_total: number, distribuidor: { nome_fantasia: string, cnpj: string } | null }[]>([]);
  const [distribuidores, setDistribuidores] = useState<{ id: string, nome_fantasia: string, razao_social: string, cnpj: string, lead_time_dias: number }[]>([]);
  const [entradasEstoque, setEntradasEstoque] = useState<EntradaEstoque[]>([]);
  const [movimentacoesEstoque, setMovimentacoesEstoque] = useState<MovimentacaoEstoque[]>([]);
  const [sessoesContagemEstoque, setSessoesContagemEstoque] = useState<SessaoContagemEstoque[]>([]);
  const [showEntradaManualModal, setShowEntradaManualModal] = useState<boolean>(false);
  const [showMovimentacaoModal, setShowMovimentacaoModal] = useState<boolean>(false);
  const [showContagemModal, setShowContagemModal] = useState<boolean>(false);
  const [selectedContagemId, setSelectedContagemId] = useState<string | null>(null);

  // Caixa Reorganization States
  const [turnoResumo, setTurnoResumo] = useState<CaixaTurnoResumo | null>(null);
  const [caixaMovimentacoes, setCaixaMovimentacoes] = useState<CaixaMovimentacao[]>([]);
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
    csvContent += `Faturamento Total;R$ ${generalStats.faturamento.toFixed(2)}\n`;
    csvContent += `Faturamento de Hoje;R$ ${generalStats.faturamento_hoje.toFixed(2)}\n`;
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
  const [editingTable, setEditingTable] = useState<any | null>(null);
  const [editTableCap, setEditTableCap] = useState('');
  const [editTableNome, setEditTableNome] = useState('');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [confirmingFreeTableId, setConfirmingFreeTableId] = useState<number | null>(null);

  // Product & Category management states
  const [apiCategorias, setApiCategorias] = useState<any[]>([]);
  const [showProductModal, setShowProductModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [editingCrmUser, setEditingCrmUser] = useState<any>(null);
  const [crmFormNome, setCrmFormNome] = useState('');
  const [crmFormTelefone, setCrmFormTelefone] = useState('');
  const [crmFormPontos, setCrmFormPontos] = useState<number>(0);
  const [crmFormCashback, setCrmFormCashback] = useState<number>(0);
  const [showNewCrmModal, setShowNewCrmModal] = useState(false);
  const [newCrmNome, setNewCrmNome] = useState('');
  const [newCrmTelefone, setNewCrmTelefone] = useState('');
  const [newCrmSaldo, setNewCrmSaldo] = useState<string>('0');
  
  // Form states for Product Modal
  const [prodFormId, setProdFormId] = useState('');
  const [prodFormNome, setProdFormNome] = useState('');
  const [prodFormPreco, setProdFormPreco] = useState('');
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
  const [insumoFormId, setInsumoFormId] = useState('');
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
  const [distFormId, setDistFormId] = useState('');
  const [distFormNomeFantasia, setDistFormNomeFantasia] = useState('');
  const [distFormRazaoSocial, setDistFormRazaoSocial] = useState('');
  const [distFormCnpj, setDistFormCnpj] = useState('');
  const [distFormLeadTime, setDistFormLeadTime] = useState<number>(3);

  // Form states
  const [saldoInicial, setSaldoInicial] = useState('100.00');
  const [movTipo, setMovTipo] = useState<'suprimento' | 'sangria'>('suprimento');
  const [movValor, setMovValor] = useState('');
  const [movDesc, setMovDesc] = useState('');

  // Counted values for closing cashier
  const [decDinheiro, setDecDinheiro] = useState('');
  const [decPix, setDecPix] = useState('');
  const [decCartao, setDecCartao] = useState('');

  // Checkout payment states
  const [checkoutServiceTax, setCheckoutServiceTax] = useState(true);
  const [taxaServicoAtiva, setTaxaServicoAtiva] = useState(true);
  const [serviceTaxRate, setServiceTaxRate] = useState(10); // Customizable service rate percentage
  const [unificarViasDelivery, setUnificarViasDelivery] = useState(false);
  const [splitPeople, setSplitPeople] = useState('1');
  const [paymentMetodo, setPaymentMetodo] = useState<'dinheiro' | 'pix' | 'cartao' | 'cartao_debito' | 'cartao_credito'>('pix');
  const [paymentValor, setPaymentValor] = useState('');
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
        fetchConfiguracoes();
      }
    } catch (e) {
      console.error('Error saving configurations:', e);
      fetchConfiguracoes();
    }
  };

  // Toggle automatics
  const [autoAccept, setAutoAccept] = useState(false);

  // Search terms
  const [pdvSearch, setPdvSearch] = useState('');
  const [pdvSelectedCategory, setPdvSelectedCategory] = useState<string>('todos');

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
  const [pdvDeliveryTaxa, setPdvDeliveryTaxa] = useState('0.00');
  const [pdvTargetMesaId, setPdvTargetMesaId] = useState<number>(0);

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

  // Auto-initialize paymentValor with open balance when checkout modal opens
  useEffect(() => {
    if (showCheckoutModal && selectedOrder) {
      if (!paymentValor || parseFloat(paymentValor) <= 0) {
        const balance = getCheckoutBalance(selectedOrder);
        if (balance > 0) {
          setPaymentValor(balance.toFixed(2));
        }
      }
    } else if (!showCheckoutModal) {
      setPaymentValor('');
    }
  }, [showCheckoutModal, selectedOrder]);

  // POS Drawer Custom Events (Sangria, Suprimento, Sync)
  useEffect(() => {
    const handleOpenSangria = () => {
      setMovTipo('sangria');
      setMovValor('');
      setMovDesc('');
      setShowMovModal(true);
    };
    const handleOpenSuprimento = () => {
      setMovTipo('suprimento');
      setMovValor('');
      setMovDesc('');
      setShowMovModal(true);
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
  const [idleTimeThreshold, setIdleTimeThreshold] = useState(30);

  // Printer Messages State
  const [printHeader, setPrintHeader] = useState("Kôma Gourmet Bistrô");
  const [printFooter, setPrintFooter] = useState("");
  const [printNamePosition, setPrintNamePosition] = useState<'cabecalho' | 'rodape' | 'oculto'>('cabecalho');
  const [isTestingPrinter, setIsTestingPrinter] = useState(false);

  // AI Chatbot State
  const [aiBotActive, setAiBotActive] = useState(true);
  const [aiSystemPrompt, setAiSystemPrompt] = useState(
    "Você é o atendente virtual do restaurante Kôma. Nosso cardápio é focado em Pastéis Crocantes e Hambúrgueres Gourmet. Responda sempre de forma educada, curta e prestativa, sugerindo pratos específicos quando o cliente perguntar o que comer."
  );
  const [chatbotMessages, setChatbotMessages] = useState<BotChatMessage[]>([
    { sender: 'bot', text: "Olá! Seja bem-vindo ao Kôma. Como posso ajudar você com o nosso cardápio hoje?", timestamp: "23:00" }
  ]);
  const [chatInputText, setChatInputText] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);

  // Simulated deliveries zones
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([
    { id: 1, bairro: "Boa Viagem", taxa: 7.00, tempo: "20-30 min" },
    { id: 2, bairro: "Casa Forte", taxa: 12.00, tempo: "35-45 min" },
    { id: 3, bairro: "Pina", taxa: 5.00, tempo: "15-25 min" },
    { id: 4, bairro: "Espinheiro", taxa: 10.00, tempo: "30-40 min" }
  ]);

  const [simulatedOrders, setSimulatedOrders] = useState<SimulatedDeliveryOrder[]>([]);
  const [motoboys, setMotoboys] = useState<any[]>([]);
  const [selectedMotoboys, setSelectedMotoboys] = useState<{ [orderId: string]: string }>({});
  const [novoMotoboyNome, setNewMotoboyNome] = useState('');
  const [novoMotoboyTelefone, setNewMotoboyTelefone] = useState('');

  // ── Gaveta de Aceite (Floating Drawer) ──────────────────────────────────────
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const prevPendingCountRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Alerta sonoro via Web Audio API — sem arquivo externo
  const playPendingAlert = () => {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const frequencies = [880, 1100, 880];
      frequencies.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
        gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + i * 0.18 + 0.05);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.18 + 0.16);
        osc.start(ctx.currentTime + i * 0.18);
        osc.stop(ctx.currentTime + i * 0.18 + 0.2);
      });
    } catch (e) { /* audio not available */ }
  };

  // Drawer Overlay do Operador/Login
  const [isOperatorDrawerOpen, setIsOperatorDrawerOpen] = useState(false);

  const handleLogoutOperator = () => {
    localStorage.removeItem("koma_token");
    localStorage.removeItem("koma_user_id");
    localStorage.removeItem("koma_user_name");
    localStorage.removeItem("koma_user_role");
    localStorage.removeItem("koma_auth_token");
    localStorage.clear();
    window.location.reload();
  };

  // ── MÓDULO 3: SLA, Impressão Rápida e Expansão Compacta de Itens ──────────────
  const [nowTimestamp, setNowTimestamp] = useState<number>(() => Date.now());
  const [expandedCardIds, setExpandedCardIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTimestamp(Date.now());
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const toggleCardExpansion = (cardId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedCardIds(prev => ({ ...prev, [cardId]: !prev[cardId] }));
  };

  useEffect(() => {
    const handleOrdersUpdated = () => {
      setNowTimestamp(Date.now());
      if (onRefreshOrders) {
        onRefreshOrders();
      }
    };
    window.addEventListener('koma_orders_updated', handleOrdersUpdated);
    return () => {
      window.removeEventListener('koma_orders_updated', handleOrdersUpdated);
    };
  }, [onRefreshOrders]);

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
          if (typeof t === 'number') return t;
          if (typeof t === 'string') { const p = Date.parse(t); return isNaN(p) ? Infinity : p; }
          return Infinity;
        }).filter((t: number) => t < Infinity)
      ));

    if (!timestamp) return '0 MIN';

    let start = 0;
    if (typeof timestamp === 'number') start = timestamp;
    else if (typeof timestamp === 'string') {
      const p = Date.parse(timestamp);
      start = isNaN(p) ? 0 : p;
    } else if (timestamp instanceof Date) {
      start = timestamp.getTime();
    }

    if (!start || isNaN(start)) return '0 MIN';

    const now = Date.now();
    const diff = Math.max(0, Math.floor((now - start) / 60000));
    if (diff >= 60) {
      return `${Math.floor(diff / 60)}h ${diff % 60}m`;
    }
    return `${diff} MIN`;
  };

  // Função robusta de parser e cálculo de tempo decorrido (evitando UTC/NaN e nunca usando updated_at)
  function calcularMinutosDecorridos(timestamp: any, agora: number): number {
    if (!timestamp) return 0;

    let dataInicio = 0;
    if (typeof timestamp === 'number') {
      dataInicio = timestamp;
    } else if (typeof timestamp === 'string') {
      const parsed = Date.parse(timestamp);
      dataInicio = isNaN(parsed) ? 0 : parsed;
    } else if (timestamp instanceof Date) {
      dataInicio = timestamp.getTime();
    }

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
    const labelText = `⏱️ ${timeFormatted}`;

    if (elapsedMinutes > 25) {
      return {
        minutes: elapsedMinutes,
        badgeClass: 'bg-rose-950/70 text-rose-400/90 border-rose-900/50 font-bold',
        borderTopClass: 'border-t-2 border-t-rose-800/70',
        label: labelText
      };
    } else if (elapsedMinutes >= 15) {
      return {
        minutes: elapsedMinutes,
        badgeClass: 'bg-amber-950/60 text-amber-400/90 border-amber-900/40 font-bold',
        borderTopClass: 'border-t-2 border-t-amber-800/70',
        label: labelText
      };
    } else {
      return {
        minutes: elapsedMinutes,
        badgeClass: 'bg-slate-900/60 text-slate-400 border-slate-800/40',
        borderTopClass: '',
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
      return <p className="font-medium text-[11px] text-slate-400 italic bg-[#10121A] p-2 rounded-lg border border-[#232738]">Nenhum item adicionado</p>;
    }

    const visibleItems = isExpanded ? itemList : itemList.slice(0, 3);
    const hiddenCount = itemList.length - 3;

    return (
      <div className="space-y-0.5 bg-[#10121A] p-2 rounded-lg border border-[#232738]">
        <ul className="space-y-0.5">
          {visibleItems.map((it, idx) => (
            <li key={idx} className="font-medium text-xs text-slate-200 flex items-center justify-between font-sans truncate">
              <span className="truncate">{it.qty}× {it.name}</span>
            </li>
          ))}
        </ul>
        {itemList.length > 3 && (
          <button
            type="button"
            onClick={(e) => onToggle(cardId, e)}
            className="mt-0.5 text-[11px] font-bold text-[#10B981] hover:text-emerald-300 underline cursor-pointer block transition-all"
          >
            {isExpanded ? "▲ Recolher itens" : `+ ${hiddenCount} mais itens (expandir)`}
          </button>
        )}
      </div>
    );
  };

  // Impressão rápida de pré-conta do card no Kanban
  const handleQuickPrintOrder = async (order: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const printHeaderStr = localStorage.getItem("koma_print_header") || printHeader || "";
      const printFooterStr = localStorage.getItem("koma_print_footer") || printFooter || "";
      let url = "";
      if (order.mesaId && Number(order.mesaId) > 0) {
        url = `${apiBaseUrl}/mesas/${order.mesaId}/imprimir-recibo?apenas_valores=true`;
      } else {
        url = `${apiBaseUrl}/comandas/${order.id}/imprimir-recibo`;
      }
      const params = new URLSearchParams();
      if (printHeaderStr) params.append("print_header", printHeaderStr);
      if (printFooterStr) params.append("print_footer", printFooterStr);
      if (params.toString()) url += (url.includes('?') ? '&' : '?') + params.toString();

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

  useEffect(() => {
    const handleStorageChange = () => {
      const stored = localStorage.getItem('koma_font_size') as any;
      if (stored && ['padrao', 'grande', 'gigante'].includes(stored)) {
        setFontSize(stored);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('koma_font_size_changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('koma_font_size_changed', handleStorageChange);
    };
  }, []);

  const mapComandaToSimulatedDelivery = (c: any): SimulatedDeliveryOrder => {
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

    let criadoEm = "12:00";
    try {
      const date = new Date(c.criado_em);
      criadoEm = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) { }

    let canal: 'ifood' | 'site' | 'whats' = 'site';
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

    return {
      id: c.id,
      cliente: c.identificador || 'Cliente Sem Nome',
      telefone: c.delivery_telefone || '',
      itens: itensStr,
      total: total,
      canal: canal,
      modalidade,
      pago: activeItems.length > 0 && activeItems.every((it: any) => Boolean(it.pago)),
      status: c.delivery_status || 'pendente',
      endereco: modalidade === 'delivery' ? rawAddress : '',
      criadoEm: criadoEm,
      numeroPedido: c.numero_pedido
    };
  };

  const fetchDeliveryOrders = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/delivery/ativos`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        const mapped = data.map(mapComandaToSimulatedDelivery);
        setSimulatedOrders(mapped);
      }
    } catch (err) {
      console.error('Error fetching delivery orders', err);
    }
  };

  // Watch for new pending orders → play alert sound
  useEffect(() => {
    const pendingCount = simulatedOrders.filter(o => o.status === 'pendente').length;
    if (pendingCount > prevPendingCountRef.current && !isDrawerOpen) {
      playPendingAlert();
    }
    prevPendingCountRef.current = pendingCount;
  }, [simulatedOrders, isDrawerOpen]);

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
      fetchMotoboys();
      fetchTurno();
      if (onRefreshOrders) onRefreshOrders();
    };

    window.addEventListener('koma_orders_updated', handleDeliveryUpdate);
    return () => {
      window.removeEventListener('koma_orders_updated', handleDeliveryUpdate);
    };
  }, [apiBaseUrl, authHeaders]);

  const openSimulatedOrderDetails = (order: SimulatedDeliveryOrder) => {
    const fullComanda = orders.find(o => o.id === order.id);
    const itemsMapped = fullComanda
      ? fullComanda.itens.map((it: any) => ({
          nome: it.produto?.nome || it.nome || 'Item',
          observacao: it.observacao || '',
          cliente_nome: it.cliente_nome || it.clienteNome || 'Consumo Geral',
          status: it.status
        }))
      : order.itens.split(' + ').map((itStr: string) => {
          const match = itStr.match(/^(\d+)x\s+(.+)$/);
          return {
            nome: match ? match[2] : itStr,
            observacao: '',
            cliente_nome: 'Consumo Geral',
            status: order.status === 'pronto' ? 'pronto' : (order.status === 'transito' ? 'entregue' : 'preparando')
          };
        });

    setSelectedKanbanOrder({
      id: order.id,
      mesaId: 0,
      identificador: order.cliente,
      itens: itemsMapped,
      total: order.total
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
        showToast('Status do pedido atualizado!');
        const targetOrder = (simulatedOrders as any[]).find(o => String(o.id) === String(orderId));
        if (targetOrder && (targetOrder.telefone || targetOrder.delivery_telefone)) {
          const phone = targetOrder.telefone || targetOrder.delivery_telefone;
          const nome = targetOrder.cliente || targetOrder.identificador || 'Cliente';
          const isDelivery = statusNovo === 'transito' || statusNovo === 'saiu_para_entrega' || targetOrder.modalidade === 'delivery';
          if (['pronto', 'transito', 'saiu_para_entrega'].includes(statusNovo)) {
            const msg = buildStatusUpdateMsg(nome, isDelivery);
            openWhatsAppMessage(phone, msg);
          }
        }
      } else {
        showToast('Erro ao atualizar status do pedido.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao atualizar status.', 'error');
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
        const msg = `*NOVA ENTREGA - KÔMA* 🛵💨\n\n` +
          `📦 *Pedido:* #${order.numero_pedido || order.id}\n` +
          `👤 *Cliente:* ${order.cliente || order.identificador || 'Cliente'}\n` +
          `📍 *Endereço:* ${order.endereco || order.delivery_endereco || 'Não informado'}\n` +
          `📞 *Telefone Cliente:* ${order.telefone || order.delivery_telefone || 'Não informado'}\n` +
          `💰 *Valor a Cobrar:* R$ ${(order.total || 0).toFixed(2)}\n\n` +
          `📲 *Acesse o Painel do Entregador:* ${linkPwa}`;

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
        fetchMotoboys();
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
  // Search state for Disponibilidade tab
  const [disponibilidadeSearch, setDisponibilidadeSearch] = useState<string>('');
  // Search state for Produtos tab (Cardápio management)
  const [cardapioProdutosSearch, setCardapioProdutosSearch] = useState<string>('');

  // Online payments & billing plan states
  const [payPixActive, setPayPixActive] = useState(true);
  const [payCardActive, setPayCardActive] = useState(true);
  const [supportChats, setSupportChats] = useState<{ id: number; cliente: string; ultimaMsg: string; status: string; canal: string; }[]>([]);

  const [customerFeedbacks, setCustomerFeedbacks] = useState<{ id: number; cliente: string; estrelas: number; comentario: string; data: string; }[]>([]);
  // NEW Phase 13 States (Hybrid AI & White-Label Architecture)
  const [iaPilotMode, setIaPilotMode] = useState<'copilot' | 'autopilot'>('copilot');
  const [iaDiscountEnabled, setIaDiscountEnabled] = useState(false);
  const [iaMaxDiscount, setIaMaxDiscount] = useState(10);
  const [iaUpsellEnabled, setIaUpsellEnabled] = useState(true);
  const [iaVoiceTone, setIaVoiceTone] = useState<'direto' | 'conversador'>('conversador');
  const [iaMaxInteractions, setIaMaxInteractions] = useState(5);

  const [restaurantNicho, setRestaurantNicho] = useState<'hamburgueria' | 'pizzaria' | 'doceria' | 'alacarte' | 'selfservice'>('hamburgueria');
  const [modulesActive, setModulesActive] = useState({
    salon: true,
    delivery: true
  });

  // Co-pilot Chat thread state (demonstration data)
  const [activeChatContactId, setActiveChatContactId] = useState<number>(1);
  const [copilotContacts, setCopilotContacts] = useState([
    { id: 1, name: "Bruno Santos", phone: "(81) 98877-6655", lastMsg: "Quero 2 pastéis de carne e uma Coca em lata, pfvr", time: "10:32", pendingAction: true, iaStatus: "Aguardando Co-Piloto", audio: true, audioText: "Quero dois pastéis de carne e uma Coca em lata, por favor." },
    { id: 2, name: "Fernanda Costa", phone: "(81) 99988-1122", lastMsg: "Vocês entregam na Jaqueira?", time: "10:15", pendingAction: false, iaStatus: "Piloto Automático", audio: false },
    { id: 3, name: "Carlos Eduardo", phone: "(81) 98777-4433", lastMsg: "Qual a taxa de entrega?", time: "09:45", pendingAction: false, iaStatus: "Atendimento Humano", audio: false }
  ]);

  const [copilotMessages, setCopilotMessages] = useState<{ id: number, contactId: number, sender: 'cliente' | 'ia' | 'humano', text: string, time: string, isAudio?: boolean, audioText?: string }[]>([
    { id: 1, contactId: 1, sender: 'cliente', text: "🎤 Mensagem de Voz (0:12)", time: "10:32", isAudio: true, audioText: "Quero dois pastéis de carne e uma Coca em lata, por favor." },
    { id: 2, contactId: 2, sender: 'cliente', text: "Vocês entregam na Jaqueira?", time: "10:15" },
    { id: 3, contactId: 2, sender: 'ia', text: "Olá Fernanda! Sim, entregamos na Jaqueira. A taxa para sua região é de R$ 8,00 e o prazo estimado é de 30 a 40 minutos.", time: "10:15" },
    { id: 4, contactId: 3, sender: 'cliente', text: "Qual a taxa de entrega?", time: "09:45" },
    { id: 5, contactId: 3, sender: 'humano', text: "Bom dia Carlos! Qual seria o seu bairro de entrega?", time: "09:47" }
  ]);

  // Draft carts generated by AI Co-pilot
  const [copilotDraftCarts, setCopilotDraftCarts] = useState<{ [contactId: number]: { product: Product; quantity: number }[] }>({
    1: [
      { product: PRODUCTS.find(p => p.nome.toLowerCase().includes("pastel de carne")) || PRODUCTS[0], quantity: 2 },
      { product: PRODUCTS.find(p => p.nome.toLowerCase().includes("coca")) || PRODUCTS[3] || PRODUCTS[0], quantity: 1 }
    ]
  });

  const [copilotDraftResponses, setCopilotDraftResponses] = useState<{ [contactId: number]: string }>({
    1: "Olá Bruno! Perfeito, acabo de anotar o seu pedido de 2 pastéis de carne e 1 Coca-Cola em lata. Deseja adicionar alguma observação ou prato de sobremesa?"
  });

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
  const fetchSystemUsers = async () => {
    try {
      const data = await API.getFuncionarios();
      if (Array.isArray(data)) {
        setSystemUsers(data);
        return;
      }
    } catch (err) {
      // API call fallback
    }
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/funcionarios`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setSystemUsers(data);
          return;
        }
      }
      const resAuth = await fetch(`${apiBaseUrl}/auth/usuarios`, { headers: authHeaders });
      if (resAuth.ok) {
        const data = await resAuth.json();
        if (Array.isArray(data)) setSystemUsers(data);
      }
    } catch (fallbackErr) {
      console.error('Error fetching system users:', fallbackErr);
    }
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
      // Busca exclusivamente da tabela real 'clientes' no Supabase
      const { data: supaData } = await supabase
        .from('clientes')
        .select('*');

      if (supaData) {
        const mapped: LoyaltyCustomer[] = supaData.map((c: any) => ({
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
      console.error('Error fetching loyalty clients from Supabase:', error);
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
      if (isNew) {
        body.id = insumoFormId;
        body.estoque_atual = 0.0;
      }

      const res = await fetch(url, {
        method,
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        alert(isNew ? 'Insumo cadastrado com sucesso!' : 'Insumo atualizado com sucesso!');
        setShowNewInsumoModal(false);
        setShowEditInsumoModal(false);
        refreshEstoqueData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao salvar insumo.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao salvar insumo.');
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
      if (isNew) {
        body.id = distFormId;
      }

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
      const res = await fetch(`${apiBaseUrl}/produtos/`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        const sorted = Array.isArray(data)
          ? [...data].sort((a: any, b: any) =>
              String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' })
            )
          : data;
        setApiProdutos(sorted);
        setDynamicMenu(sorted);
      }
    } catch (e) {
      console.error('Error fetching produtos', e);
    }
  };

  const fetchCategorias = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/produtos/categorias`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setApiCategorias(data);
      }
    } catch (e) {
      console.error('Error fetching categorias', e);
    }
  };

  useEffect(() => {
    fetchTurno();
    fetchSystemUsers();
    fetchDeliveryOrders();
    fetchMotoboys();
    fetchConfiguracoes();

    const interval = setInterval(() => {
      fetchTurno();
      fetchDeliveryOrders();
    }, 5000); // Polling rápido 5s para sincronização em tempo real do Kanban

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === 'permissoes_cargos' || activeSubTab === 'equipe' || activeSubTab === 'pessoas') {
      fetchSystemUsers();
    }
  }, [activeTab, activeSubTab]);

  // Caixa API Handlers
  const fetchTurnoResumo = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/turno-atual/resumo`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setTurnoResumo(data);
      }
    } catch (e) {
      console.error("Erro ao buscar resumo do turno:", e);
    }
  };

  const fetchCaixaMovimentacoes = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/movimentacoes`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setCaixaMovimentacoes(data);
      }
    } catch (e) {
      console.error("Erro ao buscar movimentações de caixa:", e);
    }
  };

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
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    if (activeTab === 'financeiro') {
      fetchTurnoResumo();
      fetchCaixaMovimentacoes();
    }
    if ((activeTab === 'relatorios' || activeTab === 'dashboard') && ['equipe', 'relatorio_garçons'].includes(activeSubTab)) {
      fetch(`${apiBaseUrl}/garcons/relatorio?data_inicio=${startStr}&data_fim=${endStr}`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setWaitersPerformance(data);
        })
        .catch(err => console.error('Error fetching waiter report:', err));
    }
    if ((activeTab === 'relatorios' || activeTab === 'dashboard') && ['visao_geral', 'vendas', 'produtos_mais_vendidos', 'desempenho', 'relatorio_geral', 'top10'].includes(activeSubTab)) {
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

      fetch(`${apiBaseUrl}/estoque/sugestoes`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setEstoqueSugestoes(data); })
        .catch(err => console.error('Error fetching stock suggestions:', err));

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
      fetchCategorias();
    }
    if (activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital') {
      fetchCardapioConfig();
    }
  }, [activeTab, activeSubTab, desempenhoRange]);

  useEffect(() => {
    // 1. Carga inicial dos clientes
    void refreshLoyaltyUsers();

    // 2. Escuta WebSocket do Supabase Realtime para mudanças na Tabela "clientes" (0 ms)
    const channel = supabase
      .channel('realtime_crm_clientes')
      .on(
        'postgres_changes',
        {
          event: '*', // Escuta INSERT, UPDATE e DELETE
          schema: 'public',
          table: 'clientes'
        },
        (payload) => {
          console.log("⚡ Novo evento de cliente recebido via Realtime:", payload);
          if (payload.eventType === 'INSERT') {
            const novoCliente = payload.new;
            setLoyaltyUsers((prevClientes) => {
              const cleanNewPhone = (novoCliente.telefone || '').replace(/\D/g, '');
              if (prevClientes.some(c => c.id === novoCliente.id || (c.telefone || '').replace(/\D/g, '') === cleanNewPhone)) {
                return prevClientes;
              }
              const mappedNew: LoyaltyCustomer = {
                id: String(novoCliente.id || novoCliente.telefone),
                cliente: novoCliente.nome || novoCliente.cliente || 'Cliente',
                telefone: novoCliente.telefone || '',
                pontos: Number(novoCliente.saldo_pontos || 0),
                saldo_pontos: Number(novoCliente.saldo_pontos || 0),
                saldoCashback: Number(novoCliente.saldo_cashback || 0),
                saldo_cashback: Number(novoCliente.saldo_cashback || 0),
                historico: novoCliente.historico || []
              };
              return [mappedNew, ...prevClientes];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new;
            setLoyaltyUsers((prevClientes) =>
              prevClientes.map(c => (c.id === updated.id || (c.telefone || '').replace(/\D/g, '') === (updated.telefone || '').replace(/\D/g, '')) ? {
                id: String(updated.id || updated.telefone),
                cliente: updated.nome || updated.cliente || 'Cliente',
                telefone: updated.telefone || '',
                pontos: Number(updated.saldo_pontos || 0),
                saldo_pontos: Number(updated.saldo_pontos || 0),
                saldoCashback: Number(updated.saldo_cashback || 0),
                saldo_cashback: Number(updated.saldo_cashback || 0),
                historico: updated.historico || []
              } : c)
            );
          } else {
            void refreshLoyaltyUsers();
          }
        }
      )
      .subscribe((status) => {
        console.log("Status da conexão Realtime de Clientes:", status);
      });

    const handleCustomerEvent = () => {
      void refreshLoyaltyUsers();
    };
    window.addEventListener('koma_customers_updated', handleCustomerEvent);
    window.addEventListener('storage', handleCustomerEvent);

    return () => {
      window.removeEventListener('koma_customers_updated', handleCustomerEvent);
      window.removeEventListener('storage', handleCustomerEvent);
      supabase.removeChannel(channel);
    };
  }, [apiBaseUrl]);

  // Listener para mensagens nativas de WebSocket / Eventos do sistema Kôma
  useEffect(() => {
    const handleWebSocketMessage = (event: MessageEvent) => {
      try {
        const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (message?.type === 'NEW_CLIENT' || message?.type === 'CLIENTE_CADASTRADO' || message?.type === 'koma_new_client') {
          const novoCliente = message.data || message.detail;
          if (novoCliente) {
            setLoyaltyUsers((prev) => {
              const cleanPhone = (novoCliente.telefone || '').replace(/\D/g, '');
              if (prev.some(c => c.id === novoCliente.id || (c.telefone || '').replace(/\D/g, '') === cleanPhone)) {
                return prev;
              }
              const mapped: LoyaltyCustomer = {
                id: String(novoCliente.id || novoCliente.telefone),
                cliente: novoCliente.nome || novoCliente.cliente || 'Cliente',
                telefone: novoCliente.telefone || '',
                pontos: Number(novoCliente.saldo_pontos || 0),
                saldo_pontos: Number(novoCliente.saldo_pontos || 0),
                saldoCashback: Number(novoCliente.saldo_cashback || 0),
                saldo_cashback: Number(novoCliente.saldo_cashback || 0),
                historico: []
              };
              return [mapped, ...prev];
            });
          }
        }
      } catch (e) {
        // Ignora mensagens não-JSON
      }
    };

    window.addEventListener('message', handleWebSocketMessage);
    return () => window.removeEventListener('message', handleWebSocketMessage);
  }, []);

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
        body: JSON.stringify({ saldo_inicial: parseFloat(saldoInicial) })
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

  // Hold-to-confirm close shift button actions
  const startHoldConfirm = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (holdIntervalRef.current) return;

    let progress = 0;
    const interval = window.setInterval(() => {
      progress += 5; // 20 steps of 100ms = 2000ms (2 seconds)
      if (progress >= 100) {
        progress = 100;
        setHoldProgress(100);
        clearInterval(interval);
        holdIntervalRef.current = null;
        submitFecharCaixaDirectly();
      } else {
        setHoldProgress(progress);
      }
    }, 100);

    holdIntervalRef.current = interval;
  };

  const cancelHoldConfirm = () => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    setHoldProgress(0);
  };

  const submitFecharCaixaDirectly = async () => {
    setErrorMsg('');
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/turno/fechar`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          declarado_dinheiro: parseFloat(decDinheiro || '0'),
          declarado_pix: turno?.total_esperado_pix || 0,
          declarado_cartao: turno?.total_esperado_cartao || 0
        })
      });
      if (res.ok) {
        setShowFecharModal(false);
        setDecDinheiro('');
        setDecPix('');
        setDecCartao('');
        setHoldProgress(0);
        fetchTurno();
      } else {
        const data = await res.json();
        setErrorMsg(data.detail || 'Erro ao fechar caixa');
        setHoldProgress(0);
      }
    } catch (err) {
      setErrorMsg('Erro de conexão ao servidor.');
      setHoldProgress(0);
    }
  };

  // Handle close cashier
  const handleFecharCaixa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/turno/fechar`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          declarado_dinheiro: parseFloat(decDinheiro || '0'),
          declarado_pix: turno?.total_esperado_pix || 0,
          declarado_cartao: turno?.total_esperado_cartao || 0
        })
      });
      if (res.ok) {
        setShowFecharModal(false);
        setDecDinheiro('');
        setDecPix('');
        setDecCartao('');
        fetchTurno();
      } else {
        const data = await res.json();
        setErrorMsg(data.detail || 'Erro ao fechar caixa');
      }
    } catch (err) {
      setErrorMsg('Erro de conexão ao servidor.');
    }
  };

  // Handle shift movements (suprimento/sangria)
  const handleMovimentar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/turno/movimentar`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: movTipo,
          valor: parseFloat(movValor),
          descricao: movDesc
        })
      });
      if (res.ok) {
        setShowMovModal(false);
        setMovValor('');
        setMovDesc('');
        fetchTurno();
      } else {
        const data = await res.json();
        setErrorMsg(data.detail || 'Erro ao registrar movimentação');
      }
    } catch (err) {
      setErrorMsg('Erro de conexão ao servidor.');
    }
  };

  // Handle payment processing
  const handleProcessPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || isProcessingPaymentRef.current) return; // Sync ref guard
    isProcessingPaymentRef.current = true;
    setErrorMsg('');
    setIsProcessingPayment(true);

    try {
      let valorPagamento = parseFloat(paymentValor);
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

      if (isMesaPayment) {
        // A mesa é uma única conta monetária. O backend distribui esta baixa,
        // de forma atômica, entre todas as comandas abertas da mesa. A seleção
        // é opcional e serve para registrar quais itens foram quitados.
        const res = await fetch(`${apiBaseUrl}/caixa/mesas/${selectedOrder.mesaId}/pagar`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            valor: valorPagamento,
            metodo: paymentMetodo,
            incluir_taxa_servico: taxaServicoAtiva && checkoutServiceTax,
            item_ids: selectedItemIds.length > 0 ? selectedItemIds : null,
            idempotency_key: effectiveIdempotencyKey,
            cliente_id: selectedOrder.clienteId || null,
            cpf_cliente: paymentCPF.replace(/\D/g, '') || null,
            nome_cliente: selectedOrder.identificador || null,
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
        const originalVal = parseFloat(paymentValor);

        for (const [cid, data] of comandaEntries) {
          const isLast = idx === comandaEntries.length - 1;
          // Distribui o valor proporcionalmente baseado no subtotal
          const ratio = data.subtotal / totalSubtotal;
          const valToPay = isLast 
            ? originalVal - comandaEntries.slice(0, idx).reduce((sum, entry) => sum + (entry[1].subtotal / totalSubtotal) * originalVal, 0)
            : originalVal * ratio;

          const res = await fetch(`${apiBaseUrl}/caixa/comandas/${cid}/pagar`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              valor: parseFloat(valToPay.toFixed(2)),
              metodo: paymentMetodo,
              item_ids: data.itemIds,
              idempotency_key: `${effectiveIdempotencyKey}-${cid}`,
              cliente_id: selectedOrder.clienteId || null,
              cpf_cliente: paymentCPF.replace(/\D/g, '') || null,
              nome_cliente: selectedOrder.identificador || null,
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
        let remainingVal = parseFloat(paymentValor);

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

          const res = await fetch(`${apiBaseUrl}/caixa/comandas/${cid}/pagar`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              valor: parseFloat(valToPay.toFixed(2)),
              metodo: paymentMetodo,
              item_ids: null,
              idempotency_key: `${effectiveIdempotencyKey}-${cid}`,
              cliente_id: selectedOrder.clienteId || null,
              cpf_cliente: paymentCPF.replace(/\D/g, '') || null,
              nome_cliente: selectedOrder.identificador || null,
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

  // Free table instantly (Cashier power)
  const handleForceFreeTable = async (mesaId: number) => {
    if (!confirm(`Deseja realmente fechar e liberar a Mesa ${mesaId} de forma forçada?`)) return;
    const tableOrders = orders.filter(o => o.mesaId === mesaId);
    try {
      for (const comanda of tableOrders) {
        await fetch(`${apiBaseUrl}/comandas/${comanda.id}/fechar`, {
          method: "PUT",
          headers: authHeaders
        });
      }
      onRefreshOrders();
      setSelectedOrder(null);
      setShowCheckoutModal(false);
    } catch (err) {
      console.error(err);
      alert("Erro ao liberar mesa.");
    }
  };

  // Add dynamic mesa CRUD handlers
  const handleAddMesaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMesaId || isNaN(parseInt(newMesaId))) return;
    try {
      await onCreateMesa(parseInt(newMesaId), parseInt(newMesaCap), newMesaNome || undefined);
      setShowAddMesaModal(false);
      setNewMesaId('');
      setNewMesaNome('');
    } catch (err) {
      alert("Erro ao criar nova mesa.");
    }
  };

  const handleDeleteMesaAction = async (id: number) => {
    if (!confirm(`Deseja realmente remover a Mesa ${id} do salão de forma permanente?`)) return;
    try {
      await onDeleteMesa(id);
    } catch (err) {
      alert("Erro ao deletar mesa.");
    }
  };

  const openWaInvite = (telefone: string, nome: string, token: string) => {
    const link = `https://sistema-gourmet-bistro.pages.dev/ativar?token=${token}`;
    const msg = `Olá ${nome}! Você foi convidado para trabalhar no Kôma. Clique no link para criar sua senha e ativar sua conta: ${link}`;
    openWhatsAppMessage(telefone, msg);
  };

  const handleAddUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const telefoneClean = newUserTelefone.replace(/\D/g, '');
    if (!newUserNome || !telefoneClean) {
      alert("Por favor, preencha o nome e um telefone (WhatsApp) válido.");
      return;
    }
    try {
      const createdUser = await API.cadastrarFuncionario({
        nome: newUserNome,
        telefone: telefoneClean,
        cargo: newUserRole
      });
      setNewUserNome('');
      setNewUserTelefone('');
      fetchSystemUsers();

      if (createdUser && createdUser.token_convite) {
        openWaInvite(telefoneClean, createdUser.nome, createdUser.token_convite);
      } else {
        alert("Convite cadastrado com sucesso!");
      }
    } catch (err: any) {
      console.error(err);
      alert(`Erro: ${err.message || 'Falha ao enviar convite'}`);
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
          alert(`Link de convite gerado para ${user.nome}!`);
        }
      } else {
        alert(`Não foi possível reenviar o convite no momento.`);
      }
    } catch (err) {
      console.error(err);
      alert(`Erro de conexão.`);
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
        fetchSystemUsers();
      } else {
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData.detail || "Erro ao deletar usuário.";
        alert(msg);
      }
    } catch (err) {
      console.error(err);
      alert("Erro ao conectar com o servidor para deletar funcionário.");
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
    showToast("⚡ Enviando pedido para a cozinha...", 'success');

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
    setPdvDeliveryTaxa('0.00');

    try {
      const itemsList = cartItems.flatMap(item =>
        Array.from({ length: item.quantity }, () => ({
          produto_id: item.product.id,
          observacao: item.obs || '',
          cliente_nome: customerName || 'Consumo Geral'
        }))
      );

      const res = await fetch(`${apiBaseUrl}/comandas/venda-direta`, {
        method: "POST",
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: orderType === 'mesa' ? undefined : customerId || undefined,
          mesa_id: orderType === 'mesa' ? mesaId : null,
          tipo: orderType === 'mesa' ? 'Consumo no Local' : (orderType === 'entrega' ? 'Entrega' : 'Retirada'),
          identificador: customerName || undefined,
          delivery_status: orderType === 'mesa' ? undefined : 'producao',
          delivery_telefone: orderType === 'mesa' ? undefined : customerPhone,
          delivery_endereco: orderType === 'entrega' ? deliveryAddress : undefined,
          delivery_taxa: orderType === 'entrega' ? parseFloat(deliveryTaxa) || 0.0 : 0.0,
          itens: itemsList
        })
      });

      if (res.ok) {
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

  // Chatbot conversation simulation handler
  const handleSendChatbotMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInputText.trim()) return;

    const userMsg: BotChatMessage = {
      sender: 'user',
      text: chatInputText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setChatbotMessages(prev => [...prev, userMsg]);
    const promptText = chatInputText;
    setChatInputText('');
    setIsBotTyping(true);

    // Simulate smart bot typing answers based on AI context
    setTimeout(() => {
      let replyText = "Desculpe, não entendi muito bem. Você gostaria de ver nossas opções de pastéis ou hambúrgueres?";
      const lower = promptText.toLowerCase();

      if (lower.includes('pastel') || lower.includes('pasteis')) {
        replyText = "Temos pastéis tradicionais incríveis (carne, queijo, frango) a partir de R$ 12.00 e pastel doce de Nutella com Morango! Qual sabor gostaria?";
      } else if (lower.includes('burger') || lower.includes('hambur') || lower.includes('carne')) {
        replyText = "Nosso carro-chefe é o Hambúrguer Kôma, com blend artesanal de 150g, muito queijo derretido e molho especial no pão brioche! Deseja um?";
      } else if (lower.includes('bebida') || lower.includes('refrigerante') || lower.includes('coca')) {
        replyText = "Temos Coca-Cola, Guaraná, Sucos Naturais geladinhos e Cerveja Heineken em lata! Qual vai querer para acompanhar?";
      } else if (lower.includes('oi') || lower.includes('olá') || lower.includes('bom dia')) {
        replyText = "Olá! Como posso ajudar você a escolher as delícias do Kôma hoje?";
      }

      setChatbotMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: replyText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      setIsBotTyping(false);
    }, 1200);
  };

  // FILTERED menu list for PDV
  const filteredProducts = dynamicMenu.filter(p => {
    const catObj = apiCategorias.find(c => c.id === (p as any).categoria_id || c.id === p.categoria || c.nome === p.categoria);
    const catName = catObj ? catObj.nome : (typeof p.categoria === 'string' ? p.categoria : '');
    const matchesCategory = pdvSelectedCategory === 'todos' 
      || catName === pdvSelectedCategory 
      || (p as any).categoria_id === pdvSelectedCategory 
      || p.categoria === pdvSelectedCategory;
    const matchesSearch = !pdvSearch || smartSearchMatch(`${p.nome} ${p.descricao || ''}`, pdvSearch);
    return matchesSearch && matchesCategory;
  });

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
        <span className="px-2 py-0.5 text-[8px] font-bold rounded font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
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
      colorClasses = 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse font-extrabold';
      label = 'Atrasado!';
    } else if (minutes >= 10) {
      colorClasses = 'bg-amber-500/15 text-amber-300 border-amber-500/30 font-bold';
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

  const filteredCol2Simulated = useMemo(() => {
    return simulatedOrders.filter(o => o.status === 'producao').filter(order => matchesSearchQuery(order, searchQuery));
  }, [simulatedOrders, searchQuery, matchesSearchQuery]);

  const filteredCol2Table = useMemo(() => {
    return tableOrdersReady.filter(order => matchesSearchQuery(order, searchQuery));
  }, [tableOrdersReady, searchQuery, matchesSearchQuery]);

  const filteredCol3Simulated = useMemo(() => {
    return simulatedOrders.filter(o => o.status === 'transito').filter(order => matchesSearchQuery(order, searchQuery));
  }, [simulatedOrders, searchQuery, matchesSearchQuery]);

  const totalResultadosBusca = useMemo(() => {
    return filteredCol1.length + filteredCol2Simulated.length + filteredCol2Table.length + filteredCol3Simulated.length;
  }, [filteredCol1, filteredCol2Simulated, filteredCol2Table, filteredCol3Simulated]);

  return (
    <div className={`flex w-full h-screen bg-[#0B0B0C] text-white overflow-hidden font-sans selection:bg-[#10b981]/30 text-xs ${fontSize === 'grande' ? 'font-large' : fontSize === 'gigante' ? 'font-huge' : ''
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
          <div className="fixed inset-0 z-50 flex lg:hidden animate-fade-in">
            <div
              onClick={() => setIsMobileSidebarOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            />
            <Sidebar className="relative w-72 max-w-[85vw] bg-[#121214] border-r border-[#27272A] flex flex-col justify-between shrink-0 h-full z-10 shadow-2xl overflow-y-auto">
              <SidebarHeader className="p-3 border-b border-[#27272A]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsOperatorDrawerOpen(true);
                        setIsMobileSidebarOpen(false);
                      }}
                      className="p-2 rounded-xl bg-[#1C1C1F] hover:bg-[#27272A] text-slate-200 border border-[#27272A] cursor-pointer transition-colors"
                      title="Opções do Caixa / Login"
                    >
                      <SlidersHorizontal size={15} />
                    </button>
                    <div className="flex items-center gap-2">
                      <img src="/logo.png" alt="Kôma" className="w-7 h-7 object-contain" />
                      <div className="font-serif font-bold text-sm tracking-tight text-white">Kôma Caixa</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {turno?.status === 'aberto' ? (
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shadow-xs" title="Caixa Aberto" />
                    ) : (
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-600 shadow-xs" title="Caixa Fechado" />
                    )}
                    <button
                      type="button"
                      onClick={() => setIsMobileSidebarOpen(false)}
                      className="p-1 text-gray-400 hover:text-white rounded-lg cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Status do Turno */}
                <div className="mt-2 bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-2.5 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold block">Status do Turno</span>
                    <span className="font-semibold text-[10px] text-white">
                      {turno?.status === 'aberto' ? 'Caixa Aberto' : 'Caixa Fechado'}
                    </span>
                  </div>
                  {turno?.status === 'aberto' ? (
                    <button
                      onClick={() => {
                        setActiveTab('financeiro');
                        setActiveSubTab('fechamento');
                        setIsMobileSidebarOpen(false);
                      }}
                      className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold rounded-lg cursor-pointer transition-all uppercase tracking-wider"
                    >
                      Fechar
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setShowAbrirModal(true);
                        setIsMobileSidebarOpen(false);
                      }}
                      className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold rounded-lg cursor-pointer transition-all uppercase tracking-wider animate-pulse-subtle"
                    >
                      Abrir
                    </button>
                  )}
                </div>
              </SidebarHeader>

              <SidebarContent className="p-2 space-y-1">
                {[
                  {
                    category: 'Fluxo Operacional',
                    items: [
                      { id: 'operacao', label: 'Vendas', icon: ShoppingCart },
                      { id: 'cardapio', label: 'Cardápio', icon: ClipboardList },
                      { id: 'estoque', label: 'Estoque', icon: Package }
                    ]
                  },
                  {
                    category: 'Gestão de Tesouraria',
                    items: [
                      { id: 'financeiro', label: 'Caixa', icon: DollarSign },
                      { id: 'clientes', label: 'Clientes', icon: Users }
                    ]
                  },
                  {
                    category: 'Performance & BI',
                    items: [
                      { id: 'relatorios', label: 'Relatórios', icon: TrendingUp }
                    ]
                  },
                  {
                    category: 'Processos Inteligentes',
                    items: [
                      { id: 'assistente_koma', label: 'Assistente Kôma', icon: Cpu }
                    ]
                  },
                  {
                    category: 'Parâmetros do Sistema',
                    items: [
                      { id: 'permissoes_cargos', label: 'Equipe', icon: ShieldCheck },
                      { id: 'impressao_salao', label: 'Salão e Impressão', icon: Printer },
                      { id: 'assinatura_pix', label: 'Assinatura & Pix', icon: CreditCard },
                      { id: 'cardapio_digital', label: 'Cardápio Digital', icon: Globe }
                    ]
                  }
                ].map((group, gIdx) => (
                  <SidebarGroup key={gIdx}>
                    <SidebarGroupLabel className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-400">
                      {group.category}
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {group.items.map((tab) => {
                          const Icon = tab.icon;
                          const isLocked = tab.id === 'cardapio_digital' && !hasOnlineMenu;
                          const isActive = (
                            tab.id === 'cardapio_digital' ? (activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital')
                            : tab.id === 'permissoes_cargos' ? (activeTab === 'permissoes_cargos' || (activeTab === 'configuracoes' && activeSubTab === 'equipe'))
                            : tab.id === 'impressao_salao' ? (activeTab === 'impressao_salao' || (activeTab === 'configuracoes' && activeSubTab === 'impressoras'))
                            : tab.id === 'assinatura_pix' ? (activeTab === 'assinatura_pix' || (activeTab === 'configuracoes' && activeSubTab === 'planos'))
                            : tab.id === 'relatorios' ? (activeTab === 'relatorios' || activeTab === 'dashboard')
                            : tab.id === 'assistente_koma' ? (activeTab === 'assistente_koma' || activeTab === 'robo_ia' || (activeTab === 'operacao' && activeSubTab === 'chat_copiloto'))
                            : activeTab === tab.id
                          );
                          const orderCount = tab.id === 'operacao' ? (tableOrdersInProduction.length + simulatedOrders.filter(o => ['pendente', 'analise', 'producao', 'pronto', 'transito'].includes(o.status)).length + tableOrdersReady.length) : 0;

                          return (
                            <SidebarMenuItem key={tab.id}>
                              <SidebarMenuButton
                                isActive={isActive}
                                onClick={() => {
                                  setIsMobileSidebarOpen(false);
                                  if (isLocked) {
                                    setActiveTab('assinatura_pix');
                                    setActiveSubTab('planos');
                                    setPlanNoticeBanner(
                                      currentPlanId === 'pro'
                                          ? `Ative o ${ONLINE_MENU_ADDON.name} ou migre para o Kôma Premium para utilizar este recurso.`
                                          : 'O Cardápio Online Kôma está disponível no Kôma Pro como adicional e incluído no Premium.'
                                    );
                                    return;
                                  }
                                  if (tab.id === 'cardapio_digital') {
                                    setActiveTab('cardapio_digital');
                                    setActiveSubTab('cardapio_digital');
                                  } else if (tab.id === 'permissoes_cargos') {
                                    setActiveTab('permissoes_cargos');
                                    if (!['pessoas', 'desempenho'].includes(activeSubTab)) setActiveSubTab('pessoas');
                                  } else if (tab.id === 'impressao_salao') {
                                    setActiveTab('impressao_salao');
                                    setActiveSubTab('impressoras');
                                  } else if (tab.id === 'assinatura_pix') {
                                    setActiveTab('assinatura_pix');
                                    setActiveSubTab('planos');
                                  } else if (tab.id === 'relatorios') {
                                    setActiveTab('relatorios');
                                    if (!['visao_geral', 'financeiro', 'produtos'].includes(activeSubTab)) setActiveSubTab('visao_geral');
                                  } else if (tab.id === 'assistente_koma') {
                                    setActiveTab('assistente_koma');
                                    if (!['chat', 'configuracao', 'simulador'].includes(activeSubTab)) setActiveSubTab('chat');
                                  } else {
                                    handleTabChange(tab.id as any);
                                  }
                                }}
                              >
                                <Icon size={14} className={isActive ? 'text-[#10b981]' : 'text-gray-500 group-hover/button:text-white'} />
                                <span className="text-[11px]">{tab.label}</span>
                                {orderCount > 0 && <SidebarMenuBadge>{orderCount}</SidebarMenuBadge>}
                                {isLocked && (
                                  <span className="ml-auto text-[7.5px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                                    <Lock size={9} />
                                    <span>Upgrade</span>
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

              <SidebarFooter className="p-3 border-t border-[#27272A] bg-[#18181B]/40 space-y-2">
                <div className="space-y-1">
                  <span className="text-[8px] text-gray-500 uppercase tracking-widest block font-bold">Acessibilidade / Fonte</span>
                  <div className="grid grid-cols-3 gap-0.5 bg-[#09090B] p-0.5 rounded-lg border border-[#27272A]">
                    {(['padrao', 'grande', 'gigante'] as const).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => changeFontSize(sz)}
                        className={`py-0.5 rounded text-[8px] font-bold uppercase transition-all cursor-pointer ${fontSize === sz ? 'bg-[#10b981] text-[#121214]' : 'text-gray-400 hover:text-white'}`}
                      >
                        {sz === 'padrao' ? 'Pad' : sz === 'grande' ? 'Grd' : 'Ggt'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[#27272A]/50 pt-2 space-y-1">
                  <span className="text-[9px] text-gray-500 uppercase tracking-widest block">Operador ativo</span>
                  <span className="font-bold text-white block truncate text-xs">{activeWaiterNome}</span>
                  <span className="text-[9px] text-[#10b981] flex items-center gap-1 mt-1 font-mono">
                    <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-ping" />
                    Sincronização Online
                  </span>
                </div>
              </SidebarFooter>
            </Sidebar>
          </div>
        )}

        {/* DESKTOP SIDEBAR - SHADCN COMPOSABLE ARCHITECTURE */}
        <Sidebar className="hidden lg:flex w-64 bg-[#121214] border-r border-[#27272A] flex-col justify-between shrink-0">
          <SidebarHeader className="p-3.5 border-b border-[#27272A] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsOperatorDrawerOpen(true)}
                  className="p-2 rounded-xl bg-[#1C1C1F] hover:bg-[#27272A] text-slate-200 border border-[#27272A] cursor-pointer transition-colors"
                  title="Opções do Caixa / Login"
                >
                  <SlidersHorizontal size={15} />
                </button>
                <div className="flex items-center gap-2">
                  <img src="/logo.png" alt="Kôma" className="w-7 h-7 object-contain" />
                  <div className="font-serif font-bold text-sm tracking-tight text-white">Kôma Caixa</div>
                </div>
              </div>
              {turno?.status === 'aberto' ? (
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shadow-xs" title="Caixa Aberto" />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-600 shadow-xs" title="Caixa Fechado" />
              )}
            </div>

            {/* Quick status bar */}
            <div className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-2.5 flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold block">Status do Turno</span>
                <span className="font-semibold text-[10px] text-white">
                  {turno?.status === 'aberto' ? 'Caixa Aberto' : 'Caixa Fechado'}
                </span>
              </div>
              {turno?.status === 'aberto' ? (
                <button
                  onClick={() => {
                    setActiveTab('financeiro');
                    setActiveSubTab('fechamento');
                  }}
                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold rounded-lg cursor-pointer transition-all uppercase tracking-wider"
                >
                  Fechar
                </button>
              ) : (
                <button
                  onClick={() => setShowAbrirModal(true)}
                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold rounded-lg cursor-pointer transition-all uppercase tracking-wider animate-pulse-subtle"
                >
                  Abrir
                </button>
              )}
            </div>
          </SidebarHeader>

          {/* Sidebar Content */}
          <SidebarContent className="p-2 space-y-1">
            {[
              {
                category: 'Fluxo Operacional',
                items: [
                  { id: 'operacao', label: 'Vendas', icon: ShoppingCart },
                  { id: 'cardapio', label: 'Cardápio', icon: ClipboardList },
                  { id: 'estoque', label: 'Estoque', icon: Package }
                ]
              },
              {
                category: 'Gestão de Tesouraria',
                items: [
                  { id: 'financeiro', label: 'Caixa', icon: DollarSign },
                  { id: 'clientes', label: 'Clientes', icon: Users }
                ]
              },
              {
                category: 'Performance & BI',
                items: [
                  { id: 'relatorios', label: 'Relatórios', icon: TrendingUp }
                ]
              },
              {
                category: 'Processos Inteligentes',
                items: [
                  { id: 'assistente_koma', label: 'Assistente Kôma', icon: Cpu }
                ]
              },
              {
                category: 'Parâmetros do Sistema',
                items: [
                  { id: 'permissoes_cargos', label: 'Equipe', icon: ShieldCheck },
                  { id: 'impressao_salao', label: 'Salão e Impressão', icon: Printer },
                  { id: 'assinatura_pix', label: 'Assinatura & Pix', icon: CreditCard },
                  { id: 'cardapio_digital', label: 'Cardápio Digital', icon: Globe }
                ]
              }
            ].map((group, gIdx) => (
              <SidebarGroup key={gIdx}>
                <SidebarGroupLabel className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-400">
                  {group.category}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((tab) => {
                      const Icon = tab.icon;
                      const isLocked = tab.id === 'cardapio_digital' && !hasOnlineMenu;
                      const isActive = (
                        tab.id === 'cardapio_digital' ? (activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital')
                        : tab.id === 'permissoes_cargos' ? (activeTab === 'permissoes_cargos' || (activeTab === 'configuracoes' && activeSubTab === 'equipe'))
                        : tab.id === 'impressao_salao' ? (activeTab === 'impressao_salao' || (activeTab === 'configuracoes' && activeSubTab === 'impressoras'))
                        : tab.id === 'assinatura_pix' ? (activeTab === 'assinatura_pix' || (activeTab === 'configuracoes' && activeSubTab === 'planos'))
                        : tab.id === 'relatorios' ? (activeTab === 'relatorios' || activeTab === 'dashboard')
                        : tab.id === 'assistente_koma' ? (activeTab === 'assistente_koma' || activeTab === 'robo_ia' || (activeTab === 'operacao' && activeSubTab === 'chat_copiloto'))
                        : activeTab === tab.id
                      );
                      const orderCount = tab.id === 'operacao' ? (tableOrdersInProduction.length + simulatedOrders.filter(o => ['pendente', 'analise', 'producao', 'pronto', 'transito'].includes(o.status)).length + tableOrdersReady.length) : 0;

                      return (
                        <SidebarMenuItem key={tab.id}>
                          <SidebarMenuButton
                            isActive={isActive}
                            onClick={() => {
                              if (isLocked) {
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
                              if (tab.id === 'cardapio_digital') {
                                setActiveTab('cardapio_digital');
                                setActiveSubTab('cardapio_digital');
                              } else if (tab.id === 'permissoes_cargos') {
                                setActiveTab('permissoes_cargos');
                                if (!['pessoas', 'desempenho'].includes(activeSubTab)) setActiveSubTab('pessoas');
                              } else if (tab.id === 'impressao_salao') {
                                setActiveTab('impressao_salao');
                                setActiveSubTab('impressoras');
                              } else if (tab.id === 'assinatura_pix') {
                                setActiveTab('assinatura_pix');
                                setActiveSubTab('planos');
                              } else if (tab.id === 'relatorios') {
                                setActiveTab('relatorios');
                                if (!['visao_geral', 'financeiro', 'produtos'].includes(activeSubTab)) setActiveSubTab('visao_geral');
                              } else if (tab.id === 'assistente_koma') {
                                setActiveTab('assistente_koma');
                                if (!['chat', 'configuracao', 'simulador'].includes(activeSubTab)) setActiveSubTab('chat');
                              } else {
                                handleTabChange(tab.id as any);
                              }
                            }}
                          >
                            <Icon size={14} className={isActive ? 'text-[#10b981]' : 'text-gray-500 group-hover/button:text-white'} />
                            <span className="text-[11px]">{tab.label}</span>
                            {orderCount > 0 && <SidebarMenuBadge>{orderCount}</SidebarMenuBadge>}
                            {isLocked && <Lock size={10} className="ml-auto text-amber-500/70" />}
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
          <SidebarFooter className="p-3 border-t border-[#27272A] bg-[#18181B]/40 space-y-2">
            <div className="space-y-1">
              <span className="text-[8px] text-gray-500 uppercase tracking-widest block font-bold">Acessibilidade / Fonte</span>
              <div className="grid grid-cols-3 gap-0.5 bg-[#09090B] p-0.5 rounded-lg border border-[#27272A]">
                {(['padrao', 'grande', 'gigante'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => changeFontSize(sz)}
                    className={`py-0.5 rounded text-[8px] font-bold uppercase transition-all cursor-pointer ${fontSize === sz ? 'bg-[#10b981] text-[#121214]' : 'text-gray-400 hover:text-white'}`}
                  >
                    {sz === 'padrao' ? 'Pad' : sz === 'grande' ? 'Grd' : 'Ggt'}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-[#27272A]/50 pt-2 space-y-1">
              <span className="text-[9px] text-gray-500 uppercase tracking-widest block">Operador ativo</span>
              <span className="font-bold text-white block truncate text-xs">{activeWaiterNome}</span>
              <span className="text-[9px] text-[#10b981] flex items-center gap-1 mt-1 font-mono">
                <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-ping" />
                Sincronização Online
              </span>
            </div>
          </SidebarFooter>
        </Sidebar>
      </SidebarProvider>

      {/* CONTENT AREA */}
      <main className={clsx('flex-1', 'bg-[#09090B]', 'flex', 'flex-col', 'overflow-hidden', 'w-full')}>
        {/* Top header bar */}
        <header className={clsx('h-14', 'border-b', 'border-[#27272A]', 'bg-[#121214]', 'px-4', 'sm:px-6', 'flex', 'items-center', 'justify-between', 'shrink-0')}>
          <div className="flex items-center gap-2 truncate">
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              className="lg:hidden p-1.5 bg-[#1C1C1F] hover:bg-[#27272A] text-emerald-400 rounded-xl border border-[#27272A] flex items-center justify-center cursor-pointer shrink-0"
              title="Abrir Menu do Caixa"
              id="btn-mobile-caixa-sidebar-open"
            >
              <Menu size={16} />
            </button>
            <h2 className={clsx('font-serif', 'font-bold', 'text-xs', 'sm:text-sm', 'tracking-tight', 'text-white', 'uppercase', 'tracking-wider', 'truncate')}>
              {(activeTab === 'relatorios' || activeTab === 'dashboard') && 'Relatórios'}
              {(activeTab === 'assistente_koma' || activeTab === 'robo_ia') && 'Assistente Kôma'}
              {activeTab === 'operacao' && 'Gestão de Atendimento Local'}
              {activeTab === 'cardapio' && 'CARDÁPIO DO RESTAURANTE'}
              {activeTab === 'estoque' && 'GESTÃO DE ESTOQUE'}
              {activeTab === 'financeiro' && 'GESTÃO DO CAIXA'}
              {activeTab === 'clientes' && 'GESTÃO DE CLIENTES'}
              {(activeTab === 'permissoes_cargos' || (activeTab === 'configuracoes' && activeSubTab === 'equipe')) && 'Permissões e Gestão de Equipe'}
              {(activeTab === 'impressao_salao' || (activeTab === 'configuracoes' && activeSubTab === 'impressoras')) && 'Configurações do Salão'}
              {(activeTab === 'assinatura_pix' || (activeTab === 'configuracoes' && activeSubTab === 'planos')) && 'Planos de Assinatura e Recebimento Pix'}
              {(activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital') && 'Cardápio Digital — Identidade Whitelabel'}
            </h2>
          </div>

          {/* Botão MODO PDV / FULLSCREEN */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleFullscreen}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border',
                isFullscreen
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/30'
                  : 'bg-[#1C1C1F] text-gray-300 border-[#27272A] hover:bg-[#27272A] hover:text-white'
              )}
              title={isFullscreen ? "Sair do Modo PDV Tela Cheia" : "Entrar no Modo PDV Tela Cheia"}
              id="btn-modo-pdv-fullscreen"
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              <span className="hidden sm:inline">{isFullscreen ? "Sair da Tela Cheia" : "Modo PDV"}</span>
            </button>
          </div>
        </header>

        {/* Sub-tabs Navigation Bar */}
        <div className={clsx('bg-[#121214]/60', 'border-b', 'border-[#27272A]', 'px-6', 'py-1.5', 'flex', 'gap-2', 'shrink-0', 'overflow-x-auto', 'scrollbar-none')}>
          {(activeTab === 'assistente_koma' || activeTab === 'robo_ia') && [
            { id: 'chat', label: 'Chat' },
            { id: 'configuracao', label: 'Configuração' },
            { id: 'simulador', label: 'Simulador' }
          ].map(sub => {
            const isSubActive = (
              (sub.id === 'chat' && ['chat', 'chat_copiloto'].includes(activeSubTab)) ||
              (sub.id === 'configuracao' && ['configuracao', 'prompt', 'prompt_atendente'].includes(activeSubTab)) ||
              (sub.id === 'simulador' && ['simulador', 'simulador_chat'].includes(activeSubTab)) ||
              activeSubTab === sub.id
            );
            return (
              <button
                key={sub.id}
                onClick={() => setActiveSubTab(sub.id)}
                className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${isSubActive
                  ? 'bg-emerald-600/15 text-[#10b981] border border-emerald-500/20 shadow-xs'
                  : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                  }`}
              >
                {sub.label}
              </button>
            );
          })}

          {activeTab === 'operacao' && [
            { id: 'pedidos', label: 'Pedidos' },
            { id: 'balcao', label: 'Balcão' },
            { id: 'mesas', label: 'Mesas', show: modulesActive.salon }
          ].filter(sub => sub.show !== false).map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${activeSubTab === sub.id
                ? 'bg-[#046c4e] text-emerald-100 border border-emerald-700/30'
                : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              {sub.label}
            </button>
          ))}

          {activeTab === 'cardapio' && [
            { id: 'produtos', label: 'Lista de Produtos' },
            { id: 'disponibilidade', label: 'Pausar / Ativar Pratos' },
            { id: 'categorias', label: 'Categorias' }
          ].map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${activeSubTab === sub.id
                ? 'bg-[#046c4e] text-emerald-100 border border-emerald-700/30'
                : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              {sub.label}
            </button>
          ))}

          {activeTab === 'estoque' && [
            { id: 'insumos', label: 'Insumos' },
            { id: 'entradas', label: 'Entradas' },
            { id: 'movimentacoes', label: 'Movimentações' },
            { id: 'contagem', label: 'Contagem' },
            { id: 'fornecedores', label: 'Fornecedores' }
          ].map(sub => {
            const isSubActive = (
              (sub.id === 'entradas' && ['entradas', 'xml', 'notas_entrada'].includes(activeSubTab)) ||
              (sub.id === 'fornecedores' && ['fornecedores', 'distribuidores'].includes(activeSubTab)) ||
              activeSubTab === sub.id
            );
            return (
              <button
                key={sub.id}
                onClick={() => setActiveSubTab(sub.id)}
                className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${isSubActive
                  ? 'bg-emerald-600/15 text-[#10b981] border border-emerald-500/20 shadow-xs'
                  : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                  }`}
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
                className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${isSubActive
                  ? 'bg-emerald-600/15 text-[#10b981] border border-emerald-500/20 shadow-xs'
                  : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                  }`}
              >
                {sub.label}
              </button>
            );
          })}

          {activeTab === 'clientes' && [
            { id: 'clientes', label: 'Clientes' },
            { id: 'cupons', label: 'Cupons' }
          ].map(sub => {
            const isSubActive = (
              (sub.id === 'clientes' && ['clientes', 'crm', 'banco_clientes', 'fidelidade', 'programa_fidelidade'].includes(activeSubTab)) ||
              (sub.id === 'cupons' && ['cupons', 'cupom', 'descontos', 'cupons_desconto'].includes(activeSubTab)) ||
              activeSubTab === sub.id
            );
            return (
              <button
                key={sub.id}
                onClick={() => setActiveSubTab(sub.id)}
                className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${isSubActive
                  ? 'bg-emerald-600/15 text-[#10b981] border border-emerald-500/20 shadow-xs'
                  : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                  }`}
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
                className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${isSubActive
                  ? 'bg-emerald-600/15 text-[#10b981] border border-emerald-500/20 shadow-xs'
                  : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                  }`}
              >
                {sub.label}
              </button>
            );
          })}

          {(activeTab === 'permissoes_cargos') && [
            { id: 'pessoas', label: 'Pessoas' },
            { id: 'cargos_permissoes', label: 'Cargos e Permissões' }
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
                className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${isSubActive
                  ? 'bg-emerald-600/15 text-[#10b981] border border-emerald-500/20 shadow-xs'
                  : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                  }`}
              >
                {sub.label}
              </button>
            );
          })}



        </div>

        {/* Dynamic Inner views */}
        <div className={clsx('flex-1', 'overflow-y-auto', 'p-5', 'relative')}>

          {/* CASHIER CLOSED WARNING BANNER */}
          {turno?.status !== 'aberto' && ['pedidos', 'balcao', 'mesas', 'kds'].includes(activeSubTab) && (
            <div className={clsx('absolute', 'inset-0', 'bg-black/80', 'backdrop-blur-xs', 'z-30', 'flex', 'flex-col', 'items-center', 'justify-center', 'text-center', 'p-8', 'space-y-4')}>
              <div className={clsx('p-4', 'bg-[#1C1C1F]', 'rounded-full', 'border', 'border-amber-500/20', 'text-amber-500')}>
                <Lock size={32} />
              </div>
              <h3 className={clsx('font-serif', 'text-base', 'font-bold', 'text-white')}>Turno de Caixa Fechado</h3>
              <p className={clsx('max-w-md', 'text-[10px]', 'text-gray-400', 'leading-relaxed')}>
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
            <div className={clsx('h-full', 'flex', 'flex-col', 'space-y-4')}>

              {/* ALERTA DE PAGAMENTO PENDENTE EM DINHEIRO (GARÇOM) */}
              {pagamentosPendentes.length > 0 && (
                <div className="bg-[#1C1C1F] border-2 border-amber-500/40 p-4 rounded-2xl space-y-3 animate-pulse-subtle">
                  <div className="flex items-center gap-2 text-amber-500 font-bold uppercase tracking-wider text-[10px]">
                    <AlertTriangle size={14} />
                    <span>Confirmação de Dinheiro Pendente ({pagamentosPendentes.length})</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {pagamentosPendentes.map((pag) => {
                      const comandaMesa = orders.find(o => o.id === pag.comanda_id);
                      const mesaNum = comandaMesa ? comandaMesa.mesaId : '?';
                      return (
                        <div key={pag.id} className="bg-[#09090B] border border-[#27272A] p-3 rounded-xl flex justify-between items-center gap-4 text-[11px] text-left">
                          <div>
                            <span className="text-gray-400 block">Mesa {mesaNum}</span>
                            <span className="font-bold text-white block">R$ {pag.valor.toFixed(2)} em Dinheiro</span>
                            <span className="text-[9.5px] text-[#10b981] block font-mono">Garçom solicitante: {pag.nome_cliente || 'Garçom'}</span>
                          </div>
                          <div className="flex gap-2">
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
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[9px] uppercase tracking-wider transition-all cursor-pointer"
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
                              className="px-3 py-1.5 bg-rose-950/30 border border-rose-900/35 text-rose-400 hover:bg-rose-900/20 hover:text-white rounded-lg font-bold text-[9px] transition-all cursor-pointer"
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
              <div className="bg-[#121214] border border-[#27272A] p-3 rounded-2xl flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 sticky top-0 z-20 shadow-md backdrop-blur-md">
                {/* Search Bar Component */}
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar cliente, mesa (ex: 10), telefone ou item..."
                    className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm bg-[#121316] border border-[#252832] rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-[#059669] focus:ring-1 focus:ring-[#059669] transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white text-xs font-bold bg-zinc-800/80 rounded-full w-4 h-4 flex items-center justify-center cursor-pointer"
                      title="Limpar busca"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between md:justify-end gap-3 shrink-0">
                  <label className="flex items-center gap-2 cursor-pointer font-semibold text-gray-300 text-xs">
                    <input
                      type="checkbox"
                      checked={autoAccept}
                      onChange={(e) => setAutoAccept(e.target.checked)}
                      className="rounded border-[#27272A] text-emerald-500 focus:ring-emerald-500 h-3.5 w-3.5 bg-[#121214]"
                    />
                    <span>Aceitar os pedidos automaticamente (iFood/Apps)</span>
                  </label>
                  <div className="text-[10px] text-gray-400">
                    Total Delivery hoje: <strong className="text-white">R$ {simulatedOrders.reduce((s, o) => s + o.total, 0).toFixed(2)}</strong>
                  </div>
                  {/* Bell button — opens floating drawer */}
                  <button
                    type="button"
                    onClick={() => { setIsDrawerOpen(true); }}
                    className="relative flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 rounded-xl transition-all cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                    <span className="text-[10px] font-bold">Novos Pedidos</span>
                    {simulatedOrders.filter(o => o.status === 'pendente').length > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-black animate-bounce">
                        {simulatedOrders.filter(o => o.status === 'pendente').length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Badge indicador de busca ativa */}
              {searchQuery.trim() !== '' && (
                <div className="bg-slate-800/90 border border-slate-700/80 px-4 py-2 rounded-xl flex items-center justify-between text-xs text-slate-300 shadow-sm transition-all mt-2">
                  <div className="flex items-center gap-2">
                    <Search size={14} className="text-emerald-400" />
                    <span>Exibindo <strong className="text-white font-mono">{totalResultadosBusca}</strong> {totalResultadosBusca === 1 ? 'resultado' : 'resultados'} para "<strong className="text-emerald-300">{searchQuery}</strong>"</span>
                  </div>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="text-emerald-400 hover:text-emerald-300 font-bold ml-2 underline cursor-pointer text-xs transition-colors"
                  >
                    Limpar busca
                  </button>
                </div>
              )}

              {/* ── FLOATING DRAWER: Pedidos Pendentes ─────────────────────────────── */}
              {isDrawerOpen && (
                <div
                  className="fixed inset-0 z-50 flex"
                  onClick={() => setIsDrawerOpen(false)}
                >
                  {/* Backdrop */}
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                  {/* Drawer panel */}
                  <div
                    className="relative ml-auto h-full w-full max-w-sm bg-[#0F0F11] border-l border-[#27272A] flex flex-col shadow-2xl"
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Drawer header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-[#27272A] shrink-0">
                      <div>
                        <h2 className="font-bold text-white text-sm">Novos Pedidos</h2>
                        <p className="text-[10px] text-gray-400 mt-0.5">Aceite ou recuse cada pedido antes de produzir</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsDrawerOpen(false)}
                        className="p-1.5 rounded-lg bg-[#1C1C1F] border border-[#27272A] text-gray-400 hover:text-white cursor-pointer"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>

                    {/* Drawer body */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {simulatedOrders.filter(o => o.status === 'pendente').length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-gray-500 text-[11px] italic">
                          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-40"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                          Nenhum pedido pendente
                        </div>
                      ) : (
                        simulatedOrders.filter(o => o.status === 'pendente').map((order) => (
                          <div key={order.id} className="bg-[#1C1C1F] border border-amber-500/20 hover:border-amber-500/40 p-4 rounded-xl space-y-3 transition-all">
                            <div className="flex justify-between items-start">
                              <div>
                                <div className="flex flex-wrap gap-1 mb-1">
                                  <span className={clsx(
                                    'px-1.5 py-0.5 text-[8px] uppercase tracking-wider font-bold rounded border font-mono',
                                    order.modalidade === 'delivery'
                                      ? 'bg-orange-500/15 text-orange-300 border-orange-500/25'
                                      : 'bg-violet-500/15 text-violet-300 border-violet-500/25'
                                  )}>
                                    {order.modalidade === 'delivery' ? 'Delivery' : 'Retirada'}
                                  </span>
                                  <span className="px-1.5 py-0.5 text-[8px] uppercase tracking-wider font-bold bg-slate-500/10 text-slate-300 border border-slate-500/20 rounded font-mono">
                                    {order.canal}
                                  </span>
                                </div>
                                <strong className="text-white text-sm block">{order.cliente}</strong>
                                <span className="text-[10px] text-gray-400 block">{order.telefone}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-bold text-amber-400 font-mono text-sm block">R$ {order.total.toFixed(2)}</span>
                                <span className="text-[9px] text-gray-500">{order.criadoEm}</span>
                                {order.numeroPedido && <span className="text-[8px] text-gray-600 font-mono block">#{order.numeroPedido}</span>}
                              </div>
                            </div>

                            <p className="text-[10px] text-gray-300 bg-[#09090B] p-2 rounded border border-[#27272A]/30 leading-relaxed font-mono">
                              {order.itens}
                            </p>

                            {order.endereco && (
                              <span className="text-[10px] text-gray-400 flex items-start gap-1">
                                <MapPin size={11} className="shrink-0 text-rose-500 mt-0.5" />
                                <span>{order.endereco}</span>
                              </span>
                            )}

                            <div className="flex gap-2 pt-1">
                              <button
                                type="button"
                                onClick={async () => {
                                  await handleUpdateDeliveryStatus(order.id, 'producao');
                                  // Close drawer if no more pending
                                  if (simulatedOrders.filter(o => o.status === 'pendente').length <= 1) setIsDrawerOpen(false);
                                }}
                                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] transition-all cursor-pointer uppercase tracking-wider"
                              >
                                ✓ Aceitar
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await handleRecusarPedido(order.id);
                                  if (simulatedOrders.filter(o => o.status === 'pendente').length <= 1) setIsDrawerOpen(false);
                                }}
                                className="px-4 py-2 bg-rose-900/30 border border-rose-900/30 hover:bg-rose-800/40 text-rose-400 hover:text-white rounded-lg font-bold text-[10px] transition-all cursor-pointer"
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

              {/* Kanban operacional universal: mesas, pedidos online e finalização. */}
              <div className={clsx('flex-1', 'flex', 'md:grid', 'md:grid-cols-3', 'gap-4', 'overflow-x-auto', 'snap-x', 'snap-mandatory', 'pb-4', 'scrollbar-thin', 'scrollbar-thumb-zinc-800')}>


                {/* COLUMN 1: Em produção */}
                <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-2xl', 'flex', 'flex-col', 'overflow-hidden', 'min-w-[85vw]', 'sm:min-w-[320px]', 'md:min-w-0', 'flex-1', 'snap-center', 'shrink-0', 'md:shrink')}>
                  <div className={clsx('bg-[#18181B]', 'px-4', 'py-2.5', 'border-b', 'border-[#27272A]', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                    <div>
                      <span className={clsx('font-bold', 'text-white', 'font-sans', 'block', 'text-sm')}>Mesas em Atendimento</span>
                      <span className="text-xs text-gray-400 block mt-0.5 font-normal">Lançados pelo garçom ou caixa</span>
                    </div>
                    <span className={clsx('bg-emerald-600/15', 'text-[#10b981]', 'font-bold', 'px-2.5', 'py-0.5', 'rounded-full', 'font-mono', 'text-xs', 'border', 'border-emerald-500/20')}>
                      {filteredCol1.length}
                    </span>
                  </div>

                  <div className={clsx('p-2.5', 'sm:p-3', 'flex-1', 'overflow-y-auto', 'space-y-2.5')}>
                    {filteredCol1.length === 0 ? (
                      <div className="py-16 text-center text-gray-400 italic text-xs space-y-1">
                        <Search size={20} className="mx-auto opacity-40 mb-2 text-gray-500" />
                        <p>{searchQuery ? "Nenhum pedido encontrado para a busca" : "Nenhum pedido local em produção"}</p>
                      </div>
                    ) : (
                      <>
                        {filteredCol1.map((order) => {
                          const preparingItems = order.itens.filter(item => item.status === 'preparando');
                          const cardId = `prod-${order.id}`;
                          const sla = getOrderSlaData(order, nowTimestamp);
                          const isExpanded = !!expandedCardIds[cardId];
                          const totalVal = order.itens.reduce((sum: number, it: any) => sum + (it.preco_unit || it.preco || 0), 0);

                          return (
                            <div 
                              key={`table-prod-${order.id}`} 
                              onClick={() => setSelectedKanbanOrder(order)}
                              className={clsx(
                                'bg-[#18181B] hover:bg-[#1C1C1F] border border-[#27272A] rounded-xl hover:border-[#10b981]/50 transition-colors p-2.5 sm:p-3 space-y-2 text-left cursor-pointer shadow-sm',
                                sla.borderTopClass || 'border-t-2 border-t-emerald-800/70'
                              )}
                            >
                              {/* LINHA 1 (Top Bar do Card) */}
                              <div className="flex justify-between items-center gap-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={clsx('px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold rounded-md border font-mono block w-fit shadow-xs', sla.badgeClass)}>
                                    {sla.label}
                                  </span>
                                  <span className="px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold bg-emerald-600/15 text-[#10b981] border border-emerald-500/20 rounded-md font-mono block w-fit">
                                    {order.mesaId && order.mesaId > 0 ? `MESA ${order.mesaId}` : 'BALCÃO'}
                                  </span>
                                  {order.mesaOrigemId && Number(order.mesaOrigemId) !== Number(order.mesaId) && (
                                    <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-bold bg-emerald-600/15 text-[#10b981] border border-emerald-500/20 rounded-md font-sans block w-fit shadow-xs">
                                      🔗 M{order.mesaOrigemId}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => handleQuickPrintOrder(order, e)}
                                    className="p-1 bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-[#10b981] rounded-md border border-[#27272A] transition-colors cursor-pointer shadow-xs"
                                    title="Imprimir pré-conta / conferência"
                                  >
                                    <Printer size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedKanbanOrder(order);
                                    }}
                                    className="p-1 bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-[#10b981] rounded-md border border-[#27272A] transition-colors cursor-pointer shadow-xs"
                                    title="Ver detalhes do pedido"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                  <span className="font-bold text-sm sm:text-base text-[#10b981] font-mono block ml-1">
                                    R$ {totalVal.toFixed(2)}
                                  </span>
                                </div>
                              </div>

                              {/* LINHA 2 (Sub-header) */}
                              <div className="flex items-center justify-between text-xs text-gray-400">
                                <strong className="font-bold text-white text-xs sm:text-sm truncate">
                                  {(order as any).identificador || (order.mesaId && order.mesaId > 0 ? `Consumo Mesa ${order.mesaId}` : 'Consumo Balcão')}
                                </strong>
                                <span className="shrink-0 text-xs text-gray-400">Atendente: {order.garcomNome || 'Garçom'}</span>
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
                                className="w-full py-2 px-3 h-8 sm:h-9 bg-emerald-600/15 hover:bg-emerald-600/25 text-[#10b981] font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5 border border-emerald-500/20"
                              >
                                <Check size={13} />
                                <span>PRONTO → PAGAMENTO</span>
                              </button>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>

                {/* COLUMN 2: pedidos online aceitos, delivery ou retirada. */}
                <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-2xl', 'flex', 'flex-col', 'overflow-hidden', 'min-w-[85vw]', 'sm:min-w-[320px]', 'md:min-w-0', 'flex-1', 'snap-center', 'shrink-0', 'md:shrink')}>
                  <div className={clsx('bg-[#18181B]', 'px-4', 'py-2.5', 'border-b', 'border-[#27272A]', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                    <div>
                      <span className={clsx('font-bold', 'text-white', 'font-sans', 'block', 'text-sm')}>Online e Retirada</span>
                      <span className="text-xs text-gray-400 block mt-0.5 font-normal">Pedidos aceitos no sino</span>
                    </div>
                    <span className={clsx('bg-sky-600/15', 'text-sky-400', 'font-bold', 'px-2.5', 'py-0.5', 'rounded-full', 'font-mono', 'text-xs', 'border', 'border-sky-500/20')}>
                      {filteredCol2Simulated.length}
                    </span>
                  </div>

                  <div className={clsx('p-2.5', 'sm:p-3', 'flex-1', 'overflow-y-auto', 'space-y-2.5')}>
                    {filteredCol2Simulated.length === 0 ? (
                      <div className="py-16 text-center text-gray-400 italic text-xs space-y-1">
                        <Search size={20} className="mx-auto opacity-40 mb-2 text-gray-500" />
                        <p>{searchQuery ? "Nenhum pedido encontrado para a busca" : "Nenhum pedido online em preparo"}</p>
                      </div>
                    ) : (
                      <>
                        {filteredCol2Simulated.map((order) => {
                          const cardId = `sim-prod-${order.id}`;
                          const sla = getOrderSlaData(order, nowTimestamp);
                          const isExpanded = !!expandedCardIds[cardId];
                          const isDeliveryOrder = order.modalidade === 'delivery';
                          const badgeText = isDeliveryOrder ? 'DELIVERY — PREPARANDO' : 'RETIRADA — PREPARANDO';
                          const badgeColor = isDeliveryOrder
                            ? 'bg-amber-600/15 text-amber-400 border border-amber-500/20'
                            : 'bg-sky-600/15 text-sky-400 border border-sky-500/20';
                          const buttonText = isDeliveryOrder ? 'SAIU PARA ENTREGA' : 'PRONTO PARA RETIRADA';
                          const topAccentClass = isDeliveryOrder ? 'border-t-2 border-t-amber-800/70' : 'border-t-2 border-t-sky-800/70';

                          return (
                            <div 
                              key={order.id} 
                              onClick={() => openSimulatedOrderDetails(order)}
                              className={clsx(
                                'bg-[#18181B] hover:bg-[#1C1C1F] border border-[#27272A] rounded-xl hover:border-[#10b981]/50 transition-colors p-2.5 sm:p-3 space-y-2 text-left cursor-pointer shadow-sm',
                                sla.borderTopClass || topAccentClass
                              )}
                            >
                              {/* LINHA 1 (Top Bar do Card) */}
                              <div className="flex justify-between items-center gap-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={clsx('px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold rounded-md border font-mono block w-fit shadow-xs', sla.badgeClass)}>
                                    {sla.label}
                                  </span>
                                  <span className={clsx('px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold rounded-md font-mono block w-fit', badgeColor)}>{badgeText}</span>
                                  <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-bold rounded-md border border-[#27272A] bg-[#1C1C1F] text-gray-300 font-mono">
                                    {order.canal}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => handleQuickPrintOrder(order, e)}
                                    className="p-1 bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-[#10b981] rounded-md border border-[#27272A] transition-colors cursor-pointer shadow-xs"
                                    title="Imprimir pré-conta / conferência"
                                  >
                                    <Printer size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openSimulatedOrderDetails(order);
                                    }}
                                    className="p-1 bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-[#10b981] rounded-md border border-[#27272A] transition-colors cursor-pointer shadow-xs"
                                    title="Ver detalhes do pedido"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                  <span className="font-bold text-sm sm:text-base text-[#10b981] font-mono block ml-1">
                                    R$ {order.total.toFixed(2)}
                                  </span>
                                </div>
                              </div>

                              {/* LINHA 2 (Sub-header) */}
                              <div className="flex items-center justify-between text-xs text-gray-400">
                                <strong className="font-bold text-white text-xs sm:text-sm truncate">{order.cliente}</strong>
                                <span className="shrink-0 text-xs text-gray-400">{order.telefone}</span>
                              </div>

                              {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion)}

                              {isDeliveryOrder && order.endereco && (
                                <span className="font-normal text-xs text-gray-400 flex items-center gap-1 truncate">
                                  <MapPin size={11} className="shrink-0 text-amber-500/80" />
                                  <span className="truncate">{order.endereco}</span>
                                </span>
                              )}

                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (isLoading) return;
                                  handleUpdateDeliveryStatus(order.id, 'transito');
                                }}
                                className="w-full py-2 px-3 h-8 sm:h-9 bg-emerald-600/15 hover:bg-emerald-600/25 text-[#10b981] font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5 border border-emerald-500/20"
                              >
                                <Check size={13} />
                                <span>{buttonText}</span>
                              </button>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>

                {/* COLUMN 3: pagamento e finalização de todas as modalidades. */}
                <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-2xl', 'flex', 'flex-col', 'overflow-hidden', 'min-w-[85vw]', 'sm:min-w-[320px]', 'md:min-w-0', 'flex-1', 'snap-center', 'shrink-0', 'md:shrink')}>
                  <div className={clsx('bg-[#18181B]', 'px-4', 'py-2.5', 'border-b', 'border-[#27272A]', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                    <div>
                      <span className={clsx('font-bold', 'text-white', 'font-sans', 'block', 'text-sm')}>Pagamento e Finalização</span>
                      <span className="text-xs text-gray-400 block mt-0.5 font-normal">Prontos para receber ou concluir</span>
                    </div>
                    <span className={clsx('bg-amber-600/15', 'text-amber-400', 'font-bold', 'px-2.5', 'py-0.5', 'rounded-full', 'font-mono', 'text-xs', 'border', 'border-amber-500/20')}>
                      {filteredCol2Table.length + filteredCol3Simulated.length}
                    </span>
                  </div>

                  <div className={clsx('p-2.5', 'sm:p-3', 'flex-1', 'overflow-y-auto', 'space-y-2.5')}>
                    {filteredCol2Table.length === 0 && filteredCol3Simulated.length === 0 ? (
                      <div className="py-16 text-center text-gray-400 italic text-xs space-y-1">
                        <Search size={20} className="mx-auto opacity-40 mb-2 text-gray-500" />
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
                          const badgeText = (order.mesaId && order.mesaId > 0)
                            ? (contaPedida ? `MESA ${order.mesaId} — CONTA PEDIDA` : `MESA ${order.mesaId} — PRONTO P/ RECEBER`)
                            : (contaPedida ? 'BALCÃO — CONTA PEDIDA' : 'BALCÃO — PRONTO');
                          const totalVal = order.itens.reduce((sum: number, it: any) => sum + (it.preco_unit || it.preco || 0), 0);

                          return (
                            <div
                              key={`close-${order.id}`}
                              onClick={() => setSelectedKanbanOrder(order)}
                              className={clsx(
                                'bg-[#18181B] hover:bg-[#1C1C1F] border border-[#27272A] rounded-xl hover:border-[#10b981]/50 transition-colors p-2.5 sm:p-3 space-y-2 text-left cursor-pointer shadow-sm',
                                sla.borderTopClass || 'border-t-2 border-t-emerald-800/70'
                              )}
                            >
                              {/* LINHA 1 (Top Bar do Card) */}
                              <div className="flex justify-between items-center gap-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={clsx('px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold rounded-md border font-mono block w-fit shadow-xs', sla.badgeClass)}>
                                    {sla.label}
                                  </span>
                                  <span className={clsx('px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold rounded-md font-mono block w-fit', contaPedida ? 'bg-amber-600/15 text-amber-400 border border-amber-500/20' : 'bg-emerald-600/15 text-[#10b981] border border-emerald-500/20')}>{badgeText}</span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => handleQuickPrintOrder(order, e)}
                                    className="p-1 bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-[#10b981] rounded-md border border-[#27272A] transition-colors cursor-pointer shadow-xs"
                                    title="Imprimir pré-conta / conferência"
                                  >
                                    <Printer size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedKanbanOrder(order);
                                    }}
                                    className="p-1 bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-[#10b981] rounded-md border border-[#27272A] transition-colors cursor-pointer shadow-xs"
                                    title="Ver detalhes do pedido"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                  <span className="font-bold text-sm sm:text-base text-[#10b981] font-mono block ml-1">
                                    R$ {totalVal.toFixed(2)}
                                  </span>
                                </div>
                              </div>

                              {/* LINHA 2 (Sub-header) */}
                              <div className="flex items-center justify-between text-xs text-gray-400">
                                <strong className="font-bold text-white text-xs sm:text-sm truncate">
                                  {order.identificador || ((order.mesaId && order.mesaId > 0) ? `Consumo Mesa ${order.mesaId}` : 'Consumo Balcão')}
                                </strong>
                                <span className="shrink-0 text-xs text-gray-400">Atendente: {order.garcomNome || 'Garçom'}</span>
                              </div>

                              {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion)}

                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (isLoading) return;
                                  
                                  const tableComandas = orders.filter(
                                    o => Number(o.mesaId) === Number(order.mesaId)
                                      && isTableCheckoutOrder(o)
                                  );
                                  const checkoutOrder = buildTableCheckoutOrder(tableComandas);
                                  if (!checkoutOrder) return;

                                  setSelectedOrder(checkoutOrder);
                                  setShowCheckoutModal(true);
                                  setCheckoutServiceTax(true);
                                  setSplitPeople('1');
                                  setSelectedItemIds([]);
                                  
                                  const sub = checkoutOrder.itens
                                    .filter(item => (item.status as string) !== 'cancelado')
                                    .reduce((sum, item) => sum + item.preco, 0);
                                  const total = sub * (1.0 + (taxaServicoAtiva ? serviceTaxRate / 100 : 0));
                                  setPaymentValor(
                                    Math.max(0, total - Number(checkoutOrder.valorPago || 0)).toFixed(2)
                                  );
                                }}
                                className="w-full py-2 px-3 h-8 sm:h-9 bg-emerald-600/15 hover:bg-emerald-600/25 text-[#10b981] font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5 border border-emerald-500/20"
                              >
                                <Check size={13} /><span>ABRIR PAGAMENTO DA MESA</span>
                              </button>
                            </div>
                          );
                        })}

                        {/* 2. Delivery/Retirada em trânsito (aguardando retorno/pagamento) */}
                        {filteredCol3Simulated.map((order) => {
                          const cardId = `transito-${order.id}`;
                          const sla = getOrderSlaData(order, nowTimestamp);
                          const isExpanded = !!expandedCardIds[cardId];
                          const isDeliveryOrder = order.modalidade === 'delivery';
                          const badgeText = isDeliveryOrder
                            ? `DELIVERY — ${order.pago ? 'PAGO / EM ROTA' : 'EM ROTA'}`
                            : `RETIRADA — ${order.pago ? 'PAGO' : 'AGUARDANDO PAGAMENTO'}`;
                          const badgeColor = isDeliveryOrder
                            ? 'bg-amber-600/15 text-amber-400 border border-amber-500/20'
                            : 'bg-sky-600/15 text-sky-400 border border-sky-500/20';
                          const topAccentClass = isDeliveryOrder ? 'border-t-2 border-t-amber-800/70' : 'border-t-2 border-t-sky-800/70';

                          return (
                            <div 
                              key={`transito-${order.id}`} 
                              onClick={() => openSimulatedOrderDetails(order)}
                              className={clsx(
                                'bg-[#18181B] hover:bg-[#1C1C1F] border border-[#27272A] rounded-xl hover:border-[#10b981]/50 transition-colors p-2.5 sm:p-3 space-y-2 text-left cursor-pointer shadow-sm',
                                sla.borderTopClass || topAccentClass
                              )}
                            >
                              <div className="flex justify-between items-center gap-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={clsx('px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold rounded-md border font-mono block w-fit shadow-xs', sla.badgeClass)}>
                                    {sla.label}
                                  </span>
                                  <span className={clsx('px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold rounded-md font-mono block w-fit', badgeColor)}>{badgeText}</span>
                                  <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-bold rounded-md border border-[#27272A] bg-[#1C1C1F] text-gray-300 font-mono">
                                    {order.canal}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => handleQuickPrintOrder(order, e)}
                                    className="p-1 bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-[#10b981] rounded-md border border-[#27272A] transition-colors cursor-pointer shadow-xs"
                                    title="Imprimir pré-conta / conferência"
                                  >
                                    <Printer size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openSimulatedOrderDetails(order);
                                    }}
                                    className="p-1 bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-[#10b981] rounded-md border border-[#27272A] transition-colors cursor-pointer shadow-xs"
                                    title="Ver detalhes do pedido"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                  <span className="font-bold text-sm sm:text-base text-[#10b981] font-mono block ml-1">
                                    R$ {order.total.toFixed(2)}
                                  </span>
                                </div>
                              </div>

                              {/* LINHA 2 (Sub-header) */}
                              <div className="flex items-center justify-between text-xs text-gray-400">
                                <strong className="font-bold text-white text-xs sm:text-sm truncate">{order.cliente}</strong>
                                <span className="shrink-0 text-xs text-gray-400">{order.telefone}</span>
                              </div>

                              {renderCompactItemsList(order.itens, cardId, isExpanded, toggleCardExpansion)}

                              {isDeliveryOrder && order.endereco && (
                                <span className="font-normal text-xs text-gray-400 flex items-center gap-1 truncate">
                                  <MapPin size={11} className="shrink-0 text-amber-500/80" />
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
                                    setSelectedOrder({
                                      ...fullOrder,
                                      itens: fullOrder.itens.map((item: any) => ({
                                        id: item.id, produtoId: item.produto_id || item.produtoId,
                                        nome: item.nome || `Item ${item.produtoId}`, preco: item.preco_unit || item.preco,
                                        observacao: item.observacao || '', clienteNome: item.cliente_nome || item.clienteNome || 'Consumo Geral',
                                        status: item.status, pago: item.pago
                                      }))
                                    });
                                    setShowCheckoutModal(true);
                                    setCheckoutServiceTax(false);
                                    setSplitPeople('1');
                                    setSelectedItemIds([]);
                                    const sub = fullOrder.itens.filter((item: any) => !item.pago).reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
                                    setPaymentValor(sub.toFixed(2));
                                  } else {
                                    handleFinalizarPedido(order.id);
                                  }
                                }}
                                className="w-full py-2 px-3 h-8 sm:h-9 bg-emerald-600/15 hover:bg-emerald-600/25 text-[#10b981] font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5 border border-emerald-500/20"
                              >
                                <Check size={13} /><span>{order.pago ? 'FINALIZAR PEDIDO' : 'RECEBER E FINALIZAR'}</span>
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
            <div className={clsx('h-full', 'flex', 'flex-col', 'lg:flex-row', 'gap-5', 'overflow-hidden', 'relative')}>

              {/* Mobile sub-tab toggle */}
              <div className="flex lg:hidden gap-1.5 p-1 bg-[#121214] border border-[#27272A] rounded-xl shrink-0">
                <button
                  type="button"
                  onClick={() => setBalcaoMobileView('produtos')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    balcaoMobileView === 'produtos'
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Package size={14} />
                  <span>Produtos (Cardápio)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBalcaoMobileView('carrinho')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    balcaoMobileView === 'carrinho'
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <ShoppingCart size={14} />
                  <span>Carrinho ({pdvCart.reduce((sum, item) => sum + item.quantity, 0)})</span>
                </button>
              </div>

              {/* Product grid column */}
              <div className={`flex-1 ${balcaoMobileView === 'produtos' ? 'flex' : 'hidden lg:flex'} flex-col space-y-4 overflow-hidden w-full`}>
                <div className={clsx('space-y-3', 'shrink-0')}>
                  <div className={clsx('flex', 'gap-2')}>
                    <div className="flex-1">
                      <input
                        id="pdv-search-input"
                        type="text"
                        placeholder="Pesquisar prato no cardápio..."
                        value={pdvSearch}
                        onChange={(e) => setPdvSearch(e.target.value)}
                        className={clsx('w-full', 'px-4', 'py-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white')}
                      />
                      <span className={clsx('text-[8px]', 'text-gray-500', 'font-mono', 'block', 'mt-1', 'text-left')}>Atalho: Pressione [F1] para pesquisar</span>
                    </div>
                    {pdvSearch && (
                      <button
                        onClick={() => setPdvSearch('')}
                        className={clsx('px-3', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-gray-400', 'hover:text-white')}
                      >
                        Limpar
                      </button>
                    )}
                  </div>

                  <div className={clsx('flex', 'gap-1.5', 'overflow-x-auto', 'pb-1.5', 'scrollbar-thin')}>
                    <button
                      type="button"
                      onClick={() => setPdvSelectedCategory('todos')}
                      className={`px-3 py-1.5 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-all border ${pdvSelectedCategory === 'todos'
                        ? 'bg-emerald-600 text-white border-transparent'
                        : 'bg-[#121214] border-[#27272A] text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                        }`}
                    >
                      Todos
                    </button>
                    {apiCategorias.map(catObj => (
                      <button
                        key={catObj.id || catObj.nome}
                        type="button"
                        onClick={() => setPdvSelectedCategory(catObj.nome)}
                        className={`px-3 py-1.5 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-all border ${pdvSelectedCategory === catObj.nome
                          ? 'bg-emerald-600 text-white border-transparent'
                          : 'bg-[#121214] border-[#27272A] text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                          }`}
                      >
                        {catObj.nome}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={clsx('flex-1', 'overflow-y-auto', 'pr-1')}>
                  <div className={clsx('grid', 'grid-cols-2', 'sm:grid-cols-3', 'xl:grid-cols-4', 'gap-3')}>
                    {filteredProducts.map(p => (
                      <div
                        key={p.id}
                        onClick={() => handlePdvAddToCart(p)}
                        className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'hover:border-[#10b981]/30', 'p-3', 'rounded-xl', 'flex', 'flex-col', 'justify-between', 'gap-2', 'cursor-pointer', 'group', 'hover:shadow-md', 'transition-all', 'text-left')}
                      >
                        {(p as any).imagem && (
                          <img src={(p as any).imagem} alt={p.nome} className={clsx('w-full', 'h-20', 'object-cover', 'rounded-lg', '-mt-0.5')} />
                        )}
                        <div className="min-h-[28px]">
                          <h4 className={clsx('font-serif', 'font-bold', 'text-white', 'text-[11px]', 'sm:text-xs', 'group-hover:text-[#10b981]', 'transition-colors', 'leading-tight', 'line-clamp-2')}>{p.nome}</h4>
                          {p.descricao && <p className={clsx('text-[8px]', 'text-gray-500', 'mt-0.5', 'line-clamp-1', 'leading-tight')}>{p.descricao}</p>}
                        </div>
                        <div className={clsx('flex', 'justify-between', 'items-center')}>
                          <span className={clsx('font-bold', 'text-white', 'font-mono', 'text-[11px]')}>R$ {p.preco.toFixed(2)}</span>
                          <span className={clsx('p-1', 'bg-[#1C1C1F]', 'group-hover:bg-[#10b981]', 'text-gray-400', 'group-hover:text-[#121214]', 'rounded-lg', 'transition-colors', 'border', 'border-[#27272A]/50')}>
                            <Plus size={12} />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Shopping cart sidebar */}
              <div className={`w-full lg:w-80 bg-[#121214] border border-[#27272A] rounded-2xl ${balcaoMobileView === 'carrinho' ? 'flex' : 'hidden lg:flex'} flex-col overflow-hidden shrink-0`}>
                <div className={clsx('bg-[#18181B]', 'px-4', 'py-3', 'border-b', 'border-[#27272A]', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                  <span className={clsx('font-bold', 'text-white', 'font-serif', 'flex', 'items-center', 'gap-1.5')}>
                    <ShoppingCart size={14} className="text-[#10b981]" />
                    <span>Carrinho de Vendas</span>
                  </span>
                  <span className={clsx('bg-[#10b981]/10', 'text-[#10b981]', 'font-bold', 'px-2', 'py-0.5', 'rounded-full', 'font-mono', 'text-[9px]')}>
                    {pdvCart.reduce((sum, item) => sum + item.quantity, 0)} itens
                  </span>
                </div>

                <div className={clsx('flex-1', 'overflow-y-auto', 'p-3', 'space-y-2')}>
                  {pdvCart.length === 0 ? (
                    <div className={clsx('py-24', 'text-center', 'space-y-2', 'text-gray-500', 'italic')}>
                      <p>Carrinho Vazio</p>
                      <p className={clsx('text-[9px]', 'text-gray-600')}>Clique nos produtos ao lado para lançar</p>
                    </div>
                  ) : (
                    pdvCart.map((item, idx) => (
                      <div key={`${item.product.id}-${idx}`} className={clsx('bg-[#1C1C1F]', 'p-2.5', 'rounded-xl', 'border', 'border-[#27272A]', 'space-y-2')}>
                        <div className={clsx('flex', 'justify-between', 'items-start')}>
                          <div className="space-y-0.5">
                            <strong className={clsx('text-white', 'block', 'truncate', 'w-40')}>{item.product.nome}</strong>
                            <span className={clsx('text-[9px]', 'text-[#10b981]', 'font-mono')}>R$ {item.product.preco.toFixed(2)} / un</span>
                          </div>
                          <button
                            onClick={() => handlePdvRemoveCartItem(idx)}
                            className={clsx('text-gray-500', 'hover:text-rose-500', 'p-0.5', 'cursor-pointer')}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        <div className={clsx('flex', 'justify-between', 'items-center')}>
                          <div className={clsx('flex', 'items-center', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'overflow-hidden')}>
                            <button
                              type="button"
                              onClick={() => handlePdvUpdateCartQty(idx, -1)}
                              className={clsx('px-2', 'py-1', 'text-gray-400', 'hover:text-white', 'cursor-pointer', 'hover:bg-[#1C1C1F]')}
                            >
                              -
                            </button>
                            <span className={clsx('px-2', 'text-[10px]', 'font-bold', 'font-mono', 'text-white')}>{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => handlePdvUpdateCartQty(idx, 1)}
                              className={clsx('px-2', 'py-1', 'text-gray-400', 'hover:text-white', 'cursor-pointer', 'hover:bg-[#1C1C1F]')}
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
                            className={clsx('w-24', 'px-1.5', 'py-1', 'text-[9px]', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white')}
                          />
                        </div>

                        {/* Presets de Observação Dinâmicos do Terminal Balcão */}
                        {(() => {
                          const presets = getProductPresets(item.product);
                          if (presets.length === 0) return null;
                          const parts = item.obs ? item.obs.split(',').map(p => p.trim()) : [];
                          return (
                            <div className="flex flex-wrap gap-1 mt-2 justify-end">
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
                                        : 'bg-[#27272A] hover:bg-emerald-600/25 text-gray-400 hover:text-white border-[#27272A]'
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
                  className={clsx('p-3', 'border-t', 'border-[#27272A]', 'space-y-3', 'bg-[#18181B]/40', 'shrink-0')}
                >
                  <div className="space-y-1.5">
                    <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Modalidade:</label>
                    <div className={clsx('grid', 'grid-cols-3', 'gap-1', 'bg-[#09090B]', 'p-1', 'rounded-xl', 'border', 'border-[#27272A]')}>
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
                            ? 'bg-[#10b981] text-[#121214]'
                            : 'text-gray-400 hover:text-white'
                            }`}
                        >
                          {type.id === 'retirada' ? 'Retirada' : type.id === 'entrega' ? 'Delivery' : 'Mesa'}
                        </button>
                      ))}
                    </div>
                    <span className={clsx('text-[8px]', 'text-gray-500', 'font-mono', 'block', 'mt-0.5', 'text-left')}>Atalhos de Tipo: [F2] Retirada • [F3] Mesa • [F8] Delivery</span>
                  </div>

                  {pdvOrderType === 'mesa' && (
                    <div className="space-y-1">
                      <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Mesa Destino:</label>
                      <select
                        value={pdvTargetMesaId || ''}
                        onChange={(e) => setPdvTargetMesaId(Number(e.target.value) || 0)}
                        className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                        required
                      >
                        <option value="">-- Selecione uma mesa --</option>
                        {(salonTables || []).map(t => (
                          <option key={t.id} value={t.id}>
                            Mesa {t.id} {t.nome ? `(${t.nome})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(pdvOrderType === 'retirada' || pdvOrderType === 'entrega') && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Telefone:</label>
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
                            className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Nome Cliente:</label>
                          <input
                            id="pdv-customer-name-input"
                            type="text"
                            autoComplete="name"
                            placeholder="Ex: Maria"
                            required={pdvCart.length > 0}
                            value={pdvCustomerName}
                            onChange={(e) => setPdvCustomerName(e.target.value)}
                            className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                          />
                        </div>
                      </div>
                      {pdvCustomerLookup !== 'idle' && (
                        <p className={clsx(
                          'text-[8px]',
                          'font-bold',
                          pdvCustomerLookup === 'found' ? 'text-emerald-400' : 'text-gray-500',
                        )}>
                          {pdvCustomerLookup === 'loading' && 'Buscando cliente...'}
                          {pdvCustomerLookup === 'found' && 'Cliente encontrado — nome e endereço preenchidos automaticamente.'}
                          {pdvCustomerLookup === 'new' && 'Novo número — o cliente será criado ao lançar o pedido.'}
                        </p>
                      )}
                      {pdvOrderType === 'entrega' && (
                        <div className="space-y-1">
                          <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Endereço:</label>
                          <input
                            type="text"
                            placeholder="Rua, Número, Bairro"
                            required
                            value={pdvDeliveryAddress}
                            onChange={(e) => setPdvDeliveryAddress(e.target.value)}
                            className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className={clsx('flex', 'justify-between', 'items-center', 'font-mono', 'border-t', 'border-[#27272A]', 'pt-2', 'text-[11px]', 'font-bold', 'text-white')}>
                    <span>Total Pedido:</span>
                    <span className={clsx('text-[#10b981]', 'text-sm')}>
                      R$ {(pdvCart.reduce((sum, item) => sum + (item.product.preco * item.quantity), 0)).toFixed(2)}
                    </span>
                  </div>

                  <button
                    id="pdv-submit-btn"
                    type="submit"
                    className={clsx('w-full', 'py-2', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded-lg', 'font-bold', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer', 'flex', 'flex-col', 'items-center', 'justify-center', 'gap-0.5', 'shadow')}
                  >
                    <div className={clsx('flex', 'items-center', 'gap-1')}>
                      <Check size={12} />
                      <span>Lançar Pedido</span>
                    </div>
                    <span className={clsx('text-[7.5px]', 'text-emerald-200/80', 'font-mono', 'font-normal')}>Pressione [F4] para finalizar</span>
                  </button>
                </form>
              </div>

              {/* Floating Bottom Bar on Mobile when on Products tab */}
              {pdvCart.length > 0 && balcaoMobileView === 'produtos' && (
                <button
                  type="button"
                  onClick={() => setBalcaoMobileView('carrinho')}
                  className="lg:hidden fixed bottom-4 left-4 right-4 z-40 py-3 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl shadow-2xl flex items-center justify-between border border-emerald-400/30 animate-fade-in cursor-pointer"
                >
                  <span className="text-xs flex items-center gap-2">
                    <ShoppingCart size={16} />
                    <span>{pdvCart.reduce((s, i) => s + i.quantity, 0)} itens no carrinho</span>
                  </span>
                  <span className="text-xs font-mono font-extrabold bg-black/30 px-3 py-1 rounded-xl">
                    R$ {pdvCart.reduce((sum, item) => sum + (item.product.preco * item.quantity), 0).toFixed(2)} →
                  </span>
                </button>
              )}

            </div>
          )}

          {/* VIEW 3: MAPA DE MESAS (Salão) */}
          {activeSubTab === 'mesas' && (
            <div className={clsx('h-full', 'flex', 'flex-col', 'space-y-4')}>
              <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-3', 'rounded-2xl', 'flex', 'justify-between', 'items-center', 'gap-3')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Estrutura Física do Salão</span>
                <button
                  onClick={() => setShowAddMesaModal(true)}
                  className={clsx('px-4', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-xl', 'flex', 'items-center', 'gap-1.5', 'cursor-pointer', 'text-[10px]', 'uppercase', 'tracking-wider', 'shadow')}
                >
                  <Plus size={12} />
                  <span>Adicionar Mesa</span>
                </button>
              </div>

              <div className={clsx('flex-1', 'bg-[#121214]/50', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-3', 'sm:p-5', 'overflow-y-auto')}>
                <div className={clsx('grid', 'grid-cols-2', 'sm:grid-cols-3', 'md:grid-cols-4', 'lg:grid-cols-5', 'xl:grid-cols-6', 'gap-2.5', 'sm:gap-4')}>
                   {(salonTables || []).length === 0 ? (
                    <div className="col-span-full py-16 text-center text-zinc-500 font-serif text-sm">
                      {fetchError ? (
                        <div className="space-y-2">
                          <span className="text-rose-400 block font-mono text-xs">
                            ⚠️ Erro de comunicação com o servidor:
                          </span>
                          <span className="text-zinc-400 block font-mono text-xs bg-black/40 p-3 rounded-lg border border-zinc-800 max-w-md mx-auto">
                            {fetchError}
                          </span>
                        </div>
                      ) : (
                        "Nenhuma mesa encontrada ou carregando layout..."
                      )}
                    </div>
                  ) : (
                    (salonTables || []).map((table) => {
                      const mergedIntoMesaId = orders.find(o => o.mesaOrigemId === table.id)?.mesaId || null;
                      const isMerged = mergedIntoMesaId !== null;
                      const displayMesaId = isMerged ? mergedIntoMesaId : table.id;
                      const tableOrders = orders.filter(o => o.mesaId === displayMesaId);
                      const isOcupada = tableOrders.length > 0;
                      const hasPendingPayment = pagamentosPendentes.some(pag =>
                        tableOrders.some(o => o.id === pag.comanda_id)
                      );
                      const totalConsumoMesa = tableOrders.reduce((sum, order) => {
                        return sum + (order.itens || []).reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
                      }, 0);

                      return (
                        <div
                          key={table.id}
                          className={`bg-[#121214] border rounded-2xl p-2.5 sm:p-3.5 flex flex-col justify-between gap-2 sm:gap-3 transition-all relative group shadow-sm ${hasPendingPayment
                            ? 'border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.2)] animate-pulse'
                            : isMerged
                              ? 'border-dashed border-zinc-800 opacity-60 bg-zinc-950/20'
                              : isOcupada
                                ? 'border-rose-500/40 hover:border-rose-500/80 bg-rose-950/10'
                                : 'border-[#27272A] hover:border-[#10b981]/40'
                            }`}
                        >
                          {/* Header Mesa + Edit */}
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block">Mesa</span>
                              <strong className="text-lg sm:text-xl font-serif text-white leading-none">{table.id}</strong>
                              {table.nome && table.nome !== `Mesa ${table.id}` && (
                                <span className="text-[9px] text-[#10b981] block mt-0.5 font-medium">{table.nome}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <span className={`px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wider rounded-full ${isMerged
                                ? 'bg-zinc-800 text-zinc-500'
                                : isOcupada
                                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                }`}
                              >
                                {isMerged ? 'Mesclada' : isOcupada ? 'Ocupada' : 'Livre'}
                              </span>
                              <button
                                onClick={() => {
                                  setEditingTable(table);
                                  setEditTableCap(table.capacidade ? table.capacidade.toString() : '4');
                                  setEditTableNome(table.nome || '');
                                  setIsConfirmingDelete(false);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded transition-all cursor-pointer"
                                title="Editar mesa"
                              >
                                <Edit3 size={11} />
                              </button>
                            </div>
                          </div>

                          {/* Consumo Total e Tags */}
                          <div className="space-y-1.5 min-h-[36px] flex flex-col justify-center">
                            {isOcupada ? (
                              <div>
                                <span className="text-[9px] text-zinc-400 font-medium block uppercase tracking-wider">Consumo Total</span>
                                <span className="text-sm font-extrabold text-emerald-400 font-mono">
                                  R$ {totalConsumoMesa.toFixed(2)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-zinc-600 italic">Disponível</span>
                            )}

                            {(() => {
                              const origemId = tableOrders.find(o => o.mesaOrigemId && Number(o.mesaOrigemId) !== Number(displayMesaId))?.mesaOrigemId;
                              const transfId = tableOrders.find(o => o.mesaTransferidaDe && Number(o.mesaTransferidaDe) !== Number(displayMesaId))?.mesaTransferidaDe;
                              if (origemId) {
                                return (
                                  <span className="px-1.5 py-0.5 text-[8px] bg-emerald-500/10 text-emerald-300 font-bold rounded block w-fit border border-emerald-500/20 uppercase tracking-wider animate-pulse-subtle" title={`Consumo mesclado da Mesa ${origemId}`}>
                                    🔗 Mesclado da Mesa {origemId}
                                  </span>
                                );
                              }
                              if (transfId) {
                                return (
                                  <span className="px-1.5 py-0.5 text-[8px] bg-purple-500/10 text-purple-300 font-bold rounded block w-fit border border-purple-500/20 uppercase tracking-wider" title={`Consumo transferido da Mesa ${transfId}`}>
                                    🔗 Transferido da Mesa {transfId}
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>

                          {/* Ações */}
                          {isOcupada && (
                            <div className="flex gap-1.5 pt-2 border-t border-[#27272A]">
                              <button
                                onClick={() => {
                                  const checkoutOrder = buildTableCheckoutOrder(tableOrders);
                                  if (!checkoutOrder) return;
                                  setSelectedOrder(checkoutOrder);
                                  setShowCheckoutModal(true);
                                  setCheckoutServiceTax(true);
                                  setSplitPeople('1');
                                  setSelectedItemIds([]);
                                  const sub = checkoutOrder.itens
                                    .filter(item => (item.status as string) !== 'cancelado')
                                    .reduce((sum, item) => sum + item.preco, 0);
                                  const total = sub * (1.0 + (taxaServicoAtiva ? serviceTaxRate / 100 : 0));
                                  setPaymentValor(
                                    Math.max(0, total - Number(checkoutOrder.valorPago || 0)).toFixed(2)
                                  );
                                }}
                                className="flex-1 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-[#121214] rounded-lg font-bold text-[9px] transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1 shadow-sm"
                              >
                                Checkout
                              </button>
                              <button
                                onClick={() => setConfirmingFreeTableId(table.id)}
                                className="p-1.5 bg-rose-950/40 hover:bg-rose-900/40 text-rose-400 border border-rose-900/30 rounded-lg transition-colors cursor-pointer"
                                title="Liberar mesa de forma forçada"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* VIEW 4: MEU DESEMPENHO (Analytics) */}
          {activeSubTab === 'desempenho' && (
            <div className="space-y-6">
              {/* Header metrics boxes */}
              <div className={clsx('grid', 'grid-cols-2', 'md:grid-cols-4', 'gap-4')}>
                <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-4', 'rounded-2xl')}>
                  <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-gray-400', 'block')}>Faturamento de Hoje</span>
                  <strong className={clsx('text-xl', 'text-white', 'font-mono', 'block', 'mt-1')}>
                    R$ ${(generalStats?.faturamento_hoje ?? 0.00).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                </div>
                <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-4', 'rounded-2xl')}>
                  <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-gray-400', 'block')}>Em análise agora</span>
                  <strong className={clsx('text-xl', 'text-amber-500', 'font-mono', 'block', 'mt-1')}>
                    {simulatedOrders.filter(o => o.status === 'analise').length}
                  </strong>
                </div>
                <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-4', 'rounded-2xl')}>
                  <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-gray-400', 'block')}>Em produção agora</span>
                  <strong className={clsx('text-xl', 'text-[#10b981]', 'font-mono', 'block', 'mt-1')}>
                    {simulatedOrders.filter(o => o.status === 'producao').length + activeKitchenItems.filter(i => i.status === 'preparando').length}
                  </strong>
                </div>
                <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-4', 'rounded-2xl')}>
                  <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-gray-400', 'block')}>Pronto para entrega</span>
                  <strong className={clsx('text-xl', 'text-emerald-500', 'font-mono', 'block', 'mt-1')}>
                    {simulatedOrders.filter(o => o.status === 'pronto').length}
                  </strong>
                </div>
              </div>

              {/* Date Filters & Middle Metrics */}
              <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-4', 'rounded-2xl', 'space-y-4')}>
                <div className={clsx('flex', 'justify-between', 'items-center', 'border-b', 'border-[#27272A]', 'pb-3')}>
                  <div className={clsx('flex', 'items-center', 'gap-2')}>
                    <span className={clsx('font-serif', 'font-bold', 'text-gray-200')}>Relatório Consolidado</span>
                  </div>
                  <div className={clsx('flex', 'gap-1', 'bg-[#09090B]', 'p-1', 'rounded-xl', 'border', 'border-[#27272A]')}>
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
                          : 'text-gray-400 hover:text-white'
                          }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-3', 'gap-4', 'font-mono')}>
                  <div className={clsx('bg-[#1C1C1F]', 'p-3.5', 'rounded-xl', 'border', 'border-[#27272A]/50', 'flex', 'justify-between', 'items-center')}>
                    <div>
                      <span className={clsx('text-[8px]', 'font-bold', 'font-sans', 'text-gray-400', 'uppercase', 'tracking-widest', 'block')}>Faturamento</span>
                      <strong className={clsx('text-base', 'text-white', 'mt-1', 'block')}>
                        R$ ${(generalStats?.faturamento ?? 0.00).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <span className={clsx('text-[10px]', 'text-emerald-400', 'font-bold', 'bg-emerald-500/10', 'px-2', 'py-0.5', 'rounded', 'flex', 'items-center', 'gap-0.5')}>
                      <ArrowUpRight size={10} /> Real
                    </span>
                  </div>

                  <div className={clsx('bg-[#1C1C1F]', 'p-3.5', 'rounded-xl', 'border', 'border-[#27272A]/50', 'flex', 'justify-between', 'items-center')}>
                    <div>
                      <span className={clsx('text-[8px]', 'font-bold', 'font-sans', 'text-gray-400', 'uppercase', 'tracking-widest', 'block')}>Pedidos</span>
                      <strong className={clsx('text-base', 'text-white', 'mt-1', 'block')}>
                        {generalStats?.total_pedidos ?? 0}
                      </strong>
                    </div>
                    <span className={clsx('text-[10px]', 'text-emerald-400', 'font-bold', 'bg-emerald-500/10', 'px-2', 'py-0.5', 'rounded', 'flex', 'items-center', 'gap-0.5')}>
                      <ArrowUpRight size={10} /> Real
                    </span>
                  </div>

                  <div className={clsx('bg-[#1C1C1F]', 'p-3.5', 'rounded-xl', 'border', 'border-[#27272A]/50', 'flex', 'justify-between', 'items-center')}>
                    <div>
                      <span className={clsx('text-[8px]', 'font-bold', 'font-sans', 'text-gray-400', 'uppercase', 'tracking-widest', 'block')}>Ticket Médio</span>
                      <strong className={clsx('text-base', 'text-white', 'mt-1', 'block')}>
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
                <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'flex', 'flex-col', 'items-center', 'justify-between', 'text-center', 'space-y-4')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'text-left', 'w-full', 'border-b', 'border-[#27272A]', 'pb-2')}>Qualidade do Cardápio</span>

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
                    <span className={clsx('text-lg', 'font-bold', 'font-mono', 'text-white')}>{generalStats?.qualidade_cardapio ?? 100}%</span>
                  </div>

                  <div className="space-y-1">
                    <strong className={clsx('text-white', 'font-medium', 'block', 'text-xs')}>Cardápio Otimizado</strong>
                    <p className={clsx('text-[9px]', 'text-gray-500')}>Seu cardápio possui ótimas descrições e fotos de alta resolução cadastrados.</p>
                  </div>
                </div>

                {/* 2. Modality Split Gauges */}
                <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-3')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'border-b', 'border-[#27272A]', 'pb-2')}>Pedidos por Modalidade</span>

                  <div className={clsx('space-y-2.5', 'pt-2')}>
                    {[
                      { name: "Entrega (Delivery)", count: generalStats?.pedidos_modalidade?.delivery ?? 0, max: Math.max(1, generalStats?.total_pedidos ?? 1), barColor: "bg-rose-600" },
                      { name: "Consumo no Local (Mesa)", count: generalStats?.pedidos_modalidade?.local ?? 0, max: Math.max(1, generalStats?.total_pedidos ?? 1), barColor: "bg-[#10b981]" },
                      { name: "Retirada (Balcão)", count: generalStats?.pedidos_modalidade?.balcao ?? 0, max: Math.max(1, generalStats?.total_pedidos ?? 1), barColor: "bg-emerald-600" }
                    ].map((mod, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className={clsx('flex', 'justify-between', 'text-[10px]')}>
                          <span className="text-gray-400">{mod.name}</span>
                          <strong className={clsx('text-white', 'font-mono')}>{mod.count} pedidos</strong>
                        </div>
                        <div className={clsx('h-1.5', 'w-full', 'bg-[#1C1C1F]', 'rounded-full', 'overflow-hidden')}>
                          <div className={`h-full ${mod.barColor} rounded-full`} style={{ width: `${(mod.count / mod.max) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Top Items list */}
                <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-3')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'border-b', 'border-[#27272A]', 'pb-2')}>Top 5 Itens Mais Pedidos</span>

                  <div className={clsx('divide-y', 'divide-[#27272A]/50')}>
                    {(generalStats?.top_itens ?? []).map((item: any, idx: number) => (
                      <div key={idx} className={clsx('py-2', 'flex', 'justify-between', 'items-center')}>
                        <div className={clsx('flex', 'items-center', 'gap-2.5')}>
                          <span className={`h-5 w-5 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold ${idx === 0 ? 'bg-emerald-600 text-white' : idx === 1 ? 'bg-[#10b981] text-[#121214]' : 'bg-[#1C1C1F] text-gray-400'
                            }`}>{item.rank}</span>
                          <span className={clsx('font-medium', 'text-white', 'block')}>{item.name}</span>
                        </div>
                        <span className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'font-mono')}>{item.count} saídas</span>
                      </div>
                    ))}
                    {(generalStats?.top_itens ?? []).length === 0 && (
                      <div className="py-8 text-center text-gray-500 italic text-[10px]">Nenhum item vendido no período</div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* VIEW 5: COZINHA (KDS) */}
          {activeSubTab === 'kds' && (
            <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
              <div className={clsx('border-b', 'border-[#27272A]', 'pb-3', 'flex', 'items-center', 'justify-between')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Painel de Produção da Cozinha</span>
                <span className={clsx('bg-[#10b981]/10', 'text-[#10b981]', 'font-bold', 'px-2', 'py-0.5', 'rounded-full', 'font-mono', 'text-[9px]')}>
                  {activeKitchenItems.length} pratos ativos
                </span>
              </div>

              {activeKitchenItems.length === 0 ? (
                <div className={clsx('py-32', 'text-center', 'text-gray-500', 'italic', 'space-y-1')}>
                  <p>Cozinha Limpa!</p>
                  <p className={clsx('text-[9px]', 'text-gray-600')}>Nenhum pedido aguardando preparo no momento</p>
                </div>
              ) : (
                <div className={clsx('grid', 'grid-cols-1', 'sm:grid-cols-2', 'md:grid-cols-3', 'xl:grid-cols-4', 'gap-4')}>
                  {activeKitchenItems.map((item) => (
                    <div
                      key={item.id}
                      className={`bg-[#121214] border p-3 rounded-2xl space-y-3 flex flex-col justify-between ${item.status === 'pronto' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-[#27272A]'
                        }`}
                    >
                      <div className="space-y-2">
                        {/* Header */}
                        <div className={clsx('flex', 'justify-between', 'items-start')}>
                          <div>
                            <span className={clsx('text-[9px]', 'text-gray-400', 'font-bold', 'block')}>
                              Mesa {item.mesaId > 0 ? item.mesaId : "Balcão"}
                            </span>
                            <strong className={clsx('text-white', 'text-xs', 'block', 'mt-0.5', 'truncate', 'w-32')}>{item.nome}</strong>
                          </div>
                          <KDSTimer itemTimestamp={(item as any).created_at || (item as any).timestamp || (item as any).preparando_desde} status={item.status} />
                        </div>

                        {/* Observations / details */}
                        {item.observacao && (
                          <div className={clsx('bg-[#09090B]', 'border', 'border-[#27272A]/50', 'p-2', 'rounded-lg', 'text-rose-400', 'font-bold', 'text-[10px]', 'leading-relaxed', 'font-mono')}>
                            Obs: {item.observacao}
                          </div>
                        )}
                        <span className={clsx('text-[9px]', 'text-gray-500', 'block', 'truncate')}>Lançado por: {item.garcomNome}</span>
                      </div>

                      {/* Actions */}
                      <div className={clsx('pt-2', 'border-t', 'border-[#27272A]', 'shrink-0')}>
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
            <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5')}>

              {/* CRUD table list */}
              <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Cadastro de Funcionários (Equipe)</span>

                <div className="overflow-x-auto">
                  <table className={clsx('w-full', 'text-left', 'font-sans', 'text-xs', 'border-collapse')}>
                    <thead>
                      <tr className={clsx('border-b', 'border-[#27272A]', 'text-gray-400', 'font-bold')}>
                        <th className="py-2">Nome</th>
                        <th className="py-2">Telefone</th>
                        <th className="py-2">Cargo</th>
                        <th className="py-2">Status</th>
                        <th className={clsx('py-2', 'text-right')}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {systemUsers.map(user => {
                        const cargoRaw = user.cargo || user.role || 'garcom';
                        const cargoLabel = cargoRaw === 'garcom' ? 'Garçom' : cargoRaw === 'caixa' ? 'Caixa' : cargoRaw === 'operador_caixa' ? 'Op. Caixa' : cargoRaw === 'gerente' ? 'Gerente' : cargoRaw === 'atendente' ? 'Atendente' : cargoRaw === 'cozinha' ? 'Cozinha' : cargoRaw === 'admin' ? 'Administrador' : cargoRaw;
                        const statusVal = user.status || 'ativo';
                        const isPendente = statusVal === 'pendente_ativacao';

                        return (
                          <tr key={user.id} className={clsx('border-b', 'border-[#27272A]/40', 'hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                            <td className={clsx('py-2.5', 'text-white', 'font-bold')}>{user.nome}</td>
                            <td className={clsx('py-2.5', 'font-mono', 'text-gray-400')}>{formatarTelefoneTabela(user.telefone || user.usuario || '')}</td>
                            <td className="py-2.5">
                              <span className={`px-2 py-0.5 text-[8px] font-bold rounded uppercase tracking-wider ${cargoRaw === 'admin' ? 'bg-emerald-600/20 text-[#C46A74]' : cargoRaw === 'caixa' ? 'bg-[#10b981]/10 text-[#10b981]' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                {cargoLabel}
                              </span>
                            </td>
                            <td className="py-2.5">
                              {statusVal === 'ativo' ? (
                                <span className="px-2 py-0.5 text-[8px] font-bold rounded uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  Ativo
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 text-[8px] font-bold rounded uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  Pendente de Ativação
                                </span>
                              )}
                            </td>
                            <td className={clsx('py-2.5', 'text-right', 'flex', 'items-center', 'justify-end', 'gap-2')}>
                              {isPendente && (
                                <button
                                  onClick={() => handleResendInvite(user)}
                                  className="px-2 py-1 text-[8px] font-bold bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-white rounded-lg border border-[#27272A] transition-all cursor-pointer flex items-center gap-1"
                                  title="Reenviar link de ativação via WhatsApp"
                                >
                                  <Send size={10} />
                                  Reenviar Convite
                                </button>
                              )}
                              {cargoRaw !== 'admin' && (
                                <button
                                  onClick={() => handleDeleteUser(user.id)}
                                  className={clsx('p-1', 'text-gray-500', 'hover:text-rose-500', 'cursor-pointer')}
                                  title="Excluir funcionário"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Add form & Service fee settings */}
              <div className="space-y-4">

                {/* Add Waiter form */}
                <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]', 'mb-3')}>Registrar Funcionário</span>

                  <form onSubmit={handleAddUserSubmit} className={clsx('space-y-3', 'text-left')}>
                    <div className="space-y-1">
                      <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Nome Completo:</label>
                      <input
                        type="text"
                        required
                        placeholder="Ex: Pedro Henrique"
                        value={newUserNome}
                        onChange={(e) => setNewUserNome(e.target.value)}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]')}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Telefone (WhatsApp):</label>
                      <input
                        type="tel"
                        required
                        placeholder="(81) 99999-9999"
                        value={newUserTelefone}
                        onChange={(e) => setNewUserTelefone(aplicarMascaraTelefoneInput(e.target.value))}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono', 'text-[10px]')}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Função / Cargo:</label>
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value)}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]')}
                      >
                        <option value="garcom">Garçom</option>
                        <option value="caixa">Operador Caixa</option>
                        <option value="gerente">Gerente</option>
                        <option value="motoboy">Motoboy</option>
                      </select>
                    </div>
                    <button type="submit" className={clsx('w-full', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'text-[9px]', 'uppercase', 'tracking-wider', 'rounded-lg', 'transition-all', 'cursor-pointer')}>Cadastrar e Enviar Convite</button>
                  </form>
                </div>

                </div>
              </div>
          )}

          {/* VIEW: EQUIPE — CARGOS E PERMISSÕES (dados reais da API) */}
          {activeTab === 'permissoes_cargos' && ['cargos_permissoes', 'cargos', 'permissoes'].includes(activeSubTab) && (
            <EquipeCargosTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
          )}


          {/* VIEW 7: CONFIGURAÇÕES SALÃO (Impressão, App Garçom e Taxa) */}
          {(activeTab === 'impressao_salao' || activeSubTab === 'impressoras') && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-1.5 rounded-xl border border-[#27272A] bg-[#09090B] p-1 w-fit">
                {[
                  { id: 'impressao', label: 'Impressão', icon: Printer },
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
                        tab.id as 'impressao' | 'garcom' | 'taxa'
                      )}
                      className={`px-3 py-2 text-[9px] font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
                        selected
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <Icon size={12} />
                      {tab.label}
                      {tab.id === 'impressao' && !hasPrinting && (
                        <Lock size={10} className="text-amber-300" />
                      )}
                    </button>
                  );
                })}
              </div>

              {printingSettingsTab === 'impressao' && !hasPrinting && (
                <div className="bg-[#121214] border border-amber-500/20 rounded-3xl p-8 text-center max-w-xl mx-auto space-y-3">
                  <Lock size={24} className="text-amber-400 mx-auto" />
                  <h3 className="text-white font-bold">Impressão não incluída no Kôma Pocket</h3>
                  <p className="text-[10px] text-gray-400">
                    App do Garçom e Taxa de Serviço continuam disponíveis nas abas acima. Migre para o Kôma Pro ou Premium para liberar impressão.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('assinatura_pix');
                      setActiveSubTab('planos');
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase cursor-pointer"
                  >
                    Comparar planos
                  </button>
                </div>
              )}

              {/* Service Tax config block moved to Salão e Impressão */}
              {printingSettingsTab === 'taxa' && (
              <div className={clsx('lg:col-span-3', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-3')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Taxa de Serviço do Salão</span>

                <div className={clsx('flex', 'justify-between', 'items-center', 'pt-1')}>
                  <span className={clsx('text-[10px]', 'text-gray-300', 'font-semibold')}>Ativar Taxa de 10% de Serviço</span>
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
                    <div className={clsx('w-9', 'h-5', 'bg-[#27272A]', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-4', 'after:w-4', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                  </label>
                </div>

                {taxaServicoAtiva && (
                  <div className={clsx('space-y-1', 'pt-1.5', 'animate-scale-in', 'max-w-xs')}>
                    <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Porcentagem Customizada (%):</label>
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
                      className={clsx('w-full', 'px-3', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono', 'text-[10px]')}
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
              <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'flex', 'flex-col', 'overflow-hidden')}>
                <div className={clsx('border-b', 'border-[#27272A]', 'pb-3', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Configurações de Permissões do App do Garçom</span>
                </div>

                {/* Sub tabs inside configurations */}
                <div className={clsx('flex', 'gap-1.5', 'bg-[#09090B]', 'p-1', 'rounded-xl', 'border', 'border-[#27272A]', 'w-fit', 'shrink-0')}>
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
                        : 'text-gray-400 hover:text-white'
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
                        { title: "Permitir que garçom faça lançamentos de pedidos de delivery", desc: "Ao ativar, garçons podem criar comandas com canais externos no salão.", checked: permDelivery, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_delivery: val }) },
                        { title: "Permitir que Garçons editem pedidos", desc: "Permite atualizar observações ou acrescentar itens em comandas já enviadas.", checked: permEdit, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_editar: val }) },
                        { title: "Permitir que Garçons editem cobranças adicionais", desc: "Permite retirar/colocar taxas extras, como couvert artístico ou consumação mínima.", checked: permAddCharges, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_taxas: val }) },
                        { title: "Permitir que garçons cancelem pedidos", desc: "Permite a exclusão direta de itens ou comandas pelo aplicativo sem aprovação do gerente.", checked: permCancel, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_cancelar: val }) },
                        { title: "Permitir exibição de status de pedidos no mapa de mesas", desc: "Gera ícones de produção ('Em preparo', 'Pronto') sobre as mesas no mapa.", checked: permShowStatus, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_status: val }) },
                        { title: "Permitir que garçons abram comandas sem pedido", desc: "Permite reservar uma mesa com status 'ocupada' sem lançar nenhum item.", checked: permOpenEmpty, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_abrir_vazia: val }) },
                        { title: "Permitir impressão automática dos pedidos feitos pelo Garçom", desc: "Dispara a via térmica de produção no balcão imediatamente após o garçom confirmar.", checked: permAutoPrint, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_print: val }) }
                      ].map((item, idx) => (
                        <div key={idx} className={clsx('flex', 'justify-between', 'items-start', 'gap-4')}>
                          <div className="space-y-0.5">
                            <strong className={clsx('text-white', 'block', 'font-semibold')}>{item.title}</strong>
                            <span className={clsx('text-[9px]', 'text-gray-500', 'block', 'leading-relaxed')}>{item.desc}</span>
                          </div>
                          <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer', 'shrink-0', 'mt-0.5')}>
                            <input type="checkbox" checked={item.checked} onChange={(e) => item.onChange(e.target.checked)} className={clsx('sr-only', 'peer')} />
                            <div className={clsx('w-8', 'h-4.5', 'bg-[#27272A]', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-3.5', 'after:w-3.5', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}

                  {configSalSubTab === 'fechamento' && (
                    <div className={clsx('space-y-3.5', 'animate-scale-in')}>
                      {[
                        { title: "Permitir que Garçom feche a conta", desc: "Autoriza o garçom a encerrar a mesa e dar a baixa definitiva no consumo.", checked: permCloseAccount, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_fechar: val }) },
                        { title: "Permitir que Garçom aplique desconto", desc: "Habilita a aplicação de porcentagem de desconto na conta final direto pelo aplicativo.", checked: permDiscount, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_desconto: val }) },
                        { title: "Permitir que Garçom aplique acréscimo", desc: "Habilita a adição de valores extras ou gorjetas no fechamento da conta pelo app.", checked: permSurcharge, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_acrescimo: val }) }
                      ].map((item, idx) => (
                        <div key={idx} className={clsx('flex', 'justify-between', 'items-start', 'gap-4')}>
                          <div className="space-y-0.5">
                            <strong className={clsx('text-white', 'block', 'font-semibold')}>{item.title}</strong>
                            <span className={clsx('text-[9px]', 'text-gray-500', 'block', 'leading-relaxed')}>{item.desc}</span>
                          </div>
                          <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer', 'shrink-0', 'mt-0.5')}>
                            <input type="checkbox" checked={item.checked} onChange={(e) => item.onChange(e.target.checked)} className={clsx('sr-only', 'peer')} />
                            <div className={clsx('w-8', 'h-4.5', 'bg-[#27272A]', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-3.5', 'after:w-3.5', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}

                  {configSalSubTab === 'atendimento' && (
                    <div className={clsx('space-y-3.5', 'animate-scale-in')}>
                      {[
                        { title: "Permitir que o garçom informe quantas pessoas vão sentar à mesa", desc: "Abre pergunta inicial na abertura da mesa para cálculo automático do consumo/taxa individual.", checked: permPeopleCount, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_pessoas: val }) },
                        { title: "Permitir que Garçom transfira mesas e comandas", desc: "Permite realocar todo o consumo de uma mesa para outra mesa vazia.", checked: permTransferTables, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_transferir_mesa: val }) },
                        { title: "Permitir que Garçom transfira pedidos e pagamentos para mesas ocupadas", desc: "Mover itens isolados ou repassar contas a pagar entre comanda de clientes sentados.", checked: permTransferItems, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_transferir_item: val }) },
                        { title: "Permitir que Cliente chame Garçom na mesa", desc: "Dispara notificações no painel do garçom se o cliente apertar o botão no cardápio digital QR Code.", checked: permClientCall, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_chamar: val }) },
                        { title: "Permitir exibição de mesas ociosas", desc: "Destaca no mapa mesas sem novos pedidos há mais tempo.", checked: permShowIdleTables, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_ociosas: val }) }
                      ].map((item, idx) => (
                        <div key={idx} className={clsx('flex', 'justify-between', 'items-start', 'gap-4')}>
                          <div className="space-y-0.5">
                            <strong className={clsx('text-white', 'block', 'font-semibold')}>{item.title}</strong>
                            <span className={clsx('text-[9px]', 'text-gray-500', 'block', 'leading-relaxed')}>{item.desc}</span>
                          </div>
                          <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer', 'shrink-0', 'mt-0.5')}>
                            <input type="checkbox" checked={item.checked} onChange={(e) => item.onChange(e.target.checked)} className={clsx('sr-only', 'peer')} />
                            <div className={clsx('w-8', 'h-4.5', 'bg-[#27272A]', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-3.5', 'after:w-3.5', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                          </label>
                        </div>
                      ))}

                      {permShowIdleTables && (
                        <div className={clsx('p-3', 'bg-[#1C1C1F]', 'rounded-xl', 'border', 'border-[#27272A]', 'space-y-1.5', 'animate-scale-in')}>
                          <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Tempo de Ociosidade Limite (Minutos):</label>
                          <div className={clsx('flex', 'items-center', 'gap-2')}>
                            <button type="button" onClick={() => setIdleTimeThreshold(Math.max(5, idleTimeThreshold - 5))} className={clsx('px-2.5', 'py-1', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'text-white', 'font-bold', 'cursor-pointer')}>-</button>
                            <span className={clsx('text-white', 'font-mono', 'font-bold', 'text-xs')}>{idleTimeThreshold} min</span>
                            <button type="button" onClick={() => setIdleTimeThreshold(idleTimeThreshold + 5)} className={clsx('px-2.5', 'py-1', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'text-white', 'font-bold', 'cursor-pointer')}>+</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>
              )}

              {/* Printer messages & test (Right Column) */}
              {printingSettingsTab === 'impressao' && hasPrinting && (
              <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'grid', 'grid-cols-1', 'xl:grid-cols-2', 'gap-5')}>
                <div className="space-y-4">
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Impressoras térmicas</span>

                  <div className={clsx('space-y-3', 'text-left')}>
                    <div className="space-y-1">
                      <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Nome do restaurante no cupom:</label>
                      <input
                        type="text"
                        value={printHeader}
                        maxLength={80}
                        onChange={(e) => setPrintHeader(e.target.value)}
                        onBlur={() => updateConfiguracoes({ impressao_nome_restaurante: printHeader })}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]')}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Onde imprimir o nome:</label>
                      <select
                        value={printNamePosition}
                        onChange={(e) => updateConfiguracoes({
                          impressao_nome_posicao: e.target.value as 'cabecalho' | 'rodape' | 'oculto'
                        })}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]')}
                      >
                        <option value="cabecalho">Cabeçalho — maior destaque</option>
                        <option value="rodape">Rodapé</option>
                        <option value="oculto">Não imprimir</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Mensagem adicional de rodapé:</label>
                      <input
                        type="text"
                        value={printFooter}
                        maxLength={160}
                        placeholder="Ex.: endereço, telefone ou agradecimento"
                        onChange={(e) => setPrintFooter(e.target.value)}
                        onBlur={() => updateConfiguracoes({ impressao_mensagem_rodape: printFooter })}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]')}
                      />
                    </div>

                    <div className={clsx('flex', 'justify-between', 'items-center', 'pt-2')}>
                      <span className={clsx('text-[10px]', 'text-gray-300', 'font-semibold')}>Unificar Vias de Delivery (Via Única)</span>
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
                        <div className={clsx('w-9', 'h-5', 'bg-[#27272A]', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-4', 'after:w-4', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                      </label>
                    </div>

                  </div>

                </div>

                {/* Prévia fiel ao formato térmico atual da comanda inteira. */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-serif font-bold text-gray-300">
                      Prévia da comanda
                    </span>
                    <span className="rounded-full border border-[#27272A] px-2 py-1 text-[8px] text-gray-500">
                      exemplo em escala
                    </span>
                  </div>
                  <div className="mx-auto w-full max-w-[380px] bg-[#FFFFFC] text-black px-5 py-4 rounded-sm border border-gray-300 font-mono text-[10px] leading-[1.25] shadow-[0_14px_30px_rgba(0,0,0,0.35)]">
                    {printNamePosition === 'cabecalho' && printHeader && (
                      <>
                        <div className="text-center font-bold uppercase text-[12px] leading-tight">
                          {printHeader}
                        </div>
                        <div className="border-t border-dashed border-gray-500 my-1.5" />
                      </>
                    )}

                    <div className="text-center font-bold text-[12px]">
                      CONSUMO NO LOCAL
                    </div>
                    <div className="border-t border-dashed border-gray-500 my-1.5" />
                    <div className="flex justify-between">
                      <span>PEDIDO: #305</span>
                      <span>MESA: 3</span>
                    </div>
                    <div className="flex justify-between">
                      <span>DATA: 28/07/2026</span>
                      <span>HORA: 18:01</span>
                    </div>
                    <div>GARÇOM: GEORLAN</div>
                    <div className="border-t border-dashed border-gray-500 my-1.5" />

                    <div className="space-y-1">
                      <div className="flex justify-between gap-3">
                        <span>3x HAMBÚRGUER TRADICIONAL</span>
                        <span className="shrink-0">R$ 57,00</span>
                      </div>
                      <div className="pl-3 text-[8px] text-gray-700">
                        OBS: SEM CHEDDAR
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>2x HEINEKEN LONG NECK</span>
                        <span className="shrink-0">R$ 24,00</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>1x BAGUETE DE COSTELA</span>
                        <span className="shrink-0">R$ 36,00</span>
                      </div>
                      <div className="pl-3 text-[8px] text-gray-700">
                        OBS: SEM SALADA
                      </div>
                    </div>

                    <div className="border-t border-dashed border-gray-500 my-1.5" />
                    <div className="text-center font-bold">CLIENTE: PAULO</div>
                    <div className="flex justify-between gap-3">
                      <span>1x CHEESE BACON</span>
                      <span className="shrink-0">R$ 25,00</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>1x HAMBÚRGUER SUÍNO</span>
                      <span className="shrink-0">R$ 19,00</span>
                    </div>
                    <div className="border-t border-dashed border-gray-500 my-1.5" />
                    <div className="flex justify-between">
                      <span>SUBTOTAL CONSUMO GERAL</span>
                      <span>R$ 117,00</span>
                    </div>
                    <div className="flex justify-between">
                      <span>SUBTOTAL PAULO</span>
                      <span>R$ 44,00</span>
                    </div>
                    <div className="border-y border-double border-gray-700 my-1.5 py-1 flex justify-between font-bold text-[11px]">
                      <span>TOTAL GERAL DA MESA</span>
                      <span>R$ 161,00</span>
                    </div>

                    <div className="text-center text-[9px] mt-2">
                      <span className="block">Gerenciado por Kôma</span>
                      <span className="block">Documento não fiscal</span>
                      {printFooter && (
                        <span className="block mt-1 uppercase">{printFooter}</span>
                      )}
                      {printNamePosition === 'rodape' && printHeader && (
                        <span className="block font-bold mt-1 uppercase">
                          {printHeader}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-[8px] leading-relaxed text-gray-500">
                    O nome, a posição e o rodapé acima atualizam esta prévia. A impressão real ajusta as quebras à largura configurada na térmica.
                  </p>
                </div>

              </div>
              )}

            </div>
          )}

          {/* VIEW 8A: ROBÔ & IA - CONFIGURAÇÕES DO PROMPT & GOVERNANÇA */}
          {(activeTab === 'assistente_koma' || activeTab === 'robo_ia') && ['configuracao', 'prompt', 'prompt_atendente'].includes(activeSubTab) && (
            <AssistenteConfigTab
              aiBotActive={aiBotActive}
              setAiBotActive={setAiBotActive}
              aiSystemPrompt={aiSystemPrompt}
              setAiSystemPrompt={setAiSystemPrompt}
              iaDiscountEnabled={iaDiscountEnabled}
              setIaDiscountEnabled={setIaDiscountEnabled}
              iaMaxDiscount={iaMaxDiscount}
              setIaMaxDiscount={setIaMaxDiscount}
              iaUpsellEnabled={iaUpsellEnabled}
              setIaUpsellEnabled={setIaUpsellEnabled}
              iaVoiceTone={iaVoiceTone}
              setIaVoiceTone={setIaVoiceTone}
              iaMaxInteractions={iaMaxInteractions}
              setIaMaxInteractions={setIaMaxInteractions}
            />
          )}

          {/* VIEW 8B: ROBÔ & IA - SIMULADOR DE CHAT */}
          {(activeTab === 'assistente_koma' || activeTab === 'robo_ia') && ['simulador', 'simulador_chat'].includes(activeSubTab) && (
            <AssistenteSimuladorTab
              aiBotActive={aiBotActive}
              chatbotMessages={chatbotMessages}
              isBotTyping={isBotTyping}
              chatInputText={chatInputText}
              setChatInputText={setChatInputText}
              handleSendChatbotMessage={handleSendChatbotMessage}
              supportChats={supportChats}
              setSupportChats={setSupportChats}
              customerFeedbacks={customerFeedbacks}
            />
          )}

          {/* VIEW 9: PAGAMENTOS & PLANOS */}
          {activeSubTab === 'planos' && (
            <AssinaturaPixTab
              currentPlanId={currentPlanId}
              hasPrinting={hasPrinting}
              hasOnlineMenu={hasOnlineMenu}
              payPixActive={payPixActive}
              setPayPixActive={setPayPixActive}
              payCardActive={payCardActive}
              setPayCardActive={setPayCardActive}
              isTestPlan={restauranteConfig?.plano_modo_teste === true}
              bannerNotice={planNoticeBanner}
            />
          )}

          {/* VIEW: RECUPERADOR DE VENDAS */}
          {activeSubTab === 'recuperador' && (
            <div className={clsx('space-y-5', 'text-left', 'animate-fade-in')}>
              <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-4.5', 'rounded-3xl', 'space-y-2')}>
                <h3 className={clsx('font-serif', 'font-bold', 'text-base', 'text-white')}>Recuperador de Vendas Abandonadas</h3>
                <p className={clsx('text-[10px]', 'text-gray-400', 'leading-relaxed')}>
                  Monitore carrinhos de compras que foram iniciados no site de delivery ou pelo robô, mas não foram concluídos pelo cliente. Envie uma mensagem automática de incentivo no WhatsApp.
                </p>
              </div>

              <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'overflow-hidden')}>
                <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                  <thead>
                    <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                      <th className="p-3.5">Cliente</th>
                      <th className="p-3.5">WhatsApp</th>
                      <th className="p-3.5">Itens do Carrinho</th>
                      <th className="p-3.5">Total</th>
                      <th className="p-3.5">Abandonado há</th>
                      <th className="p-3.5">Status</th>
                      <th className={clsx('p-3.5', 'text-right')}>Ação</th>
                    </tr>
                  </thead>
                  <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                    {abandonedCarts.map((cart) => (
                      <tr key={cart.id} className={clsx('hover:bg-[#1C1C1F]/35', 'transition-colors')}>
                        <td className={clsx('p-3.5', 'font-bold', 'text-white')}>{cart.cliente}</td>
                        <td className={clsx('p-3.5', 'text-gray-300', 'font-mono')}>{cart.telefone}</td>
                        <td className={clsx('p-3.5', 'text-gray-400', 'italic', 'max-w-xs', 'truncate')}>{cart.itens}</td>
                        <td className={clsx('p-3.5', 'font-bold', 'text-emerald-500', 'font-mono')}>R$ {cart.total.toFixed(2)}</td>
                        <td className={clsx('p-3.5', 'text-gray-400')}>{cart.abandonadoEm}</td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase ${cart.status === 'recuperado'
                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                            }`}>
                            {cart.status === 'recuperado' ? 'Recuperado' : 'Pendente'}
                          </span>
                        </td>
                        <td className={clsx('p-3.5', 'text-right')}>
                          <button
                            onClick={() => handleRecuperarCart(cart.id, cart.cliente, cart.telefone)}
                            disabled={cart.status === 'recuperado'}
                            className={`px-2.5 py-1 text-[9px] font-bold rounded-lg uppercase tracking-wider cursor-pointer transition-all ${cart.status === 'recuperado'
                              ? 'bg-zinc-800 text-gray-500 border border-transparent cursor-not-allowed'
                              : 'bg-[#10b981] hover:bg-[#059669] text-[#121214] border border-transparent'
                              }`}
                          >
                            Recuperar no Whats
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}



          {/* VIEW: CUPONS DE DESCONTO */}
          {['cupons', 'cupom', 'descontos', 'cupons_desconto'].includes(activeSubTab) && (
            <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-3', 'gap-5', 'text-left', 'animate-fade-in')}>
              <div className={clsx('md:col-span-1', 'bg-[#121214]', 'border', 'border-[#27272A]', 'p-5', 'rounded-3xl', 'space-y-4', 'h-fit')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Criar Novo Cupom</span>
                <form onSubmit={handleAddCoupon} className="space-y-4">
                  <div className="space-y-1">
                    <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Código do Cupom:</label>
                    <input
                      type="text"
                      placeholder="EX: FESTA20"
                      value={newCouponCode}
                      onChange={(e) => setNewCouponCode(e.target.value)}
                      className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]')}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Tipo de Desconto:</label>
                    <select
                      value={newCouponTipo}
                      onChange={(e) => setNewCouponTipo(e.target.value as any)}
                      className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]')}
                    >
                      <option value="percentual">Percentual (%)</option>
                      <option value="fixo">Fixo (R$)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Valor do Desconto:</label>
                    <input
                      type="number"
                      value={newCouponVal}
                      onChange={(e) => setNewCouponVal(Number(e.target.value))}
                      className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono', 'text-[10px]')}
                    />
                  </div>

                  <button
                    type="submit"
                    className={clsx('w-full', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-xl', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                  >
                    Salvar Cupom
                  </button>
                </form>
              </div>

              <div className={clsx('md:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Cupons Cadastrados</span>
                <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                  <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                    <thead>
                      <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                        <th className="p-3">Código</th>
                        <th className="p-3">Tipo</th>
                        <th className="p-3">Desconto</th>
                        <th className="p-3">Status</th>
                        <th className={clsx('p-3', 'text-right')}>Ação</th>
                      </tr>
                    </thead>
                    <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                      {coupons.map((coupon) => (
                        <tr key={coupon.id} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                          <td className={clsx('p-3', 'font-mono', 'font-bold', 'text-white', 'tracking-wide')}>{coupon.codigo}</td>
                          <td className={clsx('p-3', 'text-gray-400', 'capitalize')}>{coupon.tipo === 'percentual' ? 'Percentual' : 'Fixo'}</td>
                          <td className={clsx('p-3', 'font-bold', 'text-emerald-400', 'font-mono')}>
                            {coupon.tipo === 'percentual' ? `${coupon.valor}%` : `R$ ${coupon.valor.toFixed(2)}`}
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, ativo: !c.ativo } : c))}
                              className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase transition-all cursor-pointer ${coupon.ativo
                                ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                : 'bg-zinc-800 text-gray-500 border border-transparent'
                                }`}
                            >
                              {coupon.ativo ? 'Ativo' : 'Inativo'}
                            </button>
                          </td>
                          <td className={clsx('p-3', 'text-right')}>
                            <button
                              onClick={() => setCoupons(prev => prev.filter(c => c.id !== coupon.id))}
                              className={clsx('p-1', 'hover:bg-emerald-600/20', 'text-emerald-500', 'hover:text-[#FF5C75]', 'rounded-lg', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: FIDELIDADE */}
          {activeSubTab === 'fidelidade' && (
            <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-3', 'gap-5', 'text-left', 'animate-fade-in')}>
              <div className={clsx('md:col-span-1', 'bg-[#121214]', 'border', 'border-[#27272A]', 'p-5', 'rounded-3xl', 'space-y-4', 'h-fit')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Ajustes de Fidelização</span>

                <form onSubmit={handleSaveFidelityConfig} className="space-y-4">
                  <div className={clsx('flex', 'items-center', 'justify-between')}>
                    <span className={clsx('text-[10px]', 'text-gray-400')}>Ativar Programa</span>
                    <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer', 'shrink-0')}>
                      <input
                        type="checkbox"
                        checked={fidelidadeConfig.ativo}
                        onChange={(e) => setFidelidadeConfig(prev => ({ ...prev, ativo: e.target.checked }))}
                        className={clsx('sr-only', 'peer')}
                      />
                      <div className={clsx('w-8', 'h-4.5', 'bg-[#27272A]', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-3.5', 'after:w-3.5', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                    </label>
                  </div>

                  <div className="space-y-1">
                    <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Tipo de Recompensa:</label>
                    <select
                      value={fidelidadeConfig.tipo_recompensa}
                      onChange={(e) => setFidelidadeConfig(prev => ({ ...prev, tipo_recompensa: e.target.value }))}
                      disabled={!fidelidadeConfig.ativo}
                      className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]', 'disabled:opacity-50')}
                    >
                      <option value="PONTOS">Pontos de Fidelidade</option>
                      <option value="CASHBACK">Retorno (Cashback %)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>
                      {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? 'Conversão (R$ 1 = X pontos):' : 'Porcentagem de Cashback (%):'}
                    </label>
                    <input
                      type="number"
                      value={fidelidadeConfig.taxa_conversao}
                      onChange={(e) => setFidelidadeConfig(prev => ({ ...prev, taxa_conversao: Number(e.target.value) }))}
                      disabled={!fidelidadeConfig.ativo}
                      className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono', 'text-[10px]', 'disabled:opacity-50')}
                    />
                  </div>

                  {fidelidadeConfig.tipo_recompensa === 'PONTOS' && (
                    <div className="space-y-1">
                      <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Valor de 1 Ponto em Recompensa (R$):</label>
                      <input
                        type="number"
                        step="0.01"
                        value={fidelidadeConfig.valor_ponto_em_dinheiro}
                        onChange={(e) => setFidelidadeConfig(prev => ({ ...prev, valor_ponto_em_dinheiro: Number(e.target.value) }))}
                        disabled={!fidelidadeConfig.ativo}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono', 'text-[10px]', 'disabled:opacity-50')}
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    className={clsx('w-full', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                  >
                    Salvar Ajustes
                  </button>
                </form>
              </div>

              <div className={clsx('md:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>
                  {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? 'Saldo de Clientes (Clube de Pontos)' : 'Saldo de Clientes (Programa Cashback)'}
                </span>

                <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                  <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                    <thead>
                      <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                        <th className="p-3">Cliente</th>
                        {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? (
                          <>
                            <th className="p-3">Pontos Acumulados</th>
                            <th className={clsx('p-3', 'font-bold', 'text-emerald-400', 'font-mono')}>Valor Equivalente (R$)</th>
                          </>
                        ) : (
                          <th className={clsx('p-3', 'font-bold', 'text-emerald-400', 'font-mono')}>Saldo Cashback Disponível</th>
                        )}
                        <th className={clsx('p-3', 'text-right')}>Ação</th>
                      </tr>
                    </thead>
                    <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                      {loyaltyUsers.map((user) => (
                        <tr key={user.id} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                          <td className={clsx('p-3', 'font-bold', 'text-white')}>{user.cliente}</td>
                          {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? (
                            <>
                              <td className={clsx('p-3', 'font-mono', 'font-bold', 'text-[#10b981]')}>{user.pontos} pts</td>
                              <td className={clsx('p-3', 'font-bold', 'text-emerald-400', 'font-mono')}>R$ {(user.pontos * fidelidadeConfig.valor_ponto_em_dinheiro).toFixed(2)}</td>
                            </>
                          ) : (
                            <td className={clsx('p-3', 'font-bold', 'text-emerald-400', 'font-mono')}>R$ {user.saldoCashback.toFixed(2)}</td>
                          )}
                          <td className={clsx('p-3', 'text-right')}>
                            <button
                              onClick={() => alert(`Lançamento manual para ${user.cliente}`)}
                              className={clsx('px-2', 'py-1', 'bg-[#1C1C1F]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'text-gray-300', 'font-bold', 'rounded-lg', 'text-[9px]', 'uppercase', 'tracking-wider', 'cursor-pointer')}
                            >
                              Creditar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
            <RelatoriosProdutosTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} showToast={showToast} />
          )}

          {/* VIEW: RELATÓRIOS — EQUIPE (reutiliza o mesmo componente de desempenho) */}
          {(activeTab === 'relatorios' || activeTab === 'dashboard') && activeSubTab === 'equipe' && (
            <EquipeDesempenhoTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} showToast={showToast} />
          )}

          {/* FICHA TÉCNICA (OCULTO — implementação real futura) */}
          {false && activeTab === 'cardapio' && activeSubTab === 'ficha_tecnica' && (
            <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5', 'text-left', 'animate-fade-in')}>
              <div className={clsx('lg:col-span-1', 'bg-[#121214]', 'border', 'border-[#27272A]', 'p-5', 'rounded-3xl', 'space-y-4', 'h-fit')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Simulador de Custos (CMV)</span>
                <p className={clsx('text-[10px]', 'text-gray-400', 'leading-relaxed')}>
                  Cruza a quantidade e preço médio de compras de insumos para definir a margem de lucro de cada prato.
                </p>
                <div className={clsx('space-y-3.5', 'text-[10px]', 'font-mono')}>
                  <div className={clsx('p-3', 'bg-[#1C1C1F]', 'rounded-2xl', 'border', 'border-[#27272A]/50', 'space-y-2')}>
                    <span className={clsx('text-[9px]', 'font-bold', 'font-sans', 'text-[#10b981]', 'block', 'uppercase', 'tracking-wider')}>Hambúrguer Kôma</span>
                    <div className={clsx('flex', 'justify-between')}><span>Pão Brioche (1 un):</span> <span>R$ 1.50</span></div>
                    <div className={clsx('flex', 'justify-between')}><span>Blend Carne 150g:</span> <span>R$ 4.20</span></div>
                    <div className={clsx('flex', 'justify-between')}><span>Queijo Cheddar 30g:</span> <span>R$ 1.10</span></div>
                    <div className={clsx('flex', 'justify-between')}><span>Embalagem + Caixa:</span> <span>R$ 1.20</span></div>
                    <div className={clsx('border-t', 'border-[#27272A]/60', 'pt-2', 'flex', 'justify-between', 'font-bold', 'text-white')}>
                      <span>Custo Total Insumos:</span>
                      <span>R$ 8.00</span>
                    </div>
                    <div className={clsx('flex', 'justify-between', 'text-emerald-400', 'font-bold')}>
                      <span>Margem Bruta (venda R$ 22.00):</span>
                      <span>63.6%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Fichas Técnicas Cadastradas</span>
                <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                  <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                    <thead>
                      <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                        <th className="p-3">Nome</th>
                        <th className="p-3">Categoria</th>
                        <th className={clsx('p-3', 'font-mono')}>Preço de Venda</th>
                        <th className={clsx('p-3', 'font-mono')}>Custo Insumos</th>
                        <th className={clsx('p-3', 'text-right')}>Margem de Lucro</th>
                      </tr>
                    </thead>
                    <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                      {[
                        { nome: "Hambúrguer Kôma", cat: "Burgers", venda: 22.00, custo: 8.00, margem: "63.6%" },
                        { nome: "Pastel de Carne", cat: "Pastéis", venda: 12.00, custo: 3.50, margem: "70.8%" },
                        { nome: "Coca-Cola Lata", cat: "Bebidas", venda: 6.00, custo: 2.20, margem: "63.3%" }
                      ].map((p, idx) => (
                        <tr key={idx} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                          <td className={clsx('p-3', 'font-bold', 'text-white')}>{p.nome}</td>
                          <td className={clsx('p-3', 'text-gray-400')}>{p.cat}</td>
                          <td className={clsx('p-3', 'font-mono', 'text-gray-300')}>R$ {p.venda.toFixed(2)}</td>
                          <td className={clsx('p-3', 'font-mono', 'text-rose-400')}>R$ {p.custo.toFixed(2)}</td>
                          <td className={clsx('p-3', 'font-bold', 'text-emerald-400', 'text-right')}>{p.margem}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ABA PRODUTOS */}
          {activeTab === 'cardapio' && activeSubTab === 'produtos' && (
            <div className={clsx('space-y-4', 'animate-fade-in', 'text-left')}>
              <div className={clsx('flex', 'justify-between', 'items-center')}>
                <div>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'text-base', 'block')}>Cardápio</span>
                  <span className={clsx('text-[9px]', 'text-gray-500')}>{apiProdutos.length} produtos cadastrados</span>
                </div>
                <div className={clsx('flex', 'gap-2')}>
                  <button
                    onClick={() => {
                      setEditingProduct(null);
                      setProdFormId('');
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
                    className={clsx('flex', 'items-center', 'gap-1.5', 'px-3', 'py-1.5', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                  >
                    <Plus size={11} />
                    Novo Item
                  </button>
                  <button
                    onClick={() => setShowCategoryModal(true)}
                    className={clsx('flex', 'items-center', 'gap-1.5', 'px-3', 'py-1.5', 'bg-[#10b981]/15', 'hover:bg-[#10b981]/25', 'border', 'border-[#10b981]/30', 'text-[#10b981]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                  >
                    <Plus size={11} />
                    Nova Categoria
                  </button>
                  {/* Oculto no painel do restaurante (reservado para Super Admin) */}
                  {false && (
                    <>
                      <button
                        onClick={() => {
                          const json = JSON.stringify(apiProdutos, null, 2);
                          const blob = new Blob([json], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a'); a.href = url; a.download = 'cardapio_koma.json'; a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className={clsx('flex', 'items-center', 'gap-1.5', 'px-3', 'py-1.5', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'hover:border-[#10b981]/40', 'text-gray-300', 'hover:text-[#10b981]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                        Exportar JSON
                      </button>
                      <label className={clsx('flex', 'items-center', 'gap-1.5', 'px-3', 'py-1.5', 'bg-[#10b981]/10', 'border', 'border-[#10b981]/20', 'hover:bg-[#10b981]/20', 'text-[#10b981]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                        Importar JSON
                        <input type="file" accept=".json" className="hidden" onChange={async (e) => {
                          const file = e.target.files?.[0]; if (!file) return;
                          const text = await file.text();
                          try {
                            const data = JSON.parse(text);
                            const items = Array.isArray(data) ? data : [data];
                            if (confirm(`Deseja importar/atualizar ${items.length} produtos no cardápio?`)) {
                              const res = await fetch(`${apiBaseUrl}/produtos/importar`, {
                                method: 'POST',
                                headers: {
                                  ...authHeaders,
                                  'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(items)
                              });
                              if (res.ok) {
                                alert('Produtos importados com sucesso!');
                                await fetchProdutos();
                              } else {
                                const err = await res.json();
                                alert(`Erro na importação: ${err.detail || 'Erro desconhecido'}`);
                              }
                            }
                          } catch (err) {
                            console.error(err);
                            alert('Arquivo JSON inválido ou erro de processamento.');
                          }
                        }} />
                      </label>
                    </>
                  )}
                </div>
              </div>

              {/* Search bar */}
              <div className={clsx('relative')}>
                <input
                  type="text"
                  placeholder="Pesquisar produto..."
                  value={cardapioProdutosSearch}
                  onChange={e => setCardapioProdutosSearch(e.target.value)}
                  className={clsx('w-full', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-xl', 'px-3', 'py-2', 'text-[10px]', 'text-white', 'placeholder:text-gray-500', 'focus:outline-none', 'focus:border-[#10b981]/50', 'transition-colors')}
                />
                {cardapioProdutosSearch && (
                  <button onClick={() => setCardapioProdutosSearch('')} className={clsx('absolute', 'right-3', 'top-1/2', '-translate-y-1/2', 'text-gray-500', 'hover:text-white')}>
                    <X size={11} />
                  </button>
                )}
              </div>

              {/* Grouped by dynamically loaded apiCategorias */}
              {apiCategorias.map((cat) => {
                const prods = apiProdutos
                  .filter(p => (p as any).categoria_id === cat.id)
                  .filter(p => !cardapioProdutosSearch.trim() || smartSearchMatch(p.nome, cardapioProdutosSearch) || smartSearchMatch(p.descricao || '', cardapioProdutosSearch))
                  .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' }));
                if (prods.length === 0) return null;
                return (
                  <div key={cat.id} className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-2xl', 'overflow-hidden')}>
                    <div className={clsx('bg-[#18181B]', 'px-4', 'py-2.5', 'border-b', 'border-[#27272A]')}>
                      <span className={clsx('font-bold', 'text-[#10b981]', 'text-[10px]', 'uppercase', 'tracking-wider')}>{cat.nome}</span>
                    </div>
                    <div className={clsx('divide-y', 'divide-[#27272A]/40')}>
                      {prods.map(prod => (
                        <div key={prod.id} className={clsx('flex', 'items-center', 'justify-between', 'px-4', 'py-3', 'hover:bg-[#1C1C1F]/30', 'transition-colors')}>
                          <div className={clsx('flex', 'items-center', 'gap-3')}>
                            {(prod as any).imagem && <img src={(prod as any).imagem} alt={prod.nome} className={clsx('w-8', 'h-8', 'rounded-lg', 'object-cover')} />}
                            <div>
                              <span className={clsx('text-white', 'text-xs', 'font-semibold', 'block')}>{prod.nome}</span>
                              {(prod as any).descricao && <span className={clsx('text-[9px]', 'text-gray-500', 'block')}>{(prod as any).descricao}</span>}
                            </div>
                          </div>
                          <div className={clsx('flex', 'items-center', 'gap-3', 'shrink-0')}>
                            <span className={clsx('font-mono', 'font-bold', 'text-[#10b981]', 'text-xs')}>R$ {prod.preco.toFixed(2)}</span>
                            <span title="Item publicado no catálogo do cardápio" className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${(prod as any).ativo !== false ? 'bg-emerald-600/15 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
                              {(prod as any).ativo !== false ? '🟢 No Cardápio' : '🔴 Oculto'}
                            </span>
                            <div className="flex gap-1 pl-2">
                              <button
                                onClick={() => {
                                  setEditingProduct(null);
                                  setProdFormId('');
                                  setProdFormNome(`${prod.nome} (Cópia)`);
                                  setProdFormPreco(prod.preco.toString());
                                  setProdFormCategoriaId((prod as any).categoria_id || '');
                                  setProdFormDescricao((prod as any).descricao || '');
                                  const galeriaDup = (prod as any).imagens_galeria || [];
                                  setProdFormImagem((prod as any).imagem || galeriaDup[0] || '');
                                  setProdFormImagem2(galeriaDup[1] || '');
                                  setProdFormImagem3(galeriaDup[2] || '');
                                  setProdFormAtivo(true);
                                  setShowProductModal(true);
                                }}
                                className="p-1 hover:bg-[#27272A] rounded text-emerald-400 hover:text-emerald-300 transition-all cursor-pointer border border-transparent"
                                title="Duplicar Produto (Criar variação)"
                              >
                                <Copy size={11} />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingProduct(prod);
                                  setProdFormId(prod.id);
                                  setProdFormNome(prod.nome);
                                  setProdFormPreco(prod.preco.toString());
                                  setProdFormCategoriaId((prod as any).categoria_id || '');
                                  setProdFormDescricao((prod as any).descricao || '');
                                  const galeriaEdit = (prod as any).imagens_galeria || [];
                                  setProdFormImagem((prod as any).imagem || galeriaEdit[0] || '');
                                  setProdFormImagem2(galeriaEdit[1] || '');
                                  setProdFormImagem3(galeriaEdit[2] || '');
                                  setProdFormAtivo((prod as any).ativo !== false);
                                  setShowProductModal(true);
                                }}
                                className="p-1 hover:bg-[#27272A] rounded text-gray-400 hover:text-white transition-all cursor-pointer border border-transparent"
                                title="Editar Produto"
                              >
                                <Edit3 size={11} />
                              </button>
                              <button
                                onClick={async () => {
                                  if (confirm(`Deseja realmente remover "${prod.nome}" do cardápio? Esta ação não pode ser desfeita.`)) {
                                    try {
                                      const res = await fetch(`${apiBaseUrl}/produtos/${prod.id}`, {
                                        method: 'DELETE',
                                        headers: authHeaders
                                      });
                                      if (res.ok) {
                                        fetchProdutos();
                                      } else {
                                        alert('Erro ao excluir produto.');
                                      }
                                    } catch (e) {
                                      console.error(e);
                                      alert('Erro de conexão ao excluir produto.');
                                    }
                                  }
                                }}
                                className="p-1 hover:bg-red-950/20 rounded text-red-400 hover:text-red-300 transition-all cursor-pointer border border-transparent"
                                title="Excluir Produto"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {apiProdutos.length === 0 && (
                <div className={clsx('py-20', 'text-center', 'text-gray-500', 'italic', 'text-xs')}>Nenhum produto encontrado. Cadastre em "Novo Item".</div>
              )}
            </div>
          )}

          {/* DISPONIBILIDADE CARDAPIO — REAL API com busca e categorias */}
          {activeTab === 'cardapio' && activeSubTab === 'disponibilidade' && (() => {
            const source = apiProdutos.length > 0 ? apiProdutos : PRODUCTS;
            const handleBatchAvailability = async (keyword: string, active: boolean) => {
              const targetProducts = source.filter(p => {
                const name = p.nome.toLowerCase();
                const catId = (p as any).categoria_id || '';
                
                if (keyword === 'hambúrguer') {
                  return name.includes('hambúrguer') || 
                         name.includes('hamburguer') || 
                         name.includes('burguer') || 
                         name.includes('burger') ||
                         catId.includes('hamburguer') ||
                         catId.includes('frango') ||
                         catId.includes('suinos');
                }
                
                if (keyword === 'pastel') {
                  return name.includes('pastel') || catId.includes('pastel');
                }
                
                if (keyword === 'baguete') {
                  return name.includes('baguete') || catId.includes('baguete');
                }

                // Fallback
                const catObj = (p as any).categoria;
                const cat = obterNomeCategoria(catObj).toLowerCase();
                return name.includes(keyword) || cat.includes(keyword) || catId.includes(keyword);
              });

              if (targetProducts.length === 0) return;

              if (confirm(`Deseja realmente ${active ? 'disponibilizar' : 'esgotar'} todos os itens relacionados a "${keyword}" (${targetProducts.length} itens)?`)) {
                try {
                  await Promise.all(targetProducts.map(prod =>
                    fetch(`${apiBaseUrl}/produtos/${prod.id}`, {
                      method: 'PUT',
                      headers: { ...authHeaders, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ativo: active })
                    })
                  ));
                  await fetchProdutos();
                } catch (e) {
                  console.error(e);
                  alert('Erro ao processar alteração em massa.');
                }
              }
            };

            const filtered = disponibilidadeSearch.trim()
              ? source.filter(p => smartSearchMatch(p.nome, disponibilidadeSearch) || smartSearchMatch(p.descricao, disponibilidadeSearch))
              : source;
            const byCat: Record<string, typeof source> = {};
            filtered.forEach(p => {
              const catObj = (p as any).categoria;
              const cat = obterNomeCategoria(catObj) || 'Geral';
              if (!byCat[cat]) byCat[cat] = [];
              byCat[cat].push(p);
            });
            return (
              <div className="space-y-4 animate-fade-in text-left w-full">
                {/* Header */}
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-serif font-bold text-slate-100 text-sm sm:text-base block">Disponibilidade Rápida do Cardápio</h3>
                    <p className="text-xs text-slate-400 block mt-0.5">Itens pausados não aparecem no aplicativo do garçom.</p>
                  </div>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 w-4 h-4" />
                  <input
                    value={disponibilidadeSearch}
                    onChange={e => setDisponibilidadeSearch(e.target.value)}
                    placeholder="Pesquisar produto..."
                    className="w-full pl-9 pr-8 py-2 bg-[#121316] border border-[#252832] rounded-xl text-white text-xs sm:text-sm placeholder-zinc-500 focus:outline-none focus:border-[#059669] focus:ring-1 focus:ring-[#059669] transition-all"
                  />
                  {disponibilidadeSearch && (
                    <button onClick={() => setDisponibilidadeSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer">
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Dynamic Category Grouping */}
                {apiCategorias.map((catObj) => {
                  const prods = filtered
                    .filter(p => (p as any).categoria_id === catObj.id)
                    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' }));
                  if (prods.length === 0) return null;
                  return (
                    <div key={catObj.id} className="bg-[#121214]/60 border border-[#27272A] rounded-2xl overflow-hidden w-full shadow-sm">
                      <div className="bg-[#18181B] px-4 py-3 border-b border-[#27272A] flex justify-between items-center gap-3">
                        <div className="flex items-baseline gap-2">
                          <span className="font-bold text-[#10b981] text-xs sm:text-sm uppercase tracking-wider">{catObj.nome}</span>
                          <span className="text-xs text-gray-400">({prods.length} {prods.length === 1 ? 'item' : 'itens'})</span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              if (confirm(`Deseja realmente pausar todos os itens da categoria "${catObj.nome}"?`)) {
                                try {
                                  await Promise.all(prods.map(prod => 
                                    fetch(`${apiBaseUrl}/produtos/${prod.id}`, {
                                      method: 'PUT',
                                      headers: { ...authHeaders, 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ ativo: false })
                                    })
                                  ));
                                  await fetchProdutos();
                                } catch (e) {
                                  console.error(e);
                                  alert('Erro ao atualizar categoria.');
                                }
                              }
                            }}
                            className="px-2.5 py-1 border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-bold rounded-lg transition-all cursor-pointer uppercase tracking-wider"
                          >
                            Pausar Categoria
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (confirm(`Deseja realmente ativar todos os itens da categoria "${catObj.nome}"?`)) {
                                try {
                                  await Promise.all(prods.map(prod => 
                                    fetch(`${apiBaseUrl}/produtos/${prod.id}`, {
                                      method: 'PUT',
                                      headers: { ...authHeaders, 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ ativo: true })
                                    })
                                  ));
                                  await fetchProdutos();
                                } catch (e) {
                                  console.error(e);
                                  alert('Erro ao atualizar categoria.');
                                }
                              }
                            }}
                            className="px-2.5 py-1 border border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/20 text-[#10b981] text-xs font-bold rounded-lg transition-all cursor-pointer uppercase tracking-wider"
                          >
                            Ativar Categoria
                          </button>
                        </div>
                      </div>

                      {/* Grid de 2 a 3 colunas preenchendo 100% da página */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3 w-full">
                        {prods.map(prod => {
                          const isAtivo = (prod as any).ativo !== false;
                          const codigoFormatado = `#${String(prod.id).padStart(3, '0')}`;

                          return (
                            <div
                              key={prod.id}
                              className={clsx(
                                'bg-[#18181B] hover:bg-[#1C1C1F] border border-[#27272A] rounded-xl p-3 flex items-center justify-between shadow-sm transition-colors gap-3',
                                !isAtivo && 'opacity-70'
                              )}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                {(prod as any).imagem && (
                                  <img
                                    src={(prod as any).imagem}
                                    alt={prod.nome}
                                    className={clsx('w-10 h-10 rounded-lg object-cover shrink-0', !isAtivo && 'opacity-40 grayscale')}
                                  />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="text-xs text-gray-400 font-mono shrink-0">{codigoFormatado}</span>
                                    <span className={clsx('text-sm font-bold truncate', isAtivo ? 'text-white' : 'text-gray-400 line-through')}>
                                      {prod.nome}
                                    </span>
                                  </div>
                                  <span className="text-xs font-mono font-bold text-[#10b981] mt-0.5 block">
                                    R$ {prod.preco.toFixed(2)}
                                  </span>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const res = await fetch(`${apiBaseUrl}/produtos/${prod.id}`, {
                                      method: 'PUT',
                                      headers: { ...authHeaders, 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ ativo: !isAtivo })
                                    });
                                    if (res.ok) { await fetchProdutos(); }
                                    else { alert('Erro ao atualizar disponibilidade.'); }
                                  } catch { alert('Erro de conexão.'); }
                                }}
                                className={clsx(
                                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border shrink-0 flex items-center gap-1.5',
                                  isAtivo
                                    ? 'bg-emerald-600/15 hover:bg-emerald-600/25 text-[#10b981] border-emerald-500/20'
                                    : 'bg-rose-600/15 hover:bg-rose-600/25 text-rose-400 border-rose-500/20'
                                )}
                              >
                                <span>{isAtivo ? '🟢 Disponível' : '🔴 Pausado'}</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="py-16 text-center text-slate-400 italic text-xs">
                    Nenhum produto encontrado para "{disponibilidadeSearch}".
                  </div>
                )}
              </div>
            );
          })()}

          {/* ABA CATEGORIAS */}
          {activeTab === 'cardapio' && activeSubTab === 'categorias' && (
            <CardapioCategoriasTab
              apiCategorias={apiCategorias}
              apiBaseUrl={apiBaseUrl}
              authHeaders={authHeaders}
              fetchCategorias={fetchCategorias}
              showToast={showToast}
            />
          )}

          {/* LIVE VIEW: ESTOQUE DE INSUMOS */}
          {activeTab === 'estoque' && activeSubTab === 'insumos' && (
            <div className={clsx('animate-fade-in', 'space-y-4', 'text-left')}>
              <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-3')}>
                <div className="flex justify-between items-center border-b border-[#27272A] pb-2">
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Insumos</span>
                  <button
                    type="button"
                    onClick={() => {
                      setInsumoFormId('');
                      setInsumoFormNome('');
                      setInsumoFormMinimo(10);
                      setInsumoFormMaximo(50);
                      setInsumoFormUnidade('un');
                      setInsumoFormCusto(0);
                      setShowNewInsumoModal(true);
                    }}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm"
                  >
                    + Novo Insumo
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSubTab('entradas')}
                    className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 border border-emerald-500/30 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm flex items-center gap-1"
                    title="Importar Nota Fiscal Eletrônica XML"
                  >
                    <Upload size={11} />
                    <span>Importar NF-e (XML)</span>
                  </button>
                </div>
                <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                  <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                    <thead>
                      <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                        <th className="p-3">Insumo</th>
                        <th className={clsx('p-3', 'font-mono')}>Estoque Atual</th>
                        <th className={clsx('p-3', 'font-mono')}>Mínimo</th>
                        <th className={clsx('p-3', 'font-mono')}>Custo Médio</th>
                        <th className={clsx('p-3', 'text-right')}>Status</th>
                        <th className={clsx('p-3', 'text-right')}>Ações</th>
                      </tr>
                    </thead>
                    <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                      {estoqueInsumos.length === 0 ? (
                        <tr><td colSpan={6} className="p-8 text-center text-gray-500 italic">Nenhum insumo cadastrado. Clique em Novo Insumo ou importe uma NF-e para começar.</td></tr>
                      ) : estoqueInsumos.map(ins => {
                        const isLow = ins.estoque_atual <= ins.estoque_minimo;
                        return (
                          <tr key={ins.id} className={clsx('transition-colors', isLow ? 'bg-amber-500/5 hover:bg-amber-500/10' : 'hover:bg-[#1C1C1F]/20')}>
                            <td className={clsx('p-3', 'font-semibold', 'text-white')}>{ins.nome} <span className="text-[8px] text-gray-500 block font-mono">ID: {ins.id}</span></td>
                            <td className={clsx('p-3', 'font-mono', isLow ? 'text-amber-400' : 'text-emerald-400')}>
                              {ins.estoque_atual.toFixed(2)} <span className="text-gray-500">{ins.unidade_medida}</span>
                            </td>
                            <td className={clsx('p-3', 'font-mono', 'text-gray-400')}>{ins.estoque_minimo.toFixed(2)} <span className="text-gray-600">{ins.unidade_medida}</span></td>
                            <td className={clsx('p-3', 'font-mono', 'text-gray-300')}>R$ {ins.preco_medio_custo.toFixed(2)}</td>
                            <td className="p-3 text-right">
                              {isLow
                                ? <span className="px-2 py-0.5 bg-amber-500/15 text-amber-400 rounded-full text-[8px] font-bold uppercase">⚠ Baixo</span>
                                : <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full text-[8px] font-bold uppercase">✓ Ok</span>
                              }
                            </td>
                            <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                              <button
                                onClick={() => {
                                  setSelectedInsumo(ins);
                                  setAjusteQtd(0);
                                  setAjusteTipo('ENTRADA');
                                  setAjusteJustificativa('');
                                  setShowAjusteInsumoModal(true);
                                }}
                                className="px-2 py-0.5 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800 text-gray-300 hover:text-white rounded-md transition-all cursor-pointer font-bold"
                              >
                                Ajustar
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedInsumo(ins);
                                  setInsumoFormNome(ins.nome);
                                  setInsumoFormMinimo(ins.estoque_minimo);
                                  setInsumoFormMaximo(ins.estoque_maximo);
                                  setInsumoFormUnidade(ins.unidade_medida);
                                  setInsumoFormCusto(ins.preco_medio_custo);
                                  setShowEditInsumoModal(true);
                                }}
                                className="px-2 py-0.5 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-[#1C1C1F] text-emerald-400 hover:text-emerald-300 rounded-md transition-all cursor-pointer font-bold"
                              >
                                Editar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* LIVE VIEW: ENTRADAS (MANUAIS E XML) */}
          {activeTab === 'estoque' && ['entradas', 'xml', 'notas_entrada'].includes(activeSubTab) && (
            <EstoqueEntradasTab
              entradas={entradasEstoque}
              notasEntradaXml={notasEntrada}
              distribuidores={distribuidores}
              insumos={estoqueInsumos}
              isLoading={isLoading}
              onOpenNovaEntradaModal={() => setShowEntradaManualModal(true)}
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
            />
          )}

          {/* LIVE VIEW: MOVIMENTAÇÕES DE ESTOQUE */}
          {activeTab === 'estoque' && activeSubTab === 'movimentacoes' && (
            <EstoqueMovimentacoesTab
              movimentacoes={movimentacoesEstoque}
              insumos={estoqueInsumos}
              isLoading={isLoading}
              onOpenNovaMovimentacaoModal={() => setShowMovimentacaoModal(true)}
              onRefreshMovimentacoes={() => {
                fetch(`${apiBaseUrl}/estoque/movimentacoes`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setMovimentacoesEstoque(d); });
              }}
            />
          )}

          {/* LIVE VIEW: CONTAGEM FÍSICA (INVENTÁRIO) */}
          {activeTab === 'estoque' && activeSubTab === 'contagem' && (
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
          )}

          {/* LIVE VIEW: DISTRIBUIDORES */}
          {activeTab === 'estoque' && activeSubTab === 'fornecedores' && (
            <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'text-left', 'animate-fade-in')}>
              <div className="flex justify-between items-center border-b border-[#27272A] pb-2">
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Fornecedores</span>
                <button
                  type="button"
                  onClick={() => {
                    setDistFormId('');
                    setDistFormNomeFantasia('');
                    setDistFormRazaoSocial('');
                    setDistFormCnpj('');
                    setDistFormLeadTime(3);
                    setShowNewDistModal(true);
                  }}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm"
                >
                  + Novo Fornecedor
                </button>
              </div>
              <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                  <thead>
                    <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                      <th className="p-3.5">Nome Fantasia</th>
                      <th className="p-3.5">Razão Social</th>
                      <th className="p-3.5">CNPJ</th>
                      <th className={clsx('p-3.5', 'text-right')}>Lead Time</th>
                      <th className={clsx('p-3.5', 'text-right')}>Ações</th>
                    </tr>
                  </thead>
                  <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                    {distribuidores.length === 0 ? (
                      <tr><td colSpan={5} className="p-8 text-center text-gray-500 italic">Nenhum fornecedor cadastrado. Clique em Novo Fornecedor ou importe uma NF-e.</td></tr>
                    ) : distribuidores.map(dist => (
                      <tr key={dist.id} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                        <td className={clsx('p-3.5', 'font-bold', 'text-white')}>{dist.nome_fantasia || '—'} <span className="text-[8px] text-gray-500 block font-mono">ID: {dist.id}</span></td>
                        <td className={clsx('p-3.5', 'text-gray-400')}>{dist.razao_social || '—'}</td>
                        <td className={clsx('p-3.5', 'font-mono', 'text-gray-400')}>{dist.cnpj}</td>
                        <td className={clsx('p-3.5', 'text-gray-400', 'text-right', 'font-mono')}>{dist.lead_time_dias ?? '—'} dias</td>
                        <td className="p-3.5 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => {
                              setSelectedDist(dist);
                              setDistFormNomeFantasia(dist.nome_fantasia || '');
                              setDistFormRazaoSocial(dist.razao_social || '');
                              setDistFormCnpj(dist.cnpj || '');
                              setDistFormLeadTime(dist.lead_time_dias ?? 3);
                              setShowEditDistModal(true);
                            }}
                            className="px-2 py-0.5 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-[#1C1C1F] text-emerald-400 hover:text-emerald-300 rounded-md transition-all cursor-pointer font-bold"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleDeleteDistribuidor(dist.id)}
                            className="px-2 py-0.5 border border-red-950/40 hover:border-red-600/30 bg-red-950/20 hover:bg-red-900/25 text-red-400 hover:text-white rounded-md transition-all cursor-pointer font-bold"
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MÓDULO CAIXA REORGANIZADO */}
          {activeTab === 'financeiro' && (activeSubTab === 'turno_atual' || activeSubTab === 'fluxo') && (
            <CaixaTurnoAtualTab
              turnoResumo={turnoResumo}
              isLoading={isLoading}
              onRefresh={fetchTurnoResumo}
              onNavigateToFechamento={() => setActiveSubTab('fechamento')}
              onOpenNovoTurnoModal={() => setShowAbrirModal(true)}
            />
          )}

          {activeTab === 'financeiro' && (activeSubTab === 'movimentacoes' || activeSubTab === 'ajustes' || activeSubTab === 'suprimento' || activeSubTab === 'sangria') && (
            <CaixaMovimentacoesTab
              movimentacoes={caixaMovimentacoes}
              isLoading={isLoading}
              onOpenSangriaModal={() => setShowSangriaModal(true)}
              onOpenSuprimentoModal={() => setShowSuprimentoModal(true)}
              onRefresh={fetchCaixaMovimentacoes}
            />
          )}

          {activeTab === 'financeiro' && (activeSubTab === 'fechamento' || activeSubTab === 'conferencia') && (
            <CaixaFechamentoTab
              isTurnoAberto={turnoResumo?.status === 'aberto'}
              fechamentoResult={fechamentoResult}
              onConfirmFechamento={handleConfirmarFechamento}
              onOpenNovoTurnoModal={() => setShowAbrirModal(true)}
            />
          )}

          {/* PAINEL FISCAL NFC-e (dados estáticos de exemplo — implementação futura) */}
          {activeTab === 'financeiro' && activeSubTab === 'fiscal' && (
            <div className={clsx('space-y-5', 'text-left', 'animate-fade-in')}>
              <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-4.5', 'rounded-3xl', 'space-y-2')}>
                <h3 className={clsx('font-serif', 'font-bold', 'text-base', 'text-white')}>Notas Fiscais de Consumidor (NFC-e)</h3>
                <p className={clsx('text-[10px]', 'text-gray-400', 'leading-relaxed')}>
                  Acompanhe e retransmita notas fiscais rejeitadas ou em contingência para a SEFAZ.
                </p>
              </div>

              <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'overflow-hidden')}>
                <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                  <thead>
                    <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                      <th className="p-3.5">Mesa / Ref</th>
                      <th className="p-3.5">Data Emissão</th>
                      <th className={clsx('p-3.5', 'font-mono')}>Valor Comanda</th>
                      <th className="p-3.5">Chave de Acesso SEFAZ</th>
                      <th className={clsx('p-3.5', 'text-right')}>Status</th>
                    </tr>
                  </thead>
                  <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                    {[
                      { ref: "Mesa 12", data: "01/07/2026 22:30", valor: 145.00, chave: "3526 0712 3456 7800 0199 6500 1000 0019 2314 5678", status: "Autorizada" },
                      { ref: "Mesa 05", data: "01/07/2026 21:15", valor: 89.90, chave: "3526 0712 3456 7800 0199 6500 1000 0018 5514 5678", status: "Autorizada" }
                    ].map((f, idx) => (
                      <tr key={idx} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                        <td className={clsx('p-3.5', 'font-bold', 'text-white')}>{f.ref}</td>
                        <td className={clsx('p-3.5', 'text-gray-400')}>{f.data}</td>
                        <td className={clsx('p-3.5', 'font-mono', 'text-emerald-400')}>R$ {f.valor.toFixed(2)}</td>
                        <td className={clsx('p-3.5', 'font-mono', 'text-gray-500', 'tracking-wider', 'text-[8px]')}>{f.chave}</td>
                        <td className={clsx('p-3.5', 'text-right')}>
                          <span className={clsx('px-2', 'py-0.5', 'rounded-full', 'text-[8px]', 'font-bold', 'uppercase', 'bg-emerald-500/10', 'text-emerald-500', 'border', 'border-emerald-500/20')}>
                            {f.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CRM CLIENTES — REAL DATA */}
          {activeTab === 'clientes' && ['clientes', 'crm', 'banco_clientes', 'fidelidade', 'programa_fidelidade'].includes(activeSubTab) && (
            <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'text-left', 'animate-fade-in', 'max-w-3xl')}>
              <div className="flex justify-between items-center border-b border-[#27272A] pb-2">
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>CRM — Cadastro de Clientes</span>
                <button
                  type="button"
                  onClick={() => {
                    setNewCrmNome('');
                    setNewCrmTelefone('');
                    setNewCrmSaldo('0');
                    setShowNewCrmModal(true);
                  }}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm"
                >
                  + Novo Cliente
                </button>
              </div>
              <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                  <thead>
                    <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                      <th className="p-3.5">WhatsApp</th>
                      <th className="p-3.5">Nome</th>
                      <th className={clsx('p-3.5', 'font-mono')}>Saldo</th>
                      <th className={clsx('p-3.5', 'text-right')}>Ações</th>
                    </tr>
                  </thead>
                  <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                    {loyaltyUsers.map((user) => (
                      <tr key={user.id} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                        <td className={clsx('p-3.5', 'font-mono', 'text-gray-300')}>{formatarTelefoneTabela(user.telefone)}</td>
                        <td className={clsx('p-3.5', 'font-bold', 'text-white')}>{user.cliente}</td>
                        <td className={clsx('p-3.5', 'font-mono', 'text-emerald-400')}>
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
                            className="px-2.5 py-1 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800 text-gray-300 hover:text-white rounded-lg transition-all cursor-pointer font-bold"
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {loyaltyUsers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-gray-500">
                          Nenhum cliente cadastrado. O primeiro cadastro feito aqui, no balcão ou no cardápio aparecerá automaticamente.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CHAT CO-PILOTO (demonstração) */}
          {(activeTab === 'assistente_koma' || activeTab === 'robo_ia' || (activeTab === 'operacao' && activeSubTab === 'chat_copiloto')) && ['chat', 'chat_copiloto'].includes(activeSubTab) && (
            <div className={clsx('h-[calc(82vh-100px)]', 'flex', 'gap-4', 'text-left', 'animate-fade-in')}>
              {/* Left Column: Contatos */}
              <div className={clsx('w-1/4', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-3xl', 'flex', 'flex-col', 'overflow-hidden')}>
                <div className={clsx('p-4', 'border-b', 'border-[#27272A]', 'space-y-3')}>
                  <div className={clsx('flex', 'justify-between', 'items-center')}>
                    <span className={clsx('font-serif', 'font-bold', 'text-xs', 'text-white')}>Conversas WhatsApp</span>
                    <span className={clsx('bg-[#10b981]/15', 'text-[#10b981]', 'text-[8px]', 'font-bold', 'px-1.5', 'py-0.5', 'rounded-full')}>3 Ativos</span>
                  </div>
                  {/* Global Toggle */}
                  <div className={clsx('bg-[#1C1C1F]', 'border', 'border-[#27272A]/60', 'rounded-xl', 'p-2.5', 'flex', 'justify-between', 'items-center')}>
                    <div className="space-y-0.5">
                      <span className={clsx('text-[9px]', 'font-bold', 'text-white', 'block')}>Piloto Automático</span>
                      <span className={clsx('text-[7px]', 'text-gray-500', 'block')}>IA responde sem intervenção</span>
                    </div>
                    <button
                      onClick={() => setIaPilotMode(iaPilotMode === 'copilot' ? 'autopilot' : 'copilot')}
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none cursor-pointer ${iaPilotMode === 'autopilot' ? 'bg-[#10b981]' : 'bg-[#27272A]'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-[#121214] shadow-md transform duration-200 ${iaPilotMode === 'autopilot' ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>

                <div className={clsx('flex-1', 'overflow-y-auto', 'p-2.5', 'space-y-1.5')}>
                  {copilotContacts.map(contact => (
                    <button
                      key={contact.id}
                      onClick={() => setActiveChatContactId(contact.id)}
                      className={`w-full p-3 rounded-2xl border text-left transition-all flex flex-col gap-1.5 cursor-pointer relative ${activeChatContactId === contact.id
                        ? 'bg-[#10b981]/10 border-[#10b981]/30 text-white'
                        : 'bg-[#1C1C1F]/40 border-transparent hover:bg-[#1C1C1F]/80 text-gray-400'
                        }`}
                    >
                      <div className={clsx('flex', 'justify-between', 'items-center')}>
                        <span className={clsx('text-[10px]', 'font-bold', 'text-white', 'block')}>{contact.name}</span>
                        <span className={clsx('text-[8px]', 'text-gray-500')}>{contact.time}</span>
                      </div>
                      <span className={clsx('text-[8px]', 'truncate', 'leading-relaxed', 'block')}>{contact.lastMsg}</span>
                      <div className={clsx('flex', 'justify-between', 'items-center', 'pt-1')}>
                        <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-full ${contact.iaStatus === 'Aguardando Co-Piloto' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' :
                          contact.iaStatus === 'Piloto Automático' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                            'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                          }`}>
                          {contact.iaStatus}
                        </span>
                        {contact.pendingAction && (
                          <span className={clsx('h-2', 'w-2', 'rounded-full', 'bg-amber-500', 'animate-pulse')} />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Center Column: Janela de Chat */}
              <div className={clsx('flex-1', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-3xl', 'flex', 'flex-col', 'overflow-hidden', 'relative')}>
                {/* Active Contact Header */}
                {(() => {
                  const contact = copilotContacts.find(c => c.id === activeChatContactId);
                  if (!contact) return null;
                  return (
                    <div className={clsx('p-4', 'border-b', 'border-[#27272A]', 'bg-[#1C1C1F]/50', 'flex', 'justify-between', 'items-center')}>
                      <div>
                        <span className={clsx('text-[11px]', 'font-bold', 'text-white', 'block')}>{contact.name}</span>
                        <span className={clsx('text-[8px]', 'text-gray-400', 'block')}>{contact.phone} • WhatsApp</span>
                      </div>
                      <div className={clsx('flex', 'items-center', 'gap-2')}>
                        <button
                          onClick={() => {
                            setCopilotContacts(prev => prev.map(c => c.id === activeChatContactId ? { ...c, iaStatus: "Atendimento Humano", pendingAction: false } : c));
                            alert('A IA foi pausada. Modo de intervenção manual ativo.');
                          }}
                          className={clsx('px-2.5', 'py-1', 'bg-emerald-600', 'hover:bg-[#8d2a3a]', 'text-white', 'rounded-lg', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                        >
                          ⚠️ Assumir Atendimento
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Conversation area */}
                <div className={clsx('flex-1', 'overflow-y-auto', 'p-4', 'space-y-4')}>
                  {copilotMessages.filter(m => m.contactId === activeChatContactId).map((msg, index) => (
                    <div key={index} className={`flex ${msg.sender === 'cliente' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[70%] rounded-2xl p-3 text-[10px] space-y-1.5 ${msg.sender === 'cliente'
                        ? 'bg-[#1C1C1F] text-white border border-[#27272A]'
                        : 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/10'
                        }`}>
                        <div className={clsx('flex', 'justify-between', 'gap-4', 'text-gray-400', 'text-[8px]')}>
                          <span className={clsx('font-bold', 'uppercase')}>{msg.sender === 'cliente' ? 'Cliente' : msg.sender === 'ia' ? 'IA Co-Piloto' : 'Atendente'}</span>
                          <span>{msg.time}</span>
                        </div>
                        {msg.isAudio ? (
                          <div className="space-y-2">
                            <div className={clsx('flex', 'items-center', 'gap-2', 'bg-[#121214]', 'p-2', 'rounded-xl', 'border', 'border-[#27272A]')}>
                              <button className={clsx('h-6', 'w-6', 'bg-[#10b981]', 'text-[#121214]', 'rounded-full', 'flex', 'items-center', 'justify-center', 'cursor-pointer')}>▶</button>
                              <div className={clsx('flex', 'gap-0.5', 'items-center', 'flex-1', 'h-3')}>
                                {[3, 6, 4, 8, 12, 6, 4, 9, 14, 10, 7, 5, 8, 3, 2, 6, 9, 11, 8, 4].map((h, i) => (
                                  <div key={i} className={clsx('bg-sky-400', 'flex-1', 'rounded-sm')} style={{ height: `${h * 7}%` }} />
                                ))}
                              </div>
                            </div>
                            <div className={clsx('bg-sky-500/10', 'border', 'border-sky-500/20', 'p-2.5', 'rounded-xl', 'space-y-1')}>
                              <span className={clsx('bg-sky-400', 'text-[#121214]', 'text-[7px]', 'font-bold', 'px-1.5', 'py-0.5', 'rounded-full', 'uppercase', 'tracking-wider')}>IA Transcrição</span>
                              <p className={clsx('text-sky-100', 'leading-relaxed', 'font-serif', 'text-[9px]', 'italic')}>"{msg.audioText}"</p>
                            </div>
                          </div>
                        ) : (
                          <p className={clsx('leading-relaxed', 'whitespace-pre-wrap')}>{msg.text}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Send raw message */}
                <div className={clsx('p-4', 'border-t', 'border-[#27272A]', 'bg-[#1C1C1F]/30', 'flex', 'gap-2')}>
                  <input
                    type="text"
                    placeholder="Escreva uma mensagem de intervenção humana..."
                    className={clsx('flex-1', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
                  <button className={clsx('px-4', 'py-2', 'bg-[#10b981]', 'text-[#121214]', 'font-bold', 'rounded-xl', 'text-[9px]', 'uppercase', 'tracking-wider', 'cursor-pointer')}>Enviar</button>
                </div>
              </div>

              {/* Right Column: Painel Co-Piloto */}
              <div className={clsx('w-1/4', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-4', 'flex', 'flex-col', 'justify-between', 'overflow-y-auto')}>
                <div className="space-y-4">
                  <div className={clsx('border-b', 'border-[#27272A]', 'pb-2')}>
                    <span className={clsx('font-serif', 'font-bold', 'text-xs', 'text-white', 'block')}>Ações do Co-Piloto</span>
                    <span className={clsx('text-[8px]', 'text-gray-500', 'block', 'leading-relaxed')}>Revise e edite a resposta e os itens antes de enviar ao cliente.</span>
                  </div>

                  {/* Resposta Sugerida */}
                  <div className="space-y-1.5">
                    <label className={clsx('text-[8px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-widest', 'block')}>Resposta Sugerida pela IA:</label>
                    <textarea
                      value={copilotDraftResponses[activeChatContactId] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCopilotDraftResponses(prev => ({ ...prev, [activeChatContactId]: val }));
                      }}
                      rows={4}
                      className={clsx('w-full', 'p-2.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[9px]', 'leading-relaxed', 'resize-none', 'focus:outline-none', 'focus:border-[#10b981]')}
                    />
                  </div>

                  {/* Carrinho Rascunhado */}
                  <div className="space-y-2">
                    <label className={clsx('text-[8px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-widest', 'block')}>Carrinho Rascunhado (IA):</label>
                    {copilotDraftCarts[activeChatContactId] && copilotDraftCarts[activeChatContactId].length > 0 ? (
                      <div className={clsx('bg-[#1C1C1F]', 'border', 'border-[#27272A]/80', 'rounded-2xl', 'p-3', 'space-y-2')}>
                        {copilotDraftCarts[activeChatContactId].map((item, idx) => (
                          <div key={idx} className={clsx('flex', 'justify-between', 'items-center', 'border-b', 'border-[#27272A]/40', 'pb-1.5', 'last:border-b-0', 'last:pb-0', 'text-[9px]')}>
                            <div>
                              <strong className={clsx('text-white', 'block', 'font-bold')}>{item.product.nome}</strong>
                              <span className={clsx('text-[8px]', 'text-gray-400', 'block')}>{item.quantity}x • R$ {item.product.preco.toFixed(2)}</span>
                            </div>
                            <span className={clsx('font-bold', 'font-mono', 'text-[#10b981]')}>R$ {(item.product.preco * item.quantity).toFixed(2)}</span>
                          </div>
                        ))}
                        <div className={clsx('pt-1.5', 'border-t', 'border-[#27272A]', 'flex', 'justify-between', 'items-center', 'text-[10px]')}>
                          <strong className={clsx('text-white', 'font-serif')}>Subtotal Rascunho</strong>
                          <strong className={clsx('text-emerald-400', 'font-mono', 'font-bold')}>
                            R$ {copilotDraftCarts[activeChatContactId].reduce((acc, c) => acc + (c.product.preco * c.quantity), 0).toFixed(2)}
                          </strong>
                        </div>
                      </div>
                    ) : (
                      <div className={clsx('text-center', 'p-4', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]/60', 'rounded-2xl')}>
                        <span className={clsx('text-[9px]', 'text-gray-500', 'italic', 'block')}>Nenhum carrinho detectado neste chat.</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className={clsx('pt-4', 'border-t', 'border-[#27272A]', 'space-y-2')}>
                  <button
                    disabled={!copilotDraftResponses[activeChatContactId]}
                    onClick={() => {
                      // Process approval
                      const contact = copilotContacts.find(c => c.id === activeChatContactId);
                      if (!contact) return;

                      // 1. Add suggested response to messages history
                      setCopilotMessages(prev => [
                        ...prev,
                        { id: Date.now(), contactId: activeChatContactId, sender: 'ia', text: copilotDraftResponses[activeChatContactId], time: "10:33" }
                      ]);
                      // 2. Generate delivery order from Co-pilot draft
                      const draft = copilotDraftCarts[activeChatContactId];
                      if (draft && draft.length > 0) {
                        const newOrd: SimulatedDeliveryOrder = {
                          id: `d-${Date.now().toString().slice(-3)}`,
                          cliente: contact.name,
                          telefone: contact.phone,
                          itens: draft.map(d => `${d.quantity}x ${d.product.nome}`).join(" + "),
                          total: draft.reduce((acc, c) => acc + (c.product.preco * c.quantity), 0),
                          canal: 'whats',
                          modalidade: 'delivery',
                          pago: false,
                          status: 'analise',
                          endereco: "Av. Conselheiro Aguiar, 2300, Apto 502 - Boa Viagem",
                          criadoEm: "10:33"
                        };
                        setSimulatedOrders(prev => [newOrd, ...prev]);
                        alert(`Carrinho de Bruno Santos aprovado! Um novo pedido ${newOrd.id} foi gerado no painel e a resposta foi enviada ao WhatsApp.`);
                      } else {
                        alert('Resposta enviada ao cliente.');
                      }

                      // 3. Update contact status to responded / clear pending
                      setCopilotContacts(prev => prev.map(c => c.id === activeChatContactId ? { ...c, iaStatus: "Resposta Enviada", pendingAction: false } : c));
                    }}
                    className={clsx('w-full', 'py-2.5', 'bg-emerald-600', 'hover:bg-emerald-700', 'disabled:opacity-50', 'text-white', 'font-bold', 'rounded-xl', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer', 'shadow-lg')}
                  >
                    Aprovar e Enviar (WhatsApp)
                  </button>
                  <button
                    onClick={() => {
                      setCopilotDraftCarts(prev => ({ ...prev, [activeChatContactId]: [] }));
                      setCopilotDraftResponses(prev => ({ ...prev, [activeChatContactId]: "" }));
                      setCopilotContacts(prev => prev.map(c => c.id === activeChatContactId ? { ...c, pendingAction: false, iaStatus: "Rascunho Limpo" } : c));
                    }}
                    className={clsx('w-full', 'py-1.5', 'bg-[#1C1C1F]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'text-gray-400', 'hover:text-white', 'rounded-xl', 'text-[8px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                  >
                    Limpar Rascunhos
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: FRETISTAS & LOGÍSTICA */}
          {activeSubTab === 'entregadores' && (
            <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5', 'animate-fade-in', 'text-left')}>

              {/* Painel de Entregas (Colunas da Esquerda) */}
              <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-5', 'flex', 'flex-col', 'overflow-hidden')}>
                <div className={clsx('border-b', 'border-[#27272A]', 'pb-3', 'shrink-0')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'text-sm')}>Controle de Despacho e Entregas</span>
                  <span className={clsx('text-[9px]', 'text-gray-500', 'block')}>Gerencie o fluxo de saída e entrega de pedidos de Delivery.</span>
                </div>

                {/* Pedidos Pendentes de Envio */}
                <div className={clsx('space-y-3', 'flex-1', 'overflow-y-auto')}>
                  <span className={clsx('text-[10px]', 'font-bold', 'text-[#10b981]', 'uppercase', 'tracking-wider', 'block')}>Pedidos para Despachar</span>

                  {simulatedOrders.filter(o => o.status === 'producao' || o.status === 'analise').length === 0 ? (
                    <div className={clsx('py-8', 'text-center', 'text-gray-500', 'text-xs', 'italic', 'bg-[#1C1C1F]/20', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                      Não há pedidos prontos ou em produção aguardando despacho no momento.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {simulatedOrders.filter(o => o.status === 'producao' || o.status === 'analise').map((order) => {
                        const motoboyId = selectedMotoboys[order.id] || '';
                        return (
                          <div key={order.id} className={clsx('p-4', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-2xl', 'flex', 'flex-col', 'sm:flex-row', 'justify-between', 'gap-3', 'text-xs')}>
                            <div className={clsx('space-y-1.5', 'flex-1')}>
                              <div className={clsx('flex', 'items-center', 'gap-2')}>
                                <span className={clsx('font-bold', 'text-white', 'text-[11px]')}>Pedido {order.id}</span>
                                <span className={clsx('bg-[#10b981]/15', 'text-[#10b981]', 'text-[8px]', 'font-bold', 'px-1.5', 'py-0.5', 'rounded', 'border', 'border-[#10b981]/20', 'uppercase')}>
                                  {order.canal}
                                </span>
                              </div>
                              <span className={clsx('text-gray-300', 'font-bold', 'block')}>{order.cliente} • {order.telefone}</span>
                              <span className={clsx('text-gray-400', 'text-[10px]', 'block', 'leading-relaxed')}>{order.endereco}</span>
                              <span className={clsx('text-[9px]', 'text-gray-500', 'block', 'font-mono')}>Itens: {order.itens}</span>
                            </div>

                            <div className={clsx('flex', 'flex-col', 'sm:items-end', 'justify-between', 'gap-2', 'shrink-0')}>
                              <span className={clsx('font-mono', 'font-bold', 'text-emerald-400', 'text-[11px]')}>R$ {order.total.toFixed(2)}</span>

                              <div className={clsx('flex', 'items-center', 'gap-2')}>
                                <select
                                  value={motoboyId}
                                  onChange={(e) => setSelectedMotoboys(prev => ({ ...prev, [order.id]: e.target.value }))}
                                  className={clsx('py-1.5', 'px-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'text-white', 'rounded-xl', 'text-[10px]', 'focus:outline-none', 'focus:border-[#10b981]')}
                                >
                                  <option value="">Selecione o Entregador...</option>
                                  {motoboys.filter(m => m.ativo).map(m => (
                                    <option key={m.id} value={m.id}>{m.nome}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={!motoboyId}
                                  onClick={() => handleDespacharPedido(order.id, parseInt(motoboyId))}
                                  className={clsx('py-1.5', 'px-3', 'bg-emerald-600', 'hover:bg-emerald-500', 'disabled:opacity-50', 'text-white', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                                >
                                  Despachar
                                </button>
                                <button
                                  type="button"
                                  disabled={!motoboyId}
                                  onClick={() => handleDespacharWhatsApp(order, motoboyId)}
                                  className={clsx('py-1.5', 'px-2.5', 'bg-[#10b981]/20', 'hover:bg-[#10b981]/30', 'border', 'border-[#10b981]/40', 'disabled:opacity-40', 'text-emerald-300', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer', 'flex', 'items-center', 'gap-1')}
                                  title="Despachar pedido e enviar link PWA pelo WhatsApp do Motoboy"
                                >
                                  💬 WhatsApp
                                </button>
                                <button
                                  type="button"
                                  disabled={!motoboyId}
                                  onClick={() => handleRevogarAcessoMotoboy(motoboyId)}
                                  className={clsx('py-1.5', 'px-2.5', 'bg-rose-500/20', 'hover:bg-rose-500/30', 'border', 'border-rose-500/40', 'disabled:opacity-40', 'text-rose-300', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer', 'flex', 'items-center', 'gap-1')}
                                  title="Revogar todos os links ativos do entregador selecionado"
                                >
                                  🚫 Revogar
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Pedidos Em Trânsito */}
                  <span className={clsx('text-[10px]', 'font-bold', 'text-[#10b981]', 'uppercase', 'tracking-wider', 'block', 'pt-4')}>Em Trânsito (Entregas Ativas)</span>

                  {simulatedOrders.filter(o => o.status === 'pronto').length === 0 ? (
                    <div className={clsx('py-8', 'text-center', 'text-gray-500', 'text-xs', 'italic', 'bg-[#1C1C1F]/20', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                      Nenhum pedido em trânsito no momento.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {simulatedOrders.filter(o => o.status === 'pronto').map((order) => {
                        return (
                          <div key={order.id} className={clsx('p-4', 'bg-[#1C1C1F]/40', 'border', 'border-[#27272A]/40', 'rounded-2xl', 'flex', 'flex-col', 'sm:flex-row', 'justify-between', 'gap-3', 'text-xs')}>
                            <div className={clsx('space-y-1', 'flex-1')}>
                              <div className={clsx('flex', 'items-center', 'gap-2')}>
                                <span className={clsx('font-bold', 'text-white', 'text-[11px]')}>Pedido {order.id}</span>
                                <span className={clsx('bg-emerald-500/10', 'text-emerald-400', 'text-[8px]', 'font-bold', 'px-1.5', 'py-0.5', 'rounded', 'border', 'border-emerald-500/20', 'uppercase', 'tracking-wider')}>
                                  Em Trânsito
                                </span>
                              </div>
                              <span className={clsx('text-gray-300', 'font-bold', 'block')}>{order.cliente} • {order.telefone}</span>
                              <span className={clsx('text-gray-400', 'text-[10px]', 'block', 'leading-relaxed')}>{order.endereco}</span>
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
              <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'flex', 'flex-col', 'justify-between', 'overflow-hidden')}>
                <div className={clsx('space-y-4', 'flex-1', 'flex', 'flex-col', 'overflow-hidden')}>
                  <div className={clsx('border-b', 'border-[#27272A]', 'pb-3', 'shrink-0')}>
                    <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'text-sm')}>Fretistas Cadastrados</span>
                    <span className={clsx('text-[9px]', 'text-gray-500', 'block')}>Lista de motoboys e entregadores de plantão.</span>
                  </div>

                  <div className={clsx('flex-1', 'overflow-y-auto', 'space-y-2.5')}>
                    {motoboys.length === 0 ? (
                      <span className={clsx('text-xs', 'text-gray-500', 'italic')}>Nenhum fretista cadastrado.</span>
                    ) : (
                      motoboys.map((m) => (
                        <div key={m.id} className={clsx('p-3', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-xl', 'flex', 'items-center', 'justify-between', 'gap-2')}>
                          <div className="text-xs">
                            <span className={clsx('font-bold', 'text-white', 'block')}>{m.nome}</span>
                            <span className={clsx('text-[10px]', 'text-gray-400', 'block', 'font-mono')}>{m.telefone}</span>
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
                <form onSubmit={handleCadastrarMotoboy} className={clsx('pt-4', 'border-t', 'border-[#27272A]', 'space-y-3', 'shrink-0')}>
                  <span className={clsx('text-[10px]', 'font-bold', 'text-[#10b981]', 'uppercase', 'tracking-wider', 'block')}>Novo Fretista</span>

                  <input
                    type="text"
                    required
                    placeholder="Nome do Entregador"
                    value={novoMotoboyNome}
                    onChange={(e) => setNewMotoboyNome(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
                  <input
                    type="text"
                    required
                    placeholder="Telefone (ex: 81 99999-8888)"
                    value={novoMotoboyTelefone}
                    onChange={(e) => setNewMotoboyTelefone(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'font-mono', 'focus:outline-none', 'focus:border-[#10b981]')}
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
            <div className="bg-[#121214] border border-amber-500/20 rounded-3xl p-8 text-center max-w-xl mx-auto space-y-3">
              <Lock size={24} className="text-amber-400 mx-auto" />
              <h3 className="text-white font-bold">Cardápio online não incluído neste plano</h3>
              <p className="text-[10px] text-gray-400">
                No Kôma Pro, ele pode ser contratado por R$ {ONLINE_MENU_ADDON.price}/mês. No Kôma Premium, link, QR Code e gaveta de aceite já estão incluídos.
              </p>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('assinatura_pix');
                  setActiveSubTab('planos');
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase cursor-pointer"
              >
                Ver opções
              </button>
            </div>
          )}

          {(activeTab === 'cardapio_digital' || activeSubTab === 'cardapio_digital') && hasOnlineMenu && (
            <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-6', 'text-left', 'max-w-2xl', 'mx-auto', 'space-y-6', 'animate-fade-in')}>
              <div className={clsx('border-b', 'border-[#27272A]', 'pb-3')}>
                <span className={clsx('font-serif', 'font-bold', 'text-base', 'text-white', 'block')}>Configurações do Cardápio Digital</span>
                <span className={clsx('text-[10px]', 'text-gray-400', 'block', 'mt-1')}>Personalize a identidade visual e comportamento do cardápio digital do cliente (Whitelabel).</span>
              </div>

              <div className="space-y-4">
                {/* Status Override */}
                <div className="space-y-1.5">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Status de Funcionamento:</label>
                  <select
                    value={cardapioStatusOverride}
                    onChange={(e) => setCardapioStatusOverride(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
                  >
                    <option value="Automático">Automático (Segue horários de funcionamento)</option>
                    <option value="Forçado Aberto">Forçado Aberto (Sempre aberto para pedidos)</option>
                    <option value="Forçado Fechado">Forçado Fechado (Sempre fechado/indisponível)</option>
                  </select>
                </div>

                {/* Cores */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Cor Primária (Tema):</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={cardapioCorPrimaria}
                        onChange={(e) => setCardapioCorPrimaria(e.target.value)}
                        className="w-10 h-10 p-0 border border-[#27272A] rounded-xl bg-transparent cursor-pointer"
                      />
                      <input
                        type="text"
                        value={cardapioCorPrimaria}
                        onChange={(e) => setCardapioCorPrimaria(e.target.value)}
                        className={clsx('flex-1', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'font-mono')}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Cor de Fundo:</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={cardapioCorFundo}
                        onChange={(e) => setCardapioCorFundo(e.target.value)}
                        className="w-10 h-10 p-0 border border-[#27272A] rounded-xl bg-transparent cursor-pointer"
                      />
                      <input
                        type="text"
                        value={cardapioCorFundo}
                        onChange={(e) => setCardapioCorFundo(e.target.value)}
                        className={clsx('flex-1', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'font-mono')}
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
                  <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Sobre Nós:</label>
                  <textarea
                    value={cardapioSobreNos}
                    onChange={(e) => setCardapioSobreNos(e.target.value)}
                    rows={3}
                    placeholder="Breve história ou descrição do restaurante..."
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
                </div>

                {/* Endereço */}
                <div className="space-y-1.5">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Endereço Físico:</label>
                  <input
                    type="text"
                    value={cardapioEndereco}
                    onChange={(e) => setCardapioEndereco(e.target.value)}
                    placeholder="Rua Exemplo, 123 - Centro"
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
                </div>
              </div>

              {/* Botão de salvar */}
              <div className={clsx('pt-4', 'border-t', 'border-[#27272A]', 'flex', 'justify-end')}>
                <button
                  type="button"
                  disabled={isSavingCardapioConfig}
                  onClick={saveCardapioConfig}
                  className={clsx('px-5', 'py-2.5', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-xl', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer', 'shadow-lg', 'disabled:opacity-50')}
                >
                  {isSavingCardapioConfig ? 'Salvando...' : 'Salvar Configurações Whitelabel'}
                </button>
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
            <form onSubmit={handleAbrirCaixa} className={clsx('bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-3xl', 'w-full', 'max-w-sm', 'p-6', 'space-y-5', 'shadow-2xl', 'animate-scale-in')}>
              <div className={clsx('flex', 'justify-between', 'items-center', 'border-b', 'border-[#27272A]', 'pb-3')}>
                <h3 className={clsx('font-serif', 'font-bold', 'text-lg', 'text-white')}>Abertura de Caixa</h3>
                <button type="button" onClick={() => setShowAbrirModal(false)} className={clsx('p-1', 'hover:bg-[#27272A]', 'rounded-full', 'text-gray-400', 'hover:text-white', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}><X size={16} /></button>
              </div>

              <div className="space-y-1.5">
                <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Fundo de Troco Inicial (R$):</label>
                <div className="relative">
                  <span className={clsx('absolute', 'left-3.5', 'top-3', 'text-gray-400', 'font-mono')}>R$</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={saldoInicial}
                    onChange={(e) => setSaldoInicial(e.target.value)}
                    className={clsx('w-full', 'pl-9', 'pr-4', 'py-2.5', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:ring-2', 'focus:ring-[#10b981]/20', 'focus:border-[#10b981]', 'text-white', 'font-mono')}
                  />
                </div>
              </div>

              {errorMsg && (
                <div className={clsx('bg-rose-500/10', 'border', 'border-rose-500/25', 'text-rose-400', 'p-2.5', 'rounded-xl', 'text-center', 'font-medium', 'block')}>
                  {errorMsg}
                </div>
              )}

              <div className={clsx('flex', 'gap-2.5')}>
                <button type="button" onClick={() => setShowAbrirModal(false)} className={clsx('flex-1', 'py-2.5', 'bg-[#121214]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'text-white', 'rounded-xl', 'transition-all', 'cursor-pointer', 'font-bold')}>Cancelar</button>
                <button type="submit" className={clsx('flex-1', 'py-2.5', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded-xl', 'transition-all', 'cursor-pointer', 'font-bold', 'shadow-md')}>Confirmar Abertura</button>
              </div>
            </form>
          </div>
        )
      }

      {/* 2. MODAL: FECHAR CAIXA */}
      {
        showFecharModal && (
          <div
            onClick={(e) => { if (e.target === e.currentTarget) setShowFecharModal(false); }}
            className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'cursor-pointer')}
          >
            <form onSubmit={handleFecharCaixa} className={clsx('bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-3xl', 'w-full', 'max-w-md', 'p-6', 'space-y-5', 'shadow-2xl', 'animate-scale-in')}>
              <div className={clsx('flex', 'justify-between', 'items-center', 'border-b', 'border-[#27272A]', 'pb-3')}>
                <h3 className={clsx('font-serif', 'font-bold', 'text-lg', 'text-white')}>Fechamento do Caixa</h3>
                <button type="button" onClick={() => setShowFecharModal(false)} className={clsx('p-1', 'hover:bg-[#27272A]', 'rounded-full', 'text-gray-400', 'hover:text-white', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}><X size={16} /></button>
              </div>

              <p className={clsx('text-[11px]', 'text-gray-400', 'leading-relaxed', 'bg-[#121214]', 'p-3', 'rounded-xl', 'border', 'border-[#27272A]')}>
                Insira os valores contados fisicamente na gaveta de dinheiro e confira as maquininhas de cartão/pix antes de fechar o turno.
              </p>

              <div className={clsx('space-y-4', 'font-sans', 'text-xs')}>
                <div className={clsx('grid', 'grid-cols-3', 'gap-2', 'text-[10px]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold', 'border-b', 'border-[#27272A]', 'pb-1.5')}>
                  <span>Método</span>
                  <span className="text-right">Esperado</span>
                  <span className="text-right">Declarado</span>
                </div>

                <div className={clsx('grid', 'grid-cols-3', 'items-center', 'gap-2', 'font-mono')}>
                  <span className={clsx('font-sans', 'text-gray-300')}>Dinheiro</span>
                  <span className={clsx('text-right', 'text-gray-400')}>R$ {turno?.total_esperado_dinheiro?.toFixed(2)}</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={decDinheiro}
                    onChange={(e) => setDecDinheiro(e.target.value)}
                    className={clsx('text-right', 'py-1.5', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white')}
                  />
                </div>

                <div className={clsx('grid', 'grid-cols-3', 'items-center', 'gap-2', 'font-mono')}>
                  <span className={clsx('font-sans', 'text-gray-300', 'font-medium')}>Pix</span>
                  <span className={clsx('text-right', 'text-gray-400')}>R$ {turno?.total_esperado_pix?.toFixed(2)}</span>
                  <span className={clsx('text-right', 'text-emerald-400', 'text-[10px]', 'font-sans', 'font-bold', 'uppercase', 'tracking-wide')}>Conciliado</span>
                </div>

                <div className={clsx('grid', 'grid-cols-3', 'items-center', 'gap-2', 'font-mono')}>
                  <span className={clsx('font-sans', 'text-gray-300', 'font-medium')}>Cartão</span>
                  <span className={clsx('text-right', 'text-gray-400')}>R$ {turno?.total_esperado_cartao?.toFixed(2)}</span>
                  <span className={clsx('text-right', 'text-emerald-400', 'text-[10px]', 'font-sans', 'font-bold', 'uppercase', 'tracking-wide')}>Conciliado</span>
                </div>
              </div>

              {errorMsg && (
                <div className={clsx('bg-rose-500/10', 'border', 'border-rose-500/25', 'text-rose-400', 'p-2.5', 'rounded-xl', 'text-center', 'font-medium', 'block')}>
                  {errorMsg}
                </div>
              )}

              <div className={clsx('flex', 'gap-2.5', 'pt-2')}>
                <button type="button" onClick={() => setShowFecharModal(false)} className={clsx('flex-1', 'py-2.5', 'bg-[#121214]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'text-white', 'rounded-xl', 'transition-all', 'cursor-pointer', 'font-bold')}>Voltar</button>
                <button
                  type="button"
                  onMouseDown={startHoldConfirm}
                  onMouseUp={cancelHoldConfirm}
                  onMouseLeave={cancelHoldConfirm}
                  onTouchStart={startHoldConfirm}
                  onTouchEnd={cancelHoldConfirm}
                  style={{
                    background: holdProgress > 0
                      ? `linear-gradient(to right, #22C55E ${holdProgress}%, #10b981 ${holdProgress}%)`
                      : '#10b981'
                  }}
                  className={clsx('flex-1', 'py-2.5', 'text-white', 'rounded-xl', 'transition-all', 'cursor-pointer', 'font-bold', 'shadow-md', 'select-none', 'relative', 'overflow-hidden', 'active:scale-95')}
                >
                  {holdProgress > 0 ? `Segurando (${Math.round(holdProgress)}%)` : 'Segurar para Fechar (2s)'}
                </button>
              </div>
            </form>
          </div>
        )
      }

      {/* 3. MODAL: SUPRIMENTO / SANGRIA */}
      {
        showMovModal && (
          <div
            onClick={(e) => { if (e.target === e.currentTarget) setShowMovModal(false); }}
            className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'cursor-pointer')}
          >
            <form onSubmit={handleMovimentar} className={clsx('bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-3xl', 'w-full', 'max-w-sm', 'p-6', 'space-y-5', 'shadow-2xl', 'animate-scale-in')}>
              <div className={clsx('flex', 'justify-between', 'items-center', 'border-b', 'border-[#27272A]', 'pb-3')}>
                <h3 className={clsx('font-serif', 'font-bold', 'text-lg', 'text-white')}>Suprimento / Sangria</h3>
                <button type="button" onClick={() => setShowMovModal(false)} className={clsx('p-1', 'hover:bg-[#27272A]', 'rounded-full', 'text-gray-400', 'hover:text-white', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}><X size={16} /></button>
              </div>

              <div className={clsx('flex', 'gap-2', 'p-1', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'shrink-0')}>
                <button
                  type="button"
                  onClick={() => setMovTipo('suprimento')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${movTipo === 'suprimento'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'text-gray-400 hover:text-white'
                    }`}
                >
                  <ArrowUpRight size={13} />
                  <span>Suprimento (Inserir)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMovTipo('sangria')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${movTipo === 'sangria'
                    ? 'bg-emerald-600 text-white shadow-sm font-bold'
                    : 'text-gray-400 hover:text-white'
                    }`}
                >
                  <ArrowDownRight size={13} />
                  <span>Sangria (Retirar)</span>
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Valor (R$):</label>
                  <div className="relative">
                    <span className={clsx('absolute', 'left-3.5', 'top-3', 'text-gray-400', 'font-mono')}>R$</span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="0.00"
                      value={movValor}
                      onChange={(e) => setMovValor(e.target.value)}
                      className={clsx('w-full', 'pl-9', 'pr-4', 'py-2.5', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:ring-2', 'focus:ring-[#10b981]/20', 'focus:border-[#10b981]', 'text-white', 'font-mono')}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Motivo / Descrição:</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Troco inicial extra, Sangria de segurança..."
                    value={movDesc}
                    onChange={(e) => setMovDesc(e.target.value)}
                    className={clsx('w-full', 'px-4', 'py-2.5', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:ring-2', 'focus:ring-[#10b981]/20', 'focus:border-[#10b981]', 'text-white')}
                  />
                </div>
              </div>

              {errorMsg && (
                <div className={clsx('bg-rose-500/10', 'border', 'border-rose-500/25', 'text-rose-400', 'p-2.5', 'rounded-xl', 'text-center', 'font-medium', 'block')}>
                  {errorMsg}
                </div>
              )}

              <div className={clsx('flex', 'gap-2.5')}>
                <button type="button" onClick={() => setShowMovModal(false)} className={clsx('flex-1', 'py-2.5', 'bg-[#121214]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'text-white', 'rounded-xl', 'transition-all', 'cursor-pointer', 'font-bold')}>Cancelar</button>
                <button type="submit" className={clsx('flex-1', 'py-2.5', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'transition-all', 'cursor-pointer', 'font-bold', 'shadow-md')}>Salvar Lançamento</button>
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
              className={clsx('bg-[#0D0D10]/95', 'backdrop-blur-xl', 'rounded-3xl', 'border', 'border-[#10b981]/15', 'shadow-2xl', 'w-full', 'max-w-3xl', 'overflow-hidden', 'max-h-[90vh]', 'flex', 'flex-col', 'my-4')}
              onClick={(e) => e.stopPropagation()}
            >

              <div className={clsx('bg-[#18181B]', 'text-white', 'p-5', 'flex', 'justify-between', 'items-center', 'shrink-0', 'border-b', 'border-[#27272A]')}>
                <div>
                  <span className={clsx('text-[10px]', 'font-bold', 'text-[#10b981]', 'uppercase', 'tracking-wider', 'block')}>Checkout / Caixa</span>
                  <h3 className={clsx('font-serif', 'text-lg', 'font-bold', 'text-white')}>
                    {selectedOrder.mesaId > 0 ? `Mesa ${selectedOrder.mesaId}` : `Pedido Balcão`}
                  </h3>
                  {selectedOrder.mesaOrigemId && Number(selectedOrder.mesaOrigemId) !== Number(selectedOrder.mesaId) && (
                    <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 rounded-full">
                      🔗 Mesclado de Mesa {selectedOrder.mesaOrigemId}
                    </span>
                  )}
                  {selectedOrder.mesaTransferidaDe && Number(selectedOrder.mesaTransferidaDe) !== Number(selectedOrder.mesaId) && (
                    <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-300 border border-purple-500/25 rounded-full">
                      🔗 Transferido da Mesa {selectedOrder.mesaTransferidaDe}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowCheckoutModal(false)}
                  className={clsx('p-1.5', 'hover:bg-[#27272A]', 'rounded-full', 'text-gray-400', 'hover:text-white', 'transition-colors', 'cursor-pointer', 'border', 'border-transparent')}
                  title="Fechar (o pedido permanece na fila)"
                >
                  <X size={18} />
                </button>
              </div>

              <div className={clsx('p-5', 'overflow-y-auto', 'flex-1', 'bg-[#18181B]', 'grid', 'grid-cols-1', 'md:grid-cols-2', 'gap-5')}>
                <div className="space-y-4">
                  <div className={clsx('flex', 'items-center', 'justify-between', 'border-b', 'border-[#27272A]', 'pb-1.5')}>
                    <div>
                      <h4 className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Extrato Consumo</h4>
                      <span className="text-[8px] text-gray-500">
                        Marque itens para pagá-los juntos ou deixe tudo desmarcado para receber qualquer valor.
                      </span>
                    </div>
                    {taxaServicoAtiva && (
                      <label className={clsx('flex', 'items-center', 'gap-1.5', 'text-[10px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'cursor-pointer')}>
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
                            setPaymentValor(nextValue.toFixed(2));
                          }}
                          className={clsx('rounded', 'border-[#27272A]', 'text-emerald-500', 'focus:ring-emerald-500', 'h-3.5', 'w-3.5', 'bg-[#121214]')}
                        />
                        <span>Taxa de {serviceTaxRate}%</span>
                      </label>
                    )}
                  </div>

                  <div className={clsx('space-y-2.5', 'max-h-[40vh]', 'overflow-y-auto', 'pr-1')}>
                    {selectedOrder.itens.map((item) => {
                      const isPaid = item.pago;
                      const isCancelled = (item.status as string) === 'cancelado';
                      const canSelect = !isPaid && !isCancelled;
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
                              setPaymentValor(nextValue.toFixed(2));
                              return copy;
                            });
                          }}
                          className={`flex items-start justify-between p-2.5 rounded-xl border border-transparent transition-all text-[11px] ${isCancelled
                            ? 'bg-rose-500/5 border-rose-500/10 text-rose-400 opacity-60'
                            : isPaid
                            ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400'
                            : selectedItemIds.includes(item.id)
                              ? 'bg-[#10b981]/10 border-[#10b981]/30 cursor-pointer shadow-inner'
                              : 'bg-[#121214]/60 border-[#27272A]/50 hover:border-[#27272A] cursor-pointer'
                            }`}
                        >
                          <div className={clsx('flex', 'gap-2', 'items-start', 'flex-1', 'min-w-0')}>
                            {canSelect && (
                              <div className={`mt-0.5 h-3.5 w-3.5 rounded border border-[#27272A] flex items-center justify-center shrink-0 bg-[#121214] ${selectedItemIds.includes(item.id) ? 'border-[#10b981] bg-[#10b981]/10' : ''
                                }`}>
                                {selectedItemIds.includes(item.id) && <Check size={10} className="text-[#10b981]" />}
                              </div>
                            )}
                            <div className={clsx('min-w-0', 'space-y-0.5')}>
                              <span className={clsx('font-semibold', 'text-white', 'block', 'truncate')}>{item.nome}</span>
                              <span className={clsx('text-[9px]', 'text-gray-400', 'block')}>Cliente: {item.clienteNome}</span>
                            </div>
                          </div>

                          <div className={clsx('text-right', 'pl-3', 'shrink-0', 'font-mono')}>
                            <span className={clsx('font-bold', 'text-gray-300')}>R$ {item.preco.toFixed(2)}</span>
                            {isPaid && <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'block', 'font-bold', 'text-emerald-500', 'font-sans', 'mt-0.5')}>Pago</span>}
                            {isCancelled && <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'block', 'font-bold', 'text-rose-500', 'font-sans', 'mt-0.5')}>Cancelado</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(() => {
                    const { subtotal, taxa } = getCheckoutTotals(selectedOrder);
                    return (
                      <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'p-4', 'rounded-2xl', 'font-mono', 'text-[11px]', 'space-y-2')}>
                        <div className={clsx('flex', 'justify-between')}>
                          <span className={clsx('font-sans', 'text-gray-400')}>
                            {isTableCheckoutOrder(selectedOrder) ? 'Consumo da Mesa:' : 'Total Itens em Aberto:'}
                          </span>
                          <span className="text-gray-300">R$ {subtotal.toFixed(2)}</span>
                        </div>
                        {taxaServicoAtiva && checkoutServiceTax && (
                          <div className={clsx('flex', 'justify-between')}>
                            <span className={clsx('font-sans', 'text-gray-400')}>Taxa Serviço ({serviceTaxRate}%):</span>
                            <span className="text-gray-300">R$ {taxa.toFixed(2)}</span>
                          </div>
                        )}
                        {selectedItemIds.length > 0 && (
                          <div className={clsx('flex', 'justify-between', 'text-[#10b981]', 'font-bold', 'border-t', 'border-[#27272A]/40', 'pt-2')}>
                            <span className="font-sans">Total Selecionado:</span>
                            <span>R$ {getSelectedItemsTotal(
                              selectedOrder,
                              selectedItemIds
                            ).toFixed(2)}</span>
                          </div>
                        )}
                        {selectedOrder.valorPago && selectedOrder.valorPago > 0 ? (
                          <div className={clsx('flex', 'justify-between', 'text-emerald-400')}>
                            <span className={clsx('font-sans', 'font-bold')}>Total Pago Parcial:</span>
                            <span className="font-bold">R$ {selectedOrder.valorPago.toFixed(2)}</span>
                          </div>
                        ) : null}
                        <div className={clsx('flex', 'justify-between', 'border-t', 'border-[#27272A]', 'pt-2', 'text-sm', 'text-[#10b981]', 'font-bold')}>
                          <span className="font-sans">Saldo Restante:</span>
                          <span>R$ {getCheckoutBalance(selectedOrder).toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* BOTÕES DE REIMPRESSÃO DO EXTRATO */}
                  <div className={clsx('bg-[#121214]/40', 'border', 'border-[#27272A]/50', 'p-4', 'rounded-2xl', 'space-y-3', 'text-left')}>
                    <span className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Reimpressão de Extrato</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const printHeader = localStorage.getItem("koma_print_header") || "";
                            const printFooter = localStorage.getItem("koma_print_footer") || "";
                            let url = `${apiBaseUrl}/mesas/${selectedOrder.mesaId}/imprimir-recibo?apenas_valores=false`;
                            const params = new URLSearchParams();
                            if (printHeader) params.append("print_header", printHeader);
                            if (printFooter) params.append("print_footer", printFooter);
                            if (params.toString()) url += `&${params.toString()}`;
                            
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
                        className={clsx('flex-1', 'py-2', 'bg-[#1C1C1F]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-[10px]', 'font-bold', 'text-white', 'transition-all', 'cursor-pointer', 'text-center')}
                        title="Imprime a via térmica completa com todos os itens consumidos"
                      >
                        🖨️ Completo
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const printHeader = localStorage.getItem("koma_print_header") || "";
                            const printFooter = localStorage.getItem("koma_print_footer") || "";
                            let url = `${apiBaseUrl}/mesas/${selectedOrder.mesaId}/imprimir-recibo?apenas_valores=true`;
                            const params = new URLSearchParams();
                            if (printHeader) params.append("print_header", printHeader);
                            if (printFooter) params.append("print_footer", printFooter);
                            if (params.toString()) url += `&${params.toString()}`;
                            
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
                        className={clsx('flex-1', 'py-2', 'bg-[#1C1C1F]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-[10px]', 'font-bold', 'text-white', 'transition-all', 'cursor-pointer', 'text-center')}
                        title="Imprime apenas o resumo de subtotais e taxas de serviço para economizar papel"
                      >
                        🖨️ Só Valores
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className={clsx('font-serif', 'font-bold', 'text-gray-300', 'border-b', 'border-[#27272A]', 'pb-1.5')}>Divisão e Recebimento</h4>

                  <div className={clsx('grid', 'grid-cols-2', 'gap-3', 'bg-[#121214]', 'p-3', 'rounded-2xl', 'border', 'border-[#27272A]')}>
                    <div className="space-y-1">
                      <label className={clsx('text-[9px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Pessoas:</label>
                      <input
                        type="number"
                        min="1"
                        value={splitPeople}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSplitPeople(val);
                          setSelectedItemIds([]);
                          const peopleNum = parseInt(val, 10) || 1;
                          setPaymentValor((getCheckoutBalance(selectedOrder) / peopleNum).toFixed(2));
                        }}
                        className={clsx('w-full', 'px-3', 'py-1.5', 'text-xs', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'text-white', 'text-center', 'font-mono')}
                      />
                    </div>
                    <div className={clsx('space-y-1', 'flex', 'flex-col', 'justify-end', 'text-right')}>
                      <span className={clsx('text-[9px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Valor por Pessoa:</span>
                      <span className={clsx('text-sm', 'font-bold', 'text-white', 'font-mono', 'leading-relaxed')}>
                        R$ {(() => {
                          const peopleNum = parseInt(splitPeople, 10) || 1;
                          return (getCheckoutBalance(selectedOrder) / peopleNum).toFixed(2);
                        })()}
                      </span>
                    </div>
                  </div>

                  <form onSubmit={handleProcessPayment} className={clsx('space-y-4', 'bg-[#121214]/40', 'p-4', 'rounded-2xl', 'border', 'border-[#27272A]/50')}>
                    <span className={clsx('text-[10px]', 'font-bold', 'text-[#10b981]', 'uppercase', 'tracking-wider', 'block')}>Receber Pagamento</span>

                    <div className="space-y-1.5">
                      <label className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Método de Baixa:</label>
                      <div className={clsx('flex', 'gap-1.5', 'p-1', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'shrink-0', 'flex-wrap')}>
                        <button
                          type="button"
                          onClick={() => setPaymentMetodo('pix')}
                          className={`flex-1 min-w-[50px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'pix' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                            }`}
                        >
                          Pix
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMetodo('dinheiro')}
                          className={`flex-1 min-w-[60px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'dinheiro' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                            }`}
                        >
                          Dinheiro
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMetodo('cartao_debito')}
                          className={`flex-1 min-w-[70px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'cartao_debito' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                            }`}
                        >
                          C. Débito
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMetodo('cartao_credito')}
                          className={`flex-1 min-w-[70px] py-2 text-[9px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'cartao_credito' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                            }`}
                        >
                          C. Crédito
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 font-sans">
                      <label className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Valor a Lançar (R$):</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <span className={clsx('absolute', 'left-3.5', 'top-2.5', 'text-gray-400', 'font-mono', 'text-[11px]')}>R$</span>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={paymentValor}
                            onChange={(e) => setPaymentValor(e.target.value)}
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
                              'bg-[#121214]',
                              'border',
                              'border-[#27272A]',
                              'rounded-xl',
                              'focus:outline-none',
                              'focus:border-[#10b981]',
                              'text-white',
                              'font-mono',
                              selectedItemIds.length > 0 && 'cursor-not-allowed text-emerald-300'
                            )}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedOrder) {
                              setSelectedItemIds([]);
                              setSplitPeople('1');
                              setPaymentValor(getCheckoutBalance(selectedOrder).toFixed(2));
                            }
                          }}
                          className={clsx(
                            'px-3.5',
                            'py-2',
                            'bg-[#10b981]/15',
                            'hover:bg-[#10b981]/25',
                            'border',
                            'border-[#10b981]/30',
                            'rounded-xl',
                            'text-[10px]',
                            'font-bold',
                            'text-[#10b981]',
                            'transition-all',
                            'cursor-pointer',
                            'whitespace-nowrap'
                          )}
                        >
                          {selectedItemIds.length > 0 ? 'Usar Saldo Total' : 'Pagar Valor Exato'}
                        </button>
                      </div>
                      <span className={clsx('text-[8px]', 'text-gray-500', 'block', 'mt-1.5', 'leading-normal')}>
                        💡 <strong>Dica:</strong> {selectedItemIds.length > 0
                          ? 'Os itens marcados serão baixados juntos. Use “Usar Saldo Total” ou desmarque-os para lançar um valor livre.'
                          : isTableCheckoutOrder(selectedOrder)
                            ? 'Sem itens marcados, qualquer baixa abate o saldo geral da mesa. Você pode receber uma parte no Pix e o restante no cartão.'
                            : 'Para pagamentos múltiplos, digite qualquer valor e faça as baixas em sequência.'}
                      </span>
                    </div>

                    {/* BOTÕES DE ATALHO DE CÉDULAS (CASH SHORTCUTS) */}
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold text-gray-500 uppercase tracking-wider block">Atalhos de Cédulas:</label>
                      <div className="flex flex-wrap gap-1">
                        {[2, 5, 10, 20, 50, 100, 200].map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => {
                              setSelectedItemIds([]);
                              setPaymentValor(val.toFixed(2));
                            }}
                            className="px-2.5 py-1 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] rounded-lg text-[9px] font-bold text-gray-300 font-mono transition-all cursor-pointer hover:border-gray-500 hover:text-white"
                          >
                            R$ {val}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5 font-sans">
                      <label className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Celular do cliente (Opcional - Fidelidade):</label>
                      <input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        value={paymentCPF}
                        onChange={(e) => setPaymentCPF(aplicarMascaraTelefoneInput(e.target.value))}
                        placeholder="(00) 00000-0000"
                        className={clsx('w-full', 'px-3', 'py-2', 'text-xs', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white')}
                      />
                    </div>

                    {/* TROCO EM TEMPO REAL */}
                    {(() => {
                      if (!selectedOrder) return null;
                      const restante = getCheckoutBalance(selectedOrder);
                      const inputVal = parseFloat(paymentValor) || 0;
                      if (paymentMetodo === 'dinheiro' && inputVal > restante) {
                        const troco = inputVal - restante;
                        return (
                          <div className={clsx(
                            'bg-emerald-950/45',
                            'border',
                            'border-emerald-800/40',
                            'text-emerald-300',
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
                            <span className="font-bold uppercase text-[9px] tracking-wider text-emerald-400">Troco devido:</span>
                            <span className="font-extrabold text-sm text-emerald-200">R$ {troco.toFixed(2)}</span>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {selectedItemIds.length > 0 && (
                      <div className={clsx('bg-[#10b981]/15', 'border', 'border-[#10b981]/30', 'text-[#10b981]', 'p-2.5', 'rounded-xl', 'text-[10px]', 'flex', 'items-center', 'justify-between', 'gap-2')}>
                        <span>
                          Pagando <strong>{selectedItemIds.length} item(ns)</strong> selecionado(s).
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedItemIds([]);
                            setSplitPeople('1');
                            setPaymentValor(getCheckoutBalance(selectedOrder).toFixed(2));
                          }}
                          className="shrink-0 rounded-lg border border-[#10b981]/30 px-2 py-1 text-[8px] font-bold uppercase hover:bg-[#10b981]/10"
                        >
                          Limpar
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
                      className={clsx('w-full', 'py-3', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded-xl', 'font-bold', 'flex', 'items-center', 'justify-center', 'gap-1.5', 'shadow-md', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'text-[10px]')}
                    >
                      <Check size={14} />
                      <span>
                        {selectedItemIds.length > 0
                          ? 'Receber Itens Selecionados'
                          : 'Lançar Pagamento / Baixa'}
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
            onClick={(e) => { if (e.target === e.currentTarget) setShowAddMesaModal(false); }}
            className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'cursor-pointer')}
          >
            <form onSubmit={handleAddMesaSubmit} className={clsx('bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-3xl', 'w-full', 'max-w-sm', 'p-6', 'space-y-4', 'shadow-2xl', 'animate-scale-in')}>
              <div className={clsx('flex', 'justify-between', 'items-center', 'border-b', 'border-[#27272A]', 'pb-3')}>
                <h3 className={clsx('font-serif', 'font-bold', 'text-lg', 'text-white')}>Criar Nova Mesa</h3>
                <button type="button" onClick={() => setShowAddMesaModal(false)} className={clsx('p-1', 'hover:bg-[#27272A]', 'rounded-full', 'text-gray-400', 'hover:text-white', 'cursor-pointer')}><X size={16} /></button>
              </div>

              <div className={clsx('space-y-3', 'text-left')}>
                <div className="space-y-1">
                  <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Número da Mesa:</label>
                  <input
                    type="number"
                    required
                    placeholder="Ex: 31"
                    value={newMesaId}
                    onChange={(e) => setNewMesaId(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono')}
                  />
                </div>

                <div className="space-y-1">
                  <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Capacidade (Lugares):</label>
                  <input
                    type="number"
                    required
                    placeholder="Ex: 4"
                    value={newMesaCap}
                    onChange={(e) => setNewMesaCap(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono')}
                  />
                </div>

                <div className="space-y-1">
                  <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Nome Personalizado (Opcional):</label>
                  <input
                    type="text"
                    placeholder="Ex: Varanda VIP"
                    value={newMesaNome}
                    onChange={(e) => setNewMesaNome(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white')}
                  />
                </div>
              </div>

              <div className={clsx('flex', 'gap-2', 'pt-2')}>
                <button type="button" onClick={() => setShowAddMesaModal(false)} className={clsx('flex-1', 'py-2', 'bg-[#121214]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'text-white', 'rounded-xl', 'font-bold', 'cursor-pointer')}>Cancelar</button>
                <button type="submit" className={clsx('flex-1', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'font-bold', 'cursor-pointer')}>Salvar Mesa</button>
              </div>
            </form>
          </div>
        )
      }

      {/* 5.1 MODAL: EDITAR / EXCLUIR MESA */}
      {
        editingTable && (
          <div
            onClick={(e) => { if (e.target === e.currentTarget) { setEditingTable(null); setIsConfirmingDelete(false); } }}
            className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'cursor-pointer')}
          >
            <div className={clsx('bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-3xl', 'w-full', 'max-w-sm', 'p-6', 'space-y-4', 'shadow-2xl', 'animate-scale-in')}>
              <div className={clsx('flex', 'justify-between', 'items-center', 'border-b', 'border-[#27272A]', 'pb-3')}>
                <h3 className={clsx('font-serif', 'font-bold', 'text-lg', 'text-white')}>Editar Mesa {editingTable.id}</h3>
                <button 
                  type="button" 
                  onClick={() => {
                    setEditingTable(null);
                    setIsConfirmingDelete(false);
                  }} 
                  className={clsx('p-1', 'hover:bg-[#27272A]', 'rounded-full', 'text-gray-400', 'hover:text-white', 'cursor-pointer')}
                >
                  <X size={16} />
                </button>
              </div>

              {isConfirmingDelete ? (
                <div className="bg-rose-950/20 border border-rose-900/40 p-4 rounded-2xl text-center space-y-3">
                  <span className="text-lg block">⚠️</span>
                  <p className="text-xs text-rose-300">
                    Tem certeza que deseja remover a <strong>Mesa {editingTable.id}</strong> permanentemente? Essa ação não pode ser desfeita.
                  </p>
                  <div className="flex gap-2">
                    <button 
                      type="button" 
                      onClick={() => setIsConfirmingDelete(false)} 
                      className="flex-1 py-1.5 bg-[#121214] hover:bg-[#27272A] border border-[#27272A] text-white text-xs font-bold rounded-lg cursor-pointer transition-all"
                    >
                      Voltar
                    </button>
                    <button 
                      type="button" 
                      onClick={async () => {
                        if (isLoading) return;
                        try {
                          setIsLoading(true);
                          await onDeleteMesa(editingTable.id);
                          setEditingTable(null);
                          setIsConfirmingDelete(false);
                        } catch (err) {
                          console.error(err);
                        } finally {
                          setIsLoading(false);
                        }
                      }}
                      className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-all"
                    >
                      Sim, Excluir
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={clsx('space-y-3', 'text-left')}>
                    <div className="space-y-1">
                      <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Nome da Mesa:</label>
                      <input
                        type="text"
                        placeholder={`Mesa ${editingTable.id}`}
                        value={editTableNome}
                        onChange={(e) => setEditTableNome(e.target.value)}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white')}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Capacidade (Lugares):</label>
                      <input
                        type="number"
                        placeholder="Ex: 4"
                        value={editTableCap}
                        onChange={(e) => setEditTableCap(e.target.value)}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono')}
                      />
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <div className="flex gap-2">
                      <button 
                        type="button" 
                        onClick={() => setEditingTable(null)} 
                        className={clsx('flex-1', 'py-2', 'bg-[#121214]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'text-gray-400', 'hover:text-white', 'rounded-xl', 'font-bold', 'text-xs', 'cursor-pointer', 'transition-all')}
                      >
                        Cancelar
                      </button>
                      <button 
                        type="button"
                        onClick={async () => {
                          if (isLoading) return;
                          const capVal = parseInt(editTableCap);
                          const nameVal = editTableNome.trim() || `Mesa ${editingTable.id}`;
                          if (isNaN(capVal) || capVal <= 0) {
                            alert("Insira uma capacidade válida.");
                            return;
                          }
                          try {
                            setIsLoading(true);
                            await onUpdateMesa(editingTable.id, capVal, nameVal);
                            setEditingTable(null);
                          } catch (err) {
                            console.error(err);
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                        className={clsx('flex-1', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'font-bold', 'text-xs', 'cursor-pointer', 'transition-all')}
                      >
                        Salvar
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsConfirmingDelete(true)}
                      className={clsx('w-full', 'py-2', 'bg-rose-950/25', 'hover:bg-rose-950/45', 'border', 'border-rose-900/35', 'text-rose-400', 'hover:text-rose-300', 'rounded-xl', 'font-bold', 'text-[11px]', 'uppercase', 'tracking-wider', 'cursor-pointer', 'transition-all', 'flex', 'items-center', 'justify-center', 'gap-1')}
                    >
                      <Trash2 size={12} />
                      Excluir Mesa permanentemente
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      }

      {/* 5.2 MODAL: CONFIRMAR LIBERAÇÃO DE MESA */}
      {
        confirmingFreeTableId !== null && (
          <div
            onClick={(e) => { if (e.target === e.currentTarget) setConfirmingFreeTableId(null); }}
            className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'cursor-pointer')}
          >
            <div className={clsx('bg-[#1C1C1F]', 'border', 'border-rose-900/40', 'rounded-3xl', 'w-full', 'max-w-sm', 'p-6', 'space-y-4', 'shadow-2xl', 'animate-scale-in')}>
              <div className="text-center space-y-3">
                <span className="text-2xl block">⚠️</span>
                <h3 className="font-serif font-bold text-base text-white">Liberar Mesa {confirmingFreeTableId}</h3>
                <p className="text-xs text-rose-300 leading-relaxed">
                  Deseja realmente fechar e liberar a <strong>Mesa {confirmingFreeTableId}</strong> de forma forçada? Esta ação fechará o saldo e liberará a mesa no sistema.
                </p>
                <div className="flex gap-2 pt-2">
                  <button 
                    type="button" 
                    onClick={() => setConfirmingFreeTableId(null)} 
                    className="flex-1 py-2.5 bg-[#121214] hover:bg-[#27272A] border border-[#27272A] text-white text-xs font-bold rounded-xl cursor-pointer transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="button" 
                    onClick={async () => {
                      if (isLoading) return;
                      try {
                        setIsLoading(true);
                        const tableOrders = orders.filter(o => o.mesaId === confirmingFreeTableId);
                        for (const comanda of tableOrders) {
                          const res = await fetch(`${apiBaseUrl}/comandas/${comanda.id}/fechar?force=true`, {
                            method: "PUT",
                            headers: authHeaders
                          });
                          if (!res.ok) {
                            const errData = await res.json();
                            throw new Error(errData.detail || "Erro ao liberar");
                          }
                        }
                        setConfirmingFreeTableId(null);
                        onRefreshOrders();
                        setSelectedOrder(null);
                        setShowCheckoutModal(false);
                      } catch (err: any) {
                        console.error(err);
                        alert(err.message || "Erro ao liberar mesa.");
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                    className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl cursor-pointer transition-all"
                  >
                    Sim, Liberar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* 6. MODAL: INSPECIONAR E REIMPRIMIR PEDIDO DO KANBAN */}
      {selectedKanbanOrder && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedKanbanOrder(null); }}
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 cursor-pointer"
        >
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-5 space-y-3 text-left shadow-2xl relative animate-scale-in">
            {/* Header */}
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <div>
                <h3 className="font-serif text-sm font-bold text-white">
                  {selectedKanbanOrder.mesaId && selectedKanbanOrder.mesaId > 0 ? `Detalhes: Mesa ${selectedKanbanOrder.mesaId}` : 'Detalhes: Balcão'}
                </h3>
                <span className="text-[9px] text-gray-500 font-mono block mt-0.5">Lote: #{selectedKanbanOrder.id.slice(-4)}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedKanbanOrder(null)}
                className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>


            {/* Itens e info extras */}
            <div className="space-y-3">
              {selectedKanbanOrder.mesaOrigemId && Number(selectedKanbanOrder.mesaOrigemId) !== Number(selectedKanbanOrder.mesaId) && (
                <div className="bg-emerald-950/20 p-3 rounded-2xl border border-emerald-900/40 text-xs text-emerald-300 flex items-center justify-between shadow-sm font-sans">
                  <div>
                    <strong className="text-emerald-400 block text-[9px] uppercase tracking-wider font-bold">Consumo Mesclado:</strong>
                    <span className="leading-relaxed">Este lote possui consumo mesclado da <strong>Mesa {selectedKanbanOrder.mesaOrigemId}</strong> para a <strong>Mesa {selectedKanbanOrder.mesaId}</strong>.</span>
                  </div>
                  <span className="text-lg shrink-0 pl-2">🔗</span>
                </div>
              )}

              {selectedKanbanOrder.mesaTransferidaDe && Number(selectedKanbanOrder.mesaTransferidaDe) !== Number(selectedKanbanOrder.mesaId) && (
                <div className="bg-purple-950/20 p-3 rounded-2xl border border-purple-900/40 text-xs text-purple-300 flex items-center justify-between shadow-sm font-sans animate-pulse-subtle">
                  <div>
                    <strong className="text-purple-400 block text-[9px] uppercase tracking-wider font-bold">Consumo Transferido:</strong>
                    <span className="leading-relaxed">Este lote foi transferido da <strong>Mesa {selectedKanbanOrder.mesaTransferidaDe}</strong> para a <strong>Mesa {selectedKanbanOrder.mesaId}</strong>.</span>
                  </div>
                  <span className="text-lg shrink-0 pl-2">🔄</span>
                </div>
              )}

              {selectedKanbanOrder.identificador && (
                <div className="bg-[#1C1C1F] p-2.5 rounded-xl border border-[#27272A] text-xs text-gray-300">
                  <strong className="text-white block text-[10px] uppercase tracking-wider text-gray-400">Cliente:</strong>
                  {selectedKanbanOrder.identificador}
                </div>
              )}

              <div className="space-y-2 max-h-48 overflow-y-auto">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Itens do Lote:</span>
                {selectedKanbanOrder.itens.map((item: any, idx: number) => (
                  <div key={idx} className="flex justify-between items-start bg-[#1C1C1F]/40 p-2.5 rounded-xl border border-[#27272A]/40 text-xs">
                    <div>
                      <strong className="text-white">{item.nome || item.produto?.nome}</strong>
                      {item.observacao && <span className="block text-[10px] text-amber-500/90 mt-0.5">Obs: {item.observacao}</span>}
                      {item.cliente_nome && item.cliente_nome !== 'Consumo Geral' && <span className="block text-[9px] text-gray-400 mt-0.5">Para: {item.cliente_nome}</span>}
                    </div>
                    <span className="text-[10px] font-mono bg-[#27272A] text-gray-300 px-1.5 py-0.5 rounded capitalize">{item.status}</span>
                  </div>
                ))}
              </div>

              {/* Botões de impressão */}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch(`${apiBaseUrl}/comandas/lancamentos/${selectedKanbanOrder.id}/reimprimir`, {
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
                  className="w-full py-2.5 bg-rose-950/40 hover:bg-rose-900/20 text-rose-400 font-bold text-xs rounded-xl transition-all cursor-pointer uppercase tracking-wider text-center flex items-center justify-center gap-1.5 border border-rose-900/50 shadow-lg"
                >
                  <Printer size={13} />
                  <span>Reimprimir na Cozinha</span>
                </button>

                {selectedKanbanOrder.mesaId && selectedKanbanOrder.mesaId > 0 && (
                  <div className="flex gap-2 w-full">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const printHeader = localStorage.getItem("koma_print_header") || "";
                          const printFooter = localStorage.getItem("koma_print_footer") || "";
                          let url = `${apiBaseUrl}/mesas/${selectedKanbanOrder.mesaId}/imprimir-recibo?apenas_valores=false`;
                          const params = new URLSearchParams();
                          if (printHeader) params.append("print_header", printHeader);
                          if (printFooter) params.append("print_footer", printFooter);
                          if (params.toString()) url += `&${params.toString()}`;
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
                      className="flex-1 py-2.5 bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-white font-bold text-xs rounded-xl transition-all cursor-pointer uppercase tracking-wider text-center flex items-center justify-center gap-1.5 border border-[#27272A] shadow-lg"
                    >
                      <Printer size={13} />
                      <span>Comanda Inteira</span>
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const printHeader = localStorage.getItem("koma_print_header") || "";
                          const printFooter = localStorage.getItem("koma_print_footer") || "";
                          let url = `${apiBaseUrl}/mesas/${selectedKanbanOrder.mesaId}/imprimir-recibo?apenas_valores=true`;
                          const params = new URLSearchParams();
                          if (printHeader) params.append("print_header", printHeader);
                          if (printFooter) params.append("print_footer", printFooter);
                          if (params.toString()) url += `&${params.toString()}`;
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
                      className="flex-1 py-2.5 bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-white font-bold text-xs rounded-xl transition-all cursor-pointer uppercase tracking-wider text-center flex items-center justify-center gap-1.5 border border-[#27272A] shadow-lg"
                    >
                      <Printer size={13} />
                      <span>Só Valores</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. MODAL: ADICIONAR / EDITAR PRODUTO */}
      {showProductModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowProductModal(false); }}
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
        >
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <h3 className="font-serif text-sm font-bold text-white font-serif">
                {editingProduct ? 'Editar Produto' : 'Novo Produto'}
              </h3>
              <button 
                type="button" 
                onClick={() => setShowProductModal(false)} 
                className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer border border-transparent"
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
                    nome: prodFormNome,
                    categoria_id: prodFormCategoriaId,
                    preco: parseFloat(prodFormPreco),
                    descricao: prodFormDescricao,
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
                  } else {
                    const errData = await res.json();
                    alert(errData.detail || 'Erro ao salvar produto.');
                  }
                } catch (err) {
                  console.error(err);
                  alert('Erro de conexão ao salvar produto.');
                } finally {
                  setIsLoading(false);
                }
              }}
              className="space-y-4 text-xs"
            >
              {!editingProduct && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Código/Ref do Produto (ID único):</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 001, 104, burger-duplo"
                    value={prodFormId}
                    onChange={(e) => setProdFormId(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nome do Produto:</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Cheeseburger Duplo"
                  value={prodFormNome}
                  onChange={(e) => setProdFormNome(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Preço (R$):</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="25.90"
                    value={prodFormPreco}
                    onChange={(e) => setProdFormPreco(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-[11px]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Categoria:</label>
                  <div className="flex gap-1.5">
                    <select
                      required
                      value={prodFormCategoriaId}
                      onChange={(e) => setProdFormCategoriaId(e.target.value)}
                      className="flex-1 px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
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
                      className="px-3 bg-[#10b981]/10 hover:bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/20 hover:border-[#10b981]/30 rounded-xl font-bold text-sm cursor-pointer transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Descrição / Ingredientes:</label>
                <textarea
                  placeholder="Hambúrguer bovino 150g, queijo cheddar derretido..."
                  value={prodFormDescricao}
                  onChange={(e) => setProdFormDescricao(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">URLs das Imagens do Produto (Até 3 fotos):</label>
                <input
                  type="text"
                  placeholder="Foto 1 (Principal): https://exemplo.com/foto1.jpg"
                  value={prodFormImagem}
                  onChange={(e) => setProdFormImagem(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-[#10b981]"
                />
                <input
                  type="text"
                  placeholder="Foto 2 (Opcional): https://exemplo.com/foto2.jpg"
                  value={prodFormImagem2}
                  onChange={(e) => setProdFormImagem2(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-[#10b981]"
                />
                <input
                  type="text"
                  placeholder="Foto 3 (Opcional): https://exemplo.com/foto3.jpg"
                  value={prodFormImagem3}
                  onChange={(e) => setProdFormImagem3(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  id="prod-form-ativo"
                  checked={prodFormAtivo}
                  onChange={(e) => setProdFormAtivo(e.target.checked)}
                  className="rounded border-[#27272A] text-emerald-500 focus:ring-emerald-500 h-4 w-4 bg-[#121214]"
                />
                <label htmlFor="prod-form-ativo" className="text-[10px] font-bold text-gray-300 uppercase tracking-wider cursor-pointer">Disponível em estoque (Ativo)</label>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="flex-1 py-2 bg-[#121214] hover:bg-[#27272A] border border-[#27272A] text-white rounded-xl font-bold cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl font-bold cursor-pointer transition-colors disabled:opacity-50"
                >
                  {isLoading ? 'Salvando...' : 'Salvar'}
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
        onSuccess={async () => {
          if (onRefreshCategorias) {
            await onRefreshCategorias();
          } else {
            await fetchCategorias();
          }
        }}
        showToast={showToast}
      />

      {editingCrmUser && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setEditingCrmUser(null); }}
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
        >
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <h3 className="font-serif text-sm font-bold text-white">
                Editar Cliente CRM
              </h3>
              <button 
                type="button" 
                onClick={() => setEditingCrmUser(null)} 
                className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer border border-transparent"
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
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Telefone / WhatsApp:</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  required
                  autoFocus
                  placeholder="(00) 00000-0000"
                  value={crmFormTelefone}
                  onChange={(e) => setCrmFormTelefone(aplicarMascaraTelefoneInput(e.target.value))}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nome:</label>
                <input
                  type="text"
                  required
                  value={crmFormNome}
                  onChange={(e) => setCrmFormNome(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                />
              </div>

              {/* EDITABLE FIELDS */}
              <div className="grid grid-cols-2 gap-4">
                {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? (
                  <div className="space-y-1 col-span-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Saldo de Pontos (Ajuste):</label>
                    <input
                      type="number"
                      required
                      value={crmFormPontos}
                      onChange={(e) => setCrmFormPontos(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-xs"
                    />
                  </div>
                ) : (
                  <div className="space-y-1 col-span-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Saldo Cashback R$ (Ajuste):</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={crmFormCashback}
                      onChange={(e) => setCrmFormCashback(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-xs"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingCrmUser(null)}
                  className="flex-1 py-2 bg-[#121214] hover:bg-[#27272A] border border-[#27272A] text-white rounded-xl font-bold cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl font-bold cursor-pointer transition-colors"
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
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
        >
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <h3 className="font-serif text-sm font-bold text-white">
                Cadastrar Novo Cliente
              </h3>
              <button 
                type="button" 
                onClick={() => setShowNewCrmModal(false)} 
                className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer border border-transparent"
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
                const created = await handleCreateClient(newCrmNome, newCrmTelefone, Number(newCrmSaldo));
                if (created) setShowNewCrmModal(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Telefone / WhatsApp:</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  required
                  autoFocus
                  placeholder="(00) 00000-0000"
                  value={newCrmTelefone}
                  onChange={(e) => setNewCrmTelefone(aplicarMascaraTelefoneInput(e.target.value))}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nome:</label>
                <input
                  type="text"
                  required
                  value={newCrmNome}
                  onChange={(e) => setNewCrmNome(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                  {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? 'Pontos Iniciais:' : 'Cashback Inicial R$:'}
                </label>
                <input
                  type="number"
                  step={fidelidadeConfig.tipo_recompensa === 'PONTOS' ? '1' : '0.01'}
                  value={newCrmSaldo}
                  onChange={(e) => setNewCrmSaldo(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-xs"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewCrmModal(false)}
                  className="flex-1 py-2 border border-zinc-800 hover:border-zinc-700 bg-zinc-950 text-gray-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
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
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
        >
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <h3 className="font-serif text-sm font-bold text-white">
                Cadastrar Novo Insumo
              </h3>
              <button 
                type="button" 
                onClick={() => setShowNewInsumoModal(false)} 
                className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer border border-transparent"
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!insumoFormId.trim() || !insumoFormNome.trim() || !insumoFormUnidade.trim()) {
                  alert('Preencha os campos obrigatórios!');
                  return;
                }
                await handleSaveInsumo(true);
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">ID do Insumo (slug):</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: carne-bovina"
                    value={insumoFormId}
                    onChange={(e) => setInsumoFormId(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nome do Insumo:</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Contra Filé"
                    value={insumoFormNome}
                    onChange={(e) => setInsumoFormNome(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Unidade:</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: kg, un, l"
                    value={insumoFormUnidade}
                    onChange={(e) => setInsumoFormUnidade(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Mínimo:</label>
                  <input
                    type="number"
                    required
                    value={insumoFormMinimo}
                    onChange={(e) => setInsumoFormMinimo(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Máximo:</label>
                  <input
                    type="number"
                    required
                    value={insumoFormMaximo}
                    onChange={(e) => setInsumoFormMaximo(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Preço de Custo Médio (R$):</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={insumoFormCusto}
                  onChange={(e) => setInsumoFormCusto(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-xs"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewInsumoModal(false)}
                  className="flex-1 py-2 border border-zinc-800 hover:border-zinc-700 bg-zinc-950 text-gray-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Criar Insumo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditInsumoModal && selectedInsumo && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowEditInsumoModal(false); }}
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
        >
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <h3 className="font-serif text-sm font-bold text-white">
                Editar Insumo
              </h3>
              <button 
                type="button" 
                onClick={() => setShowEditInsumoModal(false)} 
                className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer border border-transparent"
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
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-mono">ID (Não editável):</label>
                <input
                  type="text"
                  disabled
                  value={selectedInsumo.id}
                  className="w-full px-3 py-2 bg-[#1C1C1F]/40 border border-[#27272A]/50 rounded-xl text-gray-500 font-mono text-xs opacity-60"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nome do Insumo:</label>
                <input
                  type="text"
                  required
                  value={insumoFormNome}
                  onChange={(e) => setInsumoFormNome(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Unidade:</label>
                  <input
                    type="text"
                    required
                    value={insumoFormUnidade}
                    onChange={(e) => setInsumoFormUnidade(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Mínimo:</label>
                  <input
                    type="number"
                    required
                    value={insumoFormMinimo}
                    onChange={(e) => setInsumoFormMinimo(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Máximo:</label>
                  <input
                    type="number"
                    required
                    value={insumoFormMaximo}
                    onChange={(e) => setInsumoFormMaximo(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Preço de Custo Médio (R$):</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={insumoFormCusto}
                  onChange={(e) => setInsumoFormCusto(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-xs"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditInsumoModal(false)}
                  className="flex-1 py-2 border border-zinc-800 hover:border-zinc-700 bg-zinc-950 text-gray-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
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
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
        >
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <h3 className="font-serif text-sm font-bold text-white">
                Ajustar Estoque: {selectedInsumo.nome}
              </h3>
              <button 
                type="button" 
                onClick={() => setShowAjusteInsumoModal(false)} 
                className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer border border-transparent"
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
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Tipo de Ajuste:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAjusteTipo('ENTRADA')}
                    className={clsx(
                      'py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer',
                      ajusteTipo === 'ENTRADA'
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 font-bold'
                        : 'bg-zinc-950 border-zinc-800 text-gray-400 hover:text-white font-bold'
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
                        : 'bg-zinc-950 border-zinc-800 text-gray-400 hover:text-white font-bold'
                    )}
                  >
                    Saída (-)
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Quantidade ({selectedInsumo.unidade_medida}):</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={ajusteQtd}
                  onChange={(e) => setAjusteQtd(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Justificativa:</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Ajuste de inventário / Perda por validade"
                  value={ajusteJustificativa}
                  onChange={(e) => setAjusteJustificativa(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAjusteInsumoModal(false)}
                  className="flex-1 py-2 border border-zinc-800 hover:border-zinc-700 bg-zinc-950 text-gray-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
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
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
        >
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <h3 className="font-serif text-sm font-bold text-white">
                Cadastrar Novo Fornecedor
              </h3>
              <button 
                type="button" 
                onClick={() => setShowNewDistModal(false)} 
                className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer border border-transparent"
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!distFormId.trim() || !distFormNomeFantasia.trim()) {
                  alert('Preencha os campos obrigatórios!');
                  return;
                }
                await handleSaveDistribuidor(true);
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">ID (slug):</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: ambev"
                    value={distFormId}
                    onChange={(e) => setDistFormId(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nome Fantasia:</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Ambev"
                    value={distFormNomeFantasia}
                    onChange={(e) => setDistFormNomeFantasia(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Razão Social:</label>
                <input
                  type="text"
                  placeholder="ex: Companhia de Bebidas das Américas"
                  value={distFormRazaoSocial}
                  onChange={(e) => setDistFormRazaoSocial(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">CNPJ:</label>
                  <input
                    type="text"
                    placeholder="00.000.000/0000-00"
                    value={distFormCnpj}
                    onChange={(e) => setDistFormCnpj(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Lead Time (dias):</label>
                  <input
                    type="number"
                    required
                    value={distFormLeadTime}
                    onChange={(e) => setDistFormLeadTime(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewDistModal(false)}
                  className="flex-1 py-2 border border-zinc-800 hover:border-zinc-700 bg-zinc-955 text-gray-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
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
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
        >
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <h3 className="font-serif text-sm font-bold text-white">
                Editar Fornecedor: {selectedDist.nome_fantasia}
              </h3>
              <button 
                type="button" 
                onClick={() => setShowEditDistModal(false)} 
                className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer border border-transparent"
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
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block font-mono">ID (Não editável):</label>
                <input
                  type="text"
                  disabled
                  value={selectedDist.id}
                  className="w-full px-3 py-2 bg-[#1C1C1F]/40 border border-[#27272A]/50 rounded-xl text-gray-500 font-mono text-xs opacity-60"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nome Fantasia:</label>
                <input
                  type="text"
                  required
                  value={distFormNomeFantasia}
                  onChange={(e) => setDistFormNomeFantasia(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Razão Social:</label>
                <input
                  type="text"
                  value={distFormRazaoSocial}
                  onChange={(e) => setDistFormRazaoSocial(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">CNPJ:</label>
                  <input
                    type="text"
                    value={distFormCnpj}
                    onChange={(e) => setDistFormCnpj(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Lead Time (dias):</label>
                  <input
                    type="number"
                    required
                    value={distFormLeadTime}
                    onChange={(e) => setDistFormLeadTime(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981] font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditDistModal(false)}
                  className="flex-1 py-2 border border-zinc-800 hover:border-zinc-700 bg-zinc-950 text-gray-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE AÇÕES RÁPIDAS (RATEIO / DESCONTO / CHECKOUT) */}
      <ComandaActionsModal
        isOpen={Boolean(quickActionsOrder)}
        onClose={() => setQuickActionsOrder(null)}
        comanda={quickActionsOrder}
        onPrintKitchen={async (comandaId) => {
          try {
            const res = await fetch(`${apiBaseUrl}/comandas/lancamentos/${comandaId}/reimprimir`, {
              method: "POST",
              headers: authHeaders
            });
            if (res.ok) {
              window.dispatchEvent(
                new Event('koma_print_monitor_refresh')
              );
            } else {
              const err = await res.json();
              showToast(`Erro ao reimprimir: ${err.detail}`, 'error');
            }
          } catch (err) {
            console.error(err);
            showToast("Erro ao solicitar impressão.", 'error');
          }
        }}
        onPrintBill={async (comandaId) => {
          try {
            const targetOrder = orders.find(o => o.id === comandaId) || quickActionsOrder;
            const mesaId = targetOrder?.mesaId || 0;
            const printHeader = localStorage.getItem("koma_print_header") || "";
            const printFooter = localStorage.getItem("koma_print_footer") || "";
            let url = `${apiBaseUrl}/mesas/${mesaId}/imprimir-recibo?apenas_valores=true`;
            const params = new URLSearchParams();
            if (printHeader) params.append("print_header", printHeader);
            if (printFooter) params.append("print_footer", printFooter);
            if (params.toString()) url += `&${params.toString()}`;

            const res = await fetch(url, {
              method: 'POST',
              headers: authHeaders
            });
            if (res.ok) {
              window.dispatchEvent(
                new Event('koma_print_monitor_refresh')
              );
            } else {
              const err = await res.json();
              showToast(`Erro ao imprimir pré-conta: ${err.detail}`, 'error');
            }
          } catch (err) {
            console.error(err);
            showToast("Erro ao solicitar pré-conta.", 'error');
          }
        }}
        onFinalizeOrder={async (comandaId, totalFinal, metodoPagamento) => {
          try {
            const res = await fetch(`${apiBaseUrl}/comandas/${comandaId}/fechar`, {
              method: "PUT",
              headers: authHeaders
            });
            if (res.ok) {
              showToast(`✅ Comanda #${comandaId.slice(-4)} finalizada (${metodoPagamento.toUpperCase()}) — R$ ${totalFinal.toFixed(2)}`);
              onRefreshOrders();
              fetchDeliveryOrders();
              setSelectedKanbanOrder(null);
            } else {
              const err = await res.json();
              showToast(`Erro ao fechar comanda: ${err.detail}`, 'error');
            }
          } catch (err) {
            console.error(err);
            showToast("Erro de conexão ao fechar comanda.", 'error');
          }
        }}
      />

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
        <div className="fixed inset-0 z-[9998] flex justify-start animate-fade-in">
          {/* Backdrop escuro com clique para fechar */}
          <div
            onClick={() => setIsOperatorDrawerOpen(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity cursor-pointer"
          />

          {/* Drawer Lateral - Modernized Shadcn Dark Theme */}
          <div className="relative w-80 max-w-[85vw] h-full bg-[#121214] border-r border-[#27272A] shadow-2xl flex flex-col justify-between z-10 overflow-y-auto p-5 text-white font-sans">
            <div className="space-y-5">
              {/* Header do Drawer */}
              <div className="flex items-center justify-between border-b border-[#27272A] pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <SlidersHorizontal size={18} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-white font-serif">Opções do Caixa</h3>
                    <span className="text-xs text-gray-400 block">Sessão e Preferências</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOperatorDrawerOpen(false)}
                  className="p-1.5 text-gray-400 hover:text-white bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] rounded-xl cursor-pointer transition-all"
                  title="Fechar Menu"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 1. SEÇÃO GARÇOM / OPERADOR EM ATENDIMENTO */}
              <div className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-4 space-y-3.5 shadow-md">
                <span className="text-[9px] uppercase tracking-wider text-gray-400 font-extrabold block">
                  Garçom / Operador em Atendimento
                </span>
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-800 flex items-center justify-center font-bold text-white text-lg shadow-md shrink-0 font-serif border border-emerald-500/30">
                    {(activeWaiterNome || "G").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <strong className="font-bold text-base text-white block truncate">
                      {activeWaiterNome || "Georlan"}
                    </strong>
                    <span className="text-xs text-emerald-400 font-medium block">
                      Operador de Caixa / Gerência
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLogoutOperator}
                  className="w-full py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold text-xs rounded-xl transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm"
                >
                  <Lock size={14} className="text-rose-400" />
                  <span>LOGOUT / TROCAR OPERADOR</span>
                </button>
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
                  <div className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-4 space-y-3 shadow-md">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] uppercase tracking-wider text-gray-400 font-extrabold block">
                        Status do Salão ao Vivo
                      </span>
                      <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        Tempo Real
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-[#121214] border border-[#27272A] p-2.5 rounded-xl text-center shadow-xs">
                        <span className="text-[9px] text-gray-400 block font-medium">LIVRES</span>
                        <strong className="text-lg font-bold text-emerald-400 font-mono">
                          {liveFreeTablesCount}
                        </strong>
                      </div>
                      <div className="bg-[#121214] border border-[#27272A] p-2.5 rounded-xl text-center shadow-xs">
                        <span className="text-[9px] text-gray-400 block font-medium">OCUPADAS</span>
                        <strong className="text-lg font-bold text-amber-400 font-mono">
                          {liveOccupiedTablesCount}
                        </strong>
                      </div>
                      <div className="bg-[#121214] border border-[#27272A] p-2.5 rounded-xl text-center shadow-xs">
                        <span className="text-[9px] text-gray-400 block font-medium">TOTAL</span>
                        <strong className="text-lg font-bold text-sky-400 font-mono">
                          {liveTotalTablesCount}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 3. SEÇÃO ATALHOS DE ATENDIMENTO */}
              <div className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-4 space-y-2.5 shadow-md">
                <span className="text-[9px] uppercase tracking-wider text-gray-400 font-extrabold block">
                  Atalhos de Atendimento
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (onRefreshOrders) onRefreshOrders();
                    showToast("Salão e pedidos sincronizados em tempo real!", "success");
                  }}
                  className="w-full py-2.5 px-3 bg-[#121214] hover:bg-[#27272A]/50 border border-[#27272A] text-gray-200 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2">
                    <RefreshCw size={14} className="text-emerald-400 group-hover:rotate-180 transition-transform duration-500" />
                    <span>Sincronizar Salão e Pedidos</span>
                  </div>
                  <ChevronRight size={14} className="text-gray-500 group-hover:text-white" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    toggleFullscreen();
                    setIsOperatorDrawerOpen(false);
                  }}
                  className="w-full py-2.5 px-3 bg-[#121214] hover:bg-[#27272A]/50 border border-[#27272A] text-gray-200 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2">
                    {isFullscreen ? <Minimize2 size={14} className="text-sky-400" /> : <Maximize2 size={14} className="text-sky-400" />}
                    <span>{isFullscreen ? "Sair do Modo PDV" : "Modo PDV Imersivo"}</span>
                  </div>
                  <ChevronRight size={14} className="text-gray-500 group-hover:text-white" />
                </button>
              </div>

              {/* 4. SEÇÃO EXIBIÇÃO E PREFERÊNCIAS */}
              <div className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-4 space-y-3 shadow-md">
                <span className="text-[9px] uppercase tracking-wider text-gray-400 font-extrabold block">
                  Exibição e Preferências
                </span>
                
                <div className="space-y-1.5">
                  <span className="text-xs text-gray-300 font-medium block">Tamanho da Fonte:</span>
                  <div className="grid grid-cols-3 gap-1 bg-[#121214] p-1 rounded-xl border border-[#27272A]">
                    {(['padrao', 'grande', 'gigante'] as const).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => changeFontSize(sz)}
                        className={`py-1 rounded-lg text-xs font-bold uppercase transition-all cursor-pointer ${fontSize === sz
                          ? 'bg-emerald-500 text-zinc-950 shadow-md font-extrabold'
                          : 'text-gray-400 hover:text-white'
                          }`}
                      >
                        {sz === 'padrao' ? 'Padrão' : sz === 'grande' ? 'Grande' : 'Gigante'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* RODAPÉ */}
            <div className="pt-5 border-t border-[#27272A] text-center space-y-1">
              <span className="text-xs font-bold text-gray-400 block font-mono">
                Kôma v3.5 • Dark Engine
              </span>
              <span className="text-[10px] text-gray-500 block">
                Sistema PDV Gourmet Multi-Tenant
              </span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export const MemoizedCaixaPanel = React.memo(CaixaPanel);
