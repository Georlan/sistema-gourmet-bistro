import { PagBankConnectionCard } from '../online-menu/PagBankConnectionCard';
import { MercadoPagoConnectionCard } from '../online-menu/MercadoPagoConnectionCard';

interface Props { apiBaseUrl: string; authHeaders: Record<string, string>; }
export function KomaPaymentsSettings({ apiBaseUrl, authHeaders }: Props) {
  return <section aria-labelledby="koma-payments-heading" className="space-y-4">
    <header>
      <h3 id="koma-payments-heading" className="text-lg font-bold text-koma-foreground">Pagamentos online</h3>
      <p className="mt-1 text-sm text-koma-muted">Conecte sua conta para receber Pix com confirmação automática.</p>
    </header>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <PagBankConnectionCard apiBaseUrl={apiBaseUrl} authHeaders={authHeaders}/>
      <MercadoPagoConnectionCard apiBaseUrl={apiBaseUrl} authHeaders={authHeaders}/>
    </div>
    <p className="text-xs text-koma-muted">O KÔMA não cobra taxa sobre suas vendas. Consulte as tarifas do banco conectado.</p>
  </section>;
}
