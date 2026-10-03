import { useEffect, useState } from 'react';
import type { FulfillmentConversionTarget, ConversionQuote } from './FulfillmentConversionDialog';

type Params = {
  convertToPickup: (orderId: string, reason: string, payload?: Record<string, unknown>) => Promise<boolean>;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  selectedOrderId?: string;
  selectedOrderRevision?: string;
};

export function useFulfillmentConversion({ convertToPickup, apiBaseUrl, authHeaders, selectedOrderId, selectedOrderRevision }: Params) {
  const [target, setTarget] = useState<FulfillmentConversionTarget | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allowedOrderId, setAllowedOrderId] = useState<string | null>(null);
  const headersKey = JSON.stringify(authHeaders);
  const getOptions = async (id: string) => {
    const response = await fetch(`${apiBaseUrl}/comandas/${encodeURIComponent(id)}/modalidade/opcoes`, { headers: authHeaders });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Não foi possível consultar o pedido.');
    return data;
  };
  useEffect(() => {
    let active = true;
    setAllowedOrderId(null);
    if (selectedOrderId) void getOptions(selectedOrderId).then(data => {
      if (active && data.options.length) setAllowedOrderId(selectedOrderId);
    }).catch(() => {});
    return () => { active = false; };
  }, [selectedOrderId, selectedOrderRevision, apiBaseUrl, headersKey]);

  const request = async (order: { id: string | number; numeroPedido?: number | null }) => {
    const orderId = String(order.id);
    try {
      const data = await getOptions(orderId);
      setTarget({ orderId, orderLabel: order.numeroPedido ? `Pedido #${order.numeroPedido}` : `Pedido ${order.id}`,
        options: data.options, address: data.address_snapshot, blockedReason: data.blocked_reason });
    } catch (error) {
      setTarget({ orderId, orderLabel: `Pedido ${order.id}`, options: [], blockedReason: String(error) });
    }
  };
  const close = () => { if (!isSubmitting) setTarget(null); };
  const preview = async (payload: Record<string, unknown>): Promise<ConversionQuote> => {
    if (!target) throw new Error('Pedido indisponível.');
    const response = await fetch(`${apiBaseUrl}/comandas/${encodeURIComponent(target.orderId)}/modalidade/previa`, {
      method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Não foi possível calcular a alteração.');
    return data;
  };
  const submit = async (reason: string, payload: Record<string, unknown>): Promise<boolean> => {
    if (!target || isSubmitting) return false;
    setIsSubmitting(true);
    try {
      const success = await convertToPickup(target.orderId, reason, payload);
      if (success) setTarget(null);
      return success;
    } finally { setIsSubmitting(false); }
  };
  return { target, isSubmitting, request, close, submit, preview, canChange: !!selectedOrderId && allowedOrderId === selectedOrderId };
}
