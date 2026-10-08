import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Store, X } from 'lucide-react';
import { API_BASE_URL } from '../../config/api';
import { resetAnalytics } from '../../analytics';
import { getOperatorSession } from '../../utils/authSession';
import { authRequestErrorMessage } from '../../utils/authRequest';
import { authenticateStoreSwitch, canSwitchStore, commitStoreSwitch, type StoreOption, type StoreSwitchSession } from '../../utils/storeSwitch';

export function StoreSwitchButton() {
  const [open, setOpen] = useState(false);
  const session = getOperatorSession('caixa');
  if (!session || sessionStorage.getItem('koma_support_session')
    || String(session.user.id).startsWith('support:')
    || !canSwitchStore(session.user.role || session.user.cargo)) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} title="Trocar loja" aria-label="Trocar loja"
      className="flex w-full items-center gap-2 rounded-xl border border-koma-border bg-koma-raised/40 px-3 py-2.5 text-left text-xs font-bold text-koma-foreground hover:bg-koma-raised group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
      <Store size={16} className="shrink-0 text-koma-accent" />
      <span className="group-data-[collapsible=icon]:hidden">Trocar loja</span>
    </button>
    {open && createPortal(<StoreSwitchDialog sourceToken={session.token} currentStoreId={session.user.restaurante_id} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function StoreSwitchDialog({ sourceToken, currentStoreId, onClose }: { sourceToken: string; currentStoreId?: number; onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState('');
  const [candidate, setCandidate] = useState<StoreSwitchSession | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const originalToken = useRef(sourceToken);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      controller.current?.abort();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (candidate) dialog.current?.querySelector<HTMLButtonElement>('[data-confirm-store]')?.focus();
  }, [candidate]);

  function resetSelection() { setStores([]); setStoreId(''); setError(''); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (controller.current) return;
    setError(''); setBusy(true);
    const request = new AbortController();
    controller.current = request;
    try {
      const result = await authenticateStoreSwitch(`${API_BASE_URL}/auth/login`, {
        username, password, restaurantId: storeId ? Number(storeId) : undefined,
      }, request.signal);
      if (request.signal.aborted) return;
      if (result.kind === 'selection') {
        setStores(result.stores); setStoreId('');
      } else if (result.session.user.restaurante_id === currentStoreId) {
        setPassword(''); setError('Você já está nesta loja. Use o acesso de outra unidade.');
      } else {
        setCandidate(result.session); setPassword('');
      }
    } catch (err) {
      if (!request.signal.aborted) setError(authRequestErrorMessage(err, 'Não foi possível confirmar o acesso.'));
    } finally {
      if (!request.signal.aborted) { setBusy(false); controller.current = null; }
    }
  }
  function confirm() {
    if (!candidate || busy) return;
    try {
      commitStoreSwitch(candidate, originalToken.current);
    } catch (err) {
      setCandidate(null); resetSelection();
      setError(authRequestErrorMessage(err, 'Não foi possível trocar de loja.'));
      return;
    }
    setBusy(true);
    try { resetAnalytics(); } finally {
      // A fresh app owns the new token, requests and subscriptions. Never reuse old operational state.
      // Strip old login/pairing parameters; they belong to the previous store.
      window.location.replace('/?view=caixa');
    }
  }
  const fieldClass = 'w-full rounded-xl border border-koma-border bg-koma-panel px-3 py-3 text-sm text-koma-foreground';
  const destinationName = stores.find(store => store.id === candidate?.user.restaurante_id)?.nome;
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="store-switch-title"
      className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-koma-border bg-koma-card p-5 text-koma-foreground shadow-2xl"
      onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
        if (event.key === 'Tab') {
          const fields = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
          if (!fields?.length) return;
          const first = fields[0], last = fields[fields.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="store-switch-title" className="text-lg font-bold">Trocar loja</h2>
        <button type="button" onClick={onClose} aria-label="Fechar troca de loja" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-koma-raised"><X size={20} /></button>
      </div>
      {currentStoreId && <p className="mb-2 text-xs text-koma-secondary">Loja atual: #{currentStoreId}</p>}
      <p className="mb-4 text-sm text-koma-secondary">Confirme o acesso à outra unidade. Cada loja mantém seu caixa, pedidos, estoque e equipe separados.</p>
      {error && <p role="alert" className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {candidate ? <div className="space-y-4">
        <p className="text-sm font-semibold">Entrar em {destinationName || `Loja #${candidate.user.restaurante_id}`} como {candidate.user.nome}?</p>
        <p className="text-xs text-koma-secondary">O painel será recarregado. Alterações ainda não salvas nesta tela serão descartadas. O caixa da loja atual continuará como está.</p>
        <button type="button" data-confirm-store disabled={busy} onClick={confirm} className="min-h-11 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white">Confirmar troca</button>
      </div> : <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <div><label htmlFor="store-switch-email" className="mb-1 block text-xs font-bold">E-mail</label>
            <input id="store-switch-email" type="email" autoComplete="username" required value={username} onChange={event => { setUsername(event.target.value); resetSelection(); }} className={fieldClass} /></div>
          <div><label htmlFor="store-switch-password" className="mb-1 block text-xs font-bold">Senha</label>
            <input id="store-switch-password" type="password" autoComplete="current-password" required value={password} onChange={event => { setPassword(event.target.value); resetSelection(); }} className={fieldClass} /></div>
          {stores.length > 0 && <div><label htmlFor="store-switch-unit" className="mb-1 block text-xs font-bold">Loja de destino</label>
            <select id="store-switch-unit" required value={storeId} onChange={event => setStoreId(event.target.value)} className={fieldClass}>
              <option value="">Selecione a loja</option>
              {stores.map(store => <option key={store.id} value={store.id} disabled={store.id === currentStoreId}>{store.nome}{store.id === currentStoreId ? ' (atual)' : ''}</option>)}
            </select></div>}
          <button type="submit" disabled={busy || (stores.length > 0 && !storeId)} className="min-h-11 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Confirmando acesso…' : stores.length ? 'Acessar loja selecionada' : 'Confirmar acesso'}</button>
        </fieldset>
      </form>}
    </div>
  </div>;
}
