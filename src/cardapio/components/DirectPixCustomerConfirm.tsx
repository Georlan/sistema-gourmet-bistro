import {useEffect,useState} from 'react';
import {Clock3,Loader2,Copy} from 'lucide-react';
import {API_BASE_URL} from '../../config/api';
import {type OrderPaymentStatus,type StoredOrder,reportDirectPixCustomerPayment} from '../orderTracking';

interface Props {
  order:Pick<StoredOrder,'id'|'numero_pedido'|'idempotency_key'|'tracking_token'|'tracking_url'|'pagamento'>;
  apiBaseUrl?:string;
  onReported?:(pagamento:OrderPaymentStatus)=>void;
}
const CLOSED=new Set(['approved','paid','cancelled','canceled','expired','rejected','refunded']);

export function DirectPixCustomerConfirm({order,apiBaseUrl=API_BASE_URL,onReported}:Props){
  const pagamento=order.pagamento;
  const reportedFromServer=Boolean(pagamento?.cliente_informou_pagamento);
  const [reported,setReported]=useState(reportedFromServer);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(false);

  useEffect(()=>{
    setReported(Boolean(pagamento?.cliente_informou_pagamento));
    setCopied(false);setError('');
  },[order.id,pagamento?.cliente_informou_pagamento]);

  const status=String(pagamento?.status||'').toLowerCase();
  if(!pagamento?.confirmacao_manual||CLOSED.has(status))return null;
  const canReport=Boolean(order.tracking_token?.trim()||order.tracking_url?.trim()||order.idempotency_key?.trim());
  const alreadyReported=reported||reportedFromServer;

  async function report(){
    if(busy||alreadyReported)return;
    setBusy(true);setError('');
    try{
      const next=await reportDirectPixCustomerPayment(order,apiBaseUrl);
      setReported(true);onReported?.(next);
    }catch(err){setError(err instanceof Error&&err.message.trim()?err.message:'Não foi possível avisar agora.');}
    finally{setBusy(false);}
  }

  return <div data-testid="direct-pix-customer-confirm" className="mt-3 space-y-2">
    <div className="flex items-center justify-between gap-3 rounded-xl border border-koma-border px-3 py-2">
      <div className="text-left"><span className="block text-[11px] text-koma-muted">Seu código</span><strong className="text-lg text-koma-foreground">#{order.numero_pedido}</strong></div>
      <button type="button" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-koma-border px-3 text-xs font-semibold text-koma-foreground" onClick={()=>{
        void navigator.clipboard.writeText('Pedido #'+order.numero_pedido).then(()=>setCopied(true)).catch(()=>setError('Copie o número exibido.'));
      }}><Copy size={14}/>{copied?'Copiado':'Copiar'}</button>
    </div>
    <p className="text-center text-xs text-koma-muted">
      {pagamento.preparo_liberado_sem_confirmacao
        ? 'Pedido liberado para preparo. Pix ainda pendente.'
        : 'Pode fechar esta tela. O restaurante já vê o pedido.'}
    </p>
    {alreadyReported
      ? <p role="status" data-testid="direct-pix-customer-reported-banner" className="flex items-center justify-center gap-2 text-xs font-semibold text-emerald-400"><Clock3 size={14}/> Aviso enviado ao restaurante</p>
      : canReport&&<button type="button" disabled={busy} data-testid="direct-pix-customer-report-btn" onClick={()=>void report()} className="min-h-10 w-full rounded-lg border border-koma-border px-3 text-xs font-semibold text-koma-foreground disabled:opacity-50">{busy?<><Loader2 className="mr-1 inline h-4 w-4 animate-spin"/>Avisando…</>:'Já paguei · avisar restaurante'}</button>}
    {error&&<p role="alert" className="text-center text-xs text-rose-300">{error}</p>}
  </div>;
}
