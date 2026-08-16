import React from 'react';
import { MesaDetailsModal as MesaDetailsModalBase } from './MesaDetailsModalBase';
import { splitOrdersByLaunch } from '../domain/orderLots';
import { API_BASE_URL } from '../config/api';

/**
 * Adaptador operacional da tela de mesa.
 *
 * A Comanda continua sendo a conta agregada usada pelas rotas legadas, mas a
 * operação humana enxerga cada confirmação como Pedido #46-A, #46-B... O ID
 * técnico l-xxxx nunca é perdido: ele continua sendo usado para impressão e
 * para ações que precisam alcançar o lançamento real.
 */
type MesaDetailsModalProps = React.ComponentProps<typeof MesaDetailsModalBase>;

type FamilySnapshot = {
  familias?: Array<{
    numero_conta: number;
    lancamentos?: Array<{
      lancamento_id: string;
      pedido_id: string;
      sequencia: number;
    }>;
  }>;
};

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
  const [launchLabels, setLaunchLabels] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let cancelled = false;
    const token = currentAuthToken();
    if (!token || !table?.id || orders.length === 0) {
      setLaunchLabels({});
      return () => { cancelled = true; };
    }

    const loadFamilies = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/atendimentos/mesas/${table.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const data = await response.json() as FamilySnapshot;
        const labels: Record<string, string> = {};
        for (const family of data.familias || []) {
          for (const launch of family.lancamentos || []) {
            labels[launch.lancamento_id] = launch.pedido_id;
          }
        }
        if (!cancelled) setLaunchLabels(labels);
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
        if (item.lancamentoId) mapping.set(item.lancamentoId, order.id);
      });
    });
    return mapping;
  }, [orders]);

  const displayToLaunch = React.useMemo(() => {
    const mapping = new Map<string, string>();
    Object.entries(launchLabels).forEach(([launchId, displayId]) => {
      mapping.set(displayId, launchId);
    });
    launchToComanda.forEach((_commandId, launchId) => {
      if (!mapping.has(launchId)) mapping.set(launchId, launchId);
    });
    return mapping;
  }, [launchLabels, launchToComanda]);

  const lotOrders = React.useMemo(
    () => splitOrdersByLaunch(orders).map((lot) => {
      const launchId = lot.lancamentoId;
      return {
        ...lot,
        // ID de apresentação é humano; lancamentoId conserva a identidade técnica.
        id: launchId ? (launchLabels[launchId] || launchId) : lot.id,
      };
    }),
    [orders, launchLabels],
  );

  const resolveLaunchId = React.useCallback(
    (displayOrderId: string) => displayToLaunch.get(displayOrderId) || displayOrderId,
    [displayToLaunch],
  );

  const resolveComandaId = React.useCallback(
    (displayOrderId: string) => {
      const launchId = resolveLaunchId(displayOrderId);
      return launchToComanda.get(launchId) || displayOrderId;
    },
    [launchToComanda, resolveLaunchId],
  );

  const handleDeliverItem = onDeliverItem
    ? (displayOrderId: string, itemId: string) => onDeliverItem(resolveComandaId(displayOrderId), itemId)
    : undefined;

  const handleUnmergeTable = onUnmergeTable
    ? (displayOrderId: string) => onUnmergeTable(resolveComandaId(displayOrderId))
    : undefined;

  const handlePrintLaunch = onPrintKitchenLaunch
    ? async (displayOrderId: string) => {
        const launchId = resolveLaunchId(displayOrderId);
        if (!launchToComanda.has(launchId)) {
          throw new Error('Este pedido não possui identificador de lançamento para impressão.');
        }
        await onPrintKitchenLaunch(launchId);
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
      onDeliverItem={handleDeliverItem}
      onUnmergeTable={handleUnmergeTable}
      onPrintKitchenLaunch={handlePrintLaunch}
      onTransferItems={handleTransferItems}
    />
  );
};
