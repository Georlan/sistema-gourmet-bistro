import { useCallback, useSyncExternalStore } from 'react';
import { getOperatorSession, subscribeOperatorSession, type OperationalPortal } from '../../utils/authSession';

export function useOperatorSessionToken(portal?: OperationalPortal): string {
  const snapshot = useCallback(() => getOperatorSession(portal)?.token || '', [portal]);
  return useSyncExternalStore(subscribeOperatorSession, snapshot, () => '');
}
