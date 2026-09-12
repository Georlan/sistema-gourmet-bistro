import { API_BASE_URL } from '../../config/api';
import { getOperationalAccessToken, type OperationalPortal } from '../../utils/authSession';
import { operationalFetch } from '../../utils/operationalRequest';

type RequestTableBillDependencies = {
  apiBaseUrl?: string;
  fetcher?: typeof operationalFetch;
  getToken?: (portal: OperationalPortal) => string;
};

export async function requestTableBill(
  checkIds: string[],
  portal: OperationalPortal,
  dependencies: RequestTableBillDependencies = {},
): Promise<string[]> {
  const uniqueCheckIds = Array.from(new Set(checkIds.map(id => String(id || '').trim()).filter(Boolean)));
  if (uniqueCheckIds.length === 0) return [];

  const getToken = dependencies.getToken ?? getOperationalAccessToken;
  const token = getToken(portal);
  if (!token) {
    throw new Error('Sua sessão expirou. Entre novamente antes de solicitar a conta.');
  }

  const fetcher = dependencies.fetcher ?? operationalFetch;
  const apiBaseUrl = (dependencies.apiBaseUrl ?? API_BASE_URL).replace(/\/+$/, '');
  const requested: string[] = [];

  for (const checkId of uniqueCheckIds) {
    const response = await fetcher(
      `${apiBaseUrl}/comandas/${encodeURIComponent(checkId)}/pedir-conta`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: string } | null;
      throw new Error(payload?.detail || 'Não foi possível solicitar a conta desta mesa.');
    }

    requested.push(checkId);
  }

  return requested;
}
