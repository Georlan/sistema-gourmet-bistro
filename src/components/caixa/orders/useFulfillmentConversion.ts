import { useEffect, useRef, useState } from 'react';
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
  const [availability, setAvailability] = useState<{ scope: string; allowed: boolean } | null>(null);
  const requestGeneration = useRef(0);
  const headersKey = JSON.stringify(authHeaders);
  const scope = JSON.stringify([selectedOrderId, selectedOrderRevision, apiBaseUrl, headersKey]);
  const getOptions = async (id: string) => {
    const response = await fetch(`${apiBaseUrl}/comandas/${encodeURIComponent(id)}/modalidade/opcoes`, { headers: authHeaders });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Não foi possível consultar o pedido.');
    return data;
  };
  useEffect(() => {
    let active = true;
    if (!selectedOrderId) setAvailability(null);
    if (selectedOrderId) void getOptions(selectedOrderId).then(data => {
      if (active) setAvailability({ scope, allowed: data.options.length > 0 });
    }).catch(() => { if (active) setAvailability({ scope, allowed: false }); });
    return () => { active = false; };
  }, [scope]);
  useEffect(() => () => { requestGeneration.current += 1; }, []);

  const request = async (order: { id: string | number; numeroPedido?: number | null; tableId?: number }) => {
    const orderId = String(order.id);
    const orderLabel = order.numeroPedido ? `Pedido #${order.numeroPedido}` : `Pedido ${order.id}`;
    const generation = ++requestGeneration.current;
    setTarget({ orderId, orderLabel, options: [], loading: true });
    try {
      const data = await getOptions(orderId);
      if (generation !== requestGeneration.current) return;
      setTarget({ orderId, orderLabel,
        options: data.options, address: data.address_snapshot, blockedReason: data.blocked_reason });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setTarget({ orderId, orderLabel, options: [], blockedReason: error instanceof Error ? error.message : 'Não foi possível consultar o pedido.' });
    }
  };
  const close = () => { if (!isSubmitting) { requestGeneration.current += 1; setTarget(null); } };
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
  return { target, isSubmitting, request, close, submit, preview,
    canChange: !!selectedOrderId && availability?.scope === scope && availability.allowed,
    checking: !!selectedOrderId && availability?.scope !== scope };
}
