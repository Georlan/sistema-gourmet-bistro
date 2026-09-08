export interface GuestCheckoutContact {
  name: string;
  phone: string;
  email: string;
  address: string;
}

const guestCheckoutKey = (restaurantId: string | number) =>
  `koma_guest_checkout:${String(restaurantId)}`;

const normalizeContact = (value: unknown): GuestCheckoutContact | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<GuestCheckoutContact>;
  return {
    name: String(raw.name || "").slice(0, 100),
    phone: String(raw.phone || "").replace(/\D/g, "").slice(0, 11),
    email: String(raw.email || "").trim().toLowerCase().slice(0, 254),
    address: String(raw.address || "").slice(0, 300),
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
    sessionStorage.removeItem(key);
  }

  // One-time migration for clients that still have PII in durable storage.
  try {
    const legacyRaw = localStorage.getItem(key);
    if (!legacyRaw) return null;

    localStorage.removeItem(key);
    const parsed = normalizeContact(JSON.parse(legacyRaw));
    if (!parsed) return null;

    sessionStorage.setItem(key, JSON.stringify(parsed));
    return parsed;
  } catch {
    localStorage.removeItem(key);
    return null;
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
}
