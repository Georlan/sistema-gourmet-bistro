import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  MessageCircle,
  QrCode,
  RefreshCw,
  Save,
  Search,
  UserRoundCheck,
  X,
} from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

type LeadStatus = "new" | "contacted" | "qualified" | "demo_scheduled" | "converted" | "lost";

type Lead = {
  id: number;
  nome: string;
  whatsapp_raw: string;
  whatsapp_normalizado: string;
  empresa_nome?: string | null;
  segmento?: string | null;
  event_slug: string;
  source: string;
  status: LeadStatus;
  last_contact_at?: string | null;
  cidade?: string | null;
  quantidade_unidades?: number | null;
  sistema_atual?: string | null;
  principal_dor?: string | null;
  interesse?: string | null;
  melhor_horario_contato?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  consent_whatsapp?: boolean;
  consent_at?: string | null;
  consent_version?: string | null;
  history?: Array<{ id: number; actor: string; created_at: string; changes: Record<string, { before: unknown; after: unknown }> }>;

};

type LeadStats = Record<LeadStatus, number> & {
  total: number;
  conversion_rate: number;
};

type LeadsResponse = {
  total: number;
  stats: LeadStats;
  leads: Lead[];
  events: Array<{ event_slug: string; count: number; last_created_at?: string | null }>;
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Novo",
  contacted: "Contatado",
  qualified: "Qualificado",
  demo_scheduled: "Demo agendada",
  converted: "Convertido",
  lost: "Perdido",
};

const STATUS_STYLES: Record<LeadStatus, string> = {
  new: "border-sky-700/50 bg-sky-950/40 text-sky-300",
  contacted: "border-amber-700/50 bg-amber-950/40 text-amber-300",
  qualified: "border-violet-700/50 bg-violet-950/40 text-violet-300",
  demo_scheduled: "border-cyan-700/50 bg-cyan-950/40 text-cyan-300",
  converted: "border-emerald-700/50 bg-emerald-950/40 text-emerald-300",
  lost: "border-zinc-700 bg-zinc-900 text-zinc-400",
};

const EMPTY_STATS: LeadStats = {
  total: 0,
  new: 0,
  contacted: 0,
  qualified: 0,
  demo_scheduled: 0,
  converted: 0,
  lost: 0,
  conversion_rate: 0,
};

function eventLabel(slug: string): string {
  if (slug === "ceara-tech-summit-2026") return "Siará Tech Summit 2026";
  return slug
    .split("-")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("pt-BR");
}

function toDateTimeLocal(value?: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function SuperAdminLeadsTab() {
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<LeadStats>(EMPTY_STATS);
  const [events, setEvents] = useState<LeadsResponse["events"]>([]);
  const [eventFilter, setEventFilter] = useState("ceara-tech-summit-2026");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [draft, setDraft] = useState<Lead | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [whatsappOpened, setWhatsappOpened] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchText.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: "500" });
    if (eventFilter !== "all") params.set("event_slug", eventFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (searchQuery) params.set("search", searchQuery);
    return params.toString();
  }, [eventFilter, searchQuery, statusFilter]);

  const loadLeads = useCallback(async () => {
    const requestId = ++listRequest.current;
    setLoading(true);
    setError(null);
    try {
      const response = await superAdminFetch(`/api/leads/siaratech?${queryString}`);
      const payload = await response.json() as LeadsResponse;
      if (requestId !== listRequest.current) return;
      setLeads(Array.isArray(payload.leads) ? payload.leads : []);
      setStats(payload.stats || EMPTY_STATS);
      setEvents(Array.isArray(payload.events) ? payload.events : []);
    } catch (err) {
      if (requestId !== listRequest.current) return;
      setError(superAdminErrorMessage(err));
      setLeads([]);
      setStats(EMPTY_STATS);
    } finally {
      if (requestId === listRequest.current) setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadLeads();
    return () => { listRequest.current++; };
  }, [loadLeads]);

  const openLead = async (lead: Lead) => {
    const requestId = ++detailRequest.current;
    setSelectedLead(lead);
    setDraft(lead);
    setWhatsappOpened(false);
    setDetailBusy(true);
    try {
      const response = await superAdminFetch(`/api/leads/siaratech/${lead.id}`);
      const detail = await response.json() as Lead;
      if (requestId !== detailRequest.current) return;
      setSelectedLead(detail);
      setDraft(detail);
    } catch (err) {
      if (requestId !== detailRequest.current) return;
      setError(superAdminErrorMessage(err));
      setSelectedLead(null);
      setDraft(null);
    } finally {
      if (requestId === detailRequest.current) setDetailBusy(false);
    }
  };

  const closeLead = () => {
    detailRequest.current++;
    setSelectedLead(null);
    setDraft(null);
    setWhatsappOpened(false);
  };

  const saveLead = async (overrides: Partial<Lead> = {}) => {
    if (!draft) return;
    setDetailBusy(true);
    setError(null);
    const requestId = detailRequest.current;
    const effective = { ...draft, ...overrides };
    try {
      const response = await superAdminFetch(`/api/leads/siaratech/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: effective.status,
          notes: effective.notes || null,
          last_contact_at: effective.last_contact_at || null,
          cidade: effective.cidade || null,
          quantidade_unidades: effective.quantidade_unidades || null,
          sistema_atual: effective.sistema_atual || null,
          principal_dor: effective.principal_dor || null,
          interesse: effective.interesse || null,
          melhor_horario_contato: effective.melhor_horario_contato || null,
        }),
      });
      const saved = await response.json() as Lead;
      if (requestId === detailRequest.current) {
        setSelectedLead(saved);
        setDraft(saved);
        setWhatsappOpened(false);
      }
      await loadLeads();
    } catch (err) {
      if (requestId === detailRequest.current) setError(superAdminErrorMessage(err));
    } finally {
      if (requestId === detailRequest.current) setDetailBusy(false);
    }
  };

  const openWhatsapp = () => {
    if (!draft) return;
    const phone = String(draft.whatsapp_normalizado || "").replace(/\D/g, "");
    const message = `Oi, ${draft.nome}! Aqui é o Georlan, do KÔMA. Você deixou seu contato depois da nossa apresentação no Siará Tech Summit. Queria entender um pouco melhor como funciona a operação do seu restaurante hoje e ver se o KÔMA faz sentido para vocês.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    setWhatsappOpened(true);
  };

  const markContactedNow = () => {
    if (!draft) return;
    const now = new Date().toISOString();
    const next = { ...draft, status: "contacted" as LeadStatus, last_contact_at: now };
    setDraft(next);
    void saveLead(next);
  };

  const cards = [
    ["Total", stats.total],
    ["Novos", stats.new],
    ["Contatados", stats.contacted],
    ["Qualificados", stats.qualified],
    ["Convertidos", stats.converted],
    ["Conversão", `${stats.conversion_rate.toFixed(1)}%`],
  ] as const;

  return (
    <section className="space-y-5" aria-label="CRM de leads">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#00b894]">Comercial KÔMA</p>
          <h2 className="mt-1 text-2xl font-black text-koma-foreground">Leads</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-koma-muted">
            Acompanhe quem demonstrou interesse, faça o primeiro contato e mova cada oportunidade até conversão.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/siaratech/qr"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-[#00b894] px-3 py-2 text-xs font-black text-black hover:bg-emerald-400"
          >
            <QrCode className="h-4 w-4" />
            Abrir QR da apresentação
          </a>
          <button
            type="button"
            onClick={() => void loadLeads()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-koma-card px-3 py-2 text-xs font-bold text-koma-secondary hover:text-koma-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-800/50 bg-rose-950/30 px-4 py-3 text-xs text-rose-200">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Fechar erro"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-zinc-800 bg-koma-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-koma-muted">{label}</p>
            <p className="mt-1 text-2xl font-black text-koma-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 rounded-xl border border-zinc-800 bg-koma-card p-4 md:grid-cols-[1fr_220px_200px]">
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-subtle" />
          <input
            value={searchText}
            onChange={event => setSearchText(event.target.value)}
            placeholder="Buscar nome, empresa ou WhatsApp..."
            className="w-full rounded-lg border border-zinc-800 bg-koma-page py-2.5 pl-9 pr-3 text-xs text-koma-foreground outline-none focus:border-[#00b894]"
          />
        </label>
        <select
          value={eventFilter}
          onChange={event => setEventFilter(event.target.value)}
          className="rounded-lg border border-zinc-800 bg-koma-page px-3 py-2.5 text-xs text-koma-foreground outline-none focus:border-[#00b894]"
          aria-label="Filtrar evento"
        >
          <option value="all">Todos os eventos</option>
          {!events.some(item => item.event_slug === "ceara-tech-summit-2026") && (
            <option value="ceara-tech-summit-2026">Siará Tech Summit 2026</option>
          )}
          {events.map(item => (
            <option key={item.event_slug} value={item.event_slug}>
              {eventLabel(item.event_slug)} ({item.count})
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={event => setStatusFilter(event.target.value as LeadStatus | "all")}
          className="rounded-lg border border-zinc-800 bg-koma-page px-3 py-2.5 text-xs text-koma-foreground outline-none focus:border-[#00b894]"
          aria-label="Filtrar status"
        >
          <option value="all">Todos os status</option>
          {(Object.keys(STATUS_LABELS) as LeadStatus[]).map(status => (
            <option key={status} value={status}>{STATUS_LABELS[status]}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-koma-card">
        {loading ? (
          <div className="p-10 text-center text-sm text-koma-muted">Carregando leads…</div>
        ) : leads.length === 0 ? (
          <div className="p-10 text-center">
            <UserRoundCheck className="mx-auto h-8 w-8 text-koma-subtle" />
            <p className="mt-3 text-sm font-bold text-koma-foreground">Nenhum lead encontrado</p>
            <p className="mt-1 text-xs text-koma-muted">Os novos cadastros do QR aparecerão aqui.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-koma-page/60 text-[10px] uppercase tracking-wide text-koma-muted">
                  <tr>
                    <th className="px-4 py-3">Lead</th>
                    <th className="px-4 py-3">WhatsApp</th>
                    <th className="px-4 py-3">Evento</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Último contato</th>
                    <th className="px-4 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {leads.map(lead => (
                    <tr key={lead.id} className="hover:bg-koma-page/40">
                      <td className="px-4 py-3.5">
                        <p className="font-bold text-koma-foreground">{lead.nome}</p>
                        <p className="mt-0.5 text-koma-muted">{lead.empresa_nome || lead.segmento || "Sem empresa informada"}</p>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-koma-secondary">{lead.whatsapp_raw}</td>
                      <td className="px-4 py-3.5 text-koma-secondary">{eventLabel(lead.event_slug)}</td>
                      <td className="px-4 py-3.5"><StatusBadge status={lead.status} /></td>
                      <td className="px-4 py-3.5 text-koma-muted">{formatDate(lead.last_contact_at)}</td>
                      <td className="px-4 py-3.5 text-right">
                        <button type="button" onClick={() => void openLead(lead)} className="rounded-lg border border-zinc-700 px-3 py-2 font-bold text-koma-secondary hover:border-[#00b894] hover:text-koma-foreground">
                          Ver lead
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-zinc-800 md:hidden">
              {leads.map(lead => (
                <button key={lead.id} type="button" onClick={() => void openLead(lead)} className="block w-full p-4 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-koma-foreground">{lead.nome}</p>
                      <p className="mt-1 truncate text-xs text-koma-muted">{lead.empresa_nome || lead.segmento || lead.whatsapp_raw}</p>
                    </div>
                    <StatusBadge status={lead.status} />
                  </div>
                  <p className="mt-3 text-[10px] text-koma-subtle">{eventLabel(lead.event_slug)} · {formatDate(lead.created_at)}</p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {draft && selectedLead && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Detalhes do lead">
          <div className="h-full w-full max-w-xl overflow-y-auto border-l border-zinc-800 bg-koma-page shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-800 bg-koma-page/95 px-5 py-4 backdrop-blur">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#00b894]">Lead #{draft.id}</p>
                <h3 className="mt-1 text-xl font-black text-koma-foreground">{draft.nome}</h3>
                <p className="text-xs text-koma-muted">{draft.empresa_nome || "Empresa não informada"} · {draft.whatsapp_raw}</p>
              </div>
              <button type="button" onClick={closeLead} className="rounded-lg border border-zinc-800 p-2 text-koma-muted hover:text-koma-foreground" aria-label="Fechar detalhes">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-koma-muted">
                  Status
                  <select
                    aria-label="Status"
                    disabled={detailBusy}
                    value={draft.status}
                    onChange={event => setDraft({ ...draft, status: event.target.value as LeadStatus })}
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-koma-card px-3 py-2.5 text-koma-foreground outline-none focus:border-[#00b894]"
                  >
                    {(Object.keys(STATUS_LABELS) as LeadStatus[]).map(status => (
                      <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                    ))}
                  </select>
                </label>

                <label className="text-xs text-koma-muted">
                  Último contato
                  <input
                    type="datetime-local"
                    value={toDateTimeLocal(draft.last_contact_at)}
                    onChange={event => setDraft({ ...draft, last_contact_at: event.target.value ? new Date(event.target.value).toISOString() : null })}
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-koma-card px-3 py-2.5 text-koma-foreground outline-none focus:border-[#00b894]"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-koma-card p-4">
                <p className="text-[10px] font-black uppercase tracking-wide text-koma-muted">Origem</p>
                <p className="mt-2 text-sm font-bold text-koma-foreground">{eventLabel(draft.event_slug)}</p>
                <p className="mt-1 text-xs text-koma-muted">Fonte: {draft.source}</p>
                <div className="mt-3 border-t border-zinc-800 pt-3 text-xs text-koma-muted">
                  <p>Consentimento WhatsApp: <strong className="text-koma-foreground">{draft.consent_whatsapp ? "Sim" : "Não"}</strong></p>
                  <p className="mt-1">Registrado em: {formatDate(draft.consent_at)}</p>
                  <p className="mt-1">Versão: {draft.consent_version || "—"}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-koma-muted">
                  Cidade
                  <input value={draft.cidade || ""} onChange={event => setDraft({ ...draft, cidade: event.target.value })} maxLength={120} className="mt-1 w-full rounded-lg border border-zinc-800 bg-koma-card px-3 py-2.5 text-koma-foreground outline-none focus:border-[#00b894]" />
                </label>
                <label className="text-xs text-koma-muted">
                  Quantidade de unidades
                  <input type="number" min={1} max={999} value={draft.quantidade_unidades || ""} onChange={event => setDraft({ ...draft, quantidade_unidades: event.target.value ? Number(event.target.value) : null })} className="mt-1 w-full rounded-lg border border-zinc-800 bg-koma-card px-3 py-2.5 text-koma-foreground outline-none focus:border-[#00b894]" />
                </label>
                <label className="text-xs text-koma-muted sm:col-span-2">
                  Sistema atual
                  <input value={draft.sistema_atual || ""} onChange={event => setDraft({ ...draft, sistema_atual: event.target.value })} maxLength={120} placeholder="Ex.: planilha, sistema X, nenhum" className="mt-1 w-full rounded-lg border border-zinc-800 bg-koma-card px-3 py-2.5 text-koma-foreground outline-none focus:border-[#00b894]" />
                </label>
                <label className="text-xs text-koma-muted sm:col-span-2">
                  Principal dor
                  <textarea value={draft.principal_dor || ""} onChange={event => setDraft({ ...draft, principal_dor: event.target.value })} maxLength={2000} rows={3} className="mt-1 w-full resize-y rounded-lg border border-zinc-800 bg-koma-card px-3 py-2.5 text-koma-foreground outline-none focus:border-[#00b894]" />
                </label>
                <label className="text-xs text-koma-muted sm:col-span-2">
                  Interesse
                  <textarea value={draft.interesse || ""} onChange={event => setDraft({ ...draft, interesse: event.target.value })} maxLength={2000} rows={3} className="mt-1 w-full resize-y rounded-lg border border-zinc-800 bg-koma-card px-3 py-2.5 text-koma-foreground outline-none focus:border-[#00b894]" />
                </label>
                <label className="text-xs text-koma-muted sm:col-span-2">
                  Melhor horário para contato
                  <input value={draft.melhor_horario_contato || ""} onChange={event => setDraft({ ...draft, melhor_horario_contato: event.target.value })} maxLength={120} className="mt-1 w-full rounded-lg border border-zinc-800 bg-koma-card px-3 py-2.5 text-koma-foreground outline-none focus:border-[#00b894]" />
                </label>
                <label className="text-xs text-koma-muted sm:col-span-2">
                  Observações comerciais
                  <textarea value={draft.notes || ""} onChange={event => setDraft({ ...draft, notes: event.target.value })} maxLength={4000} rows={5} placeholder="Contexto da conversa, necessidades e próximos passos." className="mt-1 w-full resize-y rounded-lg border border-zinc-800 bg-koma-card px-3 py-2.5 text-koma-foreground outline-none focus:border-[#00b894]" />
                </label>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={openWhatsapp} disabled={detailBusy || !draft.consent_whatsapp} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00b894] px-4 py-3 text-sm font-black text-black hover:bg-emerald-400">
                  <MessageCircle className="h-4 w-4" />
                  Chamar no WhatsApp
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => void saveLead()} disabled={detailBusy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-koma-card px-4 py-3 text-sm font-black text-koma-foreground disabled:opacity-50">
                  <Save className="h-4 w-4" />
                  {detailBusy ? "Salvando…" : "Salvar lead"}
                </button>
              </div>

              {whatsappOpened && draft.status === "new" && (
                <button type="button" onClick={markContactedNow} disabled={detailBusy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm font-bold text-amber-200 disabled:opacity-50">
                  <CheckCircle2 className="h-4 w-4" />
                  Marcar como contatado agora
                </button>
              )}

              <div className="rounded-xl border border-zinc-800 bg-koma-card p-4">
                <h4 className="text-sm font-bold text-koma-foreground">Histórico de alterações</h4>
                <p className="mt-1 text-xs text-koma-muted">Últimas 50 alterações, da mais recente para a mais antiga.</p>
                {!draft.history?.length && <p className="mt-3 text-xs text-koma-muted">Nenhuma alteração comercial registrada.</p>}
                <ol className="mt-3 space-y-3">
                  {draft.history?.map(entry => (
                    <li key={entry.id} className="border-t border-zinc-800 pt-3 text-xs text-koma-muted">
                      <p>{formatDate(entry.created_at)} · {entry.actor}</p>
                      {Object.entries(entry.changes).map(([field, change]) => (
                        <p key={field} className="mt-1 break-words">{({ status: "Status", notes: "Notas", cidade: "Cidade", quantidade_unidades: "Unidades", sistema_atual: "Sistema atual", principal_dor: "Principal dor", interesse: "Interesse", melhor_horario_contato: "Melhor horário", last_contact_at: "Último contato" } as Record<string, string>)[field] || field}: {field === "status" ? STATUS_LABELS[change.before as LeadStatus] : String(change.before ?? "—")} → {field === "status" ? STATUS_LABELS[change.after as LeadStatus] : String(change.after ?? "—")}</p>
                      ))}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-koma-card p-3 text-xs text-koma-muted">
                <CalendarClock className="h-4 w-4 shrink-0 text-[#00b894]" />
                Cadastrado em {formatDate(draft.created_at)} · atualizado em {formatDate(draft.updated_at)}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default SuperAdminLeadsTab;
