import React, { useState, useEffect, useRef } from 'react';
import {
  DollarSign, ArrowUpRight, ArrowDownRight, Lock, Unlock, Users,
  Receipt, ShoppingCart, Percent, CreditCard, Check, AlertTriangle,
  Clock, X, RefreshCw, Edit3, Trash2, Plus, ChevronRight,
  MapPin, ClipboardList, BarChart2, Package, Shield, Star,
  MessageSquare, Send, Printer, Cpu, HelpCircle, Smartphone,
  Gift, Tag, TrendingUp, Heart, Globe
} from 'lucide-react';
import { Order, OrderItem, CaixaTurno, CaixaMovimentacao, Pagamento, Table, Product, SimulatedDeliveryOrder, DeliveryZone, SystemUser, BotChatMessage } from '../types';
import { PRODUCTS, CATEGORIES } from '../data';
import { getProductPresets } from '../domain';
import clsx from 'clsx';
import { CaixaLogisticaTab } from './CaixaLogisticaTab';
import { CaixaSalaoTab } from './CaixaSalaoTab';
import { CaixaBalcaoTab } from './CaixaBalcaoTab';
import { CaixaKanbanBoard } from './CaixaKanbanBoard';
import * as API from '../config/caixaService';

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
}

export function CaixaPanel({
  orders,
  onRefreshOrders,
  apiBaseUrl,
  authHeaders,
  activeWaiterNome,
  salonTables,
  onCreateMesa,
  onUpdateMesa,
  onDeleteMesa,
  pagamentosPendentes = [],
  onRefreshPagamentosPendentes,
  isWsConnected = false,
  liveProdutos = [],
  liveCategorias = [],
  onRefreshCategorias,
  restauranteConfig
}: CaixaPanelProps) {
  // Turno & Sync state
  const [turno, setTurno] = useState<CaixaTurno | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // active sidebar tab (the 9 main sections)
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'operacao' | 'cardapio' | 'estoque' | 'financeiro' | 'clientes' | 'relatorios' | 'robo_ia' | 'configuracoes'
  >('operacao');

  // active sub-tab under each main tab
  // active sub-tab under each main tab
  const [activeSubTab, setActiveSubTab] = useState<string>('pedidos');
  const [selectedKanbanOrder, setSelectedKanbanOrder] = useState<any>(null);

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

  // Col 1 — Produção Local: AGRUPADO POR RODADA (Order) — 1 card por comanda/rodada de pedido
  // Cada rodada pode conter múltiplos itens; o botão "Pronto" é individual por item.
  const localProductionRounds = (() => {
    const rounds: any[] = [];
    orders.forEach(comanda => {
      if (comanda.tipo !== 'Consumo no Local') return;
      if ((comanda as any).statusComanda === 'aguardando_pagamento') return;
      // Coletar apenas os itens desta rodada ainda em preparo
      const preparingItems = comanda.itens.filter(item => item.status === 'preparando');
      if (preparingItems.length === 0) return;
      rounds.push({
        rodadaId: comanda.id,
        comandaId: comanda.id,
        mesaId: comanda.mesaId,
        mesaOrigemId: (comanda as any).mesaOrigemId,
        garcomNome: comanda.garcomNome,
        identificador: (comanda as any).identificador ?? null,
        timestamp: comanda.timestamp,
        itens: preparingItems.map(item => ({
          itemId: item.id,
          nome: (item as any).nome || 'Item',
          observacao: (item as any).observacao || '',
          preco: (item as any).preco_unit ?? (item as any).preco ?? 0,
          lancamentoId: (item as any).lancamentoId,
          status: item.status,
        })),
      });
    });
    return rounds;
  })();

  // Alias para compatibilidade com o segundo bloco Kanban (que usa tableOrdersInProduction)
  const localProductionItems = localProductionRounds;
  const tableOrdersInProduction = localProductionRounds;

  // Col 3 — Fechar conta: mesas com status 'aguardando_pagamento' (conta pedida) ou itens prontos individualmente
  const tableOrdersReady = (() => {
    const list: any[] = [];
    orders.forEach(comanda => {
      if (comanda.tipo !== 'Consumo no Local' || !comanda.mesaId || comanda.mesaId <= 0) return;

      // Caminho A: cliente pediu a conta → coloca a comanda inteira (todos os itens não pagos)
      // num único card de "aguardando pagamento"
      if ((comanda as any).statusComanda === 'aguardando_pagamento') {
        const unpaid = comanda.itens.filter(i => (i.status as string) !== 'cancelado' && !i.pago);
        if (unpaid.length > 0) {
          list.push({
            id: comanda.id,
            comandaId: comanda.id,
            mesaId: comanda.mesaId,
            mesaOrigemId: comanda.mesaOrigemId,
            mesaTransferidaDe: comanda.mesaTransferidaDe,
            identificador: (comanda as any).identificador ?? null,
            garcomNome: comanda.garcomNome,
            tipo: comanda.tipo,
            valorPago: (comanda as any).valorPago || 0,
            itens: unpaid.map(i => ({ ...i, comandaId: comanda.id })),
            contaPedida: true
          });
        }
        return;
      }

      // Caminho B: itens prontos individualmente (sem ter pedido conta ainda) →
      // junta todos os itens prontos e não pagos desta comanda em um só card.
      const readyItems = comanda.itens.filter(item => item.status === 'pronto' && !item.pago);
      if (readyItems.length > 0) {
        const temItensEmPreparo = orders
          .filter(o => o.mesaId === comanda.mesaId)
          .some(o => o.itens.some(i => i.status === 'preparando'));

        list.push({
          id: comanda.id,
          comandaId: comanda.id,
          mesaId: comanda.mesaId,
          mesaOrigemId: comanda.mesaOrigemId,
          mesaTransferidaDe: comanda.mesaTransferidaDe,
          identificador: (comanda as any).identificador ?? null,
          garcomNome: comanda.garcomNome,
          tipo: comanda.tipo,
          valorPago: (comanda as any).valorPago || 0,
          itens: readyItems.map(i => ({ ...i, comandaId: comanda.id })),
          contaPedida: false,
          temItensEmPreparo: temItensEmPreparo
        });
      }
    });
    return list;
  })();

  const groupedTableOrdersReady = (() => {
    const groups: Record<number, any[]> = {};
    tableOrdersReady.forEach(order => {
      if (!order.mesaId) return;
      if (!groups[order.mesaId]) {
        groups[order.mesaId] = [];
      }
      groups[order.mesaId].push(order);
    });

    const list: any[] = [];
    Object.entries(groups).forEach(([mesaIdStr, ordersList]) => {
      const mId = parseInt(mesaIdStr);
      if (ordersList.length > 1) {
        const allItems: any[] = [];
        ordersList.forEach(o => {
          allItems.push(...o.itens);
        });

        const contaPedida = ordersList.some(o => o.contaPedida);
        const temItensEmPreparo = ordersList.some(o => o.temItensEmPreparo);
        const valorPago = ordersList.reduce((acc, o) => acc + (o.valorPago || 0), 0);
        const garcomSet = new Set<string>();
        ordersList.forEach(o => {
          if (o.garcomNome) garcomSet.add(o.garcomNome);
        });
        const garcomNome = garcomSet.size > 0 ? Array.from(garcomSet).join(', ') : 'Garçom';

        list.push({
          id: `grouped-mesa-${mId}`,
          mesaId: mId,
          mesaOrigemId: ordersList[0].mesaOrigemId,
          mesaTransferidaDe: ordersList[0].mesaTransferidaDe,
          identificador: `Consumo Mesa ${mId}`,
          garcomNome: garcomNome,
          tipo: 'Consumo no Local',
          valorPago: valorPago,
          itens: allItems,
          contaPedida: contaPedida,
          temItensEmPreparo: temItensEmPreparo,
          isGrouped: true,
          originalOrders: ordersList
        });
      } else {
        list.push({
          ...ordersList[0],
          isGrouped: false,
          originalOrders: ordersList
        });
      }
    });

    return list;
  })();

  const handleTabChange = (tabId: 'dashboard' | 'operacao' | 'cardapio' | 'estoque' | 'financeiro' | 'clientes' | 'relatorios' | 'robo_ia' | 'configuracoes') => {
    setActiveTab(tabId);
    switch (tabId) {
      case 'dashboard':
        setActiveSubTab('desempenho');
        break;
      case 'operacao':
        setActiveSubTab('pedidos');
        break;
      case 'cardapio':
        setActiveSubTab('cardapio_lista');
        break;
      case 'estoque':
        setActiveSubTab('insumos');
        break;
      case 'financeiro':
        setActiveSubTab('fluxo');
        break;
      case 'clientes':
        setActiveSubTab('crm');
        break;
      case 'relatorios':
        setActiveSubTab('relatorio_geral');
        break;
      case 'robo_ia':
        setActiveSubTab('prompt');
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
  const [loyaltyUsers, setLoyaltyUsers] = useState<{ id: number; cliente: string; telefone: string; pontos: number; saldoCashback: number; }[]>([]);
  const [compreGanheRules, setCompreGanheRules] = useState<{ id: number; titulo: string; descricao: string; ativa: boolean; }[]>([]);

  const handleRecuperarCart = (id: number, cliente: string, telefone: string) => {
    alert(`Simulação de WhatsApp: Mensagem enviada para ${cliente} (${telefone}) convidando para finalizar a compra com desconto!`);
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

  const handleSaveFidelityConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await API.saveFidelityConfig(apiBaseUrl, authHeaders, fidelidadeConfig);
      if (res.ok) {
        alert('Configurações do Programa de Fidelidade salvas com sucesso!');
      } else {
        alert('Falha ao salvar as configurações.');
      }
    } catch (err) {
      console.error('Error saving fidelity config:', err);
    }
  };

  // Config Salão sub-tab
  const [configSalSubTab, setConfigSalSubTab] = useState<'pedido' | 'fechamento' | 'atendimento'>('pedido');

  // System waiters (users CRUD) list loaded from API
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
  const [newUserNome, setNewUserNome] = useState('');
  const [newUserUsuario, setNewUserUsuario] = useState('');
  const [newUserSenha, setNewUserSenha] = useState('');
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
  const [xmlUploadState, setXmlUploadState] = useState<{ loading: boolean, result: any | null, error: string | null, isDragging: boolean }>({ loading: false, result: null, error: null, isDragging: false });
  const xmlFileInputRef = useRef<HTMLInputElement>(null);
  const [horariosPico, setHorariosPico] = useState<{ dia_semana_label: string, dia_semana: number, hora: string, total_pedidos: number }[]>([]);
  const [fidelidadeConfig, setFidelidadeConfig] = useState({
    ativo: true,
    tipo_recompensa: 'PONTOS', // PONTOS | CASHBACK
    taxa_conversao: 1.0,
    valor_ponto_em_dinheiro: 0.05
  });

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

  // Product & Category management states
  const [apiCategorias, setApiCategorias] = useState<any[]>([]);
  const [showProductModal, setShowProductModal] = useState(false);
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
  const [modoExclusivoSalao, setModoExclusivoSalao] = useState(true);
  const [plano, setPlano] = useState<'pocket' | 'bistro' | 'delivery' | 'premium'>('premium');
  const isPocket = plano === 'pocket';
  const isBistro = plano === 'bistro';
  const isDelivery = plano === 'delivery';
  const isPremium = plano === 'premium';
  const [splitPeople, setSplitPeople] = useState('1');
  const [paymentMetodo, setPaymentMetodo] = useState<'dinheiro' | 'pix' | 'cartao' | 'cartao_debito' | 'cartao_credito'>('pix');
  const [paymentValor, setPaymentValor] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  const updateConfiguracoes = async (updates: {
    taxa_servico_ativa?: boolean;
    taxa_servico_padrao?: number;
    unificar_vias_delivery?: boolean;
    modo_exclusivo_salao?: boolean;
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
    try {
      const res = await API.updateCaixaConfiguracoes(apiBaseUrl, authHeaders, updates);
      if (res.ok) {
        const data = await res.json();
        setCheckoutServiceTax(data.taxa_servico_ativa);
        setTaxaServicoAtiva(data.taxa_servico_ativa);
        setServiceTaxRate(data.taxa_servico_padrao);
        setUnificarViasDelivery(data.unificar_vias_delivery);
        setModoExclusivoSalao(data.modo_exclusivo_salon || data.modo_exclusivo_salao);
        if (data.plano) setPlano(data.plano.toLowerCase() as any);
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
      console.error('Error saving configurations:', e);
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
  const [pdvCustomerCPF, setPdvCustomerCPF] = useState('');
  const [paymentCPF, setPaymentCPF] = useState('');
  const [pdvOrderType, setPdvOrderType] = useState<'balcao' | 'entrega' | 'mesa'>('balcao');
  const [pdvDeliveryAddress, setPdvDeliveryAddress] = useState('');
  const [pdvDeliveryTaxa, setPdvDeliveryTaxa] = useState('0.00');
  const [pdvTargetMesaId, setPdvTargetMesaId] = useState<number>(0);

  // Force pdvOrderType to mesa if salon mode is active
  useEffect(() => {
    if (modoExclusivoSalao) {
      setPdvOrderType('mesa');
    }
  }, [modoExclusivoSalao]);

  // Generate idempotency key when checkout order changes
  useEffect(() => {
    if (selectedOrder) {
      setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    } else {
      setIdempotencyKey('');
    }
  }, [selectedOrder]);

  // Clear checkout payment states when showCheckoutModal changes (opening or closing checkout)
  useEffect(() => {
    setPaymentValor('');
  }, [showCheckoutModal]);

  // Synchronize plano state when restauranteConfig prop updates
  useEffect(() => {
    if (restauranteConfig?.plano) {
      setPlano(restauranteConfig.plano.toLowerCase() as any);
    }
  }, [restauranteConfig]);

  // Date filters for Meu Desempenho
  const [desempenhoRange, setDesempenhoRange] = useState<'7' | '15' | '30'>('7');

  // Waiter App Settings toggles (stored in states to mock real switches)
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
  const [printHeader, setPrintHeader] = useState(() => {
    return localStorage.getItem("koma_print_header") || "Kôma Gourmet Bistrô";
  });
  const [printFooter, setPrintFooter] = useState(() => {
    return localStorage.getItem("koma_print_footer") || "Av. do Futuro, 2026 - Recife, PE";
  });
  const [isSearchingPrinters, setIsSearchingPrinters] = useState(false);
  const [detectedPrinters, setDetectedPrinters] = useState<string[]>([]);

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
  const activeMotoboysList = motoboys && motoboys.length > 0
    ? motoboys.filter((m: any) => m.ativo)
    : [
        { id: 1, nome: 'Pedro Silva', ativo: true },
        { id: 2, nome: 'Carlos Roberto', ativo: true },
        { id: 3, nome: 'Marcos Junior', ativo: true }
      ];
  const [novoMotoboyNome, setNovoMotoboyNome] = useState('');
  const [novoMotoboyTelefone, setNovoMotoboyTelefone] = useState('');

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
    c.itens.forEach((it: any) => {
      if (it.status !== 'cancelado') {
        const name = it.produto?.nome || it.nome || 'Item';
        itemCounts[name] = (itemCounts[name] || 0) + 1;
      }
    });
    const itensStr = Object.entries(itemCounts)
      .map(([name, qty]) => `${qty}x ${name}`)
      .join(' + ') || 'Nenhum item';

    const subtotal = c.itens
      .filter((it: any) => it.status !== 'cancelado')
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

    return {
      id: c.id,
      cliente: c.identificador || 'Cliente Sem Nome',
      telefone: c.delivery_telefone || '',
      itens: itensStr,
      total: total,
      canal: canal,
      status: c.delivery_status || 'pendente',
      endereco: c.delivery_endereco || '',
      criadoEm: criadoEm,
      mesaId: c.mesa_id || undefined
    };
  };

  const fetchDeliveryOrders = async () => {
    try {
      const res = await API.getActiveDeliveryOrders(apiBaseUrl, authHeaders);
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
      const res = await API.getMotoboysLista(apiBaseUrl, authHeaders);
      if (res.ok) {
        const data = await res.json();
        setMotoboys(data);
      }
    } catch (err) {
      console.error('Error fetching motoboys', err);
    }
  };

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
    if (isLoading) return;
    setIsLoading(true);
    try {
      const res = await API.updateDeliveryStatus(apiBaseUrl, authHeaders, orderId, statusNovo);
      if (res.ok) {
        fetchDeliveryOrders();
      } else {
        alert('Erro ao atualizar status do pedido.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao atualizar status.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecusarPedido = async (orderId: string) => {
    if (isLoading) return;
    if (!confirm('Deseja realmente recusar e cancelar este pedido?')) return;
    setIsLoading(true);
    try {
      await API.finalizarPedido(apiBaseUrl, authHeaders, orderId);
      await API.fecharComanda(apiBaseUrl, authHeaders, orderId);
      fetchDeliveryOrders();
      onRefreshOrders();
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProntoItemAction = async (itemId: number) => {
    setIsLoading(true);
    try {
      const res = await API.updateItemStatus(apiBaseUrl, authHeaders, itemId, 'pronto');
      if (res.ok) onRefreshOrders();
      else alert('Erro ao marcar item como pronto.');
    } catch (err) {
      console.error(err);
      alert('Erro de conexão.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleProntoRoundAction = async (roundItens: any[]) => {
    setIsLoading(true);
    try {
      await Promise.all(roundItens.map((item: any) =>
        API.updateItemStatus(apiBaseUrl, authHeaders, item.itemId, 'pronto')
      ));
      onRefreshOrders();
    } catch (err) {
      console.error(err);
      alert('Erro de conexão.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDespacharPedido = async (orderId: string, motoboyId: number) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const res = await API.despacharPedido(apiBaseUrl, authHeaders, orderId, motoboyId);
      if (res.ok) {
        alert('Pedido despachado com sucesso!');
        fetchDeliveryOrders();
      } else {
        const err = await res.json();
        alert(`Erro ao despachar: ${err.detail}`);
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao despachar.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinalizarPedido = async (orderId: string) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      await API.finalizarPedido(apiBaseUrl, authHeaders, orderId);
      const res = await API.fecharComanda(apiBaseUrl, authHeaders, orderId);
      if (res.ok) {
        alert('Pedido finalizado e comanda fechada com sucesso!');
        fetchDeliveryOrders();
        onRefreshOrders();
      } else {
        alert('Erro ao fechar comanda.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao finalizar pedido.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCadastrarMotoboy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoMotoboyNome || !novoMotoboyTelefone) return;
    try {
      const res = await API.cadastrarMotoboy(apiBaseUrl, authHeaders, { nome: novoMotoboyNome, telefone: novoMotoboyTelefone });
      if (res.ok) {
        alert('Fretista cadastrado com sucesso!');
        setNovoMotoboyNome('');
        setNovoMotoboyTelefone('');
        fetchMotoboys();
      } else {
        alert('Erro ao cadastrar fretista.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao cadastrar fretista.');
    }
  };

  const [dynamicMenu, setDynamicMenu] = useState<Product[]>(PRODUCTS);
  // Real products loaded from backend
  const [apiProdutos, setApiProdutos] = useState<Product[]>([]);
  // Search state for Disponibilidade tab
  const [disponibilidadeSearch, setDisponibilidadeSearch] = useState<string>('');

  // Online payments & billing plans mock states
  const [payPixActive, setPayPixActive] = useState(true);
  const [payCardActive, setPayCardActive] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<'pocket' | 'bistro' | 'delivery' | 'premium'>('premium');

  useEffect(() => {
    if (plano) {
      setSelectedPlan(plano);
    }
  }, [plano]);

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

  // Co-pilot Chat thread mock data
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
      const res = await API.getTurnoAtual(apiBaseUrl, authHeaders);
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

  // Fetch registered users (waiters CRUD)
  const fetchSystemUsers = async () => {
    try {
      const res = await API.getUsuarios(apiBaseUrl, authHeaders);
      if (res.ok) {
        const data = await res.json();
        setSystemUsers(data);
      }
    } catch (err) {
      console.error('Error fetching users list', err);
    }
  };

  const fetchConfiguracoes = async () => {
    try {
      const res = await API.getCaixaConfiguracoes(apiBaseUrl, authHeaders);
      if (res.ok) {
        const data = await res.json();
        setCheckoutServiceTax(data.taxa_servico_ativa);
        setTaxaServicoAtiva(data.taxa_servico_ativa);
        setServiceTaxRate(data.taxa_servico_padrao);
        setUnificarViasDelivery(data.unificar_vias_delivery);
        setModoExclusivoSalao(data.modo_exclusivo_salao);
        if (data.plano) setPlano(data.plano.toLowerCase() as any);
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
      const res = await API.getCaixaConfigCardapio(apiBaseUrl, authHeaders);
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
      const res = await API.updateCaixaConfigCardapio(apiBaseUrl, authHeaders, {
        status_override: cardapioStatusOverride,
        cor_primaria: cardapioCorPrimaria,
        cor_fundo: cardapioCorFundo,
        logo_url: cardapioLogoUrl,
        banner_url: cardapioBannerUrl,
        sobre_nos: cardapioSobreNos,
        endereco: cardapioEndereco
      });
      if (res.ok) {
        alert('Configurações do cardápio digital atualizadas com sucesso!');
      } else {
        alert('Falha ao salvar as configurações.');
      }
    } catch (err) {
      console.error('Error saving cardapio whitelabel config', err);
      alert('Erro de conexão ao salvar configurações.');
    } finally {
      setIsSavingCardapioConfig(false);
    }
  };

  const handleUpdateClient = async (oldPhone: string, newNome: string, newPhone: string, newSaldo?: number) => {
    try {
      const body: any = { cliente: newNome, telefone: newPhone };
      if (newSaldo !== undefined && !isNaN(newSaldo)) {
        if (fidelidadeConfig.tipo_recompensa === 'PONTOS') {
          body.saldo_pontos = Math.round(newSaldo);
        } else {
          body.saldo_cashback = newSaldo;
        }
      }
      const res = await API.updateFidelidadeCliente(apiBaseUrl, authHeaders, oldPhone, body);
      if (res.ok) {
        alert('Cliente atualizado com sucesso!');
        const freshRes = await API.getFidelidadeClientes(apiBaseUrl, authHeaders);
        if (freshRes.ok) {
          const data = await freshRes.json();
          if (Array.isArray(data)) setLoyaltyUsers(data);
        }
      } else {
        const err = await res.json();
        alert(`Erro: ${err.detail || 'Falha ao atualizar cliente.'}`);
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão.');
    }
  };

  const handleCreateClient = async (nome: string, telefone: string, saldoInicial: number) => {
    try {
      const body: any = { cliente: nome, telefone: telefone };
      if (!isNaN(saldoInicial)) {
        if (fidelidadeConfig.tipo_recompensa === 'PONTOS') {
          body.saldo_pontos = Math.round(saldoInicial);
        } else {
          body.saldo_cashback = saldoInicial;
        }
      }
      const res = await API.cadastrarFidelidadeCliente(apiBaseUrl, authHeaders, body);
      if (res.ok) {
        alert('Cliente cadastrado com sucesso!');
        // Refresh client lists
        const freshRes = await API.getFidelidadeClientes(apiBaseUrl, authHeaders);
        if (freshRes.ok) {
          const data = await freshRes.json();
          if (Array.isArray(data)) setLoyaltyUsers(data);
        }
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao cadastrar cliente.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão.');
    }
  };

  const refreshEstoqueData = () => {
    API.getInsumos(apiBaseUrl, authHeaders)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setEstoqueInsumos(data); })
      .catch(err => console.error('Error fetching insumos:', err));

    API.getDistribuidores(apiBaseUrl, authHeaders)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setDistribuidores(data); })
      .catch(err => console.error('Error fetching distribuidores:', err));
  };

  const handleSaveInsumo = async (isNew: boolean) => {
    try {
      const endpoint = isNew 
        ? '/estoque/insumos' 
        : `/estoque/insumos/${selectedInsumo.id}`;
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

      const res = await API.saveInsumo(apiBaseUrl, authHeaders, endpoint, method, body);

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
      const res = await API.ajustarInsumo(apiBaseUrl, authHeaders, selectedInsumo.id, {
        quantidade: Number(ajusteQtd),
        tipo: ajusteTipo,
        justificativa: ajusteJustificativa
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
      const endpoint = isNew
        ? '/estoque/distribuidores'
        : `/estoque/distribuidores/${selectedDist.id}`;
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

      const res = await API.saveDistribuidor(apiBaseUrl, authHeaders, endpoint, method, body);

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
      const res = await API.deletarDistribuidor(apiBaseUrl, authHeaders, Number(distId));
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
      const res = await API.getProdutos(apiBaseUrl, authHeaders);
      if (res.ok) {
        const data = await res.json();
        const sorted = Array.isArray(data)
          ? [...data].sort((a: any, b: any) =>
              String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' })
            )
          : data;
        setApiProdutos(sorted);
      }
    } catch (e) {
      console.error('Error fetching produtos', e);
    }
  };

  const fetchCategorias = async () => {
    try {
      const res = await API.getCategorias(apiBaseUrl, authHeaders);
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

    if (isWsConnected) return;

    const interval = setInterval(() => {
      fetchTurno();
      fetchDeliveryOrders();
    }, 45000); // Polling lento de fallback se desconectado do WS

    return () => clearInterval(interval);
  }, [isWsConnected]);

  // Fetch optimized statistics, stock, and reports
  useEffect(() => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - parseInt(desempenhoRange));
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    if (activeTab === 'relatorios' && activeSubTab === 'relatorio_garçons') {
      API.getGarconsRelatorio(apiBaseUrl, authHeaders, startStr, endStr)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setWaitersPerformance(data);
        })
        .catch(err => console.error('Error fetching waiter report:', err));
    }
    if (
      (activeTab === 'relatorios' && activeSubTab === 'relatorio_geral') ||
      (activeTab === 'dashboard' && activeSubTab === 'desempenho')
    ) {
      API.getEstatisticasGeral(apiBaseUrl, authHeaders, startStr, endStr)
        .then(res => res.json())
        .then(data => {
          if (data && data.faturamento !== undefined) setGeneralStats(data);
        })
        .catch(err => console.error('Error fetching general stats report:', err));
    }
    if (activeTab === 'estoque') {
      API.getInsumos(apiBaseUrl, authHeaders)
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setEstoqueInsumos(data); })
        .catch(err => console.error('Error fetching insumos:', err));

      API.getSugestoesEstoque(apiBaseUrl, authHeaders)
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setEstoqueSugestoes(data); })
        .catch(err => console.error('Error fetching stock suggestions:', err));

      API.getNotasEstoque(apiBaseUrl, authHeaders)
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setNotasEntrada(data); })
        .catch(err => console.error('Error fetching notas:', err));

      API.getDistribuidores(apiBaseUrl, authHeaders)
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setDistribuidores(data); })
        .catch(err => console.error('Error fetching distribuidores:', err));
    }
    if (activeTab === 'dashboard' && activeSubTab === 'metas') {
      API.getEstatisticasPico(apiBaseUrl, authHeaders)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setHorariosPico(data);
        })
        .catch(err => console.error('Error fetching peak hours:', err));
    }
    if (activeTab === 'clientes') {
      API.getFidelidadeConfig(apiBaseUrl, authHeaders)
        .then(res => res.json())
        .then(data => {
          if (data && data.tipo_recompensa) setFidelidadeConfig(data);
        })
        .catch(err => console.error('Error fetching fidelity config:', err));

      API.getFidelidadeClientes(apiBaseUrl, authHeaders)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setLoyaltyUsers(data);
        })
        .catch(err => console.error('Error fetching loyalty clients:', err));
    }
    if (activeTab === 'cardapio') {
      fetchProdutos();
      fetchCategorias();
    }
    if (activeSubTab === 'config_cardapio') {
      fetchCardapioConfig();
    }
  }, [activeTab, activeSubTab, desempenhoRange]);

  // Sincronização em tempo real do cardápio via WebSocket / Props
  useEffect(() => {
    if (liveProdutos && liveProdutos.length > 0) {
      setApiProdutos(liveProdutos);
    }
  }, [liveProdutos]);

  useEffect(() => {
    if (liveCategorias && liveCategorias.length > 0) {
      setApiCategorias(liveCategorias);
    }
  }, [liveCategorias]);


  // Global Keyboard Shortcuts for PDV (Cashier)
  useEffect(() => {
    if (activeSubTab !== 'pdv') return;

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
        setPdvOrderType('balcao');
        setTimeout(() => {
          const nameInput = document.getElementById('pdv-customer-name-input');
          if (nameInput) nameInput.focus();
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
          const nameInput = document.getElementById('pdv-customer-name-input');
          if (nameInput) nameInput.focus();
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
      const res = await API.abrirCaixa(apiBaseUrl, authHeaders, parseFloat(saldoInicial));
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
      const res = await API.fecharCaixa(apiBaseUrl, authHeaders, {
        declarado_dinheiro: parseFloat(decDinheiro || '0'),
        declarado_pix: turno?.total_esperado_pix || 0,
        declarado_cartao: turno?.total_esperado_cartao || 0
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
      const res = await API.fecharCaixa(apiBaseUrl, authHeaders, {
        declarado_dinheiro: parseFloat(decDinheiro || '0'),
        declarado_pix: turno?.total_esperado_pix || 0,
        declarado_cartao: turno?.total_esperado_cartao || 0
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
      const res = await API.movimentarCaixa(apiBaseUrl, authHeaders, {
        tipo: movTipo,
        valor: parseFloat(movValor),
        descricao: movDesc
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
    if (!selectedOrder || isProcessingPayment) return;
    setErrorMsg('');
    setIsProcessingPayment(true);

    try {
      if (selectedOrder.isGrouped) {
        // Pay all comandas in the group sequentially
        for (const origOrder of selectedOrder.originalOrders) {
          const unpaidItens = origOrder.itens.filter((it: any) => !it.pago);
          if (unpaidItens.length === 0) continue;

          const subtotal = unpaidItens.reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
          const totalWithTax = subtotal * (1.0 + (checkoutServiceTax ? serviceTaxRate / 100 : 0));

          const res = await API.pagarComanda(apiBaseUrl, authHeaders, origOrder.id, {
            valor: parseFloat(totalWithTax.toFixed(2)),
            metodo: paymentMetodo,
            item_ids: null, // pay all items in this comanda
            idempotency_key: `${idempotencyKey}-${origOrder.id}`,
            cpf_cliente: paymentCPF || null
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || `Erro ao pagar comanda #${origOrder.id.slice(-4)}`);
          }
        }

        // Successfully paid all comandas in the group!
        setPaymentValor('');
        setPaymentCPF('');
        setSelectedItemIds([]);
        setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
        setSelectedOrder(null);
        setShowCheckoutModal(false);
        onRefreshOrders();
        fetchTurno();
      } else {
        // Normal single order payment
        const res = await API.pagarComanda(apiBaseUrl, authHeaders, selectedOrder.id, {
          valor: parseFloat(paymentValor),
          metodo: paymentMetodo,
          item_ids: selectedItemIds.length > 0 ? selectedItemIds : null,
          idempotency_key: idempotencyKey,
          cpf_cliente: paymentCPF || null
        });
        if (res.ok) {
          setPaymentValor('');
          setPaymentCPF('');
          setSelectedItemIds([]);
          setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

          // Refresh local details modal state
          const updatedOrdersRes = await API.getTodasDetalhesComandas(apiBaseUrl, authHeaders);
          if (updatedOrdersRes.ok) {
            const freshOrdersList: any[] = await updatedOrdersRes.json();
            const stillOpen = freshOrdersList.find(o => o.id === selectedOrder.id);
            if (stillOpen) {
              setSelectedOrder({
                ...stillOpen,
                valorPago: stillOpen.valor_pago || 0,
                itens: stillOpen.itens.map((item: any) => ({
                  id: item.id,
                  produtoId: item.produto_id || item.produtoId,
                  nome: item.nome || `Item ${item.produto_id || item.produtoId}`,
                  preco: item.preco_unit || item.preco,
                  observacao: item.observacao || '',
                  clienteNome: item.cliente_nome || item.clienteNome || 'Consumo Geral',
                  status: item.status,
                  pago: item.pago
                }))
              });
            } else {
              setSelectedOrder(null);
              setShowCheckoutModal(false);
            }
          }
          onRefreshOrders();
          fetchTurno();
        } else {
          const data = await res.json();
          setErrorMsg(data.detail || 'Erro ao processar pagamento');
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro de conexão ao servidor.');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Free table instantly (Cashier power)
  const handleForceFreeTable = async (mesaId: number) => {
    if (!confirm(`Deseja realmente fechar e liberar a Mesa ${mesaId} de forma forçada?`)) return;
    const tableOrders = orders.filter(o => o.mesaId === mesaId);
    try {
      for (const comanda of tableOrders) {
        await API.fecharComanda(apiBaseUrl, authHeaders, comanda.id);
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

  // Waiter CRUD actions
  const handleAddUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserNome || !newUserUsuario || !newUserSenha) return;
    try {
      const res = await API.cadastrarUsuario(apiBaseUrl, authHeaders, {
        nome: newUserNome,
        usuario: newUserUsuario,
        senha: newUserSenha,
        role: newUserRole
      });
      if (res.ok) {
        setNewUserNome('');
        setNewUserUsuario('');
        setNewUserSenha('');
        fetchSystemUsers();
        alert("Usuário registrado com sucesso!");
      } else {
        const err = await res.json();
        alert(`Erro: ${err.detail}`);
      }
    } catch (err) {
      console.error(err);
      alert("Erro de conexão.");
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Deseja realmente excluir este funcionário?")) return;
    try {
      const res = await API.deletarUsuario(apiBaseUrl, authHeaders, userId);
      if (res.ok) {
        fetchSystemUsers();
      } else {
        alert("Erro ao deletar usuário.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // KDS Kitchen actions (status updates)
  const handleUpdateItemStatus = async (itemId: string, newStatus: 'preparando' | 'pronto' | 'entregue') => {
    try {
      const res = await API.updateItemStatus(apiBaseUrl, authHeaders, Number(itemId), newStatus);
      if (res.ok) {
        onRefreshOrders();
      } else {
        alert("Erro ao atualizar status na cozinha.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Checkout calculations helper
  const getCheckoutTotals = (order: Order) => {
    const unpaidItems = order.itens.filter(i => !i.pago);
    const subtotal = unpaidItems.reduce((sum, item) => sum + item.preco, 0);
    const taxa = (taxaServicoAtiva && checkoutServiceTax) ? subtotal * (serviceTaxRate / 100) : 0;
    const total = subtotal + taxa;
    return { subtotal, taxa, total, unpaidItems };
  };


  // Submit Order from PDV Counter
  const handlePdvSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    if (pdvCart.length === 0) {
      alert("Seu carrinho de vendas está vazio.");
      return;
    }
    if (modoExclusivoSalao) {
      if (pdvOrderType !== 'mesa' || !pdvTargetMesaId || pdvTargetMesaId === 0) {
        alert("Durante o modo de testes de salão, todos os pedidos de venda devem ser vinculados a uma Mesa física ativa.");
        return;
      }
    }
    setIsLoading(true);
    try {
      const openRes = await API.abrirComandaPdv(apiBaseUrl, authHeaders, {
        mesa_id: pdvOrderType === 'mesa' ? pdvTargetMesaId : null,
        garcom_id: 'c-01', // Cashier operator ID
        tipo: pdvOrderType === 'mesa' ? 'Consumo no Local' : (pdvOrderType === 'entrega' ? 'Entrega' : 'Retirada'),
        identificador: pdvCustomerName || undefined,
        delivery_status: pdvOrderType === 'entrega' ? 'producao' : undefined,
        delivery_telefone: pdvOrderType === 'entrega' ? pdvCustomerPhone : undefined,
        delivery_endereco: pdvOrderType === 'entrega' ? pdvDeliveryAddress : undefined,
        delivery_taxa: pdvOrderType === 'entrega' ? parseFloat(pdvDeliveryTaxa) || 0.0 : 0.0
      });
      if (!openRes.ok) {
        const err = await openRes.json();
        alert(`Erro ao abrir comanda: ${err.detail}`);
        setIsLoading(false);
        return;
      }
      const newComanda = await openRes.json();

      const itemsList = pdvCart.flatMap(item =>
        Array.from({ length: item.quantity }, () => ({
          produto_id: item.product.id,
          observacao: item.obs,
          cliente_nome: pdvCustomerName || 'Consumo Geral'
        }))
      );

      const launchRes = await API.lancarItensComanda(apiBaseUrl, authHeaders, newComanda.id, {
        garcom_id: 'c-01',
        itens: itemsList
      });
      if (launchRes.ok) {
        setPdvCart([]);
        setPdvCustomerName('');
        setPdvCustomerPhone('');
        setPdvCustomerCPF('');
        setPdvDeliveryAddress('');
        setPdvDeliveryTaxa('0.00');
        onRefreshOrders();
        fetchDeliveryOrders();
        alert("Pedido lançado com sucesso!");
        if (pdvOrderType === 'mesa') {
          setActiveTab('operacao');
          setActiveSubTab('salon');
        } else {
          setActiveTab('operacao');
          setActiveSubTab('pedidos');
        }
      } else {
        const err = await launchRes.json();
        alert(`Erro ao lançar itens: ${err.detail}`);
      }
    } catch (err) {
      console.error(err);
      alert("Erro ao conectar ao servidor.");
    } finally {
      setIsLoading(false);
    }
  };

  // Search printers trigger
  const handleSearchPrinters = async () => {
    setIsSearchingPrinters(true);
    setDetectedPrinters([]);
    try {
      const res = await API.getImpressorasDetectadas(apiBaseUrl, authHeaders);
      if (res.ok) {
        const data = await res.json();
        setDetectedPrinters(data);
      } else {
        alert('Erro ao buscar impressoras conectadas.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao buscar impressoras.');
    } finally {
      setIsSearchingPrinters(false);
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

    // Call real backend endpoint /api/chat-waiter
    (async () => {
      try {
        const response = await API.chatWaiter(apiBaseUrl, authHeaders, {
          brandName: 'Kôma Bistrô',
          slogan: 'Gastronomia Urbana',
          menuItems: PRODUCTS.map(p => ({ name: p.nome, price: p.preco })),
          history: chatbotMessages.map(m => ({
            role: m.sender === 'user' ? 'user' : 'model',
            text: m.text
          })),
          message: promptText
        });
        if (response.ok) {
          const data = await response.json();
          setChatbotMessages(prev => [
            ...prev,
            {
              sender: 'bot',
              text: data.reply || 'Desculpe, tive um problema para processar sua mensagem.',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
          ]);
        } else {
          throw new Error('Failed to fetch from chat waiter');
        }
      } catch (err) {
        console.error(err);
        setChatbotMessages(prev => [
          ...prev,
          {
            sender: 'bot',
            text: 'Desculpe, estou com dificuldades para me conectar ao servidor agora.',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      } finally {
        setIsBotTyping(false);
      }
    })();
  };

  // FILTERED menu list for PDV
  const filteredProducts = dynamicMenu.filter(p => {
    const matchesSearch = p.nome.toLowerCase().includes(pdvSearch.toLowerCase()) || p.descricao.toLowerCase().includes(pdvSearch.toLowerCase());
    const matchesCategory = pdvSelectedCategory === 'todos' || p.categoria === pdvSelectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Extract all active kitchen items from orders database
  const activeKitchenItems = orders.flatMap(order =>
    order.itens
      .filter(item => item.status === 'preparando' || item.status === 'pronto')
      .filter(() => {
        if (modoExclusivoSalao) {
          return order.mesaId !== null && order.mesaId > 0;
        }
        return true;
      })
      .map(item => ({
        ...item,
        orderId: order.id,
        mesaId: order.mesaId,
        garcomNome: order.garcomNome,
        timestamp: order.timestamp
      }))
  );

  return (
    <div className={`flex h-[88vh] bg-[#0B0B0C] text-white overflow-hidden rounded-3xl border border-[#27272A] font-sans selection:bg-[#10b981]/30 text-xs ${fontSize === 'grande' ? 'font-large' : fontSize === 'gigante' ? 'font-huge' : ''
      }`}>

      {/* SIDEBAR - ANOTA AI / KOMA THEME */}
      <aside className={clsx('w-64', 'bg-[#121214]', 'border-r', 'border-[#27272A]', 'flex', 'flex-col', 'justify-between', 'shrink-0')}>
        <div className={clsx('space-y-6', 'pt-5')}>
          {/* Brand header */}
          <div className={clsx('px-5', 'flex', 'items-center', 'justify-between')}>
            <div className={clsx('flex', 'items-center', 'gap-2')}>
              <div className={clsx('h-7.5', 'w-7.5', 'bg-[#10b981]', 'rounded-xl', 'flex', 'items-center', 'justify-center', 'font-bold', 'text-[#121214]', 'font-serif', 'text-sm')}>K</div>
              <div className={clsx('font-serif', 'font-bold', 'text-sm', 'tracking-tight')}>Kôma Caixa</div>
            </div>
            {turno?.status === 'aberto' ? (
              <span className={clsx('h-2', 'w-2', 'rounded-full', 'bg-emerald-500', 'animate-pulse')} title="Caixa Aberto" />
            ) : (
              <span className={clsx('h-2', 'w-2', 'rounded-full', 'bg-emerald-600')} title="Caixa Fechado" />
            )}
          </div>

          {/* Quick status bar */}
          <div className="px-3.5">
            <div className={clsx('bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-2xl', 'p-2.5', 'flex', 'items-center', 'justify-between')}>
              <div className="space-y-0.5">
                <span className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'text-gray-400', 'font-bold', 'block')}>Status do Turno</span>
                <span className={clsx('font-semibold', 'text-[10px]', 'text-white')}>
                  {turno?.status === 'aberto' ? 'Caixa Aberto' : 'Caixa Fechado'}
                </span>
              </div>
              {turno?.status === 'aberto' ? (
                <button
                  onClick={() => setShowFecharModal(true)}
                  className={clsx('px-2', 'py-1', 'bg-emerald-600', 'hover:bg-[#601823]', 'text-white', 'text-[9px]', 'font-bold', 'rounded-lg', 'cursor-pointer', 'transition-all', 'uppercase', 'tracking-wider')}
                >
                  Fechar
                </button>
              ) : (
                <button
                  onClick={() => setShowAbrirModal(true)}
                  className={clsx('px-2', 'py-1', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'text-[9px]', 'font-bold', 'rounded-lg', 'cursor-pointer', 'transition-all', 'uppercase', 'tracking-wider', 'animate-pulse-subtle')}
                >
                  Abrir
                </button>
              )}
            </div>
          </div>

          {/* Tabs Navigation */}
          <nav className={clsx('px-2.5', 'space-y-4', 'overflow-y-auto', 'flex-1', 'max-h-[calc(88vh-230px)]', 'scrollbar-thin', 'scrollbar-thumb-zinc-800', 'text-left')}>
            {[
              {
                category: 'Fluxo Operacional',
                items: [
                  { id: 'operacao', label: 'Painel de Vendas', icon: ShoppingCart },
                  { id: 'cardapio', label: 'Gestão de Menu', icon: ClipboardList },
                  { id: 'estoque', label: 'Controle de Estoque', icon: Package }
                ]
              },
              {
                category: 'Gestão de Tesouraria',
                items: [
                  { id: 'financeiro', label: 'Caixa & Notas', icon: DollarSign },
                  { id: 'clientes', label: 'CRM & Fidelidade', icon: Users }
                ]
              },
              {
                category: 'Performance & BI',
                items: [
                  { id: 'dashboard', label: 'Indicadores', icon: BarChart2 },
                  { id: 'relatorios', label: 'Histórico de Vendas', icon: TrendingUp }
                ]
              },
              {
                category: 'Processos Inteligentes',
                items: [
                  { id: 'robo_ia', label: 'Configurar Robô', icon: Cpu },
                  { id: 'chat_copiloto', label: 'Chat Co-Piloto (IA)', icon: MessageSquare }
                ]
              },
              {
                category: 'Parâmetros do Sistema',
                items: [
                  { id: 'configuracoes', label: 'Ajustes de Retaguarda', icon: Smartphone },
                  { id: 'config_cardapio', label: 'Configurações do Cardápio', icon: Globe }
                ]
              }
            ].map((group, gIdx) => (
              <div key={gIdx} className="space-y-1">
                <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'text-gray-500', 'font-bold', 'px-3.5', 'block', 'mb-1')}>
                  {group.category}
                </span>
                {group.items.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        if (tab.id === 'config_cardapio') {
                          setActiveTab('configuracoes');
                          setActiveSubTab('config_cardapio');
                        } else if (tab.id === 'chat_copiloto') {
                          setActiveTab('operacao');
                          setActiveSubTab('chat_copiloto');
                        } else {
                          handleTabChange(tab.id as any);
                        }
                      }}
                      className={`w-full px-3.5 py-1.5 rounded-xl text-left font-semibold transition-all flex items-center justify-between cursor-pointer group ${(tab.id === 'config_cardapio' ? (activeTab === 'configuracoes' && activeSubTab === 'config_cardapio') : tab.id === 'chat_copiloto' ? (activeTab === 'operacao' && activeSubTab === 'chat_copiloto') : activeTab === tab.id)
                        ? 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/10 font-bold shadow-inner'
                        : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]/50 border border-transparent'
                        }`}
                    >
                      <div className={clsx('flex', 'items-center', 'gap-3')}>
                        <Icon size={13} className={(tab.id === 'config_cardapio' ? (activeTab === 'configuracoes' && activeSubTab === 'config_cardapio') : tab.id === 'chat_copiloto' ? (activeTab === 'operacao' && activeSubTab === 'chat_copiloto') : activeTab === tab.id) ? 'text-[#10b981]' : 'text-gray-500 group-hover:text-white'} />
                        <span className="text-[10px]">{tab.label}</span>
                      </div>
                      {tab.id === 'operacao' && (simulatedOrders.filter(o => o.status === 'pendente' || o.status === 'analise').length + activeKitchenItems.length) > 0 && (
                        <span className={clsx('bg-[#10b981]', 'text-[#121214]', 'text-[7px]', 'font-bold', 'px-1.5', 'py-0.5', 'rounded-full', 'font-mono')}>
                          {simulatedOrders.filter(o => o.status === 'pendente' || o.status === 'analise').length + activeKitchenItems.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* Footer info */}
        <div className={clsx('p-4', 'border-t', 'border-[#27272A]', 'space-y-2', 'bg-[#18181B]/40')}>
          <div className="space-y-1">
            <span className={clsx('text-[8px]', 'text-gray-500', 'uppercase', 'tracking-widest', 'block', 'font-bold')}>Acessibilidade / Fonte</span>
            <div className={clsx('grid', 'grid-cols-3', 'gap-0.5', 'bg-[#09090B]', 'p-0.5', 'rounded-lg', 'border', 'border-[#27272A]')}>
              {(['padrao', 'grande', 'gigante'] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => changeFontSize(sz)}
                  className={`py-0.5 rounded text-[8px] font-bold uppercase transition-all cursor-pointer ${fontSize === sz
                    ? 'bg-[#10b981] text-[#121214]'
                    : 'text-gray-400 hover:text-white'
                    }`}
                >
                  {sz === 'padrao' ? 'Pad' : sz === 'grande' ? 'Grd' : 'Ggt'}
                </button>
              ))}
            </div>
          </div>

          <div className={clsx('border-t', 'border-[#27272A]/50', 'pt-2', 'space-y-1')}>
            <span className={clsx('text-[9px]', 'text-gray-500', 'uppercase', 'tracking-widest', 'block')}>Operador ativo</span>
            <span className={clsx('font-bold', 'text-white', 'block', 'truncate')}>{activeWaiterNome}</span>
            <span className={clsx('text-[9px]', 'text-[#10b981]', 'flex', 'items-center', 'gap-1', 'mt-1', 'font-mono')}>
              <span className={clsx('h-1', 'w-1', 'bg-emerald-500', 'rounded-full', 'animate-ping')} />
              Sincronização Online
            </span>
          </div>
        </div>
      </aside>

      {/* CONTENT AREA */}
      <main className={clsx('flex-1', 'bg-[#09090B]', 'flex', 'flex-col', 'overflow-hidden')}>
        {/* Top header bar */}
        <header className={clsx('h-14', 'border-b', 'border-[#27272A]', 'bg-[#121214]', 'px-6', 'flex', 'items-center', 'justify-between', 'shrink-0')}>
          <h2 className={clsx('font-serif', 'font-bold', 'text-sm', 'tracking-tight', 'text-white', 'uppercase', 'tracking-wider')}>
            {activeTab === 'dashboard' && 'Painel Executivo e Metas'}
            {activeTab === 'operacao' && 'Gestão de Atendimento Local'}
            {activeTab === 'cardapio' && 'Gestão e Engenharia do Cardápio'}
            {activeTab === 'estoque' && 'Controle de Inventário e Insumos'}
            {activeTab === 'financeiro' && 'Tesouraria e Fluxo de Caixa'}
            {activeTab === 'clientes' && 'Carteira de Clientes e CRM'}
            {activeTab === 'relatorios' && 'Relatórios e Estatísticas Avançadas'}
            {activeTab === 'robo_ia' && 'Assistente de Atendimento IA'}
            {activeTab === 'configuracoes' && 'Configurações e Parâmetros'}
          </h2>

          <div className={clsx('flex', 'items-center', 'gap-3')}>
            <button
              onClick={() => {
                fetchTurno();
                onRefreshOrders();
                fetchSystemUsers();
              }}
              className={clsx('p-1.5', 'hover:bg-[#1C1C1F]', 'rounded-lg', 'border', 'border-[#27272A]', 'text-gray-400', 'hover:text-white', 'transition-all', 'cursor-pointer', 'flex', 'items-center', 'gap-1.5')}
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
              <span className={clsx('text-[9px]', 'font-bold', 'font-mono')}>Atualizar</span>
            </button>
          </div>
        </header>

        {/* Sub-tabs Navigation Bar */}
        <div className={clsx('bg-[#121214]/60', 'border-b', 'border-[#27272A]', 'px-6', 'py-1.5', 'flex', 'gap-2', 'shrink-0', 'overflow-x-auto', 'scrollbar-none')}>
          {activeTab === 'dashboard' && [
            { id: 'desempenho', label: 'Minha Performance' },
            { id: 'metas', label: 'Metas & Previsões' },
            { id: 'top10', label: 'Itens Mais Vendidos' }
          ].map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${activeSubTab === sub.id
                ? 'bg-[#10b981] text-[#121214]'
                : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              {sub.label}
            </button>
          ))}

          {activeTab === 'operacao' && [
            { id: 'pedidos', label: 'Fila de Pedidos' },
            { id: 'pdv', label: 'Terminal Balcão' },
            { id: 'salon', label: 'Layout do Salão', show: !isDelivery && modulesActive.salon },
            { id: 'entregadores', label: 'Fretistas & Logística', show: !isBistro && !modoExclusivoSalao && modulesActive.delivery }
          ].filter(sub => sub.show !== false).map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${activeSubTab === sub.id
                ? 'bg-[#10b981] text-[#121214]'
                : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              {sub.label}
            </button>
          ))}

          {activeTab === 'cardapio' && [
            { id: 'cardapio_lista', label: 'Cardápio' },
            { id: 'ficha_tecnica', label: 'Custos e CMV' },
            { id: 'disponibilidade', label: 'Disponibilidade' },
            { id: 'categorias_lista', label: 'Categorias de Menu' }
          ].map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${activeSubTab === sub.id
                ? 'bg-[#10b981] text-[#121214]'
                : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              {sub.label}
            </button>
          ))}

          {activeTab === 'estoque' && [
            { id: 'insumos', label: 'Estoque de Insumos' },
            { id: 'xml', label: 'Notas de Entrada' },
            { id: 'fornecedores', label: 'Distribuidores' }
          ].map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${activeSubTab === sub.id
                ? 'bg-[#10b981] text-[#121214]'
                : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              {sub.label}
            </button>
          ))}

          {activeTab === 'financeiro' && [
            { id: 'fluxo', label: 'Demonstrativo DRE' },
            { id: 'fechamento', label: 'Conferência Cega' },
            { id: 'suprimento', label: 'Ajustes de Caixa' },
            { id: 'fiscal', label: 'Notas Fiscais Emitidas' }
          ].map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${activeSubTab === sub.id
                ? 'bg-[#10b981] text-[#121214]'
                : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              {sub.label}
            </button>
          ))}

          {activeTab === 'clientes' && [
            { id: 'crm', label: 'Banco de Clientes' },
            { id: 'fidelidade', label: 'Programa Fidelidade' },
            { id: 'cupom', label: 'Cupons de Desconto' },
            { id: 'recuperador', label: 'Carrinhos Abandonados' }
          ].map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${activeSubTab === sub.id
                ? 'bg-[#10b981] text-[#121214]'
                : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              {sub.label}
            </button>
          ))}

          {activeTab === 'relatorios' && [
            { id: 'relatorio_geral', label: 'Consolidado de Vendas' },
            { id: 'relatorio_garçons', label: 'Faturamento por Garçom' }
          ].map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${activeSubTab === sub.id
                ? 'bg-[#10b981] text-[#121214]'
                : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              {sub.label}
            </button>
          ))}

          {activeTab === 'robo_ia' && [
            { id: 'prompt', label: 'Prompt do Atendente' },
            { id: 'simulador', label: 'Simulador de Chat' }
          ].map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${activeSubTab === sub.id
                ? 'bg-[#10b981] text-[#121214]'
                : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              {sub.label}
            </button>
          ))}

          {activeTab === 'configuracoes' && [
            { id: 'equipe', label: 'Cargos & Permissões' },
            { id: 'impressoras', label: 'Roteamento de Impressoras', show: !isPocket },
            { id: 'nicho_wizard', label: 'Setup Wizard (Nicho)' },
            { id: 'planos', label: 'Planos & Integrações' }
          ].filter(sub => sub.show !== false).map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id)}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${activeSubTab === sub.id
                ? 'bg-[#10b981] text-[#121214]'
                : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              {sub.label}
            </button>
          ))}
        </div>

        {/* Dynamic Inner views */}
        <div className={clsx('flex-1', 'overflow-y-auto', 'p-5', 'relative')}>

          {/* CASHIER CLOSED WARNING BANNER */}
          {turno?.status !== 'aberto' && ['pedidos', 'pdv', 'salon', 'kds'].includes(activeSubTab) && (
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
                                try {
                                  const res = await API.aprovarPagamentoPendente(apiBaseUrl, authHeaders, pag.id);
                                  if (res.ok) {
                                    alert("Pagamento em dinheiro confirmado com sucesso!");
                                    onRefreshOrders();
                                    if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
                                  }
                                } catch (e) {
                                  console.error(e);
                                }
                              }}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[9px] uppercase tracking-wider transition-all cursor-pointer"
                            >
                              Confirmar Recebimento
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const res = await API.recusarPagamentoPendente(apiBaseUrl, authHeaders, pag.id);
                                  if (res.ok) {
                                    alert("Pagamento recusado.");
                                    onRefreshOrders();
                                    if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
                                  }
                                } catch (e) {
                                  console.error(e);
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

              {/* Controls bar */}
              {!modoExclusivoSalao && (
                <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-3', 'rounded-2xl', 'flex', 'flex-col', 'sm:flex-row', 'justify-between', 'items-start', 'sm:items-center', 'gap-3')}>
                  <div className={clsx('flex', 'items-center', 'gap-4')}>
                    <label className={clsx('flex', 'items-center', 'gap-2', 'cursor-pointer', 'font-semibold', 'text-gray-300')}>
                      <input
                        type="checkbox"
                        checked={autoAccept}
                        onChange={(e) => setAutoAccept(e.target.checked)}
                        className={clsx('rounded', 'border-[#27272A]', 'text-emerald-500', 'focus:ring-emerald-500', 'h-3.5', 'w-3.5', 'bg-[#121214]')}
                      />
                      <span>Aceitar os pedidos automaticamente (iFood/Apps)</span>
                    </label>
                  </div>
                  <div className={clsx('flex', 'items-center', 'gap-4')}>
                    <div className={clsx('text-[10px]', 'text-gray-400')}>
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
                                <span className="px-1.5 py-0.5 text-[8px] uppercase tracking-wider font-bold bg-amber-500/10 text-amber-400 rounded font-mono block w-fit mb-1">{order.canal}</span>
                                <strong className="text-white text-sm block">{order.cliente}</strong>
                                <span className="text-[10px] text-gray-400 block">{order.telefone}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-bold text-amber-400 font-mono text-sm block">R$ {order.total.toFixed(2)}</span>
                                <span className="text-[9px] text-gray-500">{order.criadoEm}</span>
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

              {/* ══════════════════════════════════════════════════════════
                   KANBAN — 3 Colunas Reestruturadas
                   Col 1: Produção Local (item a item)
                   Col 2: Delivery & Retirada
                   Col 3: Fechamento & Contas
              ══════════════════════════════════════════════════════════ */}
              <CaixaKanbanBoard
                localProductionRounds={localProductionRounds}
                simulatedOrders={simulatedOrders}
                groupedTableOrdersReady={groupedTableOrdersReady}
                orders={orders}
                modoExclusivoSalao={modoExclusivoSalao}
                plano={plano}
                activeMotoboysList={activeMotoboysList}
                isLoading={isLoading}
                taxaServicoAtiva={taxaServicoAtiva}
                serviceTaxRate={serviceTaxRate}
                handleProntoItemAction={handleProntoItemAction}
                handleProntoRoundAction={handleProntoRoundAction}
                handleDespacharPedido={handleDespacharPedido}
                handleUpdateDeliveryStatus={handleUpdateDeliveryStatus}
                handleFinalizarPedido={handleFinalizarPedido}
                setSelectedMotoboys={setSelectedMotoboys}
                setSelectedOrder={setSelectedOrder}
                setShowCheckoutModal={setShowCheckoutModal}
                setCheckoutServiceTax={setCheckoutServiceTax}
                setSplitPeople={setSplitPeople}
                setSelectedItemIds={setSelectedItemIds}
                setPaymentValor={setPaymentValor}
                openSimulatedOrderDetails={openSimulatedOrderDetails}
                setSelectedKanbanOrder={setSelectedKanbanOrder}
              />
            </div>
          )}



          {/* VIEW 2: PDV (Pedidos Balcão) */}
          {activeSubTab === 'pdv' && (
            <CaixaBalcaoTab
              products={dynamicMenu}
              pdvCart={pdvCart}
              setPdvCart={setPdvCart}
              pdvSearch={pdvSearch}
              setPdvSearch={setPdvSearch}
              pdvOrderType={pdvOrderType}
              setPdvOrderType={setPdvOrderType}
              pdvCustomerName={pdvCustomerName}
              setPdvCustomerName={setPdvCustomerName}
              pdvCustomerPhone={pdvCustomerPhone}
              setPdvCustomerPhone={setPdvCustomerPhone}
              pdvDeliveryAddress={pdvDeliveryAddress}
              setPdvDeliveryAddress={setPdvDeliveryAddress}
              pdvDeliveryTaxa={pdvDeliveryTaxa}
              setPdvDeliveryTaxa={setPdvDeliveryTaxa}
              pdvTargetMesaId={pdvTargetMesaId}
              setPdvTargetMesaId={setPdvTargetMesaId}
              salonTables={salonTables}
              orders={orders}
              modoExclusivoSalao={modoExclusivoSalao}
              handlePdvSubmitOrder={handlePdvSubmitOrder}
              isLoading={isLoading}
            />
          )}

          {/* VIEW 3: MAPA DE MESAS (Salão) */}
          {activeSubTab === 'salon' && (
            <CaixaSalaoTab
              salonTables={salonTables}
              orders={orders}
              pagamentosPendentes={pagamentosPendentes}
              setShowAddMesaModal={setShowAddMesaModal}
              onUpdateMesa={onUpdateMesa}
              handleDeleteMesaAction={handleDeleteMesaAction}
              handleForceFreeTable={handleForceFreeTable}
              setSelectedOrder={setSelectedOrder}
              setShowCheckoutModal={setShowCheckoutModal}
              setCheckoutServiceTax={setCheckoutServiceTax}
              setSplitPeople={setSplitPeople}
              setSelectedItemIds={setSelectedItemIds}
              setPaymentValor={setPaymentValor}
              serviceTaxRate={serviceTaxRate}
              checkoutServiceTax={checkoutServiceTax}
              isLoading={isLoading}
            />
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
                    {simulatedOrders.filter(o => o.status === 'pendente' || o.status === 'analise').length}
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
                    {simulatedOrders.filter(o => o.status === 'transito' || o.status === 'pronto').length}
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
                          <span className={`px-2 py-0.5 text-[8px] font-bold rounded font-mono ${item.status === 'pronto' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[#10b981]/15 text-[#10b981]'
                            }`}>
                            {item.status}
                          </span>
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

          {/* VIEW 6: GESTÃO DE SALÃO (CRUD Garçons & Taxas) */}
          {activeSubTab === 'equipe' && (
            <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5')}>

              {/* CRUD table list */}
              <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Cadastro de Funcionários (Equipe)</span>

                <div className="overflow-x-auto">
                  <table className={clsx('w-full', 'text-left', 'font-sans', 'text-xs', 'border-collapse')}>
                    <thead>
                      <tr className={clsx('border-b', 'border-[#27272A]', 'text-gray-400', 'font-bold')}>
                        <th className="py-2">Nome</th>
                        <th className="py-2">Nome de Usuário (Login)</th>
                        <th className="py-2">Cargo</th>
                        <th className={clsx('py-2', 'text-right')}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {systemUsers.map(user => (
                        <tr key={user.id} className={clsx('border-b', 'border-[#27272A]/40', 'hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                          <td className={clsx('py-2.5', 'text-white', 'font-bold')}>{user.nome}</td>
                          <td className={clsx('py-2.5', 'font-mono', 'text-gray-400')}>{user.usuario}</td>
                          <td className="py-2.5">
                            <span className={`px-2 py-0.5 text-[8px] font-bold rounded uppercase tracking-wider ${user.role === 'admin' ? 'bg-emerald-600/20 text-[#C46A74]' : user.role === 'caixa' ? 'bg-[#10b981]/10 text-[#10b981]' : 'bg-emerald-500/10 text-emerald-400'
                              }`}>{user.role}</span>
                          </td>
                          <td className={clsx('py-2.5', 'text-right')}>
                            {user.role !== 'admin' && (
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
                      ))}
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
                      <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Nome de Usuário (Login):</label>
                      <input
                        type="text"
                        required
                        placeholder="pedro123"
                        value={newUserUsuario}
                        onChange={(e) => setNewUserUsuario(e.target.value)}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono', 'text-[10px]')}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Senha Acesso:</label>
                      <input
                        type="password"
                        required
                        placeholder="Mínimo 3 dígitos"
                        value={newUserSenha}
                        onChange={(e) => setNewUserSenha(e.target.value)}
                        className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]')}
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
                      </select>
                    </div>
                    <button type="submit" className={clsx('w-full', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'text-[9px]', 'uppercase', 'tracking-wider', 'rounded-lg', 'transition-all', 'cursor-pointer')}>Registrar Equipe</button>
                  </form>
                </div>

                {/* Service tax config */}
                <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-3')}>
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
                    <div className={clsx('space-y-1', 'pt-1.5', 'animate-scale-in')}>
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

              </div>

            </div>
          )}

          {/* VIEW 7: CONFIGURAÇÕES SALÃO (App Garçom & Impressoras) */}
          {activeSubTab === 'impressoras' && (
            <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5')}>

              {/* Waiters permissions switches (Left Column) */}
              {!isDelivery && (
                <div className={clsx(isPocket ? 'lg:col-span-3' : 'lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'flex', 'flex-col', 'overflow-hidden')}>
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
                        { title: "Permitir impressão automática dos pedidos feitos pelo Garçom", desc: "Dispara a via térmica de produção no balcão imediatamente após o garçom confirmar.", checked: plano === 'pocket' ? false : permAutoPrint, onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_print: val }), disabled: plano === 'pocket' }
                      ].map((item, idx) => (
                        <div key={idx} className={clsx('flex', 'justify-between', 'items-start', 'gap-4')}>
                          <div className="space-y-0.5">
                            <strong className={clsx('text-white', 'block', 'font-semibold', item.disabled && 'opacity-50')}>{item.title}</strong>
                            <span className={clsx('text-[9px]', 'text-gray-500', 'block', 'leading-relaxed', item.disabled && 'opacity-50')}>{item.desc}</span>
                          </div>
                          <label className={clsx('relative', 'inline-flex', 'items-center', 'shrink-0', 'mt-0.5', item.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer')}>
                            <input type="checkbox" checked={item.checked} disabled={item.disabled} onChange={(e) => item.onChange(e.target.checked)} className={clsx('sr-only', 'peer')} />
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
              {!isPocket && (
                <div className={clsx(isDelivery ? 'lg:col-span-3' : 'lg:col-span-1', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'flex', 'flex-col', 'justify-between')}>
                  <div className="space-y-4">
                    <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Impressoras térmicas</span>

                    <div className={clsx('space-y-3', 'text-left')}>
                      <div className="space-y-1">
                        <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Mensagem de Cabeçalho:</label>
                        <input
                          type="text"
                          value={printHeader}
                          onChange={(e) => {
                            setPrintHeader(e.target.value);
                            localStorage.setItem("koma_print_header", e.target.value);
                          }}
                          className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]')}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Mensagem de Rodapé:</label>
                        <input
                          type="text"
                          value={printFooter}
                          onChange={(e) => {
                            setPrintFooter(e.target.value);
                            localStorage.setItem("koma_print_footer", e.target.value);
                          }}
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

                    <div className="space-y-2">
                      <button
                        onClick={handleSearchPrinters}
                        className={clsx('w-full', 'py-1.5', 'bg-[#1C1C1F]', 'hover:bg-[#27272A]', 'border', 'border-[#27272A]', 'text-gray-300', 'font-bold', 'rounded-lg', 'text-[9px]', 'uppercase', 'tracking-wider', 'flex', 'items-center', 'justify-center', 'gap-1.5', 'cursor-pointer')}
                      >
                        <Printer size={12} />
                        <span>{isSearchingPrinters ? 'Procurando...' : 'Achar Impressoras'}</span>
                      </button>

                      {detectedPrinters.length > 0 && (
                        <div className={clsx('space-y-1', 'animate-scale-in')}>
                          {detectedPrinters.map((p, idx) => (
                            <div key={idx} className={clsx('p-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'text-[9px]', 'text-gray-400', 'font-mono', 'flex', 'justify-between', 'items-center')}>
                              <span>{p}</span>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const res = await API.testeImpressao(apiBaseUrl, authHeaders, {});
                                    if (res.ok) {
                                      alert('Cupom de teste enviado para a impressora Gertec G250!');
                                    } else {
                                      alert('Erro ao disparar teste de impressão.');
                                    }
                                  } catch (e) {
                                    console.error(e);
                                    alert('Erro de conexão ao testar impressora.');
                                  }
                                }}
                                className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'text-[#10b981]', 'font-bold', 'hover:text-white', 'cursor-pointer')}
                              >
                                Teste
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Mockup live preview coupon */}
                  <div className={clsx('bg-[#FFFFFC]', 'text-black', 'p-4', 'rounded-xl', 'border', 'border-gray-300', 'font-mono', 'text-[9px]', 'space-y-3', 'shadow-inner', 'my-2')}>
                    <div className={clsx('text-center', 'font-bold', 'border-b', 'border-dashed', 'border-gray-400', 'pb-1.5', 'uppercase', 'leading-normal')}>
                      <span>{printHeader}</span>
                    </div>
                    <div className="space-y-1">
                      <div className={clsx('flex', 'justify-between')}>
                        <span>1x Pastel Carne</span>
                        <span>R$ 12,00</span>
                      </div>
                      <div className={clsx('flex', 'justify-between')}>
                        <span>1x Coca-Cola</span>
                        <span>R$ 6,00</span>
                      </div>
                    </div>
                    <div className={clsx('flex', 'justify-between', 'font-bold', 'border-t', 'border-dashed', 'border-gray-400', 'pt-1', 'text-[10px]')}>
                      <span>Total:</span>
                      <span>R$ 18,00</span>
                    </div>
                    <div className={clsx('text-center', 'text-[8px]', 'text-gray-600', 'border-t', 'border-dashed', 'border-gray-400', 'pt-1.5', 'uppercase', 'leading-normal')}>
                      <span>{printFooter}</span>
                    </div>
                  </div>

                </div>
              )}

            </div>
          )}

          {/* VIEW 8A: ROBÔ & IA - CONFIGURAÇÕES DO PROMPT & GOVERNANÇA */}
          {activeTab === 'robo_ia' && activeSubTab === 'prompt' && (
            <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5', 'text-left', 'animate-fade-in')}>
              {/* Left Column: System Prompt */}
              <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
                <div className={clsx('border-b', 'border-[#27272A]', 'pb-3', 'flex', 'justify-between', 'items-center')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Prompt do Atendente Virtual</span>
                  <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer')}>
                    <input type="checkbox" checked={aiBotActive} onChange={(e) => setAiBotActive(e.target.checked)} className={clsx('sr-only', 'peer')} />
                    <div className={clsx('w-8', 'h-4.5', 'bg-[#27272A]', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-3.5', 'after:w-3.5', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                  </label>
                </div>

                <div className="space-y-2">
                  <label className={clsx('text-[9px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Diretrizes da IA (Prompt de Sistema):</label>
                  <textarea
                    rows={8}
                    value={aiSystemPrompt}
                    onChange={(e) => setAiSystemPrompt(e.target.value)}
                    className={clsx('w-full', 'p-3', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white', 'text-[10px]', 'resize-none', 'leading-relaxed', 'font-mono')}
                  />
                  <span className={clsx('text-[8px]', 'text-gray-500', 'block', 'leading-relaxed')}>
                    Instrua a inteligência artificial sobre a história da sua casa, especialidades do cardápio e regras de tom de voz. Evite comandos conflitantes com as travas de governança ao lado.
                  </span>
                </div>
              </div>

              {/* Right Column: Painel de Governança */}
              <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'flex', 'flex-col', 'justify-between')}>
                <div className="space-y-4">
                  <div className={clsx('border-b', 'border-[#27272A]', 'pb-2')}>
                    <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block')}>Segurança & Governança da IA</span>
                    <span className={clsx('text-[8px]', 'text-gray-500', 'block', 'mt-0.5')}>Defina limites comerciais estritos para evitar abusos ou prejuízos nas conversas automatizadas.</span>
                  </div>

                  {/* Negociar Descontos Toggle */}
                  <div className={clsx('bg-[#1C1C1F]/40', 'border', 'border-[#27272A]/40', 'rounded-xl', 'p-3', 'flex', 'justify-between', 'items-center')}>
                    <div className="space-y-0.5">
                      <span className={clsx('text-[9px]', 'font-bold', 'text-white', 'block')}>Negociar Descontos</span>
                      <span className={clsx('text-[7px]', 'text-gray-500', 'block')}>Autoriza IA a oferecer cupons no chat</span>
                    </div>
                    <button
                      onClick={() => setIaDiscountEnabled(!iaDiscountEnabled)}
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none cursor-pointer ${iaDiscountEnabled ? 'bg-emerald-600' : 'bg-[#27272A]'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-[#121214] shadow-md transform duration-200 ${iaDiscountEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Teto de Desconto Selector */}
                  {iaDiscountEnabled && (
                    <div className={clsx('space-y-1.5', 'animate-fade-in')}>
                      <label className={clsx('text-[8px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-widest', 'block')}>Teto de Desconto Permitido (%):</label>
                      <div className={clsx('flex', 'gap-2', 'items-center')}>
                        <input
                          type="range"
                          min="5"
                          max="25"
                          step="5"
                          value={iaMaxDiscount}
                          onChange={(e) => setIaMaxDiscount(Number(e.target.value))}
                          className={clsx('flex-1', 'accent-[#10b981]', 'cursor-pointer')}
                        />
                        <span className={clsx('text-[10px]', 'font-mono', 'font-bold', 'text-white', 'bg-[#09090B]', 'px-2.5', 'py-1', 'border', 'border-[#27272A]', 'rounded-lg')}>{iaMaxDiscount}%</span>
                      </div>
                    </div>
                  )}

                  {/* Upsell Ativo Toggle */}
                  <div className={clsx('bg-[#1C1C1F]/40', 'border', 'border-[#27272A]/40', 'rounded-xl', 'p-3', 'flex', 'justify-between', 'items-center')}>
                    <div className="space-y-0.5">
                      <span className={clsx('text-[9px]', 'font-bold', 'text-white', 'block')}>Upsell / Sugestões Ativas</span>
                      <span className={clsx('text-[7px]', 'text-gray-500', 'block')}>Sugere adicionais e bebidas para aumentar o ticket</span>
                    </div>
                    <button
                      onClick={() => setIaUpsellEnabled(!iaUpsellEnabled)}
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none cursor-pointer ${iaUpsellEnabled ? 'bg-emerald-600' : 'bg-[#27272A]'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-[#121214] shadow-md transform duration-200 ${iaUpsellEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Tom de Voz selector */}
                  <div className="space-y-1.5">
                    <label className={clsx('text-[8px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-widest', 'block')}>Personalidade / Tom de Voz:</label>
                    <div className={clsx('grid', 'grid-cols-2', 'gap-2')}>
                      <button
                        onClick={() => setIaVoiceTone('direto')}
                        className={`py-1.5 rounded-xl border text-[9px] font-bold transition-all cursor-pointer ${iaVoiceTone === 'direto'
                          ? 'bg-[#10b981]/15 border-[#10b981] text-[#10b981]'
                          : 'bg-[#1C1C1F]/40 border-[#27272A] text-gray-500'
                          }`}
                      >
                        Direto (Economiza Tokens)
                      </button>
                      <button
                        onClick={() => setIaVoiceTone('conversador')}
                        className={`py-1.5 rounded-xl border text-[9px] font-bold transition-all cursor-pointer ${iaVoiceTone === 'conversador'
                          ? 'bg-[#10b981]/15 border-[#10b981] text-[#10b981]'
                          : 'bg-[#1C1C1F]/40 border-[#27272A] text-gray-500'
                          }`}
                      >
                        Conversador (Fidelidade)
                      </button>
                    </div>
                  </div>

                  {/* Teto de Interações selector */}
                  <div className="space-y-1.5">
                    <label className={clsx('text-[8px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-widest', 'block')}>Teto de Mensagens sem Pedido:</label>
                    <div className={clsx('flex', 'gap-2', 'items-center')}>
                      <select
                        value={iaMaxInteractions}
                        onChange={(e) => setIaMaxInteractions(Number(e.target.value))}
                        className={clsx('flex-1', 'px-3', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]')}
                      >
                        <option value="3">3 interações (Máxima economia)</option>
                        <option value="5">5 interações (Padrão sugerido)</option>
                        <option value="10">10 interações (Flexível)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => alert('Parâmetros de governança da IA salvos no banco de dados.')}
                  className={clsx('w-full', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-xl', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer', 'shadow-lg', 'mt-4')}
                >
                  Salvar Parâmetros
                </button>
              </div>
            </div>
          )}

          {/* VIEW 8B: ROBÔ & IA - SIMULADOR DE CHAT */}
          {activeTab === 'robo_ia' && activeSubTab === 'simulador' && (
            <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5', 'text-left', 'animate-fade-in')}>
              {/* Left Column: Interactive Chat Simulation */}
              <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'flex', 'flex-col', 'overflow-hidden', 'h-[72vh]')}>
                <div className={clsx('border-b', 'border-[#27272A]', 'pb-3', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Simulador de Chat Kôma IA</span>
                  <span className={clsx('text-[8px]', 'text-emerald-400', 'font-mono', 'flex', 'items-center', 'gap-1')}>
                    <span className={clsx('h-1.5', 'w-1.5', 'bg-emerald-500', 'rounded-full', 'animate-ping')} />
                    Robô Ativo
                  </span>
                </div>

                <div className={clsx('flex-1', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-2xl', 'p-4', 'flex', 'flex-col', 'justify-between', 'space-y-4')}>
                  <textarea
                    readOnly
                    value={chatbotMessages.map(msg => `[${msg.sender === 'user' ? 'CLIENTE' : 'IA'} - ${msg.timestamp}]: ${msg.text}`).join('\n') + (isBotTyping ? '\n[IA - Digitando...]' : '')}
                    className={clsx('w-full', 'flex-1', 'p-3', 'bg-[#000000]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-emerald-500', 'font-mono', 'text-[9px]', 'leading-relaxed', 'focus:outline-none', 'resize-none', 'overflow-y-auto')}
                    ref={(el) => {
                      if (el) el.scrollTop = el.scrollHeight;
                    }}
                  />

                  <form onSubmit={handleSendChatbotMessage} className={clsx('flex', 'gap-2', 'pt-2', 'border-t', 'border-[#27272A]', 'shrink-0')}>
                    <input
                      type="text"
                      placeholder="Simule uma conversa com o bot..."
                      value={chatInputText}
                      disabled={!aiBotActive}
                      onChange={(e) => setChatInputText(e.target.value)}
                      className={clsx('flex-1', 'px-4', 'py-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white', 'disabled:opacity-50', 'text-[10px]')}
                    />
                    <button
                      type="submit"
                      disabled={!aiBotActive}
                      className={clsx('p-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'disabled:bg-[#1C1C1F]', 'text-[#121214]', 'disabled:text-gray-500', 'rounded-xl', 'transition-all', 'cursor-pointer', 'flex', 'items-center', 'justify-center', 'shrink-0')}
                    >
                      <Send size={14} />
                    </button>
                  </form>
                </div>
              </div>

              {/* Right Column: Support Tickets and Feedbacks */}
              <div className="space-y-4">
                {/* Pending Chats */}
                <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-3', 'text-left')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Chamados de Clientes (IA Pendente)</span>
                  <div className="space-y-2">
                    {supportChats.length === 0 ? (
                      <span className={clsx('text-[10px]', 'text-gray-500', 'italic', 'block', 'text-center', 'py-5')}>Nenhum chamado pendente</span>
                    ) : (
                      supportChats.map(chat => (
                        <div key={chat.id} className={clsx('bg-[#1C1C1F]', 'p-3', 'rounded-xl', 'border', 'border-[#27272A]', 'space-y-2', 'text-left')}>
                          <div className={clsx('flex', 'justify-between', 'items-center', 'text-[10px]')}>
                            <strong className={clsx('text-white', 'block', 'truncate', 'w-32', 'font-bold')}>{chat.cliente}</strong>
                            <span className={clsx('text-[8px]', 'uppercase', 'tracking-wider', 'font-mono', 'font-bold', 'text-rose-500')}>{chat.canal}</span>
                          </div>
                          <p className={clsx('text-[10px]', 'text-gray-400', 'line-clamp-2', 'leading-relaxed')}>{chat.ultimaMsg}</p>
                          <button
                            onClick={() => {
                              alert(`Transferindo conversa com ${chat.cliente} para o chat do Caixa...`);
                              setSupportChats(prev => prev.filter(c => c.id !== chat.id));
                            }}
                            className={clsx('w-full', 'py-1', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-lg', 'text-[8px]', 'uppercase', 'tracking-wider', 'cursor-pointer')}
                          >
                            Conversar
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Feedbacks list */}
                <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-3', 'text-left')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Últimos Feedbacks / Avaliações</span>
                  <div className={clsx('space-y-2.5', 'max-h-[30vh]', 'overflow-y-auto', 'pr-1')}>
                    {customerFeedbacks.map(fb => (
                      <div key={fb.id} className={clsx('bg-[#1C1C1F]', 'p-2.5', 'rounded-xl', 'border', 'border-[#27272A]', 'space-y-1.5', 'text-left')}>
                        <div className={clsx('flex', 'justify-between', 'items-center')}>
                          <strong className={clsx('text-white', 'block', 'text-[10px]', 'font-bold')}>{fb.cliente}</strong>
                          <div className={clsx('flex', 'gap-0.5', 'text-amber-500')}>
                            {Array.from({ length: fb.estrelas }, (_, i) => (
                              <Star key={i} size={8} fill="currentColor" />
                            ))}
                          </div>
                        </div>
                        <p className={clsx('text-[10px]', 'text-gray-400', 'italic', 'leading-relaxed')}>"{fb.comentario}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 9: PAGAMENTOS & PLANOS */}
          {activeSubTab === 'planos' && (
            <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5')}>

              {/* Online payment toggles (Left Column) */}
              <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Integrações de Pagamento Online</span>

                <p className={clsx('text-[10px]', 'text-gray-400', 'leading-relaxed', 'bg-[#09090B]', 'p-3', 'rounded-xl', 'border', 'border-[#27272A]/50')}>
                  Ative formas de recebimento online integradas diretamente na comanda digital do cliente. Os valores são creditados de forma imediata na sua conta bancária.
                </p>

                <div className="space-y-4">
                  {[
                    { title: "Pix Automático in-app", desc: "Gera um QR Code Pix dinâmico para o cliente pagar direto no celular e libera a mesa de forma autônoma.", checked: payPixActive, setChecked: setPayPixActive },
                    { title: "Cartão de Crédito Online", desc: "Permite pagamentos via crédito diretamente pela carteira digital do cliente na tela de consumo.", checked: payCardActive, setChecked: setPayCardActive }
                  ].map((item, idx) => (
                    <div key={idx} className={clsx('flex', 'justify-between', 'items-start', 'gap-4')}>
                      <div className={clsx('space-y-0.5', 'text-left')}>
                        <strong className={clsx('text-white', 'block', 'font-semibold')}>{item.title}</strong>
                        <span className={clsx('text-[9px]', 'text-gray-500', 'block', 'leading-relaxed')}>{item.desc}</span>
                      </div>
                      <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer', 'shrink-0', 'mt-0.5')}>
                        <input type="checkbox" checked={item.checked} onChange={(e) => item.setChecked(e.target.checked)} className={clsx('sr-only', 'peer')} />
                        <div className={clsx('w-8', 'h-4.5', 'bg-[#27272A]', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-3.5', 'after:w-3.5', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* SaaS Plans (Right Column) */}
              <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Assinatura e Planos Kôma</span>

                <div className="space-y-3">
                  {[
                    { id: 'pocket', name: 'Kôma Pocket', price: 'R$ 149/mês', features: ['Menu Digital QR Code', 'Atendimento Local Simples', '(Sem suporte a impressoras térmicas)'] },
                    { id: 'bistro', name: 'Kôma Bistrô', price: 'R$ 219/mês', features: ['Gestão de Mesas', 'Atendimento Local de Salão', '(Sem suporte a Delivery)'] },
                    { id: 'delivery', name: 'Kôma Delivery', price: 'R$ 219/mês', features: ['Gestão de Entregas', 'Taxas e Logística de Delivery', '(Sem suporte a Mesas)'] },
                    { id: 'premium', name: 'Kôma Premium', price: 'R$ 349/mês', features: ['Versão Completa', 'Mesas, Delivery, Impressora e KDS'] }
                  ].map((plan) => (
                    <div
                      key={plan.id}
                      onClick={() => setSelectedPlan(plan.id as any)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer text-left ${selectedPlan === plan.id
                        ? 'bg-emerald-600/15 border-[#10b981] shadow'
                        : 'bg-[#1C1C1F] border-[#27272A] hover:border-[#10b981]/30'
                        }`}
                    >
                      <div className={clsx('flex', 'justify-between', 'items-center', 'mb-1')}>
                        <strong className={clsx('text-white', 'block', 'text-xs')}>{plan.name}</strong>
                        <span className={clsx('font-bold', 'text-[#10b981]', 'font-mono', 'text-[11px]')}>{plan.price}</span>
                      </div>
                      <ul className={clsx('space-y-0.5', 'text-[9px]', 'text-gray-400', 'pl-3', 'list-disc')}>
                        {plan.features.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

            </div>
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
          {activeSubTab === 'cupom' && (
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



          {/* VIEW: RELATÓRIO GERAL */}
          {activeSubTab === 'relatorio_geral' && (
            <div className={clsx('space-y-5', 'text-left', 'animate-fade-in')}>
              {/* Banner azul de informações */}
              <div className={clsx('bg-sky-500/10', 'border', 'border-sky-500/20', 'text-sky-300', 'p-4', 'rounded-2xl', 'flex', 'items-start', 'gap-3', 'relative')}>
                <button className={clsx('absolute', 'right-3', 'top-3', 'text-sky-300/60', 'hover:text-sky-300', 'cursor-pointer')}><X size={14} /></button>
                <div className={clsx('p-1', 'bg-sky-500/20', 'rounded-full', 'shrink-0', 'text-sky-400', 'mt-0.5')}>
                  <HelpCircle size={16} />
                </div>
                <div className="space-y-0.5">
                  <strong className={clsx('text-[11px]', 'block', 'font-bold', 'text-white')}>Veja aqui informações sobre suas vendas. Filtre por datas e exporte as informações</strong>
                  <span className={clsx('text-[9px]', 'text-sky-300/80', 'block', 'leading-relaxed')}>Este relatório mostra como está o faturamento e a quantidade vendida em seu estabelecimento no período desejado.</span>
                </div>
              </div>

              {/* Date Filter selector bar */}
              <div className={clsx('flex', 'justify-between', 'items-center', 'gap-3', 'flex-wrap')}>
                <div className={clsx('flex', 'items-center', 'gap-3')}>
                  <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'px-3', 'py-1.5', 'text-[10px]', 'text-gray-300', 'font-bold', 'font-mono')}>
                    {getPeriodString()}
                  </div>
                  <div className={clsx('flex', 'gap-1', 'bg-[#09090B]', 'p-1', 'rounded-xl', 'border', 'border-[#27272A]')}>
                    {[
                      { id: '7', label: '7D' },
                      { id: '15', label: '15D' },
                      { id: '30', label: '30D' }
                    ].map(r => (
                      <button
                        key={r.id}
                        onClick={() => setDesempenhoRange(r.id as any)}
                        className={`px-2 py-0.5 text-[9px] font-bold rounded-lg cursor-pointer transition-all ${desempenhoRange === r.id
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-gray-400 hover:text-white'
                          }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={clsx('flex', 'gap-2')}>
                  <button 
                    onClick={handleExportReports}
                    className={clsx('px-3', 'py-1', 'bg-[#10b981]', 'text-[#121214]', 'hover:bg-[#059669]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                  >
                    Exportar Relatório (CSV)
                  </button>
                </div>
              </div>

              {/* Grid of KPI cards */}
              <div className={clsx('grid', 'grid-cols-2', 'md:grid-cols-4', 'gap-4')}>
                {[
                  { label: "Faturamento", value: `R$ ${(generalStats?.faturamento ?? 0.00).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "text-[#10b981]" },
                  { label: "Ticket médio", value: `R$ ${(generalStats?.ticket_medio ?? 0.00).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "text-white" },
                  { label: "Total de pedidos", value: String(generalStats?.total_pedidos ?? 0), color: "text-white" },
                  { label: "Clientes ativos", value: String(generalStats?.clientes_ativos ?? 0), color: "text-white" }
                ].map((card, idx) => (
                  <div key={idx} className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-2xl', 'p-4.5', 'space-y-1', 'flex', 'flex-col', 'justify-center')}>
                    <span className={clsx('text-[9px]', 'text-gray-400', 'uppercase', 'tracking-widest', 'font-bold', 'block')}>{card.label}</span>
                    <strong className={`text-base font-serif font-bold ${card.color}`}>{card.value}</strong>
                  </div>
                ))}
              </div>

              {/* SVG Double Bar Chart (Weekly Sales split by delivery vs local) */}
              <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
                <div className={clsx('flex', 'justify-between', 'items-center')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block')}>Pedidos e Entregas (Semanal)</span>
                  <div className={clsx('flex', 'gap-4', 'text-[9px]', 'font-bold')}>
                    <div className={clsx('flex', 'items-center', 'gap-1.5', 'text-sky-400')}>
                      <span className={clsx('h-2', 'w-2', 'bg-sky-400', 'rounded-sm')} />
                      <span>Entrega</span>
                    </div>
                    <div className={clsx('flex', 'items-center', 'gap-1.5', 'text-blue-600')}>
                      <span className={clsx('h-2', 'w-2', 'bg-blue-600', 'rounded-sm')} />
                      <span>Pedidos</span>
                    </div>
                  </div>
                </div>

                <div className={clsx('pt-2', 'relative', 'h-48', 'w-full', 'flex', 'items-end', 'justify-between', 'px-4', 'border-b', 'border-[#27272A]', 'pb-4')}>
                  {/* SVG Bar graphs */}
                  {(generalStats?.weekly_chart ?? [
                    { label: "Dom", delivery: 0, local: 0 },
                    { label: "Seg", delivery: 0, local: 0 },
                    { label: "Ter", delivery: 0, local: 0 },
                    { label: "Qua", delivery: 0, local: 0 },
                    { label: "Qui", delivery: 0, local: 0 },
                    { label: "Sex", delivery: 0, local: 0 },
                    { label: "Sab", delivery: 0, local: 0 }
                  ]).map((day: any, idx: number) => {
                    const maxScale = Math.max(10, ...((generalStats?.weekly_chart ?? []).flatMap((d: any) => [d.delivery, d.local])), 150);
                    const delHeight = `${(day.delivery / maxScale) * 100}%`;
                    const locHeight = `${(day.local / maxScale) * 100}%`;

                    return (
                      <div key={idx} className={clsx('flex', 'flex-col', 'items-center', 'gap-2', 'h-full', 'flex-1', 'relative')}>
                        <div className={clsx('flex-1', 'w-full', 'flex', 'items-end', 'justify-center', 'gap-1.5', 'pb-1')}>
                          {day.delivery > 0 ? (
                            <div className={clsx('w-3', 'bg-sky-400', 'rounded-t-sm', 'group', 'relative')} style={{ height: delHeight }} title={`Entrega: ${day.delivery}`}>
                              <span className={clsx('absolute', '-top-5', 'left-1/2', '-translate-x-1/2', 'bg-black', 'text-white', 'text-[8px]', 'font-bold', 'px-1', 'rounded', 'opacity-0', 'group-hover:opacity-100', 'transition-opacity', 'font-mono')}>{day.delivery}</span>
                            </div>
                          ) : (
                            <div className={clsx('w-3', 'h-0.5', 'bg-zinc-800', 'rounded-t-sm')} />
                          )}
                          {day.local > 0 ? (
                            <div className={clsx('w-3', 'bg-blue-600', 'rounded-t-sm', 'group', 'relative')} style={{ height: locHeight }} title={`Dine-in: ${day.local}`}>
                              <span className={clsx('absolute', '-top-5', 'left-1/2', '-translate-x-1/2', 'bg-black', 'text-white', 'text-[8px]', 'font-bold', 'px-1', 'rounded', 'opacity-0', 'group-hover:opacity-100', 'transition-opacity', 'font-mono')}>{day.local}</span>
                            </div>
                          ) : (
                            <div className={clsx('w-3', 'h-0.5', 'bg-zinc-800', 'rounded-t-sm')} />
                          )}
                        </div>
                        <span className={clsx('text-[9px]', 'font-bold', 'text-gray-400', 'uppercase')}>{day.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* VIEW: RELATÓRIO DE GARÇONS */}
          {activeSubTab === 'relatorio_garçons' && (
            <div className={clsx('space-y-5', 'text-left', 'animate-fade-in')}>
              {/* Banner azul de informações */}
              <div className={clsx('bg-sky-500/10', 'border', 'border-sky-500/20', 'text-sky-300', 'p-4', 'rounded-2xl', 'flex', 'items-start', 'gap-3', 'relative')}>
                <button className={clsx('absolute', 'right-3', 'top-3', 'text-sky-300/60', 'hover:text-sky-300', 'cursor-pointer')}><X size={14} /></button>
                <div className={clsx('p-1', 'bg-sky-500/20', 'rounded-full', 'shrink-0', 'text-sky-400', 'mt-0.5')}>
                  <HelpCircle size={16} />
                </div>
                <div className="space-y-0.5">
                  <strong className={clsx('text-[11px]', 'block', 'font-bold', 'text-white')}>Veja aqui informações sobre suas vendas. Filtre por datas e exporte as informações</strong>
                  <span className={clsx('text-[9px]', 'text-sky-300/80', 'block', 'leading-relaxed')}>Este relatório mostra como está o faturamento e a quantidade vendida em seu estabelecimento usando o modo garçom.</span>
                </div>
              </div>

              {/* Date Filter selector bar */}
              <div className={clsx('flex', 'justify-between', 'items-center', 'gap-3', 'flex-wrap')}>
                <div className={clsx('flex', 'items-center', 'gap-3')}>
                  <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'px-3', 'py-1.5', 'text-[10px]', 'text-gray-300', 'font-bold', 'font-mono')}>
                    {getPeriodString()}
                  </div>
                  <div className={clsx('flex', 'gap-1', 'bg-[#09090B]', 'p-1', 'rounded-xl', 'border', 'border-[#27272A]')}>
                    {[
                      { id: '7', label: '7D' },
                      { id: '15', label: '15D' },
                      { id: '30', label: '30D' }
                    ].map(r => (
                      <button
                        key={r.id}
                        onClick={() => setDesempenhoRange(r.id as any)}
                        className={`px-2 py-0.5 text-[9px] font-bold rounded-lg cursor-pointer transition-all ${desempenhoRange === r.id
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-gray-400 hover:text-white'
                          }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={clsx('flex', 'gap-2')}>
                  <button 
                    onClick={handleExportReports}
                    className={clsx('px-3', 'py-1', 'bg-[#10b981]', 'text-[#121214]', 'hover:bg-[#059669]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                  >
                    Exportar Relatório (CSV)
                  </button>
                </div>
              </div>

              {/* Grid of KPI cards */}
              <div className={clsx('grid', 'grid-cols-2', 'md:grid-cols-5', 'gap-4')}>
                {[
                  { label: "Faturamento", value: `R$ ${(generalStats?.faturamento ?? 0.00).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "text-[#10b981]" },
                  { label: "Ticket médio", value: `R$ ${(generalStats?.ticket_medio ?? 0.00).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "text-white" },
                  { label: "Total de pedidos", value: String(generalStats?.total_pedidos ?? 0), color: "text-white" },
                  { label: "Comissão Total", value: `R$ ${(waitersPerformance.reduce((acc, w) => acc + w.comissao_acumulada, 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "text-white" },
                  { label: "Garçons ativos", value: String(waitersPerformance.length), color: "text-white" }
                ].map((card, idx) => (
                  <div key={idx} className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-2xl', 'p-4', 'md:p-4.5', 'space-y-1', 'flex', 'flex-col', 'justify-center')}>
                    <span className={clsx('text-[9px]', 'text-gray-400', 'uppercase', 'tracking-widest', 'font-bold', 'block')}>{card.label}</span>
                    <strong className={`text-xs md:text-sm font-serif font-bold ${card.color}`}>{card.value}</strong>
                  </div>
                ))}
              </div>

              {/* Waiter Performance Table */}
              <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'overflow-hidden', 'p-5', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block')}>Faturamento por Garçom (Comissão Acumulada)</span>
                <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                  <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                    <thead>
                      <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                        <th className="p-3.5">Nome Garçom</th>
                        <th className="p-3.5">Pedidos Atendidos</th>
                        <th className={clsx('p-3.5', 'text-right', 'font-bold', 'text-emerald-400')}>Comissão Acumulada (10% Serviço)</th>
                      </tr>
                    </thead>
                    <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                      {waitersPerformance.map((waiter, idx) => (
                        <tr key={idx} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                          <td className={clsx('p-3.5', 'font-bold', 'text-white')}>{waiter.nome_garcon}</td>
                          <td className={clsx('p-3.5', 'font-mono', 'text-gray-300')}>{waiter.pedidos_atendidos}</td>
                          <td className={clsx('p-3.5', 'font-mono', 'text-emerald-400', 'font-bold', 'text-right')}>R$ {waiter.comissao_acumulada.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                      {waitersPerformance.length === 0 && (
                        <tr>
                          <td colSpan={3} className="p-8 text-center text-gray-500 italic">
                            Nenhum garçom atendeu pedidos no período
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* MOCK VIEW: METAS DO TURNOS & PREVISÃO DE PICO (IA) */}
          {activeTab === 'dashboard' && activeSubTab === 'metas' && (
            <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-2', 'gap-5', 'text-left', 'animate-fade-in')}>
              <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-5', 'rounded-3xl', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Painel de Metas do Dia</span>
                <div className="space-y-3">
                  {(() => {
                    const meta = 3000.00;
                    const hoje = generalStats?.faturamento_hoje ?? 0.00;
                    const pct = Math.min(100, Math.max(0, (hoje / meta) * 100));
                    const restante = Math.max(0, meta - hoje);
                    return (
                      <>
                        <div className={clsx('flex', 'justify-between', 'text-[10px]')}>
                          <span className="text-gray-400">Progresso da Meta (R$ {meta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})</span>
                          <strong className={clsx('text-white', 'font-mono')}>{pct.toFixed(1)}% (R$ {hoje.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})</strong>
                        </div>
                        <div className={clsx('h-3', 'w-full', 'bg-[#1C1C1F]', 'rounded-full', 'overflow-hidden', 'border', 'border-[#27272A]/40')}>
                          <div className={clsx('h-full', 'bg-gradient-to-r', 'from-[#10b981]', 'to-[#10b981]', 'rounded-full')} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={clsx('text-[8px]', 'text-gray-500', 'block', 'leading-tight')}>
                          {restante > 0 
                            ? `Faltam R$ ${restante.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para atingir a meta diária estipulada pelo gestor.`
                            : "Parabéns! A meta diária estipulada pelo gestor foi atingida!"
                          }
                        </span>
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-5', 'rounded-3xl', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Horários de Pico (SQL Histórico)</span>
                <p className={clsx('text-[10px]', 'text-gray-400', 'leading-relaxed')}>
                  Gráfico de demanda histórica por hora, gerado via consultas SQL puras e indexadas a partir de comandas fechadas.
                </p>
                <div className={clsx('h-28', 'flex', 'items-end', 'justify-between', 'gap-1.5', 'border-b', 'border-[#27272A]', 'pb-2', 'pt-2', 'px-2')}>
                  {(horariosPico.length > 0
                    ? horariosPico.slice(0, 8).map(h => ({ hr: h.hora, val: Math.min(100, (h.total_pedidos / Math.max(1, ...horariosPico.map(x => x.total_pedidos))) * 100), count: h.total_pedidos }))
                    : [
                      { hr: "18h", val: 20, count: 20 },
                      { hr: "19h", val: 55, count: 55 },
                      { hr: "20h", val: 90, count: 90 },
                      { hr: "21h", val: 100, count: 100 },
                      { hr: "22h", val: 80, count: 80 },
                      { hr: "23h", val: 40, count: 40 }
                    ]
                  ).map((h, i) => (
                    <div key={i} className={clsx('flex-1', 'flex', 'flex-col', 'items-center', 'gap-1.5', 'h-full', 'justify-end')}>
                      <div className={clsx('w-full', 'bg-emerald-600/80', 'rounded-t-sm', 'group', 'relative')} style={{ height: `${h.val}%` }}>
                        <span className={clsx('absolute', '-top-5', 'left-1/2', '-translate-x-1/2', 'bg-black', 'text-white', 'text-[8px]', 'font-bold', 'px-1', 'rounded', 'opacity-0', 'group-hover:opacity-100', 'transition-opacity', 'font-mono')}>{h.count} ped.</span>
                      </div>
                      <span className={clsx('text-[8px]', 'font-bold', 'text-gray-500', 'font-mono')}>{h.hr}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* MOCK VIEW: RANKING TOP ITEMS */}
          {activeTab === 'dashboard' && activeSubTab === 'top10' && (
            <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'text-left', 'animate-fade-in', 'max-w-xl')}>
              <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'border-b', 'border-[#27272A]', 'pb-2')}>Ranking Geral de Saídas</span>
              <div className={clsx('divide-y', 'divide-[#27272A]/50')}>
                {(generalStats?.top_itens ?? []).map((item: any, idx: number) => (
                  <div key={idx} className={clsx('py-3.5', 'flex', 'justify-between', 'items-center')}>
                    <div className={clsx('flex', 'items-center', 'gap-3.5')}>
                      <span className={`h-6 w-6 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold ${idx === 0 ? 'bg-emerald-600 text-white' : idx === 1 ? 'bg-[#10b981] text-[#121214]' : 'bg-[#1C1C1F] text-gray-400'
                        }`}>{item.rank}</span>
                      <div>
                        <span className={clsx('font-medium', 'text-white', 'block', 'text-xs')}>{item.name}</span>
                        <span className={clsx('text-[9px]', 'text-gray-500', 'font-mono')}>R$ {item.price.toFixed(2)}</span>
                      </div>
                    </div>
                    <span className={clsx('text-[10px]', 'font-bold', 'text-emerald-400', 'font-mono')}>{item.count} saídas</span>
                  </div>
                ))}
                {(generalStats?.top_itens ?? []).length === 0 && (
                  <div className="py-8 text-center text-gray-500 italic text-[11px]">Nenhum item vendido no período</div>
                )}
              </div>
            </div>
          )}

          {/* MOCK VIEW: FICHA TÉCNICA */}
          {activeTab === 'cardapio' && activeSubTab === 'ficha_tecnica' && (
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

          {/* CARDÁPIO EM LISTA */}
          {activeTab === 'cardapio' && activeSubTab === 'cardapio_lista' && (
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
                      setProdFormAtivo(true);
                      setShowProductModal(true);
                    }}
                    className={clsx('flex', 'items-center', 'gap-1.5', 'px-3', 'py-1.5', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                  >
                    <Plus size={11} />
                    Novo Item
                  </button>
                  <button
                    onClick={async () => {
                      const id = prompt('Digite o ID único da nova categoria (ex: sobremesas, petiscos):');
                      if (!id) return;
                      const nome = prompt('Digite o nome de exibição da categoria:');
                      if (!nome) return;
                      const destino = prompt('Digite o destino de impressão (COZINHA, BAR, ou NENHUM):', 'COZINHA');
                      if (destino !== 'COZINHA' && destino !== 'BAR' && destino !== 'NENHUM') {
                        alert('Destino inválido! Deve ser COZINHA, BAR ou NENHUM.');
                        return;
                      }
                      try {
                        const res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/categorias`, {
                          method: 'POST',
                          headers: {
                            ...authHeaders,
                            'Content-Type': 'application/json'
                          },
                          body: JSON.stringify({ id, nome, destino_impressao: destino })
                        });
                        if (res.ok) {
                          alert('Categoria criada com sucesso!');
                          if (onRefreshCategorias) {
                            await onRefreshCategorias();
                          } else {
                            await fetchCategorias();
                          }
                        } else {
                          const err = await res.json();
                          alert(`Erro: ${err.detail || 'Falha ao criar categoria.'}`);
                        }
                      } catch (e) {
                        console.error(e);
                        alert('Erro ao conectar ao servidor.');
                      }
                    }}
                    className={clsx('flex', 'items-center', 'gap-1.5', 'px-3', 'py-1.5', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'hover:border-[#10b981]/40', 'text-gray-300', 'hover:text-[#10b981]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                  >
                    <Plus size={11} />
                    Nova Categoria
                  </button>
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
                          const res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/importar`, {
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
                </div>
              </div>

              {/* Grouped by dynamically loaded apiCategorias */}
              {apiCategorias.map((cat) => {
                const prods = apiProdutos
                  .filter(p => (p as any).categoria_id === cat.id)
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
                            <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${(prod as any).ativo !== false ? 'bg-emerald-600/15 text-emerald-400' : 'bg-red-900/20 text-red-400'}`}>
                              {(prod as any).ativo !== false ? 'Ativo' : 'Esgotado'}
                            </span>
                            <div className="flex gap-1 pl-2">
                              <button
                                onClick={() => {
                                  setEditingProduct(prod);
                                  setProdFormId(prod.id);
                                  setProdFormNome(prod.nome);
                                  setProdFormPreco(prod.preco.toString());
                                  setProdFormCategoriaId((prod as any).categoria_id || '');
                                  setProdFormDescricao((prod as any).descricao || '');
                                  setProdFormImagem((prod as any).imagem || '');
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
                                      const res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/${prod.id}`, {
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
                const cat = typeof catObj === 'object' && catObj ? catObj.nome.toLowerCase() : (typeof catObj === 'string' ? catObj.toLowerCase() : '');
                return name.includes(keyword) || cat.includes(keyword) || catId.includes(keyword);
              });

              if (targetProducts.length === 0) return;

              if (confirm(`Deseja realmente ${active ? 'disponibilizar' : 'esgotar'} todos os itens relacionados a "${keyword}" (${targetProducts.length} itens)?`)) {
                try {
                  await Promise.all(targetProducts.map(prod =>
                    API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/${prod.id}`, {
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
              ? source.filter(p => p.nome.toLowerCase().includes(disponibilidadeSearch.toLowerCase()))
              : source;
            const byCat: Record<string, typeof source> = {};
            filtered.forEach(p => {
              const catObj = (p as any).categoria;
              const cat = typeof catObj === 'object' && catObj ? catObj.nome : (typeof catObj === 'string' ? catObj : 'Geral');
              if (!byCat[cat]) byCat[cat] = [];
              byCat[cat].push(p);
            });
            return (
              <div className={clsx('space-y-4', 'animate-fade-in', 'text-left', 'max-w-2xl')}>
                {/* Header */}
                <div className={clsx('flex', 'justify-between', 'items-center')}>
                  <div>
                    <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block')}>Pausa Rápida de Produtos</span>
                    <span className={clsx('text-[8px]', 'text-gray-500', 'block', 'mt-0.5')}>Esgotado bloqueia o item no app do garçom instantaneamente.</span>
                  </div>
                  <button onClick={fetchProdutos} className={clsx('text-[9px]', 'text-gray-400', 'hover:text-white', 'flex', 'items-center', 'gap-1', 'cursor-pointer', 'transition-colors')}>
                    <RefreshCw size={10} /> Atualizar
                  </button>
                </div>

                {/* Search */}
                <div className="relative">
                  <svg className={clsx('absolute', 'left-3', 'top-1/2', '-translate-y-1/2', 'text-gray-500')} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <input
                    value={disponibilidadeSearch}
                    onChange={e => setDisponibilidadeSearch(e.target.value)}
                    placeholder="Pesquisar produto..."
                    className={clsx('w-full', 'pl-8', 'pr-4', 'py-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'placeholder-gray-600', 'focus:outline-none', 'focus:border-[#10b981]/40', 'transition-colors')}
                  />
                  {disponibilidadeSearch && (
                    <button onClick={() => setDisponibilidadeSearch('')} className={clsx('absolute', 'right-3', 'top-1/2', '-translate-y-1/2', 'text-gray-500', 'hover:text-white')}>
                      <X size={11} />
                    </button>
                  )}
                </div>

                {/* Atalhos Rápidos em Massa */}
                <div className="space-y-2 bg-[#121214]/40 p-3 rounded-xl border border-[#27272A]/50 text-left">
                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Atalhos de Pausa em Lote:</span>
                  <div className="flex flex-wrap gap-2 text-[8px] font-bold">
                    <div className="flex gap-1.5 border-r border-[#27272A]/80 pr-2">
                      <button type="button" onClick={() => handleBatchAvailability('pastel', false)} className="px-2 py-1 bg-red-950/30 hover:bg-red-900/40 text-red-400 hover:text-white rounded border border-red-900/50 cursor-pointer">Esgotar Pastéis</button>
                      <button type="button" onClick={() => handleBatchAvailability('pastel', true)} className="px-2 py-1 bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-400 hover:text-white rounded border border-emerald-900/50 cursor-pointer">Liberar Pastéis</button>
                    </div>
                    <div className="flex gap-1.5 border-r border-[#27272A]/80 pr-2">
                      <button type="button" onClick={() => handleBatchAvailability('baguete', false)} className="px-2 py-1 bg-red-950/30 hover:bg-red-900/40 text-red-400 hover:text-white rounded border border-red-900/50 cursor-pointer">Esgotar Baguetes</button>
                      <button type="button" onClick={() => handleBatchAvailability('baguete', true)} className="px-2 py-1 bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-400 hover:text-white rounded border border-emerald-900/50 cursor-pointer">Liberar Baguetes</button>
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => handleBatchAvailability('hambúrguer', false)} className="px-2 py-1 bg-red-950/30 hover:bg-red-900/40 text-red-400 hover:text-white rounded border border-red-900/50 cursor-pointer">Esgotar Burgers</button>
                      <button type="button" onClick={() => handleBatchAvailability('hambúrguer', true)} className="px-2 py-1 bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-400 hover:text-white rounded border border-emerald-900/50 cursor-pointer">Liberar Burgers</button>
                    </div>
                  </div>
                </div>

                {/* Dynamic Category Grouping */}
                {apiCategorias.map((catObj) => {
                  const prods = filtered
                    .filter(p => (p as any).categoria_id === catObj.id)
                    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' }));
                  if (prods.length === 0) return null;
                  return (
                    <div key={catObj.id} className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-2xl', 'overflow-hidden')}>
                      <div className={clsx('bg-[#18181B]', 'px-4', 'py-2.5', 'border-b', 'border-[#27272A]', 'flex', 'justify-between', 'items-center', 'gap-3')}>
                        <div className="flex items-baseline gap-2">
                          <span className={clsx('font-bold', 'text-[#10b981]', 'text-[10px]', 'uppercase', 'tracking-wider')}>{catObj.nome}</span>
                          <span className={clsx('text-[8px]', 'text-gray-500')}>{prods.length} item{prods.length !== 1 ? 's' : ''}</span>
                        </div>
                        
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              if (confirm(`Deseja realmente esgotar todos os itens da categoria "${catObj.nome}"?`)) {
                                try {
                                  await Promise.all(prods.map(prod => 
                                    API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/${prod.id}`, {
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
                            className="px-2 py-0.5 border border-red-900/40 hover:border-red-600/30 bg-red-950/20 hover:bg-red-900/25 text-red-400 hover:text-white text-[8px] font-bold rounded transition-all cursor-pointer uppercase tracking-wide border"
                          >
                            Esgotar Todos
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (confirm(`Deseja realmente disponibilizar todos os itens da categoria "${catObj.nome}"?`)) {
                                try {
                                  await Promise.all(prods.map(prod => 
                                    API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/${prod.id}`, {
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
                            className="px-2 py-0.5 border border-emerald-900/40 hover:border-emerald-600/30 bg-emerald-950/20 hover:bg-emerald-900/25 text-emerald-400 hover:text-white text-[8px] font-bold rounded transition-all cursor-pointer uppercase tracking-wide border"
                          >
                            Disponibilizar Todos
                          </button>
                        </div>
                      </div>
                      <div className={clsx('divide-y', 'divide-[#27272A]/40')}>
                        {prods.map(prod => {
                          const isAtivo = (prod as any).ativo !== false;
                          return (
                            <div key={prod.id} className={`flex items-center justify-between px-4 py-3 transition-colors ${isAtivo ? 'hover:bg-[#1C1C1F]/30' : 'bg-red-950/10'}`}>
                              <div className={clsx('flex', 'items-center', 'gap-3')}>
                                {(prod as any).imagem && <img src={(prod as any).imagem} alt={prod.nome} className={`w-8 h-8 rounded-lg object-cover ${!isAtivo ? 'opacity-40 grayscale' : ''}`} />}
                                <div>
                                  <span className={`text-xs font-semibold block ${isAtivo ? 'text-white' : 'text-gray-500 line-through'}`}>{prod.nome}</span>
                                  <span className={clsx('text-[9px]', 'text-gray-500', 'font-mono')}>R$ {prod.preco.toFixed(2)}</span>
                                </div>
                              </div>
                              <button
                                onClick={async () => {
                                  try {
                                    const res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/${prod.id}`, {
                                      method: 'PUT',
                                      headers: { ...authHeaders, 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ ativo: !isAtivo })
                                    });
                                    if (res.ok) { await fetchProdutos(); }
                                    else { alert('Erro ao atualizar disponibilidade.'); }
                                  } catch { alert('Erro de conexão.'); }
                                }}
                                className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer border ${isAtivo
                                  ? 'bg-emerald-600/10 text-emerald-500 hover:bg-red-800/20 hover:text-red-400 border-emerald-600/20 hover:border-red-600/20'
                                  : 'bg-red-800/15 text-red-400 hover:bg-emerald-600/20 hover:text-emerald-400 border-red-600/20 hover:border-emerald-600/20'
                                  }`}
                              >
                                {isAtivo ? '✓ Disponível' : '✗ Esgotado'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className={clsx('py-16', 'text-center', 'text-gray-500', 'italic', 'text-xs')}>Nenhum produto encontrado para "{disponibilidadeSearch}".</div>
                )}
              </div>
            );
          })()}

          {/* CATEGORIAS CRUD TELA */}
          {activeTab === 'cardapio' && activeSubTab === 'categorias_lista' && (
            <div className={clsx('space-y-4', 'animate-fade-in', 'text-left')}>
              <div className={clsx('flex', 'justify-between', 'items-center')}>
                <div>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'text-base', 'block')}>Categorias de Menu</span>
                  <span className={clsx('text-[9px]', 'text-gray-500')}>{apiCategorias.length} categorias cadastradas</span>
                </div>
                <button
                  onClick={async () => {
                    const id = prompt('Digite o ID único da nova categoria (ex: sobremesas, petiscos):');
                    if (!id) return;
                    const nome = prompt('Digite o nome de exibição da categoria:');
                    if (!nome) return;
                    const destino = prompt('Digite o destino de impressão (COZINHA, BAR, ou NENHUM):', 'COZINHA');
                    if (destino !== 'COZINHA' && destino !== 'BAR' && destino !== 'NENHUM') {
                      alert('Destino inválido! Deve ser COZINHA, BAR ou NENHUM.');
                      return;
                    }
                    try {
                      const res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/categorias`, {
                        method: 'POST',
                        headers: {
                          ...authHeaders,
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ id, nome, destino_impressao: destino })
                      });
                      if (res.ok) {
                        alert('Categoria criada com sucesso!');
                        await fetchCategorias();
                      } else {
                        const err = await res.json();
                        alert(`Erro: ${err.detail || 'Falha ao criar categoria.'}`);
                      }
                    } catch (e) {
                      console.error(e);
                      alert('Erro ao conectar ao servidor.');
                    }
                  }}
                  className={clsx('flex', 'items-center', 'gap-1.5', 'px-3', 'py-1.5', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                >
                  <Plus size={11} />
                  Nova Categoria
                </button>
              </div>

              <div className={clsx('bg-[#121214]/50', 'border', 'border-[#27272A]', 'rounded-3xl', 'overflow-hidden')}>
                <div className={clsx('overflow-x-auto')}>
                  <table className={clsx('w-full', 'text-left', 'border-collapse', 'font-sans', 'text-[11px]')}>
                    <thead>
                      <tr className={clsx('border-b', 'border-[#27272A]', 'bg-[#18181B]/50', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider')}>
                        <th className={clsx('p-4')}>ID</th>
                        <th className={clsx('p-4')}>Nome</th>
                        <th className={clsx('p-4')}>Impressão</th>
                        <th className={clsx('p-4', 'text-right')}>Ações</th>
                      </tr>
                    </thead>
                    <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                      {apiCategorias.map((cat) => (
                        <tr key={cat.id} className={clsx('hover:bg-[#1C1C1F]/30', 'transition-colors', 'text-white')}>
                          <td className={clsx('p-4', 'font-mono', 'text-gray-400')}>{cat.id}</td>
                          <td className={clsx('p-4', 'font-semibold')}>{cat.nome}</td>
                          <td className={clsx('p-4')}>
                            <span className={clsx('px-2', 'py-0.5', 'text-[9px]', 'font-bold', 'rounded-md', 'border', 
                              cat.destino_impressao === 'COZINHA' 
                                ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' 
                                : cat.destino_impressao === 'BAR' 
                                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                                  : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                            )}>
                              {cat.destino_impressao}
                            </span>
                          </td>
                          <td className={clsx('p-4', 'text-right', 'space-x-2')}>
                            <button
                              onClick={async () => {
                                const newNome = prompt('Digite o novo nome da categoria (deixe vazio para manter o atual):', cat.nome);
                                const newDestino = prompt('Digite o novo destino de impressão (COZINHA, BAR, ou NENHUM):', cat.destino_impressao);
                                if (newDestino && newDestino !== 'COZINHA' && newDestino !== 'BAR' && newDestino !== 'NENHUM') {
                                  alert('Destino inválido! Deve ser COZINHA, BAR ou NENHUM.');
                                  return;
                                }
                                try {
                                  const res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/categorias/${cat.id}`, {
                                    method: 'PUT',
                                    headers: {
                                      ...authHeaders,
                                      'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({
                                      nome: newNome || undefined,
                                      destino_impressao: newDestino || undefined
                                    })
                                  });
                                  if (res.ok) {
                                    alert('Categoria atualizada!');
                                    await fetchCategorias();
                                  } else {
                                    const err = await res.json();
                                    alert(`Erro: ${err.detail || 'Falha ao atualizar.'}`);
                                  }
                                } catch (e) {
                                  console.error(e);
                                  alert('Erro ao conectar ao servidor.');
                                }
                              }}
                              className="px-2.5 py-1 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800 text-gray-300 hover:text-white rounded-lg transition-all cursor-pointer font-bold"
                            >
                              Editar
                            </button>
                            <button
                              onClick={async () => {
                                if (confirm(`Deseja realmente excluir a categoria "${cat.nome}"?`)) {
                                  try {
                                    const res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/categorias/${cat.id}`, {
                                      method: 'DELETE',
                                      headers: authHeaders
                                    });
                                    if (res.ok) {
                                      alert('Categoria excluída!');
                                      await fetchCategorias();
                                    } else {
                                      const err = await res.json();
                                      alert(`Erro: ${err.detail || 'Falha ao excluir.'}`);
                                    }
                                  } catch (e) {
                                    console.error(e);
                                    alert('Erro ao conectar ao servidor.');
                                  }
                                }
                              }}
                              className="px-2.5 py-1 border border-red-900/40 hover:border-red-600/30 bg-red-950/20 hover:bg-red-900/25 text-red-400 hover:text-white rounded-lg transition-all cursor-pointer font-bold"
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
            </div>
          )}

          {/* LIVE VIEW: ESTOQUE DE INSUMOS */}
          {activeTab === 'estoque' && activeSubTab === 'insumos' && (
            <div className={clsx('animate-fade-in', 'space-y-4', 'text-left')}>
              <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-3')}>
                <div className="flex justify-between items-center border-b border-[#27272A] pb-2">
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Estoque de Insumos</span>
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

          {/* LIVE VIEW: ENTRADA DE XML NFE */}
          {activeTab === 'estoque' && activeSubTab === 'xml' && (() => {
            const handleXmlUpload = async (file: File) => {
              if (!file || !file.name.endsWith('.xml')) {
                setXmlUploadState(s => ({ ...s, error: 'Por favor, selecione um arquivo .xml válido.', result: null }));
                return;
              }
              setXmlUploadState(s => ({ ...s, loading: true, error: null, result: null }));
              const formData = new FormData();
              formData.append('file', file);
              try {
                const res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/estoque/importar-xml`, {
                  method: 'POST',
                  headers: authHeaders,
                  body: formData
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.detail || 'Erro ao importar XML.');
                setXmlUploadState(s => ({ ...s, loading: false, result: json }));
                // Refresh all estoque data
                API.callCaixaApi(apiBaseUrl, authHeaders, `/estoque/insumos`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setEstoqueInsumos(d); });
                API.callCaixaApi(apiBaseUrl, authHeaders, `/estoque/notas`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setNotasEntrada(d); });
                API.callCaixaApi(apiBaseUrl, authHeaders, `/estoque/distribuidores`, { headers: authHeaders }).then(r => r.json()).then(d => { if (Array.isArray(d)) setDistribuidores(d); });
              } catch (err: any) {
                setXmlUploadState(s => ({ ...s, loading: false, error: err.message || 'Erro desconhecido.' }));
              }
            };
            return (
              <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5', 'text-left', 'animate-fade-in')}>
                <input ref={xmlFileInputRef} type="file" accept=".xml" className="hidden" onChange={e => { if (e.target.files?.[0]) handleXmlUpload(e.target.files[0]); e.target.value = ''; }} />
                <div className={clsx('lg:col-span-1', 'space-y-4')}>
                  <div
                    className={clsx('bg-[#121214]', 'border-2', 'border-dashed', 'rounded-3xl', 'p-6', 'text-center', 'cursor-pointer', 'transition-all', 'space-y-3',
                      xmlUploadState.isDragging ? 'border-[#10b981] bg-[#10b981]/5' : 'border-[#27272A] hover:border-[#10b981]/30'
                    )}
                    onClick={() => xmlFileInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setXmlUploadState(s => ({ ...s, isDragging: true })); }}
                    onDragLeave={() => setXmlUploadState(s => ({ ...s, isDragging: false }))}
                    onDrop={e => { e.preventDefault(); setXmlUploadState(s => ({ ...s, isDragging: false })); const f = e.dataTransfer.files[0]; if (f) handleXmlUpload(f); }}
                  >
                    {xmlUploadState.loading ? (
                      <div className="flex flex-col items-center gap-2 py-4">
                        <div className="w-8 h-8 border-2 border-[#10b981] border-t-transparent rounded-full animate-spin" />
                        <span className="text-[10px] text-[#10b981]">Processando NF-e...</span>
                      </div>
                    ) : (
                      <>
                        <div className="text-3xl">📄</div>
                        <span className="block text-[11px] font-semibold text-gray-300">Arraste ou clique para importar</span>
                        <span className="block text-[9px] text-gray-500">Arquivo XML de NF-e (modelo 55)</span>
                      </>
                    )}
                  </div>

                  {xmlUploadState.result && (
                    <div className={clsx('bg-emerald-500/10', 'border', 'border-emerald-500/20', 'rounded-2xl', 'p-4', 'space-y-2', 'text-left')}>
                      <span className="block text-[10px] font-bold text-emerald-400 uppercase tracking-wider">✓ NF-e Importada com Sucesso</span>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] text-gray-400 pt-1">
                        <span>Fornecedor:</span><span className="text-white font-semibold">{xmlUploadState.result.fornecedor}</span>
                        <span>Insumos criados:</span><span className="text-emerald-400 font-mono">{xmlUploadState.result.insumos_criados}</span>
                        <span>Insumos atualizados:</span><span className="text-sky-400 font-mono">{xmlUploadState.result.insumos_atualizados}</span>
                        <span>Valor total:</span><span className="text-white font-mono">R$ {Number(xmlUploadState.result.valor_total).toFixed(2)}</span>
                      </div>
                      <button onClick={() => setXmlUploadState(s => ({ ...s, result: null }))} className="text-[8px] text-gray-600 hover:text-gray-400 mt-1 cursor-pointer">Fechar</button>
                    </div>
                  )}

                  {xmlUploadState.error && (
                    <div className={clsx('bg-red-500/10', 'border', 'border-red-500/20', 'rounded-2xl', 'p-4', 'text-left')}>
                      <span className="block text-[10px] font-bold text-red-400 uppercase tracking-wider">✗ Erro na Importação</span>
                      <p className="text-[9px] text-red-300 mt-1">{xmlUploadState.error}</p>
                      <button onClick={() => setXmlUploadState(s => ({ ...s, error: null }))} className="text-[8px] text-gray-600 hover:text-gray-400 mt-1 cursor-pointer">Fechar</button>
                    </div>
                  )}

                  <p className={clsx('text-[8px]', 'text-gray-600', 'leading-relaxed', 'px-1')}>O sistema extrai fornecedor, itens e valores automaticamente, cadastrando insumos novos e atualizando estoque via custo médio ponderado.</p>
                </div>

                <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Entradas de NF-e</span>
                  <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                    <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                      <thead>
                        <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                          <th className="p-3">Nota</th>
                          <th className="p-3">Fornecedor</th>
                          <th className={clsx('p-3', 'font-mono')}>Valor</th>
                          <th className={clsx('p-3', 'text-right')}>Emissão</th>
                        </tr>
                      </thead>
                      <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                        {notasEntrada.length === 0 ? (
                          <tr><td colSpan={4} className="p-8 text-center text-gray-500 italic">Nenhuma nota importada ainda.</td></tr>
                        ) : notasEntrada.map(nota => (
                          <tr key={nota.id} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                            <td className={clsx('p-3', 'font-mono', 'font-bold', 'text-white')}>NF-{nota.numero_nota}</td>
                            <td className={clsx('p-3', 'text-gray-300')}>{nota.distribuidor?.nome_fantasia ?? '—'}</td>
                            <td className={clsx('p-3', 'font-mono', 'text-emerald-400')}>R$ {Number(nota.valor_total).toFixed(2)}</td>
                            <td className={clsx('p-3', 'text-gray-400', 'text-right')}>{nota.data_emissao ? new Date(nota.data_emissao).toLocaleDateString('pt-BR') : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* LIVE VIEW: DISTRIBUIDORES */}
          {activeTab === 'estoque' && activeSubTab === 'fornecedores' && (
            <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'text-left', 'animate-fade-in')}>
              <div className="flex justify-between items-center border-b border-[#27272A] pb-2">
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Distribuidores Cadastrados</span>
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
                  + Novo Distribuidor
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
                      <tr><td colSpan={5} className="p-8 text-center text-gray-500 italic">Nenhum distribuidor cadastrado. Clique em Novo Distribuidor ou importe uma NF-e.</td></tr>
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

          {/* MOCK VIEW: FLUXO DE CAIXA DRE */}
          {activeTab === 'financeiro' && activeSubTab === 'fluxo' && (
            <div className={clsx('space-y-5', 'text-left', 'animate-fade-in')}>
              <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-4.5', 'rounded-3xl', 'space-y-2')}>
                <h3 className={clsx('font-serif', 'font-bold', 'text-base', 'text-white')}>Demonstrativo de Fluxo de Caixa</h3>
                <p className={clsx('text-[10px]', 'text-gray-400', 'leading-relaxed')}>
                  Resumo simplificado de receitas, custos e despesas operacionais do mês atual.
                </p>
              </div>

              <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-3', 'gap-5', 'font-mono', 'text-[10px]')}>
                <div className={clsx('bg-emerald-500/5', 'border', 'border-emerald-500/10', 'p-5', 'rounded-3xl', 'space-y-2')}>
                  <span className={clsx('font-sans', 'font-bold', 'text-emerald-400', 'uppercase', 'tracking-widest', 'text-[8px]', 'block')}>Receitas Totais</span>
                  <strong className={clsx('text-xl', 'text-white', 'block')}>R$ 51.140,06</strong>
                  <span className={clsx('text-gray-500', 'text-[8px]', 'block')}>Entradas consolidadas do caixa de vendas.</span>
                </div>
                <div className={clsx('bg-rose-500/5', 'border', 'border-rose-500/10', 'p-5', 'rounded-3xl', 'space-y-2')}>
                  <span className={clsx('font-sans', 'font-bold', 'text-rose-400', 'uppercase', 'tracking-widest', 'text-[8px]', 'block')}>Custos e CMV</span>
                  <strong className={clsx('text-xl', 'text-white', 'block')}>R$ 18.420,10</strong>
                  <span className={clsx('text-gray-500', 'text-[8px]', 'block')}>Com base na ficha técnica de insumos baixados.</span>
                </div>
                <div className={clsx('bg-sky-500/5', 'border', 'border-sky-500/10', 'p-5', 'rounded-3xl', 'space-y-2')}>
                  <span className={clsx('font-sans', 'font-bold', 'text-sky-400', 'uppercase', 'tracking-widest', 'text-[8px]', 'block')}>Lucro Líquido Estimado</span>
                  <strong className={clsx('text-xl', 'text-emerald-400', 'block')}>R$ 32.719,96</strong>
                  <span className={clsx('text-gray-500', 'text-[8px]', 'block')}>Margem líquida aproximada de 63.9%.</span>
                </div>
              </div>
            </div>
          )}

          {/* MOCK VIEW: FECHAMENTO CEGO */}
          {activeTab === 'financeiro' && activeSubTab === 'fechamento' && (
            <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'text-left', 'animate-fade-in', 'max-w-md')}>
              <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'border-b', 'border-[#27272A]', 'pb-2')}>Fechamento Cego de Turno</span>
              <p className={clsx('text-[10px]', 'text-gray-400', 'leading-relaxed')}>
                Declare os valores físicos presentes na gaveta para encerrar o caixa. O sistema fará a conferência de quebras sem exibir o saldo esperado para evitar fraudes.
              </p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className={clsx('text-[8px]', 'font-bold', 'text-gray-400', 'block', 'uppercase')}>Dinheiro Físico (R$):</label>
                  <input type="number" placeholder="R$ 0,00" className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono', 'text-[10px]')} />
                </div>
                <div className="space-y-1">
                  <label className={clsx('text-[8px]', 'font-bold', 'text-gray-400', 'block', 'uppercase')}>Comprovantes Cartão (R$):</label>
                  <input type="number" placeholder="R$ 0,00" className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono', 'text-[10px]')} />
                </div>
                <button type="button" onClick={() => alert('Turno fechado com sucesso!')} className={clsx('w-full', 'py-2', 'bg-emerald-600', 'hover:bg-[#8d2a3a]', 'text-white', 'font-bold', 'rounded-xl', 'text-[9px]', 'uppercase', 'tracking-wider', 'cursor-pointer')}>
                  Confirmar Encerramento de Turno
                </button>
              </div>
            </div>
          )}

          {/* MOCK VIEW: SUPRIMENTO / SANGRIA */}
          {activeTab === 'financeiro' && activeSubTab === 'suprimento' && (
            <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-2', 'gap-5', 'text-left', 'animate-fade-in')}>
              <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-5', 'rounded-3xl', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Sangria (Retirada de Caixa)</span>
                <div className="space-y-3">
                  <input type="number" placeholder="Valor R$" className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono', 'text-[10px]')} />
                  <input type="text" placeholder="Motivo da Sangria" className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-[10px]')} />
                  <button type="button" onClick={() => alert('Sangria efetuada')} className={clsx('px-4', 'py-2', 'bg-emerald-600', 'text-white', 'font-bold', 'rounded-xl', 'text-[9px]', 'uppercase', 'tracking-wider', 'cursor-pointer')}>Confirmar Sangria</button>
                </div>
              </div>
              <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-5', 'rounded-3xl', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Suprimento (Entrada de Troco)</span>
                <div className="space-y-3">
                  <input type="number" placeholder="Valor R$" className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'font-mono', 'text-[10px]')} />
                  <button type="button" onClick={() => alert('Suprimento efetuado')} className={clsx('px-4', 'py-2', 'bg-emerald-600', 'text-white', 'font-bold', 'rounded-xl', 'text-[9px]', 'uppercase', 'tracking-wider', 'cursor-pointer')}>Confirmar Suprimento</button>
                </div>
              </div>
            </div>
          )}

          {/* MOCK VIEW: PAINEL FISCAL NFCE */}
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
          {activeTab === 'clientes' && activeSubTab === 'crm' && (
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
                      <th className="p-3.5">Nome</th>
                      <th className="p-3.5">WhatsApp</th>
                      <th className={clsx('p-3.5', 'font-mono')}>Saldo</th>
                      <th className={clsx('p-3.5', 'text-right')}>Ações</th>
                    </tr>
                  </thead>
                  <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                    {loyaltyUsers.map((user) => (
                      <tr key={user.id} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                        <td className={clsx('p-3.5', 'font-bold', 'text-white')}>{user.cliente}</td>
                        <td className={clsx('p-3.5', 'font-mono', 'text-gray-300')}>{user.telefone}</td>
                        <td className={clsx('p-3.5', 'font-mono', 'text-emerald-400')}>
                          {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? `${user.pontos} pts` : `R$ ${user.saldoCashback.toFixed(2)}`}
                        </td>
                        <td className={clsx('p-3.5', 'text-right')}>
                          <button
                            onClick={() => {
                              setEditingCrmUser(user);
                              setCrmFormNome(user.cliente);
                              setCrmFormTelefone(user.telefone);
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
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MOCK VIEW: CHAT CO-PILOTO */}
          {activeTab === 'operacao' && activeSubTab === 'chat_copiloto' && (
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
                      // 2. Mock order generation
                      const draft = copilotDraftCarts[activeChatContactId];
                      if (draft && draft.length > 0) {
                        const newOrd: SimulatedDeliveryOrder = {
                          id: `d-${Date.now().toString().slice(-3)}`,
                          cliente: contact.name,
                          telefone: contact.phone,
                          itens: draft.map(d => `${d.quantity}x ${d.product.nome}`).join(" + "),
                          total: draft.reduce((acc, c) => acc + (c.product.preco * c.quantity), 0),
                          canal: 'whats',
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
            <CaixaLogisticaTab
              simulatedOrders={simulatedOrders}
              motoboys={motoboys}
              selectedMotoboys={selectedMotoboys}
              setSelectedMotoboys={setSelectedMotoboys}
              handleDespacharPedido={handleDespacharPedido}
              handleFinalizarPedido={handleFinalizarPedido}
              handleCadastrarMotoboy={handleCadastrarMotoboy}
              novoMotoboyNome={novoMotoboyNome}
              setNovoMotoboyNome={setNovoMotoboyNome}
              novoMotoboyTelefone={novoMotoboyTelefone}
              setNovoMotoboyTelefone={setNovoMotoboyTelefone}
            />
          )}

          {/* MOCK VIEW: SETUP WIZARD (NICHO) */}
          {activeTab === 'configuracoes' && activeSubTab === 'nicho_wizard' && (
            <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-6', 'text-left', 'max-w-2xl', 'mx-auto', 'space-y-6', 'animate-fade-in')}>
              <div className={clsx('border-b', 'border-[#27272A]', 'pb-3')}>
                <span className={clsx('font-serif', 'font-bold', 'text-base', 'text-white', 'block')}>Setup Wizard — Assistente de Configuração</span>
                <span className={clsx('text-[10px]', 'text-gray-400', 'block', 'mt-1')}>Configure as regras de operação e a estrutura do menu de acordo com o nicho de mercado do seu restaurante.</span>
              </div>

              {/* Nicho selector Grid */}
              <div className="space-y-2">
                <label className={clsx('text-[9px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>Escolha seu Nicho Operacional:</label>
                <div className={clsx('grid', 'grid-cols-2', 'sm:grid-cols-5', 'gap-3')}>
                  {[
                    { id: 'hamburgueria', label: 'Hamburgueria', icon: '🍔' },
                    { id: 'pizzaria', label: 'Pizzaria', icon: '🍕' },
                    { id: 'doceria', label: 'Doceria/Café', icon: '🍰' },
                    { id: 'alacarte', label: 'À La Carte', icon: '🍽️' },
                    { id: 'selfservice', label: 'Self-service', icon: '🥗' }
                  ].map(n => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        setRestaurantNicho(n.id as any);
                        // Auto configurations
                        if (n.id === 'doceria') {
                          setModulesActive({ salon: false, delivery: true });
                        } else if (n.id === 'selfservice') {
                          setModulesActive({ salon: true, delivery: false });
                        } else {
                          setModulesActive({ salon: true, delivery: true });
                        }
                      }}
                      className={`p-4 rounded-2xl border text-center transition-all flex flex-col items-center justify-center gap-2 cursor-pointer ${restaurantNicho === n.id
                        ? 'bg-[#10b981]/15 border-[#10b981] text-[#10b981] shadow-inner font-bold'
                        : 'bg-[#1C1C1F]/40 border-[#27272A] text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                        }`}
                    >
                      <span className="text-xl">{n.icon}</span>
                      <span className={clsx('text-[9px]', 'block', 'whitespace-nowrap')}>{n.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Módulos de UI Actives */}
              <div className={clsx('bg-[#1C1C1F]/40', 'border', 'border-[#27272A]', 'rounded-2xl', 'p-4.5', 'space-y-4')}>
                <span className={clsx('text-[10px]', 'font-bold', 'text-white', 'block', 'uppercase', 'tracking-wider')}>Módulos Ativos do Sistema</span>
                <div className={clsx('grid', 'grid-cols-2', 'gap-4')}>
                  <div className={clsx('flex', 'justify-between', 'items-center', 'p-3', 'bg-[#121214]', 'border', 'border-[#27272A]/60', 'rounded-xl')}>
                    <div>
                      <strong className={clsx('text-[10px]', 'text-white', 'block', 'font-bold')}>Mapa de Mesas (Salão)</strong>
                      <span className={clsx('text-[8px]', 'text-gray-500', 'block')}>Exibe grid físico de comandas e consumo local</span>
                    </div>
                    <button
                      onClick={() => setModulesActive(prev => ({ ...prev, salon: !prev.salon }))}
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none cursor-pointer ${modulesActive.salon ? 'bg-emerald-600' : 'bg-[#27272A]'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-[#121214] shadow-md transform duration-200 ${modulesActive.salon ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className={clsx('flex', 'justify-between', 'items-center', 'p-3', 'bg-[#121214]', 'border', 'border-[#27272A]/60', 'rounded-xl')}>
                    <div>
                      <strong className={clsx('text-[10px]', 'text-white', 'block', 'font-bold')}>Entrega / Delivery</strong>
                      <span className={clsx('text-[8px]', 'text-gray-500', 'block')}>Ativa triagem de entregadores e taxas por bairro</span>
                    </div>
                    <button
                      onClick={() => setModulesActive(prev => ({ ...prev, delivery: !prev.delivery }))}
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none cursor-pointer ${modulesActive.delivery ? 'bg-emerald-600' : 'bg-[#27272A]'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-[#121214] shadow-md transform duration-200 ${modulesActive.delivery ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Nicho-specific customized settings card */}
              <div className={clsx('bg-[#10b981]/5', 'border', 'border-[#10b981]/15', 'rounded-2xl', 'p-4.5', 'space-y-3')}>
                <span className={clsx('text-[10px]', 'font-bold', 'text-[#10b981]', 'flex', 'items-center', 'gap-1.5', 'uppercase', 'tracking-wider')}>
                  🍕 Configurações Automáticas do Nicho: {restaurantNicho.toUpperCase()}
                </span>
                <ul className={clsx('text-[9px]', 'text-gray-400', 'space-y-1.5', 'list-disc', 'pl-4', 'leading-relaxed')}>
                  {restaurantNicho === 'pizzaria' && (
                    <>
                      <li><strong>Pedidos Fracionados:</strong> Ativado cálculo de pizza meio a meio (Preço baseado no sabor mais caro).</li>
                      <li><strong>Grupo de Modificadores:</strong> Criados grupos pré-definidos: *Bordas Recheadas*, *Remover Insegredientes*, *Adicionais*.</li>
                      <li><strong>Painel de Vendas:</strong> Layout otimizado para divisão de frações por sabor.</li>
                    </>
                  )}
                  {restaurantNicho === 'hamburgueria' && (
                    <>
                      <li><strong>Acompanhamentos Genéricos:</strong> Ativados modificadores de ponto da carne e escolha de molhos adicionais.</li>
                      <li><strong>Upsell Automático:</strong> IA configurada para oferecer *Batata Frita Crinkle* e *Refri Lata* na triagem do WhatsApp.</li>
                    </>
                  )}
                  {restaurantNicho === 'doceria' && (
                    <>
                      <li><strong>Layout Simplificado:</strong> Mapa de mesas desativado. Tela inicial foca 100% em vendas rápidas de Balcão e Delivery.</li>
                      <li><strong>Impressão:</strong> Impressão de vias de cozinha configurada para o balcão de montagem de doces.</li>
                    </>
                  )}
                  {restaurantNicho === 'alacarte' && (
                    <>
                      <li><strong>Serviço de Salão Avançado:</strong> Mapa de mesas ativado com controle de tempo de ociosidade das mesas.</li>
                      <li><strong>Layout:</strong> Exibição detalhada de garçons ativos com suas taxas de serviço.</li>
                    </>
                  )}
                  {restaurantNicho === 'selfservice' && (
                    <>
                      <li><strong>Configuração de Balança:</strong> Integração com porta serial para importação de peso de prato balcão.</li>
                      <li><strong>Mapeamento:</strong> Delivery desativado, priorizando faturamento rápido por quilo.</li>
                    </>
                  )}
                </ul>
              </div>

              <div className={clsx('pt-4', 'border-t', 'border-[#27272A]', 'flex', 'justify-end')}>
                <button
                  type="button"
                  onClick={() => alert(`Nicho ${restaurantNicho.toUpperCase()} configurado com sucesso! Módulos de interface atualizados.`)}
                  className={clsx('px-5', 'py-2.5', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-xl', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer', 'shadow-lg')}
                >
                  Salvar Configurações de Nicho
                </button>
              </div>
            </div>
          )}

          {/* CONFIGURAÇÃO CARDÁPIO DIGITAL WHITELABEL */}
          {activeTab === 'configuracoes' && activeSubTab === 'config_cardapio' && (
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

                {/* Logo e Banner URLs */}
                <div className="space-y-1.5">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>URL do Logotipo:</label>
                  <input
                    type="text"
                    value={cardapioLogoUrl}
                    onChange={(e) => setCardapioLogoUrl(e.target.value)}
                    placeholder="https://exemplo.com/logo.png"
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={clsx('text-[10px]', 'font-bold', 'text-gray-300', 'uppercase', 'tracking-wider', 'block')}>URL do Banner:</label>
                  <input
                    type="text"
                    value={cardapioBannerUrl}
                    onChange={(e) => setCardapioBannerUrl(e.target.value)}
                    placeholder="https://exemplo.com/banner.png"
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
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
      </main>

      {/* 1. MODAL: ABRIR CAIXA */}
      {
        showAbrirModal && (
          <div className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4')}>
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
          <div className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4')}>
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
          <div className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4')}>
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
                    <h4 className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Extrato Consumo</h4>
                    {taxaServicoAtiva && (
                      <label className={clsx('flex', 'items-center', 'gap-1.5', 'text-[10px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'cursor-pointer')}>
                        <input
                          type="checkbox"
                          checked={checkoutServiceTax}
                          onChange={(e) => {
                            setCheckoutServiceTax(e.target.checked);
                            const { subtotal } = getCheckoutTotals(selectedOrder);
                            const newTotal = subtotal + (e.target.checked ? subtotal * (serviceTaxRate / 100) : 0);
                            setPaymentValor(newTotal.toFixed(2));
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
                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (isPaid) return;
                            setSelectedItemIds(prev => {
                              const copy = [...prev];
                              const idx = copy.indexOf(item.id);
                              if (idx >= 0) {
                                copy.splice(idx, 1);
                              } else {
                                copy.push(item.id);
                              }
                              const activeSelectedItems = selectedOrder.itens.filter(i => copy.includes(i.id));
                              const sub = activeSelectedItems.reduce((sum, it) => sum + it.preco, 0);
                              const t = sub * (1.0 + ((taxaServicoAtiva && checkoutServiceTax) ? serviceTaxRate / 100 : 0));
                              setPaymentValor(t.toFixed(2));
                              return copy;
                            });
                          }}
                          className={`flex items-start justify-between p-2.5 rounded-xl border border-transparent transition-all text-[11px] ${isPaid
                            ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400'
                            : selectedItemIds.includes(item.id)
                              ? 'bg-[#10b981]/10 border-[#10b981]/30 cursor-pointer shadow-inner'
                              : 'bg-[#121214]/60 border-[#27272A]/50 hover:border-[#27272A] cursor-pointer'
                            }`}
                        >
                          <div className={clsx('flex', 'gap-2', 'items-start', 'flex-1', 'min-w-0')}>
                            {!isPaid && (
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
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(() => {
                    const { subtotal, taxa, total } = getCheckoutTotals(selectedOrder);
                    return (
                      <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'p-4', 'rounded-2xl', 'font-mono', 'text-[11px]', 'space-y-2')}>
                        <div className={clsx('flex', 'justify-between')}>
                          <span className={clsx('font-sans', 'text-gray-400')}>Total Itens em Aberto:</span>
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
                            <span>
                              R$ {(() => {
                                const selectedItems = selectedOrder.itens.filter(i => selectedItemIds.includes(i.id));
                                const sub = selectedItems.reduce((sum, it) => sum + it.preco, 0);
                                const taxVal = (taxaServicoAtiva && checkoutServiceTax) ? sub * (serviceTaxRate / 100) : 0;
                                return (sub + taxVal).toFixed(2);
                              })()}
                            </span>
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
                          <span>R$ {Math.max(0, total - (selectedOrder.valorPago || 0)).toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* BOTÕES DE REIMPRESSÃO DO EXTRATO */}
                  {plano !== 'pocket' && (
                    <div className={clsx('bg-[#121214]/40', 'border', 'border-[#27272A]/50', 'p-4', 'rounded-2xl', 'space-y-3', 'text-left')}>
                      <span className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Reimpressão de Extrato</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const printHeader = localStorage.getItem("koma_print_header") || "";
                              const printFooter = localStorage.getItem("koma_print_footer") || "";
                              const response = await API.imprimirReciboMesa(
                                apiBaseUrl,
                                authHeaders,
                                selectedOrder.mesaId,
                                false,
                                printHeader,
                                printFooter
                              );
                              if (response.ok) {
                                alert("Extrato completo enviado para a impressora!");
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
                              const response = await API.imprimirReciboMesa(
                                apiBaseUrl,
                                authHeaders,
                                selectedOrder.mesaId,
                                true,
                                printHeader,
                                printFooter
                              );
                              if (response.ok) {
                                alert("Extrato resumido (apenas valores) enviado para a impressora!");
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
                  )}
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
                          const { total } = getCheckoutTotals(selectedOrder);
                          const peopleNum = parseInt(val, 10) || 1;
                          setPaymentValor((Math.max(0, total - (selectedOrder.valorPago || 0)) / peopleNum).toFixed(2));
                        }}
                        className={clsx('w-full', 'px-3', 'py-1.5', 'text-xs', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'text-white', 'text-center', 'font-mono')}
                      />
                    </div>
                    <div className={clsx('space-y-1', 'flex', 'flex-col', 'justify-end', 'text-right')}>
                      <span className={clsx('text-[9px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Valor por Pessoa:</span>
                      <span className={clsx('text-sm', 'font-bold', 'text-white', 'font-mono', 'leading-relaxed')}>
                        R$ {(() => {
                          const { total } = getCheckoutTotals(selectedOrder);
                          const peopleNum = parseInt(splitPeople, 10) || 1;
                          return (Math.max(0, total - (selectedOrder.valorPago || 0)) / peopleNum).toFixed(2);
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
                            className={clsx('w-full', 'pl-9', 'pr-4', 'py-2', 'text-xs', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white', 'font-mono')}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedOrder) {
                              const { total } = getCheckoutTotals(selectedOrder);
                              const restante = Math.max(0, total - (selectedOrder.valorPago || 0));
                              setPaymentValor(restante.toFixed(2));
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
                          Pagar Valor Exato
                        </button>
                      </div>
                      <span className={clsx('text-[8px]', 'text-gray-500', 'block', 'mt-1.5', 'leading-normal')}>
                        💡 <strong>Dica:</strong> Para pagamentos múltiplos (ex: parte Pix e parte cartão), você pode digitar qualquer valor no campo acima e lançá-los em sequência sem precisar selecionar os itens.
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
                            onClick={() => setPaymentValor(val.toFixed(2))}
                            className="px-2.5 py-1 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] rounded-lg text-[9px] font-bold text-gray-300 font-mono transition-all cursor-pointer hover:border-gray-500 hover:text-white"
                          >
                            R$ {val}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5 font-sans">
                      <label className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>CPF/Telefone (Opcional - Fidelidade):</label>
                      <input
                        type="text"
                        value={paymentCPF}
                        onChange={(e) => setPaymentCPF(e.target.value)}
                        placeholder="Ex: 123.456.789-00 ou Celular"
                        className={clsx('w-full', 'px-3', 'py-2', 'text-xs', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white')}
                      />
                    </div>

                    {/* TROCO EM TEMPO REAL */}
                    {(() => {
                      if (!selectedOrder) return null;
                      const { total } = getCheckoutTotals(selectedOrder);
                      const restante = Math.max(0, total - (selectedOrder.valorPago || 0));
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
                      <div className={clsx('bg-[#10b981]/15', 'border', 'border-[#10b981]/30', 'text-[#10b981]', 'p-2.5', 'rounded-xl', 'text-[10px]')}>
                        Lançando pagamento para <strong>{selectedItemIds.length} item(ns)</strong> selecionados.
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
                      <span>Lançar Pagamento / Baixa</span>
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
          <div className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4')}>
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

      {/* 6. MODAL: INSPECIONAR E REIMPRIMIR PEDIDO DO KANBAN */}
      {selectedKanbanOrder && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in">
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

            <div className="space-y-4">
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

              <div className="space-y-2 max-h-60 overflow-y-auto">
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

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/comandas/lancamentos/${selectedKanbanOrder.id}/reimprimir`, {
                        method: "POST",
                        headers: authHeaders
                      });
                      if (res.ok) {
                        alert("Pedido reenviado para a impressora com sucesso!");
                        setSelectedKanbanOrder(null);
                      } else {
                        alert("Erro ao solicitar reimpressão.");
                      }
                    } catch (err) {
                      console.error(err);
                      alert("Erro ao solicitar reimpressão.");
                    }
                  }}
                  className="flex-1 py-2.5 bg-rose-950/40 border border-rose-900/50 text-rose-400 hover:bg-rose-900/20 text-white font-bold text-xs rounded-xl transition-all cursor-pointer uppercase tracking-wider text-center flex items-center justify-center gap-1.5 border border-[#10b981]/20 shadow-lg"
                >
                  <Printer size={13} />
                  <span>Reimprimir na Cozinha</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. MODAL: ADICIONAR / EDITAR PRODUTO */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
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
                  const payload = {
                    nome: prodFormNome,
                    categoria_id: prodFormCategoriaId,
                    preco: parseFloat(prodFormPreco),
                    descricao: prodFormDescricao,
                    imagem: prodFormImagem,
                    ativo: prodFormAtivo
                  };

                  let res;
                  if (editingProduct) {
                    res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/${editingProduct.id}`, {
                      method: 'PUT',
                      headers: { ...authHeaders, 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload)
                    });
                  } else {
                    res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/`, {
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
                      onClick={async () => {
                        const id = prompt('Digite o ID único da nova categoria (ex: sobremesas, petiscos):');
                        if (!id) return;
                        const nome = prompt('Digite o nome de exibição da categoria:');
                        if (!nome) return;
                        const destino = prompt('Digite o destino de impressão (COZINHA, BAR, ou NENHUM):', 'COZINHA');
                        if (destino !== 'COZINHA' && destino !== 'BAR' && destino !== 'NENHUM') {
                          alert('Destino inválido! Deve ser COZINHA, BAR ou NENHUM.');
                          return;
                        }
                        try {
                          const res = await API.callCaixaApi(apiBaseUrl, authHeaders, `/produtos/categorias`, {
                            method: 'POST',
                            headers: {
                              ...authHeaders,
                              'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ id, nome, destino_impressao: destino })
                          });
                          if (res.ok) {
                            alert('Categoria criada com sucesso!');
                            if (onRefreshCategorias) {
                              await onRefreshCategorias();
                            } else {
                              await fetchCategorias();
                            }
                            setProdFormCategoriaId(id);
                          } else {
                            const err = await res.json();
                            alert(`Erro: ${err.detail || 'Falha ao criar categoria.'}`);
                          }
                        } catch (e) {
                          console.error(e);
                          alert('Erro ao conectar ao servidor.');
                        }
                      }}
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

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">URL da Imagem:</label>
                <input
                  type="text"
                  placeholder="https://exemplo.com/imagem.jpg"
                  value={prodFormImagem}
                  onChange={(e) => setProdFormImagem(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white focus:outline-none focus:border-[#10b981]"
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

      {editingCrmUser && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
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
                await handleUpdateClient(editingCrmUser.telefone, crmFormNome, crmFormTelefone, newSaldo);
                setEditingCrmUser(null);
              }}
              className="space-y-4"
            >
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

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Telefone / WhatsApp:</label>
                <input
                  type="text"
                  required
                  value={crmFormTelefone}
                  onChange={(e) => setCrmFormTelefone(e.target.value)}
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
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
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
                await handleCreateClient(newCrmNome, newCrmTelefone, Number(newCrmSaldo));
                setShowNewCrmModal(false);
              }}
              className="space-y-4"
            >
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
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Telefone / WhatsApp:</label>
                <input
                  type="text"
                  required
                  value={newCrmTelefone}
                  onChange={(e) => setNewCrmTelefone(e.target.value)}
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
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
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
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
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
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
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
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <h3 className="font-serif text-sm font-bold text-white">
                Cadastrar Novo Distribuidor
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
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <h3 className="font-serif text-sm font-bold text-white">
                Editar Distribuidor: {selectedDist.nome_fantasia}
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
                  alert('Preencha o nome fantasia!');
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

    </div>
  );
}