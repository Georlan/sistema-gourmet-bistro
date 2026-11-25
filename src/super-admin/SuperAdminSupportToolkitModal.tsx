import React, { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Link2,
  MessageCircle,
  Search,
  Terminal,
  X,
} from "lucide-react";
import {
  listAllowedDeepLinkEntries,
  type SupportDeepLinkEntry,
} from "../components/caixa/navigation/cashierDeepLink";
import { parseBackendTimestamp } from "../utils/dateTime";
import {
  buildInvestigationPrompt,
  buildTriageCliCommand,
  type InvestigationFeedbackSummary,
  type InvestigationIncidentSummary,
} from "./investigationBrief";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

type ToolkitTab = "links" | "investigate";

interface SuperAdminSupportToolkitModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: ToolkitTab;
  tenant?: {
    id: string;
    name: string;
    plan?: string;
  } | null;
  incidents?: InvestigationIncidentSummary[];
}

function normalizeQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function SuperAdminSupportToolkitModal({
  open,
  onClose,
  initialTab = "links",
  tenant = null,
  incidents = [],
}: SuperAdminSupportToolkitModalProps) {
  const [tab, setTab] = useState<ToolkitTab>(initialTab);
  const [linkQuery, setLinkQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [tenantIdInput, setTenantIdInput] = useState(tenant?.id || "");
  const [supportCode, setSupportCode] = useState("");
  const [symptom, setSymptom] = useState("");
  const [selectedFeedback, setSelectedFeedback] = useState<InvestigationFeedbackSummary | null>(null);
  const [feedbacks, setFeedbacks] = useState<InvestigationFeedbackSummary[]>([]);
  const [feedbacksLoading, setFeedbacksLoading] = useState(false);
  const [feedbacksError, setFeedbacksError] = useState<string | null>(null);

  const allLinks = useMemo<SupportDeepLinkEntry[]>(() => listAllowedDeepLinkEntries(), []);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setTenantIdInput(tenant?.id || "");
    setSelectedFeedback(null);
  }, [open, initialTab, tenant?.id]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || tab !== "investigate" || !tenant?.id) return;
    let cancelled = false;
    setFeedbacksLoading(true);
    setFeedbacksError(null);
    void superAdminFetch(`/api/super-admin/support/${encodeURIComponent(tenant.id)}/feedbacks?limit=15`)
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(body?.items)) {
          throw new Error(body?.detail || "Chamados do cliente indisponíveis.");
        }
        if (!cancelled) {
          setFeedbacks(body.items as InvestigationFeedbackSummary[]);
        }
      })
      .catch(error => {
        if (!cancelled) {
          setFeedbacks([]);
          setFeedbacksError(superAdminErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setFeedbacksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, tenant?.id]);

  const filteredLinks = useMemo(() => {
    const clean = normalizeQuery(linkQuery);
    if (!clean) return allLinks;
    return allLinks.filter(item =>
      normalizeQuery(`${item.label} ${item.groupLabel} ${item.id} ${item.path}`).includes(clean),
    );
  }, [allLinks, linkQuery]);

  const triageCommand = useMemo(
    () =>
      buildTriageCliCommand({
        tenantId: tenantIdInput || tenant?.id || null,
        supportCode,
        symptom,
      }),
    [tenantIdInput, tenant?.id, supportCode, symptom],
  );

  const investigationPrompt = useMemo(
    () =>
      buildInvestigationPrompt({
        tenantId: tenantIdInput || tenant?.id || null,
        tenantName: tenant?.name || null,
        tenantPlan: tenant?.plan || null,
        supportCode,
        symptom,
        incidents,
        feedback: selectedFeedback,
      }),
    [tenantIdInput, tenant?.id, tenant?.name, tenant?.plan, supportCode, symptom, incidents, selectedFeedback],
  );

  const copyValue = async (value: string, key: string) => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopiedId(key);
      window.setTimeout(() => setCopiedId(current => (current === key ? null : current)), 2200);
    } catch {
      // Clipboard unavailable in restricted browser context.
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Links diretos e investigação de suporte"
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-2xl sm:rounded-2xl border border-zinc-800 bg-koma-card shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3.5 sm:px-5">
          <div>
            <h2 className="text-base font-black text-koma-foreground">
              Suporte rápido · Links diretos & Investigação
            </h2>
            <p className="mt-0.5 text-xs text-koma-muted">
              {tenant ? `Restaurante #${tenant.id} · ${tenant.name}` : "Catálogo canônico (?go=) e brief padronizado para IA/CLI."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar toolkit de suporte"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-zinc-800 text-koma-muted hover:text-koma-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex gap-2 border-b border-zinc-800 px-4 py-2.5 sm:px-5">
          <button
            type="button"
            onClick={() => setTab("links")}
            className={
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold " +
              (tab === "links" ? "bg-[#00b894] text-black" : "bg-koma-page text-koma-muted hover:text-koma-foreground")
            }
          >
            <Link2 className="h-3.5 w-3.5" />
            Links diretos ({allLinks.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("investigate")}
            className={
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold " +
              (tab === "investigate" ? "bg-[#00b894] text-black" : "bg-koma-page text-koma-muted hover:text-koma-foreground")
            }
          >
            <Bot className="h-3.5 w-3.5" />
            Iniciar investigação (IA / CLI)
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {tab === "links" && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-subtle" />
                <input
                  type="search"
                  aria-label="Pesquisar deep links de suporte"
                  value={linkQuery}
                  onChange={event => setLinkQuery(event.target.value)}
                  placeholder="Buscar tela ou configuração (ex.: entrega, impressão, pix, caixa, turno)..."
                  className="min-h-[44px] w-full rounded-xl border border-zinc-700 bg-koma-page pl-9 pr-3 py-2 text-xs text-koma-foreground placeholder:text-koma-subtle focus:border-[#00b894] focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                {filteredLinks.map(entry => (
                  <div
                    key={entry.id}
                    className="flex flex-col gap-2.5 rounded-xl border border-zinc-800 bg-koma-page p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-zinc-700 bg-koma-card px-2 py-0.5 text-[10px] font-bold text-koma-muted">
                          {entry.groupLabel}
                        </span>
                        <strong className="text-xs text-koma-foreground">{entry.label}</strong>
                      </div>
                      <p className="truncate font-mono text-[11px] text-[#00b894]">{entry.fullUrl}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void copyValue(entry.fullUrl, `url-${entry.id}`)}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-[#00b894] px-3 py-1.5 text-[11px] font-black text-black"
                      >
                        {copiedId === `url-${entry.id}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedId === `url-${entry.id}` ? "Copiado" : "Copiar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyValue(entry.whatsappText, `wa-${entry.id}`)}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-zinc-700 bg-koma-card px-2.5 py-1.5 text-[11px] font-bold text-koma-secondary hover:text-koma-foreground"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        {copiedId === `wa-${entry.id}` ? "Texto copiado" : "WhatsApp"}
                      </button>
                      <a
                        href={entry.fullUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-zinc-700 bg-koma-card px-2.5 py-1.5 text-[11px] font-bold text-koma-muted hover:text-koma-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Abrir
                      </a>
                    </div>
                  </div>
                ))}
                {filteredLinks.length === 0 && (
                  <p className="rounded-xl border border-zinc-800 bg-koma-page p-4 text-center text-xs text-koma-muted">
                    Nenhuma tela correspondente no catálogo canônico de deep links.
                  </p>
                )}
              </div>
            </>
          )}

          {tab === "investigate" && (
            <div className="space-y-4">
              {tenant && (
                <section className="space-y-2 rounded-xl border border-zinc-800 bg-koma-page p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold text-koma-foreground">
                      Últimos chamados enviados em Ajuda e feedback
                    </h3>
                    {feedbacksLoading && <span className="text-[11px] text-koma-muted">Carregando…</span>}
                  </div>
                  {feedbacksError && (
                    <p className="text-[11px] text-amber-300">{feedbacksError}</p>
                  )}
                  {!feedbacksLoading && !feedbacksError && feedbacks.length === 0 && (
                    <p className="text-[11px] text-koma-muted">
                      Nenhum chamado registrado por usuários deste restaurante até o momento.
                    </p>
                  )}
                  {feedbacks.length > 0 && (
                    <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                      {feedbacks.map(fb => {
                        const created = fb.createdAt ? parseBackendTimestamp(fb.createdAt) : null;
                        const code = fb.context?.last_support_code || "";
                        return (
                          <div
                            key={fb.id || fb.message}
                            className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-koma-card p-2.5 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0 space-y-0.5 text-[11px]">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-koma-secondary">
                                  {fb.kind}
                                </span>
                                {fb.context?.suspected_bug && (
                                  <span className="rounded border border-rose-700/60 bg-rose-950/40 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                                    POSSÍVEL BUG
                                  </span>
                                )}
                                {code && <span className="font-mono text-[#00b894]">{code}</span>}
                                <span className="text-koma-subtle">
                                  {created ? created.toLocaleString("pt-BR") : ""}
                                </span>
                              </div>
                              <p className="line-clamp-2 text-koma-foreground">{fb.message}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedFeedback(fb);
                                if (code) setSupportCode(code);
                                if (fb.message) setSymptom(fb.message);
                              }}
                              className="shrink-0 min-h-[44px] rounded-lg border border-emerald-700/60 px-2.5 py-1.5 text-[11px] font-bold text-emerald-200 hover:bg-emerald-950/30"
                            >
                              Usar no diagnóstico
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 text-xs">
                  <span className="font-semibold text-koma-secondary">Tenant ID (opcional)</span>
                  <input
                    value={tenantIdInput}
                    onChange={event => setTenantIdInput(event.target.value)}
                    placeholder="Ex.: 12"
                    className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 font-mono text-xs text-koma-foreground"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-semibold text-koma-secondary">Support code / Request ID</span>
                  <input
                    value={supportCode}
                    onChange={event => setSupportCode(event.target.value)}
                    placeholder="Ex.: 8abbe94133fc"
                    className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 font-mono text-xs text-koma-foreground"
                  />
                </label>
              </div>

              <label className="block space-y-1 text-xs">
                <span className="font-semibold text-koma-secondary">Sintoma ou relato do cliente</span>
                <textarea
                  rows={2}
                  value={symptom}
                  onChange={event => setSymptom(event.target.value)}
                  placeholder="Ex.: Cliente não consegue concluir pedido delivery no bairro Centro"
                  className="w-full rounded-lg border border-zinc-700 bg-koma-page p-2.5 text-xs text-koma-foreground"
                />
              </label>

              <div className="rounded-xl border border-zinc-800 bg-koma-page p-3.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-koma-foreground">
                    <Terminal className="h-3.5 w-3.5 text-[#00b894]" />
                    Comando read-only pronto
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyValue(triageCommand, "cli")}
                    className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-zinc-700 bg-koma-card px-3 py-1.5 text-[11px] font-bold text-koma-foreground"
                  >
                    {copiedId === "cli" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedId === "cli" ? "Comando copiado" : "Copiar comando"}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-koma-card p-2.5 font-mono text-[11px] text-emerald-300">
                  {triageCommand}
                </pre>
              </div>

              <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/15 p-3.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                    <Bot className="h-3.5 w-3.5" />
                    Brief pronto para colar no agente de IA
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyValue(investigationPrompt, "prompt")}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#00b894] px-3.5 py-2 text-xs font-black text-black"
                  >
                    {copiedId === "prompt" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedId === "prompt" ? "Prompt copiado" : "Copiar prompt para IA"}
                  </button>
                </div>
                <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-koma-page p-3 font-mono text-[11px] leading-relaxed text-koma-secondary">
                  {investigationPrompt}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
