export interface GuestCheckoutContact {
  name: string;
  phone: string;
  email: string;
  address: string;
}

const guestCheckoutKey = (restaurantId: string | number) =>
  `koma_guest_checkout:${String(restaurantId)}`;

const rememberedKey = (restaurantId: string | number) =>
  `koma_remembered_contact:${String(restaurantId)}`;
const REMEMBER_CONTACT_TTL = 90 * 24 * 60 * 60 * 1000;

/** Explicit convenience opt-in; never an authenticated identity or delivery address. */
export function loadRememberedGuestContact(restaurantId: string | number): GuestCheckoutContact | null {
  try {
    const key = rememberedKey(restaurantId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (stored.version !== 1 || !Number.isFinite(stored.expiresAt) || stored.expiresAt <= Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    const contact = normalizeContact(stored.contact);
    if (!contact || contact.phone.length < 10) {
      localStorage.removeItem(key);
      return null;
    }
    return { ...contact, email: "" };
  } catch { return null; }
}

export function rememberGuestContact(
  restaurantId: string | number, contact: GuestCheckoutContact, remember: boolean,
): boolean {
  try {
    const key = rememberedKey(restaurantId);
    if (!remember) { localStorage.removeItem(key); return true; }
    const normalized = normalizeContact(contact);
    if (!normalized || normalized.phone.length < 10) return false;
    localStorage.setItem(key, JSON.stringify({
      version: 1, expiresAt: Date.now() + REMEMBER_CONTACT_TTL,
      contact: { name: normalized.name, phone: normalized.phone },
    }));
    return true;
  } catch { return false; }
}

const normalizeContact = (value: unknown): GuestCheckoutContact | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<GuestCheckoutContact>;
  return {
    name: String(raw.name || "").slice(0, 100),
    phone: String(raw.phone || "").replace(/\D/g, "").slice(0, 11),
    email: String(raw.email || "").trim().toLowerCase().slice(0, 254),
    // Endereço de entrega pertence ao pedido, não à sessão do visitante.
    // Reaproveitar esse campo silenciosamente pode enviar um pedido para um
    // endereço de outra compra/pessoa no mesmo navegador.
    address: "",
  };
};

export function loadGuestCheckoutContact(
  restaurantId: string | number,
): GuestCheckoutContact | null {
  const key = guestCheckoutKey(restaurantId);

  try {
    const sessionRaw = sessionStorage.getItem(key);
    if (sessionRaw) {
      const parsed = normalizeContact(JSON.parse(sessionRaw));
      if (parsed) return parsed;
      sessionStorage.removeItem(key);
    }
  } catch {
    try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  }

  // One-time migration for clients that still have PII in durable storage.
  try {
    const legacyRaw = localStorage.getItem(key);
    if (!legacyRaw) return loadRememberedGuestContact(restaurantId);

    localStorage.removeItem(key);
    const parsed = normalizeContact(JSON.parse(legacyRaw));
    if (!parsed) return null;

    sessionStorage.setItem(key, JSON.stringify(parsed));
    return parsed;
  } catch {
    try { localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
    return loadRememberedGuestContact(restaurantId);
  }
}

export function saveGuestCheckoutContact(
  restaurantId: string | number,
  contact: GuestCheckoutContact,
): void {
  const key = guestCheckoutKey(restaurantId);
  const normalized = normalizeContact(contact);
  localStorage.removeItem(key);
  if (!normalized) {
    sessionStorage.removeItem(key);
    return;
  }
  sessionStorage.setItem(key, JSON.stringify(normalized));
}

export function clearGuestCheckoutContact(restaurantId: string | number): void {
  const key = guestCheckoutKey(restaurantId);
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
  localStorage.removeItem(rememberedKey(restaurantId));
}
