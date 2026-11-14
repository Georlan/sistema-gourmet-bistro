/**
 * An old Vite entry can point at a hashed chunk removed by a new Pages deploy.
 * Recover a cold, untouched entry once. Never discard active cashier drafts
 * or payment work because a lazy navigation failed after the user interacted.
 */
const RELOAD_KEY = 'koma_chunk_recovery_build_v2';
export const INITIAL_ENTRY_WINDOW_MS = 12_000;

let entryStartedAt = 0;
let hasUserInteraction = false;
let installed = false;

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes('dynamically imported module')
    || message.includes('loading chunk')
    || message.includes('chunkloaderror')
    || message.includes('importing a module script failed');
}

export function shouldAutoRecoverChunkSkew({
  isChunkFailure,
  elapsedMs,
  interacted,
  online,
  currentBuild,
  lastAttemptedBuild,
}: {
  isChunkFailure: boolean;
  elapsedMs: number;
  interacted: boolean;
  online: boolean;
  currentBuild: string;
  lastAttemptedBuild: string | null;
}): boolean {
  return isChunkFailure
    && elapsedMs >= 0
    && elapsedMs <= INITIAL_ENTRY_WINDOW_MS
    && !interacted
    && online
    && Boolean(currentBuild)
    && lastAttemptedBuild !== currentBuild;
}

export function installChunkRecovery(): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;
  entryStartedAt = Date.now();
  // A click, keystroke or edit means there may be unsaved operational work.
  const markInteraction = () => { hasUserInteraction = true; };
  for (const type of ['pointerdown', 'keydown', 'input', 'submit']) {
    window.addEventListener(type, markInteraction, { capture: true, passive: true });
  }
}

export function reloadFreshAppEntry(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  // Force a new HTML navigation without touching session/authentication state.
  url.searchParams.set('__koma_refresh', String(Date.now()));
  window.location.replace(url.toString());
}

/**
 * Only cold, untouched entries reload on their own. On later lazy imports,
 * an error boundary must leave the operator in control of the reload.
 */
export function tryAutoRecoverChunkSkew(error: unknown): boolean {
  if (typeof window === 'undefined' || !isChunkLoadError(error)) return false;
  const build = (window as Window & {
    __KOMA_BUILD__?: { sha?: string; builtAt?: string };
  }).__KOMA_BUILD__;
  const buildIdentity = [build?.sha || '', build?.builtAt || ''].join(':');
  let attempted: string | null;
  try {
    attempted = window.sessionStorage.getItem(RELOAD_KEY);
  } catch {
    // Without durable per-tab suppression we could reload indefinitely.
    return false;
  }

  if (!shouldAutoRecoverChunkSkew({
    isChunkFailure: true,
    elapsedMs: Date.now() - entryStartedAt,
    interacted: hasUserInteraction,
    online: typeof navigator === 'undefined' || navigator.onLine !== false,
    currentBuild: buildIdentity === ':' ? '' : buildIdentity,
    lastAttemptedBuild: attempted,
  })) return false;

  try {
    window.sessionStorage.setItem(RELOAD_KEY, buildIdentity);
  } catch {
    return false;
  }
  reloadFreshAppEntry();
  return true;
}
