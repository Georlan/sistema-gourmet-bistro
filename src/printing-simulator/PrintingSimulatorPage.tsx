import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  Clock3,
  Cpu,
  FileText,
  Gauge,
  Loader2,
  Printer,
  RefreshCw,
  TerminalSquare,
  Unplug,
} from "lucide-react";

import { API_BASE_URL } from "../config/api";
import { getSuperAdminToken } from "../super-admin/superAdminApi";
import { getOperatorSession } from "../utils/authSession";

type SourceSummary = {
  id: string;
  reference: string;
  document_type: string;
  destination: string;
  source_type: string;
  source_id: string;
  status: string;
  created_at: string | null;
};

type SourceDetail = SourceSummary & {
  payload_text: string;
  claimed_at: string | null;
  printed_at: string | null;
  queue_latency_ms: number | null;
  physical_completion_tracking: false;
  server_observed_latency_ms?: number | null;
};

type MonitorPayload = {
  summary?: {
    online_agents?: number;
    ready_printers?: number;
    printer_ready?: boolean;
  };
};

type BridgeHealth = {
  status: "ready";
  service: string;
  protocol: string;
  encoding: string;
  adapter: string;
  platform: string;
  transport: {
    kind: "virtual";
    physical_usb_write: false;
    physical_printer_required: false;
  };
};

type PaperRun = {
  text: string;
  font: "A" | "B";
  bold: boolean;
  double_height: boolean;
  line_spacing_dots: number | null;
};

type SimulatorResult = {
  protocol: string;
  encoding: string;
  payload_characters: number;
  raw_byte_count: number;
  raw_hex: string;
  agent_render_ms: number;
  physical_print_time_ms: null;
  physical_completion_tracking: false;
  lines: Array<{ runs: PaperRun[] }>;
  commands: Array<{
    offset: number;
    hex: string;
    name: string;
    detail: string;
  }>;
  unknown_commands: Array<{
    offset: number;
    hex: string;
    name: string;
    detail: string;
  }>;
};

type StageError = {
  stage: string;
  message: string;
};

type AutoSimulationObserved = {
  server_observed_latency_ms: number | null;
  feed_request_ms: number;
  virtual_ready_upper_bound_ms: number | null;
};

type AutoSimulationEvent = {
  job: SourceDetail;
  simulation: SimulatorResult;
  observed: AutoSimulationObserved;
  simulated_at: string;
};

type AutoSimulationStatus = {
  enabled: boolean;
  mode: "shadow";
  started_at: string | null;
  processed_count: number;
  cursor: { created_at: string; id: string } | null;
  last_event: AutoSimulationEvent | null;
  last_error: StageError | null;
  authoritative_queue_mutation: false;
  physical_usb_write: false;
};


const AGENT_PORTS = Array.from({ length: 11 }, (_, index) => 17654 + index);
const SUPPORT_SESSION_STORAGE_KEY = "koma_support_session";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body?.detail
      || body?.error?.message
      || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

async function probePort(port: number): Promise<{ port: number; health: BridgeHealth }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 450);
  try {
    const health = await fetchJson<BridgeHealth>(
      `http://127.0.0.1:${port}/simulator/health`,
      { signal: controller.signal, cache: "no-store" },
    );
    if (health.service !== "koma-print-simulator" || health.status !== "ready") {
      throw new Error("Serviço local incompatível.");
    }
    return { port, health };
  } finally {
    window.clearTimeout(timer);
  }
}

async function findLocalBridge(): Promise<{ port: number; health: BridgeHealth }> {
  const probes = AGENT_PORTS.map((port) => probePort(port));
  if (typeof Promise.any === "function") {
    return Promise.any(probes);
  }

  const settled = await Promise.allSettled(probes);
  const match = settled.find(
    (item): item is PromiseFulfilledResult<{ port: number; health: BridgeHealth }> =>
      item.status === "fulfilled",
  );
  if (!match) throw new Error("Ponte local do Kôma Print não encontrada.");
  return match.value;
}

function Badge({
  ok,
  children,
}: {
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={[
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]",
      ok
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
        : "border-amber-500/30 bg-amber-500/10 text-amber-200",
    ].join(" ")}>
      {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      {children}
    </span>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-koma-muted">{label}</p>
      <p className="mt-1 font-mono text-sm font-bold text-koma-foreground">{value}</p>
      {detail ? <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">{detail}</p> : null}
    </div>
  );
}

export default function PrintingSimulatorPage() {
  const session = useMemo(() => getOperatorSession("caixa"), []);
  const superAdminToken = useMemo(() => getSuperAdminToken(), []);
  const supportSessionActive = useMemo(() => {
    try {
      return Boolean(window.sessionStorage.getItem(SUPPORT_SESSION_STORAGE_KEY));
    } catch {
      return false;
    }
  }, []);
  const internalAccess = Boolean(session?.token && superAdminToken && supportSessionActive);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [monitor, setMonitor] = useState<MonitorPayload | null>(null);
  const [payloadText, setPayloadText] = useState("");
  const [bridge, setBridge] = useState<{ port: number; health: BridgeHealth } | null>(null);
  const [result, setResult] = useState<SimulatorResult | null>(null);
  const [roundtripMs, setRoundtripMs] = useState<number | null>(null);
  const [loadingSources, setLoadingSources] = useState(false);
  const [probing, setProbing] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [autoStatus, setAutoStatus] = useState<AutoSimulationStatus | null>(null);
  const [autoControlBusy, setAutoControlBusy] = useState(false);
  const [error, setError] = useState<StageError | null>(null);
  const lastAutoJobIdRef = useRef<string | null>(null);

  const authHeaders = useMemo(
    () => session?.token ? { Authorization: `Bearer ${session.token}` } : null,
    [session?.token],
  );

  const loadSource = useCallback(async (jobId: string) => {
    if (!authHeaders) return;
    setError(null);
    try {
      const detail = await fetchJson<SourceDetail>(
        `${API_BASE_URL}/api/print-agents/simulator/sources/${encodeURIComponent(jobId)}`,
        { headers: authHeaders },
      );
      setSource(detail);
      setPayloadText(detail.payload_text);
      setResult(null);
      setRoundtripMs(null);
    } catch (reason) {
      setError({
        stage: "backend_source",
        message: reason instanceof Error ? reason.message : "Falha ao carregar o PrintJob.",
      });
    }
  }, [authHeaders]);

  const refreshBackend = useCallback(async () => {
    if (!authHeaders) return;
    setLoadingSources(true);
    setError(null);
    try {
      const [sourcePayload, monitorPayload] = await Promise.all([
        fetchJson<{ items: SourceSummary[] }>(
          `${API_BASE_URL}/api/print-agents/simulator/sources?limit=20`,
          { headers: authHeaders },
        ),
        fetchJson<MonitorPayload>(
          `${API_BASE_URL}/api/print-agents/monitor`,
          { headers: authHeaders },
        ),
      ]);
      setSources(sourcePayload.items);
      setMonitor(monitorPayload);
      if (!source && sourcePayload.items.length > 0) {
        await loadSource(sourcePayload.items[0].id);
      }
    } catch (reason) {
      setError({
        stage: "backend_connection",
        message: reason instanceof Error ? reason.message : "Falha ao consultar o backend do restaurante.",
      });
    } finally {
      setLoadingSources(false);
    }
  }, [authHeaders, loadSource, source]);

  const probeBridge = useCallback(async () => {
    setProbing(true);
    setError(null);
    try {
      setBridge(await findLocalBridge());
    } catch (reason) {
      setBridge(null);
      setError({
        stage: "agent_bridge_connection",
        message: reason instanceof Error
          ? reason.message
          : "Kôma Print local não encontrado nas portas autorizadas. Atualize o agente para 2026.09.20.1 ou superior e reinicie o serviço.",
      });
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    if (!internalAccess) return;
    void refreshBackend();
    void probeBridge();
  }, [internalAccess, probeBridge, refreshBackend]);

  useEffect(() => {
    if (!bridge) {
      setAutoStatus(null);
      return;
    }

    let disposed = false;
    const poll = async () => {
      try {
        const status = await fetchJson<AutoSimulationStatus>(
          `http://127.0.0.1:${bridge.port}/simulator/auto/status`,
          { cache: "no-store" },
        );
        if (disposed) return;
        setAutoStatus(status);

        const event = status.last_event;
        if (!event || lastAutoJobIdRef.current === event.job.id) return;
        lastAutoJobIdRef.current = event.job.id;
        setSource(event.job);
        setPayloadText(event.job.payload_text);
        setResult(event.simulation);
        setRoundtripMs(null);
        setSources((current) => {
          const summary: SourceSummary = {
            id: event.job.id,
            reference: event.job.reference,
            document_type: event.job.document_type,
            destination: event.job.destination,
            source_type: event.job.source_type,
            source_id: event.job.source_id,
            status: event.job.status,
            created_at: event.job.created_at,
          };
          return [summary, ...current.filter((item) => item.id !== summary.id)].slice(0, 20);
        });
      } catch {
        if (!disposed) setAutoStatus(null);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), 600);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [bridge]);

  const toggleAutoSimulation = async () => {
    if (!bridge || autoControlBusy) return;
    setAutoControlBusy(true);
    setError(null);
    try {
      const action = autoStatus?.enabled ? "stop" : "start";
      const status = await fetchJson<AutoSimulationStatus>(
        `http://127.0.0.1:${bridge.port}/simulator/auto/${action}`,
        { method: "POST" },
      );
      lastAutoJobIdRef.current = null;
      setAutoStatus(status);
      if (action === "start") {
        setRoundtripMs(null);
      }
    } catch (reason) {
      setError({
        stage: "auto_simulation_control",
        message: reason instanceof Error
          ? reason.message
          : "Não foi possível alterar a simulação automática.",
      });
    } finally {
      setAutoControlBusy(false);
    }
  };

  const simulate = async () => {
    if (!bridge) {
      setError({
        stage: "agent_bridge_connection",
        message: "A ponte local não está disponível. Use o Kôma Print 2026.09.20.1 ou superior antes de simular.",
      });
      return;
    }
    if (!payloadText) {
      setError({
        stage: "request_validation",
        message: "Carregue um PrintJob real ou informe um payload técnico.",
      });
      return;
    }

    setRendering(true);
    setError(null);
    const started = performance.now();
    try {
      const response = await fetch(
        `http://127.0.0.1:${bridge.port}/simulator/render`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload_text: payloadText }),
        },
      );
      const body = await response.json().catch(() => null);
      const elapsed = performance.now() - started;
      setRoundtripMs(Math.round(elapsed * 1000) / 1000);
      if (!response.ok) {
        throw {
          stage: body?.error?.stage || "agent_render",
          message: body?.error?.message || `HTTP ${response.status}`,
        };
      }
      setResult(body as SimulatorResult);
    } catch (reason: any) {
      if (reason?.stage && reason?.message) {
        setError(reason as StageError);
      } else {
        setError({
          stage: "agent_render",
          message: reason instanceof Error
            ? reason.message
            : "Falha ao conversar com o simulador local.",
        });
      }
    } finally {
      setRendering(false);
    }
  };

  if (!internalAccess) {
    return (
      <main className="min-h-dvh bg-koma-page px-6 py-16 text-koma-foreground">
        <div className="mx-auto max-w-xl rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
          <AlertTriangle className="mb-4 text-amber-300" />
          <h1 className="font-serif text-2xl font-black">Simulador térmico interno</h1>
          <p className="mt-3 text-sm leading-relaxed text-koma-muted">
            Esta bancada não faz parte das ferramentas do restaurante. O acesso exige uma
            sessão de Super Admin e um Modo Suporte auditado ativo para o tenant que será inspecionado.
          </p>
          <a href="/super-admin" className="mt-5 inline-flex rounded-xl bg-koma-accent px-4 py-2 text-xs font-bold text-black">
            Abrir Super Admin
          </a>
        </div>
      </main>
    );
  }

  const physicalReady = monitor?.summary?.printer_ready === true;
  const autoEvent = autoStatus?.last_event || null;
  const autoObserved = autoEvent?.observed || null;

  return (
    <main className="min-h-dvh bg-koma-page text-koma-foreground">
      <header className="border-b border-white/10 bg-black/20">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-koma-accent">Ferramenta de engenharia</p>
            <h1 className="mt-1 font-serif text-2xl font-black">Simulador térmico ESC/POS</h1>
            <p className="mt-1 max-w-3xl text-xs text-koma-muted">
              Preview derivado dos bytes que o Kôma Print enviaria ao spooler/USB.
              Nenhum comando desta página é enviado à impressora física.
            </p>
          </div>
          <a href="/super-admin" className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold hover:bg-white/5">
            Voltar ao Super Admin
          </a>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] gap-4 px-4 py-5 sm:px-8 xl:grid-cols-[360px_minmax(420px,1fr)_minmax(420px,1.15fr)]">
        <section className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.13em]">
                <Cable size={16} /> Conexões reais
              </h2>
              <button
                type="button"
                onClick={() => { void refreshBackend(); void probeBridge(); }}
                className="rounded-lg border border-white/10 p-2 text-koma-muted hover:text-koma-foreground"
                aria-label="Atualizar conexões"
              >
                {(loadingSources || probing) ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span>Backend do restaurante</span>
                <Badge ok={Boolean(monitor)}> {monitor ? "conectado" : "indisponível"} </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Kôma Print local</span>
                <Badge ok={Boolean(bridge)}> {bridge ? `porta ${bridge.port}` : "não encontrado"} </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Impressora física</span>
                <Badge ok={physicalReady}> {physicalReady ? "pronta" : "não pronta"} </Badge>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-[10px] leading-relaxed text-sky-100/80">
              <strong>Transporte do simulador:</strong> ESC/POS RAW virtual. A ponte local
              deliberadamente não escreve em CUPS, Spooler ou <code>/dev/usb/lp*</code>.
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.13em]">
                  <Clock3 size={16} /> Simulação automática
                </h2>
                <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
                  Observa somente PrintJobs criados depois da ativação e renderiza cada um assim que o agente os detectar.
                </p>
              </div>
              <Badge ok={autoStatus?.enabled === true}>
                {autoStatus?.enabled ? "observando" : "parada"}
              </Badge>
            </div>

            <button
              type="button"
              onClick={() => void toggleAutoSimulation()}
              disabled={!bridge || autoControlBusy}
              className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${
                autoStatus?.enabled
                  ? "border border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                  : "bg-koma-accent text-black"
              }`}
            >
              {autoControlBusy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {autoStatus?.enabled ? "Parar observação automática" : "Observar novos pedidos automaticamente"}
            </button>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <span className="block text-koma-muted">Simulados nesta sessão</span>
                <strong className="mt-1 block font-mono text-sm">{autoStatus?.processed_count ?? 0}</strong>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <span className="block text-koma-muted">Último observado</span>
                <strong className="mt-1 block truncate text-xs">{autoEvent?.job.reference || "—"}</strong>
              </div>
            </div>

            {autoStatus?.last_error ? (
              <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[10px] text-rose-200">
                {autoStatus.last_error.stage}: {autoStatus.last_error.message}
              </p>
            ) : null}

            <p className="mt-3 text-[10px] leading-relaxed text-koma-muted">
              Modo sombra: não faz claim, não altera o status do PrintJob e não confirma impressão.
              O backlog anterior à ativação é ignorado. Requer Kôma Print 2026.09.20.2+.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.13em]">
              <FileText size={16} /> Fonte do cupom
            </h2>
            <label className="mt-4 block text-[10px] font-bold uppercase tracking-[0.12em] text-koma-muted">
              PrintJob recente
            </label>
            <select
              value={source?.id || ""}
              onChange={(event) => void loadSource(event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-koma-page px-3 py-2 text-xs"
            >
              <option value="">Payload manual</option>
              {sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.reference} · {item.status} · {item.destination}
                </option>
              ))}
            </select>

            {source ? (
              <dl className="mt-4 grid grid-cols-2 gap-2 text-[10px]">
                <div><dt className="text-koma-muted">Job</dt><dd className="font-mono">{source.id}</dd></div>
                <div><dt className="text-koma-muted">Status</dt><dd>{source.status}</dd></div>
                <div><dt className="text-koma-muted">Documento</dt><dd>{source.document_type}</dd></div>
                <div><dt className="text-koma-muted">Destino</dt><dd>{source.destination}</dd></div>
                <div className="col-span-2"><dt className="text-koma-muted">Criado</dt><dd>{formatDate(source.created_at)}</dd></div>
              </dl>
            ) : null}

            <label className="mt-4 block text-[10px] font-bold uppercase tracking-[0.12em] text-koma-muted">
              Payload técnico
            </label>
            <textarea
              value={payloadText}
              onChange={(event) => {
                setPayloadText(event.target.value);
                setResult(null);
              }}
              spellCheck={false}
              className="mt-2 min-h-64 w-full resize-y rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-relaxed outline-none focus:border-koma-accent/60"
              placeholder="Carregue um PrintJob real acima ou cole o payload_text técnico."
            />

            <button
              type="button"
              onClick={() => void simulate()}
              disabled={rendering || !bridge || !payloadText}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-koma-accent px-4 py-3 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {rendering ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
              Simular bytes que seriam enviados
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.13em]">
                <Printer size={16} /> Papel virtual
              </h2>
              {result ? <Badge ok={result.unknown_commands.length === 0}>
                {result.unknown_commands.length === 0 ? "comandos reconhecidos" : "há comandos desconhecidos"}
              </Badge> : null}
            </div>

            <div className="mt-4 flex justify-center rounded-xl bg-zinc-950/50 p-4 sm:p-6">
              <div className="min-h-[520px] w-full max-w-[430px] overflow-x-auto bg-[#f7f4ea] px-5 py-6 text-zinc-950 shadow-2xl">
                {result ? (
                  <div className="font-mono text-[12px] leading-5">
                    {result.lines.map((line, lineIndex) => (
                      <div key={lineIndex} className="min-h-5 whitespace-pre">
                        {line.runs.map((run, runIndex) => (
                          <span
                            key={runIndex}
                            className={[
                              run.bold ? "font-black" : "font-normal",
                              run.double_height ? "inline-block origin-left scale-y-[2] my-2" : "",
                            ].join(" ")}
                            title={`Fonte ${run.font}${run.line_spacing_dots == null ? "" : ` · ESC 3 ${run.line_spacing_dots} dots`}`}
                          >
                            {run.text}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[470px] items-center justify-center text-center text-xs text-zinc-500">
                    A bobina aparece depois que o agente local converter um payload real.
                  </div>
                )}
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-koma-muted">
              O simulador representa texto, negrito, altura dupla, fonte selecionada, quebras e corte.
              Dimensões físicas, velocidade do motor e avanço real do papel dependem do modelo da impressora
              e não são inferidos nesta tela.
            </p>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
              <p className="flex items-center gap-2 text-xs font-black text-rose-200">
                <AlertTriangle size={15} /> Falha em: <code>{error.stage}</code>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-rose-100/80">{error.message}</p>
            </div>
          ) : null}
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.13em]">
              <Gauge size={16} /> Medições observadas
            </h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Metric
                label="Conversão no agente"
                value={result ? `${result.agent_render_ms} ms` : "—"}
                detail="perf_counter_ns: build ESC/POS + parser visual local."
              />
              <Metric
                label="Browser ↔ agente local"
                value={roundtripMs == null ? "—" : `${roundtripMs} ms`}
                detail="Preenchido apenas quando você usa o botão manual de simulação."
              />
              {autoObserved ? (
                <>
                  <Metric
                    label="PrintJob → observado"
                    value={autoObserved.server_observed_latency_ms == null ? "—" : `${autoObserved.server_observed_latency_ms} ms`}
                    detail="Relógio do backend: criação do PrintJob até a primeira leitura do feed pelo agente."
                  />
                  <Metric
                    label="Backend ↔ agente"
                    value={`${autoObserved.feed_request_ms} ms`}
                    detail="Roundtrip HTTP real da consulta read-only feita pelo daemon local."
                  />
                  <Metric
                    label="Até papel virtual · limite superior"
                    value={autoObserved.virtual_ready_upper_bound_ms == null ? "—" : `${autoObserved.virtual_ready_upper_bound_ms} ms`}
                    detail="Soma conservadora de observação + roundtrip + render; não é tempo físico da impressora."
                  />
                </>
              ) : null}
              <Metric
                label="Bytes ESC/POS"
                value={result ? String(result.raw_byte_count) : "—"}
                detail="Tamanho exato do payload RAW após init, PC860, feeds e corte."
              />
              <Metric
                label="Espera real na fila"
                value={source?.queue_latency_ms == null ? "—" : `${source.queue_latency_ms} ms`}
                detail="Só aparece quando o PrintJob real possui created_at e claimed_at."
              />
              <Metric
                label="Tempo físico"
                value="não medido"
                detail="O agente atual confirma aceitação pelo spooler, não saída física do papel."
              />
              <Metric
                label="USB físico nesta simulação"
                value="não utilizado"
                detail="A conexão física continua separada e visível no monitor do restaurante."
              />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.13em]">
              <TerminalSquare size={16} /> Comandos ESC/POS
            </h2>
            <div className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[520px] text-left font-mono text-[10px]">
                <thead className="sticky top-0 bg-koma-page">
                  <tr className="text-koma-muted">
                    <th className="p-2">offset</th>
                    <th className="p-2">hex</th>
                    <th className="p-2">comando</th>
                    <th className="p-2">efeito</th>
                  </tr>
                </thead>
                <tbody>
                  {result?.commands.map((command, index) => (
                    <tr key={`${command.offset}-${index}`} className="border-t border-white/5 align-top">
                      <td className="p-2 text-koma-muted">{command.offset}</td>
                      <td className="p-2">{command.hex}</td>
                      <td className="p-2 font-bold text-koma-accent">{command.name}</td>
                      <td className="p-2 font-sans text-koma-muted">{command.detail}</td>
                    </tr>
                  ))}
                  {!result ? (
                    <tr><td colSpan={4} className="p-6 text-center font-sans text-koma-muted">Sem simulação ainda.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.13em]">
              <Cpu size={16} /> RAW
            </h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Metric label="Protocolo" value={result?.protocol || bridge?.health.protocol || "—"} />
              <Metric label="Encoding" value={result?.encoding || bridge?.health.encoding || "—"} />
              <Metric label="Adapter real do agente" value={bridge?.health.adapter || "—"} />
              <Metric label="Plataforma" value={bridge?.health.platform || "—"} />
            </div>
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[9px] leading-relaxed text-koma-muted">
              {result?.raw_hex || "Os bytes RAW aparecem aqui após a simulação."}
            </pre>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-[10px] leading-relaxed text-koma-muted">
            <p className="flex items-start gap-2"><Clock3 size={14} className="mt-0.5 shrink-0" />
              Nenhum valor de velocidade de impressão, corte ou avanço é estimado. Para medir essa parte,
              é necessário instrumentar um modelo físico específico.
            </p>
            <p className="mt-2 flex items-start gap-2"><Unplug size={14} className="mt-0.5 shrink-0" />
              Se o agente local cair, a tela acusa <code>agent_bridge_connection</code>; se o backend falhar,
              acusa <code>backend_connection</code>; se a conversão falhar, o erro vem com o estágio reportado
              pelo próprio agente.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
