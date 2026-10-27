import { clearOperatorSession } from './authSession';
import { COURIER_ACCESS_KEY, COURIER_ACCESS_META_KEY } from './courierAccessSession';

const TAB_ID = 'koma_auth_tab_id_v1';
const SAME_TAB_HANDOFF_KEY = 'koma_auth_tab_handoff_v1';
export const COURIER_COPIED_SESSION_DISCARDED_KEY = 'koma_entregador_copied_discarded_v1';

function discardCopiedAccess(): void {
  let hadCourierToken = false;
  try {
    hadCourierToken = Boolean(sessionStorage.getItem(COURIER_ACCESS_KEY));
  } catch { /* Blocked storage cannot restore access. */ }
  clearOperatorSession(undefined, false);
  for (const key of [COURIER_ACCESS_KEY, COURIER_ACCESS_META_KEY, SAME_TAB_HANDOFF_KEY, 'koma_support_session', 'authToken']) {
    try { sessionStorage.removeItem(key); } catch { /* Blocked storage cannot restore access. */ }
  }
  if (hadCourierToken) {
    try { sessionStorage.setItem(COURIER_COPIED_SESSION_DISCARDED_KEY, '1'); } catch { /* Optional hint only. */ }
  }
}

interface ActiveOwnershipRuntime {
  release: () => void;
  cleanup: () => void;
  holdPromise: Promise<unknown> | null;
}

const activeRuntimesByWindow = new WeakMap<object, ActiveOwnershipRuntime>();
let fallbackRuntime: ActiveOwnershipRuntime | null = null;

function getWindowTarget(): (EventTarget & object) | null {
  try {
    return typeof window !== 'undefined' && window ? window : null;
  } catch {
    return null;
  }
}

function getActiveRuntime(win: object | null): ActiveOwnershipRuntime | null {
  return win ? (activeRuntimesByWindow.get(win) ?? null) : fallbackRuntime;
}

function setActiveRuntime(win: object | null, runtime: ActiveOwnershipRuntime | null): void {
  if (win) {
    if (runtime) activeRuntimesByWindow.set(win, runtime);
    else activeRuntimesByWindow.delete(win);
  } else {
    fallbackRuntime = runtime;
  }
}

/** Releases the current document's tab lock before an explicit same-tab navigation
 * (e.g. login -> /entregador) so that even if the outgoing document enters BFCache,
 * the incoming document in the same tab immediately claims ownership without collision.
 */
export function releaseTabSessionOwnershipForNavigation(): void {
  try {
    const id = sessionStorage.getItem(TAB_ID);
    if (id) sessionStorage.setItem(SAME_TAB_HANDOFF_KEY, id);
  } catch { /* Ignore storage errors during navigation. */ }
  const currentRuntime = getActiveRuntime(getWindowTarget());
  if (currentRuntime) {
    currentRuntime.release();
  }
}

/** A native browser lock owns the tab identifier, never a token or user identity.
 * A copied sessionStorage keeps that identifier; an occupied lock means a new tab.
 * - While a tab is alive (including hidden/frozen in the background while the courier
 *   uses Google Maps), its document holds the Web Lock continuously so any duplicated
 *   tab with copied sessionStorage is deterministically rejected.
 * - When the tab is unloaded/discarded by the OS/browser (or hands off via explicit
 *   same-tab navigation), the lock is released so the restored or next same-tab
 *   document can reclaim its own tab session without false-positive wipe.
 * - If a BFCached document is restored via pageshow and its lock was released by the
 *   browser during BFCache residency, it re-acquires the lock for its tab.
 */
export async function initializeTabSessionOwnership(): Promise<void> {
  const win = getWindowTarget();
  const previousRuntime = getActiveRuntime(win);
  if (previousRuntime) {
    previousRuntime.cleanup();
    previousRuntime.release();
    setActiveRuntime(win, null);
  }

  let id: string;
  try {
    const existingId = sessionStorage.getItem(TAB_ID);
    id = existingId || crypto.randomUUID();
    sessionStorage.setItem(TAB_ID, id);
    sessionStorage.removeItem(SAME_TAB_HANDOFF_KEY);

    let locks: LockManager | undefined;
    try { locks = navigator.locks; } catch { discardCopiedAccess(); return; }
    if (!locks) {
      // An unsupported browser may sign in, but must not restore possibly copied access.
      discardCopiedAccess();
      return;
    }

    let releaseCurrentLock: (() => void) | null = null;
    let currentHoldPromise: Promise<unknown> | null = null;
    let claiming = false;

    const claim = (candidate: string) => new Promise<boolean>((resolve, reject) => {
      const requestPromise = locks.request(`koma-auth-tab:${candidate}`, { ifAvailable: true }, lock => {
        if (!lock) { resolve(false); return; }
        const hold = new Promise<void>(release => {
          let released = false;
          const doRelease = () => {
            if (released) return;
            released = true;
            if (releaseCurrentLock === doRelease) releaseCurrentLock = null;
            release();
          };
          releaseCurrentLock = doRelease;
          resolve(true);
        });
        currentHoldPromise = hold;
        return hold;
      });
      void requestPromise.catch(reject);
    });

    if (!(await claim(id))) {
      discardCopiedAccess();
      const freshId = crypto.randomUUID();
      id = freshId;
      sessionStorage.setItem(TAB_ID, freshId);
      await claim(freshId);
    }

    const reclaimLockOnBFCacheRestore = async () => {
      if (releaseCurrentLock || claiming) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      claiming = true;
      try {
        const currentId = sessionStorage.getItem(TAB_ID) || id;
        if (await claim(currentId)) {
          id = currentId;
          return;
        }
        discardCopiedAccess();
        const freshId = crypto.randomUUID();
        id = freshId;
        sessionStorage.setItem(TAB_ID, freshId);
        await claim(freshId);
      } catch {
        discardCopiedAccess();
      } finally {
        claiming = false;
      }
    };

    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return; // A cached document still owns its tab unless explicitly handed off.
      releaseCurrentLock?.();
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && !releaseCurrentLock) {
        void reclaimLockOnBFCacheRestore();
      }
    };

    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('pagehide', handlePageHide as EventListener);
      win.addEventListener('pageshow', handlePageShow as EventListener);
      setActiveRuntime(win, {
        release: () => { releaseCurrentLock?.(); },
        cleanup: () => {
          if (typeof win.removeEventListener === 'function') {
            win.removeEventListener('pagehide', handlePageHide as EventListener);
            win.removeEventListener('pageshow', handlePageShow as EventListener);
          }
        },
        holdPromise: currentHoldPromise,
      });
    } else {
      setActiveRuntime(win, {
        release: () => { releaseCurrentLock?.(); },
        cleanup: () => {},
        holdPromise: currentHoldPromise,
      });
    }
  } catch {
    discardCopiedAccess();
  }
}




