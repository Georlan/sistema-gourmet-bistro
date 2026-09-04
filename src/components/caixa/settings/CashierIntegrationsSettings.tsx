import { PlugZap } from 'lucide-react';
import React from 'react';
import { OperationalBanner } from '../../shared/OperationalBanner';
import { MercadoPagoConnectionCard } from '../online-menu/MercadoPagoConnectionCard';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

/** Technical integrations owner. Channel screens only consume integration status/capabilities. */
export function CashierIntegrationsSettings({ apiBaseUrl, authHeaders }: Props) {
  return (
    <div className="space-y-4">
      <OperationalBanner
        id="system-integrations-heading"
        eyebrow="SISTEMA"
        title="Integrações"
        accent="em um só lugar"
        description="Conexões técnicas ficam centralizadas aqui. As telas de venda usam apenas o status e as capacidades já conectadas."
        metrics={[
          { label: 'pagamentos online', value: 'Mercado Pago' },
          { label: 'configuração', value: 'por restaurante' },
        ]}
      />

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
            <PlugZap size={17} />
          </div>
          <div>
            <h3 className="text-sm font-black text-koma-foreground">Pagamentos e serviços externos</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
              Conecte e reconecte provedores aqui. Configurações específicas do Cardápio Online continuam no canal de vendas.
            </p>
          </div>
        </div>

        <MercadoPagoConnectionCard apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
      </section>
    </div>
  );
}
