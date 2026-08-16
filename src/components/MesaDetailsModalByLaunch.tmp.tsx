import React from 'react';
import { MesaDetailsModal as MesaDetailsModalBase } from './MesaDetailsModalBase';
import { splitOrdersByLaunch } from '../domain/orderLots';

/**
 * Adaptador operacional da tela de mesa.
 *
 * O backend mantém uma comanda como conta agregada da mesa, enquanto a operação
 * de salão precisa enxergar cada clique em Confirmar como um lote separado.
 * Este wrapper transforma somente a apresentação em lotes e preserva os IDs de
 * comanda nas ações que ainda operam no agregado (servir/desmesclar).
 */
type MesaDetailsModalProps = React.ComponentProps<typeof MesaDetailsModalBase>;

export const MesaDetailsModal: React.FC<MesaDetailsModalProps> = (props) => {
  const { orders, onDeliverItem, onUnmergeTable, onPrintKitchenLaunch } = props;

  const launchToComanda = React.useMemo(() => {
    const mapping = new Map<string, string>();
    orders.forEach((order) => {
      order.itens.forEach((item) => {
        if (item.lancamentoId) {
          mapping.set(item.lancamentoId, order.id);
        }
      });
    });
    return mapping;
  }, [orders]);

  const lotOrders = React.useMemo(
    () => splitOrdersByLaunch(orders).map((lot) => ({
      ...lot,
      // O componente visual usa order.id para identificar/exibir/imprimir o lote.
      // As ações de comanda são remapeadas abaixo para o ID agregado original.
      id: lot.lancamentoId || lot.id,
    })),
    [orders],
  );

  const resolveComandaId = React.useCallback(
    (displayOrderId: string) => launchToComanda.get(displayOrderId) || displayOrderId,
    [launchToComanda],
  );

  const handleDeliverItem = onDeliverItem
    ? (displayOrderId: string, itemId: string) => onDeliverItem(resolveComandaId(displayOrderId), itemId)
    : undefined;

  const handleUnmergeTable = onUnmergeTable
    ? (displayOrderId: string) => onUnmergeTable(resolveComandaId(displayOrderId))
    : undefined;

  const handlePrintLaunch = onPrintKitchenLaunch
    ? async (launchId: string) => {
        if (!launchToComanda.has(launchId)) {
          throw new Error('Este lote não possui identificador de lançamento para impressão.');
        }
        await onPrintKitchenLaunch(launchId);
      }
    : undefined;

  return (
    <MesaDetailsModalBase
      {...props}
      orders={lotOrders}
      onDeliverItem={handleDeliverItem}
      onUnmergeTable={handleUnmergeTable}
      onPrintKitchenLaunch={handlePrintLaunch}
    />
  );
};
