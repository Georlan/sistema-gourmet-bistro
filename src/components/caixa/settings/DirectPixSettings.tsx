import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useState } from 'react';
import { authFetch, authRequestErrorMessage } from '../../../utils/authRequest';

type Props = {apiBaseUrl: string; authHeaders: Record<string,string>};
type Invoice = {id:string; period:string; fees:string; subscription_amount:string; total:string; status:string};
type InvoicePayment = {qrCode?:string; status:string; amount:string};
type Configuration = {available: boolean; enabled: boolean; key_type: string; pix_key: string; holder_name: string; city: string};
export function DirectPixSettings({apiBaseUrl,authHeaders}: Props) {
  const [config,setConfig] = useState<Configuration | null>(null);
  const [accepted,setAccepted] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [invoices,setInvoices] = useState<Invoice[]>([]);
  const [payment,setPayment] = useState<InvoicePayment | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/direct-pix/settings`,{headers:authHeaders});
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Não foi possível carregar o Pix direto.');
      setConfig(data); setAccepted(false);
      const invoicesResponse = await authFetch(`${apiBaseUrl}/payments/direct-pix/invoices`,{headers:authHeaders});
      if(invoicesResponse.ok) setInvoices(await invoicesResponse.json());
    } catch (error) {setMessage(authRequestErrorMessage(error,'Não foi possível carregar o Pix direto.'));}
  },[apiBaseUrl,authHeaders]);
  useEffect(() => {void load();},[load]);
  async function save(enabled: boolean) {
    if (!config || busy) return;
    setBusy(true); setMessage('');
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/direct-pix/settings`,{
        method:'PUT',headers:{...authHeaders,'Content-Type':'application/json'},
        body:JSON.stringify({...config,enabled,accept_manual_confirmation_and_monthly_fees:accepted}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Confira os dados da chave Pix.');
      setConfig(data);setAccepted(false);setMessage(enabled ? 'Pix direto ativado para novos pedidos.' : 'Pix direto desativado. Novos pedidos usarão o Mercado Pago conectado.');
    } catch(error) {setMessage(authRequestErrorMessage(error,'Não foi possível salvar.'));}
    finally {setBusy(false);}
  }
  async function payInvoice(id:string) {
    if(busy) return;
    setBusy(true);setMessage('');
    try {
      const response=await authFetch(`${apiBaseUrl}/payments/direct-pix/invoices/${id}/pix`,{method:'POST',headers:authHeaders});
      const data=await response.json();
      if(!response.ok) throw new Error(data.detail || 'Não foi possível gerar o pagamento da fatura.');
      setPayment(data);
      if(data.status==='approved') {await load();setMessage('Fatura paga.');}
    }catch(error){setMessage(authRequestErrorMessage(error,'Não foi possível gerar a cobrança.'));}
    finally{setBusy(false);}
  }
  const update = (key: keyof Configuration,value: string) => {if(config) {setConfig({...config,[key]:value});setAccepted(false);}};
  if (config && !config.available) return null;
  return <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-label="Pix direto na conta">
    <h3 className="text-sm font-black text-koma-foreground">Chave Pix própria {config?.enabled ? '· Em uso' : ''}</h3>
    <p className="mt-2 text-xs text-koma-muted">Receba na sua conta bancária. O atendente confere o extrato e confirma o pagamento antes de liberar o pedido. A taxa KÔMA dos pagamentos online será cobrada na fatura mensal, inclusive no plano anual.</p>
    {config && <><div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-koma-foreground">Tipo de chave<select className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page p-3" value={config.key_type} onChange={e=>update('key_type',e.target.value)}>{[['cpf','CPF'],['cnpj','CNPJ'],['phone','Celular'],['email','E-mail'],['random','Chave aleatória']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      {([['pix_key','Chave Pix',77],['holder_name','Nome do titular (até 25 caracteres)',25],['city','Cidade (até 15 caracteres)',15]] as const).map(([key,label,max])=><label key={key} className="text-xs text-koma-foreground">{label}<input className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page p-3" value={config[key]} maxLength={max} onChange={e=>update(key,e.target.value)} /></label>)}
    </div><label className="mt-4 flex items-start gap-2 text-xs text-koma-muted"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} /><span>Conferirei os recebimentos no extrato e aceito a cobrança mensal das taxas online. Pagamento na entrega continua sem taxa KÔMA.</span></label>
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || !accepted} onClick={()=>void save(true)} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Usar chave Pix própria'}</button>{config.enabled && <button type="button" disabled={busy} onClick={()=>void save(false)} className="min-h-11 rounded-xl border border-koma-border px-4 text-xs text-koma-foreground">Voltar ao Mercado Pago</button>}</div></>}
    {invoices.length>0 && <div className="mt-5 space-y-2"><h4 className="text-xs font-bold text-koma-foreground">Faturas de pagamentos online</h4>{invoices.map(invoice=><div key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-koma-border p-3 text-xs text-koma-foreground"><span>{invoice.period} · Mensalidade R$ {invoice.subscription_amount} + taxas R$ {invoice.fees} = R$ {invoice.total}</span>{invoice.status==='paid' ? <span>Paga</span> : <button type="button" disabled={busy} onClick={()=>void payInvoice(invoice.id)} className="min-h-11 rounded-lg border border-koma-border px-3">Pagar / conferir fatura</button>}</div>)}</div>}
    {payment?.qrCode && payment.status!=='approved' && <div className="mt-4 space-y-3"><QRCodeSVG value={payment.qrCode} size={208} marginSize={4}/><button type="button" className="min-h-11 rounded-lg border border-koma-border px-3 text-xs text-koma-foreground" onClick={()=>void navigator.clipboard.writeText(payment.qrCode || '')}>Copiar Pix da fatura</button><p className="text-xs text-koma-muted">Após pagar, use “Pagar / conferir fatura” para atualizar a situação.</p></div>}
    {message && <p role="status" className="mt-3 text-xs text-koma-foreground">{message}</p>}
  </section>;
}
