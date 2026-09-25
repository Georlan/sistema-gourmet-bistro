import { useState } from 'react';

import type { CashierNotice } from '../cashierContracts';
import type { DeliveryOrderView } from './cashierWorkspaceTypes';
import type { CourierReassignmentTarget } from './CourierReassignmentDialog';

type CourierOption = {
  id: string | number;
  nome: string;
  ativo?: boolean;
};

type Params = {
  motoboys: readonly CourierOption[];
  showToast: CashierNotice;
  reassignCourier: (orderId: string, courierId: string, reason: string) => Promise<boolean>;
};

/** Owns the exceptional in-route courier reassignment UI state outside CaixaPanel. */
export function useCourierReassignment({
  motoboys,
  showToast,
  reassignCourier,
}: Params) {
  const [target, setTarget] = useState<CourierReassignmentTarget | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const request = (order: DeliveryOrderView) => {
    const currentCourierId = order.motoboyId ? Number(order.motoboyId) : null;
    if (!currentCourierId) {
      showToast('Não foi possível identificar o entregador atual desta corrida.', 'error');
      return;
    }

    const currentCourier = motoboys.find(
      (courier) => Number(courier.id) === currentCourierId,
    );
    setTarget({
      orderId: String(order.id),
      orderLabel: order.numeroPedido ? `Pedido #${order.numeroPedido}` : `Pedido ${order.id}`,
      currentCourierId,
      currentCourierName: currentCourier?.nome || `Entregador #${currentCourierId}`,
    });
  };

  const close = () => {
    if (!isSubmitting) setTarget(null);
  };

  const submit = async (courierId: string, reason: string) => {
    if (!target || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const success = await reassignCourier(target.orderId, courierId, reason);
      if (success) setTarget(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    target,
    isSubmitting,
    request,
    close,
    submit,
  };
}
