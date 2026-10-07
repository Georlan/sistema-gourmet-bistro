import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle, RefreshCw, Search, Users, X } from "lucide-react";
import { superAdminFetch, superAdminErrorMessage } from "./superAdminApi";

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
  consent_whatsapp: boolean;
  consent_at?: string | null;
  consent_version?: string | null;
  status: LeadStatus;
  contacted_at?: string | null;
  notes?: string | null;
  cidade?: string | null;
  quantidade_unidades?: number | null;
  sistema_atual?: string | null;
  principal_dor?: string | null;
  interesse?: string | null;
  melhor_horario_contato?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  whatsapp_url: string;
};

type LeadsResponse = {
  total: number;
  counts: Record<LeadStatus, number>;
  conversion_rate: number;
  events: string[];
  leads: Lead[];
};

const statusLabel: Record<LeadStatus, string> = {
  new: "Novo",
  contacted: "Contatado",
  qualified: "Qualificado",
  demo_scheduled: "Demo agendada",
  converted: "Convertido",
  lost: "Perdido",
};

const statusClass: Record<LeadStatus, string> = {
  new: "border-sky-800/60 bg-sky-950/40 text-sky-300",
  contacted: "border-zinc-700 bg-zinc-900 text-zinc-300",
  qualified: "border-violet-800/60 bg-violet-950/40 text-violet-300",
  demo_scheduled: "border-amber-800/60 bg-amber-950/40 text-amber-300",
  converted: "border-emerald-800/60 bg-emerald-950/40 text-emerald-300",
  lost: "border-rose-900/60 bg-rose-950/40 text-rose-300",
};

const defaultMessage = (lead: Lead) =>
  `Oi, ${lead.nome}! Aqui é o Georlan, do KÔMA. Você deixou seu contato depois da nossa apresentação no Ceará Tech Summit. Queria entender um pouco melhor como funciona a operação do seu restaurante hoje e ver se o KÔMA faz sentido para vocês.`;

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

export function SuperAdminLeadsTab() {
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [eventSlug, setEventSlug] = useState("ceara-tech-summit-2026");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Lead>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (eventSlug !== "all") query.set("event_slug", eventSlug);
      if (status !== "all") query.set("status", status);
      if (search.trim()) query.set("search", search.trim());
      const response = await superAdminFetch(`/api/leads/admin?${query.toString()}`);
      if (!response.ok) throw new Error(`Falha ao carregar leads (${response.status})`);
      const payload = await response.json() as LeadsResponse;
      setData(payload);
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [eventSlug, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const cards = useMemo(() => [
    ["Total", data?.total ?? 0],
    ["Novos", data?.counts?.new ?? 0],
    ["Contatados", data?.counts?.contacted ?? 0],
    ["Qualificados", data?.counts?.qualified ?? 0],
    ["Convertidos", data?.counts?.converted ?? 0],
    ["Conversão", `${data?.conversion_rate ?? 0}%`],
  ], [data]);

  const openLead = (lead: Lead) => {
    setSelected(lead);
    setForm({ ...lead });
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    const payload = {
      status: form.status,
      notes: form.notes ?? null,
      cidade: form.cidade ?? null,
      quantidade_unidades: form.quantidade_unidades || null,
      sistema_atual: form.sistema_atual ?? null,
      principal_dor: form.principal_dor ?? null,
      interesse: form.interesse ?? null,
      melhor_horario_contato: form.melhor_horario_contato ?? null,
      contacted_at: form.contacted_at ?? null,
    };
    try {
      const response = await superAdminFetch(`/api/leads/admin/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Falha ao salvar lead (${response.status})`);
      const updated = await response.json() as Lead;
      setSelected(updated);
      setForm(updated);
      await load();
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const openWhatsApp = (lead: Lead) => {
    const message = encodeURIComponent(defaultMessage(lead));
    window.open(`https://wa.me/${lead.whatsapp_normalizado}?text=${message}`, "_blank", "noopener,noreferrer");
  };

  const markContacted = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const response = await superAdminFetch(`/api/leads/admin/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "contacted" }),
      });
      const updated = await response.json() as Lead;
      setSelected(updated);
      setForm(updated);
      await load();
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5" aria-label="CRM de Leads">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#00b894]">CRM comercial</p>
          <h2 className="text-2xl font-black text-koma-foreground">Leads</h2>
          <p className="mt-1 text-sm text-koma-muted">Captação, qualificação e acompanhamento pós-evento.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-koma-card px-3 py-2 text-xs font-bold text-koma-secondary hover:text-koma-foreground">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {cards.map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-zinc-800 bg-koma-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">{label}</p>
            <p className="mt-1 text-2xl font-black text-koma-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 rounded-xl border border-zinc-800 bg-koma-card p-3 md:grid-cols-[1fr_220px_220px]">
        <label className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-subtle" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar nome, empresa ou WhatsApp..." className="w-full rounded-lg border border-zinc-800 bg-koma-page py-2 pl-9 pr-3 text-sm outline-none focus:border-[#00b894]" />
        </label>
        <select value={status} onChange={e => setStatus(e.target.value as LeadStatus | "all")} className="rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-sm">
          <option value="all">Todos os status</option>
          {(Object.keys(statusLabel) as LeadStatus[]).map(key => <option key={key} value={key}>{statusLabel[key]}</option>)}
        </select>
        <select value={eventSlug} onChange={e => setEventSlug(e.target.value)} className="rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-sm">
          <option value="all">Todos os eventos</option>
          {(data?.events?.length ? data.events : ["ceara-tech-summit-2026"]).map(event => <option key={event} value={event}>{event === "ceara-tech-summit-2026" ? "Ceará Tech Summit 2026" : event}</option>)}
        </select>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-sm text-rose-300">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-koma-card">
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-koma-muted">Carregando leads…</div>
        ) : !data?.leads?.length ? (
          <div className="p-10 text-center">
            <Users className="mx-auto mb-3 h-8 w-8 text-koma-subtle" />
            <p className="font-bold">Nenhum lead encontrado.</p>
            <p className="mt-1 text-sm text-koma-muted">Os contatos captados pelo QR aparecerão aqui.</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {data.leads.map(lead => (
              <button key={lead.id} type="button" onClick={() => openLead(lead)} className="grid w-full gap-2 px-4 py-4 text-left hover:bg-koma-page/50 md:grid-cols-[1.2fr_1fr_1fr_150px] md:items-center">
                <div>
                  <p className="font-bold text-koma-foreground">{lead.nome}</p>
                  <p className="text-xs text-koma-muted">{lead.empresa_nome || "Negócio não informado"}{lead.segmento ? ` • ${lead.segmento}` : ""}</p>
                </div>
                <div className="text-xs text-koma-secondary">{lead.whatsapp_raw}<br /><span className="text-koma-muted">{formatDate(lead.created_at)}</span></div>
                <div className="text-xs text-koma-muted">{lead.event_slug === "ceara-tech-summit-2026" ? "Ceará Tech Summit 2026" : lead.event_slug}<br />{lead.source}</div>
                <span className={`w-fit rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${statusClass[lead.status]}`}>{statusLabel[lead.status]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/65" role="dialog" aria-modal="true" aria-label={`Lead ${selected.nome}`}>
          <div className="h-full w-full max-w-xl overflow-y-auto border-l border-zinc-800 bg-koma-card p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#00b894]">Lead #{selected.id}</p>
                <h3 className="text-xl font-black">{selected.nome}</h3>
                <p className="text-sm text-koma-muted">{selected.empresa_nome || "Negócio não informado"} • {selected.whatsapp_raw}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-zinc-800 p-2 text-koma-muted hover:text-white" aria-label="Fechar lead"><X className="h-4 w-4" /></button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-koma-muted">Status
                <select value={(form.status as LeadStatus) || selected.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value as LeadStatus }))} className="mt-1 w-full rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-sm text-koma-foreground">
                  {(Object.keys(statusLabel) as LeadStatus[]).map(key => <option key={key} value={key}>{statusLabel[key]}</option>)}
                </select>
              </label>
              <Field label="Cidade" value={form.cidade} onChange={value => setForm(prev => ({ ...prev, cidade: value }))} />
              <Field label="Quantidade de unidades" type="number" value={form.quantidade_unidades} onChange={value => setForm(prev => ({ ...prev, quantidade_unidades: value ? Number(value) : null }))} />
              <Field label="Sistema atual" value={form.sistema_atual} onChange={value => setForm(prev => ({ ...prev, sistema_atual: value }))} />
              <Field label="Interesse" value={form.interesse} onChange={value => setForm(prev => ({ ...prev, interesse: value }))} />
              <Field label="Melhor horário para contato" value={form.melhor_horario_contato} onChange={value => setForm(prev => ({ ...prev, melhor_horario_contato: value }))} />
            </div>

            <label className="mt-4 block text-xs font-bold text-koma-muted">Principal dor
              <textarea value={String(form.principal_dor ?? "")} onChange={e => setForm(prev => ({ ...prev, principal_dor: e.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
            </label>
            <label className="mt-4 block text-xs font-bold text-koma-muted">Observações comerciais
              <textarea value={String(form.notes ?? "")} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} rows={5} className="mt-1 w-full rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
            </label>

            <div className="mt-4 rounded-xl border border-zinc-800 bg-koma-page p-3 text-xs text-koma-muted">
              <p><strong className="text-koma-secondary">Consentimento:</strong> {selected.consent_whatsapp ? "WhatsApp autorizado" : "não autorizado"}</p>
              <p><strong className="text-koma-secondary">Registrado:</strong> {formatDate(selected.consent_at)}</p>
              <p><strong className="text-koma-secondary">Versão:</strong> {selected.consent_version || "—"}</p>
              <p><strong className="text-koma-secondary">Último contato:</strong> {formatDate(form.contacted_at as string | null)}</p>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => openWhatsApp(selected)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#00b894] px-4 py-3 text-sm font-black text-black"><MessageCircle className="h-4 w-4" /> Chamar no WhatsApp</button>
              <button type="button" onClick={() => void markContacted()} className="rounded-lg border border-zinc-700 px-4 py-3 text-sm font-bold text-koma-secondary hover:text-white">Marcar como Contatado</button>
              <button type="button" onClick={() => void save()} disabled={saving} className="sm:col-span-2 rounded-lg border border-[#00b894]/50 bg-[#00b894]/10 px-4 py-3 text-sm font-black text-[#00d6ad] disabled:opacity-60">{saving ? "Salvando…" : "Salvar alterações"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: unknown; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="text-xs font-bold text-koma-muted">{label}
      <input type={type} value={value == null ? "" : String(value)} onChange={e => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
    </label>
  );
}
