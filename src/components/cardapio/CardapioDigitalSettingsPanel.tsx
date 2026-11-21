import { isInitialSetup, returnToInitialSetup, useUnsavedSetupChanges } from '../onboarding/setupNavigation';
import { fetchCardapioDigitalConfig, updateCardapioDigitalConfigCache } from '../caixa/online-menu/cardapioDigitalConfigClient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  Instagram,
  Loader2,
  MapPin,
  MessageCircle,
  RefreshCw,
  Save,
  ShoppingBag,
  Store,
} from 'lucide-react';
import clsx from 'clsx';
import { CardapioAssetUploader } from '../CardapioAssetUploader';

export type CardapioDigitalSettingsSection = 'perfil' | 'pedidos' | 'marca';

type HourRow = {
  id: string;
  days: string;
  hours: string;
};

type SocialConfig = Record<string, unknown> & {
  whatsapp?: string;
  instagram?: string;
};

type BairroTaxaRow = {
  id: string;
  bairro: string;
  taxa: number;
};

export type RestaurantConfigSnapshot = {
  id?: number;
  nome: string;
  subtitulo: string;
  sobre_nos: string;
  endereco: string;
  google_maps_url: string;
  status_override: string;
  logo_url: string;
  banner_url: string;
  socials: SocialConfig;
  horarios_funcionamento: HourRow[];
  formas_pagamento_aceitas?: string[];
  pedido_minimo?: number;
  pedido_minimo_retirada?: boolean;
  frete_gratis_valor?: number;
  tipo_taxa_entrega?: 'fixa' | 'bairro';
  tabela_taxas_bairros?: BairroTaxaRow[];
};

type StoreAppearanceConfig = {
  id?: number;
  nome: string;
  subtitulo: string;
  sobre_nos: string;
  endereco: string;
  google_maps_url: string;
  status_override: string;
  logo_url: string;
  banner_url: string;
  socials: SocialConfig;
  horarios_funcionamento: HourRow[];
};

interface CardapioDigitalSettingsPanelProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  publicMenuUrl: string | null;
  activeSection: CardapioDigitalSettingsSection;
  onSectionChange: (section: CardapioDigitalSettingsSection) => void;
  onSetupComplete?: () => Promise<void>;
  onSetupDirtyChange?: (dirty: boolean) => void;
  onSetupSavingChange?: (saving: boolean) => void;
}

const KOMA_MENU_PRIMARY = '#00b894';
const KOMA_MENU_BACKGROUND = '#090a0f';

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

function normalizeSocials(value: unknown): SocialConfig {
  const parsed = parseStructuredValue(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return { ...(parsed as Record<string, unknown>) };
  }
  if (Array.isArray(parsed)) {
    const result: SocialConfig = {};
    parsed.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const item = entry as Record<string, unknown>;
      const platform = String(item.platform || '').trim().toLowerCase();
      const url = String(item.url || '').trim();
      if (!platform || !url) return;
      result[platform] = url;
    });
    return result;
  }
  return {};
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

function normalizeConfig(data: Record<string, any>): StoreAppearanceConfig {
  return {
    id: Number.isFinite(Number(data?.id)) ? Number(data.id) : undefined,
    nome: String(data?.nome || ''),
    subtitulo: String(data?.subtitulo || ''),
    sobre_nos: String(data?.sobre_nos || ''),
    endereco: String(data?.endereco || ''),
    google_maps_url: String(data?.google_maps_url || ''),
    status_override: String(data?.status_override || 'Automático'),
    logo_url: String(data?.logo_url || ''),
    banner_url: String(data?.banner_url || ''),
    socials: normalizeSocials(data?.socials),
    horarios_funcionamento: normalizeHours(data?.horarios_funcionamento),
  };
}

const emptyConfig: StoreAppearanceConfig = {
  nome: '',
  subtitulo: '',
  sobre_nos: '',
  endereco: '',
  google_maps_url: '',
  status_override: 'Automático',
  logo_url: '',
  banner_url: '',
  socials: {},
  horarios_funcionamento: [],
};

/**
 * Isola o payload enviado no PUT /api/cardapio-digital/config por seção ativa,
 * evitando que salvar Perfil ou Marca sobrescreva silenciosamente horários,
 * entrega ou formas de pagamento editados em outras abas.
 */
export function buildSectionPersistedPayload(
  config: RestaurantConfigSnapshot,
  section: CardapioDigitalSettingsSection,
): Record<string, unknown> {
  if (section === 'perfil') {
    return {
      nome: config.nome.trim(),
      subtitulo: config.subtitulo.trim(),
      sobre_nos: config.sobre_nos.trim(),
      endereco: config.endereco.trim(),
      google_maps_url: config.google_maps_url.trim(),
      socials: config.socials,
    };
  }

  if (section === 'marca') {
    return {
      logo_url: config.logo_url.trim(),
      banner_url: config.banner_url.trim(),
    };
  }

  return {
    status_override: config.status_override,
    horarios_funcionamento: config.horarios_funcionamento
      .map(({ days, hours }) => ({ days: days.trim(), hours: hours.trim() }))
      .filter((row) => row.days && row.hours),
    cor_primaria: KOMA_MENU_PRIMARY,
    cor_fundo: KOMA_MENU_BACKGROUND,
  };
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-xs font-semibold text-koma-secondary">
      {children}
    </span>
  );
}

function PhonePreview({
  config,
  publicMenuUrl,
  compact = false,
}: {
  config: StoreAppearanceConfig;
  publicMenuUrl: string | null;
  compact?: boolean;
}) {
  const isPaused = config.status_override === 'Forçado Fechado';
  const statusText = isPaused
    ? 'Pausado'
    : config.status_override === 'Forçado Aberto'
      ? 'Aberto agora'
      : 'Horário automático';
  const firstHours = config.horarios_funcionamento[0];
  const storeName = config.nome.trim() || 'Seu restaurante';
  const whatsapp = String(config.socials.whatsapp || '').trim();
  const instagram = String(config.socials.instagram || '').trim();
  const initials = storeName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'KM';

  return (
    <aside aria-label="Prévia da identidade do cardápio" className={clsx('xl:sticky xl:top-4', compact && 'order-first xl:order-last')}>
      <div
        className={clsx(
          'mx-auto w-full border border-koma-border bg-koma-panel',
          compact ? 'overflow-hidden rounded-2xl' : 'max-w-[340px] rounded-[2rem] p-3',
        )}
      >
        {!compact && (
          <div className="mb-2.5 flex items-center justify-between px-2 py-0.5">
            <span className="text-xs font-semibold text-koma-muted">
              Prévia mobile
            </span>
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="h-1 w-8 rounded-full bg-koma-border" />
              <span className="h-1.5 w-1.5 rounded-full bg-koma-border" />
            </div>
          </div>
        )}
        <div
          className={clsx(
            'overflow-hidden bg-koma-canvas text-koma-foreground',
            !compact && 'rounded-[1.35rem] border border-koma-border',
          )}
        >
          <div className={clsx('relative overflow-hidden border-b border-koma-border bg-koma-raised', compact ? 'h-20' : 'h-28')}>
            {config.banner_url ? (
              <img src={config.banner_url} alt="Capa do restaurante" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-koma-muted">
                <Store size={20} aria-hidden="true" />
                <span className="text-xs font-medium">Sem capa configurada</span>
              </div>
            )}
          </div>

          <div className="p-3.5">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-koma-border bg-koma-card text-xs font-bold text-koma-foreground">
                {config.logo_url ? (
                  <img src={config.logo_url} alt="Logo do restaurante" className="h-full w-full object-contain p-1" />
                ) : (
                  <span style={{ fontFamily: 'var(--koma-font-display)' }}>{initials}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <strong
                  className="block truncate text-sm font-bold text-koma-foreground"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  {storeName}
                </strong>
                <span className="mt-0.5 block truncate text-xs text-koma-muted">
                  {config.subtitulo.trim() || 'Seu slogan aparece aqui'}
                </span>
                <span
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                  style={
                    isPaused
                      ? {
                          background: 'var(--koma-danger-bg)',
                          borderColor: 'var(--koma-danger-border)',
                          color: 'var(--koma-danger-text)',
                        }
                      : {
                          background: 'var(--koma-success-bg)',
                          borderColor: 'var(--koma-success-border)',
                          color: 'var(--koma-success-text)',
                        }
                  }
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: isPaused ? 'var(--koma-danger-text)' : 'var(--koma-success-text)' }}
                  />
                  {statusText}
                </span>
              </div>
            </div>

            {!compact && (whatsapp || instagram) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {whatsapp && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-koma-border bg-koma-card px-2 py-1 text-xs font-medium text-koma-secondary">
                    <MessageCircle size={12} aria-hidden="true" className="shrink-0" />
                    <span className="max-w-[130px] truncate tabular-nums">{whatsapp}</span>
                  </span>
                )}
                {instagram && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-koma-border bg-koma-card px-2 py-1 text-xs font-medium text-koma-secondary">
                    <Instagram size={12} aria-hidden="true" className="shrink-0" />
                    <span className="max-w-[130px] truncate">{instagram}</span>
                  </span>
                )}
              </div>
            )}

            {!compact && (
              <>
                <div className="mt-3.5 flex gap-1.5 overflow-hidden border-t border-koma-border pt-3">
                  <span
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold"
                    style={{
                      background: 'var(--kc-chrome-selected, var(--koma-action-bg))',
                      color: 'var(--kc-chrome-on-selected, var(--koma-action-text))',
                    }}
                  >
                    Destaques
                  </span>
                  <span className="rounded-lg border border-koma-border bg-koma-card px-2.5 py-1 text-xs font-medium text-koma-muted">
                    Cardápio
                  </span>
                </div>

                <div className="mt-3 rounded-xl border border-dashed border-koma-border bg-koma-card p-3.5 text-center">
                  <ShoppingBag size={18} className="mx-auto mb-1.5 text-koma-muted" aria-hidden="true" />
                  <p className="text-xs leading-relaxed text-koma-muted">
                    Produtos, fotos e preços são gerenciados em Cardápio → Produtos.
                  </p>
                </div>

                {(config.endereco.trim() || firstHours) && (
                  <div className="mt-3 space-y-1.5 rounded-xl border border-koma-border bg-koma-card p-2.5 text-xs text-koma-secondary">
                    {config.endereco.trim() && (
                      <div className="flex items-center gap-1.5">
                        <MapPin size={13} className="shrink-0 text-koma-muted" aria-hidden="true" />
                        <span className="truncate">{config.endereco.trim()}</span>
                      </div>
                    )}
                    {firstHours && (
                      <div className="flex items-center gap-1.5 tabular-nums">
                        <Clock3 size={13} className="shrink-0 text-koma-muted" aria-hidden="true" />
                        <span className="truncate">{firstHours.days}: {firstHours.hours}</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-2.5 space-y-2 px-1">
          {publicMenuUrl && !compact && (
            <a
              href={publicMenuUrl}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-foreground transition hover:bg-koma-raised"
            >
              <ExternalLink size={14} aria-hidden="true" />
              <span>Abrir cardápio</span>
            </a>
          )}
          <p className="text-center text-xs text-koma-muted">
            {compact
              ? 'Prévia da identidade · não publica nem libera pedidos'
              : 'Prévia ao vivo · alterações de texto exigem salvar'}
          </p>
        </div>
      </div>
    </aside>
  );
}

export function CardapioDigitalSettingsPanel({
  apiBaseUrl,
  authHeaders,
  publicMenuUrl,
  activeSection,
  onSectionChange,
  onSetupComplete,
  onSetupDirtyChange,
  onSetupSavingChange,
}: CardapioDigitalSettingsPanelProps) {
  const activeTab = activeSection;
  const payloadSection: CardapioDigitalSettingsSection = 'perfil';
  const brandSectionRef = useRef<HTMLElement | null>(null);
  const setupMode = Boolean(onSetupComplete) || isInitialSetup();
  const [config, setConfig] = useState<StoreAppearanceConfig>(emptyConfig);
  const [savedConfig, setSavedConfig] = useState<StoreAppearanceConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => { onSetupSavingChange?.(isSaving); }, [isSaving, onSetupSavingChange]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (activeTab !== 'marca' || isLoading) return;
    brandSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeTab, isLoading]);

  const loadConfig = useCallback(async (force = false) => {
    setIsLoading(true);
    setLoadError('');
    try {
      const authorization = authHeaders.Authorization || authHeaders.authorization || '';
      const data = await fetchCardapioDigitalConfig<Record<string, any>>(apiBaseUrl, authorization, { force });
      const next = normalizeConfig(data);
      setConfig(next);
      setSavedConfig(next);
      setHasLoadedConfig(true);
    } catch (error) {
      console.error('Falha ao carregar configurações do cardápio online:', error);
      setLoadError('Não foi possível carregar as configurações do cardápio. Confira sua conexão e tente novamente.');
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    void loadConfig(false);
  }, [loadConfig]);

  useEffect(() => {
    if (!feedback || feedback.type === 'error') return;
    const timer = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const updateConfig = <K extends keyof StoreAppearanceConfig>(key: K, value: StoreAppearanceConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const updateSocial = (key: 'whatsapp' | 'instagram', value: string) => {
    setConfig((current) => ({
      ...current,
      socials: { ...current.socials, [key]: value },
    }));
  };

  const updateAssetUrl = (key: 'logo_url' | 'banner_url', url: string) => {
    const authorization = authHeaders.Authorization || authHeaders.authorization || '';
    setConfig((current) => ({ ...current, [key]: url }));
    setSavedConfig((current) => (current ? { ...current, [key]: url } : current));
    updateCardapioDigitalConfigCache(apiBaseUrl, authorization, { [key]: url });
  };

  const currentPayload = useMemo(
    () => buildSectionPersistedPayload(config, payloadSection),
    [config, payloadSection],
  );
  const savedSectionSnapshot = useMemo(
    () => (savedConfig ? JSON.stringify(buildSectionPersistedPayload(savedConfig, payloadSection)) : ''),
    [savedConfig, payloadSection],
  );
  const hasUnsavedChanges = hasLoadedConfig && JSON.stringify(currentPayload) !== savedSectionSnapshot;

  const markSaved = useUnsavedSetupChanges(setupMode && hasUnsavedChanges);
  useEffect(() => { onSetupDirtyChange?.(hasLoadedConfig && hasUnsavedChanges); }, [hasLoadedConfig, hasUnsavedChanges, onSetupDirtyChange]);

  const readiness = useMemo(() => {
    const checks = [
      { label: 'nome público', ok: Boolean(config.nome.trim()) },
      { label: 'WhatsApp', ok: Boolean(String(config.socials.whatsapp || '').trim()) },
      { label: 'endereço', ok: Boolean(config.endereco.trim()) },
    ];
    const completed = checks.filter((check) => check.ok).length;
    return {
      completed,
      total: checks.length,
      missing: checks.filter((check) => !check.ok).map((check) => check.label),
      ready: completed === checks.length,
    };
  }, [config]);

  const saveConfig = async () => {
    if (!hasLoadedConfig || loadError) {
      setFeedback({ type: 'error', text: 'Recarregue as configurações antes de publicar alterações.' });
      return;
    }
    if (!config.nome.trim()) {
      setFeedback({ type: 'error', text: 'Informe o nome público do restaurante.' });
      onSectionChange('perfil');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/config`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(currentPayload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível salvar as configurações.');
      const authorization = authHeaders.Authorization || authHeaders.authorization || '';
      updateCardapioDigitalConfigCache(apiBaseUrl, authorization, data);
      const next = normalizeConfig(data);
      setConfig(next);
      setSavedConfig(next);
      setFeedback({ type: 'success', text: 'Cardápio atualizado e publicado.' });
      if (setupMode) {
        if (onSetupComplete) {
          await onSetupComplete();
          markSaved();
          return;
        }
        const statusResponse = await fetch(`${apiBaseUrl}/api/onboarding/status`, { headers: authHeaders, cache: 'no-store' });
        const status = await statusResponse.json().catch(() => null);
        if (!statusResponse.ok || typeof status?.steps?.profile !== 'boolean') {
          throw new Error('Dados salvos, mas não foi possível validar a etapa. Tente novamente na implantação.');
        }
        if (activeTab !== 'perfil' || status.steps.profile) {
          markSaved();
          returnToInitialSetup();
        } else {
          setFeedback({
            type: 'error',
            text: status?.onboarding?.provisionalPreparation
              ? 'Dados salvos. Para concluir esta etapa, informe nome público e WhatsApp (o endereço definitivo pode ser completado depois).'
              : 'Dados salvos. Para concluir esta etapa, informe nome público, WhatsApp e endereço.',
          });
        }
      }
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar configurações.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-2xl border border-koma-border bg-koma-panel">
        <div className="flex items-center gap-2 text-xs font-semibold text-koma-muted">
          <Loader2 size={16} className="animate-spin" /> Carregando configurações do cardápio…
        </div>
      </div>
    );
  }

  if (loadError && !hasLoadedConfig) {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-2xl border border-koma-border bg-koma-panel p-6 text-center">
        <div className="max-w-md">
          <AlertCircle size={32} className="mx-auto" style={{ color: 'var(--koma-danger-text)' }} />
          <h2
            className="mt-4 text-base font-bold text-koma-foreground"
            style={{ fontFamily: 'var(--koma-font-display)' }}
          >
            Não conseguimos carregar o cardápio online
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-koma-muted">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadConfig(true)}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-xs font-semibold transition"
            style={{
              background: 'var(--koma-action-bg)',
              color: 'var(--koma-action-text)',
            }}
          >
            <RefreshCw size={14} /> Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="online-menu-editor space-y-4 text-left animate-fade-in" style={onSetupComplete ? { paddingBottom: 0 } : undefined}>
      {!onSetupComplete && (
        <header className="online-menu-editor__header flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-panel px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <h2
              className="text-base font-bold text-koma-foreground"
              style={{ fontFamily: 'var(--koma-font-display)' }}
            >
              {setupMode ? 'Dados do restaurante' : 'Loja e aparência'}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-koma-muted">
              {setupMode
                ? 'Informe nome público, WhatsApp e endereço. Essas informações também serão exibidas no cardápio online.'
                : 'Configure nome, contato, endereço, logotipo e capa exibidos no cardápio público.'}
            </p>
          </div>
          {publicMenuUrl && (
            <a
              href={publicMenuUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3.5 text-xs font-semibold text-koma-foreground transition hover:bg-koma-card"
            >
              <ExternalLink size={14} aria-hidden="true" /> Ver como cliente
            </a>
          )}
        </header>
      )}

      {loadError && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-xs"
          style={{
            background: 'var(--koma-danger-bg)',
            borderColor: 'var(--koma-danger-border)',
            color: 'var(--koma-danger-text)',
          }}
          role="alert"
        >
          <AlertCircle size={16} className="shrink-0" />
          <span className="min-w-0 flex-1">{loadError} Os dados já carregados foram preservados.</span>
          <button
            type="button"
            onClick={() => void loadConfig(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-semibold"
            style={{ borderColor: 'var(--koma-danger-border)' }}
          >
            <RefreshCw size={13} /> Tentar novamente
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <div className="min-w-0 space-y-4">
          {!readiness.ready && (
            <div
              className="flex items-start gap-2.5 rounded-xl border p-3.5 text-xs"
              style={{
                background: 'var(--koma-warning-bg)',
                borderColor: 'var(--koma-warning-border)',
                color: 'var(--koma-warning-text)',
              }}
            >
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <strong>Recomendado preencher:</strong> complete {readiness.missing.join(', ')} para que seus clientes identifiquem a loja.
              </div>
            </div>
          )}

          <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
            <div className="mb-4">
              <h3
                className="text-sm font-bold text-koma-foreground"
                style={{ fontFamily: 'var(--koma-font-display)' }}
              >
                Informações principais
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-koma-muted">
                Identidade da loja, contato e endereço exibidos para seus clientes.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <FieldLabel>Nome público do restaurante</FieldLabel>
                <input
                  disabled={Boolean(onSetupComplete) && isSaving}
                  value={config.nome}
                  onChange={(event) => updateConfig('nome', event.target.value)}
                  maxLength={120}
                  className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm font-semibold text-koma-foreground outline-none focus:border-koma-border-strong"
                  placeholder="Ex.: Pizzeria Bella Italia"
                />
              </label>
              {!onSetupComplete && (
                <label className="sm:col-span-2">
                  <FieldLabel>Slogan / frase curta</FieldLabel>
                  <input
                    value={config.subtitulo}
                    onChange={(event) => updateConfig('subtitulo', event.target.value)}
                    maxLength={180}
                    className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm text-koma-foreground outline-none focus:border-koma-border-strong"
                    placeholder="Ex.: Pizza artesanal no forno a lenha"
                  />
                </label>
              )}
              <label>
                <FieldLabel>WhatsApp</FieldLabel>
                <div className="relative">
                  <MessageCircle size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
                  <input
                    disabled={Boolean(onSetupComplete) && isSaving}
                    value={String(config.socials.whatsapp || '')}
                    onChange={(event) => updateSocial('whatsapp', event.target.value)}
                    className="h-11 w-full rounded-xl border border-koma-border bg-koma-input pl-9 pr-3 text-sm tabular-nums text-koma-foreground outline-none focus:border-koma-border-strong"
                    placeholder="(85) 99999-9999"
                  />
                </div>
              </label>
              <label className="sm:col-span-2">
                <FieldLabel>Endereço físico</FieldLabel>
                <div className="relative">
                  <MapPin size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
                  <input
                    disabled={Boolean(onSetupComplete) && isSaving}
                    value={config.endereco}
                    onChange={(event) => updateConfig('endereco', event.target.value)}
                    maxLength={240}
                    className="h-11 w-full rounded-xl border border-koma-border bg-koma-input pl-9 pr-3 text-sm text-koma-foreground outline-none focus:border-koma-border-strong"
                    placeholder="Av. Principal, 100 - Centro"
                  />
                </div>
              </label>
            </div>
          </section>

          {!onSetupComplete && (
            <section
              id="online-menu-brand-section"
              title="Logo e capa"
              ref={brandSectionRef}
              className="scroll-mt-4 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5"
            >
              <div className="mb-4">
                <h3
                  className="text-sm font-bold text-koma-foreground"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  Marca e aparência
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-koma-muted">
                  Logo e capa exibidos no topo do cardápio público. Imagens enviadas entram no ar imediatamente.
                </p>
              </div>
              <div className="space-y-4">
                <CardapioAssetUploader
                  type="logo"
                  label="Logotipo do restaurante"
                  currentUrl={config.logo_url}
                  apiBaseUrl={apiBaseUrl}
                  authHeaders={authHeaders}
                  onChange={(url) => updateAssetUrl('logo_url', url)}
                />
                <CardapioAssetUploader
                  type="banner"
                  label="Banner / capa"
                  currentUrl={config.banner_url}
                  apiBaseUrl={apiBaseUrl}
                  authHeaders={authHeaders}
                  onChange={(url) => updateAssetUrl('banner_url', url)}
                />
              </div>
            </section>
          )}

          <details className="group rounded-2xl border border-koma-border bg-koma-panel">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 sm:px-5">
              <div>
                <strong
                  className="block text-sm font-bold text-koma-foreground"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  Informações adicionais
                </strong>
                <span className="mt-1 block text-xs leading-relaxed text-koma-muted">
                  Sobre o restaurante, Instagram e link do Google Maps.
                </span>
              </div>
              <ChevronDown
                size={16}
                className="shrink-0 text-koma-muted transition-transform duration-200 group-open:rotate-180"
              />
            </summary>
            <div className="border-t border-koma-border px-4 py-4 sm:px-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <FieldLabel>Sobre o restaurante</FieldLabel>
                  <textarea
                    value={config.sobre_nos}
                    onChange={(event) => updateConfig('sobre_nos', event.target.value)}
                    maxLength={900}
                    rows={4}
                    className="w-full resize-y rounded-xl border border-koma-border bg-koma-input px-3.5 py-3 text-sm leading-relaxed text-koma-foreground outline-none focus:border-koma-border-strong"
                    placeholder="Conte em poucas linhas o que torna o restaurante especial."
                  />
                  <span className="mt-1 block text-right text-xs tabular-nums text-koma-muted">
                    {config.sobre_nos.length}/900
                  </span>
                </label>
                <label>
                  <FieldLabel>Instagram</FieldLabel>
                  <div className="relative">
                    <Instagram size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
                    <input
                      value={String(config.socials.instagram || '')}
                      onChange={(event) => updateSocial('instagram', event.target.value)}
                      className="h-11 w-full rounded-xl border border-koma-border bg-koma-input pl-9 pr-3 text-sm text-koma-foreground outline-none focus:border-koma-border-strong"
                      placeholder="@seurestaurante"
                    />
                  </div>
                </label>
                <label>
                  <FieldLabel>Localização no Google Maps</FieldLabel>
                  <input
                    value={config.google_maps_url}
                    onChange={(event) => updateConfig('google_maps_url', event.target.value)}
                    className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm text-koma-foreground outline-none focus:border-koma-border-strong"
                    placeholder="Link do Google Maps, endereço ou Plus Code"
                  />
                  <span className="mt-1 block text-xs leading-relaxed text-koma-muted">
                    Aceita link do Google Maps, endereço completo ou Plus Code com cidade.
                  </span>
                </label>
              </div>
            </div>
          </details>

          {(feedback || hasUnsavedChanges || onSetupComplete) && (
            <div
              style={onSetupComplete ? { position: 'static' } : undefined}
              className="online-menu-editor__publish flex flex-col gap-2 rounded-2xl border border-koma-border bg-koma-panel p-3 sm:flex-row sm:items-center sm:justify-end"
            >
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
                  {hasUnsavedChanges ? 'Alterações ainda não publicadas.' : 'Confira os dados e continue.'}
                </span>
              )}
              {(hasUnsavedChanges || onSetupComplete) && (
                <button
                  type="button"
                  disabled={isSaving || !hasLoadedConfig || Boolean(loadError)}
                  onClick={() => void saveConfig()}
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
                          : 'Salvar e publicar'}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        <PhonePreview config={config} publicMenuUrl={publicMenuUrl} compact={Boolean(onSetupComplete)} />
      </div>
    </div>
  );
}
