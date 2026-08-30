import type { Order } from '../types';

/** Existing read contract from GET /atendimentos/mesas/{mesa_id}. */
export interface TableFamilySnapshot {
  familias?: Array<{
    numero_conta: number;
    lancamentos?: Array<{
      lancamento_id: string;
      pedido_id: string | null;
      sequencia: number | null;
      identity_status?: 'persisted' | 'missing';
    }>;
  }>;
}

export interface LaunchIdentity {
  displayNumber: string;
  sequence?: number;
}

export type LaunchIdentityMap = Record<string, LaunchIdentity>;

/** GET check details, including original launch identities on transferred items. */
export function readCheckLaunchIdentities(check: {
  lancamentos?: readonly { id: string; display_number?: string | null }[];
  itens?: readonly { lancamento_id: string; lancamento_display_number?: string | null }[];
}): LaunchIdentityMap {
  const identities: LaunchIdentityMap = Object.create(null);
  for (const launch of check.lancamentos || []) {
    const label = launch.display_number?.trim();
    if (label) identities[launch.id] = { displayNumber: label };
  }
  for (const item of check.itens || []) {
    const label = item.lancamento_display_number?.trim();
    if (label) identities[item.lancamento_id] = { displayNumber: label };
  }
  return identities;
}

/** Missing persisted identities stay missing; ordering never invents A/B/etc. */
export function buildLaunchIdentityMap(snapshot: TableFamilySnapshot): LaunchIdentityMap {
  const identities: LaunchIdentityMap = Object.create(null);
  for (const family of snapshot.familias || []) {
    for (const launch of family.lancamentos || []) {
      const launchId = launch.lancamento_id?.trim();
      const displayNumber = launch.pedido_id?.trim();
      if (!launchId || !displayNumber) continue;
      identities[launchId] = {
        displayNumber,
        ...(launch.sequencia !== null && launch.sequencia > 0
          ? { sequence: launch.sequencia }
          : {}),
      };
    }
  }
  return identities;
}

/** Presentation fallback remains the consumer's responsibility. */
export function getOrderDisplayNumber(order: Pick<Order, 'displayNumber'>): string | undefined {
  return order.displayNumber?.trim() || undefined;
}

/** Check identifiers and launch identifiers are never interchangeable. */
export function getOrderCheckId(order: Pick<Order, 'id' | 'checkId'> & { comandaId?: string }): string {
  return order.checkId || order.comandaId || order.id;
}
