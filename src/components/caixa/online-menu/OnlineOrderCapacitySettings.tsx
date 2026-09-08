import clsx from 'clsx';
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
      const response = await fetch(`${apiBaseUrl}/api/online-orders/control`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as OperationalStatus;
      setStatusData(payload);
      setCapacity(payload.max_active_orders ? String(payload.max_active_orders) : '');
      setAutoPause(payload.auto_pause);
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
    <section className="mb-4 rounded-2xl border border-koma-border bg-koma-card p-4 sm:p-5" id="online-order-capacity-settings">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-500">
            <Gauge size={19} />
          </span>
          <div>
            <h3 className="text-sm font-black text-koma-foreground">Capacidade da operação</h3>
            <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-koma-subtle">
              Defina quantos pedidos online ativos sua cozinha consegue processar. O alerta começa em 80%. A pausa automática é opcional e nunca reabre a loja sozinha.
            </p>
          </div>
        </div>
        <div className={clsx('rounded-xl border px-3 py-2 text-right', high ? 'border-amber-500/35 bg-amber-500/10' : 'border-koma-border bg-koma-panel')}>
          <small className="block text-[9px] uppercase tracking-wider text-koma-muted">Carga atual</small>
          <strong className={clsx('text-sm', high ? 'text-amber-500' : 'text-emerald-500')}>{active}{limit ? ` / ${limit}` : ''}</strong>
        </div>
      </div>

      {high && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] font-bold text-amber-600 dark:text-amber-300">
          <AlertTriangle size={15} />
          {statusData?.level === 'full' ? 'Capacidade configurada atingida.' : 'Alta demanda: a operação já passou de 80% da capacidade.'}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
        <label>
          <span className="mb-1.5 block text-[9px] font-black uppercase tracking-wider text-koma-muted">Máximo de pedidos ativos</span>
          <input
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            placeholder="Sem limite"
            className="h-10 w-full rounded-xl border border-koma-border bg-koma-panel px-3 text-sm text-koma-foreground outline-none focus:border-emerald-500"
          />
        </label>

        <label className="flex min-h-10 items-center gap-3 rounded-xl border border-koma-border bg-koma-panel px-3 py-2">
          <input
            type="checkbox"
            checked={autoPause}
            onChange={(event) => setAutoPause(event.target.checked)}
            disabled={!capacity.trim()}
            className="h-4 w-4 accent-emerald-500"
          />
          <span>
            <strong className="block text-[10px] text-koma-foreground">Pausar automaticamente ao atingir o limite</strong>
            <small className="block text-[9px] text-koma-subtle">Desligado por padrão. A reabertura continua manual.</small>
          </span>
        </label>

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || loading}
          className="flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-[10px] font-black uppercase text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar
        </button>
      </div>

      {feedback && <p className="mt-3 text-[10px] text-koma-muted" role="status">{feedback}</p>}
    </section>
  );
}
