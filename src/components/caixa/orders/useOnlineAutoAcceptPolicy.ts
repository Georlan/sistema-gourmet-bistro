import { useCallback, useEffect, useState } from 'react';
import type { CashierNotice } from '../cashierContracts';

interface UseOnlineAutoAcceptPolicyOptions {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onRefreshOrders?: () => Promise<void>;
  showToast: CashierNotice;
}

interface OnlineOrderControlPayload {
  auto_accept?: boolean;
  detail?: string;
}

export function useOnlineAutoAcceptPolicy({
  apiBaseUrl,
  authHeaders,
  onRefreshOrders,
  showToast,
}: UseOnlineAutoAcceptPolicyOptions) {
  const [autoAccept, setAutoAccept] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/online-orders/control`, {
          headers: authHeaders,
          cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = await response.json() as OnlineOrderControlPayload;
        if (active) setAutoAccept(Boolean(payload.auto_accept));
      } catch {
        // Backend continua autoritativo. Uma falha de leitura não altera a
        // política persistida nem dispara aceite no navegador.
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [apiBaseUrl, authHeaders]);

  const updateAutoAccept = useCallback(async (enabled: boolean) => {
    const previous = autoAccept;
    setAutoAccept(enabled);

    try {
      const response = await fetch(`${apiBaseUrl}/api/online-orders/auto-accept`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json().catch(() => ({})) as OnlineOrderControlPayload;
      if (!response.ok) {
        throw new Error(payload.detail || 'Não foi possível atualizar o autoaceite.');
      }

      const persisted = Boolean(payload.auto_accept);
      setAutoAccept(persisted);
      showToast(
        persisted
          ? 'Autoaceite online ativado no restaurante.'
          : 'Autoaceite online desativado.',
        'success',
      );
      if (onRefreshOrders) await onRefreshOrders();
    } catch (error) {
      setAutoAccept(previous);
      showToast(
        error instanceof Error ? error.message : 'Não foi possível atualizar o autoaceite.',
        'error',
      );
    }
  }, [apiBaseUrl, authHeaders, autoAccept, onRefreshOrders, showToast]);

  return {
    autoAccept,
    updateAutoAccept,
  } as const;
}
