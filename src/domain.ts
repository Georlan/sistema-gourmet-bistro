/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Order, OrderItem } from './types';

/**
 * Calculates the total cost of all orders placed for a specific table.
 */
export function getTableTotal(orders: Order[]): number {
  return orders.reduce((sum, order) => {
    return sum + order.itens
      .filter(item => (item.status as string) !== 'cancelado' && !item.pago)
      .reduce((itemSum, item) => itemSum + item.preco, 0);
  }, 0);
}

/**
 * Groups order items across all active orders of a table by customer name.
 * Normalizes customer names to group them correctly (e.g., trimming, default fallback).
 */
export function groupItemsByCustomer(orders: Order[]): { [customerName: string]: OrderItem[] } {
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
      count: items.length
    };
  });
}

/**
 * Gets the elapsed time since the first order was made.
 * Returns formatted string like "45m" or "1h 12m" or "--".
 */
export function formatElapsedTime(firstOrderTimestamp: number | undefined, currentTime: number): string {
  if (!firstOrderTimestamp) return '--';
  const diffMs = currentTime - firstOrderTimestamp;
  if (diffMs < 0) return '0m';

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) {
    return `${diffMins}m`;
  }
  const hours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;
  return `${hours}h ${remainingMins}m`;
}

/**
 * Dynamically generates observation presets based on product attributes and category.
 */
export function getProductPresets(product: { nome: string; descricao: string; categoria: string }): string[] {
  const presets: string[] = ['VIAGEM', 'PRA MESA'];
  
  const desc = (product.descricao || '').toLowerCase();
  const name = (product.nome || '').toLowerCase();
  const cat = (product.categoria || '').toLowerCase();

  // Check ingredients in name/description
  if (desc.includes('salada') || name.includes('salada')) presets.push('sem salada');
  if (desc.includes('cebola') || name.includes('cebola')) presets.push('sem cebola');
  if (desc.includes('cheddar') || name.includes('cheddar')) presets.push('sem cheddar');
  if (desc.includes('bacon') || name.includes('bacon')) presets.push('sem bacon');
  if (desc.includes('ovo') || name.includes('ovo')) presets.push('sem ovo');
  if (desc.includes('queijo') || desc.includes('coalho') || desc.includes('muçarela') || name.includes('queijo') || name.includes('cheese')) presets.push('sem queijo');
  if (desc.includes('barbecue') || desc.includes('barbeque') || name.includes('barbecue') || name.includes('costela') || name.includes('picanha')) presets.push('sem barbecue');
  if (desc.includes('molho') || name.includes('molho')) presets.push('sem molho');
  if (desc.includes('maionese') || name.includes('maionese')) presets.push('sem maionese');
  if (desc.includes('tomate') || name.includes('tomate')) presets.push('sem tomate');
  if (desc.includes('milho') || name.includes('milho')) presets.push('sem milho');
  if (desc.includes('azeitona') || name.includes('azeitona')) presets.push('sem azeitona');
  if (desc.includes('presunto') || name.includes('presunto')) presets.push('sem presunto');
  if (desc.includes('orégano') || desc.includes('oregano') || name.includes('orégano')) presets.push('sem orégano');
  if (desc.includes('abacaxi') || name.includes('abacaxi')) presets.push('sem abacaxi');

  // Beverage specific options
  const catId = (product as any).categoria_id || (product as any).categoriaId || '';
  const isBeverage = 
    catId === 'cat-refri' || 
    catId === 'cat-sucos' || 
    catId === 'cat-cervejas' || 
    catId === 'cat-quentes' ||
    cat.includes('bebida') || 
    cat.includes('suco') || 
    cat.includes('refrigerante') || 
    cat.includes('cerveja') || 
    name.includes('suco') || 
    name.includes('refrigerante') || 
    name.includes('heineken') || 
    name.includes('spaten');

  if (isBeverage) {
    presets.push('com gelo', 'sem gelo', 'com açúcar', 'sem açúcar', 'com limão');
  }

  // Remove duplicates and keep maximum 8 presets for clean UI layout
  return Array.from(new Set(presets)).slice(0, 8);
}

