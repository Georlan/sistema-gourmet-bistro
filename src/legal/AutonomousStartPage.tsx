import React, { FormEvent, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Clock,
  ExternalLink,
  Layers,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Sparkles,
  Store,
  User,
} from 'lucide-react';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../brand/komaBrand';
import { API_BASE_URL } from '../config/api';
import { SUBSCRIPTION_PLANS, type SubscriptionPlanId } from '../config/subscriptionPlans';
import {
  parseExpressOnboardingText,
  parseExpressOperatingHours,
  type ExpressOperationProfile,
  type ExpressOrderType,
} from '../domain/expressOnboardingParser';
import { getTenantPublicMenuUrl } from '../domain/komaHost';
import { saveOperatorSession } from '../utils/authSession';
import './legal.css';
import './planSubscriptionFlow.css';

type StartMode = 'guided' | 'express';

const SEGMENT_CHOICES: ReadonlyArray<{
  id: string;
  label: string;
  profile: ExpressOperationProfile;
  preset: string;
}> = [
  { id: 'pizzaria', label: 'Pizzaria', profile: 'pizzaria', preset: 'pizzaria' },
  { id: 'hamburgueria', label: 'Hamburgueria', profile: 'generic', preset: 'hamburgueria' },
  { id: 'marmitaria', label: 'Marmitaria / PF', profile: 'marmitaria', preset: 'marmitaria' },
  { id: 'acaiteria', label: 'Açaiteria', profile: 'acai', preset: 'acaiteria' },
  { id: 'pastelaria', label: 'Pastelaria', profile: 'generic', preset: 'pastelaria' },
  { id: 'restaurante', label: 'Outro / Restaurante', profile: 'generic', preset: 'restaurante' },
];

const ORDER_TYPE_OPTIONS: ReadonlyArray<{ id: ExpressOrderType; label: string }> = [
  { id: 'delivery', label: 'Delivery' },
  { id: 'retirada', label: 'Retirada' },
  { id: 'consumo_local', label: 'Consumo no local' },
];

const EXPRESS_PLACEHOLDER = `Nome: Pizzaria Don Romano
Segmento: Pizzaria
Responsável: João Romano
Email: joao@donromano.com.br
WhatsApp: 85999990000
Atendimento: Delivery, Retirada
Horário: 18h às 23h
Cardápio:
Pizzas Tradicionais:
Calabresa - R$ 49,90
Marguerita - R$ 47,90
Portuguesa - R$ 52,90`;

type ProvisionedSuccess = {
  id: string;
  name: string;
  subdomain: string;
  plan: string;
  operationProfile: string;
  preparationMode: boolean;
  bootstrap: {
    categoriesCreated: number;
    productsCreated: number;
    orderTypes: string[];
    operatingHours: Array<{ days: string; hours: string }>;
  };
  paths: {
    cashier: string;
    publicMenu: string;
  };
  message?: string;
};

function readInitialPlan(): SubscriptionPlanId {
  if (typeof window === 'undefined') return 'pro';
  const raw = new URLSearchParams(window.location.search).get('plano')?.toLowerCase();
  if (raw && SUBSCRIPTION_PLANS.some((plan) => plan.id === raw)) {
    return raw as SubscriptionPlanId;
  }
  return 'pro';
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `pub-${crypto.randomUUID()}`;
  }
  return `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function AutonomousStartPage() {
  const [mode, setMode] = useState<StartMode>('guided');
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanId>(readInitialPlan);
  const [segmentChoice, setSegmentChoice] = useState<string>('pizzaria');
  const [name, setName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [applyPreset, setApplyPreset] = useState(true);
  const [showOptionalSetup, setShowOptionalSetup] = useState(false);
  const [orderTypes, setOrderTypes] = useState<ExpressOrderType[]>(['delivery', 'retirada']);
  const [hoursText, setHoursText] = useState('18:00 - 23:00');
  const [menuText, setMenuText] = useState('');

  const [expressText, setExpressText] = useState('');
  const [expressPassword, setExpressPassword] = useState('');
  const [expressAnalyzed, setExpressAnalyzed] = useState(false);

  const [idempotencyKey] = useState<string>(generateIdempotencyKey);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProvisionedSuccess | null>(null);

  const activeSegment = useMemo(
    () => SEGMENT_CHOICES.find((item) => item.id === segmentChoice) || SEGMENT_CHOICES[0],
    [segmentChoice],
  );

  const parsedExpress = useMemo(
    () => parseExpressOnboardingText(expressText, { requireAdminCredentials: true }),
    [expressText],
  );

  const toggleOrderType = (target: ExpressOrderType) => {
    setOrderTypes((prev) =>
      prev.includes(target) ? prev.filter((item) => item !== target) : [...prev, target],
    );
  };

  const handleAnalyzeExpress = () => {
    setError(null);
    setExpressAnalyzed(true);
    if (parsedExpress.fields.name && !name) setName(parsedExpress.fields.name);
    if (parsedExpress.fields.adminName && !adminName) setAdminName(parsedExpress.fields.adminName);
    if (parsedExpress.fields.adminEmail && !adminEmail) setAdminEmail(parsedExpress.fields.adminEmail);
    if (parsedExpress.fields.phone && !phone) setPhone(parsedExpress.fields.phone);
  };

  const submitStart = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);

    let body: Record<string, unknown>;
    if (mode === 'express') {
      const effectiveAdminName = (adminName || parsedExpress.fields.adminName).trim();
      const effectiveAdminEmail = (adminEmail || parsedExpress.fields.adminEmail).trim().toLowerCase();
      if (!parsedExpress.fields.name || parsedExpress.fields.name.length < 2) {
        setError('Informe o nome do restaurante no texto estruturado (ex.: Nome: Pizzaria Don Romano).');
        return;
      }
      if (effectiveAdminName.length < 2 || !effectiveAdminEmail.includes('@')) {
        setError('Informe o nome do responsável e um e-mail válido antes de continuar.');
        return;
      }
      if (expressPassword.length < 8) {
        setError('Defina uma senha com pelo menos 8 caracteres para acessar o painel agora.');
        return;
      }
      body = {
        structured_text: expressText,
        admin_name: effectiveAdminName,
        admin_email: effectiveAdminEmail,
        admin_password: expressPassword,
        phone: (phone || parsedExpress.fields.phone || '').trim() || undefined,
        plan: parsedExpress.fields.plan || selectedPlan,
        apply_segment_preset: applyPreset,
        idempotency_key: idempotencyKey,
      };
    } else {
      if (name.trim().length < 2 || adminName.trim().length < 2 || !adminEmail.includes('@')) {
        setError('Preencha nome do restaurante, seu nome e um e-mail válido.');
        return;
      }
      if (adminPassword.length < 8) {
        setError('A senha precisa ter pelo menos 8 caracteres.');
        return;
      }
      const parsedHours = showOptionalSetup && hoursText.trim()
        ? parseExpressOperatingHours(hoursText)
        : [];
      body = {
        name: name.trim(),
        plan: selectedPlan,
        operation_profile: activeSegment.profile,
        segment_preset: activeSegment.preset,
        admin_name: adminName.trim(),
        admin_email: adminEmail.trim().toLowerCase(),
        admin_password: adminPassword,
        phone: phone.trim() || undefined,
        order_types: showOptionalSetup ? orderTypes : [],
        operating_hours: parsedHours,
        apply_segment_preset: applyPreset,
        menu_text: showOptionalSetup && menuText.trim() ? menuText.trim() : undefined,
        idempotency_key: idempotencyKey,
      };
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/provisioning/public/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.detail;
        if (Array.isArray(detail)) {
          throw new Error(detail.map((item) => item?.msg).filter(Boolean).join(' · ') || 'Dados inválidos.');
        }
        throw new Error(typeof detail === 'string' ? detail : 'Não foi possível criar seu restaurante agora.');
      }

      if (payload?.access_token && payload?.user) {
        saveOperatorSession(payload.access_token, payload.user, 'caixa');
      }
      setCreated(payload as ProvisionedSuccess);
    } catch (failure) {
      const msg = failure instanceof Error ? failure.message : '';
      if (!msg || /failed to fetch|networkerror|load failed/i.test(msg)) {
        setError('Não foi possível conectar ao servidor no momento. Verifique sua conexão e tente novamente.');
      } else {
        setError(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (created) {
    const publicMenuHref =
      typeof window !== 'undefined' && (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
        ? `/c/${created.subdomain}`
        : getTenantPublicMenuUrl(created.subdomain);
    return (
      <div className="koma-sub-wrapper">
        <header className="koma-sub-header">
          <a href="/" className="koma-sub-brand" aria-label="Voltar para o KÔMA">
            <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
          </a>
          <span className="koma-sub-secure">
            <ShieldCheck size={14} /> Preparação ativa
          </span>
        </header>

        <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
          <section className="rounded-2xl border border-emerald-500/35 bg-[#0b0f0d] p-6 sm:p-8 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-emerald-500/40 bg-emerald-950/50 text-[#0bd6ad]">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#0bd6ad]">
                  MODO PREPARAÇÃO · TENANT #{created.id}
                </span>
                <h1 className="mt-1 text-2xl font-bold text-white" style={{ fontFamily: 'var(--koma-font-display, "Space Grotesk", sans-serif)' }}>
                  {created.name} está pronto para configurar.
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-[#9aa7a1]">
                  Sua conta já está autenticada. Seus <strong className="text-white">7 dias grátis ainda não começaram</strong>: prepare cardápio, horários e atendimento no ritmo da sua equipe antes da ativação comercial.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3 text-xs">
              <div className="rounded-xl border border-white/10 bg-[#070908] p-3.5">
                <span className="text-[#9aa7a1]">Endereço público</span>
                <p className="mt-1 font-mono font-semibold text-white break-words">{created.subdomain}.komafood.com.br</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#070908] p-3.5">
                <span className="text-[#9aa7a1]">Categorias prontas</span>
                <p className="mt-1 text-lg font-bold text-[#0bd6ad]">{created.bootstrap?.categoriesCreated ?? 0}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#070908] p-3.5">
                <span className="text-[#9aa7a1]">Itens importados</span>
                <p className="mt-1 text-lg font-bold text-[#0bd6ad]">{created.bootstrap?.productsCreated ?? 0}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href="/?view=caixa"
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0bd6ad] px-5 py-3.5 text-sm font-bold text-[#041410] transition hover:bg-[#17e8bd]"
              >
                Abrir meu painel agora <ArrowRight size={18} />
              </a>
              <a
                href={publicMenuHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#0f1512] px-4 py-3.5 text-sm font-semibold text-white hover:border-[#0bd6ad]/50"
              >
                Ver prévia do cardápio <ExternalLink size={16} />
              </a>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="koma-sub-wrapper">
      <header className="koma-sub-header">
        <a href="/" className="koma-sub-brand" aria-label="Voltar para o KÔMA">
          <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
        </a>
        <nav className="koma-sub-nav" aria-label="Navegação inicial">
          <a href={`/contratar/${selectedPlan}`}>Já quero contratar</a>
          <span className="koma-sub-secure">
            <ShieldCheck size={14} /> Preparação sem compromisso
          </span>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <div className="mb-6">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#0bd6ad]">
            CADASTRO AUTÔNOMO · SEM BUROCRACIA
          </span>
          <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-white" style={{ fontFamily: 'var(--koma-font-display, "Space Grotesk", sans-serif)' }}>
            Prepare seu restaurante em menos de 1 minuto.
          </h1>
          <p className="mt-2 text-sm text-[#9aa7a1]">
            Monte suas categorias, horários e cardápio direto no celular antes de qualquer contratação. Os 7 dias grátis só começam depois que tudo estiver pronto.
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-[#0b0f0d] p-1.5" role="tablist" aria-label="Modo de criação">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'guided'}
            onClick={() => { setMode('guided'); setError(null); }}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold transition ${
              mode === 'guided'
                ? 'bg-[#0bd6ad] text-[#041410]'
                : 'text-[#9aa7a1] hover:text-white'
            }`}
          >
            <Sparkles size={15} /> Cadastro rápido
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'express'}
            onClick={() => { setMode('express'); setError(null); }}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold transition ${
              mode === 'express'
                ? 'bg-[#0bd6ad] text-[#041410]'
                : 'text-[#9aa7a1] hover:text-white'
            }`}
          >
            <ClipboardPaste size={15} /> Colar texto (Expresso)
          </button>
        </div>

        <form onSubmit={submitStart} className="space-y-5 rounded-2xl border border-white/10 bg-[#0b0f0d] p-5 sm:p-7">
          {error && (
            <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
              {error}
            </div>
          )}

          {mode === 'guided' ? (
            <>
              <div>
                <span className="mb-2 block text-xs font-semibold text-[#9aa7a1]">Segmento do negócio</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {SEGMENT_CHOICES.map((seg) => {
                    const active = seg.id === segmentChoice;
                    return (
                      <button
                        key={seg.id}
                        type="button"
                        onClick={() => setSegmentChoice(seg.id)}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition ${
                          active
                            ? 'border-[#0bd6ad] bg-[#0bd6ad]/10 text-white'
                            : 'border-white/10 bg-[#070908] text-[#9aa7a1] hover:border-white/25'
                        }`}
                      >
                        <span>{seg.label}</span>
                        {active && <Check size={14} className="text-[#0bd6ad]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1.5 flex items-center gap-1.5 font-semibold text-[#9aa7a1]">
                    <Store size={14} /> Nome do restaurante
                  </span>
                  <input
                    required
                    minLength={2}
                    maxLength={255}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex: Pizzaria Don Romano"
                    className="w-full rounded-xl border border-white/12 bg-[#070908] px-3.5 py-2.5 text-sm text-white focus:border-[#0bd6ad] focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1.5 flex items-center gap-1.5 font-semibold text-[#9aa7a1]">
                    <User size={14} /> Seu nome
                  </span>
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={adminName}
                    onChange={(event) => setAdminName(event.target.value)}
                    placeholder="Responsável pela loja"
                    className="w-full rounded-xl border border-white/12 bg-[#070908] px-3.5 py-2.5 text-sm text-white focus:border-[#0bd6ad] focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1.5 flex items-center gap-1.5 font-semibold text-[#9aa7a1]">
                    <Mail size={14} /> E-mail de acesso
                  </span>
                  <input
                    required
                    type="email"
                    maxLength={100}
                    value={adminEmail}
                    onChange={(event) => setAdminEmail(event.target.value)}
                    placeholder="voce@seurestaurante.com.br"
                    className="w-full rounded-xl border border-white/12 bg-[#070908] px-3.5 py-2.5 text-sm text-white focus:border-[#0bd6ad] focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1.5 flex items-center gap-1.5 font-semibold text-[#9aa7a1]">
                    <Lock size={14} /> Crie sua senha (mín. 8 caracteres)
                  </span>
                  <input
                    required
                    type="password"
                    minLength={8}
                    maxLength={72}
                    autoComplete="new-password"
                    value={adminPassword}
                    onChange={(event) => setAdminPassword(event.target.value)}
                    placeholder="Para entrar direto no painel"
                    className="w-full rounded-xl border border-white/12 bg-[#070908] px-3.5 py-2.5 text-sm text-white focus:border-[#0bd6ad] focus:outline-none"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1.5 flex items-center gap-1.5 font-semibold text-[#9aa7a1]">
                    <Phone size={14} /> WhatsApp (opcional)
                  </span>
                  <input
                    type="tel"
                    maxLength={30}
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="(85) 99999-0000"
                    className="w-full rounded-xl border border-white/12 bg-[#070908] px-3.5 py-2.5 text-sm text-white focus:border-[#0bd6ad] focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1.5 flex items-center gap-1.5 font-semibold text-[#9aa7a1]">
                    <Layers size={14} /> Plano desejado para preparação
                  </span>
                  <select
                    value={selectedPlan}
                    onChange={(event) => setSelectedPlan(event.target.value as SubscriptionPlanId)}
                    className="w-full rounded-xl border border-white/12 bg-[#070908] px-3.5 py-2.5 text-sm text-white focus:border-[#0bd6ad] focus:outline-none"
                  >
                    {SUBSCRIPTION_PLANS.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-[#070908] p-3 text-xs text-[#9aa7a1]">
                <input
                  type="checkbox"
                  checked={applyPreset}
                  onChange={(event) => setApplyPreset(event.target.checked)}
                  className="mt-0.5 rounded border-white/20"
                />
                <span>
                  Criar automaticamente as categorias iniciais sugeridas para <strong className="text-white">{activeSegment.label}</strong> (você pode editar ou excluir depois).
                </span>
              </label>

              <div className="rounded-xl border border-white/10 bg-[#070908] p-3.5">
                <button
                  type="button"
                  onClick={() => setShowOptionalSetup((prev) => !prev)}
                  className="flex w-full items-center justify-between text-left text-xs font-bold text-[#0bd6ad]"
                >
                  <span>{showOptionalSetup ? 'Ocultar configuração adiantada' : 'Já tem horários, atendimento ou lista de itens? Adiantar agora (opcional)'}</span>
                  <span>{showOptionalSetup ? '−' : '+'}</span>
                </button>

                {showOptionalSetup && (
                  <div className="mt-4 space-y-4 border-t border-white/10 pt-4 text-xs">
                    <div>
                      <span className="mb-2 block font-semibold text-[#9aa7a1]">Modalidades de atendimento</span>
                      <div className="flex flex-wrap gap-2">
                        {ORDER_TYPE_OPTIONS.map((option) => {
                          const selected = orderTypes.includes(option.id);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => toggleOrderType(option.id)}
                              className={`rounded-lg border px-3 py-1.5 font-semibold ${
                                selected
                                  ? 'border-[#0bd6ad] bg-[#0bd6ad]/15 text-white'
                                  : 'border-white/10 bg-[#0b0f0d] text-[#9aa7a1]'
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <label className="block">
                      <span className="mb-1.5 flex items-center gap-1.5 font-semibold text-[#9aa7a1]">
                        <Clock size={14} /> Horário de funcionamento
                      </span>
                      <input
                        value={hoursText}
                        onChange={(event) => setHoursText(event.target.value)}
                        placeholder="Ex: 18h às 23h"
                        className="w-full rounded-xl border border-white/12 bg-[#0b0f0d] px-3.5 py-2 text-sm text-white focus:border-[#0bd6ad] focus:outline-none"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block font-semibold text-[#9aa7a1]">
                        Colar itens iniciais do cardápio (um por linha, com preço)
                      </span>
                      <textarea
                        rows={4}
                        value={menuText}
                        onChange={(event) => setMenuText(event.target.value)}
                        placeholder={'Pizzas Tradicionais:\nCalabresa - R$ 49,90\nMarguerita - R$ 47,90'}
                        className="w-full rounded-xl border border-white/12 bg-[#0b0f0d] p-3 font-mono text-xs text-white focus:border-[#0bd6ad] focus:outline-none"
                      />
                    </label>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#9aa7a1]">
                  Cole dados do restaurante e itens de cardápio
                </span>
                <button
                  type="button"
                  onClick={() => { setExpressText(EXPRESS_PLACEHOLDER); setExpressAnalyzed(true); }}
                  className="rounded-lg border border-white/15 bg-[#070908] px-2.5 py-1 text-[11px] font-semibold text-[#0bd6ad] hover:border-[#0bd6ad]"
                >
                  Inserir exemplo preenchido
                </button>
              </div>

              <textarea
                rows={8}
                value={expressText}
                onChange={(event) => setExpressText(event.target.value)}
                placeholder={EXPRESS_PLACEHOLDER}
                aria-label="Texto estruturado do restaurante"
                className="w-full rounded-xl border border-white/12 bg-[#070908] p-3.5 font-mono text-xs leading-relaxed text-white focus:border-[#0bd6ad] focus:outline-none"
              />

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleAnalyzeExpress}
                  className="rounded-xl border border-[#0bd6ad]/50 bg-[#0bd6ad]/10 px-4 py-2 text-xs font-bold text-[#0bd6ad] hover:bg-[#0bd6ad]/20"
                >
                  Analisar texto antes de criar
                </button>
                <span className="text-[11px] text-[#9aa7a1]">
                  Campos ausentes são apontados sem invenção.
                </span>
              </div>

              {(expressAnalyzed || expressText.trim().length > 0) && (
                <div className="rounded-xl border border-white/10 bg-[#070908] p-4 text-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-white">
                      Prévia interpretada: {parsedExpress.fields.name || 'Nome não identificado'}
                    </strong>
                    <span className="font-mono text-[11px] text-[#0bd6ad]">
                      {parsedExpress.fields.operationProfile} · {parsedExpress.menuItems.length} item(ns)
                    </span>
                  </div>
                  {parsedExpress.fields.orderTypes.length > 0 && (
                    <p className="text-[#9aa7a1]">
                      Atendimento: <span className="text-white">{parsedExpress.fields.orderTypes.join(', ')}</span>
                    </p>
                  )}
                  {parsedExpress.fields.operatingHours.length > 0 && (
                    <p className="text-[#9aa7a1]">
                      Horário:{' '}
                      <span className="text-white">
                        {parsedExpress.fields.operatingHours.map((row) => `${row.days}: ${row.hours}`).join(' · ')}
                      </span>
                    </p>
                  )}
                  {parsedExpress.missingRequiredFields.length > 0 && (
                    <p className="text-amber-300">
                      Faltam para criar a conta: {parsedExpress.missingRequiredFields.join(', ')} (preencha abaixo ou no texto).
                    </p>
                  )}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-3 text-xs">
                <label className="block">
                  <span className="mb-1 block font-semibold text-[#9aa7a1]">Responsável</span>
                  <input
                    value={adminName || parsedExpress.fields.adminName}
                    onChange={(event) => setAdminName(event.target.value)}
                    placeholder="Nome do responsável"
                    className="w-full rounded-xl border border-white/12 bg-[#070908] px-3 py-2 text-sm text-white focus:border-[#0bd6ad] focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-semibold text-[#9aa7a1]">E-mail</span>
                  <input
                    type="email"
                    value={adminEmail || parsedExpress.fields.adminEmail}
                    onChange={(event) => setAdminEmail(event.target.value)}
                    placeholder="admin@restaurante.com"
                    className="w-full rounded-xl border border-white/12 bg-[#070908] px-3 py-2 text-sm text-white focus:border-[#0bd6ad] focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-semibold text-[#9aa7a1]">Senha (mín. 8)</span>
                  <input
                    required
                    type="password"
                    minLength={8}
                    maxLength={72}
                    autoComplete="new-password"
                    value={expressPassword}
                    onChange={(event) => setExpressPassword(event.target.value)}
                    placeholder="Senha de acesso"
                    className="w-full rounded-xl border border-white/12 bg-[#070908] px-3 py-2 text-sm text-white focus:border-[#0bd6ad] focus:outline-none"
                  />
                </label>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0bd6ad] px-5 py-3.5 text-sm font-bold text-[#041410] transition hover:bg-[#17e8bd] disabled:opacity-60"
          >
            {isSubmitting ? 'Preparando restaurante...' : 'Criar restaurante em preparação'}
            <ArrowRight size={18} />
          </button>
        </form>
      </main>
    </div>
  );
}

export default AutonomousStartPage;
