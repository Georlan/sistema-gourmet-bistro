import type { Order, Table, Product, CaixaTurnoResumo } from '../../types';
import type { CatalogCategory } from '../../catalog/catalog';

export interface CaixaPanelProps {
  onInitialDigitalSnapshotConsumed?: () => void;
  initialDigitalSnapshot?: import('../app/data/useCashierBootstrap').DigitalBootstrap;
  orders: Order[];
  onRefreshOrders: () => Promise<void>;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeWaiterNome: string;
  salonTables: Table[];
  onCreateMesa: (id: number, capacidade: number, nome?: string) => Promise<void>;
  onCreateMesas?: (first: number, last: number, capacity: number) => Promise<{ created_ids: number[]; preserved_count: number; total_after: number }>;
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
  produtos_favoritos?: { produto_id: string; nome: string; unidades: number }[];
  pedidos_concluidos?: number;
  valor_pago_total?: number;
  ticket_medio_pago?: number;
  primeira_compra_em?: string | null;
  intervalo_medio_dias?: number | null;
  ultima_compra_em?: string | null;
  dias_sem_comprar?: number | null;
  segmento_relacionamento?:
    | 'SEM_COMPRA'
    | 'ATIVO'
    | 'ATENCAO'
    | 'REATIVAR';
  telefone_valido_whatsapp?: boolean;
  opt_out_marketing?: boolean;
  motivo_opt_out?: string | null;
  canal_preferido?: string;
  observacoes_declaradas?: string | null;
  ultimo_contato_em?: string | null;
  ultimo_contato_status?: string | null;
  ultimo_contato_objetivo?: string | null;
  dias_desde_ultimo_contato?: number | null;
  total_contatos_crm?: number;
  contato_recente?: boolean;
  voltou_apos_ultimo_contato?: boolean;
  ultima_avaliacao_nota?: number | null;
  ultima_avaliacao_comentario?: string | null;
  ocorrencia_aberta?: boolean;
  beneficio_disponivel?: string;
  elegivel_resgate?: boolean;
  valor_resgatavel_brl?: number;
  status_beneficio?: 'RESGATAVEL' | 'SALDO_EM_FORMACAO' | 'SEM_SALDO' | 'PROGRAMA_INATIVO';
}

export type CashierNotice = (message: string, type?: 'success' | 'error' | 'info') => void;

export type CashierTab = 'operacao' | 'cardapio' | 'estoque' | 'financeiro' | 'clientes'
  | 'relatorios' | 'configuracoes' | 'permissoes_cargos' | 'impressao_salao'
  | 'assinatura_pix' | 'cardapio_digital' | 'dashboard';
