import clsx from 'clsx';
import { AlertTriangle, Loader2, PauseCircle, PlayCircle, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../../../config/api';

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
  const token =
    localStorage.getItem('koma_caixa_token') ||
    localStorage.getItem('token') ||
    localStorage.getItem('koma_waiter_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export function OnlineOrderEmergencyControl({ mobile = false }: { mobile?: boolean }) {
  const [statusData, setStatusData] = useState<OperationalStatus | null>(null);
  const [authorized, setAuthorized] = useState(true);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState<string>(PAUSE_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [duration, setDuration] = useState<15 | 30 | 60 | null>(null);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/online-orders/control`, {
        headers: getAuthHeaders(),
        cache: 'no-store',
      });
      if (response.status === 401 || response.status === 403) {
        setAuthorized(false);
        return;
      }
      if (!response.ok) return;
      const payload = (await response.json()) as OperationalStatus;
      setAuthorized(true);
      setStatusData(payload);
    } catch {
      // Controle de emergência não deve derrubar o Caixa se a leitura falhar.
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadStatus();
    }, 10000);
    const refresh = () => void loadStatus();
    window.addEventListener('koma_orders_updated', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('koma_orders_updated', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadStatus]);

  const active = statusData?.counts?.active ?? 0;
  const capacity = statusData?.max_active_orders ?? null;
  const highDemand = statusData?.level === 'high' || statusData?.level === 'full';
  const resolvedReason = useMemo(
    () => (reason === 'Outro motivo operacional' ? customReason.trim() : reason),
    [reason, customReason],
  );

  const mutate = async (action: 'pause' | 'resume') => {
    setLoading(true);
    setError('');
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
      setStatusData(data as OperationalStatus);
      setDialogOpen(false);
      window.dispatchEvent(new Event('koma_orders_updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar pedidos online.');
    } finally {
      setLoading(false);
    }
  };

  if (!authorized) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError('');
          setDialogOpen(true);
        }}
        className={clsx(
          'w-full rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99]',
          statusData?.paused
            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15'
            : highDemand
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15'
              : 'border-rose-500/30 bg-rose-500/[0.07] text-rose-200 hover:bg-rose-500/12',
          mobile ? '' : 'group-data-[collapsible=icon]:px-2',
        )}
        title={statusData?.paused ? 'Reabrir pedidos online' : 'Pausar pedidos online'}
        aria-label={statusData?.paused ? 'Reabrir pedidos online' : 'Pausar pedidos online'}
        id="online-orders-emergency-trigger"
      >
        <div className="flex items-center gap-2.5">
          {statusData?.paused ? <PlayCircle size={17} /> : <PauseCircle size={17} />}
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-[11px] font-black">
              {statusData?.paused ? 'Pedidos online pausados' : highDemand ? 'Alta demanda' : 'Pausar pedidos online'}
            </strong>
            <small className="block truncate text-[9px] opacity-75">
              {capacity ? `${active}/${capacity} pedidos ativos` : `${active} pedidos ativos`}
            </small>
          </div>
          {highDemand && !statusData?.paused && <AlertTriangle size={15} className="shrink-0" />}
        </div>
      </button>

      {dialogOpen && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={statusData?.paused ? 'Reabrir pedidos online' : 'Pausar pedidos online'}
            className="w-full max-w-md rounded-3xl border border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400">Controle operacional</span>
                <h2 className="mt-1 text-lg font-black">
                  {statusData?.paused ? 'Reabrir pedidos online?' : 'Pausar novos pedidos?'}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                  {statusData?.paused
                    ? 'O Cardápio voltará a aceitar novos pedidos conforme horários e demais regras do restaurante.'
                    : 'Pedidos já recebidos continuam no Caixa, acompanhamento e chat. Apenas novas compras serão interrompidas.'}
                </p>
              </div>
              <button type="button" onClick={() => setDialogOpen(false)} className="rounded-xl border border-zinc-800 p-2 text-zinc-400 hover:text-white" aria-label="Fechar">
                <X size={17} />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
              <div><small className="block text-[9px] text-zinc-500">Aguardando</small><strong className="text-sm">{(statusData?.counts?.analise ?? 0) + (statusData?.counts?.pendente ?? 0)}</strong></div>
              <div><small className="block text-[9px] text-zinc-500">Produção</small><strong className="text-sm">{statusData?.counts?.producao ?? 0}</strong></div>
              <div><small className="block text-[9px] text-zinc-500">Prontos</small><strong className="text-sm">{statusData?.counts?.pronto ?? 0}</strong></div>
              <div><small className="block text-[9px] text-zinc-500">Ativos</small><strong className="text-sm text-emerald-400">{active}{capacity ? `/${capacity}` : ''}</strong></div>
            </div>

            {!statusData?.paused && (
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
                      <button key={value ?? 'manual'} type="button" onClick={() => setDuration(value)} className={clsx('h-10 rounded-xl border text-xs font-bold transition', duration === value ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white')}>
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
                onClick={() => void mutate(statusData?.paused ? 'resume' : 'pause')}
                disabled={loading || (!statusData?.paused && resolvedReason.length < 3)}
                className={clsx('flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-xl text-xs font-black text-white disabled:opacity-50', statusData?.paused ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-rose-600 hover:bg-rose-500')}
              >
                {loading && <Loader2 size={15} className="animate-spin" />}
                {statusData?.paused ? 'Reabrir pedidos' : 'Pausar agora'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
