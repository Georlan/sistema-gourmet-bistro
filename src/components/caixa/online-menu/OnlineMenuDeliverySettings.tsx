import clsx from 'clsx';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, MapPin, Plus, Save, Trash2, Truck } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

type BairroTaxaRow = {
  id: string;
  bairro: string;
  taxa: number;
};

type DistanceFeeRow = {
  taxa_minima: number;
  km_inclusos: number;
  incremento_valor: number;
  incremento_km: number;
  taxa_maxima: number;
  distancia_maxima_km: number;
};

type DeliveryFeeMode = 'fixa' | 'bairro' | 'distancia';

type DeliveryConfig = {
  delivery_ativo: boolean;
  pedido_minimo: number;
  frete_gratis_valor: number;
  tipo_taxa_entrega: DeliveryFeeMode;
  taxa_entrega_fixa: number;
  tabela_taxas_bairros: BairroTaxaRow[];
  tabela_taxas_km: DistanceFeeRow[];
  delivery_origin_configured: boolean;
};

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  publicMenuUrl?: string | null;
}

function normalizeNeighborhoods(value: unknown): BairroTaxaRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const row = item as Record<string, unknown>;
      return {
        id: `bairro-${index}`,
        bairro: String(row.bairro || '').trim(),
        taxa: Number(row.taxa) || 0,
      };
    })
    .filter((row) => row.bairro);
}

function suggestedDistanceConfig(baseFee: number): DistanceFeeRow {
  const minimum = Math.max(0, Number(baseFee) || 5);
  return {
    taxa_minima: minimum,
    km_inclusos: 3,
    incremento_valor: 1,
    incremento_km: 3,
    taxa_maxima: minimum + 2,
    distancia_maxima_km: 0,
  };
}

function normalizeDistanceConfig(value: unknown, baseFee: number): DistanceFeeRow[] {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== 'object') return [];
  const row = value[0] as Record<string, unknown>;
  return [{
    taxa_minima: Math.max(0, Number(row.taxa_minima) || Number(baseFee) || 0),
    km_inclusos: Math.max(0.01, Number(row.km_inclusos) || 3),
    incremento_valor: Math.max(0, Number(row.incremento_valor) || 0),
    incremento_km: Math.max(0.01, Number(row.incremento_km) || 3),
    taxa_maxima: Math.max(0, Number(row.taxa_maxima) || 0),
    distancia_maxima_km: Math.max(0, Number(row.distancia_maxima_km) || 0),
  }];
}

function normalizeConfig(data: Record<string, unknown>): DeliveryConfig {
  const fixedFee = Number(data.taxa_entrega_fixa ?? 0);
  const rawMode = data.tipo_taxa_entrega;
  const mode: DeliveryFeeMode = rawMode === 'bairro'
    ? 'bairro'
    : rawMode === 'distancia'
      ? 'distancia'
      : 'fixa';
  const distanceRows = normalizeDistanceConfig(data.tabela_taxas_km, fixedFee);
  return {
    delivery_ativo: data.delivery_ativo !== false,
    pedido_minimo: Number(data.pedido_minimo) || 0,
    frete_gratis_valor: Number(data.frete_gratis_valor) || 0,
    tipo_taxa_entrega: mode,
    taxa_entrega_fixa: fixedFee,
    tabela_taxas_bairros: normalizeNeighborhoods(data.tabela_taxas_bairros),
    tabela_taxas_km: mode === 'distancia' && distanceRows.length === 0
      ? [suggestedDistanceConfig(fixedFee)]
      : distanceRows,
    delivery_origin_configured: data.delivery_origin_configured === true,
  };
}

function persistedPayload(config: DeliveryConfig) {
  const neighborhoods = config.tabela_taxas_bairros
    .map(({ bairro, taxa }) => ({ bairro: bairro.trim(), taxa: Math.max(0, Number(taxa) || 0) }))
    .filter((row) => row.bairro);
  const distanceRows = config.tabela_taxas_km.slice(0, 1).map((row) => ({
    taxa_minima: Math.max(0, Number(row.taxa_minima) || 0),
    km_inclusos: Math.max(0, Number(row.km_inclusos) || 0),
    incremento_valor: Math.max(0, Number(row.incremento_valor) || 0),
    incremento_km: Math.max(0, Number(row.incremento_km) || 0),
    taxa_maxima: Math.max(0, Number(row.taxa_maxima) || 0),
    distancia_maxima_km: Math.max(0, Number(row.distancia_maxima_km) || 0),
    fallback_sem_localizacao: 'minima',
  }));
  return {
    delivery_ativo: config.delivery_ativo,
    pedido_minimo: Math.max(0, Number(config.pedido_minimo) || 0),
    frete_gratis_valor: Math.max(0, Number(config.frete_gratis_valor) || 0),
    tipo_taxa_entrega: config.tipo_taxa_entrega,
    taxa_entrega_fixa: Math.max(0, Number(config.taxa_entrega_fixa) || 0),
    tabela_taxas_bairros: neighborhoods,
    tabela_taxas_km: distanceRows,
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
    tipo_taxa_entrega: 'fixa',
    taxa_entrega_fixa: 0,
    tabela_taxas_bairros: [],
    tabela_taxas_km: [],
    delivery_origin_configured: false,
  });
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingOrigin, setIsSavingOrigin] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/caixa/configuracoes`, { headers: authHeaders, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível carregar as regras de entrega.');
      const next = normalizeConfig(data as Record<string, unknown>);
      setConfig(next);
      setSavedSnapshot(JSON.stringify(persistedPayload(next)));
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao carregar entrega e áreas.' });
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

  const chooseFeeMode = (mode: DeliveryFeeMode) => {
    if (mode === config.tipo_taxa_entrega) return;
    setConfig((current) => ({
      ...current,
      tipo_taxa_entrega: mode,
      tabela_taxas_bairros:
        mode === 'bairro' && current.tabela_taxas_bairros.length === 0
          ? [{ id: `bairro-${Date.now()}`, bairro: '', taxa: 0 }]
          : current.tabela_taxas_bairros,
      tabela_taxas_km:
        mode === 'distancia' && current.tabela_taxas_km.length === 0
          ? [suggestedDistanceConfig(current.taxa_entrega_fixa)]
          : current.tabela_taxas_km,
    }));
  };

  const distanceConfig = config.tabela_taxas_km[0] || suggestedDistanceConfig(config.taxa_entrega_fixa);
  const distancePreview = useMemo(() => {
    const rows: Array<{ limit: number; fee: number }> = [];
    const maxRows = 4;
    for (let index = 0; index < maxRows; index += 1) {
      const limit = distanceConfig.km_inclusos + (index * distanceConfig.incremento_km);
      const rawFee = distanceConfig.taxa_minima + (index * distanceConfig.incremento_valor);
      const fee = distanceConfig.taxa_maxima > 0 ? Math.min(rawFee, distanceConfig.taxa_maxima) : rawFee;
      rows.push({ limit, fee });
      if (distanceConfig.taxa_maxima > 0 && fee >= distanceConfig.taxa_maxima) break;
    }
    return rows;
  }, [distanceConfig]);

  const updateDistanceConfig = (patch: Partial<DistanceFeeRow>) => {
    setConfig((current) => ({
      ...current,
      tabela_taxas_km: [{ ...(current.tabela_taxas_km[0] || suggestedDistanceConfig(current.taxa_entrega_fixa)), ...patch }],
    }));
  };

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
          setFeedback({ type: 'success', text: 'Localização do restaurante definida para o cálculo de distância.' });
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
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  };

  const save = async () => {
    if (config.tipo_taxa_entrega === 'bairro' && payload.tabela_taxas_bairros.length === 0) {
      setFeedback({ type: 'error', text: 'Cadastre pelo menos um bairro para usar cobrança por bairro.' });
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
      const next = normalizeConfig(data as Record<string, unknown>);
      setConfig(next);
      setSavedSnapshot(JSON.stringify(persistedPayload(next)));
      setFeedback({ type: 'success', text: 'Configurações de entrega salvas.' });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar entrega e áreas.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-2xl border border-koma-border bg-koma-panel">
        <div className="flex items-center gap-2 text-xs font-bold text-koma-muted">
          <Loader2 size={16} className="animate-spin" /> Carregando entrega e áreas…
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
                : 'border-koma-border bg-koma-card text-koma-muted'
            )}>
              {config.delivery_ativo ? 'Ativa' : 'Pausada'}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">
            Defina onde entregar e quanto cobrar.
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
              <h3 className="text-sm font-black text-koma-foreground">Aceitar pedidos para entrega</h3>
              <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">
                Ative ou pause o recebimento de delivery no cardápio online.
              </p>
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

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
            <MapPin size={17} />
          </div>
          <div>
            <h3 className="text-sm font-black text-koma-foreground">Como cobrar a entrega</h3>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">Escolha a regra que combina com a operação. O KÔMA calcula a taxa final no servidor.</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {([
            ['fixa', 'Taxa única', 'Mesmo valor em todas as entregas.'],
            ['bairro', 'Taxa por bairro', 'Defina o valor de cada bairro atendido.'],
            ['distancia', 'Automático por distância', 'Taxa mínima com aumento progressivo, sem API paga.'],
          ] as const).map(([mode, title, description]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={config.tipo_taxa_entrega === mode}
              onClick={() => chooseFeeMode(mode)}
              className={clsx(
                'rounded-xl border p-3 text-left transition',
                config.tipo_taxa_entrega === mode
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : 'border-koma-border bg-koma-card hover:border-emerald-500/25',
              )}
            >
              <strong className="block text-xs text-koma-foreground">{title}</strong>
              <span className="mt-1 block text-[9px] leading-relaxed text-koma-muted">{description}</span>
            </button>
          ))}
        </div>

        {config.tipo_taxa_entrega === 'fixa' && (
          <div className="mt-4 rounded-xl border border-koma-border bg-koma-card p-4">
            <label className="block max-w-xs">
              <FieldLabel>Valor da taxa única (R$)</FieldLabel>
              <input
                type="number"
                min="0"
                step="0.01"
                value={config.taxa_entrega_fixa || ''}
                onChange={(event) => setConfig((current) => ({ ...current, taxa_entrega_fixa: Number(event.target.value) || 0 }))}
                className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs font-mono text-koma-foreground outline-none focus:border-emerald-500/60"
                placeholder="0,00"
              />
              <span className="mt-1 block text-[9px] text-koma-muted">Cobrado em todas as entregas realizadas pelo cardápio.</span>
            </label>
          </div>
        )}

        {config.tipo_taxa_entrega === 'bairro' && (
          <div className="mt-4 border-t border-koma-border pt-4">
            <div className="mb-4 rounded-xl border border-koma-border bg-koma-card p-4">
              <label className="block max-w-sm">
                <FieldLabel>Taxa padrão para outros bairros (R$)</FieldLabel>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={config.taxa_entrega_fixa || ''}
                  onChange={(event) => setConfig((current) => ({ ...current, taxa_entrega_fixa: Number(event.target.value) || 0 }))}
                  className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs font-mono text-koma-foreground outline-none focus:border-emerald-500/60"
                  placeholder="0,00"
                />
                <span className="mt-1.5 block text-[9px] leading-relaxed text-koma-muted">
                  Cobrada caso o cliente digite um bairro que ainda não está na lista abaixo. Garante que a operação nunca seja travada.
                </span>
              </label>
            </div>

            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-xs font-black text-koma-foreground">Bairros com taxa diferenciada</h4>
                <p className="mt-1 text-[9px] leading-relaxed text-koma-muted">Cadastre os bairros atendidos. O cliente poderá selecioná-los rapidamente no cardápio.</p>
              </div>
              <button
                type="button"
                onClick={() => setConfig((current) => ({
                  ...current,
                  tabela_taxas_bairros: [...current.tabela_taxas_bairros, { id: `bairro-${Date.now()}`, bairro: '', taxa: 0 }],
                }))}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[10px] font-black text-emerald-700 transition hover:bg-emerald-500/15 dark:text-emerald-300"
              >
                <Plus size={13} /> Adicionar bairro
              </button>
            </div>

            <div className="space-y-2.5">
              {config.tabela_taxas_bairros.map((row) => (
                <div key={row.id} className="grid gap-2 rounded-xl border border-koma-border bg-koma-card p-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end">
                  <label>
                    <FieldLabel>Bairro</FieldLabel>
                    <input
                      value={row.bairro}
                      onChange={(event) => setConfig((current) => ({
                        ...current,
                        tabela_taxas_bairros: current.tabela_taxas_bairros.map((item) => item.id === row.id ? { ...item, bairro: event.target.value } : item),
                      }))}
                      className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground outline-none focus:border-emerald-500/60"
                      placeholder="Ex.: Centro"
                    />
                  </label>
                  <label>
                    <FieldLabel>Taxa (R$)</FieldLabel>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.taxa || ''}
                      onChange={(event) => setConfig((current) => ({
                        ...current,
                        tabela_taxas_bairros: current.tabela_taxas_bairros.map((item) => item.id === row.id ? { ...item, taxa: Number(event.target.value) || 0 } : item),
                      }))}
                      className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs font-mono text-koma-foreground outline-none focus:border-emerald-500/60"
                      placeholder="0,00"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setConfig((current) => ({ ...current, tabela_taxas_bairros: current.tabela_taxas_bairros.filter((item) => item.id !== row.id) }))}
                    className="grid h-10 w-10 place-items-center rounded-lg border border-rose-500/20 text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300"
                    aria-label={`Remover bairro ${row.bairro}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {config.tipo_taxa_entrega === 'distancia' && (
          <div className="mt-4 space-y-4 border-t border-koma-border pt-4">
            <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-xs font-black text-koma-foreground">Cobrança automática sem serviço pago</h4>
                <p className="mt-1 max-w-2xl text-[9px] leading-relaxed text-koma-muted">Quando o cliente autorizar a localização, o KÔMA calcula a distância em linha reta. Sem localização, usa a taxa mínima.</p>
              </div>
              <button
                type="button"
                onClick={() => setConfig((current) => ({ ...current, tabela_taxas_km: [suggestedDistanceConfig(current.taxa_entrega_fixa)] }))}
                className="inline-flex shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-black text-emerald-700 dark:text-emerald-300"
              >
                Gerar sugestão
              </button>
            </div>

            <div className={clsx(
              'rounded-xl border p-4',
              config.delivery_origin_configured
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-amber-500/25 bg-amber-500/5',
            )}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-xs font-black text-koma-foreground">Ponto de partida das entregas</h4>
                  <p className="mt-1 max-w-2xl text-[9px] leading-relaxed text-koma-muted">
                    {config.delivery_origin_configured
                      ? 'Localização do restaurante já definida. Atualize apenas se o ponto de saída das entregas mudar.'
                      : 'Defina uma vez estando fisicamente no restaurante. Sem isso, o KÔMA usa apenas a taxa mínima.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={saveRestaurantOrigin}
                  disabled={isSavingOrigin}
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 text-[10px] font-black text-koma-secondary transition hover:border-emerald-500/35 disabled:cursor-wait disabled:opacity-60"
                >
                  {isSavingOrigin ? <Loader2 size={13} className="animate-spin" /> : <MapPin size={13} />}
                  {isSavingOrigin
                    ? 'Salvando…'
                    : config.delivery_origin_configured
                      ? 'Atualizar localização'
                      : 'Usar localização deste dispositivo'}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label>
                <FieldLabel>Taxa mínima (R$)</FieldLabel>
                <input type="number" min="0" step="0.01" value={distanceConfig.taxa_minima || ''} onChange={(event) => updateDistanceConfig({ taxa_minima: Number(event.target.value) || 0 })} className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs font-mono text-koma-foreground outline-none focus:border-emerald-500/60" />
                <span className="mt-1 block text-[9px] text-koma-muted">Valor cobrado nas entregas próximas e no fallback sem localização.</span>
              </label>
              <label>
                <FieldLabel>A taxa mínima cobre até (km)</FieldLabel>
                <input type="number" min="0.01" step="0.1" value={distanceConfig.km_inclusos || ''} onChange={(event) => updateDistanceConfig({ km_inclusos: Number(event.target.value) || 0 })} className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs font-mono text-koma-foreground outline-none focus:border-emerald-500/60" />
              </label>
              <label>
                <FieldLabel>Aumentar (R$)</FieldLabel>
                <input type="number" min="0" step="0.01" value={distanceConfig.incremento_valor || ''} onChange={(event) => updateDistanceConfig({ incremento_valor: Number(event.target.value) || 0 })} className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs font-mono text-koma-foreground outline-none focus:border-emerald-500/60" />
              </label>
              <label>
                <FieldLabel>A cada (km)</FieldLabel>
                <input type="number" min="0.01" step="0.1" value={distanceConfig.incremento_km || ''} onChange={(event) => updateDistanceConfig({ incremento_km: Number(event.target.value) || 0 })} className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs font-mono text-koma-foreground outline-none focus:border-emerald-500/60" />
              </label>
              <label>
                <FieldLabel>Taxa máxima (R$)</FieldLabel>
                <input type="number" min="0" step="0.01" value={distanceConfig.taxa_maxima || ''} onChange={(event) => updateDistanceConfig({ taxa_maxima: Number(event.target.value) || 0 })} className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs font-mono text-koma-foreground outline-none focus:border-emerald-500/60" placeholder="Sem limite" />
                <span className="mt-1 block text-[9px] text-koma-muted">Zero deixa a taxa sem teto.</span>
              </label>
              <label>
                <FieldLabel>Distância máxima (km)</FieldLabel>
                <input type="number" min="0" step="0.1" value={distanceConfig.distancia_maxima_km || ''} onChange={(event) => updateDistanceConfig({ distancia_maxima_km: Number(event.target.value) || 0 })} className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs font-mono text-koma-foreground outline-none focus:border-emerald-500/60" placeholder="Sem limite" />
                <span className="mt-1 block text-[9px] text-koma-muted">Zero mantém a entrega sem limite por distância.</span>
              </label>
            </div>

            <div className="rounded-xl border border-koma-border bg-koma-card p-4">
              <h4 className="text-xs font-black text-koma-foreground">Prévia da regra</h4>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {distancePreview.map((row) => (
                  <div key={row.limit} className="rounded-lg border border-koma-border bg-koma-raised px-3 py-2">
                    <span className="block text-[9px] text-koma-muted">Até {row.limit.toFixed(1)} km</span>
                    <strong className="mt-0.5 block text-xs text-koma-foreground">R$ {row.fee.toFixed(2).replace('.', ',')}</strong>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[9px] leading-relaxed text-koma-muted">
                {distanceConfig.distancia_maxima_km > 0
                  ? `Acima de ${distanceConfig.distancia_maxima_km.toFixed(1)} km o endereço fica fora da área de entrega.`
                  : 'Sem distância máxima: o teto de taxa, quando configurado, continua valendo para locais mais distantes.'}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4">
          <h3 className="text-sm font-black text-koma-foreground">Pedido mínimo e frete grátis</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Deixe em zero para não aplicar valor mínimo ou faixa de frete grátis.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <FieldLabel>Pedido mínimo (R$)</FieldLabel>
            <input
              type="number"
              min="0"
              step="0.01"
              value={config.pedido_minimo || ''}
              onChange={(event) => setConfig((current) => ({ ...current, pedido_minimo: Number(event.target.value) || 0 }))}
              className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm font-mono text-koma-foreground outline-none focus:border-emerald-500/60"
              placeholder="0,00"
            />
            <span className="mt-1 block text-[9px] text-koma-muted">Valor mínimo do pedido para delivery.</span>
          </label>
          <label>
            <FieldLabel>Frete grátis a partir de (R$)</FieldLabel>
            <input
              type="number"
              min="0"
              step="0.01"
              value={config.frete_gratis_valor || ''}
              onChange={(event) => setConfig((current) => ({ ...current, frete_gratis_valor: Number(event.target.value) || 0 }))}
              className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm font-mono text-koma-foreground outline-none focus:border-emerald-500/60"
              placeholder="0,00"
            />
            <span className="mt-1 block text-[9px] text-koma-muted">Pedidos que atingirem este valor terão entrega grátis.</span>
          </label>
        </div>
      </section>

      {(feedback || hasUnsavedChanges) && (
        <div className="flex flex-col gap-2 rounded-2xl border border-koma-border bg-koma-panel p-3 sm:flex-row sm:items-center sm:justify-end">
          {feedback ? (
            <span className={clsx('mr-auto inline-flex items-center gap-1.5 text-[10px] font-bold', feedback.type === 'success' ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>
              {feedback.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}{feedback.text}
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
