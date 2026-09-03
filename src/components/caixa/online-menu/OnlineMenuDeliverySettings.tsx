import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Loader2, MapPin, Plus, Save, Trash2, Truck } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { OperationalBanner } from '../../shared/OperationalBanner';

type BairroTaxaRow = {
  id: string;
  bairro: string;
  taxa: number;
};

type DeliveryFeeMode = 'fixa' | 'bairro';

type DeliveryConfig = {
  delivery_ativo: boolean;
  pedido_minimo: number;
  frete_gratis_valor: number;
  tipo_taxa_entrega: DeliveryFeeMode;
  tabela_taxas_bairros: BairroTaxaRow[];
};

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
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

function normalizeConfig(data: Record<string, unknown>): DeliveryConfig {
  return {
    delivery_ativo: data.delivery_ativo !== false,
    pedido_minimo: Number(data.pedido_minimo) || 0,
    frete_gratis_valor: Number(data.frete_gratis_valor) || 0,
    tipo_taxa_entrega: data.tipo_taxa_entrega === 'bairro' ? 'bairro' : 'fixa',
    tabela_taxas_bairros: normalizeNeighborhoods(data.tabela_taxas_bairros),
  };
}

function persistedPayload(config: DeliveryConfig) {
  const neighborhoods = config.tabela_taxas_bairros
    .map(({ bairro, taxa }) => ({ bairro: bairro.trim(), taxa: Math.max(0, Number(taxa) || 0) }))
    .filter((row) => row.bairro);
  return {
    delivery_ativo: config.delivery_ativo,
    pedido_minimo: Math.max(0, Number(config.pedido_minimo) || 0),
    frete_gratis_valor: Math.max(0, Number(config.frete_gratis_valor) || 0),
    tipo_taxa_entrega: config.tipo_taxa_entrega,
    tabela_taxas_bairros: config.tipo_taxa_entrega === 'bairro' ? neighborhoods : [],
  };
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-koma-muted">
      {children}
    </span>
  );
}

export function OnlineMenuDeliverySettings({ apiBaseUrl, authHeaders }: Props) {
  const [config, setConfig] = useState<DeliveryConfig>({
    delivery_ativo: true,
    pedido_minimo: 0,
    frete_gratis_valor: 0,
    tipo_taxa_entrega: 'fixa',
    tabela_taxas_bairros: [],
  });
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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
  const areasCount = config.tipo_taxa_entrega === 'bairro' ? payload.tabela_taxas_bairros.length : 0;

  const chooseFeeMode = (mode: DeliveryFeeMode) => {
    if (mode === config.tipo_taxa_entrega) return;
    if (mode === 'fixa' && config.tabela_taxas_bairros.length > 0) {
      const confirmed = window.confirm('Usar taxa única vai remover as taxas por bairro salvas nesta tela. Continuar?');
      if (!confirmed) return;
      setConfig((current) => ({ ...current, tipo_taxa_entrega: 'fixa', tabela_taxas_bairros: [] }));
      return;
    }
    setConfig((current) => ({
      ...current,
      tipo_taxa_entrega: mode,
      tabela_taxas_bairros: mode === 'bairro' && current.tabela_taxas_bairros.length === 0
        ? [{ id: `bairro-${Date.now()}`, bairro: '', taxa: 0 }]
        : current.tabela_taxas_bairros,
    }));
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
      <OperationalBanner
        id="online-menu-delivery-heading"
        eyebrow="CARDÁPIO ONLINE"
        title="Entrega"
        accent="fácil de configurar"
        description="Defina quando aceitar delivery, o valor mínimo, frete grátis e como cobrar a entrega."
        metrics={[
          { label: 'delivery', value: config.delivery_ativo ? 'Ativo' : 'Pausado' },
          { label: config.tipo_taxa_entrega === 'bairro' ? 'bairros' : 'cobrança', value: config.tipo_taxa_entrega === 'bairro' ? areasCount : 'Única' },
          { label: 'pedido mínimo', value: payload.pedido_minimo > 0 ? `R$ ${payload.pedido_minimo.toFixed(2)}` : 'Livre' },
        ]}
      />

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
              <Truck size={17} />
            </div>
            <div>
              <h3 className="text-sm font-black text-koma-foreground">Aceitar pedidos para entrega</h3>
              <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">Desligue quando o restaurante não quiser receber novos pedidos de delivery. Retirada continua funcionando.</p>
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
            {config.delivery_ativo ? 'Ativo' : 'Pausado'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4">
          <h3 className="text-sm font-black text-koma-foreground">Valores do delivery</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Deixe em zero quando não quiser usar a condição.</p>
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
            <span className="mt-1 block text-[9px] text-koma-muted">Ex.: R$ 30. Abaixo disso o cliente precisa adicionar mais itens.</span>
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
            <span className="mt-1 block text-[9px] text-koma-muted">Ex.: R$ 100. Ao atingir o valor, a entrega fica grátis.</span>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
            <MapPin size={17} />
          </div>
          <div>
            <h3 className="text-sm font-black text-koma-foreground">Como cobrar a entrega</h3>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">Escolha uma regra simples. Não é preciso configurar mapa ou distância.</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            aria-pressed={config.tipo_taxa_entrega === 'fixa'}
            onClick={() => chooseFeeMode('fixa')}
            className={clsx(
              'rounded-xl border p-3 text-left transition',
              config.tipo_taxa_entrega === 'fixa'
                ? 'border-emerald-500/50 bg-emerald-500/10'
                : 'border-koma-border bg-koma-card hover:border-emerald-500/25',
            )}
          >
            <strong className="block text-xs text-koma-foreground">Taxa única</strong>
            <span className="mt-1 block text-[9px] leading-relaxed text-koma-muted">Boa para quem cobra o mesmo valor em toda a área atendida.</span>
          </button>
          <button
            type="button"
            aria-pressed={config.tipo_taxa_entrega === 'bairro'}
            onClick={() => chooseFeeMode('bairro')}
            className={clsx(
              'rounded-xl border p-3 text-left transition',
              config.tipo_taxa_entrega === 'bairro'
                ? 'border-emerald-500/50 bg-emerald-500/10'
                : 'border-koma-border bg-koma-card hover:border-emerald-500/25',
            )}
          >
            <strong className="block text-xs text-koma-foreground">Taxa por bairro</strong>
            <span className="mt-1 block text-[9px] leading-relaxed text-koma-muted">Defina quanto cobrar em cada bairro que o restaurante atende.</span>
          </button>
        </div>

        {config.tipo_taxa_entrega === 'fixa' ? (
          <div className="mt-4 rounded-xl border border-dashed border-koma-border bg-koma-card p-4 text-[10px] leading-relaxed text-koma-muted">
            O cardápio usa a taxa padrão atual do restaurante. O valor editável da taxa única será tratado separadamente para não criar uma regra duplicada no sistema.
          </div>
        ) : (
          <div className="mt-4 border-t border-koma-border pt-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-xs font-black text-koma-foreground">Bairros atendidos</h4>
                <p className="mt-1 text-[9px] leading-relaxed text-koma-muted">Cadastre somente os bairros em que o restaurante realmente entrega.</p>
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
      </section>

      <div className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-2xl border border-koma-border bg-koma-panel/95 p-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-end">
        {feedback ? (
          <span className={clsx('mr-auto inline-flex items-center gap-1.5 text-[10px] font-bold', feedback.type === 'success' ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>
            {feedback.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}{feedback.text}
          </span>
        ) : (
          <span className="mr-auto text-[10px] font-semibold text-koma-muted">{hasUnsavedChanges ? 'Há alterações que ainda não foram salvas.' : 'Tudo salvo.'}</span>
        )}
        <button
          type="button"
          disabled={isSaving || !hasUnsavedChanges}
          onClick={() => void save()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-4 text-[10px] font-black uppercase tracking-wider text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300 disabled:cursor-default disabled:border-koma-border disabled:bg-koma-raised disabled:text-koma-muted disabled:opacity-70"
        >
          {isSaving ? <Loader2 size={13} className="animate-spin" /> : hasUnsavedChanges ? <Save size={13} /> : <CheckCircle2 size={13} />}
          {isSaving ? 'Salvando…' : hasUnsavedChanges ? 'Salvar entrega' : 'Tudo salvo'}
        </button>
      </div>
    </div>
  );
}
