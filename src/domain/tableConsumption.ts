import type { Order, OrderItem } from '../types';

/**
 * Calculates the total cost of all orders placed for a specific table.
 */
export function getTableTotal(orders: Order[]): number {
  return orders.reduce((sum, order) => {
    return (
      sum +
      order.itens
        .filter((item) => (item.status as string) !== 'cancelado' && !item.pago)
        .reduce((itemSum, item) => itemSum + item.preco, 0)
    );
  }, 0);
}

/**
 * Groups order items across all active orders of a table by customer name.
 * Normalizes customer names to group them correctly (e.g., trimming, default fallback).
 */
export function groupItemsByCustomer(orders: Order[]): {
  [customerName: string]: OrderItem[];
} {
  const grouped: { [customerName: string]: OrderItem[] } = {};

  orders.forEach((order) => {
    order.itens.forEach((item) => {
      // Ignora itens cancelados ou já pagos na divisão por cliente
      if ((item.status as string) === 'cancelado' || item.pago) return;

      // Proteção de null/undefined para clienteNome
      const normalizedName = (item.clienteNome ?? '').trim() || 'Consumo Geral';
      if (!grouped[normalizedName]) {
        grouped[normalizedName] = [];
      }
      grouped[normalizedName].push(item);
    });
  });

  return grouped;
}

/**
 * Calculates subtotal for each customer on a table.
 */
export function getCustomerSubtotals(orders: Order[]): { name: string; total: number; count: number }[] {
  const grouped = groupItemsByCustomer(orders);
  return Object.keys(grouped).map((name) => {
    const items = grouped[name];
    const total = items.reduce((sum, item) => sum + item.preco, 0);
    return {
      name,
      total,
      count: items.length,
    };
  });
}
