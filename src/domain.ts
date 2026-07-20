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
 * Safely extracts category name string from a string or JSON object.
 */
export function obterNomeCategoria(categoria: any): string {
  if (!categoria) return "";
  if (typeof categoria === 'object') {
    return categoria.nome || categoria.name || "";
  }
  return String(categoria);
}

/**
 * Dynamically generates observation presets based on product attributes and category.
 */
export function getProductPresets(product: { nome: string; descricao: string; categoria: any }): string[] {
  const presets: string[] = ['VIAGEM', 'PRA MESA'];
  
  const desc = (product.descricao || '').toLowerCase();
  const name = (product.nome || '').toLowerCase();
  const cat = obterNomeCategoria(product.categoria).toLowerCase();

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

/**
 * Normalizes text by removing diacritics (accents) and converting to lowercase.
 */
export function normalizeText(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .trim();
}

/**
 * Damerau-Levenshtein distance calculation for typo tolerance.
 * Handles substitutions, insertions, deletions, and transpositions.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        const del = matrix[i - 1][j] + 1;
        const ins = matrix[i][j - 1] + 1;
        const sub = matrix[i - 1][j - 1] + 1;
        let dist = Math.min(del, ins, sub);

        if (
          i > 1 &&
          j > 1 &&
          b.charAt(i - 1) === a.charAt(j - 2) &&
          b.charAt(i - 2) === a.charAt(j - 1)
        ) {
          dist = Math.min(dist, matrix[i - 2][j - 2] + 1);
        }
        matrix[i][j] = dist;
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Smart Search Matching:
 * 1. Accent & diacritics insensitivity ("por do" -> "pôr do sol")
 * 2. Case insensitive
 * 3. Typo-tolerant fuzzy matching ("burgurr" -> "burguer", "chese" -> "cheese", "pasrel" -> "pastel")
 */
export function smartSearchMatch(text: string | undefined | null, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!text) return false;

  const normText = normalizeText(text);
  const normQuery = normalizeText(query);

  // 1. Direct normalized substring match (handles accents perfectly)
  if (normText.includes(normQuery)) return true;

  const queryTokens = normQuery.split(/\s+/).filter(Boolean);
  const textTokens = normText.split(/\s+/).filter(Boolean);

  if (queryTokens.length === 0) return true;

  // 2. Token-by-token check: every query token must match at least one text token (or fuzzy match)
  return queryTokens.every(qToken => {
    // Exact or substring match
    if (textTokens.some(tToken => tToken.includes(qToken) || qToken.includes(tToken))) {
      return true;
    }

    // Fuzzy typo match
    const qLen = qToken.length;
    if (qLen < 4) return false; // Don't fuzzy match 1-3 char words to avoid noise

    const maxDistance = qLen >= 8 ? 2 : 1;

    return textTokens.some(tToken => {
      if (Math.abs(tToken.length - qLen) > maxDistance) return false;
      return levenshteinDistance(qToken, tToken) <= maxDistance;
    });
  });
}


