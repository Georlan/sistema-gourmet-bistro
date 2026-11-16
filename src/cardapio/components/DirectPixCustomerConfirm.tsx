import {useEffect,useState} from 'react';
import {CheckCircle2,Clock3,Loader2} from 'lucide-react';
import {API_BASE_URL} from '../../config/api';
import {type OrderPaymentStatus,type StoredOrder,reportDirectPixCustomerPayment} from '../orderTracking';

interface Props {
  order:Pick<StoredOrder,'id'|'idempotency_key'|'tracking_token'|'tracking_url'|'pagamento'>;
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

  useEffect(()=>{
    setReported(Boolean(pagamento?.cliente_informou_pagamento));
    setError('');
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

  return <div data-testid="direct-pix-customer-confirm" className="mt-4 space-y-2.5 border-t border-koma-border/70 pt-3">
    <p className="text-center text-xs leading-relaxed text-koma-muted">
      {pagamento.preparo_liberado_sem_confirmacao
        ? 'Pedido liberado para preparo. Pix ainda pendente.'
        : 'O restaurante já recebeu seu pedido. Você pode fechar esta tela.'}
    </p>
    {alreadyReported
      ? <p role="status" data-testid="direct-pix-customer-reported-banner" className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300"><Clock3 size={15} aria-hidden="true"/> Restaurante avisado · aguardando conferência</p>
      : canReport&&<button type="button" disabled={busy} data-testid="direct-pix-customer-report-btn" onClick={()=>void report()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-emerald-400/70 bg-emerald-500/20 px-4 py-3 text-sm font-bold text-emerald-100 shadow-sm shadow-black/30 transition-colors hover:border-emerald-300 hover:bg-emerald-500/30 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">{busy?<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true"/>Avisando…</> : <><CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden="true"/>Já paguei</>}</button>}
    {error&&<p role="alert" className="text-center text-xs text-rose-300">{error}</p>}
  </div>;
}
