import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {QrCode,X,MessageCircle,ChevronRight,Check} from 'lucide-react';
import {buildWhatsAppContactUrl} from '../../../config/whatsappUtils';
import {authFetch,authRequestErrorMessage} from '../../../utils/authRequest';
import {formatCurrency} from '../cashierPresentation';
import {startPendingPixPolling} from './pendingPixPolling';
import './directPixPendingPanel.css';

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
      className="cashier-portal pix-conference"
      onCancel={event=>{if(busy)event.preventDefault();else setOpen(false);}}
      onClose={()=>{setOpen(false);triggerRef.current?.focus();}}
      onClick={event=>{if(event.target===event.currentTarget&&!busy)setOpen(false);}}>
      <section className="pix-conference__panel">
        <header className="pix-conference__header">
          <div><h2 id="pix-conference-title">Pix manual <span className="pix-conference__count">{rows.length}</span></h2>
            <p>Confira os recebimentos na conta bancária.</p></div>
          <button type="button" autoFocus disabled={busy} aria-label="Fechar conferência Pix" className="pix-conference__close" onClick={()=>setOpen(false)}><X size={20}/></button>
        </header>
        <div className="pix-conference__body">
          {!rows.length&&<p className="pix-conference__empty">Nenhum Pix pendente.</p>}
          {rows.length>1&&!selected&&<p className="pix-conference__hint">Selecione um pedido para conferir o Pix.</p>}
          <div className="pix-conference__list">{rows.map(row=>{
            const link=whatsappUrl(row);
            const isSelected=selected?.id===row.id;
            return <div key={row.id} className={'pix-conference__card'+(isSelected?' is-selected':'')}>
              <button type="button" aria-pressed={isSelected} disabled={busy} className="pix-conference__select" onClick={()=>select(row)}>
                <span className="pix-conference__identity"><strong>#{row.order_number} · {row.customer || 'Cliente'}</strong><span>{row.customer_phone || 'Sem telefone'}</span></span>
                <strong className="pix-conference__amount">{formatCurrency(Number(row.amount))}</strong>
                <span data-testid={'direct-pix-reported-'+row.id} className="pix-conference__status">
                  {row.released_unpaid?'Na operação · Pix pendente':row.customer_reported?'Cliente avisou que pagou':'Aguardando Pix'}
                </span>
                <span className="pix-conference__select-label">{isSelected?<><Check size={16} aria-hidden="true"/>Selecionado</>:<>Conferir pagamento<ChevronRight size={16} aria-hidden="true"/></>}</span>
              </button>
              {link&&<a href={link} target="_blank" rel="noopener noreferrer" className="pix-conference__whatsapp"><MessageCircle size={17} aria-hidden="true"/>Pedir comprovante no WhatsApp <span>(opcional)</span></a>}
            </div>;
          })}</div>
          {selected&&<div className="pix-conference__review">
            <div className="pix-conference__bank">
              <h3 className="pix-conference__eyebrow">Conferir pedido #{selected.order_number}</h3>
              <p className="pix-conference__help">Verifique {formatCurrency(Number(selected.amount))} no extrato. O comprovante sozinho não confirma o recebimento.</p>
              <label className="pix-conference__check">
                <input type="checkbox" className="pix-conference__checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>
                <span>Conferi o Pix na conta bancária</span>
              </label>
              <button type="button" disabled={busy||!checked} onClick={()=>void resolve('confirm')} className="pix-conference__primary">
                Confirmar Pix recebido
              </button>
            </div>
            {selected.released_unpaid
              ? <p className="pix-conference__notice">Pedido liberado para preparo. Pix ainda pendente.</p>
              : <div className="pix-conference__release">
                  <button type="button" disabled={busy} onClick={()=>void resolve('release-unpaid')} className="pix-conference__secondary">
                    Liberar preparo · conferir depois
                  </button>
                  <p className="pix-conference__help">Entra no Kanban. O Pix continua pendente.</p>
                </div>}
            <details className="pix-conference__cancel">
              <summary className="pix-conference__summary">Cancelar pedido</summary>
              <label className="pix-conference__check"><input type="checkbox" className="pix-conference__checkbox" checked={notReceived} onChange={e=>setNotReceived(e.target.checked)}/><span>Confirmei que não houve recebimento</span></label>
              <button type="button" disabled={busy||!notReceived} onClick={()=>void resolve('cancel')} className="pix-conference__danger">Cancelar pedido</button>
              <p className="pix-conference__help">Cancelar no KÔMA não invalida o QR no banco.</p>
            </details>
            {error&&<p role="alert" className="pix-conference__error">{error}</p>}
          </div>}
        </div>
      </section>
    </dialog>,document.body)}
  </>;
}
