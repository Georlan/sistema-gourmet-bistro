import { useEffect } from 'react';
import type { CaixaPanelProps } from '../cashierContracts';

type Props = Pick<CaixaPanelProps, 'isWsConnected'> & {
  activeTab: string;
  fetchTurno: () => Promise<void>;
  fetchDeliveryOrders: () => Promise<void>;
  fetchMotoboys: () => Promise<void>;
  fetchConfiguracoes: () => Promise<void>;
};

/** Owns realtime state, effects and actions; composition supplies only cross-feature dependencies. */
export function useCashierRealtime({
  isWsConnected,
  activeTab,
  fetchTurno,
  fetchDeliveryOrders,
  fetchMotoboys,
  fetchConfiguracoes,
}: Props) {
  useEffect(() => {
    fetchTurno();
    fetchDeliveryOrders();
    fetchMotoboys();
    fetchConfiguracoes();
  }, []);

  // Browsers can suspend timers and socket delivery while the cashier tab is in
  // the background without immediately marking the WebSocket as disconnected.
  // Reconcile once when the operator comes back instead of waiting for another
  // socket invalidation or introducing a second polling loop.
  useEffect(() => {
    if (activeTab !== 'operacao') return;

    let lastResumeRefreshAt = 0;
    const reconcileOnResume = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastResumeRefreshAt < 750) return;
      lastResumeRefreshAt = now;
      void Promise.allSettled([fetchTurno(), fetchDeliveryOrders()]);
    };

    window.addEventListener('focus', reconcileOnResume);
    document.addEventListener('visibilitychange', reconcileOnResume);
    return () => {
      window.removeEventListener('focus', reconcileOnResume);
      document.removeEventListener('visibilitychange', reconcileOnResume);
    };
  }, [activeTab]);

  // Orders/tables fallback belongs to App; this timer refreshes only cashier resources.
  // Contingência apenas quando o WebSocket estiver indisponível. Com a conexão
  // saudável, os eventos são a fonte de verdade e não há polling concorrente.
  useEffect(() => {
    if (isWsConnected || activeTab !== 'operacao') return;
    const refreshIfVisible = () => {
      if (!document.hidden) {
        fetchTurno();
        fetchDeliveryOrders();
      }
    };
    const interval = setInterval(refreshIfVisible, 12000);
    return () => clearInterval(interval);
  }, [isWsConnected, activeTab]);

  return {};
}
