import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';
import { ONBOARDING_SETUP_MODE_KEY, useUnsavedSetupChanges } from '../../onboarding/setupNavigation';
import { fetchCardapioDigitalConfig, updateCardapioDigitalConfigCache } from './cardapioDigitalConfigClient';
import clsx from 'clsx';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Settings2,
  Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

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
  onSetupComplete?: () => Promise<void>;
  onSetupDirtyChange?: (dirty: boolean) => void;
  onSetupSavingChange?: (saving: boolean) => void;
}

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

function readSetupMode(): boolean {
  try {
    return sessionStorage.getItem(ONBOARDING_SETUP_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

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
    <span className="mb-1.5 block text-xs font-semibold text-koma-secondary">
      {children}
    </span>
  );
}

function openInitialSetup() {
  try {
    sessionStorage.removeItem(ONBOARDING_SETUP_MODE_KEY);
  } catch {
    // A navegação continua funcionando sem storage.
  }
  window.location.href = '/ativar?resume=1';
}

export function OnlineMenuOrdersSettings({ apiBaseUrl, authHeaders, publicMenuUrl, onSetupComplete, onSetupDirtyChange, onSetupSavingChange }: Props) {
  const [config, setConfig] = useState<OrdersConfig>({ status_override: 'Automático', horarios_funcionamento: [] });
  const [scheduledOrdersEnabled, setScheduledOrdersEnabled] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => { onSetupSavingChange?.(isSaving); }, [isSaving, onSetupSavingChange]);
  const [isSavingScheduledOrders, setIsSavingScheduledOrders] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const guidedMode = Boolean(onSetupComplete);
  const setupMode = guidedMode || readSetupMode();

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const authorization = authHeaders.Authorization || authHeaders.authorization || '';
      const [data, scheduledOrdersResponse] = await Promise.all([
        fetchCardapioDigitalConfig<Record<string, unknown>>(apiBaseUrl, authorization),
        guidedMode ? Promise.resolve(null) : fetch(`${apiBaseUrl}/api/restaurant-features/scheduled-orders`, { headers: authHeaders, cache: 'no-store' }),
      ]);
      const scheduledOrdersData = await scheduledOrdersResponse?.json().catch(() => ({})) || {};
      if (scheduledOrdersResponse && !scheduledOrdersResponse.ok) throw new Error(scheduledOrdersData.detail || 'Não foi possível carregar a configuração de agendamento.');
      const next = normalizeConfig(data);
      setConfig(next);
      setHasLoadedConfig(true);
      setScheduledOrdersEnabled(Boolean(scheduledOrdersData.enabled));
      setSavedSnapshot(JSON.stringify(persistedPayload(next)));
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao carregar o funcionamento.' });
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders, guidedMode]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!feedback || feedback.type === 'error') return;
    const timer = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const payload = useMemo(() => persistedPayload(config), [config]);
  const hasUnsavedChanges = JSON.stringify(payload) !== savedSnapshot;
  const automaticWithoutHours = config.status_override === 'Automático' && config.horarios_funcionamento.length === 0;
  const incompleteHours = config.horarios_funcionamento.some(row => !row.days.trim() || !row.hours.trim());
  const markSaved = useUnsavedSetupChanges(setupMode && (hasUnsavedChanges || incompleteHours));
  useEffect(() => { onSetupDirtyChange?.(!isLoading && (hasUnsavedChanges || incompleteHours)); }, [isLoading, hasUnsavedChanges, incompleteHours, onSetupDirtyChange]);
  const legacyOverrideActive = config.status_override !== 'Automático';

  const save = async () => {
    if (guidedMode && !hasLoadedConfig) return;
    if (onSetupComplete && config.horarios_funcionamento.length === 0) {
      setFeedback({ type: 'error', text: 'Adicione ao menos um horário para continuar.' });
      return;
    }
    if (incompleteHours) {
      setFeedback({ type: 'error', text: 'Preencha os dias e o horário de cada linha ou remova a linha incompleta.' });
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/config`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível salvar o funcionamento.');
      const authorization = authHeaders.Authorization || authHeaders.authorization || '';
      updateCardapioDigitalConfigCache(apiBaseUrl, authorization, data);
      const next = normalizeConfig(data as Record<string, unknown>);
      setConfig(next);
      setSavedSnapshot(JSON.stringify(persistedPayload(next)));
      setFeedback({ type: 'success', text: 'Funcionamento atualizado.' });
      if (setupMode && next.horarios_funcionamento.length > 0) {
        if (onSetupComplete) await onSetupComplete();
        else openInitialSetup();
        markSaved();
      }
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar o funcionamento.' });
    } finally {
      setIsSaving(false);
    }
  };

  const updateScheduledOrders = async (enabled: boolean) => {
    const previous = scheduledOrdersEnabled;
    setScheduledOrdersEnabled(enabled);
    setIsSavingScheduledOrders(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/restaurant-features/scheduled-orders`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível atualizar os pedidos agendados.');
      const persistedEnabled = Boolean(data.enabled);
      setScheduledOrdersEnabled(persistedEnabled);
      window.dispatchEvent(new CustomEvent('koma_scheduled_orders_feature_updated', {
        detail: { enabled: persistedEnabled },
      }));
      setFeedback({
        type: 'success',
        text: persistedEnabled ? 'Pedidos agendados ativados.' : 'Pedidos agendados desativados.',
      });
    } catch (error) {
      setScheduledOrdersEnabled(previous);
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Erro ao atualizar os pedidos agendados.',
      });
    } finally {
      setIsSavingScheduledOrders(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid min-h-[300px] place-items-center rounded-2xl border border-koma-border bg-koma-panel">
        <div className="flex items-center gap-2 text-xs font-semibold text-koma-muted">
          <Loader2 size={16} className="animate-spin" /> Carregando pedidos online…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <header className="flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-panel px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h2
            className="text-base font-bold text-koma-foreground"
            style={{ fontFamily: 'var(--koma-font-display)' }}
          >
            {setupMode ? 'Horários do restaurante' : 'Pedidos online'}
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-koma-muted">
            O cardápio fica disponível para consulta e aceita pedidos quando o caixa está aberto e sincronizado. O horário cadastrado é apenas informativo.
          </p>
        </div>
        {publicMenuUrl && (
          <a
            href={publicMenuUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3.5 text-xs font-semibold text-koma-foreground transition hover:bg-koma-card"
          >
            <ExternalLink size={14} aria-hidden="true" />
            <span>Ver cardápio</span>
          </a>
        )}
      </header>

      {legacyOverrideActive && (
        <div
          className="flex flex-col gap-3 rounded-2xl border p-3.5 sm:flex-row sm:items-center sm:justify-between"
          style={{
            background: 'var(--koma-warning-bg)',
            borderColor: 'var(--koma-warning-border)',
            color: 'var(--koma-warning-text)',
          }}
        >
          <div className="flex items-start gap-2 text-xs">
            <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Há uma exceção antiga ativa: <strong>{config.status_override}</strong>. O fluxo atual acompanha o caixa e a pausa operacional dedicada.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setConfig((current) => ({ ...current, status_override: 'Automático' }))}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border px-3.5 text-xs font-semibold"
            style={{ borderColor: 'var(--koma-warning-border)' }}
          >
            Voltar ao automático
          </button>
        </div>
      )}

      {automaticWithoutHours && (
        <div
          className="flex items-start gap-2 rounded-2xl border p-3.5 text-xs"
          style={{
            background: 'var(--koma-warning-bg)',
            borderColor: 'var(--koma-warning-border)',
            color: 'var(--koma-warning-text)',
          }}
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span><strong>Horários ainda não configurados.</strong> Adicione os dias e horários abaixo.</span>
        </div>
      )}

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" id="online-menu-operating-hours">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border"
              style={{
                background: 'var(--koma-success-bg)',
                borderColor: 'var(--koma-success-border)',
                color: 'var(--koma-success-text)',
              }}
            >
              <Clock3 size={18} aria-hidden="true" />
            </div>
            <div>
              <h3
                className="text-sm font-bold text-koma-foreground"
                style={{ fontFamily: 'var(--koma-font-display)' }}
              >
                Horário do estabelecimento
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-koma-muted">
                Agrupe dias com o mesmo horário, como “Terça a domingo”. Para passar da meia-noite, use “18:00 - 01:00”. Dias fechados podem ficar fora da lista.
              </p>
            </div>
          </div>
          {!setupMode && (
            <button
              type="button"
              onClick={openInitialSetup}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3.5 text-xs font-semibold text-koma-foreground transition hover:bg-koma-card"
            >
              <Settings2 size={14} aria-hidden="true" />
              <span>Revisar configuração</span>
            </button>
          )}
        </div>

        {setupMode ? (
          <div className="mt-4 space-y-2.5">
            {config.horarios_funcionamento.map((row) => (
              <div key={row.id} className="grid gap-2.5 rounded-xl border border-koma-border bg-koma-card p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label>
                  <FieldLabel>Dias</FieldLabel>
                  <input
                    disabled={guidedMode && isSaving}
                    value={row.days}
                    onChange={(event) => setConfig((current) => ({
                      ...current,
                      horarios_funcionamento: current.horarios_funcionamento.map((item) => item.id === row.id ? { ...item, days: event.target.value } : item),
                    }))}
                    className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground outline-none focus:border-koma-border-strong"
                    placeholder="Segunda a Sexta"
                  />
                </label>
                <label>
                  <FieldLabel>Horário</FieldLabel>
                  <input
                    disabled={guidedMode && isSaving}
                    value={row.hours}
                    onChange={(event) => setConfig((current) => ({
                      ...current,
                      horarios_funcionamento: current.horarios_funcionamento.map((item) => item.id === row.id ? { ...item, hours: event.target.value } : item),
                    }))}
                    className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm tabular-nums text-koma-foreground outline-none focus:border-koma-border-strong"
                    placeholder="18:00 - 23:00"
                  />
                </label>
                <button
                  type="button"
                  disabled={guidedMode && isSaving}
                  onClick={() => setConfig((current) => ({
                    ...current,
                    horarios_funcionamento: current.horarios_funcionamento.filter((item) => item.id !== row.id),
                  }))}
                  className="grid h-11 w-11 place-items-center rounded-xl border transition"
                  style={{
                    background: 'var(--koma-danger-bg)',
                    borderColor: 'var(--koma-danger-border)',
                    color: 'var(--koma-danger-text)',
                  }}
                  aria-label={`Remover horário ${row.days}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}

            {config.horarios_funcionamento.length === 0 && (
              <div className="rounded-xl border border-dashed border-koma-border p-5 text-center text-xs text-koma-muted">
                Nenhum horário cadastrado ainda.
              </div>
            )}

            <button
              type="button"
              disabled={guidedMode && isSaving}
              onClick={() => setConfig((current) => ({
                ...current,
                status_override: 'Automático',
                horarios_funcionamento: [...current.horarios_funcionamento, { id: `new-${Date.now()}`, days: '', hours: '' }],
              }))}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3.5 text-xs font-semibold text-koma-foreground transition hover:bg-koma-card"
            >
              <Plus size={14} aria-hidden="true" />
              <span>Adicionar horário</span>
            </button>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-koma-border bg-koma-card">
            {config.horarios_funcionamento.length > 0 ? config.horarios_funcionamento.map((row, index) => (
              <div
                key={row.id}
                className={clsx(
                  'flex items-center justify-between gap-4 px-3.5 py-3 text-xs',
                  index > 0 && 'border-t border-koma-border',
                )}
              >
                <span className="font-semibold text-koma-secondary">{row.days}</span>
                <span className="font-semibold tabular-nums text-koma-foreground">{row.hours}</span>
              </div>
            )) : (
              <div className="px-3.5 py-4 text-center text-xs text-koma-muted">Nenhum horário cadastrado.</div>
            )}
          </div>
        )}
      </section>

      {!onSetupComplete && (
        <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border"
                style={{
                  background: 'var(--koma-success-bg)',
                  borderColor: 'var(--koma-success-border)',
                  color: 'var(--koma-success-text)',
                }}
              >
                <CalendarClock size={18} aria-hidden="true" />
              </div>
              <div>
                <h3
                  className="text-sm font-bold text-koma-foreground"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  Pedidos agendados
                </h3>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-koma-muted">
                  Ative somente se quiser aceitar pedidos para um horário futuro.
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={scheduledOrdersEnabled}
              aria-label="Permitir pedidos agendados"
              disabled={isSavingScheduledOrders}
              onClick={() => void updateScheduledOrders(!scheduledOrdersEnabled)}
              className="relative h-7 w-12 shrink-0 rounded-full border transition disabled:cursor-wait disabled:opacity-60"
              style={
                scheduledOrdersEnabled
                  ? {
                      background: 'var(--koma-success-bg)',
                      borderColor: 'var(--koma-success-border)',
                    }
                  : {
                      background: 'var(--koma-surface-raised)',
                      borderColor: 'var(--koma-border-default)',
                    }
              }
            >
              <span
                className={clsx(
                  'absolute top-1 h-[18px] w-[18px] rounded-full transition-all',
                  scheduledOrdersEnabled ? 'left-[25px]' : 'left-1',
                )}
                style={{
                  background: scheduledOrdersEnabled ? 'var(--koma-action-bg)' : 'var(--koma-text-muted)',
                }}
              />
            </button>
          </div>
        </section>
      )}

      {(feedback || hasUnsavedChanges || incompleteHours || onSetupComplete) && (
        <div className="flex flex-col gap-2 rounded-2xl border border-koma-border bg-koma-panel p-3 sm:flex-row sm:items-center sm:justify-end">
          {feedback ? (
            <span
              role={feedback.type === 'error' ? 'alert' : 'status'}
              className="mr-auto inline-flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: feedback.type === 'success' ? 'var(--koma-success-text)' : 'var(--koma-danger-text)' }}
            >
              {feedback.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {feedback.text}
            </span>
          ) : (
            <span className="mr-auto text-xs font-semibold" style={{ color: 'var(--koma-warning-text)' }}>
              {hasUnsavedChanges ? 'Alterações ainda não publicadas.' : 'Confira os horários e continue.'}
            </span>
          )}
          {(hasUnsavedChanges || incompleteHours || Boolean(onSetupComplete)) && (
            <button
              type="button"
              disabled={isSaving || (guidedMode && !hasLoadedConfig)}
              onClick={() => void save()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-70"
              style={{
                background: 'var(--koma-action-bg)',
                color: 'var(--koma-action-text)',
              }}
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>
                {isSaving
                  ? 'Salvando…'
                  : onSetupComplete
                    ? 'Salvar e continuar'
                    : setupMode
                      ? 'Salvar e voltar para implantação'
                      : 'Salvar automático'}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
