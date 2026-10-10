import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Store, X } from 'lucide-react';
import { API_BASE_URL } from '../../config/api';
import { resetAnalytics } from '../../analytics';
import { getOperatorSession } from '../../utils/authSession';
import { authRequestErrorMessage } from '../../utils/authRequest';
import { canSwitchStore, commitStoreSwitch, getStoreIndex, requestStoreSwitch, type StoreIndex, type StoreSwitchSession } from '../../utils/storeSwitch';

export function StoreSwitchButton() {
  const [open, setOpen] = useState(false);
  const session = getOperatorSession('caixa');
  if (!session || sessionStorage.getItem('koma_support_session') || String(session.user.id).startsWith('support:') || !canSwitchStore(session.user.role || session.user.cargo)) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} title="Minhas lojas" aria-label="Minhas lojas"
      className="flex w-full items-center gap-2 rounded-xl border border-koma-border bg-koma-raised/40 px-3 py-2.5 text-left text-xs font-bold text-koma-foreground hover:bg-koma-raised group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
      <Store size={16} className="shrink-0 text-koma-accent" /><span className="group-data-[collapsible=icon]:hidden">Minhas lojas</span>
    </button>
    {open && createPortal(<StoreSwitchDialog sourceToken={session.token} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function StoreSwitchDialog({ sourceToken, onClose }: { sourceToken: string; onClose: () => void }) {
  const [index, setIndex] = useState<StoreIndex | null>(null);
  const [candidate, setCandidate] = useState<StoreSwitchSession | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const originalToken = useRef(sourceToken);
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { controller.current?.abort(); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setError('');
    getStoreIndex(API_BASE_URL, originalToken.current, request.signal)
      .then(data => { if (!request.signal.aborted) setIndex(data); })
      .catch(err => { if (!request.signal.aborted) setError(authRequestErrorMessage(err, 'Não foi possível consultar suas lojas.')); })
      .finally(() => { if (!request.signal.aborted) { setBusy(false); controller.current = null; } });
    return () => request.abort();
  }, [retry]);
  useEffect(() => { if (candidate) dialog.current?.querySelector<HTMLButtonElement>('[data-confirm-store]')?.focus(); }, [candidate]);

  async function selectUnit(id: number) {
    if (controller.current || !index?.units.some(unit => unit.id === id)) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError('');
    try {
      const session = await requestStoreSwitch(API_BASE_URL, originalToken.current, id, request.signal);
      if (!request.signal.aborted) setCandidate(session);
    } catch (err) {
      if (!request.signal.aborted) { setError(authRequestErrorMessage(err, 'Não foi possível acessar esta unidade.')); setIndex(null); }
    } finally {
      if (!request.signal.aborted) { setBusy(false); controller.current = null; }
    }
  }
  function confirm() {
    if (!candidate || busy) return;
    try { commitStoreSwitch(candidate, originalToken.current); }
    catch (err) { setCandidate(null); setIndex(null); setError(authRequestErrorMessage(err, 'Não foi possível trocar de loja.')); return; }
    setBusy(true);
    try { resetAnalytics(); } finally { window.location.replace('/?view=caixa'); }
  }
  const destination = index?.units.find(unit => unit.id === candidate?.user.restaurante_id);
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="store-switch-title"
      className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-koma-border bg-koma-card p-5 text-koma-foreground shadow-2xl"
      onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
        if (event.key === 'Tab') {
          const fields = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
          if (!fields?.length) return;
          const first = fields[0], last = fields[fields.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="store-switch-title" className="text-lg font-bold">Minhas lojas</h2>
        <button type="button" onClick={onClose} aria-label="Fechar minhas lojas" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-koma-raised"><X size={20} /></button>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {busy && <p role="status" className="py-3 text-sm text-koma-secondary">Consultando unidades autorizadas…</p>}
      {!busy && !index && <button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-11 w-full rounded-xl border border-koma-border px-4 py-3 text-sm font-bold">Tentar novamente</button>}
      {index && !candidate && !busy && <div className="space-y-4">
        <div className="rounded-xl border border-koma-border bg-koma-panel p-3"><span className="text-xs text-koma-secondary">Loja atual</span><p className="mt-1 font-bold">{index.current.nome}</p></div>
        {!index.network ? <div>
          <p className="text-sm font-bold">Loja independente</p>
          <p className="mt-2 text-sm text-koma-secondary">Esta loja ainda não está vinculada a uma rede. Para operar outras unidades, solicite ao suporte KÔMA o cadastro da rede e dos seus acessos.</p>
        </div> : <>
          <p className="text-sm font-semibold">Rede {index.network.nome}</p>
          {index.units.length ? <>
            <p className="text-xs text-koma-secondary">Escolha uma unidade autorizada. Caixa, pedidos, estoque e equipe continuam separados por loja.</p>
            <div className="space-y-2">{index.units.map(unit => <button key={unit.id} type="button" onClick={() => void selectUnit(unit.id)} className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-koma-border bg-koma-panel px-4 py-3 text-left text-sm font-bold hover:border-emerald-500"><Store size={18} />{unit.nome}</button>)}</div>
          </> : <p className="text-sm text-koma-secondary">Você ainda não tem acesso autorizado a outra unidade desta rede. Solicite a liberação ao suporte KÔMA.</p>}
        </>}
      </div>}
      {candidate && !busy && <div className="space-y-4">
        <p className="text-sm font-semibold">Entrar em {destination?.nome || 'outra unidade'}?</p>
        <p className="text-xs text-koma-secondary">O painel será recarregado. Alterações não salvas serão descartadas. O caixa da loja atual continuará como está.</p>
        <button type="button" data-confirm-store onClick={confirm} className="min-h-11 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white">Confirmar troca</button>
        <button type="button" onClick={() => setCandidate(null)} className="min-h-11 w-full rounded-xl border border-koma-border px-4 py-3 text-sm font-bold">Voltar às unidades</button>
      </div>}
    </div>
  </div>;
}
