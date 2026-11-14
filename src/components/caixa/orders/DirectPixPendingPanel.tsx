import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {QrCode, X} from 'lucide-react';
import {authFetch,authRequestErrorMessage} from '../../../utils/authRequest';
import {formatCurrency} from '../cashierPresentation';
import {startPendingPixPolling} from './pendingPixPolling';
type Pending = {
  id: string;
  order_number: string;
  customer: string;
  amount: string;
  txid?: string | null;
  created_at?: string | null;
  customer_reported?: boolean;
  customer_reported_at?: string | null;
};
type Props = {apiBaseUrl:string;authHeaders:Record<string,string>;onRefreshOrders:()=>void};

export function normalizeDirectPixReference(raw: string): string {
  const match = raw.match(/(?:^|[^A-Za-z0-9])(E[A-Za-z0-9]{31})(?:[^A-Za-z0-9]|$)/);
  if (match?.[1]) return match[1];
  return raw.trim().slice(0, 32);
}

function formatShortTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
const PENDING_PIX_TTL_MS = 5000;
let recentPendingPixSnapshot: { key: string; rows: Pending[]; expiresAt: number } | null = null;

export function DirectPixPendingPanel({apiBaseUrl,authHeaders,onRefreshOrders}:Props) {
  const [open,setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog = dialogRef.current;
    if(open && dialog && !dialog.open) dialog.showModal();
    if(!open && dialog?.open) dialog.close();
  },[open]);
  const [rows,setRows] = useState<Pending[]>(() => {
    const key = `${apiBaseUrl}\u0000${authHeaders.Authorization || authHeaders.authorization || ''}`;
    if (recentPendingPixSnapshot && recentPendingPixSnapshot.key === key && recentPendingPixSnapshot.expiresAt > Date.now()) {
      return recentPendingPixSnapshot.rows;
    }
    return [];
  });
  const [selected,setSelected] = useState<Pending|null>(null);
  const [reference,setReference] = useState('');
  const [checked,setChecked] = useState(false);
  const [notReceived,setNotReceived] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const refreshPendingRef = useRef<(()=>void)|null>(null);
  const load = useCallback(async(signal:AbortSignal, force = false)=>{
    const key = `${apiBaseUrl}\u0000${authHeaders.Authorization || authHeaders.authorization || ''}`;
    if (!force && recentPendingPixSnapshot && recentPendingPixSnapshot.key === key && recentPendingPixSnapshot.expiresAt > Date.now()) {
      setRows(recentPendingPixSnapshot.rows);
      return recentPendingPixSnapshot.rows.length;
    }
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/direct-pix/pending`,{headers:authHeaders,signal});
      if (!response.ok) return;
      const pending:Pending[] = await response.json();
      if (signal.aborted) return;
      recentPendingPixSnapshot = { key, rows: pending, expiresAt: Date.now() + PENDING_PIX_TTL_MS };
      setRows(pending);
      return pending.length;
    } catch { /* Existing operational screens retain their own connectivity feedback. */ }
  },[apiBaseUrl,authHeaders]);
  useEffect(()=>{
    const polling=startPendingPixPolling(load);
    refreshPendingRef.current=polling.invalidate;
    return ()=>{
      polling.stop();
      if(refreshPendingRef.current===polling.invalidate) refreshPendingRef.current=null;
    };
  },[load]);
  async function resolve(cancel:boolean) {
    if(!selected || busy) return;
    setBusy(true);setError('');
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/direct-pix/${selected.id}/${cancel?'cancel':'confirm'}`,{
        method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},
        body:JSON.stringify(cancel ? {checked_no_receipt:notReceived} : {received_amount:selected.amount,bank_reference:reference,checked_bank_statement:checked}),
      });
      const data=await response.json();
      if(!response.ok) throw new Error(typeof data.detail==='string'?data.detail:'Confira a referência bancária.');
      setSelected(null);setReference('');setChecked(false);refreshPendingRef.current?.();onRefreshOrders();
    }catch(err){setError(authRequestErrorMessage(err,'Não foi possível confirmar.'));}
    finally{setBusy(false);}
  }
  if(!rows.length && !selected && !open) return null;
  return <>
    <button type="button" className="orders-new-orders orders-pix-conference" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}>
      <QrCode size={14} aria-hidden="true"/><span>Conferir Pix</span><span className="orders-new-orders__count">{rows.length}</span>
    </button>
    {createPortal(<dialog ref={dialogRef} aria-labelledby="pix-conference-title"
      className="cashier-portal fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none border-0 bg-black/60 p-0 text-koma-foreground open:flex"
      onCancel={event=>{if(busy) event.preventDefault(); else setOpen(false);}}
      onClose={()=>setOpen(false)} onClick={event=>{if(event.target===event.currentTarget && !busy) setOpen(false);}}>
      <section className="ml-auto flex h-full min-h-0 w-full max-w-sm flex-col border-l border-koma-border bg-koma-panel shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-koma-border px-4 py-3">
          <h2 id="pix-conference-title" className="text-sm font-bold">Pix aguardando conferência ({rows.length})</h2>
          <button type="button" autoFocus disabled={busy} aria-label="Fechar conferência Pix" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-koma-border bg-koma-raised" onClick={()=>setOpen(false)}><X size={18}/></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="text-xs text-koma-muted">Confira o recebimento no extrato bancário. Comprovante ou aviso do cliente não confirma o pagamento.</p>
          {!rows.length && <p className="mt-4 text-sm text-koma-muted">Nenhum Pix aguardando conferência.</p>}
    <div className="mt-3 flex flex-wrap gap-2">{rows.map(row => {
      const reportedTime = formatShortTime(row.customer_reported_at);
      return (
        <button
          type="button"
          key={row.id}
          className={`min-h-11 rounded-lg border px-3 py-1.5 text-left text-xs text-koma-foreground ${
            row.customer_reported
              ? 'border-emerald-500/60 bg-emerald-500/10'
              : 'border-koma-border'
          }`}
          onClick={() => {
            setSelected(row);
            setNotReceived(false);
            setChecked(false);
            setReference('');
            setError('');
          }}
        >
          <span className="block font-semibold">Pedido #{row.order_number} · {formatCurrency(Number(row.amount))}</span>
          {row.customer_reported && (
            <span data-testid={`direct-pix-reported-${row.id}`} className="mt-0.5 block text-[11px] font-bold text-emerald-400">
              Cliente informou o Pix{reportedTime ? ` · ${reportedTime}` : ''}
            </span>
          )}
        </button>
      );
    })}</div>
    {selected && <div className="mt-4 space-y-3">
      <div className="rounded-lg border border-koma-border bg-koma-page/60 p-3">
        <p className="text-sm font-semibold text-koma-foreground">Pedido #{selected.order_number} · {selected.customer} · {formatCurrency(Number(selected.amount))}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
          <span
            data-testid={`direct-pix-selected-status-${selected.id}`}
            className={selected.customer_reported ? 'font-bold text-emerald-400' : 'text-koma-muted'}
          >
            {selected.customer_reported ? 'Cliente informou o Pix' : 'Aguardando aviso do cliente'}
          </span>
          {selected.txid && <span className="font-mono text-koma-muted">Ref: {selected.txid}</span>}
        </div>
      </div>
      <label className="block text-xs text-koma-foreground">Identificador do Pix no extrato (EndToEndId)<input className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page p-3" value={reference} onChange={e=>setReference(normalizeDirectPixReference(e.target.value))} /></label>
      <label className="flex min-h-11 items-center gap-2 text-xs text-koma-muted"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>Conferi o valor integral recebido na conta correta.</label>
      <label className="flex min-h-11 items-center gap-2 text-xs text-koma-muted"><input type="checkbox" checked={notReceived} onChange={e=>setNotReceived(e.target.checked)}/>Para cancelar: conferi que o pagamento não foi recebido.</label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !checked || !/^E[A-Za-z0-9]{31}$/.test(reference)} onClick={()=>void resolve(false)} className="min-h-11 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white disabled:opacity-50">Confirmar Pagamento Pix</button><button type="button" disabled={busy || !notReceived} onClick={()=>void resolve(true)} className="min-h-11 rounded-lg border border-koma-border px-3 text-xs text-koma-foreground">Cancelar pedido</button></div>
      <p className="text-xs text-koma-muted">Cancelar o pedido não invalida o QR no banco. Confira recebimentos tardios e devolva pelo aplicativo bancário se necessário.</p>
      {error && <p role="alert" className="text-xs text-koma-foreground">{error}</p>}
    </div>}
        </div>
      </section>
    </dialog>,document.body)}
  </>;
}
