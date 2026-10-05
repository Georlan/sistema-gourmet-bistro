export interface OrderAttributionPayload {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  referrer_host?: string;
  landing_path?: string;
}

const STORAGE_KEY = 'koma_order_attribution_v1';
const MAX_VALUE = 160;

const clean = (value: string | null | undefined, max = MAX_VALUE) => {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, max) : undefined;
};

export function captureOrderAttribution(): OrderAttributionPayload {
  if (typeof window === 'undefined') return {};
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as OrderAttributionPayload;
  } catch {
    // Navegadores privados podem bloquear sessionStorage.
  }

  const url = new URL(window.location.href);
  let referrerHost: string | undefined;
  try {
    referrerHost = document.referrer ? new URL(document.referrer).hostname : undefined;
  } catch {
    referrerHost = undefined;
  }

  const payload: OrderAttributionPayload = {
    utm_source: clean(url.searchParams.get('utm_source')),
    utm_medium: clean(url.searchParams.get('utm_medium')),
    utm_campaign: clean(url.searchParams.get('utm_campaign')),
    utm_content: clean(url.searchParams.get('utm_content')),
    referrer_host: clean(referrerHost, 255),
    landing_path: clean(`${url.pathname}${url.search}`, 500),
  };

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // A atribuição é auxiliar; nunca bloqueia o checkout.
  }
  return payload;
}
