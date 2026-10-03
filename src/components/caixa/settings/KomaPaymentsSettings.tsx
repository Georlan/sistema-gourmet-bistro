import { DirectPixSettings } from './DirectPixSettings';
import { Landmark, Percent, ShieldCheck } from 'lucide-react';
import { MercadoPagoConnectionCard } from '../online-menu/MercadoPagoConnectionCard';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

const PROVIDER_REFERENCES = [
  {
    name: 'Mercado Pago',
    status: 'Disponível',
    online: 'Pix online: 0,99%',
    inPerson: 'QR Pix presencial: 0,49%',
    note: 'Tarifas do provedor são adicionais à taxa KÔMA contratada.',
  },
] as const;

export function KomaPaymentsSettings({ apiBaseUrl, authHeaders }: Props) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-labelledby="koma-payments-heading">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <Landmark size={18} />
          </div>
          <div className="min-w-0">
            <h3 id="koma-payments-heading" className="text-sm font-black text-koma-foreground">KÔMA Pagamentos</h3>
            <p className="mt-1.5 max-w-3xl text-[10px] leading-relaxed text-koma-muted">
              Escolha como o restaurante recebe pagamentos processados pelo KÔMA. A taxa KÔMA contratada incide apenas sobre pagamentos online. Dinheiro e cartão na entrega não têm taxa KÔMA; tarifas bancárias são cobradas separadamente pelo provedor quando existirem.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {PROVIDER_REFERENCES.map((provider) => (
            <article key={provider.name} className="rounded-xl border border-koma-border bg-koma-raised/45 p-3">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-xs text-koma-foreground">{provider.name}</strong>
                <span className="rounded-full border border-koma-border px-2 py-1 text-[8px] font-black uppercase tracking-wider text-koma-subtle">
                  {provider.status}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-[10px] text-koma-muted sm:grid-cols-2">
                <span>{provider.online}</span>
                <span>{provider.inPerson}</span>
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-koma-subtle">{provider.note}</p>
            </article>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-koma-border bg-koma-page/50 px-3 py-2.5 text-[9px] leading-relaxed text-koma-muted">
          <Percent size={13} className="mt-0.5 shrink-0" />
          <span>
            As porcentagens dos provedores são referências públicas e podem mudar. A taxa KÔMA aplicável é a que está congelada no aceite comercial do restaurante.
          </span>
        </div>

        <div className="mt-3 flex items-start gap-2 text-[9px] leading-relaxed text-koma-subtle">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          <span>O dinheiro é processado e liquidado pelo provedor escolhido; o KÔMA não funciona como carteira para guardar saldo do restaurante.</span>
        </div>
      </section>

      <DirectPixSettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
      <MercadoPagoConnectionCard apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
    </div>
  );
}
