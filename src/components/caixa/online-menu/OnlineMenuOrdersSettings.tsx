import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Clock3, ExternalLink, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { OperationalBanner } from '../../shared/OperationalBanner';

type HourRow = {
  id: string;
  days: string;
  hours: string;
};

type OrdersConfig = {
  status_override: string;
  horarios_funcionamento: HourRow[];
};

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  publicMenuUrl: string | null;
}

const statusOptions = [
  { value: 'Automático', label: 'Automático', helper: 'Segue os horários cadastrados.' },
  { value: 'Forçado Aberto', label: 'Aberto agora', helper: 'Aceita pedidos independentemente do horário.' },
  { value: 'Forçado Fechado', label: 'Pausar pedidos', helper: 'Mostra o cardápio, mas interrompe novos pedidos.' },
] as const;

const keyToDays: Record<string, string> = {
  segunda_a_sexta: 'Segunda a Sexta',
  segunda_a_quinta: 'Segunda a Quinta',
  sexta_e_sabado: 'Sexta e Sábado',
  segunda: 'Segunda-feira',
  terca: 'Terça-feira',
  quarta: 'Quarta-feira',
  quinta: 'Quinta-feira',
  sexta: 'Sexta-feira',
  sabado: 'Sábado',
  domingo: 'Domingo',
  domingo_e_feriados: 'Domingos e Feriados',
};

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeHours(value: unknown): HourRow[] {
  const parsed = parseStructuredValue(value);
  if (Array.isArray(parsed)) {
    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry, index) => {
        const item = entry as Record<string, unknown>;
        return {
          id: `existing-${index}`,
          days: String(item.days || '').trim(),
          hours: String(item.hours || '').trim(),
        };
      })
      .filter((row) => row.days || row.hours);
  }
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed as Record<string, unknown>)
      .map(([key, value], index) => ({
        id: `existing-${index}`,
        days: keyToDays[key] || key,
        hours: String(value || '').trim(),
      }))
      .filter((row) => row.days || row.hours);
  }
  return [];
}

function normalizeConfig(data: Record<string, unknown>): OrdersConfig {
  return {
    status_override: String(data.status_override || 'Automático'),
    horarios_funcionamento: normalizeHours(data.horarios_funcionamento),
  };
}

function persistedPayload(config: OrdersConfig) {
  return {
    status_override: config.status_override,
    horarios_funcionamento: config.horarios_funcionamento
      .map(({ days, hours }) => ({ days: days.trim(), hours: hours.trim() }))
      .filter((row) => row.days && row.hours),
  };
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-koma-muted">
      {children}
    </span>
  );
}

export function OnlineMenuOrdersSettings({ apiBaseUrl, authHeaders, publicMenuUrl }: Props) {
  const [config, setConfig] = useState<OrdersConfig>({ status_override: 'Automático', horarios_funcionamento: [] });
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/config`, { headers: authHeaders, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível carregar os horários.');
      const next = normalizeConfig(data as Record<string, unknown>);
      setConfig(next);
      setSavedSnapshot(JSON.stringify(persistedPayload(next)));
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao carregar os horários.' });
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const payload = useMemo(() => persistedPayload(config), [config]);
  const hasUnsavedChanges = JSON.stringify(payload) !== savedSnapshot;
  const automaticWithoutHours = config.status_override === 'Automático' && config.horarios_funcionamento.length === 0;
  const statusLabel = config.status_override === 'Forçado Aberto'
    ? 'Aberto'
    : config.status_override === 'Forçado Fechado'
      ? 'Pausado'
      : 'Automático';

  const save = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/config`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível salvar os horários.');
      const next = normalizeConfig(data as Record<string, unknown>);
      setConfig(next);
      setSavedSnapshot(JSON.stringify(persistedPayload(next)));
      setFeedback({ type: 'success', text: 'Recebimento e horários atualizados.' });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar os horários.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-2xl border border-koma-border bg-koma-panel">
        <div className="flex items-center gap-2 text-xs font-bold text-koma-muted">
          <Loader2 size={16} className="animate-spin" /> Carregando recebimento e horários…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <OperationalBanner
        id="online-menu-orders-heading"
        eyebrow="CARDÁPIO ONLINE"
        title="Pedidos"
        accent="no horário certo"
        description="Controle quando o canal recebe novos pedidos. Pagamentos e entrega ficam em seções próprias."
        metrics={[
          { label: 'status', value: statusLabel },
          { label: 'períodos', value: config.horarios_funcionamento.length },
        ]}
      />

      {automaticWithoutHours && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.08] p-3.5 text-[10px] text-amber-700 dark:text-amber-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span><strong>Automático sem horários.</strong> Cadastre pelo menos um período para o servidor saber quando aceitar pedidos.</span>
        </div>
      )}

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4">
          <h3 className="text-sm font-black text-koma-foreground">Recebimento de pedidos</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Use o modo automático no dia a dia e os overrides apenas para exceções operacionais.</p>
        </div>
        <div className="grid gap-2.5 md:grid-cols-3">
          {statusOptions.map((option) => {
            const selected = config.status_override === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setConfig((current) => ({ ...current, status_override: option.value }))}
                className={clsx(
                  'rounded-2xl border p-3.5 text-left transition',
                  selected ? 'border-emerald-500/45 bg-emerald-500/10' : 'border-koma-border bg-koma-card hover:border-emerald-500/25',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-xs text-koma-foreground">{option.label}</strong>
                  <span className={clsx('h-2 w-2 rounded-full', selected ? 'bg-emerald-500' : 'bg-koma-border')} />
                </div>
                <span className="mt-1.5 block text-[9px] leading-relaxed text-koma-muted">{option.helper}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
            <Clock3 size={17} />
          </div>
          <div>
            <h3 className="text-sm font-black text-koma-foreground">Horários de funcionamento</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Use blocos simples, por exemplo “Segunda a Sexta · 18:00 - 23:00”.</p>
          </div>
        </div>

        <div className="space-y-2.5">
          {config.horarios_funcionamento.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-xl border border-koma-border bg-koma-card p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label>
                <FieldLabel>Dias</FieldLabel>
                <input
                  value={row.days}
                  onChange={(event) => setConfig((current) => ({
                    ...current,
                    horarios_funcionamento: current.horarios_funcionamento.map((item) => item.id === row.id ? { ...item, days: event.target.value } : item),
                  }))}
                  className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground outline-none focus:border-emerald-500/60"
                  placeholder="Segunda a Sexta"
                />
              </label>
              <label>
                <FieldLabel>Horário</FieldLabel>
                <input
                  value={row.hours}
                  onChange={(event) => setConfig((current) => ({
                    ...current,
                    horarios_funcionamento: current.horarios_funcionamento.map((item) => item.id === row.id ? { ...item, hours: event.target.value } : item),
                  }))}
                  className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground outline-none focus:border-emerald-500/60"
                  placeholder="18:00 - 23:00"
                />
              </label>
              <button
                type="button"
                onClick={() => setConfig((current) => ({ ...current, horarios_funcionamento: current.horarios_funcionamento.filter((item) => item.id !== row.id) }))}
                className="grid h-10 w-10 place-items-center rounded-lg border border-rose-500/20 text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300"
                aria-label={`Remover horário ${row.days}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          {config.horarios_funcionamento.length === 0 && (
            <div className="rounded-xl border border-dashed border-koma-border p-5 text-center text-[11px] text-koma-muted">Nenhum horário cadastrado ainda.</div>
          )}

          <button
            type="button"
            onClick={() => setConfig((current) => ({
              ...current,
              horarios_funcionamento: [...current.horarios_funcionamento, { id: `new-${Date.now()}`, days: '', hours: '' }],
            }))}
            className="inline-flex items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-[10px] font-black text-koma-secondary transition hover:border-emerald-500/40 hover:text-emerald-600"
          >
            <Plus size={13} /> Adicionar horário
          </button>
        </div>
      </section>

      <div className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-2xl border border-koma-border bg-koma-panel/95 p-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-end">
        {feedback ? (
          <span className={clsx('mr-auto inline-flex items-center gap-1.5 text-[10px] font-bold', feedback.type === 'success' ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>
            {feedback.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}{feedback.text}
          </span>
        ) : (
          <span className="mr-auto text-[10px] font-semibold text-koma-muted">{hasUnsavedChanges ? 'Há alterações que ainda não foram publicadas.' : 'Tudo salvo.'}</span>
        )}
        {publicMenuUrl && (
          <a href={publicMenuUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-4 text-[10px] font-black uppercase tracking-wider text-koma-secondary transition hover:border-emerald-500/40 hover:text-emerald-600">
            <ExternalLink size={13} /> Ver cardápio
          </a>
        )}
        <button
          type="button"
          disabled={isSaving || !hasUnsavedChanges}
          onClick={() => void save()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-4 text-[10px] font-black uppercase tracking-wider text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300 disabled:cursor-default disabled:border-koma-border disabled:bg-koma-raised disabled:text-koma-muted disabled:opacity-70"
        >
          {isSaving ? <Loader2 size={13} className="animate-spin" /> : hasUnsavedChanges ? <Save size={13} /> : <CheckCircle2 size={13} />}
          {isSaving ? 'Publicando…' : hasUnsavedChanges ? 'Salvar e publicar' : 'Tudo salvo'}
        </button>
      </div>
    </div>
  );
}
