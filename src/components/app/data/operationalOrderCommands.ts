import { API_BASE_URL } from '../../../config/api';
import { operationalFetch } from '../../../utils/operationalRequest';

type AuthHeadersFactory = (contentType?: string) => Record<string, string>;

export type CloseOperationalComandasResult =
  | { ok: true; message?: never }
  | { ok: false; message: string };

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
