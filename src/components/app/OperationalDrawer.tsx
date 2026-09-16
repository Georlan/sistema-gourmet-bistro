import React from 'react';
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
 * The legacy drawer still contains the historical "Continuar pedidos" reader.
 * That reader used a tenant-less localStorage key, so stale data from another
 * restaurant must be destroyed before the legacy implementation can render.
 * Tenant-scoped drafts remain owned by useOperationalDrafts/operationalDraftStorage.
 */
export function OperationalDrawer(props: OperationalDrawerProps) {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(LEGACY_OPERATIONAL_DRAFTS_KEY);
  }

  return <OperationalDrawerLegacy {...props} />;
}
