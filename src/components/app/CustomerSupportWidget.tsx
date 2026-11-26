import '../shared/komaOperationalOverlays.css';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Bug,
  CheckCircle2,
  CircleHelp,
  Info,
  Lightbulb,
  MessageSquareWarning,
  Send,
  Sparkles,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { API_BASE_URL } from '../../config/api';
import { getOperatorSession, type OperatorSession } from '../../utils/authSession';
import { KOMA_NAVIGATE_GO_EVENT } from '../../utils/deepLinkStorage';
import { OPEN_SUPPORT_WIDGET_EVENT, getLatestApiError, type RecentApiError } from '../../utils/supportCode';
import { resolveCurrentCashierNavigationId } from '../caixa/navigation/cashierDeepLink';
import { KOMA_OPEN_CUSTOMER_SUPPORT_EVENT } from './customerSupportEvents';

type FeedbackKind = 'question' | 'suggestion' | 'complaint' | 'problem';
type SupportSurface = 'caixa' | 'garcom' | 'entregador';
type SupportEvidenceStatus =
  | 'api_error_detected'
  | 'config_condition_found'
  | 'possible_bug_no_config_blocker'
  | 'guidance_only';

interface DiagnosticIssue {
  code: string;
  severity: 'error' | 'warning' | 'info' | string;
  domain?: string;
  title: string;
  description: string;
  action_label: string;
  go_id: string;
}

interface DiagnosticsSnapshot {
  summary_status: 'ok' | 'attention' | string;
  issues: DiagnosticIssue[];
}

interface AssistantStep {
  title: string;
  description: string;
  action_label?: string | null;
  go_id?: string | null;
}

interface SupportAssistResult {
  interpreted_domain: string;
  evidence_status: SupportEvidenceStatus;
  suspected_bug: boolean;
  headline: string;
  summary: string;
  related_checks: DiagnosticIssue[];
  guided_steps: AssistantStep[];
  unrelated_observations_count: number;
  triage_context?: {
    interpreted_domain?: string;
    evidence_status?: SupportEvidenceStatus;
    suspected_bug?: boolean;
  };
}

interface QuickTopicOption {
  id: string;
  label: string;
  prompt: string;
}

const QUICK_TOPICS: readonly QuickTopicOption[] = [
  {
    id: 'cardapio_online',
    label: 'Cardápio online',
    prompt: 'Meu cardápio online não está recebendo pedidos como esperado.',
  },
  {
    id: 'entrega',
    label: 'Entrega',
    prompt: 'Preciso verificar taxas ou regras de entrega na loja.',
  },
  {
    id: 'impressao',
    label: 'Impressão',
    prompt: 'A impressão de pedidos não está funcionando como esperado.',
  },
  {
    id: 'pagamentos',
    label: 'Pagamentos',
    prompt: 'Estou com dúvida ou falha em pagamentos online ou Pix.',
  },
  {
    id: 'caixa',
    label: 'Caixa/Turno',
    prompt: 'Estou com dúvida ou problema na abertura ou conferência do caixa.',
  },
  {
    id: 'mesas',
    label: 'Mesas',
    prompt: 'Estou com dúvida ou problema no mapa ou lançamento de mesas.',
  },
] as const;

const EVIDENCE_BADGES: Record<SupportEvidenceStatus, { label: string; tone: 'error' | 'warning' | 'accent' }> = {
  api_error_detected: { label: 'Erro técnico detectado', tone: 'error' },
  config_condition_found: { label: 'Condição encontrada na configuração', tone: 'warning' },
  possible_bug_no_config_blocker: { label: 'Possível bug — sem bloqueio de configuração', tone: 'error' },
  guidance_only: { label: 'Orientação rápida', tone: 'accent' },
};

type FeedbackOption = {
  id: FeedbackKind;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const MANAGEMENT_ROLES = new Set(['admin', 'gerente', 'superadmin']);
const SAFE_VERSION_RE = /^[a-zA-Z0-9._-]{4,64}$/;

const FEEDBACK_OPTIONS: readonly FeedbackOption[] = [
  {
    id: 'question',
    label: 'Dúvida',
    description: 'Não encontrei ou não entendi como fazer algo.',
    icon: CircleHelp,
  },
  {
    id: 'suggestion',
    label: 'Sugestão',
    description: 'Tenho uma ideia para deixar o KÔMA melhor ou mais simples.',
    icon: Lightbulb,
  },
  {
    id: 'problem',
    label: 'Problema',
    description: 'Algo não funcionou como eu esperava.',
    icon: Wrench,
  },
  {
    id: 'complaint',
    label: 'Reclamação',
    description: 'Quero registrar uma insatisfação ou dificuldade.',
    icon: MessageSquareWarning,
  },
] as const;

function readSession(): OperatorSession | null {
  try {
    return getOperatorSession();
  } catch {
    return null;
  }
}

function detectSupportSurface(session: OperatorSession | null): SupportSurface {
  try {
    const portal = typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem('koma_active_operational_portal')
      : null;
    if (portal === 'caixa' || portal === 'garcom') return portal;
  } catch {
    // Ignore storage read failures.
  }
  const role = String(session?.user?.role || session?.user?.cargo || '').trim().toLowerCase();
  if (role === 'entregador') return 'entregador';
  if (role === 'garcom') return 'garcom';
  return 'caixa';
}

function readSafeFrontendVersion(): string | undefined {
  const sha = String(import.meta.env?.VITE_BUILD_SHA || '').trim();
  return SAFE_VERSION_RE.test(sha) ? sha : undefined;
}

export function CustomerSupportWidget() {
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const [session, setSession] = useState<OperatorSession | null>(() => readSession());
  const scopeRef = useRef<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>('question');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [sentId, setSentId] = useState<string | null>(null);
  const [attachedSupportCode, setAttachedSupportCode] = useState<string | null>(null);
  const [latestApiError, setLatestApiError] = useState<RecentApiError | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [assistantResult, setAssistantResult] = useState<SupportAssistResult | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [resolvedByAssistant, setResolvedByAssistant] = useState(false);

  useEffect(() => {
    const acceptSession = (next: OperatorSession | null) => {
      const scope = next ? `${next.user.restaurante_id}:${next.user.id}` : null;
      if (scopeRef.current !== null && scope !== scopeRef.current) {
        setMessage('');
        setKind('question');
        setSentId(null);
        setError('');
        setAttachedSupportCode(null);
        setLatestApiError(null);
        setDiagnostics(null);
        setSelectedTopic(null);
        setAssistantResult(null);
        setAssistantLoading(false);
        setResolvedByAssistant(false);
        setIsOpen(false);
      }
      scopeRef.current = scope;
      setSession(next);
    };
    acceptSession(readSession());
    const syncSession = () => acceptSession(readSession());

    const openSupportDrawer = (supportCode?: string | null) => {
      const nextSession = readSession();
      acceptSession(nextSession);
      if (!nextSession?.token) return;
      const latestErr = getLatestApiError();
      setLatestApiError(latestErr);
      if (supportCode) {
        setKind('problem');
        setAttachedSupportCode(supportCode);
      } else {
        setAttachedSupportCode(latestErr?.support_code ?? null);
      }
      setSentId(null);
      setError('');
      setResolvedByAssistant(false);
      setIsOpen(true);
    };

    const onOpenDefault = () => openSupportDrawer();
    const onOpenWithCode = (event: Event) => {
      const detail = (event as CustomEvent<{ supportCode?: string }>).detail;
      openSupportDrawer(detail?.supportCode ?? null);
    };

    window.addEventListener('focus', syncSession);
    window.addEventListener('storage', syncSession);
    window.addEventListener(KOMA_OPEN_CUSTOMER_SUPPORT_EVENT, onOpenDefault);
    window.addEventListener(OPEN_SUPPORT_WIDGET_EVENT, onOpenWithCode);
    return () => {
      window.removeEventListener('focus', syncSession);
      window.removeEventListener('storage', syncSession);
      window.removeEventListener(KOMA_OPEN_CUSTOMER_SUPPORT_EVENT, onOpenDefault);
      window.removeEventListener(OPEN_SUPPORT_WIDGET_EVENT, onOpenWithCode);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!sentId) messageRef.current?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = previous; };
  }, [isOpen, sentId]);

  const role = String(session?.user?.role || session?.user?.cargo || '').trim().toLowerCase();
  const isManagementRole = MANAGEMENT_ROLES.has(role);
  const surface = detectSupportSurface(session);

  useEffect(() => {
    if (!isOpen || !session?.token || !isManagementRole) {
      setDiagnostics(null);
      setDiagnosticsLoading(false);
      return;
    }
    const controller = new AbortController();
    setDiagnosticsLoading(true);
    fetch(`${API_BASE_URL}/api/support/diagnostics`, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as DiagnosticsSnapshot;
      })
      .then((data) => {
        if (controller.signal.aborted || !data || !Array.isArray(data.issues)) return;
        setDiagnostics(data);
      })
      .catch(() => {
        // Autodiagnóstico é auxiliar e falha de forma silenciosa.
      })
      .finally(() => {
        if (!controller.signal.aborted) setDiagnosticsLoading(false);
      });
    return () => controller.abort();
  }, [isOpen, session?.token, isManagementRole]);

  const activeOption = useMemo(
    () => FEEDBACK_OPTIONS.find((option) => option.id === kind) ?? FEEDBACK_OPTIONS[0],
    [kind],
  );

  if (!session?.token || !isOpen) return null;

  const resetForm = () => {
    setKind('question');
    setMessage('');
    setError('');
    setSentId(null);
    setSelectedTopic(null);
    setAssistantResult(null);
    setAssistantLoading(false);
    setResolvedByAssistant(false);
    setAttachedSupportCode(getLatestApiError()?.support_code ?? null);
  };

  const closeDrawer = () => {
    setIsOpen(false);
    setError('');
  };

  const navigateToDiagnosticTarget = (goId: string) => {
    closeDrawer();
    if (surface === 'caixa') {
      window.dispatchEvent(new CustomEvent(KOMA_NAVIGATE_GO_EVENT, { detail: { id: goId } }));
      return;
    }
    window.location.assign(`/?go=${encodeURIComponent(goId)}`);
  };

  const buildContextPayload = (assistantSnapshot: SupportAssistResult | null): Record<string, unknown> => {
    const currentNavId = surface === 'caixa' && typeof sessionStorage !== 'undefined'
      ? resolveCurrentCashierNavigationId(
          sessionStorage.getItem('koma_active_tab'),
          sessionStorage.getItem('koma_active_subtab'),
        )
      : null;
    const frontendVersion = readSafeFrontendVersion();
    const effectiveSupportCode = attachedSupportCode || latestApiError?.support_code || null;
    const detectedIssueCodes = (diagnostics?.issues ?? []).map((item) => item.code).slice(0, 12);

    return {
      surface,
      ...(currentNavId ? { navigation_id: currentNavId } : {}),
      ...(frontendVersion ? { frontend_version: frontendVersion } : {}),
      ...(effectiveSupportCode ? { last_support_code: effectiveSupportCode } : {}),
      ...(latestApiError ? {
        last_error_status: latestApiError.status,
        last_error_area: latestApiError.area,
        last_error_endpoint: latestApiError.endpoint,
      } : {}),
      ...(detectedIssueCodes.length ? { detected_issue_codes: detectedIssueCodes } : {}),
      ...(assistantSnapshot ? {
        interpreted_domain: assistantSnapshot.interpreted_domain,
        suspected_bug: assistantSnapshot.suspected_bug,
        evidence_status: assistantSnapshot.evidence_status,
      } : {}),
    };
  };

  const analyzeWithAssistant = async (
    topicOverride?: string | null,
    messageOverride?: string,
  ) => {
    const topicId = topicOverride !== undefined ? topicOverride : selectedTopic;
    const targetMessage = (messageOverride !== undefined ? messageOverride : message).trim();
    if (assistantLoading || (!targetMessage && !topicId)) return;
    const active = readSession();
    if (!active || active.token !== session.token) {
      setIsOpen(false);
      return;
    }

    setAssistantLoading(true);
    setResolvedByAssistant(false);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/support/assist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: targetMessage,
          ...(topicId ? { topic: topicId } : {}),
          kind,
          context: buildContextPayload(null),
        }),
      });
      if (!response.ok) {
        let detail = 'Não foi possível analisar agora. Você ainda pode enviar sua mensagem diretamente.';
        try {
          const body = await response.json();
          if (typeof body?.detail === 'string' && body.detail.trim()) detail = body.detail;
        } catch {
          // Mantém mensagem segura quando o backend não retornar JSON.
        }
        throw new Error(detail);
      }
      const data = (await response.json()) as SupportAssistResult;
      if (readSession()?.token !== session.token) return;
      setAssistantResult(data);
      if (data.suspected_bug) setKind('problem');
    } catch (assistError) {
      setError(
        assistError instanceof Error
          ? assistError.message
          : 'Não foi possível analisar agora. Você ainda pode enviar sua mensagem diretamente.',
      );
    } finally {
      setAssistantLoading(false);
    }
  };

  const handleSelectQuickTopic = (topic: QuickTopicOption) => {
    const isDeselecting = selectedTopic === topic.id;
    const nextTopic = isDeselecting ? null : topic.id;
    setSelectedTopic(nextTopic);
    setResolvedByAssistant(false);
    if (isDeselecting) {
      setAssistantResult(null);
      return;
    }
    const nextMessage = message.trim() ? message : topic.prompt;
    if (!message.trim()) setMessage(topic.prompt);
    void analyzeWithAssistant(topic.id, nextMessage);
  };

  const submitFeedbackPayload = async ({
    kindOverride,
    messageOverride,
  }: {
    kindOverride?: FeedbackKind;
    messageOverride?: string;
  } = {}) => {
    const effectiveKind = kindOverride ?? kind;
    const trimmedMessage = (messageOverride !== undefined ? messageOverride : message).trim();
    if (trimmedMessage.length < 5 || submittingRef.current) return;
    const active = readSession();
    if (!active || active.token !== session.token) { setIsOpen(false); return; }
    submittingRef.current = true;

    const contextPayload = buildContextPayload(assistantResult);

    setIsSending(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/support/feedback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind: effectiveKind,
          message: trimmedMessage,
          // Não enviamos query string nem hash para evitar vazar tokens em links.
          page_path: window.location.pathname,
          context: contextPayload,
        }),
      });

      if (!response.ok) {
        let detail = 'Não foi possível enviar agora. Tente novamente em instantes.';
        try {
          const body = await response.json();
          if (typeof body?.detail === 'string' && body.detail.trim()) detail = body.detail;
        } catch {
          // Mantém a mensagem segura e curta quando o backend não retornar JSON.
        }
        throw new Error(detail);
      }

      const body = await response.json();
      if (readSession()?.token !== session.token) return;
      setSentId(typeof body?.id === 'string' ? body.id : 'ok');
      setMessage('');
      setAssistantResult(null);
      setSelectedTopic(null);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'Não foi possível enviar agora. Tente novamente em instantes.',
      );
    } finally {
      submittingRef.current = false;
      setIsSending(false);
    }
  };

  const submitFeedback = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitFeedbackPayload();
  };

  const renderIssueList = (items: DiagnosticIssue[]) => (
    <div className="flex flex-col gap-2">
      {items.slice(0, 4).map((issue) => {
        const SeverityIcon = issue.severity === 'error'
          ? AlertCircle
          : issue.severity === 'warning'
            ? AlertTriangle
            : Info;
        return (
          <div
            key={issue.code}
            className="rounded-2xl border p-3 text-left"
            style={{
              borderColor: issue.severity === 'error' ? 'var(--koma-danger-border)' : 'var(--ko-line)',
              background: 'var(--ko-panel)',
              color: 'var(--ko-ink)',
            }}
          >
            <div className="flex items-start gap-2">
              <SeverityIcon className="mt-0.5 h-4 w-4 shrink-0 text-koma-accent" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{issue.title}</div>
                <p className="mt-0.5 text-xs leading-4" style={{ color: 'var(--ko-muted)' }}>
                  {issue.description}
                </p>
                {issue.go_id ? (
                  <button
                    type="button"
                    onClick={() => navigateToDiagnosticTarget(issue.go_id)}
                    className="mt-2 inline-flex min-h-[44px] items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:opacity-90"
                    style={{
                      borderColor: 'var(--ko-line)',
                      background: 'var(--ko-raised)',
                      color: 'var(--ko-ink)',
                    }}
                  >
                    {issue.action_label || 'Ir para configuração'}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="ko-support fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Ajuda e feedback KÔMA" onKeyDown={event => {
      if (event.key === 'Escape') setIsOpen(false);
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, summary')].filter(node => node.getClientRects().length > 0 && node.getAttribute('aria-label') !== 'Fechar ajuda');
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        onClick={closeDrawer}
        aria-label="Fechar ajuda"
      />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-koma-border bg-koma-page shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-koma-border px-5 py-5">
          <div>
            <img className="ko-overlay__art" src="/brand/cashier/support-note-v1.svg" width="56" height="56" alt="" aria-hidden="true" />
            <h2 className="mt-1 text-xl font-bold text-koma-foreground">Ajuda e feedback</h2>
            <p className="mt-1 text-sm text-koma-muted-foreground">
              Fale com a equipe KÔMA.
            </p>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-koma-border p-2 text-koma-muted-foreground transition hover:bg-koma-elevated hover:text-koma-foreground"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {sentId ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="rounded-full border border-koma-accent/30 bg-koma-accent/10 p-4">
              <Send className="h-7 w-7 text-koma-accent" />
            </div>
            <h3 className="mt-5 text-lg font-bold text-koma-foreground">Mensagem recebida</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-koma-muted-foreground">
              Sua mensagem ficou registrada com a equipe KÔMA.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl border border-koma-border px-4 py-2.5 text-sm font-semibold text-koma-foreground transition hover:bg-koma-elevated"
              >
                Enviar outra
              </button>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-xl bg-koma-accent px-4 py-2.5 text-sm font-bold text-koma-accent-foreground transition hover:opacity-90"
              >
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submitFeedback} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-5 py-5">
              {attachedSupportCode ? (
                <div
                  className="mb-4 flex items-center justify-between gap-2 rounded-2xl border px-3.5 py-2.5 text-xs"
                  style={{
                    borderColor: 'var(--ko-line)',
                    background: 'var(--ko-panel)',
                    color: 'var(--ko-ink)',
                  }}
                >
                  <span>
                    Código técnico anexado: <strong>{attachedSupportCode}</strong>
                  </span>
                </div>
              ) : null}

              <section aria-label="Temas rápidos do assistente" className="mb-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-koma-muted-foreground">
                  Escolha um tema ou descreva abaixo
                </p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_TOPICS.map((topic) => {
                    const selected = selectedTopic === topic.id;
                    return (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => handleSelectQuickTopic(topic)}
                        aria-pressed={selected}
                        className={`min-h-[44px] rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                          selected
                            ? 'border-koma-accent bg-koma-accent/10 text-koma-foreground'
                            : 'border-koma-border bg-koma-card text-koma-muted-foreground hover:bg-koma-elevated hover:text-koma-foreground'
                        }`}
                      >
                        {topic.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              {assistantResult ? (
                <section
                  aria-label="Diagnóstico guiado do assistente KÔMA"
                  className="mb-4 rounded-2xl border p-3.5 text-left"
                  style={{
                    borderColor: assistantResult.suspected_bug
                      ? 'var(--koma-danger-border)'
                      : 'var(--ko-line)',
                    background: 'var(--ko-panel)',
                    color: 'var(--ko-ink)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold"
                      style={{
                        borderColor: assistantResult.suspected_bug
                          ? 'var(--koma-danger-border)'
                          : 'var(--ko-line)',
                        background: 'var(--ko-raised)',
                        color: 'var(--ko-ink)',
                      }}
                    >
                      {assistantResult.suspected_bug ? (
                        <Bug className="h-3.5 w-3.5 text-koma-accent" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-koma-accent" />
                      )}
                      {EVIDENCE_BADGES[assistantResult.evidence_status].label}
                    </span>
                  </div>

                  <h3 className="mt-2.5 text-sm font-bold text-koma-foreground">
                    {assistantResult.headline}
                  </h3>
                  <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ko-muted)' }}>
                    {assistantResult.summary}
                  </p>

                  {assistantResult.guided_steps.length ? (
                    <div className="mt-3 flex flex-col gap-2">
                      {assistantResult.guided_steps.map((step, index) => (
                        <div
                          key={`${step.title}-${index}`}
                          className="rounded-xl border p-2.5"
                          style={{
                            borderColor: 'var(--ko-line)',
                            background: 'var(--ko-raised)',
                            color: 'var(--ko-ink)',
                          }}
                        >
                          <div className="text-xs font-semibold">{step.title}</div>
                          <p className="mt-0.5 text-xs leading-4" style={{ color: 'var(--ko-muted)' }}>
                            {step.description}
                          </p>
                          {step.go_id ? (
                            <button
                              type="button"
                              onClick={() => navigateToDiagnosticTarget(step.go_id as string)}
                              className="mt-2 inline-flex min-h-[44px] items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:opacity-90"
                              style={{
                                borderColor: 'var(--ko-line)',
                                background: 'var(--ko-panel)',
                                color: 'var(--ko-ink)',
                              }}
                            >
                              {step.action_label || 'Abrir configuração'}
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {assistantResult.unrelated_observations_count > 0 ? (
                    <p
                      className="mt-3 rounded-xl border px-3 py-2 text-[11px] leading-4"
                      style={{
                        borderColor: 'var(--ko-line)',
                        background: 'var(--ko-raised)',
                        color: 'var(--ko-muted)',
                      }}
                    >
                      Outros {assistantResult.unrelated_observations_count} aviso(s) gerais da loja não explicam este tema e não foram considerados causa deste problema.
                    </p>
                  ) : null}

                  {resolvedByAssistant ? (
                    <div
                      className="mt-3 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs"
                      style={{
                        borderColor: 'var(--ko-line)',
                        background: 'var(--ko-raised)',
                        color: 'var(--ko-ink)',
                      }}
                    >
                      <span>Ótimo — caso o comportamento volte, envie aqui.</span>
                      <button
                        type="button"
                        onClick={closeDrawer}
                        className="min-h-[44px] rounded-lg border px-3 text-xs font-semibold"
                        style={{ borderColor: 'var(--ko-line)' }}
                      >
                        Fechar
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setResolvedByAssistant(true)}
                        className="min-h-[44px] flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition hover:opacity-90"
                        style={{
                          borderColor: 'var(--ko-line)',
                          background: 'var(--ko-raised)',
                          color: 'var(--ko-ink)',
                        }}
                      >
                        Isso resolveu
                      </button>
                      <button
                        type="button"
                        disabled={isSending}
                        onClick={() => {
                          const topicOption = QUICK_TOPICS.find((item) => item.id === selectedTopic);
                          const effectiveMsg = message.trim() || topicOption?.prompt || assistantResult.headline;
                          void submitFeedbackPayload({
                            kindOverride: assistantResult.suspected_bug ? 'problem' : kind,
                            messageOverride: effectiveMsg,
                          });
                        }}
                        className="min-h-[44px] flex-1 rounded-xl bg-koma-accent px-3 py-2 text-xs font-bold text-koma-accent-foreground transition hover:opacity-90 disabled:opacity-40"
                      >
                        {isSending ? 'Encaminhando…' : 'Encaminhar para investigação KÔMA'}
                      </button>
                    </div>
                  )}
                </section>
              ) : null}

              {isManagementRole && (diagnosticsLoading || diagnostics) ? (
                assistantResult && diagnostics ? (
                  <details
                    className="mb-4 rounded-2xl border p-3"
                    style={{
                      borderColor: 'var(--ko-line)',
                      background: 'var(--ko-panel)',
                      color: 'var(--ko-ink)',
                    }}
                  >
                    <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-[0.12em] text-koma-muted-foreground">
                      Observações atuais da loja ({diagnostics.issues.length})
                    </summary>
                    <div className="mt-3">
                      {diagnostics.issues.length ? (
                        renderIssueList(diagnostics.issues)
                      ) : (
                        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--ko-muted)' }}>
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-koma-accent" />
                          <span>Nenhum bloqueio detectado nas configurações principais.</span>
                        </div>
                      )}
                    </div>
                  </details>
                ) : (
                  <section aria-label="Verificações automáticas da loja" className="mb-4">
                    <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-koma-muted-foreground">
                      Verificações automáticas da loja
                    </p>
                    {diagnosticsLoading && !diagnostics ? (
                      <div
                        className="rounded-2xl border px-3.5 py-2.5 text-xs"
                        style={{
                          borderColor: 'var(--ko-line)',
                          background: 'var(--ko-panel)',
                          color: 'var(--ko-muted)',
                        }}
                      >
                        Verificando configurações essenciais...
                      </div>
                    ) : diagnostics?.issues.length ? (
                      renderIssueList(diagnostics.issues)
                    ) : diagnostics ? (
                      <div
                        className="flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-xs"
                        style={{
                          borderColor: 'var(--ko-line)',
                          background: 'var(--ko-panel)',
                          color: 'var(--ko-muted)',
                        }}
                      >
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-koma-accent" />
                        <span>Nenhum bloqueio detectado nas configurações principais.</span>
                      </div>
                    ) : null}
                  </section>
                )
              ) : null}

              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-koma-muted-foreground">
                  Sua mensagem
                </span>
                <textarea
                  ref={messageRef}
                  autoFocus
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value);
                    if (assistantResult) setAssistantResult(null);
                    if (resolvedByAssistant) setResolvedByAssistant(false);
                  }}
                  maxLength={2000}
                  rows={5}
                  className="mt-2 w-full resize-none rounded-2xl border border-koma-border bg-koma-card px-4 py-3 text-[max(16px,1rem)] text-koma-foreground outline-none transition placeholder:text-koma-muted-foreground focus:border-koma-accent focus:ring-2 focus:ring-koma-accent/20"
                  placeholder="Escreva aqui…"
                  required
                />
              </label>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-koma-muted-foreground">
                <span>{message.length}/2000 · Diagnóstico técnico incluído.</span>
                <button
                  type="button"
                  disabled={assistantLoading || (message.trim().length < 3 && !selectedTopic)}
                  onClick={() => void analyzeWithAssistant()}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-koma-border bg-koma-card px-3 py-1.5 text-xs font-semibold text-koma-foreground transition hover:bg-koma-elevated disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Sparkles className="h-3.5 w-3.5 text-koma-accent" />
                  {assistantLoading ? 'Analisando…' : 'Analisar com assistente'}
                </button>
              </div>

              <p className="mb-3 mt-4 text-xs font-bold uppercase tracking-[0.12em] text-koma-muted-foreground">
                Tipo de mensagem
              </p>
              <div className="grid grid-cols-2 gap-2">
                {FEEDBACK_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = option.id === kind;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setKind(option.id)}
                      className={`min-h-[44px] rounded-2xl border px-3 py-2 text-left transition ${
                        selected
                          ? 'border-koma-accent bg-koma-accent/10'
                          : 'border-koma-border bg-koma-card hover:bg-koma-elevated'
                      }`}
                      aria-pressed={selected}
                    >
                      <Icon className={`inline-block h-4 w-4 ${selected ? 'text-koma-accent' : 'text-koma-muted-foreground'}`} />
                      <span className="ml-2 text-sm font-semibold text-koma-foreground">{option.label}</span>
                    </button>
                  );
                })}
              </div>

              {error ? (
                <div className="mt-4 flex gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </div>

            <footer className="border-t border-koma-border bg-koma-card/60 px-5 py-4">
              <button
                type="submit"
                disabled={message.trim().length < 5 || isSending}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-koma-accent px-4 py-3 text-sm font-bold text-koma-accent-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
                {isSending ? 'Enviando…' : `Enviar ${activeOption.label.toLowerCase()}`}
              </button>
              <p className="mt-2 text-center text-[11px] leading-4 text-koma-muted-foreground">
                Não envie senhas ou dados de clientes.
              </p>
            </footer>
          </form>
        )}
      </aside>
    </div>
  );
}
