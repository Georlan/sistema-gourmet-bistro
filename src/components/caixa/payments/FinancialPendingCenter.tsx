import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { formatCurrency } from '../cashierPresentation';
import { authRequestErrorMessage } from '../../../utils/authRequest';
import {
  cancelDirectPixIntent,
  closeCreationFailureIntent,
  confirmDirectPixIntent,
  fetchPendingReview,
  reconcilePendingIntent,
  type FinancialPendingItem,
  type FinancialPendingProvider,
  type FinancialPendingReviewResponse,
  type FinancialPendingSituation,
} from './paymentPendingClient';

export function useFinancialPendingModal() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    openModal: () => setIsOpen(true),
    closeModal: () => setIsOpen(false),
  };
}

interface FinancialPendingCenterProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  open?: boolean;
  onClose?: () => void;
  mode?: 'dialog' | 'embedded';
  initialShiftFilter?: 'all' | 'current_shift' | 'previous_shift';
  initialProviderFilter?: 'all' | FinancialPendingProvider;
  onResolved?: () => void;
}

function formatLocalDateTime(isoValue: string | null): string {
  if (!isoValue) return 'Horário indisponível';
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return 'Horário indisponível';
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function situationTone(situation: FinancialPendingSituation): {
  badgeClass: string;
  icon: typeof Clock;
} {
  switch (situation) {
    case 'awaiting_payment':
      return {
        badgeClass: 'bg-koma-info-bg border-koma-info-border text-koma-info-text',
        icon: Clock,
      };
    case 'creation_failed':
      return {
        badgeClass: 'bg-koma-warning-bg border-koma-warning-border text-koma-warning-text',
        icon: AlertTriangle,
      };
    case 'uncertain':
    case 'provider_query_failed':
      return {
        badgeClass: 'bg-koma-danger-bg border-koma-danger-border text-koma-danger-text',
        icon: ShieldAlert,
      };
    case 'approved':
      return {
        badgeClass: 'bg-koma-success-bg border-koma-success-border text-koma-success-text',
        icon: CheckCircle2,
      };
    case 'closed_after_review':
      return {
        badgeClass: 'bg-koma-raised border-koma-border text-koma-secondary',
        icon: XCircle,
      };
  }
}

export function FinancialPendingCenter({
  apiBaseUrl,
  authHeaders,
  open = true,
  onClose,
  mode = 'dialog',
  initialShiftFilter = 'all',
  initialProviderFilter = 'all',
  onResolved,
}: FinancialPendingCenterProps) {
  const [data, setData] = useState<FinancialPendingReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [shiftFilter, setShiftFilter] = useState<'all' | 'current_shift' | 'previous_shift'>(
    initialShiftFilter,
  );
  const [providerFilter, setProviderFilter] = useState<'all' | FinancialPendingProvider>(
    initialProviderFilter,
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const [closingIntentId, setClosingIntentId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [closeConfirmed, setCloseConfirmed] = useState(false);

  const [directConfirmId, setDirectConfirmId] = useState<string | null>(null);
  const [directBankRef, setDirectBankRef] = useState('');
  const [directChecked, setDirectChecked] = useState(false);

  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});

  const authorization = authHeaders.Authorization || authHeaders.authorization || '';

  const loadQueue = useCallback(
    async (signal?: AbortSignal) => {
      if (mode === 'dialog' && !open) return;
      setLoading(true);
      setError('');
      try {
        const result = await fetchPendingReview(apiBaseUrl, authHeaders, {
          includeResolved: true,
          signal,
        });
        if (!signal?.aborted) setData(result);
      } catch (err) {
        if (!signal?.aborted) {
          setError(
            authRequestErrorMessage(
              err,
              'Não foi possível carregar as pendências financeiras.',
            ),
          );
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [apiBaseUrl, authorization, mode, open],
  );

  useEffect(() => {
    setShiftFilter(initialShiftFilter);
  }, [initialShiftFilter, open]);

  useEffect(() => {
    setProviderFilter(initialProviderFilter);
  }, [initialProviderFilter, open]);

  useEffect(() => {
    if (mode === 'dialog' && !open) return;
    const controller = new AbortController();
    void loadQueue(controller.signal);
    return () => controller.abort();
  }, [loadQueue, mode, open]);

  useEffect(() => {
    if (mode !== 'dialog' || !open || !onClose) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, onClose, open]);

  if (mode === 'dialog' && !open) return null;

  const summary = data?.summary;
  const activeItems = (data?.items ?? []).filter(item => {
    if (providerFilter !== 'all' && item.provider !== providerFilter) return false;
    if (shiftFilter === 'current_shift' && item.shift_scope !== 'current_shift') return false;
    if (shiftFilter === 'previous_shift' && item.shift_scope === 'current_shift') return false;
    return true;
  });
  const historyItems = (data?.history_items ?? []).filter(
    item => providerFilter === 'all' || item.provider === providerFilter,
  );
  const displayedItems = activeTab === 'active' ? activeItems : historyItems;

  function beginCloseFailure(item: FinancialPendingItem) {
    setClosingIntentId(item.id);
    setDirectConfirmId(null);
    setCloseConfirmed(false);
    setCloseReason(
      `Falha comprovada na criação da cobrança (${item.provider_label}) sem recebimento no banco.`,
    );
    setError('');
    setFeedback('');
  }

  async function handleReconcile(item: FinancialPendingItem) {
    if (busyId) return;
    setBusyId(item.id);
    setError('');
    setFeedback('');
    try {
      const res = await reconcilePendingIntent(apiBaseUrl, authHeaders, item.id);
      if (res.approved) {
        setFeedback(`Pedido #${item.order_number ?? item.comanda_id.slice(0, 8)} confirmado pelo banco e liberado para a operação.`);
      } else if (res.queried) {
        setFeedback(`Consulta atualizada para o pedido #${item.order_number ?? item.comanda_id.slice(0, 8)}: situação ${res.item?.situation_label ?? res.status}.`);
      } else {
        setFeedback('Consulta realizada há poucos instantes. Aguarde alguns segundos antes de tentar novamente.');
      }
      await loadQueue();
      onResolved?.();
    } catch (err) {
      setError(authRequestErrorMessage(err, 'Não foi possível consultar a cobrança no banco.'));
      await loadQueue();
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmCloseFailure(item: FinancialPendingItem) {
    if (busyId || !closeConfirmed) return;
    setBusyId(item.id);
    setError('');
    setFeedback('');
    try {
      await closeCreationFailureIntent(apiBaseUrl, authHeaders, item.id, {
        reason: closeReason.trim(),
        confirmed_no_charge: closeConfirmed,
      });
      setClosingIntentId(null);
      setCloseConfirmed(false);
      setCloseReason('');
      setFeedback(
        `Pedido #${item.order_number ?? item.comanda_id.slice(0, 8)} encerrado com auditoria após falha de criação.`,
      );
      await loadQueue();
      onResolved?.();
    } catch (err) {
      setError(authRequestErrorMessage(err, 'Não foi possível encerrar a pendência.'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmDirectPix(item: FinancialPendingItem) {
    if (busyId || !directChecked) return;
    setBusyId(item.id);
    setError('');
    setFeedback('');
    try {
      await confirmDirectPixIntent(apiBaseUrl, authHeaders, item.id, {
        checked_bank_statement: directChecked,
        received_amount: item.amount,
        bank_reference: directBankRef.trim() || undefined,
      });
      setDirectConfirmId(null);
      setDirectBankRef('');
      setDirectChecked(false);
      setFeedback(`Recebimento Pix do pedido #${item.order_number ?? item.comanda_id.slice(0, 8)} confirmado.`);
      await loadQueue();
      onResolved?.();
    } catch (err) {
      setError(authRequestErrorMessage(err, 'Não foi possível confirmar o recebimento manual.'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancelDirectPix(item: FinancialPendingItem) {
    if (busyId) return;
    setBusyId(item.id);
    setError('');
    setFeedback('');
    try {
      await cancelDirectPixIntent(apiBaseUrl, authHeaders, item.id);
      setFeedback(`Tentativa Pix do pedido #${item.order_number ?? item.comanda_id.slice(0, 8)} cancelada após revisão.`);
      await loadQueue();
      onResolved?.();
    } catch (err) {
      setError(authRequestErrorMessage(err, 'Não foi possível cancelar a tentativa de Pix.'));
    } finally {
      setBusyId(null);
    }
  }

  const content = (
    <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-koma-border bg-koma-dialog text-koma-foreground shadow-2xl">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-koma-border bg-koma-panel px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 shrink-0 text-koma-accent" aria-hidden="true" />
            <h2
              id="financial-pending-center-title"
              className="text-lg font-bold text-koma-foreground"
            >
              Central de pendências financeiras
            </h2>
          </div>
          <p className="mt-1 text-sm text-koma-muted">
            Pedidos com cobrança Pix pendente ou que falharam antes de entrar na cozinha. Valores em revisão não entram como dinheiro recebido.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadQueue()}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 text-sm font-semibold text-koma-foreground hover:bg-koma-raised disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Atualizar
          </button>
          {mode === 'dialog' && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar central de pendências financeiras"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-koma-border bg-koma-card text-koma-foreground hover:bg-koma-raised"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
        {summary && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-koma-border bg-koma-card p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-koma-muted">
                Total em revisão
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums text-koma-foreground">
                {formatCurrency(Number(summary.blocking_total_amount))}
              </p>
              <p className="mt-1 text-xs text-koma-muted">
                Tentativas em análise — não somam nas vendas recebidas
              </p>
            </div>

            <div className="rounded-xl border border-koma-border bg-koma-card p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-koma-muted">
                Cobranças para revisar
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums text-koma-foreground">
                {summary.blocking_count}
              </p>
              <p className="mt-1 text-xs text-koma-muted">
                {summary.current_shift_blocking_count} no turno atual · {summary.previous_shift_blocking_count} em turnos anteriores
              </p>
            </div>

            <div className="rounded-xl border border-koma-border bg-koma-card p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-koma-muted">
                Troca / desconexão do Pix
              </p>
              <div className="mt-1 flex items-center gap-2">
                {summary.can_switch_receiver ? (
                  <>
                    <ShieldCheck className="h-5 w-5 shrink-0 text-koma-success-text" aria-hidden="true" />
                    <span className="text-sm font-bold text-koma-success-text">
                      Liberada
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-5 w-5 shrink-0 text-koma-warning-text" aria-hidden="true" />
                    <span className="text-sm font-bold text-koma-warning-text">
                      Bloqueada até resolver
                    </span>
                  </>
                )}
              </div>
              <p className="mt-1 text-xs text-koma-muted">
                {summary.can_switch_receiver
                  ? 'Nenhuma pendência impede desconectar ou trocar o método.'
                  : `${summary.by_situation.creation_failed} falha(s) na criação · ${summary.by_situation.awaiting_payment} aguardando · ${summary.by_situation.uncertain + summary.by_situation.provider_query_failed} incerta(s)/erro`}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Visão da central financeira">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'active'}
              onClick={() => setActiveTab('active')}
              className={`min-h-11 rounded-xl border px-3.5 text-sm font-semibold transition-colors ${
                activeTab === 'active'
                  ? 'border-koma-accent bg-koma-raised text-koma-foreground'
                  : 'border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground'
              }`}
            >
              Pendências ativas ({data?.summary.blocking_count ?? 0})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'history'}
              onClick={() => setActiveTab('history')}
              className={`min-h-11 rounded-xl border px-3.5 text-sm font-semibold transition-colors ${
                activeTab === 'history'
                  ? 'border-koma-accent bg-koma-raised text-koma-foreground'
                  : 'border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground'
              }`}
            >
              Histórico revisado ({historyItems.length})
            </button>
          </div>

          {activeTab === 'active' && (
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['all', 'Todos os turnos'],
                  ['current_shift', 'Turno atual'],
                  ['previous_shift', 'Turnos anteriores'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setShiftFilter(value)}
                  className={`min-h-11 rounded-xl border px-3 text-xs font-semibold ${
                    shiftFilter === value
                      ? 'border-koma-accent bg-koma-raised text-koma-foreground'
                      : 'border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-koma-danger-border bg-koma-danger-bg px-4 py-3 text-sm text-koma-danger-text"
          >
            {error}
          </div>
        )}
        {feedback && (
          <div
            role="status"
            className="rounded-xl border border-koma-success-border bg-koma-success-bg px-4 py-3 text-sm text-koma-success-text"
          >
            {feedback}
          </div>
        )}

        {loading && !data && (
          <p role="status" className="py-8 text-center text-sm text-koma-muted">
            Carregando pendências financeiras…
          </p>
        )}

        {!loading && displayedItems.length === 0 && (
          <div className="rounded-xl border border-koma-border bg-koma-card p-6 text-center">
            <p className="text-sm font-semibold text-koma-foreground">
              {activeTab === 'active'
                ? 'Nenhuma pendência financeira encontrada neste filtro.'
                : 'Nenhum registro revisado recentemente.'}
            </p>
            <p className="mt-1 text-xs text-koma-muted">
              {activeTab === 'active'
                ? 'Quando houver cobranças Pix em aberto, falhas de criação ou divergências de consulta, elas aparecerão aqui com ações seguras.'
                : 'Encerramentos auditados e aprovações recentes ficam registrados aqui para conferência.'}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {displayedItems.map(item => {
            const tone = situationTone(item.situation);
            const StatusIcon = tone.icon;
            const orderLabel =
              item.order_number !== null ? `Pedido #${item.order_number}` : `Pedido ${item.comanda_id.slice(0, 8)}`;
            const isClosing = closingIntentId === item.id;
            const isDirectConfirm = directConfirmId === item.id;
            const isHistoryOpen = Boolean(expandedHistory[item.id]);

            return (
              <article
                key={item.id}
                data-testid={`pending-review-item-${item.order_number ?? item.id}`}
                className="rounded-xl border border-koma-border bg-koma-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-koma-foreground">{orderLabel}</span>
                      <span className="text-base font-bold tabular-nums text-koma-foreground">
                        {formatCurrency(Number(item.amount))}
                      </span>
                      <span className="rounded-lg border border-koma-border bg-koma-panel px-2 py-0.5 text-xs font-medium text-koma-secondary">
                        {item.provider_label}
                      </span>
                      <span className="rounded-lg border border-koma-border bg-koma-panel px-2 py-0.5 text-xs font-medium text-koma-muted">
                        {item.shift_scope === 'current_shift'
                          ? 'Turno atual'
                          : item.shift_scope === 'previous_shift'
                            ? 'Turno anterior'
                            : 'Sem turno aberto'}
                      </span>
                    </div>
                    <p className="text-xs text-koma-muted">
                      {formatLocalDateTime(item.created_at_local || item.created_at)}
                      {item.comanda_open ? ' · Comanda aberta fora da cozinha' : ' · Comanda encerrada'}
                    </p>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-semibold ${tone.badgeClass}`}
                  >
                    <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {item.situation_label}
                  </span>
                </div>

                <div className="mt-3 space-y-1">
                  <p className="text-sm font-semibold text-koma-foreground">{item.reason_title}</p>
                  <p className="text-sm text-koma-secondary">{item.reason_detail}</p>
                  {(item.provider_code || item.provider_request_id || item.external_payment_id_ref) && (
                    <p className="pt-1 font-mono text-xs text-koma-muted">
                      {item.http_status ? `HTTP ${item.http_status}` : null}
                      {item.provider_code ? ` · Código ${item.provider_code}` : null}
                      {item.provider_request_id ? ` · Ref. ${item.provider_request_id}` : null}
                      {item.external_payment_id_ref ? ` · Cobrança ${item.external_payment_id_ref}` : null}
                    </p>
                  )}
                </div>

                {item.requires_manual_escalation && item.escalation_guidance && (
                  <div className="mt-3 rounded-xl border border-koma-danger-border bg-koma-danger-bg px-3.5 py-2.5 text-xs text-koma-danger-text">
                    <p className="font-semibold">Conferência manual obrigatória no banco</p>
                    <p className="mt-0.5">{item.escalation_guidance}</p>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {item.can_reconcile && (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void handleReconcile(item)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3.5 text-sm font-semibold text-koma-foreground hover:border-koma-border-strong disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${busyId === item.id ? 'animate-spin' : ''}`} aria-hidden="true" />
                      Consultar no banco
                    </button>
                  )}

                  {item.can_close_creation_failure && !isClosing && (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => beginCloseFailure(item)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-koma-warning-border bg-koma-warning-bg px-3.5 text-sm font-semibold text-koma-warning-text disabled:opacity-50"
                    >
                      Encerrar falha de criação
                    </button>
                  )}

                  {item.can_direct_pix_confirm && !isDirectConfirm && (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => {
                        setDirectConfirmId(item.id);
                        setClosingIntentId(null);
                        setDirectChecked(false);
                        setDirectBankRef('');
                      }}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-3.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Confirmar recebimento no extrato
                    </button>
                  )}

                  {item.can_direct_pix_cancel && !isDirectConfirm && (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void handleCancelDirectPix(item)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-koma-border bg-koma-panel px-3.5 text-sm font-semibold text-koma-foreground disabled:opacity-50"
                    >
                      Cancelar tentativa sem recebimento
                    </button>
                  )}

                  {item.review_history.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedHistory(current => ({ ...current, [item.id]: !current[item.id] }))
                      }
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-koma-border px-3 text-xs font-semibold text-koma-muted hover:text-koma-foreground"
                    >
                      <History className="h-4 w-4" aria-hidden="true" />
                      Histórico ({item.review_history.length})
                      {isHistoryOpen ? (
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>

                {isClosing && (
                  <div className="mt-3 space-y-3 rounded-xl border border-koma-warning-border bg-koma-panel p-3.5">
                    <p className="text-xs font-semibold text-koma-foreground">
                      Evidência verificada: {item.evidence_summary}
                    </p>
                    <label className="block text-xs font-semibold text-koma-foreground">
                      Motivo do encerramento auditado
                      <input
                        type="text"
                        maxLength={500}
                        value={closeReason}
                        onChange={e => setCloseReason(e.target.value)}
                        className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground"
                      />
                    </label>
                    <label className="flex min-h-11 items-start gap-2.5 text-sm text-koma-foreground">
                      <input
                        type="checkbox"
                        checked={closeConfirmed}
                        onChange={e => setCloseConfirmed(e.target.checked)}
                        className="mt-1"
                      />
                      Confirmo que esta tentativa falhou na criação e não houve recebimento no banco.
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={
                          busyId === item.id || !closeConfirmed || closeReason.trim().length < 5
                        }
                        onClick={() => void handleConfirmCloseFailure(item)}
                        className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {busyId === item.id ? 'Encerrando…' : 'Confirmar encerramento'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => {
                          setClosingIntentId(null);
                          setCloseConfirmed(false);
                        }}
                        className="min-h-11 rounded-xl border border-koma-border px-4 text-sm font-semibold text-koma-foreground"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {isDirectConfirm && (
                  <div className="mt-3 space-y-3 rounded-xl border border-koma-success-border bg-koma-panel p-3.5">
                    <label className="block text-xs font-semibold text-koma-foreground">
                      Identificador no extrato bancário (opcional)
                      <input
                        type="text"
                        maxLength={80}
                        value={directBankRef}
                        onChange={e => setDirectBankRef(e.target.value)}
                        placeholder="Ex: E2E123456"
                        className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground"
                      />
                    </label>
                    <label className="flex min-h-11 items-start gap-2.5 text-sm text-koma-foreground">
                      <input
                        type="checkbox"
                        checked={directChecked}
                        onChange={e => setDirectChecked(e.target.checked)}
                        className="mt-1"
                      />
                      Conferi no extrato que o valor integral de {formatCurrency(Number(item.amount))} foi recebido.
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyId === item.id || !directChecked}
                        onClick={() => void handleConfirmDirectPix(item)}
                        className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {busyId === item.id ? 'Confirmando…' : 'Aprovar recebimento'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => setDirectConfirmId(null)}
                        className="min-h-11 rounded-xl border border-koma-border px-4 text-sm font-semibold text-koma-foreground"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {isHistoryOpen && item.review_history.length > 0 && (
                  <div className="mt-3 space-y-2 rounded-xl border border-koma-border bg-koma-panel p-3">
                    {item.review_history.map(entry => (
                      <div
                        key={entry.id}
                        className="border-b border-koma-border-subtle pb-2 text-xs last:border-b-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-koma-foreground">
                          <span>{entry.actor_name}</span>
                          <span className="text-koma-muted">
                            {formatLocalDateTime(entry.created_at_local || entry.created_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-koma-secondary">{entry.reason}</p>
                        {(entry.status_before || entry.status_after) && (
                          <p className="mt-0.5 text-koma-muted">
                            Estado: {entry.status_before ?? '—'} → {entry.status_after ?? '—'}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (mode === 'embedded') {
    return content;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="financial-pending-center-title"
        className="w-full max-w-4xl"
      >
        {content}
      </div>
    </div>
  );
}
