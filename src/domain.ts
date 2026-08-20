/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Order, OrderItem } from './types';
import { parseBackendTimestamp } from './utils/dateTime';

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
 * Normalizes any timestamp input (number, ISO string, clock HH:MM string, Date)
 * into a valid unix timestamp in milliseconds, handling timezone offsets.
 */
export function normalizeOperationalTimestamp(raw: unknown, now: number = Date.now()): number | null {
  const date = parseBackendTimestamp(raw as string | number | Date | null | undefined, now);
  return date ? date.getTime() : null;
}

/**
 * Gets the elapsed time since the first order was made.
 * Returns formatted string like "45m" or "1h 12m" or "--".
 */
export function formatElapsedTime(firstOrderTimestamp: number | string | Date | undefined | null, currentTime: number = Date.now()): string {
  const ts = normalizeOperationalTimestamp(firstOrderTimestamp, currentTime);
  if (ts === null) return '--';
  const diffMs = Math.max(0, currentTime - ts);

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

type IngredientPresetProduct = {
  nome?: string | null;
  descricao?: string | null;
};

/**
 * Builds quick per-item adjustments only from ingredients explicitly mentioned
 * in the product name or description. This keeps SmartPOS shortcuts relevant
 * instead of showing the same generic observations for every product.
 */
export function getIngredientObservationPresets(product: IngredientPresetProduct): string[] {
  const searchableText = normalizeText(`${product.nome || ''} ${product.descricao || ''}`);
  if (!searchableText) return [];

  const paddedText = ` ${searchableText.replace(/\s+/g, ' ')} `;
  const hasAny = (...terms: string[]) => terms.some((term) => (
    paddedText.includes(` ${normalizeText(term).replace(/\s+/g, ' ')} `)
  ));
  const presets: string[] = [];
  const addWhenPresent = (label: string, ...terms: string[]) => {
    if (hasAny(...terms)) presets.push(`Sem ${label}`);
  };

  addWhenPresent('salada', 'salada');
  addWhenPresent('cebola', 'cebola');
  addWhenPresent('cheddar', 'cheddar');
  addWhenPresent('bacon', 'bacon');
  addWhenPresent('ovo', 'ovo');
  addWhenPresent('muçarela', 'muçarela', 'mussarela', 'mozzarella');
  addWhenPresent('gorgonzola', 'gorgonzola');
  addWhenPresent('provolone', 'provolone');
  addWhenPresent('parmesão', 'parmesão', 'parmesao');
  addWhenPresent('catupiry', 'catupiry');
  addWhenPresent('requeijão', 'requeijão', 'requeijao');
  addWhenPresent('queijo coalho', 'queijo coalho', 'coalho');

  const hasSpecificCheese = hasAny(
    'muçarela', 'mussarela', 'mozzarella', 'gorgonzola', 'provolone',
    'parmesão', 'parmesao', 'catupiry', 'requeijão', 'requeijao', 'coalho',
  );
  if (!hasSpecificCheese) addWhenPresent('queijo', 'queijo', 'cheese');

  addWhenPresent('calabresa', 'calabresa');
  addWhenPresent('pepperoni', 'pepperoni');
  addWhenPresent('frango', 'frango');
  addWhenPresent('carne', 'carne', 'hambúrguer', 'hamburguer');
  addWhenPresent('presunto', 'presunto');
  addWhenPresent('camarão', 'camarão', 'camarao');
  addWhenPresent('molho', 'molho');
  addWhenPresent('barbecue', 'barbecue', 'barbeque');
  addWhenPresent('maionese', 'maionese');
  addWhenPresent('tomate', 'tomate');
  addWhenPresent('milho', 'milho');
  addWhenPresent('azeitona', 'azeitona');
  addWhenPresent('orégano', 'orégano', 'oregano');
  addWhenPresent('manjericão', 'manjericão', 'manjericao');
  addWhenPresent('azeite', 'azeite');
  addWhenPresent('abacaxi', 'abacaxi');
  addWhenPresent('palmito', 'palmito');
  addWhenPresent('pimentão', 'pimentão', 'pimentao');
  addWhenPresent('cogumelo', 'cogumelo', 'champignon');
  addWhenPresent('rúcula', 'rúcula', 'rucula');
  addWhenPresent('alho', 'alho');
  addWhenPresent('pimenta', 'pimenta');

  return Array.from(new Set(presets)).slice(0, 8);
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
 * 4. Multi-word search with stopword handling ("pasrel de frango" -> "Pastel de Frango")
 */
export function smartSearchMatch(text: string | undefined | null, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!text) return false;

  const normText = normalizeText(text);
  const normQuery = normalizeText(query);

  // 1. Direct normalized substring match (handles accents & full phrases instantly)
  if (normText.includes(normQuery)) return true;

  const rawQueryTokens = normQuery.split(/\s+/).filter(Boolean);
  const textTokens = normText.split(/\s+/).filter(Boolean);

  if (rawQueryTokens.length === 0) return true;

  // Filter out 1-2 letter connective stopwords ("de", "do", "da", "e", "a", "o") unless query is only short words
  const mainQueryTokens = rawQueryTokens.filter(t => t.length > 2);
  const queryTokens = mainQueryTokens.length > 0 ? mainQueryTokens : rawQueryTokens;

  // 2. Token-by-token check: every relevant query token must match at least one text token
  return queryTokens.every(qToken => {
    // Exact or substring match (e.g. "pas" matches "pastel", "frango" matches "hamburguer-frango")
    if (textTokens.some(tToken => tToken.includes(qToken) || (tToken.length >= 3 && qToken.startsWith(tToken)))) {
      return true;
    }

    // Fuzzy typo match
    const qLen = qToken.length;
    if (qLen < 4) return false; // Don't fuzzy match 1-3 char words to avoid noise

    const maxDistance = qLen >= 8 ? 2 : 1;

    return textTokens.some(tToken => {
      // 1. Full word fuzzy match
      if (Math.abs(tToken.length - qLen) <= maxDistance && levenshteinDistance(qToken, tToken) <= maxDistance) {
        return true;
      }
      // 2. Partial prefix fuzzy match (e.g. "pasr" matching "pastel", "burgr" matching "burguer")
      if (tToken.length >= qLen) {
        const tPrefix = tToken.slice(0, qLen);
        if (levenshteinDistance(qToken, tPrefix) <= maxDistance) {
          return true;
        }
      }
      return false;
    });
  });
}
