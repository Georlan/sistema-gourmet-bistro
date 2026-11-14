import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {QrCode, X, MessageCircle, Copy} from 'lucide-react';
import {buildWhatsAppContactUrl} from '../../../config/whatsappUtils';
import {authFetch,authRequestErrorMessage} from '../../../utils/authRequest';
import {formatCurrency} from '../cashierPresentation';
import {startPendingPixPolling} from './pendingPixPolling';
type Pending = {
  id: string;
  order_number: string;
  customer: string;
  customer_phone?: string | null;
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

export function isValidDirectPixBankReference(reference: string, txid?: string | null): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{5,31}$/.test(reference)
    && reference.toLowerCase() !== (txid || '').toLowerCase();
}

function pendingPixWhatsAppUrl(row: Pending): string {
  const base = buildWhatsAppContactUrl(row.customer_phone);
  if (!base) return '';
  const message = 'Olá! Sobre o Pix do pedido #' + row.order_number +
    ' (' + formatCurrency(Number(row.amount)) + '): pode nos enviar o comprovante para conferência? ' +
    'A liberação depende da verificação do recebimento no banco.';
  return base + '?text=' + encodeURIComponent(message);
}

function formatShortTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
export function DirectPixPendingPanel({apiBaseUrl,authHeaders,onRefreshOrders}:Props) {
  const [open,setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog = dialogRef.current;
    if(open && dialog && !dialog.open) dialog.showModal();
    if(!open && dialog?.open) dialog.close();
  },[open]);
  const [rows,setRows] = useState<Pending[]>([]);
  const [selected,setSelected] = useState<Pending|null>(null);
  const [reference,setReference] = useState('');
  const [checked,setChecked] = useState(false);
  const [notReceived,setNotReceived] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const refreshPendingRef = useRef<(()=>void)|null>(null);
  const load = useCallback(async(signal:AbortSignal)=>{
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/direct-pix/pending`,{headers:authHeaders,signal});
      if (!response.ok) return;
      const pending:Pending[] = await response.json();
      if (signal.aborted) return;
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

    <div className="mt-3 space-y-2">{rows.map(row => {
      const reportedTime = formatShortTime(row.customer_reported_at);
      const whatsappUrl = pendingPixWhatsAppUrl(row);
      return (
        <div key={row.id} className={'rounded-lg border p-2 ' + (row.customer_reported ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-koma-border')}>
          <button
            type="button"
            className="min-h-11 w-full rounded-md px-1 py-1 text-left text-xs text-koma-foreground"
            onClick={() => {
              setSelected(row);
              setNotReceived(false);
              setChecked(false);
              setReference('');
              setError('');
            }}
          >
            <span className="block font-semibold">Pedido #{row.order_number} · {formatCurrency(Number(row.amount))}</span>
            <span className="mt-1 block">{row.customer || 'Cliente não informado'}</span>
            {row.customer_phone && <span className="mt-0.5 block text-koma-muted">Tel.: {row.customer_phone}</span>}
            <span data-testid={'direct-pix-reported-' + row.id} className={'mt-1 block text-[11px] ' + (row.customer_reported ? 'font-bold text-emerald-400' : 'text-koma-muted')}>
              {row.customer_reported ? 'Cliente informou o Pix' + (reportedTime ? ' · ' + reportedTime : '') : 'Aguardando pagamento / conferência'}
            </span>
          </button>
          {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-600/50 px-2 text-xs text-emerald-300"><MessageCircle size={14}/> Solicitar comprovante pelo WhatsApp</a>}
        </div>
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
            {selected.customer_reported ? 'Cliente informou o Pix' : 'Aguardando pagamento / conferência'}
          </span>


        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
        <div><p className="text-[11px] text-koma-muted">Código para localizar e compartilhar</p><strong className="text-lg text-emerald-300">Pedido #{selected.order_number}</strong></div>
        <button type="button" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-koma-border px-2 text-xs" onClick={() => { void navigator.clipboard.writeText('Pedido #' + selected.order_number).catch(() => setError('Não foi possível copiar o número do pedido.')); }}><Copy size={14}/> Copiar</button>
      </div>
      {pendingPixWhatsAppUrl(selected) && <a href={pendingPixWhatsAppUrl(selected)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-emerald-500/40 px-3 text-xs text-emerald-300"><MessageCircle size={15}/> Solicitar comprovante no WhatsApp · {selected.customer_phone}</a>}
      <p className="text-xs text-koma-muted">O pedido já está nesta fila mesmo se o cliente fechar a página sem avisar. O comprovante não substitui a conferência no banco.</p>
      <label className="block text-xs text-koma-foreground">ID da transferência no extrato bancário
        <input className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page p-3" aria-label="Identificador do Pix no extrato (EndToEndId)" placeholder="EndToEndId ou número da operação do banco" value={reference} onChange={e=>setReference(normalizeDirectPixReference(e.target.value))} />
        <span className="mt-1 block text-[11px] text-koma-muted">Informe o ID do recebimento no banco (6–32 caracteres). Não use o código do pedido nem o TXID do QR.</span>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-xs text-koma-muted"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>Conferi o valor integral recebido na conta correta.</label>
      <label className="flex min-h-11 items-center gap-2 text-xs text-koma-muted"><input type="checkbox" checked={notReceived} onChange={e=>setNotReceived(e.target.checked)}/>Para cancelar: conferi que o pagamento não foi recebido.</label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !checked || !isValidDirectPixBankReference(reference,selected.txid)} onClick={()=>void resolve(false)} className="min-h-11 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white disabled:opacity-50">Confirmar Pagamento Pix</button><button type="button" disabled={busy || !notReceived} onClick={()=>void resolve(true)} className="min-h-11 rounded-lg border border-koma-border px-3 text-xs text-koma-foreground">Cancelar pedido</button></div>
      <p className="text-xs text-koma-muted">Cancelar o pedido não invalida o QR no banco. Confira recebimentos tardios e devolva pelo aplicativo bancário se necessário.</p>
      {error && <p role="alert" className="text-xs text-koma-foreground">{error}</p>}
    </div>}
        </div>
      </section>
    </dialog>,document.body)}
  </>;
}
