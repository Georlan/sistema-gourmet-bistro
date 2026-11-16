import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {QrCode,X,MessageCircle} from 'lucide-react';
import {buildWhatsAppContactUrl} from '../../../config/whatsappUtils';
import {authFetch,authRequestErrorMessage} from '../../../utils/authRequest';
import {formatCurrency} from '../cashierPresentation';
import {startPendingPixPolling} from './pendingPixPolling';

type Pending = {
  id:string;
  order_number:string;
  customer:string;
  customer_phone?:string|null;
  amount:string;
  txid?:string|null;
  customer_reported?:boolean;
  customer_reported_at?:string|null;
  released_unpaid?:boolean;
};
type Props = {apiBaseUrl:string;authHeaders:Record<string,string>;onRefreshOrders:()=>void};
type Resolution = 'confirm'|'release-unpaid'|'cancel';

function whatsappUrl(row:Pending):string {
  const phone=buildWhatsAppContactUrl(row.customer_phone);
  if(!phone) return '';
  return phone+'?text='+encodeURIComponent(
    'Olá! Sobre o Pix do pedido #'+row.order_number+' ('+formatCurrency(Number(row.amount))+
    '), pode enviar o comprovante? Vamos conferir o recebimento no banco.'
  );
}

const PENDING_PIX_TTL_MS=5000;
let recentPendingPixSnapshot:{key:string;rows:Pending[];expiresAt:number}|null=null;

export function DirectPixPendingPanel({apiBaseUrl,authHeaders,onRefreshOrders}:Props) {
  const [open,setOpen]=useState(false);
  const dialogRef=useRef<HTMLDialogElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);
  const [rows,setRows]=useState<Pending[]>(()=>{
    const key=apiBaseUrl+String.fromCharCode(0)+(authHeaders.Authorization||authHeaders.authorization||'');
    return recentPendingPixSnapshot&&recentPendingPixSnapshot.key===key&&recentPendingPixSnapshot.expiresAt>Date.now()
      ? recentPendingPixSnapshot.rows : [];
  });
  const [selected,setSelected]=useState<Pending|null>(null);
  const [checked,setChecked]=useState(false);
  const [notReceived,setNotReceived]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const refreshPendingRef=useRef<(()=>void)|null>(null);

  useEffect(()=>{
    const dialog=dialogRef.current;
    if(open && dialog && !dialog.open) dialog.showModal();
    if(!open && dialog?.open) dialog.close();
  },[open]);

  useEffect(()=>{
    if(open && !selected && rows.length===1){
      setSelected(rows[0]);
      setChecked(false);
      setNotReceived(false);
      setError('');
    }
  },[open,selected,rows]);

  const load=useCallback(async(signal:AbortSignal,force=false)=>{
    const key=apiBaseUrl+String.fromCharCode(0)+(authHeaders.Authorization||authHeaders.authorization||'');
    if(!force&&recentPendingPixSnapshot&&recentPendingPixSnapshot.key===key&&recentPendingPixSnapshot.expiresAt>Date.now()){
      setRows(recentPendingPixSnapshot.rows);
      return recentPendingPixSnapshot.rows.length;
    }
    try {
      const response=await authFetch(`${apiBaseUrl}/payments/direct-pix/pending`,{headers:authHeaders,signal});
      if(!response.ok) return;
      const pending:Pending[]=await response.json();
      if(signal.aborted) return;
      recentPendingPixSnapshot={key,rows:pending,expiresAt:Date.now()+PENDING_PIX_TTL_MS};
      setRows(pending);
      setSelected(previous=>previous ? pending.find(row=>row.id===previous.id) || null : null);
      return pending.length;
    } catch { /* Connectivity indicator remains owned by the cashier shell. */ }
  },[apiBaseUrl,authHeaders]);

  useEffect(()=>{
    const polling=startPendingPixPolling(load);
    refreshPendingRef.current=polling.invalidate;
    return ()=>{
      polling.stop();
      if(refreshPendingRef.current===polling.invalidate)refreshPendingRef.current=null;
    };
  },[load]);

  const select=(row:Pending)=>{
    setSelected(row);setChecked(false);setNotReceived(false);setError('');
  };

  async function resolve(action:Resolution) {
    if(!selected||busy)return;
    setBusy(true);setError('');
    try {
      const body=action==='confirm'
        ? {received_amount:selected.amount,bank_reference:null,checked_bank_statement:checked}
        : action==='cancel' ? {checked_no_receipt:notReceived}
        : {acknowledge_payment_pending:true};
      const response=await authFetch(`${apiBaseUrl}/payments/direct-pix/${selected.id}/${action}`,{
        method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify(body),
      });
      const payload=await response.json();
      if(!response.ok)throw new Error(typeof payload.detail==='string'?payload.detail:'Não foi possível atualizar o pedido.');
      if(action==='release-unpaid'){
        setSelected(current=>current?{...current,released_unpaid:true}:null);
      } else {
        setSelected(null);setChecked(false);setNotReceived(false);
      }
      refreshPendingRef.current?.();onRefreshOrders();
    }catch(err){setError(authRequestErrorMessage(err,'Não foi possível atualizar o pedido.'));}
    finally{setBusy(false);}
  }

  if(!rows.length&&!selected&&!open)return null;
  return <>
    <button ref={triggerRef} type="button" className="orders-new-orders orders-pix-conference" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}>
      <QrCode size={14} aria-hidden="true"/><span>Conferir Pix</span><span className="orders-new-orders__count">{rows.length}</span>
    </button>
    {createPortal(<dialog ref={dialogRef} aria-labelledby="pix-conference-title"
      className="cashier-portal fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none border-0 bg-black/60 p-0 text-koma-foreground open:flex"
      onCancel={event=>{if(busy)event.preventDefault();else setOpen(false);}}
      onClose={()=>{setOpen(false);triggerRef.current?.focus();}}
      onClick={event=>{if(event.target===event.currentTarget&&!busy)setOpen(false);}}>
      <section className="ml-auto flex h-full min-h-0 w-full max-w-sm flex-col border-l border-koma-border bg-koma-panel shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-koma-border px-4 py-3">
          <h2 id="pix-conference-title" className="text-base font-semibold">Pix manual ({rows.length})</h2>
          <button type="button" autoFocus disabled={busy} aria-label="Fechar conferência Pix" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-koma-border bg-koma-raised" onClick={()=>setOpen(false)}><X size={18}/></button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {!rows.length&&<p className="text-sm text-koma-muted">Nenhum Pix pendente.</p>}
          <div className="space-y-2.5">{rows.map(row=>{
            const link=whatsappUrl(row);
            const isSelected=selected?.id===row.id;
            const statusTone=row.released_unpaid
              ? 'border-amber-500/35 bg-amber-500/10 text-amber-200'
              : row.customer_reported
                ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'
                : 'border-koma-border bg-koma-raised text-koma-muted';
            const dotTone=row.released_unpaid
              ? 'bg-amber-400'
              : row.customer_reported
                ? 'bg-emerald-400'
                : 'bg-koma-muted';
            return <div key={row.id} className={'rounded-xl border p-3.5 transition-colors '+(isSelected?'border-emerald-500 bg-emerald-500/10':'border-koma-border bg-koma-raised/40')}>
              <button type="button" className="w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-lg" onClick={()=>select(row)}>
                <span className="flex items-start justify-between gap-2">
                  <strong className="min-w-0 break-words text-sm font-bold text-koma-foreground">#{row.order_number} · {row.customer || 'Cliente'}</strong>
                  <strong className="shrink-0 text-sm font-bold tabular-nums text-emerald-300">{formatCurrency(Number(row.amount))}</strong>
                </span>
                <span className="mt-1 block text-xs text-koma-muted">{row.customer_phone || 'Sem telefone'}</span>
                <span data-testid={'direct-pix-reported-'+row.id} className={'mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold '+statusTone}>
                  <span className={'h-1.5 w-1.5 shrink-0 rounded-full '+dotTone} aria-hidden="true"/>
                  {row.released_unpaid?'Na operação · Pix pendente':row.customer_reported?'Cliente avisou que pagou':'Aguardando Pix'}
                </span>
              </button>
              {link&&<a href={link} target="_blank" rel="noopener noreferrer" className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"><MessageCircle size={15} aria-hidden="true"/> Pedir comprovante no WhatsApp <span className="font-normal text-emerald-300/80">(opcional)</span></a>}
            </div>;
          })}</div>
          {selected&&<div className="space-y-3 border-t border-koma-border pt-3.5">
            <div className="space-y-2.5 rounded-xl border border-koma-border bg-koma-raised/50 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-koma-muted">Conferência bancária · #{selected.order_number}</p>
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1 text-sm font-medium text-koma-foreground">
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-emerald-500" checked={checked} onChange={e=>setChecked(e.target.checked)}/>
                <span>Conferi o Pix na conta bancária</span>
              </label>
              <button type="button" disabled={busy||!checked} onClick={()=>void resolve('confirm')} className="min-h-11 w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-emerald-950 shadow-sm transition-colors hover:bg-emerald-400 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-500/20 disabled:text-emerald-200/50 disabled:shadow-none">
                Confirmar Pix recebido
              </button>
            </div>
            {selected.released_unpaid
              ? <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-200">Pedido liberado para preparo. Pix ainda pendente.</p>
              : <div className="space-y-1.5">
                  <button type="button" disabled={busy} onClick={()=>void resolve('release-unpaid')} className="min-h-11 w-full rounded-xl border border-amber-400/50 bg-amber-500/10 px-3 py-2.5 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-40">
                    Liberar preparo · conferir depois
                  </button>
                  <p className="text-center text-xs text-koma-muted">Entra no Kanban. O Pix continua pendente.</p>
                </div>}
            <details className="rounded-xl border border-koma-border px-3 py-2 text-xs text-koma-muted">
              <summary className="min-h-10 cursor-pointer py-2 font-medium text-koma-foreground/80">Cancelar pedido</summary>
              <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2.5 text-koma-foreground"><input type="checkbox" className="h-4 w-4 shrink-0 accent-rose-500" checked={notReceived} onChange={e=>setNotReceived(e.target.checked)}/><span>Confirmei que não houve recebimento</span></label>
              <button type="button" disabled={busy||!notReceived} onClick={()=>void resolve('cancel')} className="mt-2 min-h-11 w-full rounded-xl border border-rose-500/50 bg-rose-500/10 px-3 text-sm font-semibold text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40">Cancelar pedido</button>
              <p className="mt-2">Cancelar no KÔMA não invalida o QR no banco.</p>
            </details>
            {error&&<p role="alert" className="text-xs font-medium text-rose-300">{error}</p>}
          </div>}
        </div>
      </section>
    </dialog>,document.body)}
  </>;
}
