import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, MapPin, CheckCircle2, RefreshCw, Navigation, AlertCircle, ArrowUpRight, Sun, Moon, PackageCheck } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { formatWhatsAppPhone } from '../config/whatsappUtils';
import { KomaLogo } from './KomaLogo';
import { nextKomaTheme, persistKomaTheme, readKomaTheme, applyKomaTheme } from '../config/theme';
import './courier/courierPresentation.css';
interface EntregaItem {
  id: string;
  numero_pedido: number | null;
  cliente_nome: string;
  delivery_telefone: string | null;
  delivery_endereco: string | null;
  delivery_taxa: number;
  delivery_status: string;
  total: number;
  valor_pago: number;
  valor_a_cobrar: number;
  itens_resumo: string;
  criado_em: string | null;
}

interface MotoboyProfile {
  id: number;
  nome: string;
  telefone: string;
}

const DELIVERY_TOKEN_SESSION_KEY = 'koma_entregador_session_token';
const DELIVERY_TOKEN_HEADER = 'X-Koma-Delivery-Token';
const PANEL_REQUEST_TIMEOUT_MS = 12_000;
const CONFIRM_DELIVERY_REQUEST_TIMEOUT_MS = 12_000;

function bootstrapDeliveryToken(): string {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  const tokenFromFragment = hashParams.get('token')?.trim() || '';
  // Compatibilidade temporária para links antigos já enviados. O segredo é removido
  // antes de qualquer chamada de rede e nunca volta para query string da API.
  const legacyQueryToken = queryParams.get('token')?.trim() || '';
  const token = tokenFromFragment || legacyQueryToken || sessionStorage.getItem(DELIVERY_TOKEN_SESSION_KEY)?.trim() || '';

  if (tokenFromFragment || legacyQueryToken) {
    const canonicalPath = window.location.pathname.startsWith('/entregador')
      ? window.location.pathname
      : '/entregador';
    window.history.replaceState(null, '', canonicalPath);
  }
  if (token) {
    sessionStorage.setItem(DELIVERY_TOKEN_SESSION_KEY, token);
  }
  return token;
}

const RESUME_REFRESH_MIN_MS = 15_000;
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMoney = (value: number) => money.format(value);

export function MotoboyPwaPage() {
  const [token] = useState(bootstrapDeliveryToken);
  const [theme, setTheme] = useState(readKomaTheme);
  const [loading, setLoading] = useState(Boolean(token));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(token ? null : 'Abra o link de acesso enviado pelo caixa.');
  const [motoboy, setMotoboy] = useState<MotoboyProfile | null>(null);
  const [entregas, setEntregas] = useState<EntregaItem[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [uncertainId, setUncertainId] = useState<string | null>(null);
  const [filter, setFilter] = useState('todas');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const profileRef = useRef<MotoboyProfile | null>(null);
  const getRef = useRef<AbortController | null>(null);
  const postRef = useRef<AbortController | null>(null);
  const isConfirmingRef = useRef(false);
  const lastAttemptRef = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewConfirmRef = useRef<HTMLButtonElement>(null);
  const previousReviewRef = useRef<string | null>(null);

  useEffect(() => {
    if (reviewId) reviewConfirmRef.current?.focus();
    else if (previousReviewRef.current) document.getElementById(`courier-confirm-${previousReviewRef.current}`)?.focus();
    previousReviewRef.current = reviewId;
  }, [reviewId]);

  useEffect(() => { applyKomaTheme(theme); }, [theme]);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const carregarDadosPainel = useCallback(async (authToken: string, reconcile = false): Promise<boolean> => {
    if (getRef.current || (isConfirmingRef.current && !reconcile)) return false;
    const controller = new AbortController();
    getRef.current = controller;
    lastAttemptRef.current = Date.now();
    const timeoutId = window.setTimeout(() => controller.abort(), PANEL_REQUEST_TIMEOUT_MS);
    const isBackground = Boolean(profileRef.current);
    if (isBackground) setIsRefreshing(true);
    else { setLoading(true); setErrorMsg(null); }
    try {
      const res = await fetch(`${API_BASE_URL}/comandas/motoboys/painel-entregador`, {
        headers: { [DELIVERY_TOKEN_HEADER]: authToken }, signal: controller.signal,
      });
      if (getRef.current !== controller) return false;
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          profileRef.current = null; setMotoboy(null); setEntregas([]);
        }
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : 'Não foi possível atualizar as entregas.');
      }
      const data = await res.json();
      if (getRef.current !== controller) return false;
      if (!data.motoboy?.id || !Array.isArray(data.entregas)) throw new Error('Não foi possível conferir as entregas. Tente atualizar.');
      profileRef.current = data.motoboy;
      setMotoboy(data.motoboy); setEntregas(data.entregas);
      setErrorMsg(null); setUncertainId(null); setLastUpdated(Date.now());
      return true;
    } catch (err: any) {
      if (getRef.current !== controller) return false;
      const message = err?.name === 'AbortError'
        ? 'O painel demorou demais para responder. Tente novamente.'
        : err instanceof TypeError ? 'Sem conexão com o servidor. Tente atualizar.' : err.message || 'Não foi possível carregar as entregas.';
      if (isBackground && profileRef.current) showToast(message, 'error');
      else setErrorMsg(message);
      return false;
    } finally {
      window.clearTimeout(timeoutId);
      if (getRef.current === controller) {
        getRef.current = null; setLoading(false); setIsRefreshing(false);
      }
    }
  }, [showToast]);

  useEffect(() => {
    if (!token) return;
    void carregarDadosPainel(token);
    const resume = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastAttemptRef.current < RESUME_REFRESH_MIN_MS) return;
      void carregarDadosPainel(token);
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      getRef.current?.abort(); getRef.current = null;
      postRef.current?.abort(); postRef.current = null;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [token, carregarDadosPainel]);

  const handleConfirmarEntrega = async (comandaId: string) => {
    if (!token || isConfirmingRef.current || uncertainId) return;
    isConfirmingRef.current = true;
    // A GET started before this mutation must never restore a completed card.
    getRef.current?.abort(); getRef.current = null; setIsRefreshing(false);
    const controller = new AbortController();
    postRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), CONFIRM_DELIVERY_REQUEST_TIMEOUT_MS);
    setReviewId(null); setConfirmingId(comandaId);
    try {
      const res = await fetch(`${API_BASE_URL}/comandas/motoboys/pedidos/${comandaId}/confirmar-entrega`, {
        method: 'POST', headers: { [DELIVERY_TOKEN_HEADER]: token }, signal: controller.signal,
      });
      if (postRef.current !== controller) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : 'Não foi possível confirmar a entrega.');
      }
      setEntregas(prev => prev.filter(item => item.id !== comandaId));
      showToast('Entrega confirmada com sucesso.');
    } catch (err: any) {
      if (postRef.current !== controller) return;
      if (err?.name === 'AbortError' || err instanceof TypeError) {
        setUncertainId(comandaId);
        showToast('A confirmação demorou demais. Atualizando o painel antes de permitir nova tentativa.', 'error');
        await carregarDadosPainel(token, true);
      } else showToast(err.message || 'Não foi possível confirmar a entrega.', 'error');
    } finally {
      window.clearTimeout(timeoutId);
      if (postRef.current === controller) {
        postRef.current = null; isConfirmingRef.current = false; setConfirmingId(null);
      }
    }
  };

  const blocked = Boolean(confirmingId) || isRefreshing || Boolean(uncertainId);
  const visible = entregas.filter(item => filter === 'todas' || item.delivery_status === filter);
  const filters = [['todas', 'Todas'], ['transito', 'Em rota'], ['pronto', 'Retirada']];

  return <div className="k-courier">
    <header className="k-courier__header">
      <KomaLogo withText contextualWordmark={false} size="md" />
      <div className="k-courier__tools">
        <button type="button" className="k-courier__icon" aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'} onClick={() => setTheme(persistKomaTheme(nextKomaTheme(theme)))}>
          {theme === 'dark' ? <Sun aria-hidden="true" size={20} /> : <Moon aria-hidden="true" size={20} />}
        </button>
        {token && <button type="button" className="k-courier__icon" aria-label="Atualizar Pedidos" disabled={Boolean(confirmingId) || isRefreshing || loading} onClick={() => void carregarDadosPainel(token)}>
          <RefreshCw aria-hidden="true" size={20} className={isRefreshing ? 'k-courier__spin' : ''} />
        </button>}
      </div>
    </header>
    {toast && <div className={`k-courier__toast k-courier__toast--${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
      {toast.type === 'success' ? <CheckCircle2 size={19} aria-hidden="true" /> : <AlertCircle size={19} aria-hidden="true" />}<span>{toast.message}</span>
    </div>}
    <main className="k-courier__main">
      {loading ? <div className="k-courier__empty" role="status"><RefreshCw size={26} className="k-courier__spin" aria-hidden="true" /><h1>Carregando entregas</h1><p>Conferindo com o restaurante…</p></div>
        : errorMsg ? <div className="k-courier__empty"><AlertCircle size={32} aria-hidden="true" /><h1>{token ? 'Não foi possível abrir o painel' : 'Seu acesso às entregas'}</h1><p role="alert">{errorMsg}</p>{token && <button type="button" className="k-courier__action" onClick={() => void carregarDadosPainel(token)}>Tentar Novamente</button>}</div>
        : <>
          <div className="k-courier__intro">
            <div><p className="k-courier__name">{motoboy?.nome}</p><h1>Suas entregas <span>{entregas.length}</span></h1></div>
            <svg className="k-courier__art" viewBox="0 0 100 88" fill="none" aria-hidden="true"><path d="M8 68h23l19-34h24l17-22" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/><path d="m56 68 13-22 13 22-13 13Z" fill="currentColor" opacity=".45"/><circle cx="9" cy="68" r="6" fill="currentColor"/><path d="m79 10 13-2-2 13" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div className="k-courier__sync" role="status">{isRefreshing ? 'Atualizando…' : lastUpdated ? `Conferido às ${new Date(lastUpdated).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
          {uncertainId && <div className="k-courier__notice" role="alert"><span>Confirmação pendente. Confira o painel antes de tentar de novo.</span><button type="button" className="k-courier__secondary" disabled={isRefreshing || Boolean(confirmingId)} onClick={() => void carregarDadosPainel(token)}>Verificar</button></div>}
          {entregas.length > 0 && <nav className="k-courier__filters" aria-label="Filtrar entregas">{filters.map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setReviewId(null); }}>{label}<span>{value === 'todas' ? entregas.length : entregas.filter(item => item.delivery_status === value).length}</span></button>)}</nav>}
          {entregas.length === 0 ? <div className="k-courier__empty"><PackageCheck size={40} aria-hidden="true" /><h2>Tudo entregue</h2><p>Nenhuma entrega pendente no momento.</p></div>
            : visible.length === 0 ? <div className="k-courier__empty"><h2>Nenhuma entrega aqui</h2><button className="k-courier__secondary" type="button" onClick={() => setFilter('todas')}>Ver todas</button></div>
            : <div className="k-courier__list">{visible.map(entrega => {
              const cleanTel = formatWhatsAppPhone(entrega.delivery_telefone);
              const inRoute = entrega.delivery_status === 'transito';
              return <article key={entrega.id} className="k-courier__card" aria-label={`Pedido ${entrega.numero_pedido ?? 'sem número'}`}>
                <div className={`k-courier__card-head ${inRoute ? '' : 'k-courier__card-head--ready'}`}>
                  <div><span className="k-courier__order">{entrega.numero_pedido ? `#${entrega.numero_pedido}` : 'Sem número'}</span><h2>{entrega.cliente_nome}</h2></div>
                  <span className="k-courier__state">{inRoute ? <Navigation size={14} aria-hidden="true" /> : <PackageCheck size={14} aria-hidden="true" />}{inRoute ? 'Em rota' : entrega.delivery_status === 'pronto' ? 'Retirada' : 'A conferir'}</span>
                </div>
                <div className="k-courier__card-body">
                  <p className="k-courier__address"><MapPin size={19} aria-hidden="true" /><span>{entrega.delivery_endereco || 'Endereço não informado. Confira com o caixa.'}</span></p>
                  <div className="k-courier__contact">
                    {entrega.delivery_endereco && <a className="k-courier__secondary" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(entrega.delivery_endereco)}&dir_action=navigate`} target="_blank" rel="noopener noreferrer"><Navigation size={17} aria-hidden="true" />Abrir rota<ArrowUpRight size={15} aria-hidden="true" /></a>}
                    {cleanTel && <a className="k-courier__secondary" href={`tel:${cleanTel}`} aria-label={`Ligar para ${entrega.cliente_nome}`}><Phone size={17} aria-hidden="true" />Ligar</a>}
                  </div>
                  <div className={`k-courier__payment ${entrega.valor_a_cobrar > 0 ? '' : 'k-courier__payment--paid'}`}><span>{entrega.valor_a_cobrar > 0 ? 'Cobrar na entrega' : 'Sem cobrança'}</span><strong>{entrega.valor_a_cobrar > 0 ? formatMoney(entrega.valor_a_cobrar) : <CheckCircle2 size={21} aria-label="Sem valor pendente" />}</strong></div>
                  <details className="k-courier__details"><summary>Ver pedido</summary><p>{entrega.itens_resumo || 'Itens não informados'}</p><dl><div><dt>Total</dt><dd>{formatMoney(entrega.total)}</dd></div><div><dt>Já recebido</dt><dd>{formatMoney(entrega.valor_pago)}</dd></div><div><dt>Taxa de entrega</dt><dd>{formatMoney(entrega.delivery_taxa)}</dd></div></dl></details>
                  {reviewId === entrega.id ? <div className="k-courier__confirm" onKeyDown={event => { if (event.key === 'Escape') setReviewId(null); }} role="group" aria-label={`Confirmar entrega do pedido ${entrega.numero_pedido ?? 'sem número'}`}><p>Entregou este pedido ao cliente?</p><div><button type="button" className="k-courier__secondary" onClick={() => setReviewId(null)}>Voltar</button><button type="button" className="k-courier__action" ref={reviewConfirmRef} disabled={blocked} onClick={() => void handleConfirmarEntrega(entrega.id)}>Confirmar entrega</button></div></div>
                    : <button type="button" id={`courier-confirm-${entrega.id}`} className="k-courier__action" disabled={blocked} onClick={() => setReviewId(entrega.id)}>{confirmingId === entrega.id ? <><RefreshCw size={18} className="k-courier__spin" aria-hidden="true" />Confirmando…</> : <><CheckCircle2 size={18} aria-hidden="true" />Concluir entrega</>}</button>}
                </div>
              </article>;
            })}</div>}
        </>}
    </main>
  </div>;
}
