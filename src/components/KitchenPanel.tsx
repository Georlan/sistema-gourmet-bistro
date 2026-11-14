import { useMemo } from 'react';
import type { Order } from '../types';
import { CashierKitchen } from './caixa/kitchen/CashierKitchen';
import { isKdsKitchenOrderEligible, type KdsKitchenItem } from './caixa/kitchen/kdsProjection';

/** Adapter for staff with the cozinha role. The view, ticket identity and
 * preparation rules are shared with the cashier KDS; serving stays elsewhere. */
export function KitchenPanel({ orders, onFinishPreparation, onFinishPreparationBatch }: {
  orders: Order[];
  onFinishPreparation: (orderId: string, itemId: string) => Promise<boolean> | void;
  onFinishPreparationBatch?: (orderId: string, itemIds: string[]) => Promise<boolean>;
}) {
  const items = useMemo<KdsKitchenItem[]>(() => orders
    .filter(order => isKdsKitchenOrderEligible(order.deliveryStatus))
    .flatMap(order => order.itens
      .filter(item => item.status === 'preparando' || item.status === 'pronto')
      .map(item => ({
        ...item,
        orderId: order.id,
        mesaId: order.mesaId,
        garcomNome: item.responsavelNome || order.garcomNome,
        displayNumber: item.displayNumber ||
          (item.lancamentoId ? order.launchIdentities?.[item.lancamentoId]?.displayNumber : order.displayNumber),
        numeroPedido: order.numeroPedido,
        tipo: order.tipo,
        origemOperacional: item.origemOperacional || order.origemOperacional,
        identificador: order.identificador,
        deliveryStatus: order.deliveryStatus,
        timestamp: item.timestamp ?? order.timestamp,
      }))), [orders]);

  return <CashierKitchen
    mode="standalone"
    activeSubTab="standalone"
    activeKitchenItems={items}
    handleConfirmTicketReady={onFinishPreparationBatch ? async (itemIds) => {
      const first = items.find(entry => entry.id === itemIds[0]);
      if (!first || itemIds.some(id => !items.some(item => item.id === id && item.orderId === first.orderId))) return false;
      return onFinishPreparationBatch(first.orderId, itemIds);
    } : undefined}
    handleUpdateItemStatus={async (itemId) => {
      const item = items.find(entry => entry.id === itemId);
      if (!item) return false;
      const result = await onFinishPreparation(item.orderId, itemId);
      // Legacy readonly demo callbacks return void; the real App returns boolean.
      return result !== false;
    }}
  />;
}
