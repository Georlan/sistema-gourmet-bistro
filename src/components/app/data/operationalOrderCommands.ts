import { API_BASE_URL } from '../../../config/api';
import { operationalFetch } from '../../../utils/operationalRequest';

type AuthHeadersFactory = (contentType?: string) => Record<string, string>;

export type OperationalCommandResult =
  | { ok: true; message?: never }
  | { ok: false; message: string };

export type CloseOperationalComandasResult = OperationalCommandResult;

const readErrorMessage = async (response: Response): Promise<string> => {
  const payload = await response.json().catch(() => null);
  if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail.trim();
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
  return response.statusText || `HTTP ${response.status}`;
};

/**
 * Command owner for closing one or more active comandas of a table.
 * Keeps transport details out of App.tsx while the backend remains the source of truth.
 */
export async function closeOperationalComandas(
  rawComandaIds: Array<string | number>,
  getAuthHeaders: AuthHeadersFactory,
): Promise<CloseOperationalComandasResult> {
  const comandaIds = rawComandaIds
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);

  if (comandaIds.length === 0) {
    return { ok: false, message: 'Nenhuma comanda ativa encontrada para encerrar.' };
  }

  for (const comandaId of comandaIds) {
    const response = await operationalFetch(
      `${API_BASE_URL}/comandas/${encodeURIComponent(comandaId)}/fechar`,
      {
        method: 'PUT',
        headers: getAuthHeaders(),
      },
    );

    if (!response.ok) {
      return { ok: false, message: await readErrorMessage(response) };
    }
  }

  return { ok: true };
}

/**
 * Cancels a single item only after backend validation succeeds.
 * Does not mutate local state optimistically before the server responds.
 */
export async function cancelOperationalItem(
  itemId: string,
  getAuthHeaders: AuthHeadersFactory,
): Promise<OperationalCommandResult> {
  const cleanId = String(itemId ?? '').trim();
  if (!cleanId) {
    return { ok: false, message: 'Item inválido para cancelamento.' };
  }

  const response = await operationalFetch(
    `${API_BASE_URL}/comandas/itens/${encodeURIComponent(cleanId)}/cancelar`,
    {
      method: 'PUT',
      headers: getAuthHeaders(),
    },
  );

  if (!response.ok) {
    return { ok: false, message: await readErrorMessage(response) };
  }

  return { ok: true };
}

/**
 * Updates item observation, customer name, or additional quantity only after backend confirmation.
 */
export async function updateOperationalItemDetails(
  params: {
    itemId: string;
    observacao?: string;
    clienteNome: string;
    quantidadeAdicional?: number;
  },
  getAuthHeaders: AuthHeadersFactory,
): Promise<OperationalCommandResult> {
  const cleanId = String(params.itemId ?? '').trim();
  if (!cleanId) {
    return { ok: false, message: 'Item inválido para edição.' };
  }

  const body: Record<string, unknown> = {
    cliente_nome: params.clienteNome,
    quantidade_adicional: params.quantidadeAdicional || undefined,
  };
  if (params.observacao !== undefined) {
    body.observacao = params.observacao;
  }

  const response = await operationalFetch(
    `${API_BASE_URL}/comandas/itens/${encodeURIComponent(cleanId)}`,
    {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    return { ok: false, message: await readErrorMessage(response) };
  }

  return { ok: true };
}

/**
 * Transfers one or more items to a target table in a single atomic transaction
 * via `/comandas/itens/transferir-lote/{nova_mesa_id}`.
 */
export async function transferOperationalItems(
  rawItemIds: readonly string[],
  targetTableId: number,
  getAuthHeaders: AuthHeadersFactory,
): Promise<OperationalCommandResult> {
  const itemIds = Array.from(
    new Set(rawItemIds.map((id) => String(id ?? '').trim()).filter(Boolean)),
  );
  if (itemIds.length === 0) {
    return { ok: false, message: 'Selecione ao menos um item para transferir.' };
  }

  const response = await operationalFetch(
    `${API_BASE_URL}/comandas/itens/transferir-lote/${targetTableId}`,
    {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ item_ids: itemIds }),
    },
  );
  if (!response.ok) {
    return { ok: false, message: await readErrorMessage(response) };
  }

  return { ok: true };
}

