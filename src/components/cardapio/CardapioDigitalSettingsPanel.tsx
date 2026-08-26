import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  CreditCard,
  ExternalLink,
  Image as ImageIcon,
  Instagram,
  Loader2,
  MapPin,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Store,
  Trash2,
  Upload,
} from 'lucide-react';
import clsx from 'clsx';
import { OperationalBanner } from '../shared/OperationalBanner';

type SettingsTab = 'perfil' | 'pedidos' | 'marca';
type AssetType = 'logo' | 'banner';

type HourRow = {
  id: string;
  days: string;
  hours: string;
};

type SocialConfig = Record<string, unknown> & {
  whatsapp?: string;
  instagram?: string;
};

type RestaurantConfig = {
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
  formas_pagamento_aceitas: string[];
};

interface CardapioDigitalSettingsPanelProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  publicMenuUrl: string | null;
}

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;
const KOMA_MENU_PRIMARY = '#00b894';
const KOMA_MENU_BACKGROUND = '#090a0f';

const tabs: Array<{ id: SettingsTab; label: string; description: string; icon: typeof Store }> = [
  { id: 'perfil', label: 'Perfil público', description: 'Nome, contato e localização', icon: Store },
  { id: 'pedidos', label: 'Pedidos', description: 'Status, horários e pagamentos', icon: Clock3 },
  { id: 'marca', label: 'Marca', description: 'Logo e capa do restaurante', icon: ImageIcon },
];

const paymentOptions = [
  { id: 'Pix', label: 'Pix', helper: 'Aparece para o cliente como forma aceita.' },
  { id: 'Dinheiro', label: 'Dinheiro', helper: 'Pagamento em dinheiro no atendimento.' },
  { id: 'Cartão de crédito', label: 'Crédito', helper: 'Cartão de crédito no atendimento.' },
  { id: 'Cartão de débito', label: 'Débito', helper: 'Cartão de débito no atendimento.' },
];

const statusOptions = [
  {
    value: 'Automático',
    label: 'Automático',
    helper: 'Segue os horários cadastrados.',
  },
  {
    value: 'Forçado Aberto',
    label: 'Aberto agora',
    helper: 'Aceita pedidos independentemente do horário.',
  },
  {
    value: 'Forçado Fechado',
    label: 'Pausar pedidos',
    helper: 'Mostra o cardápio, mas interrompe novos pedidos.',
  },
];

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

function normalizePayments(value: unknown): string[] {
  const parsed = parseStructuredValue(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function normalizeConfig(data: Record<string, any>): RestaurantConfig {
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
    formas_pagamento_aceitas: normalizePayments(data?.formas_pagamento_aceitas),
  };
}

const emptyConfig: RestaurantConfig = {
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
  formas_pagamento_aceitas: [],
};

function buildPersistedPayload(config: RestaurantConfig) {
  return {
    nome: config.nome.trim(),
    subtitulo: config.subtitulo.trim(),
    sobre_nos: config.sobre_nos.trim(),
    endereco: config.endereco.trim(),
    google_maps_url: config.google_maps_url.trim(),
    socials: config.socials,
    horarios_funcionamento: config.horarios_funcionamento
      .map(({ days, hours }) => ({ days: days.trim(), hours: hours.trim() }))
      .filter((row) => row.days && row.hours),
    formas_pagamento_aceitas: config.formas_pagamento_aceitas,
    status_override: config.status_override,
    cor_primaria: KOMA_MENU_PRIMARY,
    cor_fundo: KOMA_MENU_BACKGROUND,
  };
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-koma-muted">
      {children}
    </span>
  );
}

function SettingsSection({
  title,
  description,
  children,
  separated = false,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  separated?: boolean;
}) {
  return (
    <section className={clsx('py-5 first:pt-0 last:pb-0', separated && 'border-t border-koma-border-subtle')}>
      <div className="mb-4">
        <h3 className="text-sm font-black text-koma-foreground">{title}</h3>
        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-koma-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function AssetEditor({
  type,
  label,
  currentUrl,
  apiBaseUrl,
  authHeaders,
  onChange,
}: {
  type: AssetType;
  label: string;
  currentUrl: string;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);

  const upload = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type.toLowerCase())) {
      setStatus('error');
      setMessage('Use PNG, JPG ou WEBP.');
      return;
    }
    if (file.size > MAX_SIZE) {
      setStatus('error');
      setMessage('A imagem deve ter no máximo 5 MB.');
      return;
    }

    setStatus('busy');
    setMessage('Enviando imagem…');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const headers = { ...authHeaders };
      delete headers['Content-Type'];
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/assets/${type}`, {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível enviar a imagem.');
      onChange(String(type === 'logo' ? data.logo_url || '' : data.banner_url || ''));
      setStatus('success');
      setMessage('Imagem atualizada e publicada.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Erro de conexão ao enviar a imagem.');
    } finally {
      setDragging(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    setStatus('busy');
    setMessage('Removendo imagem…');
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/assets/${type}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível remover a imagem.');
      onChange('');
      setStatus('success');
      setMessage('Imagem removida.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Erro de conexão ao remover a imagem.');
    }
  };

  const isBusy = status === 'busy';

  return (
    <div className="rounded-2xl border border-koma-border bg-koma-card p-3.5 sm:p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void upload(file);
          }}
          className={clsx(
            'relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-koma-raised transition',
            type === 'logo' ? 'h-28 w-28' : 'h-28 w-full sm:w-48',
            dragging ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-koma-border hover:border-emerald-500/45',
            isBusy && 'cursor-wait opacity-70',
          )}
        >
          {isBusy ? (
            <Loader2 size={22} className="animate-spin text-emerald-600 dark:text-emerald-300" />
          ) : currentUrl ? (
            <img
              src={currentUrl}
              alt={label}
              className={clsx('h-full w-full', type === 'logo' ? 'object-contain p-2' : 'object-cover')}
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-koma-muted">
              <ImageIcon size={22} />
              <span className="text-[9px] font-bold">Adicionar</span>
            </div>
          )}
          {dragging && (
            <div className="absolute inset-0 grid place-items-center bg-koma-page/90 text-[10px] font-black text-emerald-600">
              Solte aqui
            </div>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <h4 className="text-xs font-black text-koma-foreground">{label}</h4>
          <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
            {type === 'logo'
              ? 'Use uma versão legível em fundo escuro. Formato quadrado funciona melhor.'
              : 'Use uma foto horizontal que represente bem o restaurante ou seus produtos.'}
          </p>
          <p className="mt-1.5 text-[9px] text-koma-subtle">PNG, JPG ou WEBP · até 5 MB</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-[9px] font-bold text-koma-secondary transition hover:bg-koma-raised disabled:opacity-50"
            >
              {currentUrl ? <RefreshCw size={11} /> : <Upload size={11} />}
              {currentUrl ? 'Trocar imagem' : 'Escolher imagem'}
            </button>
            {currentUrl && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void remove()}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 py-2 text-[9px] font-bold text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300 disabled:opacity-50"
              >
                <Trash2 size={11} /> Remover
              </button>
            )}
          </div>
          {message && (
            <div
              className={clsx(
                'mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[9px] font-semibold',
                status === 'success' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
                status === 'error' && 'border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300',
                status === 'busy' && 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300',
              )}
            >
              {status === 'busy' && <Loader2 size={10} className="animate-spin" />}
              {status === 'success' && <CheckCircle2 size={10} />}
              {status === 'error' && <AlertCircle size={10} />}
              {message}
            </div>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

function PhonePreview({ config }: { config: RestaurantConfig }) {
  const statusText = config.status_override === 'Forçado Fechado'
    ? 'Pausado'
    : config.status_override === 'Forçado Aberto'
      ? 'Aberto'
      : 'Horário automático';
  const firstHours = config.horarios_funcionamento[0];

  return (
    <aside className="xl:sticky xl:top-4">
      <div className="mx-auto w-full max-w-[330px] rounded-[2.35rem] border border-koma-border bg-koma-panel p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-center gap-2 py-1">
          <span className="h-1 w-10 rounded-full bg-koma-border" />
          <span className="h-2 w-2 rounded-full bg-koma-border" />
        </div>
        <div className="overflow-hidden rounded-[1.65rem] border border-white/10 bg-[#090a0f] text-white">
          <div className="relative min-h-36 overflow-hidden p-4">
            {config.banner_url ? (
              <img src={config.banner_url} alt="Capa" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(0,184,148,0.35),transparent_45%),linear-gradient(145deg,#101b17,#090a0f)]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/15" />
            <div className="relative flex min-h-28 items-end gap-2.5">
              <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/20 bg-white text-[9px] font-black text-slate-900">
                {config.logo_url ? <img src={config.logo_url} alt="Logo" className="h-full w-full object-contain p-1" /> : 'Kôma'}
              </div>
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-xs">{config.nome || 'Seu restaurante'}</strong>
                <span className="mt-0.5 block truncate text-[8px] text-white/70">{config.subtitulo || 'Seu slogan aparece aqui'}</span>
                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/35 px-2 py-1 text-[7px] font-bold text-white/80">
                  <i className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {statusText}
                </span>
              </div>
            </div>
          </div>

          <div className="min-h-[300px] p-3">
            <div className="flex gap-1.5 overflow-hidden border-b border-white/10 pb-2.5">
              {['Destaques', 'Pizzas', 'Bebidas'].map((label, index) => (
                <span
                  key={label}
                  className={clsx(
                    'rounded-lg px-2 py-1 text-[7px] font-black',
                    index === 0 ? 'bg-emerald-500 text-white' : 'bg-white/5 text-white/55',
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              {[
                ['Produto em destaque', 'Descrição curta e objetiva do produto', 'R$ 39,90'],
                ['Outra opção do cardápio', 'Informação que ajuda a decidir', 'R$ 24,00'],
              ].map(([name, description, price]) => (
                <div key={name} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] p-2.5">
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[8px] text-white">{name}</strong>
                    <span className="mt-0.5 block truncate text-[7px] text-white/45">{description}</span>
                    <span className="mt-1.5 block text-[8px] font-black text-emerald-400">{price}</span>
                  </div>
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white/5 text-[7px] text-white/35">Foto</div>
                </div>
              ))}
            </div>
            {(config.endereco || firstHours) && (
              <div className="mt-3 space-y-1 rounded-xl border border-white/10 bg-white/[0.035] p-2.5 text-[7px] text-white/55">
                {config.endereco && (
                  <div className="flex items-center gap-1"><MapPin size={9} /> <span className="truncate">{config.endereco}</span></div>
                )}
                {firstHours && (
                  <div className="flex items-center gap-1"><Clock3 size={9} /> <span className="truncate">{firstHours.days}: {firstHours.hours}</span></div>
                )}
              </div>
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-[9px] text-koma-subtle">Prévia aproximada do cardápio público</p>
      </div>
    </aside>
  );
}

export function CardapioDigitalSettingsPanel({
  apiBaseUrl,
  authHeaders,
  publicMenuUrl,
}: CardapioDigitalSettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('perfil');
  const [config, setConfig] = useState<RestaurantConfig>(emptyConfig);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/config`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível carregar as configurações.');
      const next = normalizeConfig(data);
      setConfig(next);
      setSavedSnapshot(JSON.stringify(buildPersistedPayload(next)));
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao carregar configurações.' });
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

  const updateConfig = <K extends keyof RestaurantConfig>(key: K, value: RestaurantConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const updateSocial = (key: 'whatsapp' | 'instagram', value: string) => {
    setConfig((current) => ({
      ...current,
      socials: { ...current.socials, [key]: value },
    }));
  };

  const currentPayload = useMemo(() => buildPersistedPayload(config), [config]);
  const hasUnsavedChanges = JSON.stringify(currentPayload) !== savedSnapshot;

  const readiness = useMemo(() => {
    const checks = [
      { label: 'nome do restaurante', ok: config.nome.trim().length >= 2 },
      { label: 'contato ou endereço', ok: Boolean(String(config.socials.whatsapp || '').trim() || config.endereco.trim()) },
      {
        label: 'horário de funcionamento',
        ok: config.status_override !== 'Automático' || config.horarios_funcionamento.some((row) => row.days.trim() && row.hours.trim()),
      },
      { label: 'forma de pagamento', ok: config.formas_pagamento_aceitas.length > 0 },
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
    if (!config.nome.trim()) {
      setFeedback({ type: 'error', text: 'Informe o nome público do restaurante.' });
      setActiveTab('perfil');
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
      const next = normalizeConfig(data);
      setConfig(next);
      setSavedSnapshot(JSON.stringify(buildPersistedPayload(next)));
      setFeedback({ type: 'success', text: 'Cardápio atualizado e publicado.' });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar configurações.' });
    } finally {
      setIsSaving(false);
    }
  };

  const statusLabel = config.status_override === 'Forçado Aberto'
    ? 'Aberto'
    : config.status_override === 'Forçado Fechado'
      ? 'Pausado'
      : 'Automático';

  if (isLoading) {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-2xl border border-koma-border bg-koma-panel">
        <div className="flex items-center gap-2 text-xs font-bold text-koma-muted">
          <Loader2 size={16} className="animate-spin" /> Carregando configurações do cardápio…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-left animate-fade-in">
      <OperationalBanner
        id="online-menu-settings-heading"
        eyebrow="CARDÁPIO ONLINE"
        title="Sua vitrine"
        accent="pronta para vender"
        description="Configure só o que muda a experiência do cliente. O visual, a navegação e o fluxo de pedido seguem o padrão Kôma."
        metrics={[
          { label: 'status', value: statusLabel },
          { label: 'prontidão', value: `${readiness.completed}/${readiness.total}` },
          { label: 'pagamentos', value: config.formas_pagamento_aceitas.length },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px] xl:items-start">
        <div className="min-w-0 space-y-4">
          <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-koma-border bg-koma-panel p-2" aria-label="Seções das configurações do cardápio">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'min-w-[170px] flex-1 rounded-xl border px-3.5 py-3 text-left transition',
                    active
                      ? 'border-emerald-500/45 bg-emerald-500/10 text-koma-foreground'
                      : 'border-transparent text-koma-secondary hover:border-koma-border hover:bg-koma-raised',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={15} className={active ? 'text-emerald-600 dark:text-emerald-300' : 'text-koma-muted'} />
                    <strong className="text-[11px]">{tab.label}</strong>
                  </div>
                  <span className="mt-1.5 block text-[9px] leading-relaxed text-koma-muted">{tab.description}</span>
                </button>
              );
            })}
          </nav>

          <div
            className={clsx(
              'flex items-start gap-3 rounded-2xl border px-4 py-3.5',
              readiness.ready
                ? 'border-emerald-500/25 bg-emerald-500/[0.08]'
                : 'border-amber-500/25 bg-amber-500/[0.07]',
            )}
          >
            <div className={clsx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl', readiness.ready ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500')}>
              {readiness.ready ? <BadgeCheck size={17} /> : <Sparkles size={17} />}
            </div>
            <div className="min-w-0">
              <strong className="block text-[11px] text-koma-foreground">
                {readiness.ready ? 'Cardápio pronto para receber pedidos' : `${readiness.missing.length} ajuste${readiness.missing.length === 1 ? '' : 's'} recomendado${readiness.missing.length === 1 ? '' : 's'}`}
              </strong>
              <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
                {readiness.ready
                  ? 'As informações essenciais estão preenchidas. Você pode continuar refinando fotos e descrição quando quiser.'
                  : `Complete ${readiness.missing.join(', ')} para reduzir dúvidas do cliente durante o pedido.`}
              </p>
            </div>
          </div>

          <main className="rounded-2xl border border-koma-border bg-koma-panel px-4 sm:px-5">
            {activeTab === 'perfil' && (
              <>
                <SettingsSection
                  title="Identidade do restaurante"
                  description="Essas informações aparecem no topo do cardápio e ajudam o cliente a reconhecer a loja certa."
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="sm:col-span-2">
                      <FieldLabel>Nome público do restaurante</FieldLabel>
                      <input
                        value={config.nome}
                        onChange={(event) => updateConfig('nome', event.target.value)}
                        maxLength={120}
                        className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm font-semibold text-koma-foreground outline-none focus:border-emerald-500/60"
                        placeholder="Ex.: Pizzeria Bella Italia"
                      />
                    </label>
                    <label className="sm:col-span-2">
                      <FieldLabel>Slogan / frase curta</FieldLabel>
                      <input
                        value={config.subtitulo}
                        onChange={(event) => updateConfig('subtitulo', event.target.value)}
                        maxLength={180}
                        className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm text-koma-foreground outline-none focus:border-emerald-500/60"
                        placeholder="Ex.: Pizza artesanal no forno a lenha"
                      />
                    </label>
                    <label className="sm:col-span-2">
                      <FieldLabel>Sobre o restaurante</FieldLabel>
                      <textarea
                        value={config.sobre_nos}
                        onChange={(event) => updateConfig('sobre_nos', event.target.value)}
                        maxLength={900}
                        rows={4}
                        className="w-full resize-y rounded-xl border border-koma-border bg-koma-input px-3.5 py-3 text-sm leading-relaxed text-koma-foreground outline-none focus:border-emerald-500/60"
                        placeholder="Conte em poucas linhas o que torna o restaurante especial."
                      />
                      <span className="mt-1 block text-right text-[9px] text-koma-subtle">{config.sobre_nos.length}/900</span>
                    </label>
                  </div>
                </SettingsSection>

                <SettingsSection
                  separated
                  title="Contato e localização"
                  description="Deixe fácil falar com o restaurante ou encontrar o endereço sem sair procurando informação."
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label>
                      <FieldLabel>WhatsApp</FieldLabel>
                      <div className="relative">
                        <MessageCircle size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
                        <input
                          value={String(config.socials.whatsapp || '')}
                          onChange={(event) => updateSocial('whatsapp', event.target.value)}
                          className="h-11 w-full rounded-xl border border-koma-border bg-koma-input pl-9 pr-3 text-sm text-koma-foreground outline-none focus:border-emerald-500/60"
                          placeholder="(85) 99999-9999"
                        />
                      </div>
                    </label>
                    <label>
                      <FieldLabel>Instagram</FieldLabel>
                      <div className="relative">
                        <Instagram size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
                        <input
                          value={String(config.socials.instagram || '')}
                          onChange={(event) => updateSocial('instagram', event.target.value)}
                          className="h-11 w-full rounded-xl border border-koma-border bg-koma-input pl-9 pr-3 text-sm text-koma-foreground outline-none focus:border-emerald-500/60"
                          placeholder="@seurestaurante"
                        />
                      </div>
                    </label>
                    <label className="sm:col-span-2">
                      <FieldLabel>Endereço físico</FieldLabel>
                      <div className="relative">
                        <MapPin size={15} className="pointer-events-none absolute left-3 top-3.5 text-koma-muted" />
                        <input
                          value={config.endereco}
                          onChange={(event) => updateConfig('endereco', event.target.value)}
                          maxLength={240}
                          className="h-11 w-full rounded-xl border border-koma-border bg-koma-input pl-9 pr-3 text-sm text-koma-foreground outline-none focus:border-emerald-500/60"
                          placeholder="Av. Principal, 100 - Centro"
                        />
                      </div>
                    </label>
                    <label className="sm:col-span-2">
                      <FieldLabel>Link do Google Maps</FieldLabel>
                      <input
                        value={config.google_maps_url}
                        onChange={(event) => updateConfig('google_maps_url', event.target.value)}
                        className="h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3.5 text-sm text-koma-foreground outline-none focus:border-emerald-500/60"
                        placeholder="https://maps.google.com/..."
                      />
                    </label>
                  </div>
                </SettingsSection>
              </>
            )}

            {activeTab === 'pedidos' && (
              <>
                <SettingsSection
                  title="Recebimento de pedidos"
                  description="Escolha como o cardápio deve se comportar agora. O modo automático usa os horários logo abaixo."
                >
                  <div className="grid gap-2.5 md:grid-cols-3">
                    {statusOptions.map((option) => {
                      const selected = config.status_override === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => updateConfig('status_override', option.value)}
                          className={clsx(
                            'rounded-2xl border p-3.5 text-left transition',
                            selected
                              ? 'border-emerald-500/45 bg-emerald-500/10'
                              : 'border-koma-border bg-koma-card hover:border-emerald-500/25',
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

                  {config.status_override === 'Automático' && config.horarios_funcionamento.length === 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-3 text-[10px] text-amber-700 dark:text-amber-300">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      <span><strong>Automático sem horários.</strong> Cadastre pelo menos um período para o cliente saber quando os pedidos estão disponíveis.</span>
                    </div>
                  )}
                </SettingsSection>

                <SettingsSection
                  separated
                  title="Horários de funcionamento"
                  description="Use blocos simples, por exemplo “Segunda a Sexta · 18:00 - 23:00”."
                >
                  <div className="space-y-2.5">
                    {config.horarios_funcionamento.map((row) => (
                      <div key={row.id} className="grid gap-2 rounded-xl border border-koma-border bg-koma-card p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <label>
                          <FieldLabel>Dias</FieldLabel>
                          <input
                            value={row.days}
                            onChange={(event) => updateConfig('horarios_funcionamento', config.horarios_funcionamento.map((item) => item.id === row.id ? { ...item, days: event.target.value } : item))}
                            className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground outline-none focus:border-emerald-500/60"
                            placeholder="Segunda a Sexta"
                          />
                        </label>
                        <label>
                          <FieldLabel>Horário</FieldLabel>
                          <input
                            value={row.hours}
                            onChange={(event) => updateConfig('horarios_funcionamento', config.horarios_funcionamento.map((item) => item.id === row.id ? { ...item, hours: event.target.value } : item))}
                            className="h-10 w-full rounded-lg border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground outline-none focus:border-emerald-500/60"
                            placeholder="18:00 - 23:00"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => updateConfig('horarios_funcionamento', config.horarios_funcionamento.filter((item) => item.id !== row.id))}
                          className="grid h-10 w-10 place-items-center rounded-lg border border-rose-500/20 text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300"
                          aria-label={`Remover horário ${row.days}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    {config.horarios_funcionamento.length === 0 && (
                      <div className="rounded-xl border border-dashed border-koma-border p-5 text-center text-[11px] text-koma-muted">
                        Nenhum horário cadastrado ainda.
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => updateConfig('horarios_funcionamento', [...config.horarios_funcionamento, { id: `new-${Date.now()}`, days: '', hours: '' }])}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-[10px] font-black text-koma-secondary transition hover:border-emerald-500/40 hover:text-emerald-600"
                    >
                      <Plus size={13} /> Adicionar horário
                    </button>
                  </div>
                </SettingsSection>

                <SettingsSection
                  separated
                  title="Formas de pagamento aceitas"
                  description="O cliente verá estas opções antes de confirmar o pedido. O pagamento continua sendo feito diretamente ao restaurante."
                >
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {paymentOptions.map((option) => {
                      const checked = config.formas_pagamento_aceitas.includes(option.id);
                      return (
                        <label
                          key={option.id}
                          className={clsx(
                            'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition',
                            checked
                              ? 'border-emerald-500/40 bg-emerald-500/10'
                              : 'border-koma-border bg-koma-card hover:border-emerald-500/25',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => updateConfig(
                              'formas_pagamento_aceitas',
                              event.target.checked
                                ? [...config.formas_pagamento_aceitas, option.id]
                                : config.formas_pagamento_aceitas.filter((item) => item !== option.id),
                            )}
                            className="mt-0.5 h-4 w-4 accent-emerald-500"
                          />
                          <span>
                            <strong className="block text-xs text-koma-foreground">{option.label}</strong>
                            <span className="mt-1 block text-[9px] leading-relaxed text-koma-muted">{option.helper}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </SettingsSection>
              </>
            )}

            {activeTab === 'marca' && (
              <SettingsSection
                title="Logo e capa"
                description="A interface e as cores seguem a identidade Kôma. Você personaliza somente as imagens que identificam o restaurante."
              >
                <div className="space-y-3">
                  <AssetEditor
                    type="logo"
                    label="Logotipo do restaurante"
                    currentUrl={config.logo_url}
                    apiBaseUrl={apiBaseUrl}
                    authHeaders={authHeaders}
                    onChange={(url) => updateConfig('logo_url', url)}
                  />
                  <AssetEditor
                    type="banner"
                    label="Banner / capa"
                    currentUrl={config.banner_url}
                    apiBaseUrl={apiBaseUrl}
                    authHeaders={authHeaders}
                    onChange={(url) => updateConfig('banner_url', url)}
                  />
                </div>
              </SettingsSection>
            )}
          </main>

          <div className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-2xl border border-koma-border bg-koma-panel/95 p-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-end">
            {feedback && (
              <div className={clsx('mr-auto inline-flex items-center gap-1.5 text-[10px] font-bold', feedback.type === 'success' ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>
                {feedback.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                {feedback.text}
              </div>
            )}
            {!feedback && (
              <span className="mr-auto text-[10px] font-semibold text-koma-muted">
                {hasUnsavedChanges ? 'Há alterações que ainda não foram publicadas.' : 'Tudo salvo.'}
              </span>
            )}
            {publicMenuUrl && (
              <a
                href={publicMenuUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-4 text-[10px] font-black uppercase tracking-wider text-koma-secondary transition hover:border-emerald-500/40 hover:text-emerald-600"
              >
                <ExternalLink size={13} /> Ver cardápio
              </a>
            )}
            <button
              type="button"
              disabled={isSaving || !hasUnsavedChanges}
              onClick={() => void saveConfig()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-4 text-[10px] font-black uppercase tracking-wider text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300 disabled:cursor-default disabled:border-koma-border disabled:bg-koma-raised disabled:text-koma-muted disabled:opacity-70"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : hasUnsavedChanges ? <Save size={13} /> : <CheckCircle2 size={13} />}
              {isSaving ? 'Publicando…' : hasUnsavedChanges ? 'Salvar e publicar' : 'Tudo salvo'}
            </button>
          </div>
        </div>

        <PhonePreview config={config} />
      </div>
    </div>
  );
}
