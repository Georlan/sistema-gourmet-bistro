export const PENDING_DEEP_LINK_KEY = 'koma_pending_go';
export const KOMA_NAVIGATE_GO_EVENT = 'koma:navigate-go';

const DEEP_LINK_ID_PATTERN = /^[a-z0-9_]{2,48}$/;

/**
 * Validates only the safe identifier syntax without importing UI icons or heavy modules.
 * Semantic authorization (whitelist, role, entitlements, onboarding) lives in cashierDeepLink.ts.
 */
export function isValidDeepLinkSyntax(value: string | null | undefined): value is string {
  return typeof value === 'string' && DEEP_LINK_ID_PATTERN.test(value.trim());
}

export function parseDeepLinkGoSyntax(search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    const raw = params.get('go');
    if (!raw) return null;
    const normalized = raw.trim().toLowerCase();
    return isValidDeepLinkSyntax(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export function hasDeepLinkGoParam(search: string): boolean {
  try {
    return new URLSearchParams(search).has('go');
  } catch {
    return false;
  }
}

export function capturePendingDeepLink(search: string): string | null {
  if (!hasDeepLinkGoParam(search)) return peekPendingDeepLink();
  const parsed = parseDeepLinkGoSyntax(search);
  try {
    if (typeof sessionStorage === 'undefined') return parsed;
    if (parsed) {
      sessionStorage.setItem(PENDING_DEEP_LINK_KEY, parsed);
      return parsed;
    }
    sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
    return null;
  } catch {
    return parsed;
  }
}

export function peekPendingDeepLink(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
    const normalized = raw?.trim().toLowerCase() || '';
    return isValidDeepLinkSyntax(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export function consumePendingDeepLink(): string | null {
  const current = peekPendingDeepLink();
  clearPendingDeepLink();
  return current;
}

export function clearPendingDeepLink(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
    }
  } catch {
    // Storage may be blocked in restricted browser contexts.
  }
}

export function stripGoParamFromUrl(): void {
  if (typeof window === 'undefined' || !window.location) return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('go')) return;
    url.searchParams.delete('go');
    const nextSearch = url.searchParams.toString();
    const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  } catch {
    // Ignore invalid URL states.
  }
}
