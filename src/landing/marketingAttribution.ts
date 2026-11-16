/** Public marketing attribution. Never send raw URLs, UTMs, tokens or referrers to analytics. */
export type LandingTrafficSource = 'instagram' | 'facebook' | 'google' | 'bing' | 'cardapio_digital' | 'direct' | 'other';

const KNOWN_UTM_SOURCES = new Set<LandingTrafficSource>([
  'instagram', 'facebook', 'google', 'bing', 'cardapio_digital',
]);

function sourceFromReferrer(referrer: string): LandingTrafficSource {
  if (!referrer) return 'direct';
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'other';
    const host = url.hostname.toLowerCase();
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
    if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com') return 'facebook';
    if (host === 'bing.com' || host.endsWith('.bing.com')) return 'bing';
    if (['google.com', 'google.com.br', 'google.co.uk', 'google.pt']
      .some(domain => host === domain || host.endsWith('.' + domain))) return 'google';
    return 'other';
  } catch {
    return 'other';
  }
}

export function landingTrafficSource(search: string, referrer = ''): LandingTrafficSource {
  const raw = new URLSearchParams(search).get('utm_source')?.trim().toLowerCase();
  if (raw) return KNOWN_UTM_SOURCES.has(raw as LandingTrafficSource)
    ? raw as LandingTrafficSource : 'other';
  return sourceFromReferrer(referrer);
}

// Keep acquisition attribution across same-page hash navigation and opened dialogs.
// Never persist raw URLs, referrer strings, contact information or arbitrary UTMs.
let capturedSource: LandingTrafficSource | null = null;

export function currentLandingTrafficSource(): LandingTrafficSource {
  if (typeof window === 'undefined') return 'direct';
  if (capturedSource === null) capturedSource = landingTrafficSource(window.location.search, document.referrer);
  return capturedSource;
}
