import clsx from 'clsx';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Save,
  Sparkles,
  Truck,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

type DeliveryConfig = {
  delivery_ativo: boolean;
  pedido_minimo: number;
  frete_gratis_valor: number;
  taxa_minima: number;
  valor_por_km: number;
  delivery_origin_configured: boolean;
};

type DeliverySuggestion = {
  taxa_minima: number;
  valor_por_km: number;
  source: 'history' | 'default';
  sample_size: number;
  message: string;
};

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  publicMenuUrl?: string | null;
}

const DEFAULT_MINIMUM_FEE = 5;
const DEFAULT_PER_KM_FEE = 1;

function parseDecimalInput(value: string): number {
  const normalized = value.trim().replace(/s/g, '').replace(',', '.');
  if (!normalized || normalized === '.') return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function moneyInputValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return String(value).replace('.', ',');
}

function normalizeDistanceConfig(data: Record<string, unknown>) {
  const fixedFee = Math.max(0, Number(data.taxa_entrega_fixa) || 0);
  const rawRows = Array.isArray(data.tabela_taxas_km) ? data.tabela_taxas_km : [];
  const row = rawRows[0] && typeof rawRows[0] === 'object'
    ? rawRows[0] as Record<string, unknown>
    : {};
  const minimum = Math.max(0, Number(row.taxa_minima) || fixedFee || DEFAULT_MINIMUM_FEE);
  const explicitPerKm = Number(row.valor_por_km);
  const legacyIncludedKm = Number(row.km_inclusos);
  const legacyDerivedPerKm = minimum > 0 && legacyIncludedKm > 0
    ? minimum / legacyIncludedKm
    : Number(row.incremento_valor) / Math.max(1, Number(row.incremento_km) || 1);

  return {
    taxa_minima: minimum,
    valor_por_km: Math.max(
      0,
      Number.isFinite(explicitPerKm) && explicitPerKm >= 0
        ? explicitPerKm
        : legacyDerivedPerKm || DEFAULT_PER_KM_FEE,
    ),
  };
}

function normalizeConfig(data: Record<string, unknown>): DeliveryConfig {
  const distance = normalizeDistanceConfig(data);
  return {
    delivery_ativo: data.delivery_ativo !== false,
    pedido_minimo: Math.max(0, Number(data.pedido_minimo) || 0),
    frete_gratis_valor: Math.max(0, Number(data.frete_gratis_valor) || 0),
    taxa_minima: distance.taxa_minima,
    valor_por_km: distance.valor_por_km,
    delivery_origin_configured: data.delivery_origin_configured === true,
  };
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-koma-muted">
      {children}
    </span>
  );
}

export function OnlineMenuDeliverySettings({ apiBaseUrl, authHeaders, publicMenuUrl }: Props) {
  const [config, setConfig] = useState<DeliveryConfig>({
    delivery_ativo: true,
    pedido_minimo: 0,
    frete_gratis_valor: 0,
    taxa_minima: DEFAULT_MINIMUM_FEE,
    valor_por_km: DEFAULT_PER_KM_FEE,
    delivery_origin_configured: false,
  });
  const [minimumInput, setMinimumInput] = useState('5');
  const [perKmInput, setPerKmInput] = useState('1');
  const [orderMinimumInput, setOrderMinimumInput] = useState('');
  const [freeShippingInput, setFreeShippingInput] = useState('');
  const [suggestion, setSuggestion] = useState<DeliverySuggestion>({
    taxa_minima: DEFAULT_MINIMUM_FEE,
    valor_por_km: DEFAULT_PER_KM_FEE,
    source: 'default',
    sample_size: 0,
    message: 'Sugestão inicial enquanto ainda não há entregas concluídas suficientes.',
  });
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingOrigin, setIsSavingOrigin] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const payload = useMemo(() => {
    const taxaMinima = parseDecimalInput(minimumInput);
    return {
      delivery_ativo: config.delivery_ativo,
      pedido_minimo: parseDecimalInput(orderMinimumInput),
      frete_gratis_valor: parseDecimalInput(freeShippingInput),
      tipo_taxa_entrega: 'distancia',
      // Mantido sincronizado para consumidores legados; a política ativa é a tabela por distância.
      taxa_entrega_fixa: taxaMinima,
      tabela_taxas_bairros: [],
      tabela_taxas_km: [{
        taxa_minima: taxaMinima,
        valor_por_km: parseDecimalInput(perKmInput),
        fallback_sem_localizacao: 'minima',
      }],
    };
  }, [config.delivery_ativo, freeShippingInput, minimumInput, orderMinimumInput, perKmInput]);

  const applyLoadedConfig = useCallback((data: Record<string, unknown>) => {
    const next = normalizeConfig(data);
    setConfig(next);
    setMinimumInput(moneyInputValue(next.taxa_minima));
    setPerKmInput(moneyInputValue(next.valor_por_km));
    setOrderMinimumInput(moneyInputValue(next.pedido_minimo));
    setFreeShippingInput(moneyInputValue(next.frete_gratis_valor));
    return {
      delivery_ativo: next.delivery_ativo,
      pedido_minimo: next.pedido_minimo,
      frete_gratis_valor: next.frete_gratis_valor,
      tipo_taxa_entrega: 'distancia',
      taxa_entrega_fixa: next.taxa_minima,
      tabela_taxas_bairros: [],
      tabela_taxas_km: [{
        taxa_minima: next.taxa_minima,
        valor_por_km: next.valor_por_km,
        fallback_sem_localizacao: 'minima',
      }],
    };
  }, []);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const [configResponse, suggestionResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/caixa/configuracoes`, { headers: authHeaders, cache: 'no-store' }),
        fetch(`${apiBaseUrl}/caixa/configuracoes/delivery-suggestion`, { headers: authHeaders, cache: 'no-store' }),
      ]);
      const data = await configResponse.json().catch(() => ({}));
      if (!configResponse.ok) throw new Error(data.detail || 'Não foi possível carregar as regras de entrega.');
      const initialPayload = applyLoadedConfig(data as Record<string, unknown>);
      setSavedSnapshot(JSON.stringify(initialPayload));

      const suggestionData = await suggestionResponse.json().catch(() => null);
      if (suggestionResponse.ok && suggestionData) {
        setSuggestion({
          taxa_minima: Number(suggestionData.taxa_minima) || DEFAULT_MINIMUM_FEE,
          valor_por_km: Number(suggestionData.valor_por_km) || DEFAULT_PER_KM_FEE,
          source: suggestionData.source === 'history' ? 'history' : 'default',
          sample_size: Number(suggestionData.sample_size) || 0,
          message: String(suggestionData.message || ''),
        });
      }
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao carregar entrega.' });
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, applyLoadedConfig, authHeaders]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const hasUnsavedChanges = JSON.stringify(payload) !== savedSnapshot;

  const useSuggestion = () => {
    setMinimumInput(moneyInputValue(suggestion.taxa_minima));
    setPerKmInput(moneyInputValue(suggestion.valor_por_km));
    setFeedback({
      type: 'success',
      text: 'Sugestão aplicada aos campos. Revise e salve quando estiver de acordo.',
    });
  };

  const refreshSuggestion = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/caixa/configuracoes/delivery-suggestion`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível recalcular a sugestão.');
      setSuggestion({
        taxa_minima: Number(data.taxa_minima) || DEFAULT_MINIMUM_FEE,
        valor_por_km: Number(data.valor_por_km) || DEFAULT_PER_KM_FEE,
        source: data.source === 'history' ? 'history' : 'default',
        sample_size: Number(data.sample_size) || 0,
        message: String(data.message || ''),
      });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao recalcular a sugestão.' });
    }
  }, [apiBaseUrl, authHeaders]);

  const saveRestaurantOrigin = () => {
    if (!navigator.geolocation) {
      setFeedback({ type: 'error', text: 'Este navegador não oferece acesso à localização.' });
      return;
    }
    setIsSavingOrigin(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch(`${apiBaseUrl}/caixa/configuracoes/delivery-origin`, {
            method: 'PUT',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.detail || 'Não foi possível salvar a localização do restaurante.');
          setConfig((current) => ({ ...current, delivery_origin_configured: true }));
          setFeedback({ type: 'success', text: 'Ponto de partida atualizado.' });
          void refreshSuggestion();
        } catch (error) {
          setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao salvar a localização do restaurante.' });
        } finally {
          setIsSavingOrigin(false);
        }
      },
      () => {
        setIsSavingOrigin(false);
        setFeedback({ type: 'error', text: 'Localização não autorizada. Faça isso em um dispositivo que esteja no restaurante.' });
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 120_000 },
    );
  };

  const save = async () => {
    if (payload.tabela_taxas_km[0].taxa_minima <= 0) {
      setFeedback({ type: 'error', text: 'Informe uma taxa mínima maior que zero.' });
      return;
    }
    if (payload.tabela_taxas_km[0].valor_por_km <= 0) {
      setFeedback({ type: 'error', text: 'Informe um valor por km maior que zero.' });
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${apiBaseUrl}/caixa/configuracoes`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível salvar as regras de entrega.');
      const persisted = applyLoadedConfig(data as Record<string, unknown>);
      setSavedSnapshot(JSON.stringify(persisted));
      setFeedback({ type: 'success', text: 'Entrega automática atualizada.' });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar entrega.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-2xl border border-koma-border bg-koma-panel">
        <div className="flex items-center gap-2 text-xs font-bold text-koma-muted">
          <Loader2 size={16} className="animate-spin" /> Carregando entrega…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <header className="flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-panel px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-black text-koma-foreground">Entrega</h2>
            <span className={clsx(
              'rounded-full border px-2 py-0.5 text-[9px] font-black',
              config.delivery_ativo
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-koma-border bg-koma-card text-koma-muted',
            )}>
              {config.delivery_ativo ? 'Ativa' : 'Pausada'}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">
            A taxa é sempre calculada automaticamente pela distância. Você controla apenas os dois valores da regra.
          </p>
        </div>
        {publicMenuUrl && (
          <a
            href={publicMenuUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 text-[10px] font-black text-koma-secondary transition hover:border-emerald-500/40 hover:text-emerald-600"
          >
            <ExternalLink size={13} /> Ver cardápio
          </a>
        )}
      </header>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
              <Truck size={17} />
            </div>
            <div>
              <h3 className="text-sm font-black text-koma-foreground">Aceitar entregas</h3>
              <p className="mt-1 text-[10px] text-koma-muted">Desative somente quando o restaurante não estiver atendendo delivery.</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.delivery_ativo}
            onClick={() => setConfig((current) => ({ ...current, delivery_ativo: !current.delivery_ativo }))}
            className={clsx(
              'inline-flex min-w-28 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black transition',
              config.delivery_ativo
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-koma-border bg-koma-raised text-koma-muted',
            )}
          >
            <span className={clsx('h-2 w-2 rounded-full', config.delivery_ativo ? 'bg-emerald-500' : 'bg-koma-border')} />
            {config.delivery_ativo ? 'Ativa' : 'Pausada'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" id="online-menu-delivery-fee">
        <div className="mb-4 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
            <MapPin size={17} />
          </div>
          <div>
            <h3 className="text-sm font-black text-koma-foreground">Taxa de entrega automática</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
              O KÔMA mede a distância do restaurante ao cliente e aplica a taxa mínima ou o valor por km, o que for maior.
            </p>
          </div>
        </div>

        <div className={clsx(
          'rounded-xl border p-4',
          config.delivery_origin_configured
            ? 'border-emerald-500/20 bg-emerald-500/5'
            : 'border-amber-500/25 bg-amber-500/5',
        )}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <strong className="text-xs text-koma-foreground">Ponto de partida</strong>
              <p className="mt-1 text-[9px] text-koma-muted">
                {config.delivery_origin_configured
                  ? 'Localização do restaurante definida para calcular as distâncias.'
                  : 'Defina a localização do restaurante antes de usar o cálculo automático.'}
              </p>
            </div>
            <button
              type="button"
              onClick={saveRestaurantOrigin}
              disabled={isSavingOrigin}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 text-[10px] font-black text-koma-secondary transition hover:border-emerald-500/35 disabled:cursor-wait disabled:opacity-60"
            >
              {isSavingOrigin ? <Loader2 size={13} className="animate-spin" /> : <MapPin size={13} />}
              {isSavingOrigin ? 'Salvando…' : config.delivery_origin_configured ? 'Atualizar localização' : 'Definir localização'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2.5">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-emerald-500" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-xs text-koma-foreground">Sugestão do KÔMA</strong>
                  <span className="rounded-full border border-koma-border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-koma-muted">
                    {suggestion.source === 'history' ? `${suggestion.sample_size} entregas` : 'base inicial'}
                  </span>
                </div>
                <p className="mt-1 text-[10px] font-semibold text-koma-secondary">
                  R$ {suggestion.taxa_minima.toFixed(2).replace('.', ',')} mínimo + R$ {suggestion.valor_por_km.toFixed(2).replace('.', ',')} por km
                </p>
                <p className="mt-1 text-[9px] leading-relaxed text-koma-muted">{suggestion.message}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={useSuggestion}
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-[10px] font-black text-emerald-700 transition hover:bg-emerald-500/15 dark:text-emerald-300"
            >
              Usar sugestão
            </button>
          </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label>
            <FieldLabel>Taxa mínima (R$)</FieldLabel>
            <input
              type="text"
              inputMode="decimal"
              value={minimumInput}
              onChange={(event) => setMinimumInput(event.target.value.replace(/[^0-9.,]/g, ''))}
              className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm font-mono text-koma-foreground outline-none focus:border-emerald-500/60"
              placeholder="5,00"
              aria-label="Taxa mínima de entrega"
            />
            <span className="mt-1 block text-[9px] text-koma-muted">Menor valor que uma entrega pode custar.</span>
          </label>
          <label>
            <FieldLabel>Valor por km (R$)</FieldLabel>
            <input
              type="text"
              inputMode="decimal"
              value={perKmInput}
              onChange={(event) => setPerKmInput(event.target.value.replace(/[^0-9.,]/g, ''))}
              className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm font-mono text-koma-foreground outline-none focus:border-emerald-500/60"
              placeholder="1,00"
              aria-label="Valor por km da entrega"
            />
            <span className="mt-1 block text-[9px] text-koma-muted">Aceita vírgula: por exemplo, 0,50.</span>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4">
          <h3 className="text-sm font-black text-koma-foreground">Limites opcionais</h3>
          <p className="mt-1 text-[10px] text-koma-muted">Deixe vazio para não aplicar pedido mínimo ou frete grátis.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <FieldLabel>Pedido mínimo (R$)</FieldLabel>
            <input
              type="text"
              inputMode="decimal"
              value={orderMinimumInput}
              onChange={(event) => setOrderMinimumInput(event.target.value.replace(/[^0-9.,]/g, ''))}
              className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm font-mono text-koma-foreground outline-none focus:border-emerald-500/60"
              placeholder="Sem mínimo"
            />
          </label>
          <label>
            <FieldLabel>Frete grátis a partir de (R$)</FieldLabel>
            <input
              type="text"
              inputMode="decimal"
              value={freeShippingInput}
              onChange={(event) => setFreeShippingInput(event.target.value.replace(/[^0-9.,]/g, ''))}
              className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm font-mono text-koma-foreground outline-none focus:border-emerald-500/60"
              placeholder="Sem frete grátis"
            />
          </label>
        </div>
      </section>

      {(feedback || hasUnsavedChanges) && (
        <div className="flex flex-col gap-2 rounded-2xl border border-koma-border bg-koma-panel p-3 sm:flex-row sm:items-center sm:justify-end">
          {feedback ? (
            <span className={clsx(
              'mr-auto inline-flex items-center gap-1.5 text-[10px] font-bold',
              feedback.type === 'success'
                ? 'text-emerald-600 dark:text-emerald-300'
                : 'text-rose-600 dark:text-rose-300',
            )}>
              {feedback.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
              {feedback.text}
            </span>
          ) : (
            <span className="mr-auto text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              Alterações ainda não publicadas.
            </span>
          )}
          {hasUnsavedChanges && (
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void save()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-4 text-[10px] font-black uppercase tracking-wider text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300 disabled:cursor-wait disabled:opacity-70"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {isSaving ? 'Publicando…' : 'Salvar e publicar'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
