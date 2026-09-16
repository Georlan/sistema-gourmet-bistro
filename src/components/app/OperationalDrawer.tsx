import {
  LEGACY_OPERATIONAL_DRAFTS_KEY,
} from './drafts/operationalDraftStorage';
import {
  OperationalDrawer as OperationalDrawerLegacy,
  type OperationalDrawerProps,
} from './OperationalDrawerLegacy';

export type { OperationalDrawerProps } from './OperationalDrawerLegacy';

/**
 * Security boundary for the operational drawer.
 *
 * The historical drawer still contains the old "Continuar pedidos" reader.
 * That reader used a tenant-less localStorage key, so stale data from another
 * restaurant is destroyed before the implementation executes. Tenant-scoped
 * drafts remain owned by useOperationalDrafts/operationalDraftStorage.
 */
export function OperationalDrawer(props: OperationalDrawerProps) {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem?.(LEGACY_OPERATIONAL_DRAFTS_KEY);
  }

  // Keep the historical direct-call contract used by lightweight unit tests.
  // The implementation is hook-free, so invoking it here does not create a
  // second component boundary or bypass React hook rules.
  return OperationalDrawerLegacy(props);
}
