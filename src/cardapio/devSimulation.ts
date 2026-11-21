import { normalizeHexColor } from './theme/komaMenuTheme';

const HEX_COLOR_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function readSearch(searchOverride?: string): string {
  if (typeof searchOverride === 'string') return searchOverride;
  if (typeof window !== 'undefined' && window.location) {
    return window.location.search || '';
  }
  return '';
}

function readIsDev(devOverride?: boolean): boolean {
  if (typeof devOverride === 'boolean') return devOverride;
  return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
}

/**
 * Preview/dev runtime is strictly enabled only in Vite dev builds (`import.meta.env.DEV === true`).
 * Never relies on hostname alone so Playwright on 127.0.0.1 and production builds never leak simulated states.
 */
export function isDevPreviewRuntime(devOverride?: boolean): boolean {
  return readIsDev(devOverride);
}

/**
 * Forces open-store availability ONLY in dev mode when explicitly requested with `?simular=aberto`.
 */
export function isLocalOpenStoreSimulation(searchOverride?: string, devOverride?: boolean): boolean {
  if (!readIsDev(devOverride)) return false;
  const params = new URLSearchParams(readSearch(searchOverride));
  return params.get('simular') === 'aberto';
}

/**
 * Intercepts order submission into a local simulated receipt (#SIM-101) ONLY in dev mode
 * when explicitly opted in via `?simular=pedido` or `?simular=aberto`.
 */
export function isLocalOrderSimulation(searchOverride?: string, devOverride?: boolean): boolean {
  if (!readIsDev(devOverride)) return false;
  const mode = new URLSearchParams(readSearch(searchOverride)).get('simular');
  return mode === 'pedido' || mode === 'aberto';
}

/**
 * Allows `?cor=<hex>` preview override ONLY in dev builds (`import.meta.env.DEV === true`).
 * Returns null in production or when `?cor=` is absent/invalid so store settings remain authoritative.
 */
export function readDevBrandColorOverride(searchOverride?: string, devOverride?: boolean): string | null {
  if (!readIsDev(devOverride)) return null;
  const raw = new URLSearchParams(readSearch(searchOverride)).get('cor');
  if (!raw || !HEX_COLOR_RE.test(raw.trim())) return null;
  return normalizeHexColor(raw);
}
