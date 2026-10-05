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

  let url: URL | null = null;
  try {
    const href = typeof window.location?.href === 'string' ? window.location.href : '';
    if (href) url = new URL(href, 'http://localhost');
  } catch {
    url = null;
  }

  let referrerHost: string | undefined;
  try {
    const referrer = typeof document !== 'undefined' ? document.referrer : '';
    referrerHost = referrer ? new URL(referrer, 'http://localhost').hostname : undefined;
  } catch {
    referrerHost = undefined;
  }

  const payload: OrderAttributionPayload = {
    utm_source: clean(url?.searchParams.get('utm_source')),
    utm_medium: clean(url?.searchParams.get('utm_medium')),
    utm_campaign: clean(url?.searchParams.get('utm_campaign')),
    utm_content: clean(url?.searchParams.get('utm_content')),
    referrer_host: clean(referrerHost, 255),
    landing_path: url ? clean(`${url.pathname}${url.search}`, 500) : undefined,
  };

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // A atribuição é auxiliar; nunca bloqueia o checkout.
  }
  return payload;
}
