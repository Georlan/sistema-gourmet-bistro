import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {QrCode,X,MessageCircle,Copy,ChevronDown} from 'lucide-react';
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

/** The optional bank ID is evidence, never the local order code or QR TXID. */
export function normalizeDirectPixReference(raw:string):string {
  const match=raw.match(/(?:^|[^A-Za-z0-9])(E[A-Za-z0-9]{31})(?:[^A-Za-z0-9]|$)/);
  return match?.[1] || raw.trim().slice(0,32);
}
export function isValidDirectPixBankReference(reference:string,txid?:string|null):boolean {
  return !reference.trim() || (/^[A-Za-z0-9][A-Za-z0-9._/-]{5,31}$/.test(reference)
    && reference.toLowerCase() !== (txid || '').toLowerCase());
}

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
  const [reference,setReference]=useState('');
  const [checked,setChecked]=useState(false);
  const [notReceived,setNotReceived]=useState(false);
  const [confirmUnpaidRelease,setConfirmUnpaidRelease]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const refreshPendingRef=useRef<(()=>void)|null>(null);

  useEffect(()=>{
    const dialog=dialogRef.current;
    if(open && dialog && !dialog.open) dialog.showModal();
    if(!open && dialog?.open) dialog.close();
  },[open]);

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
    setSelected(row);setReference('');setChecked(false);setNotReceived(false);
    setConfirmUnpaidRelease(false);setError('');
  };

  async function resolve(action:Resolution) {
    if(!selected||busy)return;
    setBusy(true);setError('');
    try {
      const body=action==='confirm'
        ? {received_amount:selected.amount,bank_reference:reference.trim() || null,checked_bank_statement:checked}
        : action==='cancel' ? {checked_no_receipt:notReceived}
        : {acknowledge_payment_pending:confirmUnpaidRelease};
      const response=await authFetch(`${apiBaseUrl}/payments/direct-pix/${selected.id}/${action}`,{
        method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify(body),
      });
      const payload=await response.json();
      if(!response.ok)throw new Error(typeof payload.detail==='string'?payload.detail:'Não foi possível atualizar o pedido.');
      if(action==='release-unpaid'){
        setSelected(current=>current?{...current,released_unpaid:true}:null);
        setConfirmUnpaidRelease(false);
      } else {
        setSelected(null);setChecked(false);setReference('');setNotReceived(false);
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
          <div className="space-y-2">{rows.map(row=>{
            const link=whatsappUrl(row);
            return <div key={row.id} className={'rounded-xl border p-3 '+(selected?.id===row.id?'border-emerald-500 bg-emerald-500/10':'border-koma-border')}>
              <button type="button" className="w-full text-left" onClick={()=>select(row)}>
                <span className="flex items-center justify-between gap-2"><strong className="text-sm">#{row.order_number} · {row.customer || 'Cliente'}</strong><strong className="text-sm tabular-nums">{formatCurrency(Number(row.amount))}</strong></span>
                <span className="mt-1 block text-xs text-koma-muted">{row.customer_phone || 'Sem telefone'}</span>
                <span data-testid={'direct-pix-reported-'+row.id} className={'mt-1 block text-xs '+(row.released_unpaid?'text-amber-300':row.customer_reported?'text-emerald-400':'text-koma-muted')}>
                  {row.released_unpaid?'Na operação · Pix pendente':row.customer_reported?'Cliente avisou que pagou':'Aguardando Pix'}
                </span>
              </button>
              {link&&<a href={link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg border border-koma-border px-3 text-xs text-emerald-300"><MessageCircle size={15}/> Pedir comprovante no WhatsApp</a>}
            </div>;
          })}</div>
          {selected&&<div className="space-y-3 border-t border-koma-border pt-3">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-base">Pedido #{selected.order_number}</strong>
              <button type="button" className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-koma-border px-2 text-xs" onClick={()=>{void navigator.clipboard.writeText('Pedido #'+selected.order_number).catch(()=>setError('Não foi possível copiar o número.'));}}><Copy size={14}/> Copiar</button>
            </div>
            <div className="space-y-2 rounded-xl border border-koma-border p-3">
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/> Conferi o recebimento no banco</label>
              <button type="button" disabled={busy||!checked||!isValidDirectPixBankReference(reference,selected.txid)} onClick={()=>void resolve('confirm')} className="min-h-11 w-full rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-emerald-950 disabled:opacity-40">Confirmar Pix recebido</button>
              <details className="text-xs text-koma-muted">
                <summary className="flex min-h-9 cursor-pointer items-center gap-1">ID bancário (opcional) <ChevronDown size={13}/></summary>
                <input aria-label="Identificador do Pix no extrato (EndToEndId)" className="mt-1 min-h-11 w-full rounded-lg border border-koma-border bg-koma-page p-2 text-koma-foreground" placeholder="EndToEndId ou referência do banco" value={reference} onChange={e=>setReference(normalizeDirectPixReference(e.target.value))}/>
              </details>
            </div>
            {!selected.released_unpaid&&<div className="space-y-2">
              {!confirmUnpaidRelease
                ? <button type="button" disabled={busy} className="min-h-11 w-full rounded-lg border border-amber-500/40 text-sm text-amber-200" onClick={()=>setConfirmUnpaidRelease(true)}>Liberar preparo sem receber</button>
                : <div className="space-y-2 rounded-lg border border-amber-500/40 p-3 text-sm">
                    <p className="text-amber-200">O pedido entrará no Kanban. O Pix continuará pendente no caixa.</p>
                    <button type="button" disabled={busy} className="min-h-11 w-full rounded-lg bg-amber-500 px-2 font-semibold text-amber-950" onClick={()=>void resolve('release-unpaid')}>Sim, liberar sem pagamento</button>
                    <button type="button" className="min-h-10 w-full text-koma-muted" onClick={()=>setConfirmUnpaidRelease(false)}>Voltar</button>
                  </div>}
            </div>}
            <details className="rounded-lg border border-koma-border px-3 py-2 text-xs text-koma-muted">
              <summary className="min-h-9 cursor-pointer py-2">Cancelar pedido</summary>
              <label className="mt-2 flex min-h-11 items-center gap-2"><input type="checkbox" checked={notReceived} onChange={e=>setNotReceived(e.target.checked)}/> Confirmei que não houve recebimento</label>
              <button type="button" disabled={busy||!notReceived} onClick={()=>void resolve('cancel')} className="mt-2 min-h-11 w-full rounded-lg border border-rose-600/50 text-sm text-rose-300 disabled:opacity-40">Cancelar pedido</button>
              <p className="mt-2">Cancelar no KÔMA não invalida o QR no banco.</p>
            </details>
            {error&&<p role="alert" className="text-xs text-rose-300">{error}</p>}
          </div>}
        </div>
      </section>
    </dialog>,document.body)}
  </>;
}
