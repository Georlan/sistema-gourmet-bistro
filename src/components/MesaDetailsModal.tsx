import React from 'react';
import { MesaDetailsModal as MesaDetailsModalBase } from './MesaDetailsModalBase';
import { splitOrdersByLaunch } from '../domain/orderLots';
import { buildLaunchIdentityMap, getOrderCheckId, type LaunchIdentityMap, type TableFamilySnapshot } from '../domain/orderIdentity';
import { deriveTableOperationalState } from '../domain/operationalState';
import { API_BASE_URL } from '../config/api';

/**
 * Adaptador operacional da tela de mesa.
 *
 * A Comanda continua sendo a conta agregada usada pelas rotas legadas, mas a
 * operação humana enxerga cada confirmação como Pedido #46-A, #46-B... O ID
 * técnico l-xxxx nunca é perdido: ele continua sendo usado para impressão e
 * para ações que precisam alcançar o lançamento real.
 */
type MesaDetailsModalProps = Omit<React.ComponentProps<typeof MesaDetailsModalBase>, 'tableOperationalState'>;

const currentAuthToken = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  const management = params.get('view') === 'caixa'
    || params.get('view') === 'gerencia'
    || hash === '#caixa'
    || hash === '#gerencia';
  return localStorage.getItem(management ? 'koma_caixa_token' : 'koma_waiter_token')
    || localStorage.getItem('koma_caixa_token')
    || localStorage.getItem('koma_waiter_token');
};

export const MesaDetailsModal: React.FC<MesaDetailsModalProps> = (props) => {
  const {
    orders,
    table,
    onDeliverItem,
    onUnmergeTable,
    onPrintKitchenLaunch,
    onTransferItems,
  } = props;
  const [launchIdentities, setLaunchIdentities] = React.useState<LaunchIdentityMap>({});
  // A check with no launch still occupies the table. Compute table facts from
  // the original checks, before the consumption view splits them into launches.
  const tableOperationalState = React.useMemo(() => deriveTableOperationalState({
    table,
    orders,
    now: props.currentTime,
  }), [table, orders, props.currentTime]);

  React.useEffect(() => {
    let cancelled = false;
    const token = currentAuthToken();
    if (!token || !table?.id || orders.length === 0) {
      setLaunchIdentities({});
      return () => { cancelled = true; };
    }

    const loadFamilies = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/atendimentos/mesas/${table.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const data = await response.json() as TableFamilySnapshot;
        if (!cancelled) setLaunchIdentities(buildLaunchIdentityMap(data));
      } catch (error) {
        console.error('Falha ao carregar identidade dos pedidos da mesa:', error);
      }
    };

    void loadFamilies();
    return () => { cancelled = true; };
  }, [orders, table?.id]);

  const launchToComanda = React.useMemo(() => {
    const mapping = new Map<string, string>();
    orders.forEach((order) => {
      order.itens.forEach((item) => {
        if (item.lancamentoId) mapping.set(item.lancamentoId, getOrderCheckId(order));
      });
    });
    return mapping;
  }, [orders]);

  const lotOrders = React.useMemo(
    () => splitOrdersByLaunch(orders, launchIdentities),
    [orders, launchIdentities],
  );

  const resolveComandaId = React.useCallback(
    (technicalOrderId: string) => launchToComanda.get(technicalOrderId) || technicalOrderId,
    [launchToComanda],
  );

  const handleDeliverItem = onDeliverItem
    ? (technicalOrderId: string, itemId: string) => onDeliverItem(resolveComandaId(technicalOrderId), itemId)
    : undefined;

  const handleUnmergeTable = onUnmergeTable
    ? (technicalOrderId: string) => onUnmergeTable(resolveComandaId(technicalOrderId))
    : undefined;

  const handlePrintLaunch = onPrintKitchenLaunch
    ? async (launchId: string) => {
        if (!launchToComanda.has(launchId)) {
          throw new Error('Este pedido não possui identificador de lançamento para impressão.');
        }
        const token = currentAuthToken();
        if (!token) throw new Error('Sessão expirada. Entre novamente para imprimir.');
        const response = await fetch(
          `${API_BASE_URL}/comandas/lancamentos/${launchId}/reimprimir?mesa_id=${table.id}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.detail || 'Não foi possível reimprimir este pedido.');
        }
      }
    : undefined;

  const handleTransferItems = onTransferItems
    ? async (itemIds: string[], targetTableId: number) => {
        const token = currentAuthToken();
        if (!token) throw new Error('Sessão expirada. Entre novamente para transferir itens.');

        // A mutação real acontece em UMA transação no backend. O callback legado
        // é executado depois apenas para atualizar a UI; seus retries individuais
        // são idempotentes no backend novo.
        const response = await fetch(
          `${API_BASE_URL}/comandas/itens/transferir-lote/${targetTableId}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ item_ids: itemIds }),
          },
        );
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.detail || 'Não foi possível transferir os itens em conjunto.');
        }
        await onTransferItems(itemIds, targetTableId);
      }
    : undefined;

  return (
    <MesaDetailsModalBase
      {...props}
      orders={lotOrders}
      tableOperationalState={tableOperationalState}
      onDeliverItem={handleDeliverItem}
      onUnmergeTable={handleUnmergeTable}
      onPrintKitchenLaunch={handlePrintLaunch}
      onTransferItems={handleTransferItems}
    />
  );
};
