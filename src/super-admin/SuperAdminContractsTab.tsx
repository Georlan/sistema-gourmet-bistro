import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Copy,
  FileText,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

export type ContractInboxStatus = "SIGNED_PENDING_ACTIVATION" | "ACTIVATED";

export interface ContractInboxItem {
  acceptanceId: string;
  protocol: string;
  status: ContractInboxStatus;
  acceptedAt: string | null;
  restaurantName: string;
  contractingPartyName: string;
  contractingPartyTaxIdLast4: string;
  representativeName: string;
  representativeTaxIdLast4: string;
  representativeRole: string;
  email: string;
  phone: string;
  plan: string;
  billingCycle: string;
  fixedMonthlyPrice: string | null;
  billingAmount: string | null;
  annualMonthlyEquivalent: string | null;
  marketplaceRate: string | null;
  legalVersion: string;
  documentHashes: {
    terms: string;
    commercial: string;
    dpa: string;
    privacy: string;
  };
  linkedRestaurantId: string | null;
  linkedAt: string | null;
}

interface SuperAdminContractsTabProps {
  items: ContractInboxItem[];
  isLoading: boolean;
  available: boolean;
  globalSearch: string;
  refreshContracts: () => Promise<void>;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatMoney(value: string | null): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(parsed);
}

function formatRate(value: string | null): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return `${(parsed * 100).toFixed(2).replace(".", ",")}%`;
}

function maskedDocument(last4: string): string {
  return last4 ? `•••• ${last4}` : "—";
}

function whatsappHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${normalized}`;
}

export function SuperAdminContractsTab({
  items,
  isLoading,
  available,
  globalSearch,
  refreshContracts,
}: SuperAdminContractsTabProps) {
  const [view, setView] = useState<"pending" | "all">("pending");
  const [selectedProtocol, setSelectedProtocol] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pendingCount = items.filter(item => item.status === "SIGNED_PENDING_ACTIVATION").length;
  const activatedCount = items.filter(item => item.status === "ACTIVATED").length;
  const search = globalSearch.trim().toLowerCase();

  const filtered = useMemo(() => items.filter(item => {
    if (view === "pending" && item.status !== "SIGNED_PENDING_ACTIVATION") return false;
    if (!search) return true;
    return [
      item.restaurantName,
      item.contractingPartyName,
      item.representativeName,
      item.email,
      item.phone,
      item.protocol,
      item.plan,
    ].some(value => value.toLowerCase().includes(search));
  }), [items, search, view]);

  const selected = filtered.find(item => item.protocol === selectedProtocol) ?? filtered[0] ?? null;
  const selectedWhatsapp = selected ? whatsappHref(selected.phone) : null;

  const copyProtocol = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.protocol);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="contracts-inbox-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="contracts-inbox-title" className="text-xl font-black tracking-tight text-koma-foreground">Contratações</h2>
            {pendingCount > 0 && (
              <span className="rounded-full border border-amber-700/50 bg-amber-950/60 px-2 py-0.5 text-[10px] font-black text-amber-300">
                {pendingCount} pendente{pendingCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-koma-muted">
            Inbox operacional dos aceites eletrônicos. A evidência jurídica permanece imutável; aqui acompanhamos apenas o provisionamento.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshContracts()}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-koma-card px-3 py-2 text-xs font-bold text-koma-secondary transition-colors hover:border-zinc-700 hover:text-koma-foreground disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4">
          <div className="flex items-center gap-2 text-amber-300"><Clock3 className="h-4 w-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Aguardando ativação</span></div>
          <strong className="mt-2 block text-2xl font-black text-koma-foreground">{pendingCount}</strong>
        </div>
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
          <div className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="h-4 w-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Vinculadas</span></div>
          <strong className="mt-2 block text-2xl font-black text-koma-foreground">{activatedCount}</strong>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-koma-card p-4">
          <div className="flex items-center gap-2 text-koma-muted"><FileText className="h-4 w-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Aceites recentes</span></div>
          <strong className="mt-2 block text-2xl font-black text-koma-foreground">{items.length}</strong>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
        <button
          type="button"
          onClick={() => setView("pending")}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold ${view === "pending" ? "bg-[#00b894] text-black" : "bg-zinc-900 text-koma-secondary"}`}
        >
          Pendentes ({pendingCount})
        </button>
        <button
          type="button"
          onClick={() => setView("all")}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold ${view === "all" ? "bg-[#00b894] text-black" : "bg-zinc-900 text-koma-secondary"}`}
        >
          Todas ({items.length})
        </button>
      </div>

      {!available && !isLoading && (
        <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4 text-sm text-rose-200">
          Não foi possível carregar a inbox de contratações. Nenhum estado foi simulado localmente.
        </div>
      )}

      {available && !isLoading && filtered.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-koma-card p-8 text-center">
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-emerald-400" />
          <h3 className="font-bold text-koma-foreground">Nenhuma contratação nesta visão</h3>
          <p className="mt-1 text-xs text-koma-muted">
            {view === "pending" ? "Não há aceites aguardando ativação." : "Ainda não há aceites compatíveis com a busca."}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.35fr)]">
          <div className="space-y-2">
            {filtered.map(item => {
              const active = selected?.protocol === item.protocol;
              return (
                <button
                  key={item.acceptanceId}
                  type="button"
                  onClick={() => setSelectedProtocol(item.protocol)}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${active ? "border-[#00b894]/60 bg-emerald-950/20" : "border-zinc-800 bg-koma-card hover:border-zinc-700"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm text-koma-foreground">{item.restaurantName}</strong>
                      <span className="mt-1 block truncate text-[11px] text-koma-muted">{item.contractingPartyName}</span>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wide ${item.status === "SIGNED_PENDING_ACTIVATION" ? "bg-amber-950 text-amber-300" : "bg-emerald-950 text-emerald-300"}`}>
                      {item.status === "SIGNED_PENDING_ACTIVATION" ? "Pendente" : "Vinculada"}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-koma-muted">
                    <span className="font-mono">{item.protocol}</span>
                    <span>{formatDate(item.acceptedAt)}</span>
                  </div>
                  <div className="mt-2 text-[11px] font-bold text-koma-secondary">
                    {item.plan.toUpperCase()} · {item.billingCycle}
                  </div>
                </button>
              );
            })}
          </div>

          {selected && (
            <article className="rounded-xl border border-zinc-800 bg-koma-card p-5">
              <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#00b894]">Detalhe da contratação</span>
                  <h3 className="mt-1 text-lg font-black text-koma-foreground">{selected.restaurantName}</h3>
                  <p className="mt-1 font-mono text-[11px] text-koma-muted">{selected.protocol}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void copyProtocol()} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-[11px] font-bold text-koma-secondary hover:text-koma-foreground">
                    <Copy className="h-3.5 w-3.5" /> {copied ? "Copiado" : "Copiar protocolo"}
                  </button>
                  {selectedWhatsapp && (
                    <a href={selectedWhatsapp} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-[11px] font-bold text-emerald-300">
                      <MessageCircle className="h-3.5 w-3.5" /> Abrir WhatsApp
                    </a>
                  )}
                </div>
              </div>

              <div className="grid gap-5 py-5 md:grid-cols-2">
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-wider text-koma-muted">Contratante</h4>
                  <dl className="mt-2 space-y-2 text-xs">
                    <div><dt className="text-koma-muted">Nome / razão social</dt><dd className="font-semibold text-koma-foreground">{selected.contractingPartyName}</dd></div>
                    <div><dt className="text-koma-muted">Documento</dt><dd className="font-mono text-koma-secondary">{maskedDocument(selected.contractingPartyTaxIdLast4)}</dd></div>
                    <div><dt className="text-koma-muted">E-mail</dt><dd className="text-koma-secondary">{selected.email}</dd></div>
                    <div><dt className="text-koma-muted">Telefone</dt><dd className="text-koma-secondary">{selected.phone}</dd></div>
                  </dl>
                </div>
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-wider text-koma-muted">Representante</h4>
                  <dl className="mt-2 space-y-2 text-xs">
                    <div><dt className="text-koma-muted">Nome</dt><dd className="font-semibold text-koma-foreground">{selected.representativeName}</dd></div>
                    <div><dt className="text-koma-muted">CPF</dt><dd className="font-mono text-koma-secondary">{maskedDocument(selected.representativeTaxIdLast4)}</dd></div>
                    <div><dt className="text-koma-muted">Cargo / função</dt><dd className="text-koma-secondary">{selected.representativeRole}</dd></div>
                    <div><dt className="text-koma-muted">Aceite</dt><dd className="text-koma-secondary">{formatDate(selected.acceptedAt)}</dd></div>
                  </dl>
                </div>
              </div>

              <div className="grid gap-3 border-y border-zinc-800 py-4 sm:grid-cols-4">
                <div><span className="block text-[9px] font-bold uppercase text-koma-muted">Plano</span><strong className="mt-1 block text-sm text-koma-foreground">{selected.plan.toUpperCase()}</strong></div>
                <div><span className="block text-[9px] font-bold uppercase text-koma-muted">Ciclo</span><strong className="mt-1 block text-sm text-koma-foreground">{selected.billingCycle}</strong></div>
                <div><span className="block text-[9px] font-bold uppercase text-koma-muted">Mensalidade-base</span><strong className="mt-1 block text-sm text-koma-foreground">{formatMoney(selected.fixedMonthlyPrice)}</strong></div>
                <div><span className="block text-[9px] font-bold uppercase text-koma-muted">Taxa online</span><strong className="mt-1 block text-sm text-koma-foreground">{formatRate(selected.marketplaceRate)}</strong></div>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-[10px] font-black uppercase tracking-wider text-koma-muted">Evidência jurídica</h4>
                  <span className="text-[10px] font-bold text-koma-secondary">Legal v{selected.legalVersion}</span>
                </div>
                <div className="mt-3 grid gap-2 text-[10px] text-koma-muted">
                  <div><span className="font-bold text-koma-secondary">Termos</span><code className="ml-2 break-all">{selected.documentHashes.terms}</code></div>
                  <div><span className="font-bold text-koma-secondary">Comercial</span><code className="ml-2 break-all">{selected.documentHashes.commercial}</code></div>
                  <div><span className="font-bold text-koma-secondary">DPA</span><code className="ml-2 break-all">{selected.documentHashes.dpa}</code></div>
                  <div><span className="font-bold text-koma-secondary">Privacidade</span><code className="ml-2 break-all">{selected.documentHashes.privacy}</code></div>
                </div>
              </div>

              <div className={`mt-5 rounded-lg border p-3 text-xs ${selected.status === "SIGNED_PENDING_ACTIVATION" ? "border-amber-900/50 bg-amber-950/20 text-amber-200" : "border-emerald-900/50 bg-emerald-950/20 text-emerald-200"}`}>
                {selected.status === "SIGNED_PENDING_ACTIVATION"
                  ? "Aceite registrado e aguardando provisionamento. Nenhum restaurante foi criado ou vinculado automaticamente."
                  : `Aceite vinculado ao restaurante #${selected.linkedRestaurantId ?? "—"} em ${formatDate(selected.linkedAt)}.`}
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
