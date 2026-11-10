import { buildWhatsAppContactUrl } from '../config/whatsappUtils';

type ReceiptOrder = {
  restaurante_id: number;
  numero_pedido: string | number;
  fechado?: boolean;
  pagamento?: { confirmacao_manual?: boolean; status?: string } | null;
};

/** Opens the restaurant's own contact only; sending and attaching remain customer actions. */
export function manualPixReceiptUrl({ phone, restaurantId, order }: { phone?: string | null; restaurantId?: string | number | null; order: ReceiptOrder }): string {
  if (!order.pagamento?.confirmacao_manual || order.fechado || ['approved', 'paid', 'cancelled', 'canceled', 'expired', 'refunded'].includes(String(order.pagamento.status || '').toLowerCase()) || !restaurantId || String(order.restaurante_id) !== String(restaurantId)) return '';
  const contact = buildWhatsAppContactUrl(phone);
  const orderNumber = String(order.numero_pedido ?? '').trim();
  if (!contact || !orderNumber || orderNumber.length > 40) return '';
  const message = `Olá! Fiz o Pix do pedido #${orderNumber}. Vou enviar o comprovante para conferência.`;
  return `${contact}?text=${encodeURIComponent(message)}`;
}
