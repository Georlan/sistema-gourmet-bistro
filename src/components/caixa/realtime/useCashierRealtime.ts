import { useEffect } from 'react';
import type { CaixaPanelProps } from '../cashierContracts';

type Props = Pick<CaixaPanelProps, 'isWsConnected' | 'onRefreshOrders'> & {
  activeTab: string;
  fetchTurno: () => Promise<void>;
  fetchDeliveryOrders: () => Promise<void>;
  fetchMotoboys: () => Promise<void>;
  fetchConfiguracoes: () => Promise<void>;
};

/** Owns realtime state, effects and actions; composition supplies only cross-feature dependencies. */
export function useCashierRealtime({
  isWsConnected,
  onRefreshOrders,
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

  // Contingência apenas quando o WebSocket estiver indisponível. Com a conexão
  // saudável, os eventos são a fonte de verdade e não há polling concorrente.
  useEffect(() => {
    if (isWsConnected || activeTab !== 'operacao') return;
    const refreshIfVisible = () => {
      if (!document.hidden) {
        fetchTurno();
        fetchDeliveryOrders();
        onRefreshOrders();
      }
    };
    const interval = setInterval(refreshIfVisible, 12000);
    return () => clearInterval(interval);
  }, [isWsConnected, activeTab, onRefreshOrders]);

  return {};
}
