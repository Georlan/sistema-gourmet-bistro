import { useEffect, useState } from 'react';
import type { CashierNotice } from '../cashierContracts';
import {
  fetchOnlineOrdersControl,
  invalidateOnlineOrdersControlCache,
} from '../online-menu/onlineOrdersControlClient';

interface UseOnlineOrderAutoAcceptPolicyArgs {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  showToast: CashierNotice;
}

export function useOnlineOrderAutoAcceptPolicy({
  apiBaseUrl,
  authHeaders,
  showToast,
}: UseOnlineOrderAutoAcceptPolicyArgs) {
  const [autoAccept, setAutoAccept] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const result = await fetchOnlineOrdersControl(
          apiBaseUrl,
          authHeaders.Authorization || '',
        );
        if (!result.ok || !result.payload) return;
        if (!cancelled) setAutoAccept(Boolean(result.payload.auto_accept));
      } catch {
        // Leitura best-effort: não altera estado operacional do servidor.
      }
    };

    void load();
    const handleControlUpdated = () => {
      invalidateOnlineOrdersControlCache();
      void load();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('koma_online_order_control_updated', handleControlUpdated);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('koma_online_order_control_updated', handleControlUpdated);
      }
    };
  }, [apiBaseUrl, authHeaders.Authorization]);

  const updateAutoAccept = async (enabled: boolean) => {
    const previous = autoAccept;
    setAutoAccept(enabled);
    invalidateOnlineOrdersControlCache();
    try {
      const response = await fetch(`${apiBaseUrl}/api/online-orders/auto-accept`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof payload?.detail === 'string'
            ? payload.detail
            : 'Não foi possível atualizar o autoaceite.',
        );
      }
      setAutoAccept(Boolean(payload?.auto_accept));
      showToast(
        enabled
          ? 'Autoaceite ativado no restaurante.'
          : 'Autoaceite desativado no restaurante.',
        'success',
      );
    } catch (error) {
      setAutoAccept(previous);
      showToast(
        error instanceof Error
          ? error.message
          : 'Não foi possível atualizar o autoaceite.',
        'error',
      );
    }
  };

  return {
    autoAccept,
    updateAutoAccept,
  };
}
