import React, { useMemo } from 'react';
import { KomaPaymentsSettings } from './KomaPaymentsSettings';
import { CashierFiscalSettings } from './CashierFiscalSettings';
import { RestaurantWhatsAppSettings } from './RestaurantWhatsAppSettings';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  section?: 'integrations' | 'fiscal';
}

/** Technical integrations owner. Channel screens only consume integration status/capabilities. */
export function CashierIntegrationsSettings({ apiBaseUrl, authHeaders, section = 'integrations' }: Props) {
  // Fiscal drafts and credentials belong to one authenticated API scope. A new
  // scope must get a fresh subtree; equivalent header objects preserve drafts.
  // The identity stays in memory only and is never rendered, logged or stored.
  const fiscalScopeKey = JSON.stringify([
    apiBaseUrl,
    [...new Headers(authHeaders).entries()].sort(([a], [b]) => a.localeCompare(b)),
  ]);
  const fiscalAuthHeaders = useMemo(
    () => ({ ...authHeaders }),
    [fiscalScopeKey],
  );

  return (
    <div className="space-y-4">
      {section === 'fiscal' ? (
        <CashierFiscalSettings key={fiscalScopeKey} apiBaseUrl={apiBaseUrl} authHeaders={fiscalAuthHeaders} />
      ) : (
        <>
          <KomaPaymentsSettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
          <details className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
            <summary className="cursor-pointer text-sm font-bold text-koma-foreground">WhatsApp · Avisos de pedidos</summary>
          <RestaurantWhatsAppSettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
          </details>
        </>
      )}
    </div>
  );
}
