import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';
import { orderUpdateAffects } from '../../../utils/orderUpdate';
import clsx from 'clsx';
import { CashierFooterArt } from '../navigation/CashierFooterArt';
import '../navigation/cashierSidebarFooter.css';
import '../../shared/komaOperationalOverlays.css';
import { trapOverlayTab } from '../../shared/trapOverlayTab';
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE_URL } from '../../../config/api';
import { getOperatorAccessToken } from '../../../utils/authSession';
import {
  fetchOnlineOrdersControl,
  invalidateOnlineOrdersControlCache,
} from './onlineOrdersControlClient';

type OperationalStatus = {
  paused: boolean;
  pause_reason: string | null;
  pause_until: string | null;
  max_active_orders: number | null;
  auto_pause: boolean;
  counts: {
    analise: number;
    pendente: number;
    producao: number;
    pronto: number;
    active: number;
  };
  capacity_ratio: number | null;
  level: 'normal' | 'high' | 'full' | 'paused';
};

const PAUSE_REASONS = [
  'Cozinha lotada',
  'Falta de equipe',
  'Estoque / manutenção',
  'Encerramento antecipado',
  'Outro motivo operacional',
] as const;

const getAuthHeaders = (): Record<string, string> => {
  const token = getOperatorAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export function OnlineOrderEmergencyControl({ mobile = false, isWsConnected = false }: { mobile?: boolean; isWsConnected?: boolean }) {
  const [desktopViewport, setDesktopViewport] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const visibleOwner = mobile ? !desktopViewport : desktopViewport;
  const [pauseDeadlineReached, setPauseDeadlineReached] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktopViewport(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [statusData, setStatusData] = useState<OperationalStatus | null>(null);
  const [authorized, setAuthorized] = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState<string>(PAUSE_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [duration, setDuration] = useState<15 | 30 | 60 | null>(null);
  const [error, setError] = useState('');
  const loadFlightRef = useRef<Promise<void> | null>(null);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(false);

  const loadStatus = useCallback((force = false): Promise<void> => {
    if (!force && loadFlightRef.current) return loadFlightRef.current;
    const requestToken = getOperatorAccessToken();
    const flight = (async () => {
      try {
        const result = await fetchOnlineOrdersControl(
          API_BASE_URL,
          requestToken ? `Bearer ${requestToken}` : '',
          { force },
        );
        if (!mountedRef.current || getOperatorAccessToken() !== requestToken) return;
        if (result.status === 401 || result.status === 403) {
          setAuthorized(false);
          return;
        }
        if (!result.ok || !result.payload) return;
        const payload = result.payload as OperationalStatus;
        if (!mountedRef.current || getOperatorAccessToken() !== requestToken) return;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.counts) return;
        setAuthorized(true);
        setStatusData(payload);
      } catch {
        // Controle de emergência não deve derrubar o Caixa se a leitura falhar.
      } finally {
        // Só existe estado semântico depois que a primeira tentativa terminou.
        // Em caso de falha mostramos indisponível, nunca "0 pedidos" ou "despausado".
        if (mountedRef.current) setStatusLoading(false);
        loadFlightRef.current = null;
        if (dirtyRef.current && mountedRef.current) {
          dirtyRef.current = false;
          queueMicrotask(() => { void loadStatus(true); });
        }
      }
    })();
    loadFlightRef.current = flight;
    return flight;
  }, []);

  useEffect(() => {
    if (!visibleOwner) return;
    mountedRef.current = true;
    void loadStatus();
    let hintTimer: number | null = null;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (hintTimer !== null) window.clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => {
        hintTimer = null;
        if (loadFlightRef.current) dirtyRef.current = true;
        else void loadStatus(true);
      }, 100);
    };
    const onOrdersUpdated = (event: Event) => {
      if (orderUpdateAffects(event, 'digital')) refresh();
    };
    window.addEventListener('koma_orders_updated', onOrdersUpdated);
    window.addEventListener('koma_online_order_control_updated', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      mountedRef.current = false;
      if (hintTimer !== null) window.clearTimeout(hintTimer);
      window.removeEventListener('koma_orders_updated', onOrdersUpdated);
      window.removeEventListener('koma_online_order_control_updated', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadStatus, visibleOwner]);

  const statusReady = statusData !== null;
  useEffect(() => {
    // Keep recovery polling if bootstrap failed or a timed pause needs reconciliation.
    if (!visibleOwner || !authorized || (isWsConnected && statusReady && !pauseDeadlineReached)) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadStatus(true);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [isWsConnected, statusReady, pauseDeadlineReached, visibleOwner, authorized, loadStatus]);

  useEffect(() => {
    setPauseDeadlineReached(false);
    if (!visibleOwner || !statusData?.paused || !statusData.pause_until) return;
    const deadline = Date.parse(statusData.pause_until);
    if (!Number.isFinite(deadline)) return;
    const timer = window.setTimeout(() => {
      setPauseDeadlineReached(true);
      if (document.visibilityState === 'visible') void loadStatus(true);
    }, Math.max(0, Math.min(2_147_483_647, deadline - Date.now())));
    return () => window.clearTimeout(timer);
  }, [visibleOwner, statusData?.paused, statusData?.pause_until, loadStatus]);

  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!dialogOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLButtonElement>('[aria-label="Fechar"]')?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [dialogOpen]);

  const resolvedReason = useMemo(
    () => (reason === 'Outro motivo operacional' ? customReason.trim() : reason),
    [reason, customReason],
  );

  const mutate = async (action: 'pause' | 'resume') => {
    if (!statusData) return;
    setLoading(true);
    setError('');
    invalidateOnlineOrdersControlCache();
    try {
      const response = await fetch(`${API_BASE_URL}/api/online-orders/${action}`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'pause'
            ? { reason: resolvedReason, duration_minutes: duration }
            : { reason: 'Reabertura manual pelo Caixa' },
        ),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível atualizar o recebimento de pedidos.');
      if (data && typeof data === 'object' && !Array.isArray(data) && data.counts) {
        setStatusData(data as OperationalStatus);
      }
      setDialogOpen(false);
      window.dispatchEvent(new Event('koma_orders_updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar pedidos online.');
    } finally {
      setLoading(false);
    }
  };

  if (!authorized || !visibleOwner) return null;

  if (!statusData || !statusData.counts) {
    return (
      <button
        type="button"
        disabled={statusLoading}
        onClick={() => {
          if (!statusLoading) {
            setStatusLoading(true);
            void loadStatus(true);
          }
        }}
        className={clsx(
          'w-full rounded-xl border border-koma-border bg-koma-raised/45 px-3 py-2.5 text-left text-koma-muted transition',
          mobile ? '' : 'group-data-[collapsible=icon]:px-2',
        )}
        title={statusLoading ? 'Sincronizando cardápio online' : 'Tentar consultar cardápio online novamente'}
        aria-label={statusLoading ? 'Sincronizando cardápio online' : 'Estado do cardápio online indisponível. Tentar novamente'}
        id="online-orders-emergency-trigger"

      >
        <div className="flex items-center gap-2.5">
          {statusLoading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
          <div className="min-w-0 flex-1">
            <strong className="cashier-footer-pause__title">
              {statusLoading ? 'Sincronizando cardápio online' : 'Estado do cardápio indisponível'}
            </strong>
            <small className="cashier-footer-pause__count">
              {statusLoading ? 'Consultando pedidos ativos' : 'Clique para tentar novamente'}
            </small>
          </div>
        </div>
      </button>
    );
  }

  const active = statusData.counts.active;
  const capacity = statusData.max_active_orders;
  const highDemand = statusData.level === 'high' || statusData.level === 'full';

  const dialog = dialogOpen && typeof document !== 'undefined'
    ? createPortal(
        <div onClick={event => { if (event.target === event.currentTarget && !loading) setDialogOpen(false); }} className="cashier-portal ko-overlay fixed inset-0 z-[9999] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="presentation">
          <section ref={dialogRef} onKeyDown={event => { trapOverlayTab(event); if (event.key === 'Escape' && !loading) { event.stopPropagation(); setDialogOpen(false); } }}
            role="dialog"
            aria-modal="true"
            aria-label={statusData.paused ? 'Reabrir cardápio online' : 'Pausar cardápio online'}
            className="ko-pause w-full max-w-md rounded-3xl border p-5 shadow-2xl"
          >
            <div className="ko-overlay__header flex items-start justify-between gap-4">
              <img className="ko-overlay__art" src="/brand/cashier/pause-menu-v1.svg" width="56" height="56" alt="" aria-hidden="true" />
              <div>

                <h2 className="mt-1 text-lg font-black">
                  {statusData.paused ? 'Reabrir cardápio online' : 'Pausar cardápio online'}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                  {statusData.paused
                    ? 'Novos pedidos voltam a entrar quando o caixa estiver aberto e sincronizado.'
                    : 'Só novas compras no cardápio ficam suspensas. Pedidos recebidos e conversas continuam ativos.'}
                </p>
              </div>
              <button type="button" onClick={() => setDialogOpen(false)} className="rounded-xl border border-zinc-800 p-2 text-zinc-400 hover:text-white" aria-label="Fechar" disabled={loading}>
                <X size={17} />
              </button>
            </div>

            <div className="ko-pause__counts mt-4 grid grid-cols-4 gap-2 text-center">
              <div><small className="block text-[9px] text-zinc-500">Aguardando</small><strong className="text-sm">{statusData.counts.analise + statusData.counts.pendente}</strong></div>
              <div><small className="block text-[9px] text-zinc-500">Produção</small><strong className="text-sm">{statusData.counts.producao}</strong></div>
              <div><small className="block text-[9px] text-zinc-500">Prontos</small><strong className="text-sm">{statusData.counts.pronto}</strong></div>
              <div><small className="block text-[9px] text-zinc-500">Ativos</small><strong className="text-sm text-emerald-400">{active}{capacity ? `/${capacity}` : ''}</strong></div>
            </div>

            {!statusData.paused && (
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">Motivo</span>
                  <select value={reason} onChange={(event) => setReason(event.target.value)} className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-white outline-none focus:border-emerald-500">
                    {PAUSE_REASONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                {reason === 'Outro motivo operacional' && (
                  <input value={customReason} onChange={(event) => setCustomReason(event.target.value)} maxLength={160} placeholder="Informe o motivo" className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm outline-none focus:border-emerald-500" />
                )}
                <div>
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">Duração</span>
                  <div className="grid grid-cols-4 gap-2">
                    {([15, 30, 60, null] as const).map((value) => (
                      <button key={value ?? 'manual'} type="button" aria-pressed={duration === value} onClick={() => setDuration(value)} className={clsx('h-10 rounded-xl border text-xs font-bold transition', duration === value ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white')}>
                        {value ? `${value} min` : 'Até abrir'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {error && <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300" role="alert">{error}</div>}

            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setDialogOpen(false)} disabled={loading} className="h-11 flex-1 rounded-xl border border-zinc-700 text-xs font-bold text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">Cancelar</button>
              <button
                type="button"
                onClick={() => void mutate(statusData.paused ? 'resume' : 'pause')}
                disabled={loading || (!statusData.paused && resolvedReason.length < 3)}
                className="ko-action ko-action--primary flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-xl disabled:opacity-50"
              >
                {loading && <Loader2 size={15} className="animate-spin" />}
                {statusData.paused ? 'Reabrir cardápio online' : 'Pausar cardápio online'}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError('');
          setDialogOpen(true);
        }}
        className={clsx(
          'cashier-footer-pause',
          mobile ? '' : 'group-data-[collapsible=icon]:px-2',
        )}
        title={statusData.paused ? 'Reabrir cardápio online' : 'Pausar cardápio online'}
        aria-label={statusData.paused ? 'Reabrir cardápio online' : 'Pausar cardápio online'}
        id="online-orders-emergency-trigger"
        data-paused={statusData.paused}
        data-high-demand={highDemand}
      >
        <div className="flex items-center gap-2.5">
          <CashierFooterArt kind={statusData.paused ? 'resume' : 'pause'} />
          <div className="min-w-0 flex-1">
            <strong className="cashier-footer-pause__title">
              {statusData.paused ? 'Cardápio online pausado' : highDemand ? 'Alta demanda' : 'Pausar cardápio online'}
            </strong>
            <small className="cashier-footer-pause__count">
              {capacity ? `${active}/${capacity} pedidos ativos` : `${active} pedidos ativos`}
            </small>
          </div>
          {highDemand && !statusData.paused && <AlertTriangle size={15} className="shrink-0" />}
        </div>
      </button>
      {dialog}
    </>
  );
}
