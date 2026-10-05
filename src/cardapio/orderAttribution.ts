export interface OrderAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  referrer_host?: string;
  entry_path?: string;
  first_seen_at: string;
}

const PREFIX = 'koma_order_attribution_v1:';

function clean(value: string | null, max = 160): string | undefined {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, max) : undefined;
}

function storageKey(restaurantId: string | number): string {
  return `${PREFIX}${restaurantId}`;
}

function currentAttribution(): OrderAttribution {
  const url = new URL(window.location.href);
  let referrerHost: string | undefined;
  try {
    referrerHost = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : undefined;
  } catch {
    referrerHost = undefined;
  }
  return {
    utm_source: clean(url.searchParams.get('utm_source')),
    utm_medium: clean(url.searchParams.get('utm_medium')),
    utm_campaign: clean(url.searchParams.get('utm_campaign')),
    utm_content: clean(url.searchParams.get('utm_content')),
    utm_term: clean(url.searchParams.get('utm_term')),
    referrer_host: clean(referrerHost),
    entry_path: clean(`${url.pathname}${url.search}`, 240),
    first_seen_at: new Date().toISOString(),
  };
}

export function captureOrderAttribution(restaurantId: string | number): OrderAttribution {
  const key = storageKey(restaurantId);
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return JSON.parse(existing) as OrderAttribution;
    const attribution = currentAttribution();
    window.sessionStorage.setItem(key, JSON.stringify(attribution));
    return attribution;
  } catch {
    return currentAttribution();
  }
}

export function getOrderAttribution(restaurantId: string | number): OrderAttribution {
  return captureOrderAttribution(restaurantId);
}
