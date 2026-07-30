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
  Wifi,
  WifiOff,
  Wrench
} from 'lucide-react';

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
  history_timezone: string;
  online_threshold_seconds: number;
  command_timeout_seconds?: number;
  delay_threshold_seconds: number;
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
  cancelled: 'Cancelado'
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  claimed: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  printing: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  spooler_accepted: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-300',
  cancelled: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'
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
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
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
        throw new Error(data?.detail || 'Não foi possível consultar a impressão.');
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
        new Date(monitorData?.generated_at || Date.now()).getTime()
        - new Date(activePendingCommand.requestedAt).getTime()
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
        new Date(right.completed_at).getTime()
        - new Date(left.completed_at).getTime()
      ));
    const latestResult = completedResults[0];
    const latestResultIsRecent = Boolean(
      latestResult
      && (
        new Date(monitorData.generated_at).getTime()
        - new Date(latestResult.completed_at).getTime()
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
    const updatedAt = new Date(agent.diagnostics_updated_at).getTime();
    const generatedAt = monitorData?.generated_at
      ? new Date(monitorData.generated_at).getTime()
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
  const configuredDisconnectedPrinters = usbPrinters.filter(
    printer => printer.configured === true && printer.present !== true
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
  const latestJob = monitorData?.jobs[0] || null;

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
        throw new Error(data?.detail || 'Não foi possível acionar o USB.');
      }
      setPendingCommandId(data?.command?.id || null);
      setActionMessage('Procurando a impressora no USB…');
      await loadMonitor(false);
    } catch (requestError) {
      setActionSuccessful(false);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível acionar o USB.'
      );
    }
  };

  const startLocalAgent = () => {
    setStartingAgent(true);
    setActionMessage('Solicitando a ativação do Kôma Print…');
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
        title: 'Kôma Print está inativo',
        detail: 'Ative o serviço por esta tela. Não é necessário abrir outro aplicativo.'
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
        title: 'Computador conectado; aguardando leitura do USB',
        detail: 'Use o botão abaixo para forçar uma nova busca física.'
      };
    }
    if (!hasUsbCommandAgent) {
      return {
        tone: 'danger',
        title: 'Kôma Print precisa ser atualizado',
        detail: 'Esta versão do serviço não executa a busca USB pelo painel.'
      };
    }
    if (!hasReadyPrinter && presentUsbPrinters.length > 0) {
      return {
        tone: 'warning',
        title: 'USB detectado; falta concluir a conexão',
        detail: 'O Kôma pode configurar e ativar essa impressora automaticamente.'
      };
    }
    if (!hasReadyPrinter && configuredDisconnectedPrinters.length > 0) {
      return {
        tone: 'danger',
        title: 'Impressora USB desconectada',
        detail: 'A fila existe, mas o equipamento físico não está presente na porta USB.'
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
    return {
      tone: 'success',
      title: 'Impressora USB pronta',
      detail: `${friendlyPrinterName(readyUsbPrinters[0]?.name || null)} está conectada e disponível.`
    };
  }, [
    commandRunning,
    configuredDisconnectedPrinters.length,
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
    success: 'bg-emerald-400/15 text-emerald-300',
    warning: 'bg-amber-400/15 text-amber-300',
    danger: 'bg-red-400/15 text-red-300',
    neutral: 'bg-sky-400/15 text-sky-300'
  };

  return (
    <section className="rounded-3xl border border-[#2b2b2f] bg-[#121214] p-4 sm:p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#27272A] pb-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Usb size={18} className="text-emerald-400" />
            Conexão da impressora USB
          </div>
          <p className="mt-1 text-[10px] text-gray-500">
            Controle o equipamento físico sem abrir aplicativos ou configurações do computador.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMonitor(true)}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#333338] bg-[#1c1c1f] px-4 py-2 text-[10px] font-bold text-gray-200 transition hover:border-gray-500 hover:bg-[#242428] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Atualizar status
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[10px] text-red-200">
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
              <strong className="block text-sm text-white">{diagnostic.title}</strong>
              <span className="mt-1 block text-[10px] leading-relaxed text-gray-300">
                {diagnostic.detail}
              </span>
              {actionMessage && (
                <span className={`mt-2 block text-[10px] font-semibold ${
                  actionSuccessful === false
                    ? 'text-red-200'
                    : actionSuccessful === true
                      ? 'text-emerald-200'
                      : 'text-sky-200'
                }`}>
                  {actionMessage}
                </span>
              )}
            </div>
          </div>

          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:w-auto">
            {!hasOnlineAgent ? (
              <button
                type="button"
                onClick={startLocalAgent}
                disabled={startingAgent}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-[11px] font-extrabold text-[#07130f] transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
              >
                {startingAgent
                  ? <RefreshCw size={16} className="animate-spin" />
                  : <Power size={16} />}
                {startingAgent ? 'Ativando…' : 'Ativar Kôma Print'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void requestUsbConnection()}
                disabled={commandRunning || Boolean(pendingCommandId)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-[11px] font-extrabold text-[#07130f] transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
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
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#3a3a40] bg-[#1c1c1f] px-5 py-2.5 text-[11px] font-bold text-white transition hover:border-emerald-500/50 hover:bg-[#242428] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
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

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#2a2a2e] bg-[#0b0b0d] p-3">
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-gray-500">
            {hasOnlineAgent
              ? <Wifi size={13} className="text-emerald-400" />
              : <WifiOff size={13} className="text-red-400" />}
            Serviço local
          </div>
          <strong className={`mt-1 block text-xs ${hasOnlineAgent ? 'text-emerald-300' : 'text-red-300'}`}>
            {hasOnlineAgent ? 'Ativo' : 'Inativo'}
          </strong>
        </div>
        <div className="rounded-2xl border border-[#2a2a2e] bg-[#0b0b0d] p-3">
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-gray-500">
            <Usb size={13} className={hasReadyPrinter ? 'text-emerald-400' : 'text-red-400'} />
            Equipamento USB
          </div>
          <strong className={`mt-1 block text-xs ${hasReadyPrinter ? 'text-emerald-300' : 'text-red-300'}`}>
            {hasReadyPrinter
              ? 'Pronto'
              : presentUsbPrinters.length
                ? 'Detectado'
                : 'Ausente'}
          </strong>
        </div>
        <div className="rounded-2xl border border-[#2a2a2e] bg-[#0b0b0d] p-3">
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-gray-500">
            <Clock3 size={13} />
            Fila
          </div>
          <strong className="mt-1 block text-xs text-white">{queueTotal} pendente(s)</strong>
        </div>
        <div className="rounded-2xl border border-[#2a2a2e] bg-[#0b0b0d] p-3">
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-gray-500">
            <AlertTriangle size={13} />
            Falhas hoje
          </div>
          <strong className={`mt-1 block text-xs ${monitorData?.summary.failed ? 'text-red-300' : 'text-white'}`}>
            {monitorData?.summary.failed ?? 0}
          </strong>
        </div>
      </div>

      {monitorData && monitorData.summary.delayed > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-300" />
          <div>
            <strong className="block text-[11px] text-amber-100">
              Há impressão aguardando há mais de 2 minutos
            </strong>
            <span className="text-[10px] text-amber-100/70">
              Espera mais antiga: {formatAge(monitorData.summary.oldest_unresolved_seconds)}.
            </span>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold text-white">Impressoras físicas no USB</h3>
            <p className="mt-0.5 text-[9px] text-gray-500">
              Filas PDF, fax, OneNote e outros dispositivos virtuais ficam ocultos.
            </p>
          </div>
          <span className="rounded-full border border-[#303036] px-2.5 py-1 text-[9px] text-gray-400">
            {presentUsbPrinters.length} conectada(s)
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {usbPrinters.length ? usbPrinters.map((printer, index) => {
            const ready = (
              printer.available
              && printer.present === true
              && printer.configured === true
            );
            const present = printer.present === true;
            const busy = commandRunning || Boolean(pendingCommandId);
            return (
              <div
                key={`${printer.agentId}:${printer.name}:${index}`}
                className={`rounded-2xl border p-4 ${
                  ready
                    ? 'border-emerald-500/25 bg-emerald-500/[0.07]'
                    : present
                      ? 'border-amber-500/25 bg-amber-500/[0.07]'
                      : 'border-red-500/25 bg-red-500/[0.07]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      ready
                        ? 'bg-emerald-400/15 text-emerald-300'
                        : present
                          ? 'bg-amber-400/15 text-amber-300'
                          : 'bg-red-400/15 text-red-300'
                    }`}>
                      <Printer size={17} />
                    </div>
                    <div className="min-w-0">
                      <strong className="block truncate text-[11px] text-white">
                        {friendlyPrinterName(printer.name)}
                      </strong>
                      <span className={`mt-1 block text-[9px] ${
                        ready
                          ? 'text-emerald-300'
                          : present
                            ? 'text-amber-300'
                            : 'text-red-300'
                      }`}>
                        {ready
                          ? 'Conectada e pronta'
                          : present && printer.configured !== true
                            ? 'USB presente · configuração pendente'
                            : printer.configured === true
                              ? 'Fila salva · USB desconectado'
                              : 'Indisponível'}
                      </span>
                    </div>
                  </div>
                  {printer.is_default && (
                    <span className="shrink-0 rounded-full bg-emerald-400/10 px-2 py-1 text-[8px] font-bold text-emerald-300">
                      PRINCIPAL
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void requestUsbConnection(printer.agentId, printer)}
                  disabled={busy || !hasOnlineAgent}
                  className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#3a3a40] bg-[#1c1c1f] px-4 py-2 text-[10px] font-bold text-white transition hover:border-emerald-500/50 hover:bg-[#242428] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
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
            <div className="md:col-span-2 rounded-2xl border border-dashed border-[#34343a] bg-[#0b0b0d] px-5 py-8 text-center">
              <Usb size={24} className="mx-auto text-gray-600" />
              <strong className="mt-3 block text-[11px] text-gray-300">
                Nenhuma impressora USB detectada
              </strong>
              <span className="mt-1 block text-[9px] text-gray-500">
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
          className="flex min-h-11 w-full items-center justify-between gap-2 bg-[#1c1c1f] px-4 py-2.5 text-[10px] font-bold text-gray-200 transition hover:bg-[#242428] cursor-pointer"
          aria-expanded={showHistory}
        >
          <span className="flex items-center gap-2">
            <History size={14} />
            Histórico recente
            <span className="text-[9px] font-normal text-gray-500">
              hoje · {monitorData?.jobs.length || 0}/{monitorData?.history_limit || 20}
            </span>
          </span>
          {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {showHistory && (
          <div className="max-h-80 overflow-auto">
            {monitorData?.jobs.length ? (
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-[#121214] text-[8px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Referência</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="hidden px-3 py-2 md:table-cell">Impressora</th>
                    <th className="px-3 py-2">Horário</th>
                    <th className="px-3 py-2 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#27272A]">
                  {monitorData.jobs.map(job => {
                    const displayStatus = job.display_status || job.status;
                    return (
                      <tr key={job.id} className={job.delayed ? 'bg-amber-500/5' : ''}>
                        <td className="px-3 py-2">
                          <strong className="block text-[9px] text-gray-200">
                            {job.reference || friendlyDocumentType(job.document_type)}
                            {job.is_reprint ? ' · Reimpressão' : ''}
                          </strong>
                          <span className="text-[8px] text-gray-500">
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
                        <td className="hidden px-3 py-2 text-[8px] text-gray-400 md:table-cell">
                          {friendlyPrinterName(job.printer_name)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-[8px] text-gray-400">
                          {formatDate(job.printed_at || job.created_at)}
                          {job.delayed && (
                            <span className="block text-amber-300">
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
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#35353a] px-2.5 py-1 text-[8px] font-bold text-gray-200 transition hover:border-gray-500 disabled:opacity-50 cursor-pointer"
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
              <div className="px-4 py-6 text-center text-[9px] text-gray-500">
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
  );
}
