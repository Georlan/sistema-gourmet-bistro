import { QRCodeSVG } from 'qrcode.react';
import { ONLINE_ORDER_COMMISSION_ENABLED } from '../../../config/subscriptionPlans';
import { useCallback, useEffect, useState } from 'react';
import { authFetch, authRequestErrorMessage } from '../../../utils/authRequest';

type Props = {apiBaseUrl: string; authHeaders: Record<string,string>};
type Invoice = {id:string; period:string; fees:string; subscription_amount:string; total:string; status:string; due_at?:string|null; items?: {order_number:string;amount:string;fee:string;method:string;confirmed_at:string}[]; has_more?:boolean};
type InvoicePayment = {qrCode?:string; status:string; amount:string};
type Configuration = {test_mode?: boolean; available: boolean; enabled: boolean; key_type: string; pix_key: string; holder_name: string; city: string; commercial?: {plan:string; billing_cycle:string; billing_amount:string; marketplace_rate:string} | null};
export function DirectPixSettings({apiBaseUrl,authHeaders}: Props) {
  const [config,setConfig] = useState<Configuration | null>(null);
  const [accepted,setAccepted] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [invoices,setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice,setSelectedInvoice] = useState<Invoice | null>(null);
  const money = (value:string) => Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
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
        body:JSON.stringify({key_type:config.key_type,pix_key:config.pix_key,holder_name:config.holder_name,city:config.city,enabled,accept_manual_confirmation_and_monthly_fees:accepted}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Confira os dados da chave Pix.');
      setConfig(current=>({...data,commercial:current?.commercial,test_mode:current?.test_mode}));setAccepted(false);setMessage(enabled ? 'Pix direto ativado para novos pedidos.' : 'Pix direto desativado. Novos pedidos usarão o Mercado Pago conectado.');
    } catch(error) {setMessage(authRequestErrorMessage(error,'Não foi possível salvar.'));}
    finally {setBusy(false);}
  }
  async function inspectInvoice(invoice:Invoice) {
    setSelectedInvoice(invoice);setPayment(null);setBusy(true);setMessage('');
    try {
      const response=await authFetch(`${apiBaseUrl}/payments/direct-pix/invoices/${invoice.id}`,{headers:authHeaders});
      const data=await response.json();
      if(!response.ok) throw new Error(data.detail || 'Não foi possível carregar os detalhes da fatura.');
      setSelectedInvoice(data);
    }catch(error){setMessage(authRequestErrorMessage(error,'Não foi possível carregar os detalhes.'));setSelectedInvoice(null);}
    finally{setBusy(false);}
  }
  async function loadMoreInvoice() {
    if(!selectedInvoice || busy) return;
    setBusy(true);
    try {
      const response=await authFetch(`${apiBaseUrl}/payments/direct-pix/invoices/${selectedInvoice.id}?offset=${selectedInvoice.items?.length || 0}`,{headers:authHeaders});
      const data=await response.json();
      if(!response.ok) throw new Error('Não foi possível carregar mais pagamentos.');
      setSelectedInvoice(current=>current ? {...current,items:[...(current.items || []),...data.items],has_more:data.has_more} : current);
    }catch(error){setMessage(authRequestErrorMessage(error,'Não foi possível carregar mais pagamentos.'));}
    finally{setBusy(false);}
  }
  async function payInvoice(id:string) {
    if(busy) return;
    setBusy(true);setMessage('');
    try {
      const response=await authFetch(`${apiBaseUrl}/payments/direct-pix/invoices/${id}/pix`,{method:'POST',headers:authHeaders});
      const data=await response.json();
      if(!response.ok) throw new Error(data.detail || 'Não foi possível gerar o pagamento da fatura.');
      setPayment(data);
      if(data.message) setMessage(data.message);
      if(data.status==='approved') {await load();setSelectedInvoice(null);setMessage('Fatura paga. O pagamento foi confirmado.');}
    }catch(error){setMessage(authRequestErrorMessage(error,'Não foi possível gerar a cobrança.'));}
    finally{setBusy(false);}
  }
  useEffect(()=>{
    if(!selectedInvoice || !payment?.qrCode || payment.status==='approved') return;
    const controller=new AbortController();
    let attempts=0;
    let inFlight=false;
    const check=async()=>{
      if(document.hidden || inFlight || attempts>=20) return;
      inFlight=true;attempts++;
      try {
        const response=await authFetch(`${apiBaseUrl}/payments/direct-pix/invoices/${selectedInvoice.id}/payment-status`,{headers:authHeaders,signal:controller.signal});
        if(!response.ok) return;
        const data=await response.json();
        if(controller.signal.aborted) return;
        if(data.status==='approved') {setPayment(null);setSelectedInvoice(null);setMessage('Fatura paga. O pagamento foi confirmado.');await load();}
        else if(['cancelled','rejected','expired'].includes(data.status)) {setPayment(null);setMessage('Esta cobrança foi encerrada pelo provedor. Gere um novo Pix para pagar.');}
      }catch { /* Manual recheck remains available after temporary connectivity failures. */ }
      finally{inFlight=false;}
    };
    const visible=()=>{if(!document.hidden) void check();};
    const timer=window.setInterval(()=>void check(),15000);
    document.addEventListener('visibilitychange',visible);
    return ()=>{controller.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[selectedInvoice,payment,apiBaseUrl,authHeaders,load]);
  const update = (key: keyof Configuration,value: string) => {if(config) {setConfig({...config,[key]:value});setAccepted(false);}};
  if (config && !config.available) return null;
  return <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-label="Pix direto na conta">
    <h3 className="text-base font-black text-koma-foreground">Receber na minha conta {config?.enabled ? '· Em uso' : ''}</h3>
    <p className="mt-2 text-sm leading-relaxed text-koma-muted">O consumidor paga pelo QR Code ou Copia e Cola. O dinheiro cai direto na conta vinculada à sua chave Pix.</p>
    <ol className="mt-4 grid gap-3 text-xs text-koma-muted sm:grid-cols-3"><li><strong className="block text-koma-foreground">1. Cadastre sua chave</strong>Informe os dados do titular que recebe as vendas.</li><li><strong className="block text-koma-foreground">2. Confira o recebimento</strong>O atendente confirma no extrato. Só então o pedido é liberado para atendimento.</li><li><strong className="block text-koma-foreground">3. Comissão KÔMA zero</strong>Os próximos recebimentos não geram comissão KÔMA; tarifas do banco ou provedor são separadas.</li></ol>
    {config?.test_mode && <p role="status" className="mt-4 rounded-xl border border-amber-500/30 p-3 text-sm text-koma-foreground">Loja liberada para teste de Pix próprio, sem contrato ou mensalidade habilitada. O QR movimenta dinheiro real para sua chave; a confirmação continua manual. A comissão KÔMA é zero e o teste não cria cobrança de assinatura.</p>}
    {config?.commercial && <div className="mt-4 rounded-xl border border-koma-border bg-koma-page p-3 text-sm text-koma-foreground"><p className="font-bold">Seu contrato · Plano {config.commercial.plan}</p><p className="mt-1">{['annual','anual'].includes(config.commercial.billing_cycle) ? 'Assinatura anual' : 'Mensalidade'}: {money(config.commercial.billing_amount)} · Taxa KÔMA registrada no aceite: {(Number(config.commercial.marketplace_rate)*100).toLocaleString('pt-BR',{maximumFractionDigits:4})}%</p><p className="mt-1 text-xs text-koma-muted">Comissão KÔMA efetiva: 0% nos próximos pagamentos online. O aceite original permanece preservado; tarifas do banco ou provedor são separadas.</p></div>}
    {config && <><h4 className="mt-5 text-sm font-bold text-koma-foreground">Dados para o QR Code das suas vendas</h4><div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-koma-foreground">Tipo de chave<select className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page p-3" value={config.key_type} onChange={e=>update('key_type',e.target.value)}>{[['cpf','CPF'],['cnpj','CNPJ'],['phone','Celular'],['email','E-mail'],['random','Chave aleatória']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      {([['pix_key','Chave Pix',77],['holder_name','Nome do titular (até 25 caracteres)',25],['city','Cidade (até 15 caracteres)',15]] as const).map(([key,label,max])=><label key={key} className="text-xs text-koma-foreground">{label}<input className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page p-3" value={config[key]} maxLength={max} onChange={e=>update(key,e.target.value)} /></label>)}
    </div><label className="mt-4 flex items-start gap-2 text-xs text-koma-muted"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} /><span>{config.test_mode ? 'Conferirei o recebimento real no extrato para liberar cada pedido de teste.' : 'Conferirei os recebimentos no extrato antes de confirmar. A comissão KÔMA é 0%; tarifas do banco ou provedor são separadas.'}</span></label>
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || !accepted || (ONLINE_ORDER_COMMISSION_ENABLED && !config.commercial && !config.test_mode)} onClick={()=>void save(true)} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Usar chave Pix própria'}</button>{config.enabled && <button type="button" disabled={busy} onClick={()=>void save(false)} className="min-h-11 rounded-xl border border-koma-border px-4 text-xs text-koma-foreground">Voltar ao Mercado Pago</button>}</div></>}
    {ONLINE_ORDER_COMMISSION_ENABLED && config && !config.commercial && !config.test_mode && <p className="mt-3 text-xs text-koma-muted">Finalize a assinatura e o aceite comercial para consultar a taxa do seu plano e ativar a chave própria.</p>}
    {invoices.length>0 && <div className="mt-5 space-y-2"><h4 className="text-xs font-bold text-koma-foreground">Faturas de pagamentos online</h4>{invoices.map(invoice=><div key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-koma-border p-3 text-xs text-koma-foreground"><span>{invoice.period} · Mensalidade R$ {invoice.subscription_amount} + taxas R$ {invoice.fees} = R$ {invoice.total}</span>{invoice.status==='paid' ? <span>{Number(invoice.total) === 0 ? 'Sem valor a pagar' : 'Paga'}</span> : <button type="button" disabled={busy} onClick={()=>void inspectInvoice(invoice)} className="min-h-11 rounded-lg border border-koma-border px-3">Ver fatura</button>}</div>)}</div>}
    {selectedInvoice && <div role="region" aria-label="Detalhes da fatura KÔMA" className="mt-4 rounded-xl border border-koma-border bg-koma-page p-4"><h4 className="text-sm font-bold text-koma-foreground">Confira sua fatura · {selectedInvoice.period}</h4><dl className="mt-3 space-y-2 text-sm text-koma-foreground"><div className="flex justify-between gap-3"><dt>Mensalidade do período</dt><dd>{money(selectedInvoice.subscription_amount)}</dd></div><div className="flex justify-between gap-3"><dt>Taxas de Pix online confirmados</dt><dd>{money(selectedInvoice.fees)}</dd></div><div className="flex justify-between gap-3 border-t border-koma-border pt-2 font-bold"><dt>Total a pagar ao KÔMA</dt><dd>{money(selectedInvoice.total)}</dd></div></dl>{selectedInvoice.due_at && <p className="mt-3 text-xs text-koma-muted">Vencimento: {new Date(selectedInvoice.due_at).toLocaleDateString('pt-BR')} · 3 dias de tolerância.</p>}{!!selectedInvoice.items?.length && <div className="mt-3 max-h-64 overflow-auto"><table className="w-full text-left text-xs text-koma-foreground"><thead><tr><th className="py-2">Pedido</th><th className="py-2">Pix recebido</th><th className="py-2">Taxa KÔMA</th></tr></thead><tbody>{selectedInvoice.items.map((item,index)=><tr key={`${item.order_number}-${index}`} className="border-t border-koma-border"><td className="py-2">#{item.order_number}</td><td>{money(item.amount)}</td><td>{money(item.fee)}</td></tr>)}</tbody></table>{selectedInvoice.has_more && <button type="button" disabled={busy} onClick={()=>void loadMoreInvoice()} className="mt-2 min-h-11 rounded-lg border border-koma-border px-3 text-xs text-koma-foreground">Carregar mais pagamentos</button>}</div>}<p className="mt-3 text-xs text-koma-muted">Cartão online ainda não está disponível. Esta fatura não inclui tarifas bancárias nem taxas já descontadas pelo Mercado Pago. O pagamento só é reconhecido após confirmação financeira.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>void payInvoice(selectedInvoice.id)} className="min-h-11 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Consultando…' : payment ? 'Conferir pagamento' : 'Gerar Pix desta fatura'}</button><button type="button" onClick={()=>{setSelectedInvoice(null);setPayment(null);}} className="min-h-11 rounded-lg border border-koma-border px-3 text-xs text-koma-foreground">Fechar detalhes</button></div></div>}
    {payment?.qrCode && payment.status!=='approved' && <div className="mt-4 space-y-3"><QRCodeSVG value={payment.qrCode} size={208} marginSize={4}/><button type="button" className="min-h-11 rounded-lg border border-koma-border px-3 text-xs text-koma-foreground" onClick={()=>void navigator.clipboard.writeText(payment.qrCode || '')}>Copiar Pix da fatura</button><p className="text-xs text-koma-muted">Este QR paga o KÔMA. A confirmação será atualizada automaticamente por até 5 minutos enquanto esta tela estiver aberta. Você também pode usar “Conferir pagamento”.</p></div>}
    {message && <p role="status" className="mt-3 text-xs text-koma-foreground">{message}</p>}
  </section>;
}
