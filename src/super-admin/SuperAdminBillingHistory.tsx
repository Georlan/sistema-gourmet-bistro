import { useEffect, useState } from 'react';
import { superAdminFetch, superAdminErrorMessage } from './superAdminApi';
import type { Tenant } from './superAdminTypes';
type Invoice={id:string;period:string;subscription_amount:string;fees:string;total:string;status:string;due_at:string|null;paid_at:string|null};
const money=(value:string)=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function SuperAdminBillingHistory({tenant,onClose}:{tenant:Tenant;onClose:()=>void}) {
  const [rows,setRows]=useState<Invoice[]|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    superAdminFetch(`/api/super-admin/restaurantes/${encodeURIComponent(tenant.id)}/billing`,{signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok) throw new Error(data.detail || 'Histórico indisponível.');setRows(data.invoices);})
      .catch(err=>{if(!controller.signal.aborted)setError(superAdminErrorMessage(err));});
    return ()=>controller.abort();
  },[tenant.id]);
  return <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 p-3"><section role="dialog" aria-modal="true" aria-label="Histórico de cobrança KÔMA" className="max-h-[90dvh] w-full max-w-4xl overflow-auto rounded-2xl border border-koma-border bg-koma-panel p-5 text-koma-foreground"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Cobrança · {tenant.name}</h2><p className="mt-1 text-xs text-koma-muted">Últimas 24 competências. Os valores e as datas de pagamento preservam o histórico das faturas.</p></div><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-koma-border px-4 text-xs">Fechar</button></div>{error && <p role="alert" className="mt-4 text-sm">{error}</p>}{!rows&&!error&&<p role="status" className="mt-4 text-sm">Consultando histórico…</p>}{rows&&<div className="mt-4 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="py-3">Período</th><th>Mensalidade</th><th>Taxas</th><th>Total</th><th>Vencimento</th><th>Situação</th><th>Pago em</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} className="border-t border-koma-border"><td className="py-3">{row.period}</td><td>{money(row.subscription_amount)}</td><td>{money(row.fees)}</td><td>{money(row.total)}</td><td>{row.due_at?new Date(row.due_at).toLocaleDateString('pt-BR'):'Não definido'}</td><td>{row.status==='paid'?(Number(row.total)===0?'Sem valor a pagar':'Paga'):'Aberta'}</td><td>{row.paid_at?new Date(row.paid_at).toLocaleString('pt-BR'):'—'}</td></tr>)}</tbody></table>{!rows.length&&<p className="mt-3 text-sm text-koma-muted">Nenhuma fatura consolidada emitida. A situação da assinatura aparece na lista de restaurantes.</p>}</div>}</section></div>;
}
