import { clearOperatorSession } from './authSession';

const TAB_ID = 'koma_auth_tab_id_v1';

function discardCopiedAccess(): void {
  clearOperatorSession(undefined, false);
  for (const key of ['koma_entregador_session_token', 'koma_support_session', 'authToken']) {
    try { sessionStorage.removeItem(key); } catch { /* Blocked storage cannot restore access. */ }
  }
}

/** A native browser lock owns the tab identifier, never a token or user identity.
 * A copied sessionStorage keeps that identifier; an occupied lock means a new tab.
 * No polling, server request, shared credential or cross-tab logout is involved.
 */
export async function initializeTabSessionOwnership(): Promise<void> {
  let id: string;
  try {
    id = sessionStorage.getItem(TAB_ID) || crypto.randomUUID();
    sessionStorage.setItem(TAB_ID, id);
  } catch { discardCopiedAccess(); return; }

  let locks: LockManager | undefined;
  try { locks = navigator.locks; } catch { discardCopiedAccess(); return; }
  if (!locks) {
    // An unsupported browser may sign in, but must not restore possibly copied access.
    discardCopiedAccess();
    return;
  }

  const claim = (candidate: string) => new Promise<boolean>((resolve, reject) => {
    void locks.request(`koma-auth-tab:${candidate}`, { ifAvailable: true }, lock => {
      if (!lock) { resolve(false); return; }
      return new Promise<void>(release => {
        const leave = (event: PageTransitionEvent) => {
          if (event.persisted) return; // A cached document still owns its tab.
          window.removeEventListener('pagehide', leave);
          release();
        };
        window.addEventListener('pagehide', leave);
        resolve(true);
      });
    }).catch(reject);
  });

  try {
    if (await claim(id)) return;
    discardCopiedAccess();
    const freshId = crypto.randomUUID();
    sessionStorage.setItem(TAB_ID, freshId);
    await claim(freshId);
  } catch {
    discardCopiedAccess();
  }
}
