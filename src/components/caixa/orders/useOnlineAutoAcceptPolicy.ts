import { useCallback, useEffect, useState } from 'react';

interface UseOnlineAutoAcceptPolicyOptions {
  readonly apiBaseUrl: string;
  readonly authHeaders: Record<string, string>;
  readonly showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function useOnlineAutoAcceptPolicy({
  apiBaseUrl,
  authHeaders,
  showToast,
}: UseOnlineAutoAcceptPolicyOptions) {
  const [automatic, setAutomatic] = useState(false);

  useEffect(() => {
    let active = true;
    const loadPolicy = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/online-orders/control`, {
          headers: authHeaders,
          cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (active) setAutomatic(payload?.auto_accept === true);
      } catch {
        // Fail-closed: se a política não puder ser lida, não simulamos autoaceite.
      }
    };
    void loadPolicy();
    return () => {
      active = false;
    };
  }, [apiBaseUrl, authHeaders.Authorization]);

  const onAutomaticChange = useCallback(async (enabled: boolean) => {
    const previous = automatic;
    setAutomatic(enabled);
    try {
      const response = await fetch(`${apiBaseUrl}/api/online-orders/auto-accept`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error('auto-accept update failed');
      const payload = await response.json();
      const persisted = payload?.auto_accept === true;
      setAutomatic(persisted);
      showToast(
        persisted
          ? 'Aceite automático ativado para todos os pedidos online.'
          : 'Aceite automático desativado.',
        'success',
      );
    } catch {
      setAutomatic(previous);
      showToast('Não foi possível alterar o aceite automático.', 'error');
    }
  }, [apiBaseUrl, authHeaders, automatic, showToast]);

  return { automatic, onAutomaticChange };
}
