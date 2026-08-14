import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  History,
  Power,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Usb,
  WifiOff,
  Wrench
} from 'lucide-react';
import { OperationalBanner } from '../shared/OperationalBanner';
import { parseBackendTimestamp } from '../../utils/dateTime';

interface DetectedPrinter {
  name: string;
  connection: 'usb' | 'network' | 'unknown';
  uri: string | null;
  is_default: boolean;
  available: boolean;
  present?: boolean;
  configured?: boolean;
}

interface AgentCommand {
  id: string;
  action: 'connect_usb';
  printer_name: string | null;
  printer_uri: string | null;
  requested_at: string;
}

interface AgentCommandResult {
  id: string;
  success: boolean;
  code: string;
  message: string;
  printer_name: string | null;
  completed_at: string;
}

interface PrintAgentHealth {
  agent_id: string;
  online: boolean;
  last_seen_at: string | null;
  seconds_since_heartbeat: number | null;
  diagnostics_fresh?: boolean;
  diagnostics_age_seconds?: number | null;
  physical_printer_present?: boolean;
  printer_ready?: boolean;
  ready_printer_count?: number;
  supports_usb_commands?: boolean;
  printer_diagnostics: {
    adapter: string;
    platform: string;
    printers: DetectedPrinter[];
    default_printer: string | null;
    error: string | null;
  } | null;
  diagnostics_updated_at: string | null;
  pending_command: AgentCommand | null;
  command_requested_at: string | null;
  last_command_result: AgentCommandResult | null;
  command_completed_at: string | null;
}

interface PrintJobHistory {
  id: string;
  document_type: string;
  destination: string;
  source_type: string;
  source_id: string;
  reference: string;
  order_number: string | null;
  table_number: string | null;
  status: string;
  display_status: string;
  accepted_by_spooler: boolean;
  physical_confirmation: 'not_available' | null;
  attempts: number;
  agent_id: string | null;
  printer_name: string | null;
  last_error: string | null;
  created_at: string | null;
  printed_at: string | null;
  age_seconds: number | null;
  delayed: boolean;
  is_reprint: boolean;
  can_reprint: boolean;
}

interface PrintMonitorResponse {
  generated_at: string;
  history_date: string;
  history_limit: number;
  queue_limit: number;
  history_timezone: string;
  online_threshold_seconds: number;
  command_timeout_seconds?: number;
  delay_threshold_seconds: number;
  max_unresolved_age_seconds?: number;
  expired_jobs?: number;
  physical_completion_tracking: boolean;
  agents: PrintAgentHealth[];
  summary: {
    online_agents: number;
    active_agents: number;
    pending: number;
    claimed: number;
    printing: number;
    failed: number;
    delayed: number;
    ready_printers?: number;
    printer_ready?: boolean;
    oldest_unresolved_seconds: number | null;
  };
  jobs: PrintJobHistory[];
  history_jobs: PrintJobHistory[];
  queue_jobs: PrintJobHistory[];
  latest_spooler_success: {
    job_id: string;
    reference: string;
    printer_name: string | null;
    printed_at: string | null;
    age_seconds: number | null;
  } | null;
}

interface PrintMonitorPanelProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onTestPrint?: () => void | Promise<void>;
  testInProgress?: boolean;
}

type DiagnosticTone = 'success' | 'warning' | 'danger' | 'neutral';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Na fila',
  claimed: 'Reservado',
  printing: 'Enviando',
  spooler_accepted: 'Enviado ao sistema',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  expired: 'Expirado'
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'koma-badge-info',
  claimed: 'koma-badge-warning',
  printing: 'koma-badge-warning',
  spooler_accepted: 'koma-badge-success',
  failed: 'koma-badge-danger',
  cancelled: 'border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300',
  expired: 'koma-badge-warning'
};

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

function formatAge(seconds: number | null): string {
  if (seconds === null) return 'sem contato';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = parseBackendTimestamp(value);
  return date ? dateTimeFormatter.format(date) : '—';
}

function friendlyDocumentType(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function friendlyPrinterName(value: string | null): string {
  if (!value) return 'Não identificada';
  const normalized = value.trim().toLocaleLowerCase('pt-BR');
  if (['padrão', 'padrao', 'default', 'auto', 'automática', 'automatica'].includes(normalized)) {
    return 'Impressora USB principal';
  }
  return value;
}

function friendlyUsbConnectionError(status: number, detail?: string): string {
  if (detail) return detail;
  if (status === 409) {
    return (
      'Não foi possível preparar a conexão USB. Tente novamente; '
      + 'se continuar, contate o suporte.'
    );
  }
  return (
    'Não foi possível procurar a impressora USB. Verifique a conexão '
    + 'e tente novamente.'
  );
}

export function PrintMonitorPanel({
  apiBaseUrl,
  authHeaders,
  onTestPrint,
  testInProgress = false
}: PrintMonitorPanelProps) {
  const [monitorData, setMonitorData] = useState<PrintMonitorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionSuccessful, setActionSuccessful] = useState<boolean | null>(null);
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);
  const [startingAgent, setStartingAgent] = useState(false);
  const [reprintingId, setReprintingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showQueue, setShowQueue] = useState(true);

  const authorization = authHeaders.Authorization || authHeaders.authorization || '';

  const loadMonitor = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/print-agents/monitor?limit=20`,
        { headers: authHeaders }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error('Não foi possível consultar a impressão.');
      }
      setMonitorData(data as PrintMonitorResponse);
      setError('');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível consultar a impressão.'
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, authorization]);

  useEffect(() => {
    void loadMonitor(true);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadMonitor(false);
      }
    }, 10_000);
    const refreshFromPrintTest = () => void loadMonitor(false);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadMonitor(false);
    };
    window.addEventListener('koma_print_monitor_refresh', refreshFromPrintTest);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('koma_print_monitor_refresh', refreshFromPrintTest);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadMonitor]);

  const activePendingCommand = monitorData?.agents
    .map(agent => ({
      command: agent.pending_command,
      requestedAt: agent.command_requested_at
    }))
    .find(item => item.command) || null;
  const pendingCommandAgeMs = activePendingCommand?.requestedAt
    ? (
        (parseBackendTimestamp(monitorData?.generated_at || Date.now())?.getTime() ?? Date.now())
        - (parseBackendTimestamp(activePendingCommand.requestedAt)?.getTime() ?? Date.now())
      )
    : 0;
  const usbSearchUiTimeoutMs = (
    (monitorData?.command_timeout_seconds || 45) + 5
  ) * 1_000;
  const hasPendingCommand = Boolean(activePendingCommand?.command);
  const commandRunning = Boolean(
    hasPendingCommand
    && pendingCommandAgeMs <= usbSearchUiTimeoutMs
  );

  useEffect(() => {
    if (!hasPendingCommand && !pendingCommandId) return;
    const intervalId = window.setInterval(() => {
      void loadMonitor(false);
    }, 1_500);
    return () => window.clearInterval(intervalId);
  }, [hasPendingCommand, loadMonitor, pendingCommandId]);

  useEffect(() => {
    const activeId = activePendingCommand?.command?.id || null;
    if (!pendingCommandId && activeId) {
      setPendingCommandId(activeId);
    }
  }, [activePendingCommand, pendingCommandId]);

  useEffect(() => {
    if (!monitorData) return;
    const completedResults = monitorData.agents
      .map(agent => agent.last_command_result)
      .filter((result): result is AgentCommandResult => Boolean(result))
      .sort((left, right) => (
        (parseBackendTimestamp(right.completed_at)?.getTime() ?? 0)
        - (parseBackendTimestamp(left.completed_at)?.getTime() ?? 0)
      ));
    const latestResult = completedResults[0];
    const latestResultIsRecent = Boolean(
      latestResult
      && (
        (parseBackendTimestamp(monitorData.generated_at)?.getTime() ?? 0)
        - (parseBackendTimestamp(latestResult.completed_at)?.getTime() ?? 0)
      ) <= 120_000
    );
    const completed = pendingCommandId
      ? completedResults.find(result => result.id === pendingCommandId)
      : latestResultIsRecent
        ? latestResult
        : null;
    if (!completed) return;
    setActionMessage(completed.message);
    setActionSuccessful(completed.success);
    setPendingCommandId(null);
  }, [monitorData, pendingCommandId]);

  useEffect(() => {
    if (!hasPendingCommand || commandRunning) return;
    setActionMessage(
      'A busca USB não respondeu dentro do prazo e foi encerrada.'
    );
    setActionSuccessful(false);
    setPendingCommandId(null);
  }, [commandRunning, hasPendingCommand]);

  const queueTotal = useMemo(() => {
    if (!monitorData) return 0;
    return (
      monitorData.summary.pending
      + monitorData.summary.claimed
      + monitorData.summary.printing
    );
  }, [monitorData]);

  const agentHasFreshDiagnostics = useCallback((agent: PrintAgentHealth) => {
    if (!agent.online) return false;
    if (typeof agent.diagnostics_fresh === 'boolean') {
      return agent.diagnostics_fresh;
    }
    if (!agent.diagnostics_updated_at) return false;
    const updatedAt = parseBackendTimestamp(agent.diagnostics_updated_at)?.getTime() ?? Number.NaN;
    const generatedAt = monitorData?.generated_at
      ? (parseBackendTimestamp(monitorData.generated_at)?.getTime() ?? Number.NaN)
      : Date.now();
    return (
      Number.isFinite(updatedAt)
      && Number.isFinite(generatedAt)
      && generatedAt - updatedAt
        <= (monitorData?.online_threshold_seconds || 90) * 1000
    );
  }, [monitorData]);

  const usbPrinters = useMemo(() => (
    monitorData?.agents
      .filter(agent => agentHasFreshDiagnostics(agent))
      .flatMap((agent, agentIndex) => (
        (agent.printer_diagnostics?.printers || [])
          .filter(printer => printer.connection === 'usb')
          .map(printer => ({
            ...printer,
            agentIndex,
            agentId: agent.agent_id
          }))
      )) || []
  ), [agentHasFreshDiagnostics, monitorData]);

  const readyUsbPrinters = usbPrinters.filter(
    printer => (
      printer.available
      && printer.present === true
      && printer.configured === true
    )
  );
  const presentUsbPrinters = usbPrinters.filter(
    printer => printer.present === true
  );
  const onlineAgents = monitorData?.agents.filter(agent => agent.online) || [];
  const controlAgent = (
    onlineAgents.find(
      agent => agent.printer_ready && agent.supports_usb_commands
    )
    || onlineAgents.find(agent => agent.supports_usb_commands)
    || onlineAgents[0]
    || null
  );
  const hasOnlineAgent = onlineAgents.length > 0;
  const hasUsbCommandAgent = onlineAgents.some(
    agent => agent.supports_usb_commands
  );
  const hasReadyPrinter = readyUsbPrinters.length > 0;
  const hasFreshPrinterDiagnostics = Boolean(
    monitorData?.agents.some(agent => agentHasFreshDiagnostics(agent))
  );
  const latestJob = monitorData?.queue_jobs?.[0] || monitorData?.jobs[0] || null;

  const requestUsbConnection = async (
    agentId?: string,
    printer?: DetectedPrinter
  ) => {
    if (pendingCommandId || commandRunning) return;
    setActionMessage('');
    setActionSuccessful(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/print-agents/actions/connect-usb`,
        {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agent_id: agentId || controlAgent?.agent_id || null,
            printer_name: printer?.name || null,
            printer_uri: printer?.uri || null
          })
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          friendlyUsbConnectionError(response.status, data?.detail)
        );
      }
      setError('');
      setPendingCommandId(data?.command?.id || null);
      setActionMessage('Procurando a impressora no USB…');
      await loadMonitor(false);
    } catch (requestError) {
      setActionSuccessful(false);
      setActionMessage(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível procurar a impressora USB.'
      );
      setError('');
    }
  };

  const startLocalAgent = () => {
    setStartingAgent(true);
    setActionMessage('Preparando a impressão neste computador…');
    setActionSuccessful(null);
    const launcher = document.createElement('a');
    launcher.href = 'koma-print://start';
    launcher.click();
    window.setTimeout(() => {
      setStartingAgent(false);
      void loadMonitor(false);
    }, 3_000);
  };

  const requestReprint = async (job: PrintJobHistory) => {
    const confirmed = window.confirm(
      `Reimprimir ${job.reference || friendlyDocumentType(job.document_type)} de ${formatDate(job.created_at)}?`
    );
    if (!confirmed) return;

    setReprintingId(job.id);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/print-agents/jobs/${job.id}/reprint`,
        {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || 'Não foi possível solicitar a reimpressão.');
      }
      setError('');
      await loadMonitor(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível solicitar a reimpressão.'
      );
    } finally {
      setReprintingId(null);
    }
  };
  const failedJobs = useMemo(() => {
    return monitorData?.queue_jobs?.filter(
      job => job.status === 'failed' && job.can_reprint
    ) || [];
  }, [monitorData]);

  const handleRetryFailedJobs = async () => {
    if (failedJobs.length === 0) return;
    if (!window.confirm(
      `Recuperar ${failedJobs.length} impressão(ões) com falha?`
    )) return;
    setReprintingId('batch');
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/print-agents/jobs/retry-batch`,
        {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({job_ids: failedJobs.map(job => job.id)})
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || 'Não foi possível recuperar a fila.');
      }
      setActionSuccessful(true);
      setActionMessage(
        `${data?.retried_job_ids?.length || 0} impressão(ões) voltaram para a fila.`
      );
      await loadMonitor(false);
    } catch (requestError) {
      setActionSuccessful(false);
      setActionMessage(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível recuperar a fila.'
      );
    } finally {
      setReprintingId(null);
    }
  };

  const diagnostic = useMemo<{
    tone: DiagnosticTone;
    title: string;
    detail: string;
  }>(() => {
    if (!monitorData) {
      return {
        tone: 'neutral',
        title: 'Verificando a conexão…',
        detail: 'Aguarde a leitura do computador e da porta USB.'
      };
    }
    if (!hasOnlineAgent) {
      return {
        tone: 'danger',
        title: 'Impressão indisponível neste computador',
        detail: 'Clique em “Preparar impressão” e tente conectar novamente.'
      };
    }
    if (commandRunning || pendingCommandId) {
      return {
        tone: 'neutral',
        title: 'Conectando a impressora USB',
        detail: 'O computador está procurando o equipamento e preparando a fila de impressão.'
      };
    }
    if (!hasFreshPrinterDiagnostics) {
      return {
        tone: 'warning',
        title: 'Verificando a porta USB',
        detail: 'Use o botão abaixo para procurar a impressora conectada.'
      };
    }
    if (!hasReadyPrinter && presentUsbPrinters.length > 0) {
      return {
        tone: 'warning',
        title: 'USB detectado; falta concluir a conexão',
        detail: 'O Kôma pode configurar e ativar essa impressora automaticamente.'
      };
    }
    if (!hasReadyPrinter) {
      return {
        tone: 'danger',
        title: 'Nenhuma impressora física no USB',
        detail: 'Conecte o cabo e clique em “Procurar e conectar USB”.'
      };
    }
    if (monitorData.summary.delayed > 0) {
      return {
        tone: 'warning',
        title: 'Há impressões aguardando',
        detail: `${monitorData.summary.delayed} trabalho(s) estão na fila há mais de 2 minutos.`
      };
    }
    if (latestJob?.status === 'failed') {
      return {
        tone: 'danger',
        title: 'O último envio falhou',
        detail: latestJob.last_error || 'Reconecte o USB e envie um teste.'
      };
    }
    if (queueTotal > 0) {
      return {
        tone: 'neutral',
        title: 'Impressão em andamento',
        detail: `${queueTotal} trabalho(s) sendo processado(s).`
      };
    }
    if (!hasUsbCommandAgent) {
      return {
        tone: 'success',
        title: 'Impressora USB pronta',
        detail: (
          `${friendlyPrinterName(readyUsbPrinters[0]?.name || null)} está disponível. `
          + 'Atualize o Kôma Print quando quiser habilitar a reconexão remota.'
        )
      };
    }
    return {
      tone: 'success',
      title: 'Impressora USB pronta',
      detail: `${friendlyPrinterName(readyUsbPrinters[0]?.name || null)} está conectada e disponível.`
    };
  }, [
    commandRunning,
    hasFreshPrinterDiagnostics,
    hasOnlineAgent,
    hasUsbCommandAgent,
    hasReadyPrinter,
    latestJob,
    monitorData,
    pendingCommandId,
    presentUsbPrinters.length,
    queueTotal,
    readyUsbPrinters
  ]);

  const diagnosticStyle: Record<DiagnosticTone, string> = {
    success: 'border-emerald-500/30 bg-emerald-500/10',
    warning: 'border-amber-500/30 bg-amber-500/10',
    danger: 'border-red-500/30 bg-red-500/10',
    neutral: 'border-sky-500/30 bg-sky-500/10'
  };
  const diagnosticIconStyle: Record<DiagnosticTone, string> = {
    success: 'bg-emerald-400/15 text-emerald-600 dark:text-emerald-300',
    warning: 'bg-amber-400/15 text-amber-600 dark:text-amber-300',
    danger: 'bg-red-400/15 text-red-300',
    neutral: 'bg-sky-400/15 text-sky-600 dark:text-sky-300'
  };

  const equipmentState = hasReadyPrinter
    ? 'Pronta'
    : presentUsbPrinters.length
      ? 'Detectada'
      : 'Ausente';
  const oldestQueueValue = queueTotal > 0
    ? formatAge(monitorData?.summary.oldest_unresolved_seconds ?? null)
    : 'Livre';
  const latestSentValue = monitorData?.latest_spooler_success
    ? `há ${formatAge(monitorData.latest_spooler_success.age_seconds)}`
    : 'Nenhum hoje';

  return (
    <div className="space-y-4">
      <OperationalBanner
        id="printing-operation-title"
        eyebrow="SALÃO / IMPRESSÃO"
        title="Impressão"
        accent={hasReadyPrinter ? 'pronta para operar' : 'sem surpresa na fila'}
        description="Conexão física, trabalhos pendentes e último envio em uma leitura rápida."
        metrics={[
          {
            label: 'equipamento USB',
            value: equipmentState,
            valueClassName: hasReadyPrinter ? 'text-emerald-700 dark:text-emerald-400 font-bold' : 'text-amber-800 dark:text-amber-300 font-bold'
          },
          {
            label: queueTotal > 0 ? 'espera mais antiga' : 'fila de impressão',
            value: oldestQueueValue,
            valueClassName: monitorData?.summary.delayed ? 'text-amber-800 dark:text-amber-300 font-bold' : undefined
          },
          { label: 'último envio', value: latestSentValue },
          {
            label: 'falhas hoje',
            value: monitorData?.summary.failed ?? 0,
            valueClassName: monitorData?.summary.failed ? 'text-rose-700 dark:text-rose-300 font-bold' : undefined
          }
        ]}
      />

      <section className="space-y-4 text-left" aria-label="Monitor de impressão USB e fila">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Printer size={16} className="text-emerald-700 dark:text-emerald-400" />
              <h4 className="font-serif text-sm font-bold text-koma-foreground">Conexão da impressora USB</h4>
            </div>
          <p className="mt-1 text-[10px] text-koma-muted">
            Controle o equipamento físico sem abrir aplicativos ou configurações do computador.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMonitor(true)}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-koma-border bg-koma-card px-4 py-2 text-[10px] font-bold text-koma-foreground transition hover:border-emerald-500 hover:bg-koma-raised disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-xs"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Atualizar status
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl koma-badge-danger px-4 py-3 text-xs">
          {error}
        </div>
      )}

      <div className={`rounded-2xl border p-4 sm:p-5 ${diagnosticStyle[diagnostic.tone]}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${diagnosticIconStyle[diagnostic.tone]}`}>
              {diagnostic.tone === 'success'
                ? <CheckCircle2 size={20} />
                : diagnostic.tone === 'danger'
                  ? <WifiOff size={20} />
                  : diagnostic.tone === 'warning'
                    ? <AlertTriangle size={20} />
                    : <RefreshCw size={20} className={commandRunning ? 'animate-spin' : ''} />}
            </div>
            <div className="min-w-0">
              <strong className="block text-sm font-bold text-koma-foreground">{diagnostic.title}</strong>
              <span className="mt-1 block text-[10px] leading-relaxed text-koma-foreground/80 font-medium">
                {diagnostic.detail}
              </span>
              {actionMessage && (
                <span className={`mt-2 block text-[10px] font-bold ${
                  actionSuccessful === false
                    ? 'text-rose-700 dark:text-rose-300'
                    : actionSuccessful === true
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-sky-700 dark:text-sky-300'
                }`}>
                  {actionMessage}
                </span>
              )}
              {failedJobs.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleRetryFailedJobs()}
                  disabled={Boolean(reprintingId)}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl koma-btn-danger px-3.5 py-2 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                  id="btn-retry-failed-print-jobs"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>Recuperar {failedJobs.length} impressão(ões) com falha</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:w-auto">
            {!hasOnlineAgent ? (
              <button
                type="button"
                onClick={startLocalAgent}
                disabled={startingAgent}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl koma-btn-success px-5 py-2.5 text-xs font-extrabold transition disabled:cursor-wait disabled:opacity-60 cursor-pointer shadow-xs"
              >
                {startingAgent
                  ? <RefreshCw size={16} className="animate-spin" />
                  : <Power size={16} />}
                {startingAgent ? 'Preparando…' : 'Preparar impressão'}
              </button>
            ) : hasReadyPrinter && !hasUsbCommandAgent ? null : (
              <button
                type="button"
                onClick={() => void requestUsbConnection()}
                disabled={commandRunning || Boolean(pendingCommandId)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl koma-btn-success px-5 py-2.5 text-xs font-extrabold transition disabled:cursor-wait disabled:opacity-60 cursor-pointer shadow-xs"
              >
                {commandRunning || pendingCommandId
                  ? <RefreshCw size={16} className="animate-spin" />
                  : hasReadyPrinter
                    ? <Wrench size={16} />
                    : <Search size={16} />}
                {commandRunning || pendingCommandId
                  ? 'Conectando…'
                  : hasReadyPrinter
                    ? 'Reconectar USB'
                    : 'Procurar e conectar USB'}
              </button>
            )}

            {onTestPrint && (
              <button
                type="button"
                onClick={() => void onTestPrint()}
                disabled={testInProgress || !hasReadyPrinter}
                title={
                  hasReadyPrinter
                    ? 'Enviar um cupom real para a impressora USB'
                    : 'Conecte a impressora USB primeiro'
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-panel px-5 py-2.5 text-xs font-bold text-koma-foreground transition hover:border-emerald-500 hover:bg-koma-raised disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer shadow-xs"
              >
                {testInProgress
                  ? <RefreshCw size={16} className="animate-spin" />
                  : <Printer size={16} />}
                {testInProgress ? 'Enviando teste…' : 'Imprimir teste'}
              </button>
            )}
          </div>
        </div>
      </div>

      {monitorData && monitorData.summary.delayed > 0 && (
        <div className="flex items-start gap-3 rounded-2xl koma-badge-warning px-4 py-3 shadow-xs">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-800 dark:text-amber-300" />
          <div>
            <strong className="block text-xs font-bold text-amber-950 dark:text-amber-200">
              Há impressão aguardando há mais de 2 minutos
            </strong>
            <span className="text-[10px] text-amber-900/80 dark:text-amber-300/80 font-medium">
              Espera mais antiga: {formatAge(monitorData.summary.oldest_unresolved_seconds)}.
            </span>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-koma-border shadow-xs">
        <button
          type="button"
          onClick={() => setShowQueue(current => !current)}
          className="flex min-h-12 w-full items-center justify-between gap-3 bg-koma-panel px-4 py-3 text-left transition hover:bg-koma-raised cursor-pointer"
          aria-expanded={showQueue}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
              queueTotal || failedJobs.length
                ? 'koma-badge-warning'
                : 'koma-badge-success'
            }`}>
              <Clock3 size={15} />
            </span>
            <span>
              <strong className="block text-xs font-bold text-koma-foreground">Fila e recuperação</strong>
              <span className="block text-[10px] font-normal text-koma-muted">
                {queueTotal} em processamento · {failedJobs.length} com falha · limite visual {monitorData?.queue_limit || 50}
              </span>
            </span>
          </span>
          {showQueue ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {showQueue && (
          <div className="max-h-72 overflow-auto border-t border-koma-border bg-koma-panel">
            {monitorData?.queue_jobs?.length ? (
              <div className="divide-y divide-koma-border">
                {monitorData.queue_jobs.map(job => {
                  const displayStatus = job.display_status || job.status;
                  return (
                    <div key={job.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_auto]">
                      <div className="min-w-0">
                        <strong className="block truncate text-xs font-bold text-koma-foreground">
                          {job.reference || friendlyDocumentType(job.document_type)}
                        </strong>
                        <span className="text-[10px] text-koma-muted font-medium">
                          {friendlyDocumentType(job.document_type)} · {job.destination} · aguardando {formatAge(job.age_seconds)}
                        </span>
                        {job.last_error && (
                          <span className="mt-1 block truncate text-[9px] text-rose-600 dark:text-rose-300 font-medium" title={job.last_error}>
                            {job.last_error}
                          </span>
                        )}
                      </div>
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[9px] font-bold ${STATUS_STYLES[displayStatus] || STATUS_STYLES.cancelled}`}>
                        {STATUS_LABELS[displayStatus] || displayStatus}
                      </span>
                      {job.status === 'failed' ? (
                        <button
                          type="button"
                          onClick={() => void handleRetryFailedJobs()}
                          disabled={Boolean(reprintingId)}
                          className="col-span-2 inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg koma-badge-danger px-2.5 py-1 text-[9px] font-bold transition disabled:opacity-50 sm:col-span-1 cursor-pointer"
                        >
                          <RotateCcw size={10} /> Recuperar
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-6 text-center">
                <CheckCircle2 size={20} className="mx-auto text-emerald-700 dark:text-emerald-400" />
                <strong className="mt-2 block text-xs font-bold text-koma-foreground">Fila vazia</strong>
                <span className="text-[10px] text-koma-muted">Nenhuma impressão precisa ser recuperada.</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold text-koma-foreground">Impressoras físicas no USB</h3>
            <p className="mt-0.5 text-[10px] text-koma-muted">
              Filas PDF, fax, OneNote e outros dispositivos virtuais ficam ocultos.
            </p>
          </div>
          <span className="rounded-full border border-koma-border bg-koma-raised px-2.5 py-1 text-[9px] font-semibold text-koma-muted">
            {presentUsbPrinters.length} conectada(s)
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {presentUsbPrinters.length ? presentUsbPrinters.map((printer, index) => {
            const ready = (
              printer.available
              && printer.present === true
              && printer.configured === true
            );
            const busy = commandRunning || Boolean(pendingCommandId);

            return (
              <div
                key={`${printer.agentId}-${printer.name}-${index}`}
                className="rounded-2xl border border-koma-border bg-koma-panel p-4 shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      ready
                        ? 'koma-badge-success'
                        : 'bg-koma-raised text-koma-muted'
                    }`}>
                      <Usb size={16} />
                    </div>
                    <div className="min-w-0">
                      <strong className="block truncate text-xs font-bold text-koma-foreground">
                        {printer.name}
                      </strong>
                      <span className={`mt-0.5 inline-block text-[9px] font-semibold ${
                        ready ? 'text-emerald-700 dark:text-emerald-400' : 'text-koma-muted'
                      }`}>
                        {ready
                          ? 'Conectada e pronta'
                          : 'USB presente · configuração pendente'}
                      </span>
                    </div>
                  </div>
                  {printer.is_default && (
                    <span className="shrink-0 rounded-full koma-badge-success px-2 py-0.5 text-[8px] font-extrabold">
                      PRINCIPAL
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void requestUsbConnection(printer.agentId, printer)}
                  disabled={
                    busy
                    || !hasOnlineAgent
                    || !monitorData?.agents.find(
                      agent => agent.agent_id === printer.agentId
                    )?.supports_usb_commands
                  }
                  className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-card px-4 py-2 text-xs font-bold text-koma-foreground transition hover:border-emerald-500 hover:bg-koma-raised disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {busy
                    ? <RefreshCw size={14} className="animate-spin" />
                    : ready
                      ? <Wrench size={14} />
                      : <Power size={14} />}
                  {busy
                    ? 'Conectando…'
                    : ready
                      ? 'Reconectar esta impressora'
                      : 'Conectar esta impressora'}
                </button>
              </div>
            );
          }) : (
            <div className="md:col-span-2 rounded-2xl border-2 border-dashed border-koma-border bg-koma-raised/40 px-5 py-8 text-center">
              <Usb size={24} className="mx-auto text-koma-muted" />
              <strong className="mt-3 block text-xs font-bold text-koma-foreground">
                Nenhuma impressora USB detectada
              </strong>
              <span className="mt-1 block text-[10px] text-koma-muted">
                Conecte o cabo ao computador do caixa e use o botão de busca acima.
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#29292e]">
        <button
          type="button"
          onClick={() => setShowHistory(current => !current)}
          className="flex min-h-11 w-full items-center justify-between gap-2 bg-koma-card px-4 py-2.5 text-[10px] font-bold text-koma-secondary transition hover:bg-koma-raised cursor-pointer"
          aria-expanded={showHistory}
        >
          <span className="flex items-center gap-2">
            <History size={14} />
            Histórico recente
            <span className="text-[9px] font-normal text-koma-muted">
              hoje · {monitorData?.history_jobs?.length || 0}/{monitorData?.history_limit || 20}
            </span>
          </span>
          {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {showHistory && (
          <div className="max-h-80 overflow-auto">
            {monitorData?.history_jobs?.length ? (
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-koma-card text-[8px] uppercase tracking-wider text-koma-muted">
                  <tr>
                    <th className="px-3 py-2">Referência</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="hidden px-3 py-2 md:table-cell">Impressora</th>
                    <th className="px-3 py-2">Horário</th>
                    <th className="px-3 py-2 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-koma-border">
                  {monitorData.history_jobs.map(job => {
                    const displayStatus = job.display_status || job.status;
                    return (
                      <tr key={job.id} className={job.delayed ? 'bg-amber-500/5' : ''}>
                        <td className="px-3 py-2">
                          <strong className="block text-[9px] text-koma-secondary">
                            {job.reference || friendlyDocumentType(job.document_type)}
                            {job.is_reprint ? ' · Reimpressão' : ''}
                          </strong>
                          <span className="text-[8px] text-koma-muted">
                            {friendlyDocumentType(job.document_type)} · {job.destination}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-bold ${STATUS_STYLES[displayStatus] || STATUS_STYLES.cancelled}`}>
                            {STATUS_LABELS[displayStatus] || displayStatus}
                          </span>
                          {job.last_error && (
                            <span title={job.last_error} className="mt-1 block max-w-40 truncate text-[7px] text-red-300">
                              {job.last_error}
                            </span>
                          )}
                        </td>
                        <td className="hidden px-3 py-2 text-[8px] text-koma-subtle md:table-cell">
                          {friendlyPrinterName(job.printer_name)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-[8px] text-koma-subtle">
                          {formatDate(job.printed_at || job.created_at)}
                          {job.delayed && (
                            <span className="block text-amber-600 dark:text-amber-300">
                              esperando {formatAge(job.age_seconds)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {job.can_reprint ? (
                            <button
                              type="button"
                              onClick={() => void requestReprint(job)}
                              disabled={reprintingId === job.id}
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#35353a] px-2.5 py-1 text-[8px] font-bold text-koma-secondary transition hover:border-gray-500 disabled:opacity-50 cursor-pointer"
                            >
                              {reprintingId === job.id
                                ? <RefreshCw size={10} className="animate-spin" />
                                : <RotateCcw size={10} />}
                              Reimprimir
                            </button>
                          ) : job.accepted_by_spooler ? (
                            <CheckCircle2 size={13} className="ml-auto text-emerald-400" />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="px-4 py-6 text-center text-[9px] text-koma-muted">
                Nenhum trabalho de impressão registrado hoje.
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-[8px] leading-relaxed text-gray-600">
        “Enviado ao sistema” confirma que o CUPS ou o Spooler recebeu o trabalho.
        Impressoras térmicas comuns não confirmam de forma confiável se o papel saiu,
        então o Kôma não apresenta essa etapa como confirmação física.
      </p>
    </section>
    </div>
  );
}
