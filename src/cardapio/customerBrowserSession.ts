import { API_BASE_URL } from "../config/api";
import { authFetch } from "../utils/authRequest";
import { CustomerSession, mapCustomerProfile } from "./customerSession";

// An explicit logout must not silently turn into a login when cookies cannot be revoked offline.
// The marker contains no token or customer data and is isolated by canonical restaurant ID.
export const customerSignedOutKey = (restaurantId: string | number) =>
  `koma_customer_signed_out:${String(restaurantId)}`;

export function blockCustomerBrowserRestore(restaurantId: string | number): void {
  try { localStorage.setItem(customerSignedOutKey(restaurantId), "1"); } catch { /* private mode */ }
}

export function allowCustomerBrowserRestore(restaurantId: string | number): void {
  try { localStorage.removeItem(customerSignedOutKey(restaurantId)); } catch { /* private mode */ }
}

function wasSignedOut(restaurantId: string | number): boolean {
  try { return localStorage.getItem(customerSignedOutKey(restaurantId)) === "1"; }
  catch { return false; }
}

export async function restoreCustomerBrowserSession(restaurantId: string | number): Promise<CustomerSession | null> {
  if (wasSignedOut(restaurantId)) return null;
  const response = await authFetch(
    `${API_BASE_URL}/cardapio/clientes/sessao?restaurante_id=${encodeURIComponent(String(restaurantId))}`,
    { credentials: "include", cache: "no-store" },
  );
  if (response.status === 204 || !response.ok) return null;
  const data = await response.json().catch(() => null);
  if (!data?.access_token || !data?.cliente || wasSignedOut(restaurantId)) return null;
  return { token: String(data.access_token), profile: mapCustomerProfile(data.cliente) };
}

export async function closeCustomerBrowserSession(restaurantId: string | number): Promise<void> {
  await authFetch(
    `${API_BASE_URL}/cardapio/clientes/sessao/sair?restaurante_id=${encodeURIComponent(String(restaurantId))}`,
    { method: "POST", headers: { "X-Koma-Session-Action": "logout" }, credentials: "include" },
  );
}
