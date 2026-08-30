import type { Order, OrderItem } from '../types';
import { getOrderCheckId, getOrderDisplayNumber, type LaunchIdentityMap } from './orderIdentity';

/**
 * A comanda é a conta da mesa; o lançamento é a instância operacional criada
 * a cada confirmação de pedido. A tela de consumo deve renderizar um card por
 * lançamento sem alterar a identidade da comanda usada nas demais ações.
 */
export const splitOrdersByLaunch = (orders: Order[], identities?: Readonly<LaunchIdentityMap>): Order[] => {
  const lots: Order[] = [];

  orders.forEach((order) => {
    const groupedItems = new Map<string, OrderItem[]>();

    order.itens.forEach((item) => {
      const launchId = item.lancamentoId?.trim();
      const key = launchId || `legacy:${order.id}`;
      const current = groupedItems.get(key);
      if (current) {
        current.push(item);
      } else {
        groupedItems.set(key, [item]);
      }
    });

    groupedItems.forEach((itens, key) => {
      const lancamentoId = key.startsWith('legacy:') ? undefined : key;
      const displayNumber = lancamentoId
        ? identities?.[lancamentoId]?.displayNumber
          || order.launchIdentities?.[lancamentoId]?.displayNumber
          || (order.lancamentoId === lancamentoId ? getOrderDisplayNumber(order) : undefined)
        : undefined;
      lots.push({
        ...order,
        checkId: getOrderCheckId(order),
        lancamentoId,
        displayNumber,
        itens,
        items: itens,
      });
    });
  });

  return lots;
};
