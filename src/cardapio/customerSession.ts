export interface CustomerProfile {
  id: string;
  name: string;
  phone: string;
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
    address: String(payload.endereco || ""),
    points: Number(payload.saldo_pontos || 0),
    cashback: Number(payload.saldo_cashback || 0),
  };
}

export function loadCustomerSession(
  restaurantId: string | number,
): CustomerSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(restaurantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CustomerSession>;
    if (
      typeof parsed.token !== "string"
      || !parsed.token
      || !parsed.profile
      || typeof parsed.profile.id !== "string"
      || normalizeBrazilianPhone(parsed.profile.phone || "").length < 10
    ) {
      localStorage.removeItem(sessionKey(restaurantId));
      return null;
    }
    return parsed as CustomerSession;
  } catch {
    localStorage.removeItem(sessionKey(restaurantId));
    return null;
  }
}

export function saveCustomerSession(
  restaurantId: string | number,
  session: CustomerSession,
): void {
  localStorage.setItem(sessionKey(restaurantId), JSON.stringify(session));
}

export function clearCustomerSession(restaurantId: string | number): void {
  localStorage.removeItem(sessionKey(restaurantId));
}
