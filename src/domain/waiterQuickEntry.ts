import type { DraftItem, Order } from '../types';

type QuickDraft = DraftItem & {
  modificadorIds?: string[];
  modificadoresSelecionados?: unknown[];
};

const clientKey = (name: string) => {
  const trimmed = name.trim();
  return trimmed.toLocaleLowerCase('pt-BR') === 'consumo geral' ? '' : trimmed;
};

/** Project only plain units for one explicit client; never fall back to a customized item. */
export function projectStandardQuickDrafts(items: readonly DraftItem[], client: string) {
  const projected = new Map<string, { item: DraftItem; quantity: number }>();
  for (const item of items) {
    const decorated = item as QuickDraft;
    if ((item.observacao || '').trim()
      || decorated.modificadorIds?.length
      || decorated.modificadoresSelecionados?.length
      || clientKey(item.clienteNome || '') !== clientKey(client)) continue;
    const previous = projected.get(item.produtoId);
    projected.set(item.produtoId, { item, quantity: (previous?.quantity || 0) + (item.quantidade || 1) });
  }
  return projected;
}

/** Names already present in this table's items; no catalog-wide/customer-history lookup. */
export function getTableQuickClients(drafts: readonly DraftItem[], orders: readonly Order[]) {
  const names = new Set<string>();
  for (const item of [...orders.flatMap(order => order.itens), ...drafts]) {
    const name = (item.clienteNome || '').trim();
    if (clientKey(name)) names.add(name);
  }
  return [...names];
}
