export type CardapioAcquisition = {
  session_id: string;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  referrer?: string;
  landing_path?: string;
  client_surface?: string;
};

const STORAGE_KEY = "koma_cardapio_acquisition_v1";
const MAX_VALUE = 160;

function clean(value: string | null | undefined, max = MAX_VALUE): string | undefined {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, max) : undefined;
}

function surfaceFromUserAgent(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes("instagram")) return "instagram_in_app";
  if (ua.includes("fban") || ua.includes("fbav") || ua.includes("facebook")) return "facebook_in_app";
  if (ua.includes("whatsapp")) return "whatsapp_in_app";
  return "browser";
}

function safeReferrer(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    return clean(`${url.origin}${url.pathname}`, 300);
  } catch {
    return undefined;
  }
}

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `acq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }
}

export function getCardapioAcquisition(): CardapioAcquisition | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) {
      const parsed = JSON.parse(existing) as CardapioAcquisition;
      if (parsed?.session_id) return parsed;
    }
  } catch {
    // Attribution is optional and must never block checkout.
  }

  const params = new URLSearchParams(window.location.search);
  const clientSurface = surfaceFromUserAgent(navigator.userAgent || "");
  const explicitSource = clean(params.get("utm_source"));
  const acquisition: CardapioAcquisition = {
    session_id: newSessionId(),
    source: explicitSource || (clientSurface === "instagram_in_app" ? "instagram" : undefined),
    medium: clean(params.get("utm_medium")) || (clientSurface.endsWith("_in_app") ? "in_app_browser" : undefined),
    campaign: clean(params.get("utm_campaign")),
    content: clean(params.get("utm_content")),
    term: clean(params.get("utm_term")),
    referrer: safeReferrer(document.referrer),
    landing_path: clean(window.location.pathname, 300),
    client_surface: clientSurface,
  };

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(acquisition));
  } catch {
    // Best effort only.
  }
  return acquisition;
}
