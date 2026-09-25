import { useState } from 'react';

import type { FulfillmentConversionTarget } from './FulfillmentConversionDialog';

type RequestOrder = {
  id: string | number;
  numeroPedido?: number | null;
};

type Params = {
  convertToPickup: (orderId: string, reason: string) => Promise<boolean>;
};

/** Owns the exceptional delivery -> pickup conversion UI state. */
export function useFulfillmentConversion({ convertToPickup }: Params) {
  const [target, setTarget] = useState<FulfillmentConversionTarget | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const request = (order: RequestOrder) => {
    setTarget({
      orderId: String(order.id),
      orderLabel: order.numeroPedido ? `Pedido #${order.numeroPedido}` : `Pedido ${order.id}`,
    });
  };

  const close = () => {
    if (!isSubmitting) setTarget(null);
  };

  const submit = async (reason: string) => {
    if (!target || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const success = await convertToPickup(target.orderId, reason);
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
