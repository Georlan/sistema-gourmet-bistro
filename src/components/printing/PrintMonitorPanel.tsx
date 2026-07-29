import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  Printer,
  RefreshCw,
  RotateCcw,
  Wifi,
  WifiOff
} from 'lucide-react';

interface PrintAgentHealth {
  agent_id: string;
  online: boolean;
  last_seen_at: string | null;
  seconds_since_heartbeat: number | null;
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
  online_threshold_seconds: number;
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
  spooler_accepted: 'Aceito pelo sistema',
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
    return 'Padrão do sistema';
  }
  return value;
}

export function PrintMonitorPanel({
  apiBaseUrl,
  authHeaders,
  onTestPrint,
  testInProgress = false
}: PrintMonitorPanelProps) {
  const [monitor, setMonitor] = useState<PrintMonitorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reprintingId, setReprintingId] = useState<string | null>(null);

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
      setMonitor(data as PrintMonitorResponse);
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
      void loadMonitor(false);
    }, 15_000);
    const refreshFromPrintTest = () => {
      void loadMonitor(false);
    };
    window.addEventListener(
      'koma_print_monitor_refresh',
      refreshFromPrintTest
    );
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(
        'koma_print_monitor_refresh',
        refreshFromPrintTest
      );
    };
  }, [loadMonitor]);

  const queueTotal = useMemo(() => {
    if (!monitor) return 0;
    return (
      monitor.summary.pending
      + monitor.summary.claimed
      + monitor.summary.printing
    );
  }, [monitor]);

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
      await loadMonitor(false);
    } catch (requestError) {
      window.alert(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível solicitar a reimpressão.'
      );
    } finally {
      setReprintingId(null);
    }
  };

  const hasOnlineAgent = Boolean(monitor?.summary.online_agents);
  const latestJob = monitor?.jobs[0] || null;
  const diagnostic = useMemo<{
    tone: DiagnosticTone;
    title: string;
    detail: string;
  }>(() => {
    if (!monitor) {
      return {
        tone: 'neutral',
        title: 'Consultando a impressão…',
        detail: 'Aguarde a leitura do conector e da fila.'
      };
    }
    if (!hasOnlineAgent) {
      return {
        tone: 'danger',
        title: 'Impressão desconectada',
        detail: 'Abra o Kôma Print neste computador antes de enviar pedidos.'
      };
    }
    if (monitor.summary.delayed > 0) {
      return {
        tone: 'warning',
        title: 'Impressão precisa de atenção',
        detail: `${monitor.summary.delayed} trabalho(s) aguardam há mais de 2 minutos.`
      };
    }
    if (latestJob?.status === 'failed') {
      return {
        tone: 'danger',
        title: 'Último envio falhou',
        detail: latestJob.last_error || 'Confira a impressora e envie um teste.'
      };
    }
    if (queueTotal > 0) {
      return {
        tone: 'neutral',
        title: 'Impressão em andamento',
        detail: `${queueTotal} trabalho(s) sendo processado(s) pelo conector.`
      };
    }
    if (monitor.latest_spooler_success) {
      const success = monitor.latest_spooler_success;
      return {
        tone: 'success',
        title: 'Conector pronto para enviar',
        detail: `Último envio aceito pelo sistema há ${formatAge(success.age_seconds)} · ${friendlyPrinterName(success.printer_name)}.`
      };
    }
    return {
      tone: 'warning',
      title: 'Conector online; impressora ainda não confirmada',
      detail: 'Envie um teste para validar a impressora configurada no computador.'
    };
  }, [hasOnlineAgent, latestJob, monitor, queueTotal]);

  const diagnosticStyle: Record<DiagnosticTone, string> = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    danger: 'border-red-500/30 bg-red-500/10 text-red-100',
    neutral: 'border-sky-500/30 bg-sky-500/10 text-sky-100'
  };

  return (
    <section className="lg:col-span-3 bg-[#121214] border border-[#27272A] rounded-3xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#27272A] pb-3">
        <div>
          <div className="flex items-center gap-2 text-gray-200 font-bold">
            <Printer size={16} className="text-emerald-400" />
            Monitor de impressão
          </div>
          <p className="text-[9px] text-gray-500 mt-1">
            Atualização automática a cada 15 segundos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMonitor(true)}
          disabled={loading}
          className="px-3 py-2 rounded-xl border border-[#27272A] bg-[#1C1C1F] text-[9px] font-bold text-gray-300 hover:text-white disabled:opacity-50 flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-300"
        >
          {error}
        </div>
      )}

      {!error && (
        <div className={`rounded-2xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${diagnosticStyle[diagnostic.tone]}`}>
          <div className="flex items-start gap-3 min-w-0">
            {diagnostic.tone === 'success'
              ? <CheckCircle2 size={18} className="text-emerald-300 shrink-0 mt-0.5" />
              : diagnostic.tone === 'danger'
                ? <WifiOff size={18} className="text-red-300 shrink-0 mt-0.5" />
                : <AlertTriangle size={18} className="shrink-0 mt-0.5" />}
            <div className="min-w-0">
              <strong className="block text-[11px]">{diagnostic.title}</strong>
              <span className="block text-[9px] opacity-75 mt-0.5">
                {diagnostic.detail}
              </span>
            </div>
          </div>
          {onTestPrint && (
            <button
              type="button"
              onClick={() => void onTestPrint()}
              disabled={testInProgress || !hasOnlineAgent}
              className="shrink-0 rounded-xl border border-current/20 bg-black/20 px-3 py-2 text-[9px] font-bold hover:bg-black/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
            >
              <Printer size={12} />
              {testInProgress ? 'Enviando…' : 'Testar impressão'}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="rounded-2xl border border-[#27272A] bg-[#09090B] p-3">
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-gray-500">
            {hasOnlineAgent
              ? <Wifi size={12} className="text-emerald-400" />
              : <WifiOff size={12} className="text-red-400" />}
            Conector
          </div>
          <strong className={hasOnlineAgent ? 'text-emerald-300' : 'text-red-300'}>
            {hasOnlineAgent ? 'Online' : 'Offline'}
          </strong>
        </div>
        <div className="rounded-2xl border border-[#27272A] bg-[#09090B] p-3">
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-gray-500">
            <Clock3 size={12} />
            Fila
          </div>
          <strong className="text-white">{queueTotal}</strong>
        </div>
        <div className="rounded-2xl border border-[#27272A] bg-[#09090B] p-3">
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-gray-500">
            <AlertTriangle size={12} />
            Atrasados
          </div>
          <strong className={monitor?.summary.delayed ? 'text-amber-300' : 'text-white'}>
            {monitor?.summary.delayed ?? 0}
          </strong>
        </div>
        <div className="rounded-2xl border border-[#27272A] bg-[#09090B] p-3">
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-gray-500">
            <AlertTriangle size={12} />
            Falhas
          </div>
          <strong className={monitor?.summary.failed ? 'text-red-300' : 'text-white'}>
            {monitor?.summary.failed ?? 0}
          </strong>
        </div>
      </div>

      {monitor && monitor.summary.delayed > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-300 shrink-0 mt-0.5" />
          <div>
            <strong className="block text-[10px] text-amber-200">
              Impressão aguardando há mais de 2 minutos
            </strong>
            <span className="text-[9px] text-amber-100/70">
              Confirme se o agente e a impressora estão ligados. Espera mais antiga: {formatAge(monitor.summary.oldest_unresolved_seconds)}.
            </span>
          </div>
        </div>
      )}

      <div>
        <div className="text-[8px] uppercase tracking-wider text-gray-500 mb-2">
          Computadores com o Kôma Print — não são impressoras
        </div>
        <div className="flex flex-wrap gap-2">
          {monitor?.agents.length ? monitor.agents.map((agent, index) => (
            <div
              key={agent.agent_id}
              title={`Identificador técnico: ${agent.agent_id}`}
              className={`rounded-xl border px-3 py-2 text-[9px] ${
                agent.online
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-500/25 bg-red-500/10 text-red-200'
              }`}
            >
              <strong>Computador {index + 1}</strong>
              <span className="block opacity-70">
                {agent.online ? 'conectado' : `sem contato há ${formatAge(agent.seconds_since_heartbeat)}`}
              </span>
            </div>
          )) : (
            <div className="text-[9px] text-gray-500">
              Nenhum computador com o Kôma Print cadastrado para este restaurante.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-[#27272A] overflow-hidden">
        <div className="px-3 py-2 bg-[#1C1C1F] flex items-center gap-2 text-[10px] font-bold text-gray-300">
          <History size={13} />
          Histórico recente
        </div>
        <div className="max-h-80 overflow-auto">
          {monitor?.jobs.length ? (
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-[#121214] text-[8px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2">Referência</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 hidden md:table-cell">Impressora</th>
                  <th className="px-3 py-2">Horário</th>
                  <th className="px-3 py-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272A]">
                {monitor.jobs.map(job => {
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
                        {job.accepted_by_spooler && (
                          <span className="block text-[7px] text-gray-500 mt-1">
                            sem confirmação física
                          </span>
                        )}
                        {job.last_error && (
                          <span title={job.last_error} className="block max-w-40 truncate text-[7px] text-red-300 mt-1">
                            {job.last_error}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 hidden md:table-cell text-[8px] text-gray-400">
                        {friendlyPrinterName(job.printer_name)}
                      </td>
                      <td className="px-3 py-2 text-[8px] text-gray-400 whitespace-nowrap">
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
                            className="inline-flex items-center gap-1 rounded-lg border border-[#27272A] px-2 py-1 text-[8px] font-bold text-gray-300 hover:text-white disabled:opacity-50 cursor-pointer"
                          >
                            {reprintingId === job.id
                              ? <RefreshCw size={10} className="animate-spin" />
                              : <RotateCcw size={10} />}
                            Reimprimir
                          </button>
                        ) : job.accepted_by_spooler ? (
                          <CheckCircle2 size={13} className="text-emerald-400 ml-auto" />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-5 text-center text-[9px] text-gray-500">
              Nenhum trabalho de impressão registrado.
            </div>
          )}
        </div>
      </div>

      <p className="text-[8px] text-gray-500 leading-relaxed">
        “Aceito pelo sistema” significa que o CUPS ou o Spooler do Windows recebeu o trabalho. Impressoras térmicas comuns não confirmam de forma confiável se o papel saiu; por isso o Kôma não apresenta essa etapa como conclusão física.
      </p>
    </section>
  );
}
