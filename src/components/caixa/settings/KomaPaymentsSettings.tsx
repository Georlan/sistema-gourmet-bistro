import { PagBankConnectionCard } from '../online-menu/PagBankConnectionCard';
import { DirectPixSettings } from './DirectPixSettings';
import { Landmark } from 'lucide-react';
import { MercadoPagoConnectionCard } from '../online-menu/MercadoPagoConnectionCard';

interface Props { apiBaseUrl: string; authHeaders: Record<string, string>; }
export function KomaPaymentsSettings({ apiBaseUrl, authHeaders }: Props) {
  return <div className="space-y-4">
    <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-labelledby="koma-payments-heading">
      <div className="flex items-start gap-3"><Landmark size={22} className="mt-1 shrink-0 text-emerald-500"/><div><h3 id="koma-payments-heading" className="text-base font-black text-koma-foreground">KÔMA Pagamentos · Recebimento das vendas</h3><p className="mt-2 text-sm leading-relaxed text-koma-muted">Escolha onde o restaurante recebe o Pix dos pedidos online. A cobrança da assinatura KÔMA aparece em uma fatura separada das suas vendas.</p></div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-koma-border p-4"><h4 className="text-sm font-bold text-koma-foreground">Minha chave Pix · conferência manual</h4><p className="mt-2 text-xs leading-relaxed text-koma-muted">O dinheiro chega à conta vinculada à chave. Um funcionário confere o extrato e libera o pedido. Cadastrar a chave não ativa confirmação automática.</p></div>
        <div className="rounded-xl border border-koma-border p-4"><h4 className="text-sm font-bold text-koma-foreground">Mercado Pago · confirmação automática</h4><p className="mt-2 text-xs leading-relaxed text-koma-muted">O provedor confirma o pagamento antes de liberar o pedido. Consulte as tarifas da sua conta Mercado Pago; o KÔMA não cobra taxa por venda.</p></div>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-koma-muted">O KÔMA não cobra taxa sobre suas vendas. Consulte as tarifas do provedor que você conectar. Cartão online ainda não está disponível.</p>
    </section>
    <PagBankConnectionCard apiBaseUrl={apiBaseUrl} authHeaders={authHeaders}/>
    <DirectPixSettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders}/>
    <MercadoPagoConnectionCard apiBaseUrl={apiBaseUrl} authHeaders={authHeaders}/>
  </div>;
}
