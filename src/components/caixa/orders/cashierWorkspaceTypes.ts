import type { Order } from '../../../types';
import type { CashierTableSlice, getCashierTableOrderPresentation } from '../../../domain/cashierOrderProjection';

export interface DeliveryOrderView {
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

export interface SmartPosCardState {
  label: string;
  chipClass: 'is-muted' | 'is-primary' | 'is-attention';
  blocksPayment: boolean;
  ctaLabel?: string;
  intentId?: string;
  canReconcile?: boolean;
}

/** UI context joined by the owner; no API, credentials or checkout policy cross this boundary. */
export interface CashierTableCard {
  readonly order: Readonly<CashierTableSlice>;
  readonly presentation: Readonly<ReturnType<typeof getCashierTableOrderPresentation>>;
  readonly tableMovement: {
    readonly mergedMesaIds: readonly number[];
    readonly transferredFromMesaIds: readonly number[];
  };
  readonly smartPosState: Readonly<SmartPosCardState> | null;
}

export interface PendingCashPayment {
  readonly id: string;
  readonly comanda_id: string;
  readonly valor: number;
  readonly nome_cliente?: string;
}

export interface PendingCashPaymentCard extends PendingCashPayment {
  readonly mesaNum: Order['mesaId'] | '?';
}

export type OrdersStage = 'salon' | 'digital' | 'closing';

