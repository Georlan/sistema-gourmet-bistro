import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, CheckCircle2, RefreshCw, AlertCircle, Sun, Moon, PackageCheck, ArrowUp, ArrowDown, Store, WifiOff, ListOrdered, LocateFixed } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { KomaLogo } from './KomaLogo';
import { nextKomaTheme, persistKomaTheme, readKomaTheme, applyKomaTheme } from '../config/theme';
import './courier/courierPresentation.css';
import { useCourierTrip } from './courier/useCourierTrip';
import { CourierRideArtwork } from './courier/CourierRideArtwork';
import { useCourierAutoOrder } from './courier/useCourierAutoOrder';
import { createCourierSnapshotCache } from './courier/courierSnapshotCache';
import { useCourierRealtime } from './courier/useCourierRealtime';
import { useCourierThemeTransition } from './courier/useCourierThemeTransition';
import { useCourierOfflineShell } from './courier/useCourierOfflineShell';
import { CourierPayment } from './courier/CourierPayment';
import { courierCodeLength, type CourierOrder } from './courier/courierTypes';
import { CourierGlyph } from './courier/CourierGlyph';
import { CourierOrderDialog } from './courier/CourierOrderDialog';
import ifoodLogo from '../assets/brand/delivery/ifood.png';
import food99Logo from '../assets/brand/delivery/99food.png';
import keetaLogo from '../assets/brand/delivery/keeta.png';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../brand/komaBrand';
const nativeKomaChannels = new Set(['caixa', 'cardapio', 'koma']);
const deliveryLogos = new Map([['ifood', ifoodLogo], ['99food', food99Logo], ['keeta', keetaLogo], ...Array.from(nativeKomaChannels, channel => [channel, KOMA_WORDMARK_ON_DARK_SRC] as [string, string])]);

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
  let storedToken = '';
  try { storedToken = sessionStorage.getItem(DELIVERY_TOKEN_SESSION_KEY)?.trim() || ''; }
  catch { /* A fresh access link still works in memory when tab storage is blocked. */ }
  const token = tokenFromFragment || legacyQueryToken || storedToken;

  if (token) {
    try { sessionStorage.setItem(DELIVERY_TOKEN_SESSION_KEY, token); }
    catch { /* Reload requires reopening the access link; never persist it outside this tab. */ }
  }
  return token;
}

function clearDeliveryTokenFromUrl() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  if (!fragment.has('token') && !query.has('token')) return;
  window.history.replaceState(null, '', window.location.pathname.startsWith('/entregador') ? window.location.pathname : '/entregador');
}

const RESUME_REFRESH_MIN_MS = 15_000;

export function MotoboyPwaPage() {
  const [token, setToken] = useState(bootstrapDeliveryToken);
  // After initialization: StrictMode may read the link twice when tab storage is unavailable.
  useEffect(clearDeliveryTokenFromUrl, []);
  const [theme, setTheme] = useState(readKomaTheme);
  const cache = useMemo(() => createCourierSnapshotCache(token), [token]);
  const activeCacheRef = useRef(cache); activeCacheRef.current = cache;
  const [cacheHydrating, setCacheHydrating] = useState(Boolean(token));
  const [cacheOnly, setCacheOnly] = useState(false);
  const [cacheIssue, setCacheIssue] = useState(false);
  const [accessInvalid, setAccessInvalid] = useState(false);
  const [realtimePending, setRealtimePending] = useState(false);
  const shellIssue = useCourierOfflineShell();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [reconnectRequested, setReconnectRequested] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(token));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(token ? null : 'Abra o link de acesso enviado pelo caixa.');
  const [motoboy, setMotoboy] = useState<MotoboyProfile | null>(null);
  const [entregas, setEntregas] = useState<CourierOrder[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [receiptCode, setReceiptCode] = useState('');
  const [receiptError, setReceiptError] = useState('');
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [uncertainId, setUncertainId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const profileRef = useRef<MotoboyProfile | null>(null);
  const getRef = useRef<AbortController | null>(null);
  const interruptedReadRef = useRef(false);
  const postRef = useRef<AbortController | null>(null);
  const isConfirmingRef = useRef(false);
  const lastAttemptRef = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewConfirmRef = useRef<HTMLButtonElement>(null);
  const previousReviewRef = useRef<string | null>(null);
  useEffect(() => { if (receiptError) receiptInputRef.current?.focus(); }, [receiptError]);

  useEffect(() => {
    if (!reviewId && previousReviewRef.current) document.getElementById(`courier-confirm-${previousReviewRef.current}`)?.focus();
    previousReviewRef.current = reviewId;
  }, [reviewId]);

  useEffect(() => { applyKomaTheme(theme); }, [theme]);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const persistPanel = useCallback(async (panel: unknown) => {
    const saved = await cache.write(panel);
    if (activeCacheRef.current === cache && profileRef.current) setCacheIssue(!saved);
  }, [cache]);

  const revokeAccess = useCallback(() => {
    getRef.current?.abort(); getRef.current = null;
    postRef.current?.abort(); postRef.current = null; isConfirmingRef.current = false;
    profileRef.current = null; setMotoboy(null); setEntregas([]); setLoading(false);
    setConfirmingId(null); setIsRefreshing(false); setAccessInvalid(true); setReviewId(null); setDetailsId(null);
    setErrorMsg('Acesso encerrado. Solicite um novo link ao Caixa.');
    void cache.clear();
  }, [cache]);
  useCourierRealtime(accessInvalid ? '' : token, () => setRealtimePending(true), revokeAccess);

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
          profileRef.current = null; setMotoboy(null); setEntregas([]); setAccessInvalid(true);
          void cache.clear();
        }
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : 'Não foi possível atualizar as entregas.');
      }
      const data = await res.json();
      if (getRef.current !== controller) return false;
      if (!data.motoboy?.id || !Array.isArray(data.entregas)) throw new Error('Não foi possível conferir as entregas. Tente atualizar.');
      profileRef.current = data.motoboy;
      setCacheOnly(false); void persistPanel(data);
      setMotoboy(data.motoboy); setEntregas(data.entregas.filter((item: CourierOrder) => item.delivery_status === 'transito'));
      setErrorMsg(null); setUncertainId(null); setRefreshFailed(false); setLastUpdated(Date.now());
      return true;
    } catch (err: any) {
      if (getRef.current !== controller) return false;
      const message = err?.name === 'AbortError'
        ? 'O painel demorou demais para responder. Tente novamente.'
        : err instanceof TypeError ? 'Sem conexão com o servidor. Tente atualizar.' : err.message || 'Não foi possível carregar as entregas.';
      if (isBackground && profileRef.current) { setRefreshFailed(true); showToast(message, 'error'); }
      else setErrorMsg(message);
      return false;
    } finally {
      window.clearTimeout(timeoutId);
      if (getRef.current === controller) {
        getRef.current = null; setLoading(false); setIsRefreshing(false);
      }
    }
  }, [showToast, cache, persistPanel]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setCacheHydrating(true);
    void (async () => {
      const saved = await cache.read();
      if (!active) return;
      if (saved && !profileRef.current) {
        profileRef.current = saved.motoboy; setMotoboy(saved.motoboy);
        setEntregas(saved.entregas as unknown as CourierOrder[]); setLastUpdated(saved.at);
        setCacheOnly(true); setLoading(false); setErrorMsg(null);
      }
      setCacheHydrating(false);
      if (navigator.onLine) void carregarDadosPainel(token);
      else { setLoading(false); if (!saved) setErrorMsg('Sem conexão e sem entregas salvas neste acesso.'); }
    })();
    const resume = () => {
      if (!navigator.onLine || document.visibilityState !== 'visible' || Date.now() - lastAttemptRef.current < RESUME_REFRESH_MIN_MS) return;
      void carregarDadosPainel(token);
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    const offline = () => { interruptedReadRef.current = Boolean(getRef.current); setIsOnline(false); };
    const online = () => {
      setIsOnline(true);
      if (!getRef.current || interruptedReadRef.current || isConfirmingRef.current) setReconnectRequested(true);
      interruptedReadRef.current = false;
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      getRef.current?.abort(); getRef.current = null;
      postRef.current?.abort(); postRef.current = null;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [token, cache, carregarDadosPainel]);

  // Reconnection bypasses the focus throttle, but waits for the active operation.
  // Read the server once; never queue or replay a delivery confirmation.
  useEffect(() => {
    if (!token || !isOnline || !reconnectRequested || cacheHydrating || loading || isRefreshing || confirmingId) return;
    setReconnectRequested(false);
    void carregarDadosPainel(token);
  }, [token, isOnline, reconnectRequested, cacheHydrating, loading, isRefreshing, confirmingId, carregarDadosPainel]);

  useEffect(() => {
    if (!realtimePending || !token || !isOnline || accessInvalid || cacheHydrating || loading || isRefreshing || confirmingId || getRef.current) return;
    setRealtimePending(false);
    void carregarDadosPainel(token);
  }, [realtimePending, token, isOnline, accessInvalid, cacheHydrating, loading, isRefreshing, confirmingId, carregarDadosPainel]);

  const handleConfirmarEntrega = async (comandaId: string) => {
    if (!token || cacheOnly || !isOnline || !navigator.onLine || reconnectRequested || getRef.current || isConfirmingRef.current || uncertainId) return;
    const current = entregas.find(item => item.id === comandaId);
    if (!current || current.confirmation?.enabled === false) return;
    const requiresCode = current.requires_delivery_code;
    if (requiresCode && !(new RegExp(`^[0-9]{${courierCodeLength(current)}}$`)).test(receiptCode)) { setReceiptError(`Digite os ${courierCodeLength(current)} dígitos informados pelo cliente.`); receiptInputRef.current?.focus(); return; }
    setReceiptError('');
    isConfirmingRef.current = true;
    // A GET started before this mutation must never restore a completed card.
    getRef.current?.abort(); getRef.current = null; setIsRefreshing(false);
    const controller = new AbortController();
    postRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), CONFIRM_DELIVERY_REQUEST_TIMEOUT_MS);
    if (!requiresCode) setReviewId(null);
    setConfirmingId(comandaId);
    try {
      const res = await fetch(`${API_BASE_URL}/comandas/motoboys/pedidos/${comandaId}/confirmar-entrega`, {
        method: 'POST', headers: { [DELIVERY_TOKEN_HEADER]: token, ...(requiresCode ? { 'Content-Type': 'application/json' } : {}) }, signal: controller.signal,
        ...(requiresCode ? { body: JSON.stringify({ code: receiptCode }) } : {}),
      });
      if (postRef.current !== controller) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : 'Não foi possível confirmar a entrega.');
      }
      setReviewId(null); setReceiptCode('');
      const remaining = entregas.filter(item => item.id !== comandaId);
      await persistPanel({motoboy:profileRef.current,entregas:remaining});
      if (postRef.current !== controller) return;
      setEntregas(remaining);
      showToast('Entrega confirmada com sucesso.');
    } catch (err: any) {
      if (postRef.current !== controller) return;
      if (err?.name === 'AbortError' || err instanceof TypeError) {
        setUncertainId(comandaId);
        showToast('A confirmação demorou demais. Atualizando o painel antes de permitir nova tentativa.', 'error');
        await carregarDadosPainel(token, true);
      } else if (requiresCode) { setReceiptError(err.message || 'Não foi possível conferir o código.'); receiptInputRef.current?.focus(); }
      else showToast(err.message || 'Não foi possível confirmar a entrega.', 'error');
    } finally {
      window.clearTimeout(timeoutId);
      if (postRef.current === controller) {
        postRef.current = null; isConfirmingRef.current = false; setConfirmingId(null);
      }
    }
  };

  const trip = useCourierTrip(token, entregas, Boolean(motoboy));
  const [planning, setPlanning] = useState(false);
  const [draftTrip, setDraftTrip] = useState<string[]>([]);
  const planHeadingRef = useRef<HTMLHeadingElement>(null);
  const tripButtonRef = useRef<HTMLButtonElement>(null);
  const previousPlanning = useRef(false);
  useEffect(() => {
    const switchAccess = () => {
      const next = bootstrapDeliveryToken();
      clearDeliveryTokenFromUrl();
      if (next === token) return;
      getRef.current?.abort(); getRef.current = null;
      postRef.current?.abort(); postRef.current = null;
      isConfirmingRef.current = false; profileRef.current = null;
      setMotoboy(null); setEntregas([]); setReviewId(null); setConfirmingId(null);
      setAccessInvalid(false); setCacheOnly(false); setCacheIssue(false); setCacheHydrating(Boolean(next)); setRealtimePending(false);
      setUncertainId(null); setRefreshFailed(false); setReconnectRequested(false); setLastUpdated(null); setPlanning(false); setReceiptCode(''); setReceiptError(''); setDetailsId(null);
      setLoading(Boolean(next)); setErrorMsg(next ? null : 'Abra o link enviado pelo caixa.');
      setToken(next);
    };
    window.addEventListener('hashchange', switchAccess);
    return () => window.removeEventListener('hashchange', switchAccess);
  }, [token]);
  useEffect(() => {
    if (planning) planHeadingRef.current?.focus();
    else if (previousPlanning.current) tripButtonRef.current?.focus();
    previousPlanning.current = planning;
  }, [planning]);
  const selectedDraft = draftTrip.filter(id => entregas.some(item => item.id === id));
  const draftOrders = [...selectedDraft.map(id => entregas.find(item => item.id === id)!), ...entregas.filter(item => !selectedDraft.includes(item.id))];
  const ordered = [...trip.ids.map(id => entregas.find(item => item.id === id)!), ...entregas.filter(item => !trip.ids.includes(item.id))];
  const moveDraft = (id: string, direction: number) => setDraftTrip(current => {
    const copy = current.filter(key => entregas.some(item => item.id === key));
    const from = copy.indexOf(id), to = from + direction;
    if (from < 0 || to < 0 || to >= copy.length) return copy;
    [copy[from], copy[to]] = [copy[to], copy[from]];
    return copy;
  });
  const blocked = Boolean(confirmingId) || isRefreshing || Boolean(uncertainId);
  const confirmationBlocked = blocked || cacheOnly || !isOnline || reconnectRequested;
  useEffect(() => {
    if (reviewId && !entregas.some(item => item.id === reviewId)) setReviewId(null);
    if (detailsId && !entregas.some(item => item.id === detailsId)) setDetailsId(null);
  }, [entregas, reviewId, detailsId]);
  const dialogOrder = entregas.find(item => item.id === (reviewId || detailsId));
  const themeTransition = useCourierThemeTransition(confirmationBlocked || loading || planning || Boolean(dialogOrder) || entregas.length > 30);
  const automatic = useCourierAutoOrder(token, ordered, blocked || reconnectRequested || !trip.ready, trip.save);

  return <div className="k-courier">
    <header className="k-courier__header">
      <KomaLogo withText contextualWordmark={false} size="md" />
      <div className="k-courier__tools">
        <button type="button" className="k-courier__icon" aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'} disabled={themeTransition.animating} onClick={event => themeTransition.change(event.currentTarget, () => setTheme(persistKomaTheme(nextKomaTheme(readKomaTheme()))))}>
          {theme === 'dark' ? <Sun aria-hidden="true" size={20} /> : <Moon aria-hidden="true" size={20} />}
        </button>
        {token && <button type="button" className="k-courier__icon" aria-label="Atualizar Pedidos" disabled={!isOnline || Boolean(confirmingId) || isRefreshing || loading} onClick={() => void carregarDadosPainel(token)}>
          <RefreshCw aria-hidden="true" size={20} className={isRefreshing ? 'k-courier__spin' : ''} />
        </button>}
      </div>
    </header>
    {toast && <div className={`k-courier__toast k-courier__toast--${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
      {toast.type === 'success' ? <CheckCircle2 size={19} aria-hidden="true" /> : <AlertCircle size={19} aria-hidden="true" />}<span>{toast.message}</span>
    </div>}
    <main className="k-courier__main">
      {loading ? <div className="k-courier__empty" role="status"><RefreshCw size={26} className="k-courier__spin" aria-hidden="true" /><h1>Carregando entregas</h1></div>
        : errorMsg ? <div className="k-courier__empty"><AlertCircle size={32} aria-hidden="true" /><h1>{token ? 'Não foi possível abrir o painel' : 'Seu acesso às entregas'}</h1><p role="alert">{errorMsg}</p>{token && <button type="button" className="k-courier__action" onClick={() => void carregarDadosPainel(token)}>Tentar Novamente</button>}</div>
        : <>
          <div className="k-courier__intro">
            <div><p className="k-courier__name">{motoboy?.nome}</p><h1>Entregas <span>{entregas.length}</span></h1></div>
            <CourierRideArtwork className="k-courier__art" />
          </div>
          <div className="k-courier__trip-bar">
            <div className="k-courier__sync" data-offline={!isOnline || undefined} role="status">{!isOnline ? <><WifiOff size={14} aria-hidden="true" />Sem conexão · entregas mantidas</> : isRefreshing || reconnectRequested ? 'Conferindo entregas…' : refreshFailed ? 'Atualização pendente · tente atualizar' : cacheOnly ? 'Última lista salva' : lastUpdated ? `Atualizado ${new Date(lastUpdated).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
            {entregas.length > 0 && !planning && <div className="k-courier__trip-tools">
              {entregas.length > 1 && <button type="button" className="k-courier__secondary" disabled={!trip.ready || blocked || automatic.locating} onClick={automatic.order}><LocateFixed size={16} aria-hidden="true" />{automatic.locating ? 'Localizando…' : 'Ordenar automático'}</button>}
              <button type="button" className="k-courier__icon" ref={tripButtonRef} aria-label={trip.ids.length ? 'Editar sequência' : 'Organizar viagem'} title="Ajustar sequência" disabled={!trip.ready || blocked || automatic.locating} onClick={() => { automatic.clearFeedback(); setDraftTrip(trip.ids); setReviewId(null); setPlanning(true); }}><ListOrdered size={20} aria-hidden="true" /></button>
            </div>}
          </div>
          {(cacheIssue || shellIssue) && <p className="k-courier__route-feedback" role="alert">Não foi possível guardar as entregas no aparelho. Mantenha esta tela aberta.</p>}
          {automatic.feedback && <p className="k-courier__route-feedback" role={automatic.feedback.error ? 'alert' : 'status'}>{automatic.feedback.text}</p>}
          {uncertainId && <div className="k-courier__notice" role="alert"><span>Confirmação pendente. Toque em Verificar.</span><button type="button" className="k-courier__secondary" disabled={!isOnline || isRefreshing || Boolean(confirmingId)} onClick={() => void carregarDadosPainel(token)}>Verificar</button></div>}
          {planning && <section className="k-courier__planner" aria-label="Organizar viagem"><h2 tabIndex={-1} ref={planHeadingRef}>Sua sequência</h2><div className="k-courier__planner-list">{draftOrders.map(item => {
            const index = selectedDraft.indexOf(item.id);
            return <div className="k-courier__plan-row" key={item.id}><label><input type="checkbox" checked={index >= 0} onChange={() => setDraftTrip(current => index >= 0 ? current.filter(id => id !== item.id) : [...current, item.id])} /><span><strong>{index >= 0 ? `${index + 1}. ` : ''}#{item.numero_pedido} · {item.cliente_nome}</strong><small>{item.delivery_endereco || 'Endereço não informado'}</small></span></label>{index >= 0 && <div className="k-courier__plan-move"><button type="button" className="k-courier__icon" aria-label={`Antecipar pedido ${item.numero_pedido}`} disabled={index === 0} onClick={() => moveDraft(item.id, -1)}><ArrowUp size={18} aria-hidden="true" /></button><button type="button" className="k-courier__icon" aria-label={`Adiar pedido ${item.numero_pedido}`} disabled={index === selectedDraft.length - 1} onClick={() => moveDraft(item.id, 1)}><ArrowDown size={18} aria-hidden="true" /></button></div>}</div>;
          })}</div><div className="k-courier__plan-actions"><button type="button" className="k-courier__secondary" onClick={() => setPlanning(false)}>Cancelar</button><button type="button" className="k-courier__action" onClick={() => { trip.save(selectedDraft); setPlanning(false); }}>{selectedDraft.length ? 'Usar sequência' : 'Limpar sequência'}</button></div>{!trip.persisted && <p role="status">Ordem temporária nesta tela.</p>}</section>}
          {!planning && <>
          {entregas.length === 0 ? <div className="k-courier__empty"><PackageCheck size={40} aria-hidden="true" /><h2>Nenhuma entrega em rota</h2></div>
            : <div className="k-courier__list">{ordered.map(entrega => {
              const address = entrega.destination?.label || entrega.delivery_endereco;
              const routeQuery = entrega.destination?.route_query || entrega.delivery_endereco;
              const confirmationEnabled = entrega.confirmation?.enabled !== false;
              const itemCount = entrega.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
              const sourceLogo = entrega.source && deliveryLogos.get(entrega.source.channel);
              const isKomaSource = Boolean(entrega.source && nativeKomaChannels.has(entrega.source.channel));
              return <article key={entrega.id} className="k-courier__card" aria-label={`Pedido ${entrega.numero_pedido ?? 'sem número'}`}>
                {trip.ids[0] === entrega.id && <p className="k-courier__next">Próxima entrega</p>}
                <div className="k-courier__card-head">
                  <div><span className="k-courier__order">{entrega.numero_pedido ? `#${entrega.numero_pedido}` : 'Sem número'}</span><h2>{entrega.cliente_nome}</h2></div>
                  <div className="k-courier__origin">{entrega.source && <span className="k-courier__source" data-channel={entrega.source.channel} data-koma-native={isKomaSource || undefined} title={isKomaSource ? `Pedido KÔMA · ${entrega.source.label}` : entrega.source.label}>{sourceLogo ? <img src={sourceLogo} alt={isKomaSource ? 'KÔMA' : entrega.source.label} width={52} height={28} decoding="async" /> : <><Store size={13} aria-hidden="true" />{entrega.source.label}</>}</span>}</div>
                </div>
                <div className="k-courier__card-body">
                  <div className="k-courier__destination">
                    <MapPin size={20} aria-hidden="true" />
                    <div className="k-courier__destination-copy"><p className="k-courier__address">{address || 'Endereço não informado. Confira com o caixa.'}</p>
                      {entrega.destination?.complement && <p className="k-courier__address-note">{entrega.destination.complement}</p>}
                      {entrega.destination?.reference && <p className="k-courier__reference"><span>Referência</span>{entrega.destination.reference}</p>}
                    </div>
                    {routeQuery && <a className="k-courier__map" aria-label={`Abrir localização no Google Maps de ${entrega.cliente_nome}`} href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(routeQuery)}&dir_action=navigate`} target="_blank" rel="noopener noreferrer"><CourierGlyph kind="route" /><span>Maps</span></a>}
                  </div>
                  <CourierPayment payment={entrega.payment} legacyDue={entrega.valor_a_cobrar} />
                  <button type="button" className="k-courier__items-action" id={`courier-items-${entrega.id}`} aria-haspopup="dialog" onClick={() => setDetailsId(entrega.id)}><span><CourierGlyph kind="items" />{entrega.items?.length ? `Ver ${itemCount} ${itemCount === 1 ? 'item' : 'itens'}` : 'Ver pedido'}</span><span aria-hidden="true">›</span></button>
                  {!confirmationEnabled && <p className="k-courier__partner-notice">Confirmação: confira no Caixa.</p>}
                  <button type="button" id={`courier-confirm-${entrega.id}`} className={`k-courier__action${(entrega.payment?.status === 'collect' || (!entrega.payment && entrega.valor_a_cobrar > 0)) ? ' k-courier__action--collect' : ''}`} aria-haspopup="dialog" disabled={confirmationBlocked || !confirmationEnabled} onClick={() => { setDetailsId(null); setReceiptCode(''); setReceiptError(''); setReviewId(entrega.id); }}>{confirmingId === entrega.id ? <><RefreshCw size={18} className="k-courier__spin" aria-hidden="true" />Confirmando…</> : <><CourierGlyph kind="delivery" />{entrega.requires_delivery_code ? 'Confirmar com código' : 'Concluir entrega'}</>}</button>
                </div>
              </article>;
            })}</div>}
          </>}
        </>}
    </main>
    {dialogOrder && <CourierOrderDialog key={`${reviewId ? 'confirm' : 'items'}-${dialogOrder.id}`} order={dialogOrder} mode={reviewId ? 'confirm' : 'items'} sourceLogo={dialogOrder.source ? deliveryLogos.get(dialogOrder.source.channel) : undefined} sourceLabel={dialogOrder.source && nativeKomaChannels.has(dialogOrder.source.channel) ? 'KÔMA' : dialogOrder.source?.label} code={receiptCode} error={receiptError} pending={Boolean(confirmingId)} blocked={confirmationBlocked || dialogOrder.confirmation?.enabled === false} inputRef={receiptInputRef} confirmRef={reviewConfirmRef} onCode={value => { setReceiptCode(value); setReceiptError(''); }} onConfirm={() => void handleConfirmarEntrega(dialogOrder.id)} onClose={() => { const id = detailsId; setDetailsId(null); setReviewId(null); if (id) document.getElementById(`courier-items-${id}`)?.focus(); }} />}
  </div>;
}
