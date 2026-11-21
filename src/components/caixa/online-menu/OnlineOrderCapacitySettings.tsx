import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';
import { fetchOnlineOrdersControl, invalidateOnlineOrdersControlCache } from './onlineOrdersControlClient';
import { AlertTriangle, Gauge, Loader2, Save } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

type OperationalStatus = {
  paused: boolean;
  max_active_orders: number | null;
  auto_pause: boolean;
  counts: { analise: number; pendente: number; producao: number; pronto: number; active: number };
  capacity_ratio: number | null;
  level: 'normal' | 'high' | 'full' | 'paused';
};

export function OnlineOrderCapacitySettings({
  apiBaseUrl,
  authHeaders,
}: {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}) {
  const [statusData, setStatusData] = useState<OperationalStatus | null>(null);
  const [capacity, setCapacity] = useState('');
  const [autoPause, setAutoPause] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    try {
      const authorization = authHeaders.Authorization || authHeaders.authorization || '';
      const result = await fetchOnlineOrdersControl(apiBaseUrl, authorization);
      if (!result.ok || !result.payload) return;
      const payload = result.payload as OperationalStatus;
      setStatusData(payload);
      setCapacity(payload.max_active_orders ? String(payload.max_active_orders) : '');
      setAutoPause(Boolean(payload.auto_pause));
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const parsed = capacity.trim() ? Number(capacity) : null;
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 500)) {
      setFeedback('Informe uma capacidade entre 1 e 500 pedidos.');
      return;
    }
    setSaving(true);
    setFeedback('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/online-orders/capacity`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_active_orders: parsed, auto_pause: autoPause }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Não foi possível salvar a capacidade.');
      invalidateOnlineOrdersControlCache();
      setStatusData(payload as OperationalStatus);
      setFeedback('Capacidade operacional salva.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Falha ao salvar capacidade.');
    } finally {
      setSaving(false);
    }
  };

  const active = statusData?.counts?.active ?? 0;
  const limit = statusData?.max_active_orders ?? null;
  const high = statusData?.level === 'high' || statusData?.level === 'full';

  return (
    <section className="rounded-2xl border border-koma-border bg-koma-card p-4 sm:p-5" id="online-order-capacity-settings">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border"
            style={{
              background: 'var(--koma-success-bg)',
              borderColor: 'var(--koma-success-border)',
              color: 'var(--koma-success-text)',
            }}
          >
            <Gauge size={19} aria-hidden="true" />
          </span>
          <div>
            <h3
              className="text-sm font-bold text-koma-foreground"
              style={{ fontFamily: 'var(--koma-font-display)' }}
            >
              Capacidade da operação
            </h3>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-koma-muted">
              Defina quantos pedidos online ativos sua cozinha consegue processar. O alerta começa em 80%. A pausa automática é opcional e nunca reabre a loja sozinha.
            </p>
          </div>
        </div>
        <div
          className="rounded-xl border px-3.5 py-2 text-right"
          style={
            high
              ? {
                  background: 'var(--koma-warning-bg)',
                  borderColor: 'var(--koma-warning-border)',
                }
              : {
                  background: 'var(--koma-surface-panel)',
                  borderColor: 'var(--koma-border-default)',
                }
          }
        >
          <span className="block text-xs font-medium text-koma-muted">Carga atual</span>
          <strong
            className="text-sm font-bold tabular-nums"
            style={{
              fontFamily: 'var(--koma-font-display)',
              color: high ? 'var(--koma-warning-text)' : 'var(--koma-success-text)',
            }}
          >
            {active}{limit ? ` / ${limit}` : ''}
          </strong>
        </div>
      </div>

      {high && (
        <div
          className="mt-4 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold"
          style={{
            background: 'var(--koma-warning-bg)',
            borderColor: 'var(--koma-warning-border)',
            color: 'var(--koma-warning-text)',
          }}
        >
          <AlertTriangle size={15} aria-hidden="true" className="shrink-0" />
          <span>
            {statusData?.level === 'full'
              ? 'Capacidade configurada atingida.'
              : 'Alta demanda: a operação já passou de 80% da capacidade.'}
          </span>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-koma-secondary">
            Máximo de pedidos ativos
          </span>
          <input
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            placeholder="Sem limite"
            className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm tabular-nums text-koma-foreground outline-none focus:border-koma-border-strong"
          />
        </label>

        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-koma-border bg-koma-panel px-3.5 py-2">
          <input
            type="checkbox"
            checked={autoPause}
            onChange={(event) => setAutoPause(event.target.checked)}
            disabled={!capacity.trim()}
            className="h-4 w-4 shrink-0"
            style={{ accentColor: 'var(--koma-action-bg)' }}
          />
          <span>
            <strong className="block text-xs font-semibold text-koma-foreground">
              Pausar automaticamente ao atingir o limite
            </strong>
            <span className="block text-xs text-koma-muted">
              Desligado por padrão. A reabertura continua manual.
            </span>
          </span>
        </label>

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || loading}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60"
          style={{
            background: 'var(--koma-action-bg)',
            color: 'var(--koma-action-text)',
          }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          <span>Salvar</span>
        </button>
      </div>

      {feedback && (
        <p className="mt-3 text-xs font-medium text-koma-secondary" role="status">
          {feedback}
        </p>
      )}
    </section>
  );
}
