import type { CourierPaymentData } from './CourierPayment';

export interface CourierOrder {
  id: string;
  numero_pedido: number | null;
  requires_delivery_code?: boolean;
  cliente_nome: string;
  delivery_endereco: string | null;
  delivery_taxa: number;
  delivery_status: string;
  total: number;
  valor_pago: number;
  valor_a_cobrar: number;
  itens_resumo: string;
  criado_em: string | null;
  source?: { channel: string; label: string; references: {provider: string; reference: string}[] };
  destination?: { label: string | null; complement: string | null; reference: string | null; route_query: string | null; latitude?: number | null; longitude?: number | null };
  payment?: CourierPaymentData;
  items?: { name: string; quantity: number; notes: string | null; modifiers: string[] }[];
  confirmation?: { mode: 'koma_code' | 'local' | 'partner_pending' | 'local_internal'; enabled: boolean; code_length: number | null; reason: string | null };
}


/** Existing deliveries keep their issued length; new KÔMA receipts use three digits. */
export const courierCodeLength = (order: CourierOrder) => order.confirmation?.code_length === 4 ? 4 : 3;
