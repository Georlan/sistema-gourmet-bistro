import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  Move,
  RefreshCw,
} from 'lucide-react';
import { API_BASE_URL } from '../config/api';

type OperationalState =
  | 'em_preparo'
  | 'pronto'
  | 'aguardando_pagamento'
  | 'pagamento_processando'
  | 'aprovado_pendente_liquidacao';

type DockPosition = 'bottom-right' | 'bottom-left' | 'top-left' | 'top-right';

type CashProjection = {
  mesa_id: number;
  estado_operacional: OperationalState;
  saldo: number | string;
  pagamento?: {
    intent_id: string;
    status: string;
    metodo: string;
    valor: number | string;
    provider?: string | null;
    terminal_id?: string | null;
    provider_reference?: string | null;
    provider_last_error?: string | null;
    pagamento_id?: string | null;
  } | null;
};

const DOCK_STORAGE_KEY = 'koma_smartpos_cash_supervisor_dock';
const DOCK_ORDER: DockPosition[] = ['bottom-right', 'bottom-left', 'top-left', 'top-right'];
const DOCK_CLASS: Record<DockPosition, string> = {
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'top-left': 'top-20 left-4',
  'top-right': 'top-20 right-4',
};
const DOCK_LABEL: Record<DockPosition, string> = {
  'bottom-right': 'inferior direito',
  'bottom-left': 'inferior esquerdo',
  'top-left': 'superior esquerdo',
  'top-right': 'superior direito',
};

const readDockPosition = (): DockPosition => {
  if (typeof window === 'undefined') return 'bottom-right';
  const stored = window.localStorage.getItem(DOCK_STORAGE_KEY) as DockPosition | null;
  return stored && DOCK_ORDER.includes(stored) ? stored : 'bottom-right';
};

const isCashRoute = () => {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  return view === 'caixa'
    || view === 'gerencia'
    || window.location.hash === '#caixa'
    || window.location.hash === '#gerencia';
};

const money = (value: number | string) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(Number(value || 0));

const methodLabel = (method?: string) => {
  if (method === 'debito') return 'Débito';
  if (method === 'credito') return 'Crédito';
  if (method === 'pix') return 'Pix';
  if (method === 'voucher') return 'Voucher';
  if (method === 'dinheiro') return 'Dinheiro';
  return method || 'Pagamento';
};

export default function SmartPosCashAlerts() {
  const [rows, setRows] = useState<CashProjection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [dockPosition, setDockPosition] = useState<DockPosition>(readDockPosition);
  const [visible, setVisible] = useState(() => typeof window !== 'undefined' && isCashRoute());
  const [token, setToken] = useState(() => (
    typeof window !== 'undefined' ? window.localStorage.getItem('koma_caixa_token') : null
  ));

  const syncContext = useCallback(() => {
    setVisible(isCashRoute());
    setToken(window.localStorage.getItem('koma_caixa_token'));
  }, []);

  useEffect(() => {
    syncContext();
    const timer = window.setInterval(syncContext, 1000);
    window.addEventListener('popstate', syncContext);
    window.addEventListener('hashchange', syncContext);
    window.addEventListener('focus', syncContext);
    window.addEventListener('storage', syncContext);
    document.addEventListener('visibilitychange', syncContext);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('popstate', syncContext);
      window.removeEventListener('hashchange', syncContext);
      window.removeEventListener('focus', syncContext);
      window.removeEventListener('storage', syncContext);
      document.removeEventListener('visibilitychange', syncContext);
    };
  }, [syncContext]);

  const load = useCallback(async (silent = false) => {
    const currentToken = window.localStorage.getItem('koma_caixa_token');
    if (!isCashRoute() || !currentToken) {
      setRows([]);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/smartpos/caixa/operacao`, {
        headers: { Authorization: `Bearer ${currentToken}` },
        cache: 'no-store',
      });
      if (response.status === 401 || response.status === 403) {
        setRows([]);
        setError('');
        return;
      }
      if (!response.ok) throw new Error('Não foi possível ler as exceções SmartPOS.');
      const data = await response.json();
      setRows(Array.isArray(data) ? data : []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'SmartPOS indisponível.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible || !token) {
      setRows([]);
      return;
    }
    void load();
    const timer = window.setInterval(() => void load(true), 4000);
    const refresh = () => void load(true);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load, token, visible]);

  const alerts = useMemo(() => rows.filter((row) => (
    row.estado_operacional === 'pagamento_processando'
    || row.estado_operacional === 'aprovado_pendente_liquidacao'
    || Boolean(row.pagamento?.provider_last_error)
  )), [rows]);

  const settlementAttention = useMemo(() => alerts.filter(
    (row) => row.estado_operacional === 'aprovado_pendente_liquidacao',
  ).length, [alerts]);

  const errorAttention = useMemo(() => alerts.filter(
    (row) => Boolean(row.pagamento?.provider_last_error),
  ).length, [alerts]);

  const moveDock = useCallback(() => {
    setDockPosition((current) => {
      const currentIndex = DOCK_ORDER.indexOf(current);
      const next = DOCK_ORDER[(currentIndex + 1) % DOCK_ORDER.length];
      window.localStorage.setItem(DOCK_STORAGE_KEY, next);
      return next;
    });
  }, []);

  if (!visible || !token) return null;

  return (
    <aside className={`fixed ${DOCK_CLASS[dockPosition]} z-[90] w-[min(390px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-koma-border bg-koma-surface/95 shadow-2xl backdrop-blur transition-[top,bottom,left,right] duration-200`}>
      <div className="flex items-center justify-between gap-2 border-b border-koma-border px-3 py-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <CreditCard size={17} className="shrink-0 text-koma-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-black uppercase tracking-wide">Alertas SmartPOS</p>
            <p className="truncate text-[10px] text-koma-muted">
              {alerts.length === 0
                ? 'Sem exceções de pagamento'
                : `${alerts.length} ocorrência${alerts.length === 1 ? '' : 's'} para acompanhar`}
            </p>
          </div>
          {(settlementAttention + errorAttention) > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[9px] font-black text-amber-300">
              {settlementAttention + errorAttention} atenção
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={moveDock}
          aria-label={`Mover Alertas SmartPOS. Posição atual: ${DOCK_LABEL[dockPosition]}`}
          title={`Mover painel — atual: ${DOCK_LABEL[dockPosition]}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-koma-border text-koma-muted transition-colors hover:text-koma-foreground"
        >
          <Move size={14} />
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Atualizar SmartPOS"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-koma-border text-koma-muted disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {error ? (
        <div className="p-3">
          <p className="flex items-start gap-2 rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-xs text-red-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        </div>
      ) : expanded ? (
        <div className="max-h-[52vh] space-y-2 overflow-y-auto p-3">
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-koma-border px-3 py-3 text-xs text-koma-muted">
              <CheckCircle2 size={15} className="shrink-0 text-koma-accent" />
              Nenhum pagamento exige intervenção do Caixa.
            </div>
          ) : alerts.map((row) => {
            const payment = row.pagamento;
            const settlementPending = row.estado_operacional === 'aprovado_pendente_liquidacao';
            const providerError = payment?.provider_last_error;
            return (
              <div key={`${row.mesa_id}-${payment?.intent_id || 'smartpos'}`} className="rounded-xl border border-koma-border bg-koma-page p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong className="block text-sm">Mesa {row.mesa_id}</strong>
                    <p className="mt-1 text-[10px] text-koma-muted">
                      {providerError
                        ? 'Falha/reconciliação pendente no terminal'
                        : settlementPending
                          ? 'Aprovado no terminal, aguardando liquidação'
                          : 'Pagamento em processamento'}
                    </p>
                  </div>
                  <strong className="shrink-0 text-sm text-koma-accent">{money(payment?.valor ?? row.saldo)}</strong>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-koma-subtle">
                  {payment?.metodo && <span>{methodLabel(payment.metodo)}</span>}
                  {payment?.provider && <span>{payment.provider}</span>}
                  {payment?.terminal_id && <span className="font-mono">{payment.terminal_id}</span>}
                </div>
                {providerError && (
                  <p className="mt-2 rounded-lg border border-red-900/40 bg-red-950/20 px-2 py-1.5 text-[10px] text-red-300">
                    {providerError}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}
