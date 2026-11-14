export interface ConfirmKdsBatchArgs {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  itemIds: readonly string[];
}

/** One server transaction for a single ticket, not N sequential PUT/GET calls.
 * The backend enforces same-tenant, same-check, same-launch and atomic status.
 */
export async function confirmKdsBatch({ apiBaseUrl, authHeaders, itemIds }: ConfirmKdsBatchArgs): Promise<string[]> {
  if (!itemIds.length || itemIds.length > 40 || new Set(itemIds).size !== itemIds.length) {
    throw new Error('Seleção de itens inválida.');
  }
  const response = await fetch(`${apiBaseUrl}/comandas/kds/itens/prontos`, {
    method: 'PUT',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_ids: itemIds }),
  });
  if (!response.ok) throw new Error(`Não foi possível confirmar o preparo (HTTP ${response.status}).`);
  const body = await response.json() as { confirmed_ids?: unknown };
  const confirmed = body.confirmed_ids;
  if (!Array.isArray(confirmed) || confirmed.length !== itemIds.length
      || itemIds.some(id => !confirmed.includes(id))) {
    throw new Error('Resposta incompleta da cozinha. Sincronize antes de continuar.');
  }
  return confirmed as string[];
}
