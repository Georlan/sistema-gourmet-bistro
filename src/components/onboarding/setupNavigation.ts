import { useEffect, useRef } from 'react';

// Navigation context only; readiness always comes from the onboarding API.
const SETUP_MODE_KEY = 'koma_onboarding_setup_mode';

export function isInitialSetup(): boolean {
  try { return sessionStorage.getItem(SETUP_MODE_KEY) === '1'; } catch { return false; }
}

export function returnToInitialSetup() {
  try { sessionStorage.removeItem(SETUP_MODE_KEY); } catch { /* Navigation works without storage. */ }
  window.location.href = '/ativar?resume=1';
}

export function useUnsavedSetupChanges(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirty) return;
    const preventDiscard = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventDiscard);
    return () => window.removeEventListener('beforeunload', preventDiscard);
  }, [dirty]);
  return () => { dirtyRef.current = false; };
}
