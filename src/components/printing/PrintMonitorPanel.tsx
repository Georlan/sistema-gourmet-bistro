import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bluetooth,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  History,
  Power,
  Printer,
  RefreshCw,
  RotateCcw,
  Usb,
  Wifi,
  WifiOff,
  Wrench
} from 'lucide-react';
import { OperationalBanner } from '../shared/OperationalBanner';
import { parseBackendTimestamp } from '../../utils/dateTime';

interface DetectedPrinter {
  name: string;
  connection: 'usb' | 'bluetooth' | 'network' | 'unknown';
  uri: string | null;
  address?: string | null;
  cups_queue?: string | null;
  is_default: boolean;
  available: boolean;
  present?: boolean;
  configured?: boolean;
  paired?: boolean;
  trusted?: boolean;
  connected?: boolean;
  spp?: boolean;
  dispatchable?: boolean;
}

interface PrinterEndpointReport {
  id: string;
  name: string;
  display_name?: string | null;
  transport: string;
  address?: string | null;
  protocol?: string;
  options?: Record<string, unknown>;
}

interface AgentCommand {
  id: string;
  action: 'connect_usb' | 'test_bluetooth';
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
  supports_bluetooth_test?: boolean;
  printer_diagnostics: {
    adapter: string;
    platform: string;
    printers: DetectedPrinter[];
    endpoints?: PrinterEndpointReport[];
    destinations?: Record<string, string>;
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
  origin_kind?: 'automatic' | 'manual' | 'manual_reprint' | 'test';
  origin_label?: string;
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
    queue_origins?: {
      automatic: number;
      manual: number;
      manual_reprint: number;
      test: number;
    };
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
  children?: React.ReactNode | ((context: { activePaperWidthMm?: number }) => React.ReactNode);
  advancedTestsSlot?: React.ReactNode;
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

function friendlyQueueOrigin(job: PrintJobHistory): string {
  if (job.origin_label) return job.origin_label;
  if (job.is_reprint || job.source_type === 'reimpressao') return 'Reimpressão manual';
  if (job.source_type.startsWith('teste')) return 'Teste';
  return 'Origem não identificada';
}

function friendlyPrinterName(value: string | null): string {
  if (!value) return 'Não identificada';
  const normalized = value.trim().toLocaleLowerCase('pt-BR');
  if (['padrão', 'padrao', 'default', 'auto', 'automática', 'automatica'].includes(normalized)) {
    return 'Impressora principal';
  }
  return value;
}

function getFriendlyTransportBadge(transport?: string, connection?: string): { label: string; badgeClass: string } {
  const key = (transport || connection || '').toLowerCase();
  if (key === 'bluetooth_rfcomm' || key === 'bluetooth' || key === 'bt') {
    return {
      label: 'Bluetooth',
      badgeClass: 'koma-badge-info border border-sky-400/40 text-sky-700 dark:text-sky-300'
    };
  }
  if (key === 'tcp' || key === 'network') {
    return {
      label: 'Rede',
      badgeClass: 'koma-badge-info border border-teal-400/40 text-teal-700 dark:text-teal-300'
    };
  }
  if (key === 'usb_direct' || key === 'usb') {
    return {
      label: 'USB',
      badgeClass: 'koma-badge-success border border-emerald-400/40 text-emerald-700 dark:text-emerald-300'
    };
  }
  return {
    label: 'Impressora',
    badgeClass: 'koma-badge-neutral border border-zinc-400/30'
  };
}

function getTransportBadge(transport?: string, connection?: string): { label: string; badgeClass: string } {
  const key = (transport || connection || '').toLowerCase();
  if (key === 'bluetooth_rfcomm' || key === 'bluetooth') {
    return {
      label: 'Bluetooth SPP',
      badgeClass: 'koma-badge-info border border-sky-400/40 text-sky-700 dark:text-sky-300'
    };
  }
  if (key === 'cups') {
    return {
      label: 'CUPS',
      badgeClass: 'koma-badge-neutral border border-indigo-400/40 text-indigo-700 dark:text-indigo-300'
    };
  }
  if (key === 'windows_spooler') {
    return {
      label: 'Spooler',
      badgeClass: 'koma-badge-neutral border border-purple-400/40 text-purple-700 dark:text-purple-300'
    };
  }
  if (key === 'tcp' || key === 'network') {
    return {
      label: 'Rede TCP',
      badgeClass: 'koma-badge-info border border-teal-400/40 text-teal-700 dark:text-teal-300'
    };
  }
  if (key === 'usb_direct' || key === 'usb') {
    return {
      label: 'USB',
      badgeClass: 'koma-badge-success border border-emerald-400/40 text-emerald-700 dark:text-emerald-300'
    };
  }
  return {
    label: transport || connection || 'Impressora',
    badgeClass: 'koma-badge-neutral border border-zinc-400/30'
  };
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
  testInProgress = false,
  children,
  advancedTestsSlot
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
  const [showQueue, setShowQueue] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

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

    // O heartbeat do agente publica print_monitor_updated pelo WebSocket.
    // Este evento é a fonte primária de atualização da tela; o intervalo
    // abaixo é apenas uma reconciliação de segurança caso o socket caia.
    const refreshFromRealtime = () => void loadMonitor(false);
    const fallbackIntervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadMonitor(false);
      }
    }, 30_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadMonitor(false);
    };

    window.addEventListener('koma_print_monitor_refresh', refreshFromRealtime);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(fallbackIntervalId);
      window.removeEventListener('koma_print_monitor_refresh', refreshFromRealtime);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadMonitor]);

  const activePendingCommand = (monitorData?.agents || [])
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
  const pendingCommandAction = activePendingCommand?.command?.action || null;
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
    const completedResults = (monitorData.agents || [])
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
      pendingCommandAction === 'test_bluetooth'
        ? 'O teste Bluetooth não respondeu dentro do prazo e foi encerrado.'
        : 'A busca USB não respondeu dentro do prazo e foi encerrada.'
    );
    setActionSuccessful(false);
    setPendingCommandId(null);
  }, [commandRunning, hasPendingCommand, pendingCommandAction]);

  const queueTotal = useMemo(() => {
    if (!monitorData?.summary) return 0;
    return (
      (monitorData.summary.pending || 0)
      + (monitorData.summary.claimed || 0)
      + (monitorData.summary.printing || 0)
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

  const isPrinterReady = (printer: DetectedPrinter): boolean => {
    if (
      printer.connection === 'bluetooth'
      && !(printer.paired && (printer.spp ?? true))
    ) {
      return false;
    }
    return Boolean(
      printer.available
      && printer.present === true
      && printer.configured === true
    );
  };

  const isPrinterDispatchable = (printer: DetectedPrinter): boolean => {
    if (printer.connection === 'bluetooth') {
      return Boolean(
        printer.configured
        && printer.paired
        && (printer.spp ?? true)
        && (printer.dispatchable ?? true)
      );
    }
    return isPrinterReady(printer);
  };

  const allDetectedPrinters = useMemo(() => (
    (monitorData?.agents || [])
      .filter(agent => agentHasFreshDiagnostics(agent))
      .flatMap((agent, agentIndex) => (
        (agent.printer_diagnostics?.printers || []).map(printer => ({
          ...printer,
          agentIndex,
          agentId: agent.agent_id,
          supportsBluetoothTest: agent.supports_bluetooth_test === true
        }))
      ))
  ), [agentHasFreshDiagnostics, monitorData]);

  const readyPrinters = useMemo(() => (
    allDetectedPrinters.filter(isPrinterReady)
  ), [allDetectedPrinters]);

  const dispatchablePrinters = useMemo(() => (
    allDetectedPrinters.filter(isPrinterDispatchable)
  ), [allDetectedPrinters]);

  const usbPrinters = useMemo(() => (
    (monitorData?.agents || [])
      .filter(agent => agentHasFreshDiagnostics(agent))
      .flatMap((agent, agentIndex) => (
        (agent.printer_diagnostics?.printers || [])
          .filter(printer => printer.connection === 'usb')
          .map(printer => ({
            ...printer,
            agentIndex,
            agentId: agent.agent_id
          }))
      ))
  ), [agentHasFreshDiagnostics, monitorData]);

  const bluetoothPrinters = useMemo(() => (
    (monitorData?.agents || [])
      .filter(agent => agentHasFreshDiagnostics(agent))
      .flatMap(agent => (
        (agent.printer_diagnostics?.printers || [])
          .filter(printer => printer.connection === 'bluetooth')
          .map(printer => ({
            ...printer,
            agentId: agent.agent_id,
            supportsBluetoothTest: agent.supports_bluetooth_test === true
          }))
      ))
  ), [agentHasFreshDiagnostics, monitorData]);

  const networkPrinters = useMemo(() => (
    (monitorData?.agents || [])
      .filter(agent => agentHasFreshDiagnostics(agent))
      .flatMap(agent => (
        (agent.printer_diagnostics?.printers || [])
          .filter(printer => printer.connection === 'network')
          .map(printer => ({
            ...printer,
            agentId: agent.agent_id
          }))
      ))
  ), [agentHasFreshDiagnostics, monitorData]);

  const configuredEndpoints = useMemo(() => (
    (monitorData?.agents || [])
      .filter(agent => agentHasFreshDiagnostics(agent))
      .flatMap(agent => agent.printer_diagnostics?.endpoints || [])
  ), [agentHasFreshDiagnostics, monitorData]);

  const configuredDestinations = useMemo(() => {
    const map: Record<string, string> = {};
    for (const agent of monitorData?.agents || []) {
      if (agentHasFreshDiagnostics(agent) && agent.printer_diagnostics?.destinations) {
        Object.assign(map, agent.printer_diagnostics.destinations);
      }
    }
    return map;
  }, [agentHasFreshDiagnostics, monitorData]);

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
  const onlineAgents = (monitorData?.agents || []).filter(agent => agent.online);
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
  const hasReadyPrinter = (
    readyPrinters.length > 0
    || readyUsbPrinters.length > 0
    || (monitorData?.summary?.printer_ready ?? false)
    || (monitorData?.agents || []).some(agent => agent.printer_ready)
  );
  const hasDispatchablePrinter = dispatchablePrinters.length > 0;
  const hasFreshPrinterDiagnostics = Boolean(
    (monitorData?.agents || []).some(agent => agentHasFreshDiagnostics(agent))
  );
  const latestJob = monitorData?.queue_jobs?.[0] || monitorData?.jobs?.[0] || null;

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

  const requestBluetoothTest = async (
    agentId: string,
    printer: DetectedPrinter
  ) => {
    if (pendingCommandId || commandRunning) return;
    setActionMessage('');
    setActionSuccessful(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/print-agents/actions/test-bluetooth`,
        {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agent_id: agentId,
            printer_name: printer.name,
            printer_uri: printer.uri
          })
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.detail || 'Não foi possível iniciar o teste Bluetooth.'
        );
      }
      setError('');
      setPendingCommandId(data?.command?.id || null);
      setActionMessage('Enviando teste para a impressora Bluetooth…');
      await loadMonitor(false);
    } catch (requestError) {
      setActionSuccessful(false);
      setActionMessage(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível testar a impressora Bluetooth.'
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
        detail: 'Aguarde a leitura das impressoras conectadas a este computador.'
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
      if (pendingCommandAction === 'test_bluetooth') {
        return {
          tone: 'neutral',
          title: 'Testando a impressora Bluetooth',
          detail: 'O Kôma Print está enviando um cupom curto pela fila Bluetooth deste computador.'
        };
      }
      return {
        tone: 'neutral',
        title: 'Conectando a impressora USB',
        detail: 'O computador está procurando o equipamento e preparando a fila de impressão.'
      };
    }
    if (!hasFreshPrinterDiagnostics) {
      return {
        tone: 'warning',
        title: 'Verificando as impressoras',
        detail: 'O KÔMA Print está atualizando o estado dos equipamentos conectados.'
      };
    }
    if (!hasReadyPrinter && presentUsbPrinters.length > 0) {
      return {
        tone: 'warning',
        title: 'USB detectado; falta concluir a conexão',
        detail: 'O Kôma pode configurar e ativar essa impressora automaticamente.'
      };
    }
    if (!hasReadyPrinter && hasDispatchablePrinter) {
      const candidate = dispatchablePrinters[0];
      return {
        tone: 'neutral',
        title: `${friendlyPrinterName(candidate?.name || null)} configurada; desconectada agora`,
        detail: (
          'O Bluetooth fica ocioso sem conexão persistente. '
          + 'O KÔMA conecta automaticamente somente quando houver uma impressão.'
        )
      };
    }
    if (!hasReadyPrinter) {
      if (monitorData.summary.delayed > 0) {
        return {
          tone: 'warning',
          title: `${queueTotal} na fila; ${monitorData.summary.delayed} atrasada(s)`,
          detail: (
            `O agente local está conectado, mas não há impressora física pronta. `
            + `Atraso significa mais de ${Math.round(monitorData.delay_threshold_seconds / 60)} min na fila; `
            + `espera mais antiga: ${formatAge(monitorData.summary.oldest_unresolved_seconds)}.`
          )
        };
      }
      return {
        tone: 'warning',
        title: 'Kôma Print conectado; nenhuma impressora disponível',
        detail: (
          'Ligue ou conecte uma impressora e o estado será atualizado automaticamente.'
        )
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
        detail: latestJob.last_error || 'Verifique a impressora e envie um teste.'
      };
    }
    if (queueTotal > 0) {
      return {
        tone: 'neutral',
        title: 'Impressão em andamento',
        detail: `${queueTotal} trabalho(s) sendo processado(s).`
      };
    }
    const firstReady = readyPrinters[0] || readyUsbPrinters[0] || null;
    const readyName = friendlyPrinterName(firstReady?.name || null);

    return {
      tone: 'success',
      title: 'Pronta para imprimir',
      detail: `${readyName} está pronta para imprimir.`
    };
  }, [
    commandRunning,
    hasFreshPrinterDiagnostics,
    hasOnlineAgent,
    hasReadyPrinter,
    hasDispatchablePrinter,
    latestJob,
    monitorData,
    pendingCommandAction,
    pendingCommandId,
    queueTotal,
    dispatchablePrinters,
    readyPrinters,
    readyUsbPrinters
  ]);

  const diagnosticStyle: Record<DiagnosticTone, string> = {
    success: 'border-emerald-400/80 bg-emerald-50/90 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-300',
    warning: 'border-amber-400/90 bg-amber-50 dark:bg-amber-950/25 text-amber-950 dark:text-amber-200',
    danger: 'border-rose-400/90 bg-rose-50 dark:bg-rose-950/25 text-rose-950 dark:text-rose-200',
    neutral: 'border-sky-400/80 bg-sky-50 dark:bg-sky-950/25 text-sky-950 dark:text-sky-200'
  };
  const diagnosticIconStyle: Record<DiagnosticTone, string> = {
    success: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30',
    warning: 'bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-500/40',
    danger: 'bg-rose-500/20 text-rose-900 dark:text-rose-300 border border-rose-500/40',
    neutral: 'bg-sky-500/20 text-sky-800 dark:text-sky-300 border border-sky-500/30'
  };

  const agentState = hasOnlineAgent ? 'Conectado' : 'Offline';
  const equipmentState = hasReadyPrinter
    ? 'Pronta para imprimir'
    : hasDispatchablePrinter
      ? 'Configurada'
      : (allDetectedPrinters.length > 0 || presentUsbPrinters.length > 0)
        ? 'Impressora encontrada'
        : 'Desconectada';
  const operationAccent = !hasOnlineAgent
    ? 'agente offline'
    : queueTotal > 0
      ? `${queueTotal} na fila`
      : hasReadyPrinter
        ? 'pronta para imprimir'
        : hasDispatchablePrinter
          ? 'impressora configurada'
          : 'impressora indisponível';
  const queueOrigins = monitorData?.summary.queue_origins;
  const queueOriginSummary = queueOrigins
    ? [
        queueOrigins.automatic > 0 ? `${queueOrigins.automatic} automática(s)` : '',
        queueOrigins.manual_reprint > 0 ? `${queueOrigins.manual_reprint} reimpressão(ões)` : '',
        queueOrigins.manual > 0 ? `${queueOrigins.manual} manual(is)` : '',
        queueOrigins.test > 0 ? `${queueOrigins.test} teste(s)` : ''
      ].filter(Boolean).join(' · ')
    : '';

  const firstReady = readyPrinters[0] || readyUsbPrinters[0] || null;
  const firstDispatchable = dispatchablePrinters[0] || null;
  const activePrinter = firstReady || firstDispatchable || allDetectedPrinters[0] || null;
  const activeEndpoint = activePrinter
    ? (configuredEndpoints.find(item => (
        item.name === activePrinter.name
        || (Boolean(activePrinter.address) && item.address === activePrinter.address)
      )) || null)
    : null;
  const activePaperWidthMm = Number(activeEndpoint?.options?.paper_width_mm || 0) || undefined;
  const activePrinterBadge = activePrinter
    ? getFriendlyTransportBadge(activeEndpoint?.transport, activePrinter.connection)
    : null;
  const delayedJobsCount = monitorData?.summary?.delayed || 0;
  const attentionJobsCount = failedJobs.length + delayedJobsCount;
  const hasPrintingProblems = attentionJobsCount > 0 || (queueTotal > 0 && Boolean(latestJob?.status === 'failed'));

  return (
    <div className="space-y-6">
      <OperationalBanner
        id="printing-operation-title"
        eyebrow="IMPRESSÃO"
        title="Impressão"
        accent={operationAccent}
        description="Veja se o KÔMA Print está conectado e qual impressora está pronta."
        metrics={[
          {
            label: 'KÔMA Print',
            value: agentState,
            valueClassName: hasOnlineAgent ? 'text-emerald-700 dark:text-emerald-400 font-bold' : 'text-rose-700 dark:text-rose-300 font-bold'
          },
          {
            label: 'Impressora',
            value: equipmentState,
            valueClassName: hasReadyPrinter ? 'text-emerald-700 dark:text-emerald-400 font-bold' : 'text-amber-800 dark:text-amber-300 font-bold'
          }
        ]}
      />

      {/* 1. Estado atual */}
      <section className="space-y-3 text-left" aria-label="Monitor de impressão">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-emerald-700 dark:text-emerald-400" />
            <h4 className="font-serif text-sm font-bold text-koma-foreground">Estado atual</h4>
          </div>
          <span className="inline-flex items-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 py-1.5 text-[10px] font-bold text-koma-muted shadow-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Atualização automática
          </span>
        </div>

        {error && (
          <div role="alert" className="rounded-2xl koma-badge-danger px-4 py-3 text-xs">
            {error}
          </div>
        )}

        <div className={`rounded-2xl border p-4 sm:p-5 shadow-xs transition ${diagnosticStyle[diagnostic.tone]}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${diagnosticIconStyle[diagnostic.tone]}`}>
                {diagnostic.tone === 'success'
                  ? <CheckCircle2 size={22} />
                  : diagnostic.tone === 'danger'
                    ? <WifiOff size={22} />
                    : diagnostic.tone === 'warning'
                      ? <AlertTriangle size={22} />
                      : <RefreshCw size={22} className={commandRunning ? 'animate-spin' : ''} />}
              </div>

              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                    hasOnlineAgent ? 'koma-badge-success' : 'koma-badge-danger'
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${hasOnlineAgent ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    {hasOnlineAgent ? 'KÔMA Print conectado' : 'KÔMA Print desconectado'}
                  </span>
                  {activePrinterBadge && (
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold ${activePrinterBadge.badgeClass}`}>
                      {activePrinterBadge.label}
                    </span>
                  )}
                  {activePaperWidthMm && activePaperWidthMm > 0 ? (
                    <span className="rounded-full border border-koma-border bg-koma-card/80 px-2 py-0.5 text-[9px] font-bold text-koma-muted">
                      Papel {activePaperWidthMm} mm
                    </span>
                  ) : null}
                </div>

                <strong className="block text-sm sm:text-base font-bold text-koma-foreground truncate">
                  {hasReadyPrinter && firstReady
                    ? `${friendlyPrinterName(firstReady.name)} — Pronta para imprimir`
                    : diagnostic.title}
                </strong>

                <p className="text-[11px] leading-relaxed text-koma-foreground/80 font-medium">
                  {diagnostic.detail}
                </p>

                {actionMessage && (
                  <span className={`mt-2 block text-[11px] font-bold ${
                    actionSuccessful === false
                      ? 'text-rose-700 dark:text-rose-300'
                      : actionSuccessful === true
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-sky-700 dark:text-sky-300'
                  }`}>
                    {actionMessage}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
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
              ) : null}

              {onTestPrint && (
                <button
                  type="button"
                  onClick={() => void onTestPrint()}
                  disabled={testInProgress || !hasDispatchablePrinter}
                  title={
                    hasReadyPrinter
                      ? 'Enviar um cupom real para a impressora pronta'
                      : hasDispatchablePrinter
                        ? 'A impressora Bluetooth será conectada somente durante o envio'
                        : 'Conecte ou configure uma impressora primeiro'
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
      </section>

      {/* 2. Impressoras */}
      <section className="space-y-3 text-left" aria-label="Impressoras disponíveis">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold text-koma-foreground">Impressoras</h3>
            <p className="mt-0.5 text-[10px] text-koma-muted">
              Equipamentos disponíveis para emissão de pedidos e cupons.
            </p>
          </div>
          <span className="rounded-full border border-koma-border bg-koma-raised px-2.5 py-1 text-[9px] font-semibold text-koma-muted">
            {allDetectedPrinters.length} encontrada(s)
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {allDetectedPrinters.length ? (
            allDetectedPrinters.map((printer, index) => {
              const ready = isPrinterReady(printer);
              const badge = getFriendlyTransportBadge(undefined, printer.connection);
              const endpoint = configuredEndpoints.find(item => (
                item.name === printer.name
                || (
                  Boolean(printer.address)
                  && item.address === printer.address
                )
              )) || null;
              const paperWidthMm = Number(endpoint?.options?.paper_width_mm || 0);
              const physicallyPresent = Boolean(
                printer.present === true || printer.available === true
              );
              const statusLabel = ready
                ? 'Pronta para imprimir'
                : physicallyPresent
                  ? 'Impressora encontrada'
                  : 'Desconectada';
              const statusClass = ready
                ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                : physicallyPresent
                  ? 'text-amber-700 dark:text-amber-400 font-semibold'
                  : 'text-koma-muted font-semibold';
              const Icon = printer.connection === 'bluetooth'
                ? Bluetooth
                : printer.connection === 'network'
                  ? Wifi
                  : Usb;

              return (
                <div
                  key={`${printer.agentId}-${printer.uri || printer.name}-${index}`}
                  className="rounded-2xl border border-koma-border bg-koma-panel p-4 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        ready
                          ? 'koma-badge-success'
                          : 'bg-koma-raised text-koma-muted'
                      }`}>
                        <Icon size={16} />
                      </div>
                      <div className="min-w-0">
                        <strong className="block truncate text-xs font-bold text-koma-foreground">
                          {friendlyPrinterName(printer.name)}
                        </strong>
                        <span className={`mt-0.5 block text-[9px] ${statusClass}`}>
                          {statusLabel}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`rounded-full px-2 py-0.5 text-[8px] font-extrabold ${badge.badgeClass}`}>
                        {badge.label}
                      </span>
                      {paperWidthMm > 0 && (
                        <span className="rounded-full border border-koma-border bg-koma-raised px-2 py-0.5 text-[8px] font-bold text-koma-muted">
                          Papel {paperWidthMm} mm
                        </span>
                      )}
                      {printer.is_default && (
                        <span className="rounded-full koma-badge-success px-2 py-0.5 text-[8px] font-extrabold">
                          Impressora principal
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 text-[10px] text-koma-muted">
                    {ready
                      ? 'O KÔMA pode usar esta impressora nos pedidos.'
                      : isPrinterDispatchable(printer)
                        ? 'Configurada. O Bluetooth conecta somente durante a impressão.'
                        : 'Esta impressora não está disponível agora.'}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="md:col-span-2 rounded-2xl border-2 border-dashed border-koma-border bg-koma-raised/40 px-5 py-8 text-center">
              <Printer size={24} className="mx-auto text-koma-muted" />
              <strong className="mt-3 block text-xs font-bold text-koma-foreground">
                Desconectada
              </strong>
              <span className="mt-1 block text-[10px] text-koma-muted">
                Nenhuma impressora encontrada neste computador.
              </span>
              <span className="mt-4 inline-flex items-center gap-2 text-[10px] font-semibold text-koma-muted">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                Aguardando uma impressora · atualização automática
              </span>
            </div>
          )}
        </div>
      </section>

      {/* 3 & 4. Cupom e Delivery (injetados via children) */}
      {typeof children === 'function' ? children({ activePaperWidthMm }) : children}

      {/* 5. Problemas de impressão (somente se houver) */}
      {(hasPrintingProblems || queueTotal > 0) && (
        <section className="space-y-3 text-left" aria-label="Problemas de impressão">
          {hasPrintingProblems && (
            <div className="rounded-2xl border border-rose-400/80 bg-rose-50 dark:bg-rose-950/25 p-4 sm:p-5 text-rose-950 dark:text-rose-200 shadow-xs">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-900 dark:text-rose-300">
                    <AlertTriangle size={20} />
                  </div>
                  <div>
                    <strong className="block text-sm font-bold text-koma-foreground">
                      {attentionJobsCount} {attentionJobsCount === 1 ? 'impressão precisa' : 'impressões precisam'} de atenção
                    </strong>
                    <span className="block text-[11px] text-koma-foreground/80 font-medium">
                      {failedJobs.length > 0 && `${failedJobs.length} com falha no envio`}
                      {failedJobs.length > 0 && delayedJobsCount > 0 && ' · '}
                      {delayedJobsCount > 0 && `${delayedJobsCount} aguardando há mais de 2 minutos`}
                    </span>
                  </div>
                </div>

                {failedJobs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleRetryFailedJobs()}
                    disabled={Boolean(reprintingId)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl koma-btn-danger px-4 py-2 text-xs font-bold transition cursor-pointer disabled:opacity-50 shadow-xs"
                    id="btn-retry-failed-print-jobs"
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span>Recuperar impressões</span>
                  </button>
                )}
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
                  attentionJobsCount > 0
                    ? 'koma-badge-danger'
                    : queueTotal > 0
                      ? 'koma-badge-warning'
                      : 'koma-badge-success'
                }`}>
                  <Clock3 size={15} />
                </span>
                <span>
                  <strong className="block text-xs font-bold text-koma-foreground">
                    Fila de impressão {queueTotal > 0 ? `(${queueTotal})` : ''}
                  </strong>
                  <span className="block text-[10px] font-normal text-koma-muted">
                    {queueTotal > 0
                      ? `${queueTotal} aguardando · mais antiga ${formatAge(monitorData?.summary.oldest_unresolved_seconds ?? null)} · mais antiga primeiro`
                      : 'Nenhum trabalho aguardando'}
                    {queueOriginSummary ? ` · ${queueOriginSummary}` : ''}
                    {failedJobs.length > 0 ? ` · ${failedJobs.length} com falha` : ''}
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
                              {friendlyQueueOrigin(job)} · {friendlyDocumentType(job.document_type)} · {job.destination} · aguardando {formatAge(job.age_seconds)}
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
        </section>
      )}

      {/* 6. Histórico recente [recolhido por padrão] */}
      <div className="overflow-hidden rounded-2xl border border-koma-border shadow-xs">
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

      {/* 7. Testes avançados [recolhido por padrão] */}
      {advancedTestsSlot}

      {/* 8. Diagnóstico técnico e suporte [recolhido por padrão] */}
      <div className="overflow-hidden rounded-2xl border border-koma-border shadow-xs">
        <button
          type="button"
          onClick={() => setShowDiagnostics(current => !current)}
          className="flex min-h-11 w-full items-center justify-between gap-2 bg-koma-card px-4 py-2.5 text-[10px] font-bold text-koma-secondary transition hover:bg-koma-raised cursor-pointer"
          aria-expanded={showDiagnostics}
        >
          <span className="flex items-center gap-2">
            <Wrench size={14} />
            Diagnóstico técnico e suporte
            <span className="text-[9px] font-normal text-koma-muted">
              transporte, endpoints, SPP, CUPS, spooler e rede
            </span>
          </span>
          {showDiagnostics ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {showDiagnostics && (
          <div className="space-y-4 border-t border-koma-border bg-koma-panel p-4 text-left">
            <div>
              <h4 className="text-xs font-bold text-koma-foreground">
                Destinos e rotas de impressão
              </h4>
              <p className="mt-0.5 text-[10px] text-koma-muted">
                Rotas lógicas mapeadas para impressoras USB, Bluetooth, rede ou spooler do sistema.
              </p>
              {Object.keys(configuredDestinations).length > 0 && (
                <div className="mt-3 rounded-xl border border-koma-border bg-koma-card p-3">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-koma-muted">
                    Rotas ativas
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(configuredDestinations).map(([destination, endpointId]) => {
                      const endpoint = configuredEndpoints.find(
                        item => item.id === endpointId || item.name === endpointId
                      );
                      return (
                        <span
                          key={destination}
                          className="rounded-lg border border-koma-border px-2 py-1 text-[9px] text-koma-secondary"
                        >
                          {destination} → {endpoint?.display_name || endpoint?.name || endpointId}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {configuredEndpoints.length > 0 && (
                <div className="mt-3 space-y-2">
                  {configuredEndpoints.map(ep => {
                    const badge = getTransportBadge(ep.transport);
                    return (
                      <div key={ep.id} className="flex items-center justify-between rounded-xl border border-koma-border bg-koma-card p-2 text-xs">
                        <div>
                          <span className="font-bold text-koma-foreground">{ep.name}</span>
                          {ep.address && (
                            <span className="ml-2 font-mono text-[10px] text-koma-muted">({ep.address})</span>
                          )}
                          <span className="ml-2 text-[9px] text-koma-subtle font-mono">id: {ep.id}</span>
                          {Number(ep.options?.paper_width_mm || 0) > 0 && (
                            <span className="ml-2 text-[9px] text-koma-muted">
                              {String(ep.options?.paper_width_mm)} mm · {String(ep.options?.columns || '?')} col.
                            </span>
                          )}
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[8px] font-extrabold ${badge.badgeClass}`}>
                          {badge.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {bluetoothPrinters.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-koma-foreground">
                  Impressoras Bluetooth (SPP)
                </h4>
                <p className="mt-0.5 text-[10px] text-koma-muted">
                  Conexão sem fio direta via RFCOMM sob demanda, sem necessidade de fila CUPS no sistema.
                </p>
                <div className="mt-2 space-y-2">
                  {bluetoothPrinters.map((printer, i) => (
                    <div key={`bt-diag-${i}`} className="rounded-xl border border-koma-border bg-koma-card p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{printer.name}</span>
                        <span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold koma-badge-info">
                          Bluetooth SPP
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[9px] text-koma-muted space-x-2">
                        {printer.address && <span>MAC: {printer.address}</span>}
                        <span>Pareada: {printer.paired ? 'sim' : 'não'}</span>
                        <span>SPP: {printer.spp !== false ? 'sim' : 'não'}</span>
                        {printer.cups_queue && <span>CUPS: {printer.cups_queue}</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => void requestBluetoothTest(printer.agentId, printer)}
                        disabled={commandRunning || Boolean(pendingCommandId) || !printer.supportsBluetoothTest || !printer.paired}
                        className="mt-2 inline-flex min-h-8 items-center gap-2 rounded-lg border border-koma-border px-2.5 py-1 text-[9px] font-bold disabled:opacity-50"
                      >
                        <Printer size={11} />
                        Testar esta impressora
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {networkPrinters.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-koma-foreground">
                  Impressoras de rede (TCP / IP)
                </h4>
                <p className="mt-0.5 text-[10px] text-koma-muted">
                  Impressoras conectadas via cabo de rede Ethernet ou Wi-Fi por socket direto.
                </p>
                <div className="mt-2 space-y-2">
                  {networkPrinters.map((printer, i) => (
                    <div key={`net-diag-${i}`} className="rounded-xl border border-koma-border bg-koma-card p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{printer.name}</span>
                        <span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold koma-badge-info">
                          Rede TCP
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[9px] text-koma-muted space-x-2">
                        {printer.address && <span>Endereço: {printer.address}</span>}
                        <span>Disponível: {printer.available ? 'sim' : 'não'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className="text-xs font-bold text-koma-foreground">
                Spooler e CUPS do sistema operacional
              </h4>
              <p className="mt-0.5 text-[10px] text-koma-muted">
                Filas locais gerenciadas pelo CUPS (Linux/macOS) ou Spooler (Windows).
              </p>
              {hasUsbCommandAgent && (
                <button
                  type="button"
                  onClick={() => void requestUsbConnection()}
                  disabled={commandRunning || Boolean(pendingCommandId)}
                  className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-koma-border bg-koma-card px-3 py-2 text-[10px] font-bold text-koma-foreground disabled:opacity-50"
                >
                  <Usb size={13} />
                  Preparar conexão USB
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
