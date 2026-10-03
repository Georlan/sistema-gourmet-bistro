import {useCallback,useEffect,useState} from 'react';
import {authFetch,authRequestErrorMessage} from '../../../utils/authRequest';
import {formatCurrency} from '../cashierPresentation';
type Pending = {id:string;order_number:string;customer:string;amount:string};
type Props = {apiBaseUrl:string;authHeaders:Record<string,string>;onRefreshOrders:()=>void};
export function DirectPixPendingPanel({apiBaseUrl,authHeaders,onRefreshOrders}:Props) {
  const [rows,setRows] = useState<Pending[]>([]);
  const [selected,setSelected] = useState<Pending|null>(null);
  const [reference,setReference] = useState('');
  const [checked,setChecked] = useState(false);
  const [notReceived,setNotReceived] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const load = useCallback(async()=>{
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/direct-pix/pending`,{headers:authHeaders});
      if (!response.ok) return;
      setRows(await response.json());
    } catch { /* Existing operational screens retain their own connectivity feedback. */ }
  },[apiBaseUrl,authHeaders]);
  useEffect(()=>{
    void load();
    const refresh = ()=>{if(document.visibilityState==='visible') void load();};
    const timer=window.setInterval(refresh,15000);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
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
      setSelected(null);setReference('');setChecked(false);await load();onRefreshOrders();
    }catch(err){setError(authRequestErrorMessage(err,'Não foi possível confirmar.'));}
    finally{setBusy(false);}
  }
  if(!rows.length && !selected) return null;
  return <section className="mb-4 rounded-xl border border-amber-500/30 bg-koma-panel p-4" aria-label="Pix aguardando conferência">
    <h3 className="text-sm font-bold text-koma-foreground">Pix aguardando conferência ({rows.length})</h3>
    <p className="mt-1 text-xs text-koma-muted">Confira o recebimento no extrato bancário. Comprovante enviado pelo cliente não confirma o pagamento.</p>
    <div className="mt-3 flex flex-wrap gap-2">{rows.map(row=><button type="button" key={row.id} className="min-h-11 rounded-lg border border-koma-border px-3 text-xs text-koma-foreground" onClick={()=>{setSelected(row);setNotReceived(false);setChecked(false);setReference('');setError('');}}>Pedido #{row.order_number} · {formatCurrency(Number(row.amount))}</button>)}</div>
    {selected && <div className="mt-4 space-y-3"><p className="text-sm text-koma-foreground">Pedido #{selected.order_number} · {selected.customer} · {formatCurrency(Number(selected.amount))}</p>
      <label className="block text-xs text-koma-foreground">Identificador do Pix no extrato (EndToEndId)<input className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page p-3" value={reference} maxLength={32} onChange={e=>setReference(e.target.value.trim())} /></label>
      <label className="flex gap-2 text-xs text-koma-muted"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>Conferi o valor integral recebido na conta correta.</label>
      <label className="flex gap-2 text-xs text-koma-muted"><input type="checkbox" checked={notReceived} onChange={e=>setNotReceived(e.target.checked)}/>Para cancelar: conferi que o pagamento não foi recebido.</label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !checked || !/^E[A-Za-z0-9]{31}$/.test(reference)} onClick={()=>void resolve(false)} className="min-h-11 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white disabled:opacity-50">Confirmar Pagamento Pix</button><button type="button" disabled={busy || !notReceived} onClick={()=>void resolve(true)} className="min-h-11 rounded-lg border border-koma-border px-3 text-xs text-koma-foreground">Cancelar pedido</button></div>
      <p className="text-xs text-koma-muted">Cancelar o pedido não invalida o QR no banco. Confira recebimentos tardios e devolva pelo aplicativo bancário se necessário.</p>
      {error && <p role="alert" className="text-xs text-koma-foreground">{error}</p>}
    </div>}
  </section>;
}
