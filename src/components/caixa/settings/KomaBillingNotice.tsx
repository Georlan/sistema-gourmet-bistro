import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../../utils/authRequest';
type Billing = {status:string; open_total:string; due_at:string|null; new_sales_allowed:boolean; invoice_id:string|null};
export function KomaBillingNotice({apiBaseUrl,authHeaders,onOpenBilling}:{apiBaseUrl:string;authHeaders:Record<string,string>;onOpenBilling:(consolidated:boolean)=>void}) {
  const [billing,setBilling] = useState<Billing|null>(null);
  const load = useCallback(async()=>{
    try {
      const response=await authFetch(`${apiBaseUrl}/payments/direct-pix/billing-status`,{headers:authHeaders});
      if(response.ok) setBilling(await response.json());
    } catch { /* Do not replace financial state with a presumed successful payment. */ }
  },[apiBaseUrl,authHeaders]);
  useEffect(()=>{
    void load();
    const refresh=()=>{if(!document.hidden) void load();};
    const timer=window.setInterval(refresh,15*60*1000);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[load]);
  if(!billing || !['due_soon','overdue','restricted'].includes(billing.status)) return null;
  return <section role="status" aria-label="Cobrança KÔMA" className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-koma-panel p-4 text-sm text-koma-foreground">
    <div><strong>{billing.status==='restricted' ? 'Regularize a fatura para liberar novas vendas' : billing.status==='overdue' ? 'Sua fatura KÔMA venceu · tolerância de 3 dias' : 'Sua fatura KÔMA está próxima do vencimento'}</strong><p className="mt-1 text-xs text-koma-muted">{billing.invoice_id ? `${Number(billing.open_total).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} em faturas · ` : ''}Vencimento {billing.due_at ? new Date(billing.due_at).toLocaleDateString('pt-BR') : ''}. Faturas e histórico continuam disponíveis.</p></div>
    <button type="button" onClick={()=>onOpenBilling(Boolean(billing.invoice_id))} className="min-h-11 rounded-lg border border-koma-border px-4 text-xs font-bold">Ver fatura e pagar</button>
  </section>;
}
