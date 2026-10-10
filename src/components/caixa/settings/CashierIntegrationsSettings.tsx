import { FileCheck2, PlugZap } from 'lucide-react';
import React, { useState } from 'react';
import { KomaPaymentsSettings } from './KomaPaymentsSettings';
import { CashierFiscalSettings } from './CashierFiscalSettings';
import { RestaurantWhatsAppSettings } from './RestaurantWhatsAppSettings';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

type TechnicalSettingsTab = 'integrations' | 'fiscal';

/** Technical integrations owner. Channel screens only consume integration status/capabilities. */
export function CashierIntegrationsSettings({ apiBaseUrl, authHeaders }: Props) {
  const [activeTab, setActiveTab] = useState<TechnicalSettingsTab>('integrations');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-2xl border border-koma-border bg-koma-panel p-2" role="tablist" aria-label="Configurações técnicas">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'integrations'}
          onClick={() => setActiveTab('integrations')}
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold transition-colors ${
            activeTab === 'integrations'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              : 'border-transparent text-koma-muted hover:bg-koma-raised hover:text-koma-foreground'
          }`}
        >
          <PlugZap size={13} />
          Integrações
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'fiscal'}
          onClick={() => setActiveTab('fiscal')}
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold transition-colors ${
            activeTab === 'fiscal'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              : 'border-transparent text-koma-muted hover:bg-koma-raised hover:text-koma-foreground'
          }`}
        >
          <FileCheck2 size={13} />
          Fiscal
        </button>
      </div>

      {activeTab === 'fiscal' ? (
        <CashierFiscalSettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
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
