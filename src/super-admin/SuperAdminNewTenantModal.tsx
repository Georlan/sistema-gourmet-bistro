import React, { useMemo, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Plus, X } from "lucide-react";
import {
  SUBSCRIPTION_PLANS,
  formatCurrency,
  formatPercentage,
} from "../config/subscriptionPlans";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

type OnboardingResponse = {
  id: string;
  name: string;
  subdomain: string;
  plan: string;
  status: string;
  onlinePaymentStatus: string;
  trial: {
    status: string;
    startedAt: string;
    endsAt: string;
    daysRemaining: number;
    daysGranted: number;
  };
  admin: {
    id: string;
    name: string;
    email: string;
    status: string;
  };
  paths: {
    cashier: string;
    publicMenu: string;
  };
  message?: string;
};

interface SuperAdminNewTenantModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function formatTrialEnd(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-semibold text-koma-secondary hover:text-koma-foreground"
      title={`Copiar ${label}`}
    >
      <Copy className="h-3 w-3" /> {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

export function SuperAdminNewTenantModal({ onClose, onCreated }: SuperAdminNewTenantModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [plan, setPlan] = useState("pocket");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<OnboardingResponse | null>(null);

  const selectedPlan = useMemo(
    () => SUBSCRIPTION_PLANS.find(item => item.id === plan),
    [plan],
  );

  const updateName = (value: string) => {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  };

  const updateSlug = (value: string) => {
    setSlugEdited(true);
    setSlug(slugify(value));
  };

  const close = () => {
    setTemporaryPassword("");
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await superAdminFetch("/api/super-admin/restaurantes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          subdomain: slug.trim(),
          plan,
          admin_name: adminName.trim(),
          admin_email: adminEmail.trim(),
          temporary_password: temporaryPassword,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.detail;
        if (Array.isArray(detail)) {
          throw new Error(detail.map(item => item?.msg).filter(Boolean).join(" · ") || "Dados inválidos.");
        }
        throw new Error(typeof detail === "string" ? detail : "Não foi possível criar o restaurante.");
      }

      setCreated(payload as OnboardingResponse);
      onCreated();
    } catch (requestError) {
      setError(superAdminErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (created) {
    const cashierUrl = new URL(created.paths.cashier, window.location.origin).toString();
    const menuUrl = new URL(created.paths.publicMenu, window.location.origin).toString();
    const officialCreatedPlan = SUBSCRIPTION_PLANS.find(item => item.id === created.plan);

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
        <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[#1e293b] bg-koma-card p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
            <div className="flex gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-emerald-800/50 bg-emerald-950/40 text-emerald-400">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-koma-foreground">Restaurante criado</h3>
                <p className="mt-1 text-xs text-koma-muted">Tenant #{created.id} provisionado com {created.trial.daysGranted} dias grátis.</p>
              </div>
            </div>
            <button type="button" onClick={close} className="text-koma-subtle hover:text-koma-foreground"><X className="h-5 w-5" /></button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Restaurante</span><p className="mt-1 font-bold text-koma-foreground">{created.name}</p><p className="font-mono text-[10px] text-koma-subtle">#{created.id} · {created.subdomain}</p></div>
            <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Plano de recursos</span><p className="mt-1 font-bold text-koma-foreground">{officialCreatedPlan?.name || created.plan}</p><p className="text-[10px] text-koma-subtle">Mercado Pago do cardápio: desconectado</p></div>
          </div>

          <div className="mt-4 rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-4 text-xs">
            <p className="font-bold text-emerald-200">Período grátis ativo</p>
            <p className="mt-1 text-[10px] leading-relaxed text-emerald-100/70">
              {created.trial.daysRemaining} dias disponíveis · termina em {formatTrialEnd(created.trial.endsAt)}. A expiração não suspende o restaurante automaticamente nesta etapa; o Super Admin mantém o controle da decisão.
            </p>
          </div>

          <div className="mt-4 rounded-lg border border-amber-800/40 bg-amber-950/20 p-4 text-xs">
            <p className="font-bold text-amber-200">Credenciais iniciais — copie antes de fechar</p>
            <p className="mt-1 text-[10px] leading-relaxed text-amber-100/70">A senha abaixo existe apenas neste formulário e não volta da API nem fica registrada na auditoria.</p>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-koma-page p-2.5"><div><span className="text-koma-muted">Administrador</span><p className="font-mono text-koma-foreground">{created.admin.email}</p></div><CopyButton value={created.admin.email} label="e-mail" /></div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-koma-page p-2.5"><div><span className="text-koma-muted">Senha temporária</span><p className="font-mono text-koma-foreground">{temporaryPassword}</p></div><CopyButton value={temporaryPassword} label="senha" /></div>
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-lg border border-zinc-800 bg-koma-page p-4 text-xs">
            <p className="font-bold text-koma-foreground">Acessos oficiais</p>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-koma-muted">Caixa</span><div className="flex items-center gap-1.5"><CopyButton value={cashierUrl} label="link do Caixa" /><a href={cashierUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-[#00b894] px-2 py-1 text-[10px] font-bold text-black"><ExternalLink className="h-3 w-3" /> Abrir</a></div></div>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-koma-muted">Cardápio</span><div className="flex items-center gap-1.5"><CopyButton value={menuUrl} label="link do cardápio" /><a href={menuUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1 text-[10px] font-bold text-koma-secondary"><ExternalLink className="h-3 w-3" /> Abrir</a></div></div>
          </div>

          <div className="mt-5 flex justify-end">
            <button type="button" onClick={close} className="rounded-lg bg-[#00b894] px-4 py-2 text-xs font-bold text-black">Concluir</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[#1e293b] bg-koma-card p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-koma-foreground"><Plus className="h-5 w-5 text-[#00b894]" /> Novo restaurante</h3>
            <p className="mt-1 text-[10px] text-koma-muted">Cria o tenant, configuração padrão, administrador inicial e 7 dias grátis em uma única operação.</p>
          </div>
          <button type="button" onClick={close} disabled={isSubmitting} className="text-koma-subtle hover:text-koma-foreground disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4 text-xs">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block font-medium text-koma-secondary">Restaurante</span><input value={name} onChange={event => updateName(event.target.value)} required minLength={2} maxLength={255} autoFocus className="w-full rounded-lg border border-zinc-800 bg-koma-page p-2.5 text-koma-foreground focus:border-[#00b894] focus:outline-none" placeholder="Ex: Pizzaria Central" /></label>
            <label className="block"><span className="mb-1 block font-medium text-koma-secondary">Slug público</span><input value={slug} onChange={event => updateSlug(event.target.value)} required minLength={2} maxLength={100} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" className="w-full rounded-lg border border-zinc-800 bg-koma-page p-2.5 font-mono text-koma-foreground focus:border-[#00b894] focus:outline-none" placeholder="pizzaria-central" /><span className="mt-1 block text-[10px] text-koma-subtle">/c/{slug || "slug-do-restaurante"}</span></label>
          </div>

          <label className="block"><span className="mb-1 block font-medium text-koma-secondary">Plano de recursos durante o trial</span><select value={plan} onChange={event => setPlan(event.target.value)} className="w-full rounded-lg border border-zinc-800 bg-koma-page p-2.5 text-koma-foreground focus:border-[#00b894] focus:outline-none">{SUBSCRIPTION_PLANS.map(item => <option key={item.id} value={item.id}>{item.name} — referência {formatCurrency(item.price)}/mês · {formatPercentage(item.splitFeeRate)} split</option>)}</select>{selectedPlan && <span className="mt-1 block text-[10px] text-koma-subtle">O restaurante testa os recursos do {selectedPlan.name} por 7 dias. A cobrança SaaS recorrente ainda não é criada automaticamente.</span>}</label>

          <div className="border-t border-zinc-800 pt-4">
            <p className="mb-3 font-bold text-koma-foreground">Administrador inicial</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="mb-1 block font-medium text-koma-secondary">Nome</span><input value={adminName} onChange={event => setAdminName(event.target.value)} required minLength={2} maxLength={100} className="w-full rounded-lg border border-zinc-800 bg-koma-page p-2.5 text-koma-foreground focus:border-[#00b894] focus:outline-none" placeholder="Nome do responsável" /></label>
              <label className="block"><span className="mb-1 block font-medium text-koma-secondary">E-mail</span><input type="email" value={adminEmail} onChange={event => setAdminEmail(event.target.value)} required maxLength={100} className="w-full rounded-lg border border-zinc-800 bg-koma-page p-2.5 text-koma-foreground focus:border-[#00b894] focus:outline-none" placeholder="admin@restaurante.com" /></label>
            </div>
            <label className="mt-4 block"><span className="mb-1 block font-medium text-koma-secondary">Senha temporária</span><input type="password" value={temporaryPassword} onChange={event => setTemporaryPassword(event.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" className="w-full rounded-lg border border-zinc-800 bg-koma-page p-2.5 text-koma-foreground focus:border-[#00b894] focus:outline-none" placeholder="Mínimo 8 caracteres" /><span className="mt-1 block text-[10px] text-koma-subtle">Não será retornada pelo backend. Após a criação, aparece uma única vez a partir deste formulário.</span></label>
          </div>

          <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-3 text-[10px] leading-relaxed text-emerald-100/75">O restaurante nasce <strong className="text-emerald-200">ativo com 7 dias grátis</strong>. O fim do trial é acompanhado pelo Super Admin e não suspende automaticamente nesta etapa. O Mercado Pago do Cardápio Online nasce <strong className="text-amber-300">desconectado</strong> e será vinculado depois pelo OAuth oficial.</div>

          {error && <div role="alert" className="rounded-lg border border-rose-800/50 bg-rose-950/40 p-3 text-xs text-rose-300">{error}</div>}

          <div className="flex justify-end gap-2 border-t border-zinc-800 pt-4">
            <button type="button" onClick={close} disabled={isSubmitting} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-koma-secondary hover:text-koma-foreground disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={isSubmitting} className="rounded-lg bg-[#00b894] px-4 py-2 text-xs font-bold text-black hover:bg-[#00c996] disabled:opacity-50">{isSubmitting ? "Provisionando..." : "Criar com 7 dias grátis"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SuperAdminNewTenantModal;