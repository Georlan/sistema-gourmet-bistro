import type { Order, Table, Product, CaixaTurnoResumo } from '../../types';
import type { CatalogCategory } from '../../catalog/catalog';

export interface CaixaPanelProps {
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
  onRefreshCategorias: () => Promise<void>;
  restauranteConfig?: any;
  fetchError?: string | null;
  onOptimisticUpdateItemStatus?: (itemId: string | string[], newStatus: 'preparando' | 'pronto' | 'entregue') => void;
  onOptimisticAddOrder?: (newOrder: any) => void;
  onRemovePendingPaymentOptimistic?: (pagamentoId: string) => void;
}

export interface LoyaltyCustomer {
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
  pedidos_concluidos?: number;
  valor_pago_total?: number;
  ticket_medio_pago?: number;
  ultima_compra_em?: string | null;
  dias_sem_comprar?: number | null;
  segmento_relacionamento?:
    | 'SEM_COMPRA'
    | 'ATIVO'
    | 'ATENCAO'
    | 'REATIVAR';
}

export type CashierNotice = (message: string, type?: 'success' | 'error' | 'info') => void;

export type CashierTab = 'operacao' | 'cardapio' | 'estoque' | 'financeiro' | 'clientes'
  | 'relatorios' | 'configuracoes' | 'permissoes_cargos' | 'impressao_salao'
  | 'assinatura_pix' | 'cardapio_digital' | 'dashboard';
