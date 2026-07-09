import React, { useState, useEffect, useRef } from 'react';
import {
  DollarSign, ArrowUpRight, ArrowDownRight, Lock, Unlock, Users,
  Receipt, ShoppingCart, Percent, CreditCard, Check, AlertTriangle,
  Clock, X, RefreshCw, Edit3, Trash2, Plus, ChevronRight,
  MapPin, ClipboardList, BarChart2, Package, Shield, Star,
  MessageSquare, Send, Printer, Cpu, HelpCircle, Smartphone,
  Gift, Tag, TrendingUp, Heart
} from 'lucide-react';
import { Order, OrderItem, CaixaTurno, CaixaMovimentacao, Pagamento, Table, Product } from '../types';
import { PRODUCTS, CATEGORIES } from '../data';
import { getProductPresets } from '../domain';
import clsx from 'clsx';

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
  status: 'analise' | 'producao' | 'pronto';
  endereco?: string;
  criadoEm: string;
}

interface SystemUser {
  id: string;
  nome: string;
  usuario: string;
  role: string;
}

interface BotChatMessage {
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
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
  onRefreshPagamentosPendentes
}: CaixaPanelProps) {
  // Turno & Sync state
  const [turno, setTurno] = useState<CaixaTurno | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // active sidebar tab (the 9 main sections)
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'operacao' | 'cardapio' | 'estoque' | 'financeiro' | 'clientes' | 'relatorios' | 'robo_ia' | 'configuracoes'
  >('operacao');

  // active sub-tab under each main tab
  // active sub-tab under each main tab
  const [activeSubTab, setActiveSubTab] = useState<string>('pedidos');
  const [selectedKanbanOrder, setSelectedKanbanOrder] = useState<any>(null);

  // ============================================================================
  // ⚡ FILTRAGEM DINÂMICA DAS COMANDAS DE MESA PARA O KANBAN
  // ============================================================================
  const tableOrdersInProduction = (() => {
    const list: any[] = [];
    orders.forEach(comanda => {
      const itemsByLancamento: Record<string, OrderItem[]> = {};
      comanda.itens.forEach(item => {
        const lid = item.lancamentoId || comanda.id;
        if (!itemsByLancamento[lid]) itemsByLancamento[lid] = [];
        itemsByLancamento[lid].push(item);
      });
      Object.entries(itemsByLancamento).forEach(([lid, items]) => {
        const preparingItems = items.filter(i => i.status === 'preparando');
        if (preparingItems.length > 0) {
          list.push({
            id: lid,
            comandaId: comanda.id,
            mesaId: comanda.mesaId,
            identificador: comanda.identificador,
            garcomNome: comanda.garcomNome,
            itens: preparingItems
          });
        }
      });
    });
    return list;
  })();

  const tableOrdersReady = (() => {
    const list: any[] = [];
    orders.forEach(comanda => {
      const readyItems = comanda.itens.filter(i => i.status === 'pronto');
      if (readyItems.length > 0) {
        list.push({
          id: comanda.id,
          comandaId: comanda.id,
          mesaId: comanda.mesaId,
          identificador: comanda.identificador,
          garcomNome: comanda.garcomNome,
          tipo: comanda.tipo,
          valorPago: (comanda as any).valorPago || 0,
          itens: readyItems
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

  // Marketing, Coupons & Loyalty program mock states
  const [coupons, setCoupons] = useState([
    { id: "c-1", codigo: "KOMA10", tipo: "percentual", valor: 10, ativo: true },
    { id: "c-2", codigo: "PASTEL5", tipo: "fixo", valor: 5.00, ativo: true },
    { id: "c-3", codigo: "BENVINDO", tipo: "fixo", valor: 15.00, ativo: false }
  ]);
  const [newCouponCode, setNewCouponCode] = useState("");
  const [newCouponVal, setNewCouponVal] = useState(10);
  const [newCouponTipo, setNewCouponTipo] = useState<'percentual' | 'fixo'>('percentual');

  const [cashbackPercent, setCashbackPercent] = useState(5);
  const [cashbackActive, setCashbackActive] = useState(true);
  const [cashbackHistory, setCashbackHistory] = useState([
    { id: 1, cliente: "Maria Oliveira", valorCompra: 46.00, cashbackGerado: 2.30, data: "Hoje" },
    { id: 2, cliente: "Felipe Ramos", valorCompra: 32.50, cashbackGerado: 1.63, data: "Hoje" },
    { id: 3, cliente: "Ana Claudia", valorCompra: 79.90, cashbackGerado: 4.00, data: "Ontem" }
  ]);
  const [abandonedCarts, setAbandonedCarts] = useState([
    { id: 1, cliente: "Rodrigo Santos", telefone: "(81) 98765-4321", itens: "3x Pastel Especial + Guaraná 2L", total: 68.00, abandonadoEm: "15m atrás", status: "pendente" },
    { id: 2, cliente: "Karla Souza", telefone: "(81) 99122-3344", itens: "1x Burgão Kôma + Batata Frita", total: 39.90, abandonadoEm: "34m atrás", status: "recuperado" },
    { id: 3, cliente: "Bruno Mendes", telefone: "(81) 97344-5566", itens: "2x Pastel Doce + Milkshake", total: 42.00, abandonadoEm: "1h atrás", status: "pendente" }
  ]);
  const [loyaltyUsers, setLoyaltyUsers] = useState([
    { id: 1, cliente: "Maria Oliveira", pontos: 340, saldoCashback: 8.50 },
    { id: 2, cliente: "Felipe Ramos", pontos: 180, saldoCashback: 5.20 },
    { id: 3, cliente: "Ana Claudia", pontos: 560, saldoCashback: 12.00 }
  ]);
  const [compreGanheRules, setCompreGanheRules] = useState([
    { id: 1, titulo: "Combo Pastel Dobrado", descricao: "Compre 2 Pastéis de Carne e ganhe 1 Coca Lata grátis", ativa: true },
    { id: 2, titulo: "Terça-Feira sem Fome", descricao: "Peça 1 Hambúrguer Kôma e a batata frita é por conta da casa", ativa: false }
  ]);

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
      const res = await fetch(`${apiBaseUrl}/fidelidade/config`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(fidelidadeConfig)
      });
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
  const [horariosPico, setHorariosPico] = useState<{ dia_semana_label: string, dia_semana: number, hora: string, total_pedidos: number }[]>([]);
  const [fidelidadeConfig, setFidelidadeConfig] = useState({
    ativo: true,
    tipo_recompensa: 'PONTOS', // PONTOS | CASHBACK
    taxa_conversao: 1.0,
    valor_ponto_em_dinheiro: 0.05
  });


  // Table management states
  const [showAddMesaModal, setShowAddMesaModal] = useState(false);
  const [newMesaId, setNewMesaId] = useState('');
  const [newMesaCap, setNewMesaCap] = useState('4');
  const [newMesaNome, setNewMesaNome] = useState('');

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
  const [serviceTaxRate, setServiceTaxRate] = useState(10); // Customizable service rate percentage
  const [unificarViasDelivery, setUnificarViasDelivery] = useState(false);
  const [modoExclusivoSalao, setModoExclusivoSalao] = useState(true);
  const [splitPeople, setSplitPeople] = useState('1');
  const [paymentMetodo, setPaymentMetodo] = useState<'dinheiro' | 'pix' | 'cartao'>('dinheiro');
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
      const res = await fetch(`${apiBaseUrl}/caixa/configuracoes`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const data = await res.json();
        setCheckoutServiceTax(data.taxa_servico_ativa);
        setServiceTaxRate(data.taxa_servico_padrao);
        setUnificarViasDelivery(data.unificar_vias_delivery);
        setModoExclusivoSalao(data.modo_exclusivo_salao);
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
  const [novoMotoboyNome, setNovoMotoboyNome] = useState('');
  const [novoMotoboyTelefone, setNovoMotoboyTelefone] = useState('');

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
      status: c.delivery_status || 'analise',
      endereco: c.delivery_endereco || '',
      criadoEm: criadoEm
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

  const handleUpdateDeliveryStatus = async (orderId: string, statusNovo: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/delivery/status?status_novo=${statusNovo}`, {
        method: 'PUT',
        headers: authHeaders
      });
      if (res.ok) {
        fetchDeliveryOrders();
      } else {
        alert('Erro ao atualizar status do pedido.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao atualizar status.');
    }
  };

  const handleRecusarPedido = async (orderId: string) => {
    if (!confirm('Deseja realmente recusar e cancelar este pedido?')) return;
    try {
      await fetch(`${apiBaseUrl}/comandas/${orderId}/delivery/status?status_novo=finalizado`, {
        method: 'PUT',
        headers: authHeaders
      });
      await fetch(`${apiBaseUrl}/comandas/${orderId}/fechar`, {
        method: 'PUT',
        headers: authHeaders
      });
      fetchDeliveryOrders();
      onRefreshOrders();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDespacharPedido = async (orderId: string, motoboyId: number) => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/delivery/despachar`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ motoboy_id: motoboyId })
      });
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
    }
  };

  const handleFinalizarPedido = async (orderId: string) => {
    try {
      await fetch(`${apiBaseUrl}/comandas/${orderId}/delivery/status?status_novo=finalizado`, {
        method: 'PUT',
        headers: authHeaders
      });
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/fechar`, {
        method: 'PUT',
        headers: authHeaders
      });
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
    }
  };

  const handleCadastrarMotoboy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoMotoboyNome || !novoMotoboyTelefone) return;
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/motoboys/cadastro`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novoMotoboyNome, telefone: novoMotoboyTelefone })
      });
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
  const [selectedPlan, setSelectedPlan] = useState<'gold'>('gold');

  // Customer support chats & feedback mock list
  const [supportChats, setSupportChats] = useState([
    { id: 1, cliente: "Lucas Pinheiro", ultimaMsg: "Gostaria de saber se o pastel de frango tem catupiry", status: "pendente", canal: "whats" },
    { id: 2, cliente: "Amanda Lima", ultimaMsg: "Meu pedido está demorando muito para sair", status: "pendente", canal: "ifood" }
  ]);

  const [customerFeedbacks, setCustomerFeedbacks] = useState([
    { id: 1, cliente: "Renata Abreu", estrelas: 5, comentario: "Melhor pastel da cidade! Super crocante e sequinho.", data: "Hoje" },
    { id: 2, cliente: "Jefferson Cruz", estrelas: 4, comentario: "Hambúrguer excelente. A entrega demorou uns 10 minutos a mais.", data: "Ontem" },
    { id: 3, cliente: "Tiago Lemos", estrelas: 5, comentario: "O atendimento pelo WhatsApp foi muito rápido e atencioso.", data: "Ontem" }
  ]);
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

  // Fetch registered users (waiters CRUD)
  const fetchSystemUsers = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/auth/usuarios`, { headers: authHeaders });
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
      const res = await fetch(`${apiBaseUrl}/caixa/configuracoes`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setCheckoutServiceTax(data.taxa_servico_ativa);
        setServiceTaxRate(data.taxa_servico_padrao);
        setUnificarViasDelivery(data.unificar_vias_delivery);
        setModoExclusivoSalao(data.modo_exclusivo_salao);
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

  const fetchProdutos = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/produtos/`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setApiProdutos(data);
      }
    } catch (e) {
      console.error('Error fetching produtos', e);
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
    }, 8000); // 8s is enough — WS handles real-time, polling is fallback only

    return () => clearInterval(interval);
  }, []);

  // Fetch optimized statistics, stock, and reports
  useEffect(() => {
    if (activeTab === 'relatorios' && activeSubTab === 'relatorio_garçons') {
      fetch(`${apiBaseUrl}/garcons/relatorio`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setWaitersPerformance(data);
        })
        .catch(err => console.error('Error fetching waiter report:', err));
    }
    if (activeTab === 'relatorios' && activeSubTab === 'relatorio_geral') {
      fetch(`${apiBaseUrl}/comandas/estatisticas/geral`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (data && data.faturamento !== undefined) setGeneralStats(data);
        })
        .catch(err => console.error('Error fetching general stats report:', err));
    }
    if (activeTab === 'estoque') {
      fetch(`${apiBaseUrl}/estoque/insumos`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setEstoqueInsumos(data);
        })
        .catch(err => console.error('Error fetching insumos:', err));

      fetch(`${apiBaseUrl}/estoque/sugestoes`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setEstoqueSugestoes(data);
        })
        .catch(err => console.error('Error fetching stock suggestions:', err));
    }
    if (activeTab === 'dashboard' && activeSubTab === 'metas') {
      fetch(`${apiBaseUrl}/comandas/estatisticas/pico`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setHorariosPico(data);
        })
        .catch(err => console.error('Error fetching peak hours:', err));
    }
    if (activeTab === 'clientes' && activeSubTab === 'fidelidade') {
      fetch(`${apiBaseUrl}/fidelidade/config`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (data && data.tipo_recompensa) setFidelidadeConfig(data);
        })
        .catch(err => console.error('Error fetching fidelity config:', err));

      fetch(`${apiBaseUrl}/fidelidade/clientes`, { headers: authHeaders })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setLoyaltyUsers(data);
        })
        .catch(err => console.error('Error fetching loyalty clients:', err));
    }
    if (activeTab === 'cardapio') {
      fetchProdutos();
    }
  }, [activeTab, activeSubTab]);


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
    if (!selectedOrder) return;
    setErrorMsg('');

    try {
      const res = await fetch(`${apiBaseUrl}/caixa/comandas/${selectedOrder.id}/pagar`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valor: parseFloat(paymentValor),
          metodo: paymentMetodo,
          item_ids: selectedItemIds.length > 0 ? selectedItemIds : null,
          idempotency_key: idempotencyKey,
          cpf_cliente: paymentCPF || null
        })
      });
      if (res.ok) {
        setPaymentValor('');
        setPaymentCPF('');
        setSelectedItemIds([]);
        setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

        // Refresh local details modal state
        const updatedOrdersRes = await fetch(`${apiBaseUrl}/comandas/detalhes/todos?fechada=false`, { headers: authHeaders });
        if (updatedOrdersRes.ok) {
          const freshOrdersList: Order[] = await updatedOrdersRes.json();
          const stillOpen = freshOrdersList.find(o => o.id === selectedOrder.id);
          if (stillOpen) {
            setSelectedOrder({
              ...selectedOrder,
              itens: stillOpen.itens.map((item: any) => ({
                id: item.id,
                produtoId: item.produto_id,
                nome: item.nome || `Item ${item.produto_id}`,
                preco: item.preco_unit,
                observacao: item.observacao || '',
                clienteNome: item.cliente_nome || 'Consumo Geral',
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
    } catch (err) {
      setErrorMsg('Erro de conexão ao servidor.');
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

  // Waiter CRUD actions
  const handleAddUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserNome || !newUserUsuario || !newUserSenha) return;
    try {
      const res = await fetch(`${apiBaseUrl}/auth/usuarios`, {
        method: "POST",
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: newUserNome,
          usuario: newUserUsuario,
          senha: newUserSenha,
          role: newUserRole
        })
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
      const res = await fetch(`${apiBaseUrl}/auth/usuarios/${userId}`, {
        method: "DELETE",
        headers: authHeaders
      });
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
      const res = await fetch(`${apiBaseUrl}/comandas/itens/${itemId}/status?status=${newStatus}`, {
        method: "PUT",
        headers: authHeaders
      });
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
    const taxa = checkoutServiceTax ? subtotal * (serviceTaxRate / 100) : 0;
    const total = subtotal + taxa;
    return { subtotal, taxa, total, unpaidItems };
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

  // Submit Order from PDV Counter
  const handlePdvSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const openRes = await fetch(`${apiBaseUrl}/comandas/`, {
        method: "POST",
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mesa_id: pdvOrderType === 'mesa' ? pdvTargetMesaId : null,
          garcom_id: 'c-01', // Cashier operator ID
          tipo: pdvOrderType === 'mesa' ? 'Consumo no Local' : (pdvOrderType === 'entrega' ? 'Entrega' : 'Retirada'),
          identificador: pdvCustomerName || undefined,
          delivery_status: pdvOrderType === 'entrega' ? 'producao' : undefined,
          delivery_telefone: pdvOrderType === 'entrega' ? pdvCustomerPhone : undefined,
          delivery_endereco: pdvOrderType === 'entrega' ? pdvDeliveryAddress : undefined,
          delivery_taxa: pdvOrderType === 'entrega' ? parseFloat(pdvDeliveryTaxa) || 0.0 : 0.0
        })
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

      const launchRes = await fetch(`${apiBaseUrl}/comandas/${newComanda.id}/lancamentos`, {
        method: "POST",
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          garcom_id: 'c-01',
          itens: itemsList
        })
      });
      if (launchRes.ok) {
        setPdvCart([]);
        setPdvCustomerName('');
        setPdvCustomerPhone('');
        setPdvCustomerCPF('');
        setPdvDeliveryAddress('');
        setPdvDeliveryTaxa('0.00');
        onRefreshOrders();
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
      const res = await fetch(`${apiBaseUrl}/comandas/impressoras/detectadas`, {
        headers: authHeaders
      });
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
                  { id: 'configuracoes', label: 'Ajustes de Retaguarda', icon: Smartphone }
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
                        if (tab.id === 'chat_copiloto') {
                          setActiveTab('operacao');
                          setActiveSubTab('chat_copiloto');
                        } else {
                          handleTabChange(tab.id as any);
                        }
                      }}
                      className={`w-full px-3.5 py-1.5 rounded-xl text-left font-semibold transition-all flex items-center justify-between cursor-pointer group ${(tab.id === 'chat_copiloto' ? (activeTab === 'operacao' && activeSubTab === 'chat_copiloto') : activeTab === tab.id)
                        ? 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/10 font-bold shadow-inner'
                        : 'text-gray-400 hover:text-white hover:bg-[#1C1C1F]/50 border border-transparent'
                        }`}
                    >
                      <div className={clsx('flex', 'items-center', 'gap-3')}>
                        <Icon size={13} className={(tab.id === 'chat_copiloto' ? (activeTab === 'operacao' && activeSubTab === 'chat_copiloto') : activeTab === tab.id) ? 'text-[#10b981]' : 'text-gray-500 group-hover:text-white'} />
                        <span className="text-[10px]">{tab.label}</span>
                      </div>
                      {tab.id === 'operacao' && (simulatedOrders.filter(o => o.status === 'analise').length + activeKitchenItems.length) > 0 && (
                        <span className={clsx('bg-[#10b981]', 'text-[#121214]', 'text-[7px]', 'font-bold', 'px-1.5', 'py-0.5', 'rounded-full', 'font-mono')}>
                          {simulatedOrders.filter(o => o.status === 'analise').length + activeKitchenItems.length}
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
            { id: 'salon', label: 'Layout do Salão', show: modulesActive.salon },
            { id: 'entregadores', label: 'Fretistas & Logística', show: !modoExclusivoSalao && modulesActive.delivery }
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
            { id: 'disponibilidade', label: 'Disponibilidade' }
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
            { id: 'impressoras', label: 'Roteamento de Impressoras' },
            { id: 'nicho_wizard', label: 'Setup Wizard (Nicho)' },
            { id: 'planos', label: 'Planos & Integrações' }
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
                                  const res = await fetch(`${apiBaseUrl}/caixa/pagamentos/${pag.id}/aprovar`, {
                                    method: 'POST',
                                    headers: authHeaders
                                  });
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
                                  const res = await fetch(`${apiBaseUrl}/caixa/pagamentos/${pag.id}/recusar`, {
                                    method: 'POST',
                                    headers: authHeaders
                                  });
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
                  <div className={clsx('text-[10px]', 'text-gray-400')}>
                    Total Delivery hoje: <strong className="text-white">R$ {simulatedOrders.reduce((s, o) => s + o.total, 0).toFixed(2)}</strong>
                  </div>
                </div>
              )}

              {/* Kanban columns */}
              <div className={clsx('flex-1', 'grid', 'grid-cols-1', modoExclusivoSalao ? 'md:grid-cols-2' : 'md:grid-cols-3', 'gap-4')}>

                {/* COLUMN 1: Em análise */}
                {!modoExclusivoSalao && (
                  <div className={clsx('bg-[#121214]/50', 'border', 'border-[#27272A]', 'rounded-2xl', 'flex', 'flex-col', 'overflow-hidden')}>
                    <div className={clsx('bg-[#18181B]', 'px-4', 'py-2.5', 'border-b', 'border-[#27272A]', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                      <span className={clsx('font-bold', 'text-gray-300', 'font-serif')}>Em análise</span>
                      <span className={clsx('bg-amber-500/10', 'text-amber-400', 'font-bold', 'px-2', 'py-0.5', 'rounded-full', 'font-mono', 'text-[9px]')}>
                        {simulatedOrders.filter(o => o.status === 'analise').length}
                      </span>
                    </div>

                    <div className={clsx('p-3', 'flex-1', 'overflow-y-auto', 'space-y-3')}>
                      {simulatedOrders.filter(o => o.status === 'analise').length === 0 ? (
                        <div className={clsx('py-20', 'text-center', 'text-gray-500', 'italic', 'text-[10px]')}>Nenhum pedido pendente</div>
                      ) : (
                        simulatedOrders.filter(o => o.status === 'analise').map((order) => (
                          <div key={order.id} className={clsx('bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'hover:border-amber-500/30', 'p-3', 'rounded-xl', 'space-y-2.5', 'transition-all')}>
                            <div className={clsx('flex', 'justify-between', 'items-start')}>
                              <div>
                                <span className={clsx('px-1.5', 'py-0.5', 'text-[8px]', 'uppercase', 'tracking-wider', 'font-bold', 'bg-emerald-600/20', 'text-[#C46A74]', 'rounded', 'font-mono', 'block', 'w-fit', 'mb-1')}>{order.canal}</span>
                                <strong className={clsx('text-white', 'text-xs', 'block')}>{order.cliente}</strong>
                                <span className={clsx('text-[9px]', 'text-gray-400', 'block')}>{order.telefone}</span>
                              </div>
                              <span className={clsx('font-bold', 'text-amber-400', 'font-mono', 'text-[11px]', 'shrink-0')}>R$ {order.total.toFixed(2)}</span>
                            </div>

                            <p className={clsx('text-[10px]', 'text-gray-300', 'bg-[#09090B]', 'p-1.5', 'rounded', 'border', 'border-[#27272A]/30', 'leading-relaxed', 'font-mono')}>
                              {order.itens}
                            </p>

                            <div className={clsx('flex', 'gap-1.5', 'pt-1')}>
                              <button
                                onClick={() => handleUpdateDeliveryStatus(order.id, 'producao')}
                                className={clsx('flex-1', 'py-1.5', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded-lg', 'font-bold', 'text-[9px]', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider')}
                              >
                                Aceitar Pedido
                              </button>
                              <button
                                onClick={() => handleRecusarPedido(order.id)}
                                className={clsx('px-2', 'py-1.5', 'bg-emerald-600/20', 'hover:bg-emerald-600', 'text-[#C46A74]', 'hover:text-white', 'rounded-lg', 'font-bold', 'text-[9px]', 'transition-all', 'cursor-pointer')}
                              >
                                Recusar
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* COLUMN 2: Em produção */}
                <div className={clsx('bg-[#121214]/50', 'border', 'border-[#27272A]', 'rounded-2xl', 'flex', 'flex-col', 'overflow-hidden')}>
                  <div className={clsx('bg-[#18181B]', 'px-4', 'py-2.5', 'border-b', 'border-[#27272A]', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                    <span className={clsx('font-bold', 'text-gray-300', 'font-serif')}>Em produção</span>
                    <span className={clsx('bg-[#10b981]/10', 'text-[#10b981]', 'font-bold', 'px-2', 'py-0.5', 'rounded-full', 'font-mono', 'text-[9px]')}>
                      {(modoExclusivoSalao ? 0 : simulatedOrders.filter(o => o.status === 'producao').length) + tableOrdersInProduction.length}
                    </span>
                  </div>

                  <div className={clsx('p-3', 'flex-1', 'overflow-y-auto', 'space-y-3')}>
                    {(modoExclusivoSalao ? 0 : simulatedOrders.filter(o => o.status === 'producao').length) === 0 && tableOrdersInProduction.length === 0 ? (
                      <div className={clsx('py-20', 'text-center', 'text-gray-500', 'italic', 'text-[10px]')}>Nenhum pedido em produção</div>
                    ) : (
                      <>
                        {/* Pedidos Delivery em Produção */}
                        {!modoExclusivoSalao && simulatedOrders.filter(o => o.status === 'producao').map((order) => (
                          <div key={order.id} className={clsx('bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'hover:border-[#10b981]/30', 'p-3', 'rounded-xl', 'space-y-2.5', 'transition-all')}>
                            <div className={clsx('flex', 'justify-between', 'items-start')}>
                              <div>
                                <strong className={clsx('text-white', 'text-xs', 'block')}>{order.cliente}</strong>
                                <span className={clsx('text-[9px]', 'text-gray-400', 'block')}>{order.telefone}</span>
                              </div>
                              <span className={clsx('font-bold', 'text-white', 'font-mono', 'text-[11px]', 'shrink-0')}>R$ {order.total.toFixed(2)}</span>
                            </div>

                            <p className={clsx('text-[10px]', 'text-gray-300', 'bg-[#09090B]', 'p-1.5', 'rounded', 'border', 'border-[#27272A]/30', 'leading-relaxed', 'font-mono')}>
                              {order.itens}
                            </p>

                            {order.endereco && (
                              <span className={clsx('text-[9px]', 'text-gray-400', 'flex', 'items-start', 'gap-1', 'block')}>
                                <MapPin size={10} className={clsx('shrink-0', 'text-rose-500', 'mt-0.5')} />
                                <span className="truncate">{order.endereco}</span>
                              </span>
                            )}

                            <button
                              onClick={() => handleUpdateDeliveryStatus(order.id, 'pronto')}
                              className={clsx('w-full', 'py-1.5', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-lg', 'font-bold', 'text-[9px]', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider')}
                            >
                              Marcar como Pronto
                            </button>
                          </div>
                        ))}

                        {/* Pedidos do Salão (Mesa) em Produção */}
                        {tableOrdersInProduction.map((order) => {
                          const itemCounts: Record<string, number> = {};
                          const preparingItems = order.itens.filter(item => item.status === 'preparando');
                          preparingItems.forEach(item => {
                            const name = item.nome || 'Item';
                            itemCounts[name] = (itemCounts[name] || 0) + 1;
                          });
                          const itemsStr = Object.entries(itemCounts)
                            .map(([name, qty]) => `${qty}x ${name}`)
                            .join(' + ');

                          return (
                            <div 
                              key={`table-prod-${order.id}`} 
                              onClick={() => setSelectedKanbanOrder(order)}
                              className={clsx('bg-[#121214]', 'border', 'border-[#27272A]/60', 'hover:border-[#10b981]/30', 'p-3', 'rounded-xl', 'space-y-2.5', 'transition-all', 'text-left', 'cursor-pointer')}
                            >
                              <div className={clsx('flex', 'justify-between', 'items-start')}>
                                <div>
                                  <span className={clsx('px-1.5', 'py-0.5', 'text-[8px]', 'uppercase', 'tracking-wider', 'font-bold', 'bg-[#10b981]/15', 'text-[#10b981]', 'rounded', 'font-mono', 'block', 'w-fit', 'mb-1')}>
                                    {order.mesaId && order.mesaId > 0 ? `Mesa ${order.mesaId}` : 'Balcão'}
                                  </span>
                                  <strong className={clsx('text-white', 'text-xs', 'block')}>
                                    {(order as any).identificador || (order.mesaId && order.mesaId > 0 ? `Consumo Mesa ${order.mesaId}` : 'Consumo Balcão')}
                                  </strong>
                                  <span className={clsx('text-[9px]', 'text-gray-500', 'block')}>Atendente: {order.garcomNome || 'Garçom'}</span>
                                </div>
                                <span className={clsx('text-[9px]', 'text-gray-500', 'font-mono')}>#{order.id.slice(-4)}</span>
                              </div>

                              <p className={clsx('text-[10px]', 'text-[#10b981]', 'bg-[#09090B]', 'p-1.5', 'rounded', 'border', 'border-[#27272A]/30', 'leading-relaxed', 'font-mono')}>
                                {itemsStr}
                              </p>

                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  // Fire-and-forget: update UI immediately without waiting for all API calls
                                  onRefreshOrders();
                                  Promise.all(preparingItems.map(item =>
                                    fetch(`${apiBaseUrl}/comandas/itens/${item.id}/status?status=pronto`, {
                                      method: "PUT",
                                      headers: authHeaders
                                    })
                                  )).then(() => onRefreshOrders()).catch(err => {
                                    console.error(err);
                                  });
                                }}
                                className={clsx('w-full', 'py-1.5', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'rounded-lg', 'font-bold', 'text-[9px]', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'flex', 'items-center', 'justify-center', 'gap-1')}
                              >
                                <Check size={11} />
                                <span>Pronto</span>
                              </button>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>

                {/* COLUMN 3: Prontos para entrega */}
                <div className={clsx('bg-[#121214]/50', 'border', 'border-[#27272A]', 'rounded-2xl', 'flex', 'flex-col', 'overflow-hidden')}>
                  <div className={clsx('bg-[#18181B]', 'px-4', 'py-2.5', 'border-b', 'border-[#27272A]', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
                    <span className={clsx('font-bold', 'text-gray-300', 'font-serif')}>Prontos / Fechar Conta</span>
                    <span className={clsx('bg-emerald-500/10', 'text-emerald-400', 'font-bold', 'px-2', 'py-0.5', 'rounded-full', 'font-mono', 'text-[9px]')}>
                      {(modoExclusivoSalao ? 0 : simulatedOrders.filter(o => o.status === 'pronto').length) + tableOrdersReady.length}
                    </span>
                  </div>

                  <div className={clsx('p-3', 'flex-1', 'overflow-y-auto', 'space-y-3')}>
                    {(modoExclusivoSalao ? 0 : simulatedOrders.filter(o => o.status === 'pronto').length) === 0 && tableOrdersReady.length === 0 ? (
                      <div className={clsx('py-20', 'text-center', 'text-gray-500', 'italic', 'text-[10px]')}>Nenhum pedido pronto</div>
                    ) : (
                      <>
                        {/* Pedidos Delivery Prontos */}
                        {!modoExclusivoSalao && simulatedOrders.filter(o => o.status === 'pronto').map((order) => (
                          <div key={order.id} className={clsx('bg-[#1C1C1F]', 'border', 'border-emerald-500/30', 'p-3', 'rounded-xl', 'space-y-2.5', 'transition-all')}>
                            <div className={clsx('flex', 'justify-between', 'items-start')}>
                              <div>
                                <strong className={clsx('text-white', 'text-xs', 'block')}>{order.cliente}</strong>
                                <span className={clsx('text-[9px]', 'text-gray-400', 'block')}>{order.telefone}</span>
                              </div>
                              <span className={clsx('font-bold', 'text-emerald-400', 'font-mono', 'text-[11px]', 'shrink-0')}>R$ {order.total.toFixed(2)}</span>
                            </div>

                            {order.endereco && (
                              <span className={clsx('text-[9px]', 'text-gray-400', 'flex', 'items-start', 'gap-1', 'block')}>
                                <MapPin size={10} className={clsx('shrink-0', 'text-rose-500', 'mt-0.5')} />
                                <span className="leading-relaxed">{order.endereco}</span>
                              </span>
                            )}

                            <button
                              onClick={() => handleFinalizarPedido(order.id)}
                              className={clsx('w-full', 'py-1.5', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded-lg', 'font-bold', 'text-[9px]', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider')}
                            >
                              Finalizar Pedido
                            </button>
                          </div>
                        ))}

                        {/* Pedidos do Salão (Mesa) Prontos para Servir */}
                         {tableOrdersReady.map((order) => {
                           const itemCounts: Record<string, number> = {};
                           const readyItems = order.itens.filter(item => item.status === 'pronto');
                           readyItems.forEach(item => {
                             const name = item.nome || 'Item';
                             itemCounts[name] = (itemCounts[name] || 0) + 1;
                           });
                           const itemsStr = Object.entries(itemCounts)
                             .map(([name, qty]) => `${qty}x ${name}`)
                             .join(' + ');

                           const isDelivery = order.tipo === 'Entrega';
                           const isTakeout = order.tipo === 'Retirada';

                           const badgeText = isDelivery ? 'Delivery - Pronto' : isTakeout ? 'Retirada - Pronto' : (order.mesaId && order.mesaId > 0 ? `Mesa ${order.mesaId} - Pronto` : 'Balcão - Pronto');
                           const badgeColorClass = isDelivery ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : isTakeout ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';

                           const cardTitle = order.identificador || (isDelivery ? 'Pedido Entrega' : isTakeout ? 'Pedido Retirada' : (order.mesaId && order.mesaId > 0 ? `Consumo Mesa ${order.mesaId}` : 'Consumo Balcão'));

                           let buttonText = 'Fechar Conta';
                           let buttonColorClass = 'bg-blue-600 hover:bg-blue-700 text-white';
                           
                           if (isDelivery) {
                             buttonText = 'Saiu para Entrega';
                             buttonColorClass = 'bg-orange-600 hover:bg-orange-700 text-white';
                           } else if (isTakeout) {
                             buttonText = 'Retirou';
                             buttonColorClass = 'bg-amber-600 hover:bg-amber-700 text-white';
                           }

                           return (
                              <div 
                                key={`table-ready-${order.id}`} 
                                onClick={() => setSelectedKanbanOrder(order)}
                                className={clsx('bg-[#121214]', 'border', 'border-emerald-500/20', 'hover:border-emerald-500/40', 'p-3', 'rounded-xl', 'space-y-2.5', 'transition-all', 'text-left', 'cursor-pointer')}
                              >
                                <div className={clsx('flex', 'justify-between', 'items-start')}>
                                  <div>
                                    <span className={clsx('px-1.5', 'py-0.5', 'text-[8px]', 'uppercase', 'tracking-wider', 'font-bold', 'rounded', 'font-mono', 'block', 'w-fit', 'mb-1', badgeColorClass)}>
                                      {badgeText}
                                    </span>
                                    <strong className={clsx('text-white', 'text-xs', 'block')}>
                                      {cardTitle}
                                    </strong>
                                  </div>
                                  <span className={clsx('text-[9px]', 'text-gray-500', 'font-mono')}>#{order.id.slice(-4)}</span>
                                </div>

                                <p className={clsx('text-[10px]', 'text-emerald-400', 'bg-[#09090B]', 'p-1.5', 'rounded', 'border', 'border-[#27272A]/10', 'leading-relaxed', 'font-mono')}>
                                  {itemsStr}
                                </p>

                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const fullOrder = orders.find(o => o.id === order.comandaId) || orders.find(o => o.mesaId === order.mesaId);
                                    if (!fullOrder) return;

                                    if (isDelivery) {
                                      if (confirm("Confirmar que o pedido saiu para entrega? Isso atualizará o status no iFood/plataformas.")) {
                                        try {
                                          await Promise.all(readyItems.map(item =>
                                            fetch(`${apiBaseUrl}/comandas/itens/${item.id}/status?status=entregue`, {
                                              method: "PUT",
                                              headers: authHeaders
                                            })
                                          ));
                                          await fetch(`${apiBaseUrl}/comandas/${order.comandaId}/delivery/status?status_novo=finalizado`, {
                                            method: 'PUT',
                                            headers: authHeaders
                                          });
                                          await fetch(`${apiBaseUrl}/comandas/${order.comandaId}/fechar`, {
                                            method: 'PUT',
                                            headers: authHeaders
                                          });
                                          onRefreshOrders();
                                          alert("Pedido despachado e finalizado com sucesso!");
                                        } catch (err) {
                                          console.error(err);
                                          alert("Erro ao despachar entrega.");
                                        }
                                      }
                                    } else if (isTakeout) {
                                      const { total } = getCheckoutTotals(fullOrder);
                                      const isFullyPaid = fullOrder.valorPago >= total;

                                      if (isFullyPaid) {
                                        try {
                                          await Promise.all(readyItems.map(item =>
                                            fetch(`${apiBaseUrl}/comandas/itens/${item.id}/status?status=entregue`, {
                                              method: "PUT",
                                              headers: authHeaders
                                            })
                                          ));
                                          await fetch(`${apiBaseUrl}/comandas/${order.comandaId}/fechar`, {
                                            method: "PUT",
                                            headers: authHeaders
                                          });
                                          onRefreshOrders();
                                          alert("Retirada finalizada com sucesso!");
                                        } catch (err) {
                                          console.error(err);
                                          alert("Erro ao finalizar retirada.");
                                        }
                                      } else {
                                        setSelectedOrder({
                                          ...fullOrder,
                                          itens: fullOrder.itens.map((item: any) => ({
                                            id: item.id,
                                            produtoId: item.produto_id || item.produtoId,
                                            nome: item.nome || `Item ${item.produtoId}`,
                                            preco: item.preco_unit || item.preco,
                                            observacao: item.observacao || '',
                                            clienteNome: item.cliente_nome || item.clienteNome || 'Consumo Geral',
                                            status: item.status,
                                            pago: item.pago
                                          }))
                                        });
                                        setShowCheckoutModal(true);
                                        setCheckoutServiceTax(false);
                                        setSplitPeople('1');
                                        setSelectedItemIds([]);
                                        const sub = fullOrder.itens.filter((item: any) => !item.pago).reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
                                        setPaymentValor(sub.toFixed(2));
                                      }
                                    } else {
                                      setSelectedOrder({
                                        ...fullOrder,
                                        itens: fullOrder.itens.map((item: any) => ({
                                          id: item.id,
                                          produtoId: item.produto_id || item.produtoId,
                                          nome: item.nome || `Item ${item.produtoId}`,
                                          preco: item.preco_unit || item.preco,
                                          observacao: item.observacao || '',
                                          clienteNome: item.cliente_nome || item.clienteNome || 'Consumo Geral',
                                          status: item.status,
                                          pago: item.pago
                                        }))
                                      });
                                      setShowCheckoutModal(true);
                                      setCheckoutServiceTax(true);
                                      setSplitPeople('1');
                                      setSelectedItemIds([]);
                                      const sub = fullOrder.itens.filter((item: any) => !item.pago).reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
                                      setPaymentValor((sub * (1.0 + (checkoutServiceTax ? serviceTaxRate / 100 : 0))).toFixed(2));
                                    }
                                  }}
                                  className={clsx('w-full', 'py-1.5', 'rounded-lg', 'font-bold', 'text-[9px]', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'flex', 'items-center', 'justify-center', 'gap-1', buttonColorClass)}
                                >
                                  <Check size={11} />
                                  <span>{buttonText}</span>
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
          {activeSubTab === 'pdv' && (
            <div className={clsx('h-full', 'flex', 'gap-5', 'overflow-hidden')}>

              {/* Product grid column */}
              <div className={clsx('flex-1', 'flex', 'flex-col', 'space-y-4', 'overflow-hidden')}>
                <div className={clsx('space-y-3', 'shrink-0')}>
                  <div className={clsx('flex', 'gap-2')}>
                    <div className="flex-1">
                      <input
                        id="pdv-search-input"
                        type="text"
                        placeholder="Pesquisar prato no menu..."
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
                    {CATEGORIES.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setPdvSelectedCategory(cat)}
                        className={`px-3 py-1.5 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-all border ${pdvSelectedCategory === cat
                          ? 'bg-emerald-600 text-white border-transparent'
                          : 'bg-[#121214] border-[#27272A] text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                          }`}
                      >
                        {cat}
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
                        className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'hover:border-[#10b981]/30', 'p-3', 'rounded-xl', 'flex', 'flex-col', 'justify-between', 'gap-3', 'cursor-pointer', 'group', 'hover:shadow-md', 'transition-all', 'text-left')}
                      >
                        <div>
                          <h4 className={clsx('font-serif', 'font-bold', 'text-white', 'group-hover:text-[#10b981]', 'transition-colors')}>{p.nome}</h4>
                          <p className={clsx('text-[9px]', 'text-gray-500', 'mt-1', 'line-clamp-2')}>{p.descricao}</p>
                        </div>
                        <div className={clsx('flex', 'justify-between', 'items-center')}>
                          <span className={clsx('font-bold', 'text-white', 'font-mono')}>R$ {p.preco.toFixed(2)}</span>
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
              <div className={clsx('w-80', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-2xl', 'flex', 'flex-col', 'overflow-hidden', 'shrink-0')}>
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

                <form onSubmit={handlePdvSubmitOrder} className={clsx('bg-[#18181B]', 'p-3', 'border-t', 'border-[#27272A]', 'space-y-3', 'shrink-0')}>
                  {!modoExclusivoSalao && (
                    <div className="space-y-1">
                      <div className={clsx('flex', 'gap-1', 'p-0.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'shrink-0')}>
                        <button
                          type="button"
                          onClick={() => setPdvOrderType('balcao')}
                          className={`flex-1 py-1 text-[8.5px] font-bold rounded transition-all cursor-pointer ${pdvOrderType === 'balcao' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                            }`}
                        >
                          Balcão
                        </button>
                        <button
                          type="button"
                          onClick={() => setPdvOrderType('entrega')}
                          className={`flex-1 py-1 text-[8.5px] font-bold rounded transition-all cursor-pointer ${pdvOrderType === 'entrega' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                            }`}
                        >
                          Delivery
                        </button>
                        <button
                          type="button"
                          onClick={() => setPdvOrderType('mesa')}
                          className={`flex-1 py-1 text-[8.5px] font-bold rounded transition-all cursor-pointer ${pdvOrderType === 'mesa' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                            }`}
                        >
                          Mesa
                        </button>
                      </div>
                      <span className={clsx('text-[7.5px]', 'text-gray-500', 'font-mono', 'block', 'text-left')}>Atalhos de Tipo: [F2] Balcão • [F3] Mesa • [F8] Delivery</span>
                    </div>
                  )}

                  {pdvOrderType === 'mesa' && (
                    <div className="space-y-1">
                      <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Mesa Destino:</label>
                      <select
                        id="pdv-mesa-select"
                        value={pdvTargetMesaId}
                        onChange={(e) => setPdvTargetMesaId(parseInt(e.target.value))}
                        className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white', 'text-[10px]')}
                      >
                        <option value={0}>Selecione uma mesa...</option>
                        {salonTables.map(t => (
                          <option key={t.id} value={t.id}>Mesa {t.id} (Cap: {t.capacidade})</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {pdvOrderType === 'balcao' && (
                    <div className={clsx('grid', 'grid-cols-2', 'gap-1.5')}>
                      <div className="space-y-1">
                        <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Nome Cliente:</label>
                        <input
                          id="pdv-customer-name-input"
                          type="text"
                          placeholder="Ex: Maria"
                          required={pdvCart.length > 0}
                          value={pdvCustomerName}
                          onChange={(e) => setPdvCustomerName(e.target.value)}
                          className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Telefone:</label>
                        <input
                          type="text"
                          placeholder="(81) 9..."
                          value={pdvCustomerPhone}
                          onChange={(e) => setPdvCustomerPhone(e.target.value)}
                          className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                        />
                      </div>
                    </div>
                  )}

                  {pdvOrderType === 'entrega' && (
                    <div className="space-y-2.5">
                      <div className={clsx('grid', 'grid-cols-2', 'gap-1.5')}>
                        <div className="space-y-1">
                          <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Nome Cliente:</label>
                          <input
                            id="pdv-customer-name-input"
                            type="text"
                            placeholder="Ex: Maria"
                            required={pdvCart.length > 0}
                            value={pdvCustomerName}
                            onChange={(e) => setPdvCustomerName(e.target.value)}
                            className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Telefone:</label>
                          <input
                            type="text"
                            placeholder="(81) 9..."
                            value={pdvCustomerPhone}
                            onChange={(e) => setPdvCustomerPhone(e.target.value)}
                            className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Endereço de Entrega:</label>
                        <input
                          type="text"
                          placeholder="Rua, Número, Bairro, Complemento"
                          required={pdvCart.length > 0}
                          value={pdvDeliveryAddress}
                          onChange={(e) => setPdvDeliveryAddress(e.target.value)}
                          className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Taxa de Entrega (R$):</label>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="5.00"
                          value={pdvDeliveryTaxa}
                          onChange={(e) => setPdvDeliveryTaxa(e.target.value)}
                          className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                        />
                      </div>
                    </div>
                  )}

                  <div className={clsx('flex', 'justify-between', 'items-center', 'font-mono', 'border-t', 'border-[#27272A]', 'pt-2', 'text-[11px]', 'font-bold', 'text-white')}>
                    <span>Total Pedido:</span>
                    <span className={clsx('text-[#10b981]', 'text-sm')}>
                      R$ {(
                        pdvCart.reduce((sum, item) => sum + (item.product.preco * item.quantity), 0) +
                        (pdvOrderType === 'entrega' ? parseFloat(pdvDeliveryTaxa) || 0 : 0)
                      ).toFixed(2)}
                    </span>
                  </div>

                  {modoExclusivoSalao && (pdvOrderType !== 'mesa' || !pdvTargetMesaId || pdvTargetMesaId === 0) && (
                    <div className={clsx('text-[9.5px]', 'text-amber-500', 'border', 'border-amber-500/20', 'bg-amber-500/5', 'px-2.5', 'py-1.5', 'rounded-lg', 'text-left', 'leading-relaxed')}>
                      Durante o modo de testes de salão, todos os pedidos de venda devem ser vinculados a uma Mesa física ativa.
                    </div>
                  )}

                  <button
                    id="pdv-submit-btn"
                    type="submit"
                    disabled={modoExclusivoSalao && (pdvOrderType !== 'mesa' || !pdvTargetMesaId || pdvTargetMesaId === 0)}
                    className={clsx('w-full', 'py-2', 'bg-emerald-600', 'hover:bg-emerald-700', 'disabled:bg-zinc-800', 'disabled:text-zinc-500', 'disabled:border-zinc-800', 'disabled:cursor-not-allowed', 'text-white', 'rounded-lg', 'font-bold', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer', 'flex', 'flex-col', 'items-center', 'justify-center', 'gap-0.5', 'shadow')}
                  >
                    <div className={clsx('flex', 'items-center', 'gap-1')}>
                      <Check size={12} />
                      <span>Lançar Pedido</span>
                    </div>
                    <span className={clsx('text-[7.5px]', 'text-emerald-200/80', 'font-mono', 'font-normal')}>Pressione [F4] para finalizar</span>
                  </button>
                </form>
              </div>

            </div>
          )}

          {/* VIEW 3: MAPA DE MESAS (Salão) */}
          {activeSubTab === 'salon' && (
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

              <div className={clsx('flex-1', 'bg-[#121214]/50', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'overflow-y-auto')}>
                <div className={clsx('grid', 'grid-cols-1', 'sm:grid-cols-2', 'md:grid-cols-3', 'lg:grid-cols-4', 'xl:grid-cols-6', 'gap-4')}>
                  {salonTables.map((table) => {
                    const tableOrders = orders.filter(o => o.mesaId === table.id);
                    const isOcupada = tableOrders.length > 0;
                    const hasPendingPayment = pagamentosPendentes.some(pag => 
                      tableOrders.some(o => o.id === pag.comanda_id)
                    );

                    return (
                      <div
                        key={table.id}
                        className={`bg-[#121214] border rounded-2xl p-3 flex flex-col justify-between gap-3 transition-all relative group ${hasPendingPayment
                          ? 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)] animate-pulse'
                          : isOcupada
                            ? 'border-rose-500/40 hover:border-rose-500'
                            : 'border-[#27272A] hover:border-[#10b981]/30'
                          }`}
                      >
                        <div className={clsx('flex', 'justify-between', 'items-start')}>
                          <div>
                            <span className={clsx('text-[9px]', 'font-bold', 'text-gray-500', 'uppercase', 'tracking-widest', 'block')}>Mesa</span>
                            <strong className={clsx('text-xl', 'font-serif', 'text-white', 'leading-none')}>{table.id}</strong>
                            {table.nome && table.nome !== `Mesa ${table.id}` && (
                              <span className={clsx('text-[9px]', 'text-[#10b981]', 'block', 'mt-0.5')}>{table.nome}</span>
                            )}
                          </div>
                          <div className={clsx('flex', 'gap-1', 'opacity-0', 'group-hover:opacity-100', 'transition-opacity')}>
                            <button
                              onClick={() => {
                                const newName = prompt(`Novo nome/identificação para Mesa ${table.id} (Deixe em branco para padrão):`, table.nome || '');
                                const newCap = prompt(`Nova capacidade (lugares) para Mesa ${table.id}?`, table.capacidade.toString());
                                if (newCap && !isNaN(parseInt(newCap))) {
                                  onUpdateMesa(table.id, parseInt(newCap), newName !== null ? (newName.trim() || `Mesa ${table.id}`) : undefined);
                                } else if (newName !== null) {
                                  onUpdateMesa(table.id, table.capacidade, newName.trim() || `Mesa ${table.id}`);
                                }
                              }}
                              className={clsx('p-1', 'text-gray-400', 'hover:text-[#10b981]')}
                              title="Editar capacidade"
                            >
                              <Edit3 size={10} />
                            </button>
                            <button
                              onClick={() => handleDeleteMesaAction(table.id)}
                              className={clsx('p-1', 'text-gray-400', 'hover:text-emerald-500')}
                              title="Excluir mesa"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>

                        <div>
                          {hasPendingPayment ? (
                            <span className={clsx('px-2', 'py-0.5', 'text-[8px]', 'bg-amber-500/10', 'text-amber-400', 'font-bold', 'rounded-md', 'block', 'w-fit', 'border', 'border-amber-500/20', 'uppercase', 'tracking-wider animate-pulse')}>Confirmar Dinheiro</span>
                          ) : isOcupada ? (
                            <span className={clsx('px-2', 'py-0.5', 'text-[8px]', 'bg-rose-500/10', 'text-rose-400', 'font-bold', 'rounded-md', 'block', 'w-fit', 'border', 'border-rose-500/10', 'uppercase', 'tracking-wider')}>Ocupada</span>
                          ) : (
                            <span className={clsx('px-2', 'py-0.5', 'text-[8px]', 'bg-emerald-500/10', 'text-emerald-400', 'rounded-md', 'block', 'w-fit', 'border', 'border-emerald-500/10', 'uppercase', 'tracking-wider')}>Livre</span>
                          )}
                        </div>

                        {isOcupada && (
                          <div className={clsx('flex', 'gap-1', 'pt-1.5', 'border-t', 'border-[#27272A]')}>
                            <button
                              onClick={() => {
                                const order = tableOrders[0];
                                setSelectedOrder({
                                  ...order,
                                  itens: order.itens.map((item: any) => ({
                                    id: item.id,
                                    produtoId: item.produto_id || item.produtoId,
                                    nome: item.nome || `Item ${item.produtoId}`,
                                    preco: item.preco_unit || item.preco,
                                    observacao: item.observacao || '',
                                    clienteNome: item.cliente_nome || 'Consumo Geral',
                                    status: item.status,
                                    pago: item.pago
                                  }))
                                });
                                setShowCheckoutModal(true);
                                setCheckoutServiceTax(true);
                                setSplitPeople('1');
                                setSelectedItemIds([]);
                                const sub = order.itens.filter((item: any) => !item.pago).reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
                                setPaymentValor((sub * (1.0 + (checkoutServiceTax ? serviceTaxRate / 100 : 0))).toFixed(2));
                              }}
                              className={clsx('flex-1', 'py-1', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded', 'font-bold', 'text-[8px]', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider')}
                            >
                              Checkout
                            </button>
                            <button
                              onClick={() => handleForceFreeTable(table.id)}
                              className={clsx('p-1', 'bg-emerald-600/20', 'hover:bg-emerald-600', 'text-[#C46A74]', 'hover:text-white', 'rounded', 'transition-colors', 'cursor-pointer')}
                            >
                              <X size={10} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                  <strong className={clsx('text-xl', 'text-white', 'font-mono', 'block', 'mt-1')}>R$ 1.956,20</strong>
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
                      <strong className={clsx('text-base', 'text-white', 'mt-1', 'block')}>R$ {desempenhoRange === '7' ? "19.652,18" : desempenhoRange === '15' ? "38.120,40" : "75.892,10"}</strong>
                    </div>
                    <span className={clsx('text-[10px]', 'text-emerald-400', 'font-bold', 'bg-emerald-500/10', 'px-2', 'py-0.5', 'rounded', 'flex', 'items-center', 'gap-0.5')}>
                      <ArrowUpRight size={10} /> 28.2%
                    </span>
                  </div>

                  <div className={clsx('bg-[#1C1C1F]', 'p-3.5', 'rounded-xl', 'border', 'border-[#27272A]/50', 'flex', 'justify-between', 'items-center')}>
                    <div>
                      <span className={clsx('text-[8px]', 'font-bold', 'font-sans', 'text-gray-400', 'uppercase', 'tracking-widest', 'block')}>Pedidos</span>
                      <strong className={clsx('text-base', 'text-white', 'mt-1', 'block')}>{desempenhoRange === '7' ? "527" : desempenhoRange === '15' ? "1.042" : "2.115"}</strong>
                    </div>
                    <span className={clsx('text-[10px]', 'text-emerald-400', 'font-bold', 'bg-emerald-500/10', 'px-2', 'py-0.5', 'rounded', 'flex', 'items-center', 'gap-0.5')}>
                      <ArrowUpRight size={10} /> 24.8%
                    </span>
                  </div>

                  <div className={clsx('bg-[#1C1C1F]', 'p-3.5', 'rounded-xl', 'border', 'border-[#27272A]/50', 'flex', 'justify-between', 'items-center')}>
                    <div>
                      <span className={clsx('text-[8px]', 'font-bold', 'font-sans', 'text-gray-400', 'uppercase', 'tracking-widest', 'block')}>Ticket Médio</span>
                      <strong className={clsx('text-base', 'text-white', 'mt-1', 'block')}>R$ {desempenhoRange === '7' ? "37,29" : desempenhoRange === '15' ? "36,58" : "35,88"}</strong>
                    </div>
                    <span className={clsx('text-[10px]', 'text-emerald-400', 'font-bold', 'bg-emerald-500/10', 'px-2', 'py-0.5', 'rounded', 'flex', 'items-center', 'gap-0.5')}>
                      <ArrowUpRight size={10} /> 2.7%
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
                      <circle cx="50" cy="50" r="42" stroke="url(#gradient)" strokeWidth="8" fill="transparent" strokeDasharray="264" strokeDashoffset={264 - (264 * 85) / 100} strokeLinecap="round" />
                      <defs>
                        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#10b981" />
                          <stop offset="100%" stopColor="#10b981" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <span className={clsx('text-lg', 'font-bold', 'font-mono', 'text-white')}>85%</span>
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
                      { name: "Entrega (Delivery)", count: 263, max: 539, barColor: "bg-rose-600" },
                      { name: "Consumo no Local (Mesa)", count: 214, max: 539, barColor: "bg-[#10b981]" },
                      { name: "Retirada (Balcão)", count: 62, max: 539, barColor: "bg-emerald-600" }
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
                    {[
                      { rank: "1º", name: "Pastel de Carne", count: 142, price: 12.00 },
                      { rank: "2º", name: "Hambúrguer Kôma", count: 98, price: 22.00 },
                      { rank: "3º", name: "Pastel Especial", count: 85, price: 18.00 },
                      { rank: "4º", name: "Coca-Cola Lata", count: 74, price: 6.00 },
                      { rank: "5º", name: "Cerveja Heineken", count: 60, price: 8.50 }
                    ].map((item, idx) => (
                      <div key={idx} className={clsx('py-2', 'flex', 'justify-between', 'items-center')}>
                        <div className={clsx('flex', 'items-center', 'gap-2.5')}>
                          <span className={`h-5 w-5 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold ${idx === 0 ? 'bg-emerald-600 text-white' : idx === 1 ? 'bg-[#10b981] text-[#121214]' : 'bg-[#1C1C1F] text-gray-400'
                            }`}>{item.rank}</span>
                          <span className={clsx('font-medium', 'text-white', 'block')}>{item.name}</span>
                        </div>
                        <span className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'font-mono')}>{item.count} saídas</span>
                      </div>
                    ))}
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
                        checked={checkoutServiceTax}
                        onChange={(e) => {
                          setCheckoutServiceTax(e.target.checked);
                          updateConfiguracoes({ taxa_servico_ativa: e.target.checked });
                        }}
                        className={clsx('sr-only', 'peer')}
                      />
                      <div className={clsx('w-9', 'h-5', 'bg-[#27272A]', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-4', 'after:w-4', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                    </label>
                  </div>

                  {checkoutServiceTax && (
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

              {/* Printer messages & test (Right Column) */}
              <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'flex', 'flex-col', 'justify-between')}>
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

                    <div className={clsx('flex', 'justify-between', 'items-center', 'pt-2', 'border-t', 'border-[#27272A]/40')}>
                      <span className={clsx('text-[10px]', 'text-gray-300', 'font-semibold')}>Modo Exclusivo de Salão (Kôma Lite)</span>
                      <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer')}>
                        <input
                          type="checkbox"
                          checked={modoExclusivoSalao}
                          onChange={(e) => {
                            setModoExclusivoSalao(e.target.checked);
                            updateConfiguracoes({ modo_exclusivo_salao: e.target.checked });
                          }}
                          className={clsx('sr-only', 'peer')}
                        />
                        <div className={clsx('w-9', 'h-5', 'bg-[#27272A]', 'peer-focus:outline-none', 'rounded-full', 'peer', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', "after:content-['']", 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-gray-300', 'after:border', 'after:rounded-full', 'after:h-4', 'after:w-4', 'after:transition-all', 'peer-checked:bg-emerald-600')}></div>
                      </label>
                    </div>
                  </div>

                  {/* Detected printers list / test search */}
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
                                  const res = await fetch(`${apiBaseUrl}/comandas/teste-impressao`, {
                                    method: 'POST',
                                    headers: authHeaders
                                  });
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
                    { id: 'bronze', name: 'Plano Bronze', price: 'R$ 99/mês', features: ['Menu Digital QR Code', 'Gestão de Mesas', 'Suporte por e-mail'] },
                    { id: 'gold', name: 'Plano Ouro (Recomendado)', price: 'R$ 199/mês', features: ['Menu Digital + iFood', 'Robô de Atendimento IA', 'Suporte 24h WhatsApp'] },
                    { id: 'platinum', name: 'Plano Platinum', price: 'R$ 349/mês', features: ['Multi-lojas Integrado', 'Gestão de Estoque Avançado', 'Gerente de Contas Dedicado'] }
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
              <div className={clsx('flex', 'justify-between', 'items-center', 'gap-3')}>
                <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'px-3', 'py-1.5', 'text-[10px]', 'text-gray-300', 'font-bold', 'font-mono')}>
                  25/06/2026 - 01/07/2026
                </div>
                <div className={clsx('flex', 'gap-2')}>
                  <button className={clsx('px-3', 'py-1', 'bg-[#10b981]', 'text-[#121214]', 'hover:bg-[#059669]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}>Filtrar</button>
                  <button className={clsx('px-3', 'py-1', 'bg-[#1C1C1F]', 'text-gray-300', 'hover:text-white', 'border', 'border-[#27272A]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}>Exportar</button>
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
              <div className={clsx('flex', 'justify-between', 'items-center', 'gap-3')}>
                <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'px-3', 'py-1.5', 'text-[10px]', 'text-gray-300', 'font-bold', 'font-mono')}>
                  01/06/2026 - 01/07/2026
                </div>
                <div className={clsx('flex', 'gap-2')}>
                  <button className={clsx('p-1.5', 'bg-[#1C1C1F]', 'text-gray-300', 'hover:text-white', 'border', 'border-[#27272A]', 'rounded-xl', 'cursor-pointer')} title="Imprimir"><Printer size={12} /></button>
                  <button className={clsx('px-3', 'py-1', 'bg-[#10b981]', 'text-[#121214]', 'hover:bg-[#059669]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}>Exportar</button>
                </div>
              </div>

              {/* Grid of KPI cards */}
              <div className={clsx('grid', 'grid-cols-2', 'md:grid-cols-5', 'gap-4')}>
                {[
                  { label: "Faturamento", value: "R$ 51.140,06", color: "text-[#10b981]" },
                  { label: "Ticket médio", value: "R$ 39,25", color: "text-white" },
                  { label: "Total de pedidos", value: "1303", color: "text-white" },
                  { label: "Taxa de serviço", value: "R$ 0,00", color: "text-white" },
                  { label: "Garçons ativos", value: "2", color: "text-white" }
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
                      {(waitersPerformance.length > 0
                        ? waitersPerformance
                        : [
                          { nome_garcon: "Mateus", pedidos_atendidos: 42, comissao_acumulada: 182.30 },
                          { nome_garcon: "Sarah", pedidos_atendidos: 39, comissao_acumulada: 165.90 }
                        ]
                      ).map((waiter, idx) => (
                        <tr key={idx} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                          <td className={clsx('p-3.5', 'font-bold', 'text-white')}>{waiter.nome_garcon}</td>
                          <td className={clsx('p-3.5', 'font-mono', 'text-gray-300')}>{waiter.pedidos_atendidos}</td>
                          <td className={clsx('p-3.5', 'font-mono', 'text-emerald-400', 'font-bold', 'text-right')}>R$ {waiter.comissao_acumulada.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
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
                  <div className={clsx('flex', 'justify-between', 'text-[10px]')}>
                    <span className="text-gray-400">Progresso da Meta (R$ 3.000,00)</span>
                    <strong className={clsx('text-white', 'font-mono')}>65.2% (R$ 1.956,20)</strong>
                  </div>
                  <div className={clsx('h-3', 'w-full', 'bg-[#1C1C1F]', 'rounded-full', 'overflow-hidden', 'border', 'border-[#27272A]/40')}>
                    <div className={clsx('h-full', 'bg-gradient-to-r', 'from-[#10b981]', 'to-[#10b981]', 'rounded-full')} style={{ width: '65.2%' }} />
                  </div>
                  <span className={clsx('text-[8px]', 'text-gray-500', 'block', 'leading-tight')}>Faltam R$ 1.043,80 para atingir a meta diária estipulada pelo gestor.</span>
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
                {[
                  { rank: "1º", name: "Pastel de Carne", count: 142, price: 12.00 },
                  { rank: "2º", name: "Hambúrguer Kôma", count: 98, price: 22.00 },
                  { rank: "3º", name: "Pastel Especial", count: 85, price: 18.00 },
                  { rank: "4º", name: "Coca-Cola Lata", count: 74, price: 6.00 },
                  { rank: "5º", name: "Cerveja Heineken", count: 60, price: 8.50 }
                ].map((item, idx) => (
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
                      const json = JSON.stringify(apiProdutos, null, 2);
                      const blob = new Blob([json], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = 'cardapio_koma.json'; a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className={clsx('flex', 'items-center', 'gap-1.5', 'px-3', 'py-1.5', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'hover:border-[#10b981]/40', 'text-gray-300', 'hover:text-[#10b981]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    Exportar JSON
                  </button>
                  <label className={clsx('flex', 'items-center', 'gap-1.5', 'px-3', 'py-1.5', 'bg-[#10b981]/10', 'border', 'border-[#10b981]/20', 'hover:bg-[#10b981]/20', 'text-[#10b981]', 'rounded-xl', 'text-[9px]', 'font-bold', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer')}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    Importar JSON
                    <input type="file" accept=".json" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file) return;
                      const text = await file.text();
                      try {
                        const data = JSON.parse(text);
                        alert(`Importação simulada: ${Array.isArray(data) ? data.length : 0} itens lidos. Integração com backend em breve.`);
                      } catch { alert('Arquivo JSON inválido.'); }
                    }} />
                  </label>
                </div>
              </div>

              {/* Grouped by categoria */}
              {(() => {
                const byCat: Record<string, typeof apiProdutos> = {};
                apiProdutos.forEach(p => {
                  const cat = (p as any).categoria?.nome || 'Outros';
                  if (!byCat[cat]) byCat[cat] = [];
                  byCat[cat].push(p);
                });
                return Object.entries(byCat).map(([cat, prods]) => (
                  <div key={cat} className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-2xl', 'overflow-hidden')}>
                    <div className={clsx('bg-[#18181B]', 'px-4', 'py-2.5', 'border-b', 'border-[#27272A]')}>
                      <span className={clsx('font-bold', 'text-[#10b981]', 'text-[10px]', 'uppercase', 'tracking-wider')}>{cat}</span>
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
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
              {apiProdutos.length === 0 && (
                <div className={clsx('py-20', 'text-center', 'text-gray-500', 'italic', 'text-xs')}>Nenhum produto encontrado. Cadastre em "Listagem de Produtos".</div>
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

                {/* Categories */}
                {Object.entries(byCat).map(([cat, prods]) => (
                  <div key={cat} className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-2xl', 'overflow-hidden')}>
                    <div className={clsx('bg-[#18181B]', 'px-4', 'py-2.5', 'border-b', 'border-[#27272A]', 'flex', 'justify-between', 'items-center', 'gap-3')}>
                      <div className="flex items-baseline gap-2">
                        <span className={clsx('font-bold', 'text-[#10b981]', 'text-[10px]', 'uppercase', 'tracking-wider')}>{cat}</span>
                        <span className={clsx('text-[8px]', 'text-gray-500')}>{prods.length} item{prods.length !== 1 ? 's' : ''}</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            if (confirm(`Deseja realmente esgotar todos os itens da categoria "${cat}"?`)) {
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
                          className="px-2 py-0.5 border border-red-900/40 hover:border-red-600/30 bg-red-950/20 hover:bg-red-900/25 text-red-400 hover:text-white text-[8px] font-bold rounded transition-all cursor-pointer uppercase tracking-wide"
                        >
                          Esgotar Todos
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (confirm(`Deseja realmente disponibilizar todos os itens da categoria "${cat}"?`)) {
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
                          className="px-2 py-0.5 border border-emerald-900/40 hover:border-emerald-600/30 bg-emerald-950/20 hover:bg-emerald-900/25 text-emerald-400 hover:text-white text-[8px] font-bold rounded transition-all cursor-pointer uppercase tracking-wide"
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
                                  const res = await fetch(`${apiBaseUrl}/produtos/${prod.id}`, {
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
                ))}
                {filtered.length === 0 && (
                  <div className={clsx('py-16', 'text-center', 'text-gray-500', 'italic', 'text-xs')}>Nenhum produto encontrado para "{disponibilidadeSearch}".</div>
                )}
              </div>
            );
          })()}




          {/* MOCK VIEW: ENTRADA DE XML NFE */}
          {activeTab === 'estoque' && activeSubTab === 'xml' && (
            <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5', 'text-left', 'animate-fade-in')}>
              <div className={clsx('lg:col-span-1', 'bg-[#121214]', 'border', 'border-[#27272A]', 'p-5', 'rounded-3xl', 'space-y-4', 'h-fit')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Importar XML de NFe</span>
                <div className={clsx('border-2', 'border-dashed', 'border-[#27272A]', 'rounded-2xl', 'py-8', 'px-4', 'text-center', 'cursor-pointer', 'hover:border-[#10b981]/30', 'transition-all', 'flex', 'flex-col', 'items-center', 'justify-center', 'space-y-2')}>
                  <span className={clsx('text-[10px]', 'text-gray-400')}>Arraste seu arquivo .xml aqui</span>
                  <span className={clsx('text-[8px]', 'text-gray-500')}>ou clique para selecionar do computador</span>
                </div>
                <p className={clsx('text-[8px]', 'text-gray-500', 'leading-normal')}>O sistema cadastrará insumos e reajustará o estoque automaticamente ao processar.</p>
              </div>

              <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4')}>
                <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'pb-1', 'border-b', 'border-[#27272A]')}>Entradas de NF-e Recentes</span>
                <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                  <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                    <thead>
                      <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                        <th className="p-3">Nota</th>
                        <th className="p-3">Fornecedor</th>
                        <th className={clsx('p-3', 'font-mono')}>Valor NFe</th>
                        <th className={clsx('p-3', 'text-right')}>Data Importação</th>
                      </tr>
                    </thead>
                    <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                      {[
                        { nota: "NF-001923", for: "Distribuidora Carnes Ltda", valor: 1450.00, data: "28/06/2026" },
                        { nota: "NF-001855", for: "Hortifruti Central", valor: 380.50, data: "25/06/2026" }
                      ].map((n, idx) => (
                        <tr key={idx} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                          <td className={clsx('p-3', 'font-mono', 'font-bold', 'text-white')}>{n.nota}</td>
                          <td className={clsx('p-3', 'text-gray-300')}>{n.for}</td>
                          <td className={clsx('p-3', 'font-mono', 'text-emerald-400')}>R$ {n.valor.toFixed(2)}</td>
                          <td className={clsx('p-3', 'text-gray-400', 'text-right')}>{n.data}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* MOCK VIEW: FORNECEDORES */}
          {activeTab === 'estoque' && activeSubTab === 'fornecedores' && (
            <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'text-left', 'animate-fade-in', 'max-w-2xl')}>
              <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'border-b', 'border-[#27272A]', 'pb-2')}>Fornecedores Cadastrados</span>
              <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                  <thead>
                    <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                      <th className="p-3.5">Nome Fantasia</th>
                      <th className="p-3.5">Telefone</th>
                      <th className="p-3.5">CNPJ</th>
                      <th className={clsx('p-3.5', 'text-right')}>Insumos Principais</th>
                    </tr>
                  </thead>
                  <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                    {[
                      { nome: "Distribuidora Carnes Ltda", tel: "(11) 98765-4321", cnpj: "12.345.678/0001-99", ins: "Carne Bovina, Frango" },
                      { nome: "Hortifruti Central", tel: "(11) 98888-7777", cnpj: "98.765.432/0001-88", ins: "Hortaliças, Tomate" }
                    ].map((f, idx) => (
                      <tr key={idx} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                        <td className={clsx('p-3.5', 'font-bold', 'text-white')}>{f.nome}</td>
                        <td className={clsx('p-3.5', 'font-mono', 'text-gray-300')}>{f.tel}</td>
                        <td className={clsx('p-3.5', 'font-mono', 'text-gray-400')}>{f.cnpj}</td>
                        <td className={clsx('p-3.5', 'text-gray-400', 'text-right', 'italic')}>{f.ins}</td>
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

          {/* MOCK VIEW: CRM CLIENTES */}
          {activeTab === 'clientes' && activeSubTab === 'crm' && (
            <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'text-left', 'animate-fade-in', 'max-w-3xl')}>
              <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'border-b', 'border-[#27272A]', 'pb-2')}>CRM — Cadastro de Clientes</span>
              <div className={clsx('overflow-hidden', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
                <table className={clsx('w-full', 'text-left', 'text-[10px]')}>
                  <thead>
                    <tr className={clsx('bg-[#1C1C1F]', 'border-b', 'border-[#27272A]', 'text-gray-400', 'uppercase', 'tracking-wider', 'font-bold')}>
                      <th className="p-3.5">Nome</th>
                      <th className="p-3.5">WhatsApp</th>
                      <th className={clsx('p-3.5', 'font-mono')}>Pedidos</th>
                      <th className={clsx('p-3.5', 'font-mono')}>Ticket Médio</th>
                      <th className={clsx('p-3.5', 'text-right')}>Frequência</th>
                    </tr>
                  </thead>
                  <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
                    {[
                      { nome: "João Silva", wpp: "(11) 99999-1111", ped: 12, ticket: 45.50, freq: "Semanal" },
                      { nome: "Maria Souza", wpp: "(11) 98888-2222", ped: 8, ticket: 32.10, freq: "Quinzenal" }
                    ].map((c, idx) => (
                      <tr key={idx} className={clsx('hover:bg-[#1C1C1F]/20', 'transition-colors')}>
                        <td className={clsx('p-3.5', 'font-bold', 'text-white')}>{c.nome}</td>
                        <td className={clsx('p-3.5', 'font-mono', 'text-gray-300')}>{c.wpp}</td>
                        <td className={clsx('p-3.5', 'font-mono', 'text-gray-300')}>{c.ped}</td>
                        <td className={clsx('p-3.5', 'font-mono', 'text-emerald-400')}>R$ {c.ticket.toFixed(2)}</td>
                        <td className={clsx('p-3.5', 'text-gray-400', 'text-right', 'font-bold', 'text-[8px]', 'uppercase', 'tracking-wider')}>{c.freq}</td>
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
                                  className={clsx('py-1.5', 'px-3', 'bg-emerald-600', 'hover:bg-[#9d2b3c]', 'disabled:opacity-50', 'text-white', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                                >
                                  Despachar
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
                    onChange={(e) => setNovoMotoboyNome(e.target.value)}
                    className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
                  />
                  <input
                    type="text"
                    required
                    placeholder="Telefone (ex: 81 99999-8888)"
                    value={novoMotoboyTelefone}
                    onChange={(e) => setNovoMotoboyTelefone(e.target.value)}
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

        </div>
      </main >

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
                              const t = sub * (1.0 + (checkoutServiceTax ? serviceTaxRate / 100 : 0));
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
                        {checkoutServiceTax && (
                          <div className={clsx('flex', 'justify-between')}>
                            <span className={clsx('font-sans', 'text-gray-400')}>Taxa Serviço ({serviceTaxRate}%):</span>
                            <span className="text-gray-300">R$ {taxa.toFixed(2)}</span>
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
                      <div className={clsx('flex', 'gap-2', 'p-1', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'shrink-0')}>
                        <button
                          type="button"
                          onClick={() => setPaymentMetodo('dinheiro')}
                          className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'dinheiro' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                            }`}
                        >
                          Dinheiro
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMetodo('pix')}
                          className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'pix' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                            }`}
                        >
                          Pix
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentMetodo('cartao')}
                          className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${paymentMetodo === 'cartao' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                            }`}
                        >
                          Cartão
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 font-sans">
                      <label className={clsx('text-[10px]', 'font-bold', 'text-gray-400', 'uppercase', 'tracking-wider', 'block')}>Valor a Lançar (R$):</label>
                      <div className="relative">
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

                    {/* CÉDULAS BRASILEIRAS E TOTAL RESTANTE ATALHOS */}
                    {paymentMetodo === 'dinheiro' && (
                      <div className="space-y-1">
                        <label className="text-[8px] font-bold text-gray-500 uppercase tracking-wider block">Atalhos de Cédulas:</label>
                        <div className="flex flex-wrap gap-1">
                          {[2, 5, 10, 20, 50, 100, 200].map((val) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setPaymentValor(val.toFixed(2))}
                              className="px-2 py-0.5 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] rounded text-[8px] font-bold text-gray-300 font-mono transition-all cursor-pointer"
                            >
                              R$ {val}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              const { total } = getCheckoutTotals(selectedOrder);
                              const restante = Math.max(0, total - (selectedOrder.valorPago || 0));
                              setPaymentValor(restante.toFixed(2));
                            }}
                            className="px-2 py-0.5 bg-[#10b981]/15 hover:bg-[#10b981]/25 border border-[#10b981]/30 rounded text-[8px] font-bold text-[#10b981] transition-all cursor-pointer"
                          >
                            Total Restante
                          </button>
                        </div>
                      </div>
                    )}

                    {/* TROCO EM TEMPO REAL */}
                    {(() => {
                      const { total } = getCheckoutTotals(selectedOrder);
                      const restante = Math.max(0, total - (selectedOrder.valorPago || 0));
                      const inputVal = parseFloat(paymentValor) || 0;
                      if (paymentMetodo === 'dinheiro' && inputVal > restante) {
                        const troco = inputVal - restante;
                        return (
                          <div className="bg-emerald-950/40 border border-emerald-800/30 text-emerald-300 p-2.5 rounded-xl text-[10px] font-mono flex justify-between items-center animate-pulse-subtle">
                            <span>Troco a devolver:</span>
                            <strong className="text-xs">R$ {troco.toFixed(2)}</strong>
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
                      const res = await fetch(`${apiBaseUrl}/comandas/lancamentos/${selectedKanbanOrder.id}/reimprimir`, {
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

    </div>
  );
}