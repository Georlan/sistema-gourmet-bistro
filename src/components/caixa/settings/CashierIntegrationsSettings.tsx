import React, { useMemo, useState } from 'react';
import { KomaPaymentsSettings } from './KomaPaymentsSettings';
import { CashierFiscalSettings } from './CashierFiscalSettings';
import { RestaurantWhatsAppSettings } from './RestaurantWhatsAppSettings';
import { CashierCustomerWhatsAppSettings } from './CashierCustomerWhatsAppSettings';

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
  const [activeIntegration, setActiveIntegration] = useState<"payments" | "whatsapp">("payments");
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
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tipos de integração">
            <button type="button" role="tab" aria-selected={activeIntegration === 'payments'}
              onClick={() => setActiveIntegration('payments')}
              className={`min-h-11 rounded-xl border px-5 py-2 text-xs font-bold transition-colors ${activeIntegration === 'payments'
                ? 'border-emerald-500/50 bg-emerald-500/10 text-koma-foreground'
                : 'border-koma-border bg-koma-panel text-koma-muted hover:text-koma-foreground'}`}>
              Pagamentos
            </button>
            <button type="button" role="tab" aria-selected={activeIntegration === 'whatsapp'}
              onClick={() => setActiveIntegration('whatsapp')}
              className={`min-h-11 rounded-xl border px-5 py-2 text-xs font-bold transition-colors ${activeIntegration === 'whatsapp'
                ? 'border-emerald-500/50 bg-emerald-500/10 text-koma-foreground'
                : 'border-koma-border bg-koma-panel text-koma-muted hover:text-koma-foreground'}`}>
              WhatsApp
            </button>
          </div>
          {activeIntegration === 'payments' ? (
            <div role="tabpanel" aria-label="Integrações de pagamento">
              <KomaPaymentsSettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
            </div>
          ) : (
            <div role="tabpanel" aria-label="Integrações de WhatsApp" className="space-y-4">
              <RestaurantWhatsAppSettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
              <CashierCustomerWhatsAppSettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
