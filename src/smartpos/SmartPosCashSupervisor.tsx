import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, RefreshCw } from 'lucide-react';
import { API_BASE_URL } from '../config/api';


type CashProjection = {
  mesa_id: number;
  estado_operacional:
    | 'em_preparo'
    | 'pronto'
    | 'aguardando_pagamento'
    | 'pagamento_processando'
    | 'aprovado_pendente_liquidacao';
  saldo: number | string;
  pagamento?: {
    intent_id: string;
    status: string;
    metodo: string;
    valor: number | string;
    provider?: string | null;
    terminal_id?: string | null;
    pagamento_id?: string | null;
  } | null;
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
  return method || 'Pagamento';
};

export default function SmartPosCashSupervisor() {
  const [rows, setRows] = useState<CashProjection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const visible = typeof window !== 'undefined' && isCashRoute();
  const token = visible ? localStorage.getItem('koma_caixa_token') : null;

  const load = useCallback(async (silent = false) => {
    const currentToken = localStorage.getItem('koma_caixa_token');
    if (!visible || !currentToken) return;
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
      if (!response.ok) throw new Error('Não foi possível ler a operação SmartPOS.');
      const data = await response.json();
      setRows(Array.isArray(data) ? data : []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'SmartPOS indisponível.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !token) return;
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

  const attentionRows = useMemo(() => rows.filter((row) => (
    row.estado_operacional === 'pagamento_processando'
    || row.estado_operacional === 'aprovado_pendente_liquidacao'
  )), [rows]);

  if (!visible || !token) return null;

  return (
    <aside className="fixed bottom-4 right-4 z-[90] w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-koma-border bg-koma-surface/95 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between gap-3 border-b border-koma-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <CreditCard size={17} className="shrink-0 text-koma-accent" />
          <div className="min-w-0">
            <p className="truncate text-xs font-black uppercase tracking-wide">SmartPOS</p>
            <p className="truncate text-[10px] text-koma-muted">Supervisor de pagamentos</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Atualizar SmartPOS"
          className="flex size-8 items-center justify-center rounded-lg border border-koma-border text-koma-muted disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      <div className="max-h-60 overflow-y-auto p-3">
        {error ? (
          <p className="flex items-start gap-2 rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-xs text-red-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        ) : attentionRows.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-koma-border px-3 py-2.5 text-xs text-koma-muted">
            <CheckCircle2 size={15} className="shrink-0 text-koma-accent" />
            Nenhum pagamento SmartPOS pendente.
          </div>
        ) : (
          <div className="grid gap-2">
            {attentionRows.map((row) => {
              const payment = row.pagamento;
              const pendingSettlement = row.estado_operacional === 'aprovado_pendente_liquidacao';
              return (
                <div key={`${row.mesa_id}-${payment?.intent_id || 'payment'}`} className="rounded-xl border border-koma-border bg-koma-page p-3">
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm">Mesa {row.mesa_id}</strong>
                    <strong className="text-sm text-koma-accent">{money(payment?.valor ?? row.saldo)}</strong>
                  </div>
                  <p className="mt-1 text-xs text-koma-muted">
                    {methodLabel(payment?.metodo)} · {pendingSettlement ? 'Aprovado, aguardando liquidação' : 'Pagamento em processamento'}
                  </p>
                  {(payment?.terminal_id || payment?.provider) && (
                    <p className="mt-1 truncate font-mono text-[9px] text-koma-subtle">
                      {[payment?.provider, payment?.terminal_id].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
