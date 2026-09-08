export interface CustomerProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  points: number;
  cashback: number;
}

export interface CustomerSession {
  token: string;
  profile: CustomerProfile;
}

interface CustomerProfileApi {
  id: string;
  nome: string;
  telefone: string;
  email?: string;
  endereco?: string;
  saldo_pontos?: number;
  saldo_cashback?: number;
}

const sessionKey = (restaurantId: string | number) =>
  `koma_customer_session:${String(restaurantId)}`;

export function normalizeBrazilianPhone(value: string): string {
  return (value || "").replace(/\D/g, "").slice(0, 11);
}

export function formatBrazilianPhone(value: string): string {
  const numbers = normalizeBrazilianPhone(value);
  if (numbers.length <= 2) return numbers ? `(${numbers}` : "";
  if (numbers.length <= 6) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

export function mapCustomerProfile(payload: CustomerProfileApi): CustomerProfile {
  return {
    id: String(payload.id),
    name: String(payload.nome || ""),
    phone: normalizeBrazilianPhone(payload.telefone || ""),
    email: payload.email ? String(payload.email) : undefined,
    address: String(payload.endereco || ""),
    points: Number(payload.saldo_pontos || 0),
    cashback: Number(payload.saldo_cashback || 0),
  };
}

function validCustomerSession(raw: string | null): CustomerSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CustomerSession>;
    if (
      typeof parsed.token !== "string"
      || !parsed.token
      || !parsed.profile
      || typeof parsed.profile.id !== "string"
      || normalizeBrazilianPhone(parsed.profile.phone || "").length < 10
    ) return null;
    return parsed as CustomerSession;
  } catch {
    return null;
  }
}

/**
 * Sessão de cliente é limitada à aba. Isso preserva reload/navegação da SPA,
 * mas evita deixar token + nome/telefone/e-mail/endereço/saldos no disco via
 * localStorage. A sessão HttpOnly é a etapa final; até lá, sessionStorage reduz
 * a persistência sem quebrar o fluxo atual baseado em header.
 */
export function loadCustomerSession(
  restaurantId: string | number,
): CustomerSession | null {
  const key = sessionKey(restaurantId);
  try {
    const current = validCustomerSession(sessionStorage.getItem(key));
    if (current) {
      localStorage.removeItem(key);
      return current;
    }
    sessionStorage.removeItem(key);

    // Migração única de clientes que ainda têm a sessão antiga persistida.
    const legacy = validCustomerSession(localStorage.getItem(key));
    localStorage.removeItem(key);
    if (!legacy) return null;
    sessionStorage.setItem(key, JSON.stringify(legacy));
    return legacy;
  } catch {
    try { sessionStorage.removeItem(key); } catch { /* Ignore */ }
    try { localStorage.removeItem(key); } catch { /* Ignore */ }
    return null;
  }
}

export function saveCustomerSession(
  restaurantId: string | number,
  session: CustomerSession,
): void {
  const key = sessionKey(restaurantId);
  sessionStorage.setItem(key, JSON.stringify(session));
  // Limpa qualquer cópia persistente deixada por versões anteriores.
  localStorage.removeItem(key);
}

export function clearCustomerSession(restaurantId: string | number): void {
  const key = sessionKey(restaurantId);
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
}
