import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  FileSignature,
  Printer,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';

import { API_BASE_URL } from '../../config/api';
import {
  SubscriptionPlanId,
  getSubscriptionPlan,
} from '../../config/subscriptionPlans';

type ContractDocumentRef = {
  slug: string;
  hash: string;
};

type ContractReceipt = {
  protocol: string;
  acceptedAtUtc: string;
  acceptedAtBrasilia: string;
  provider: {
    name: string;
    taxId: string;
    address: string;
    location: string;
  };
  contractingParty: {
    name: string;
    taxId: string;
    taxIdKind: string;
    restaurantName: string;
    email: string;
    phone: string;
  };
  representative: {
    name: string;
    taxId: string;
    role: string;
    powersDeclared: boolean;
  };
  commercial: {
    plan: string;
    billingCycle: string;
    fixedMonthlyPrice: string | null;
    billingAmount: string | null;
    annualMonthlyEquivalent: string | null;
    marketplaceRate: string;
    trialDays: number;
    trialWaivesFixedFeeOnly: boolean;
  };
  documents: {
    version: string;
    terms: ContractDocumentRef;
    commercial: ContractDocumentRef;
    dpa: ContractDocumentRef;
    privacy: ContractDocumentRef;
    sourceCommit: string;
    sourceBlobSha: string;
  };
  evidence: {
    requestId: string;
    sourceIp: string;
    ipSource: string;
    sourceIpHash: string;
    userAgent: string;
    userAgentHash: string;
  };
  provisioning?: {
    status?: string;
    message?: string;
  };
};

type CurrentContractResponse = {
  receipt: ContractReceipt;
  tenantId: number | string;
};

type LoadState = 'idle' | 'loading' | 'ready' | 'not_found' | 'error';

const legalDocuments = [
  { key: 'terms' as const, label: 'Termos de Contratação', href: '/legal/termos' },
  { key: 'commercial' as const, label: 'Condições Comerciais', href: '/legal/planos' },
  { key: 'dpa' as const, label: 'Anexo de Tratamento de Dados (DPA)', href: '/legal/dpa' },
  { key: 'privacy' as const, label: 'Política de Privacidade', href: '/legal/privacidade' },
];

const formatMoney = (value: string | null | undefined) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(parsed);
};

const formatRate = (value: string | null | undefined) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed);
};

const formatAcceptedAt = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('pt-BR', {
    timeZone: 'America/Fortaleza',
    dateStyle: 'short',
    timeStyle: 'short',
  });
};

const compactHash = (hash: string) => {
  if (!hash || hash.length < 20) return hash || '—';
  return `${hash.slice(0, 12)}…${hash.slice(-12)}`;
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const getPlanLabel = (plan: string) => {
  if (plan === 'pocket' || plan === 'pro' || plan === 'premium') {
    return getSubscriptionPlan(plan as SubscriptionPlanId).name;
  }
  return plan || '—';
};

export const ContractDocumentsPanel: React.FC = () => {
  const [state, setState] = useState<LoadState>('idle');
  const [data, setData] = useState<CurrentContractResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const loadContract = useCallback(async () => {
    setState('loading');
    setErrorMessage('');
    setCopied(false);

    const token = localStorage.getItem('koma_caixa_token');
    if (!token) {
      setState('error');
      setErrorMessage('Sua sessão de Caixa não está disponível. Entre novamente para consultar o contrato.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/contracts/current`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      if (response.status === 404) {
        setData(null);
        setState('not_found');
        return;
      }

      const payload = await response.json().catch(() => null) as CurrentContractResponse | { detail?: string } | null;
      if (!response.ok) {
        const detail = payload && 'detail' in payload ? payload.detail : null;
        throw new Error(detail || 'Não foi possível consultar a segunda via do contrato.');
      }

      setData(payload as CurrentContractResponse);
      setState('ready');
    } catch (error) {
      setData(null);
      setState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível consultar a segunda via do contrato.');
    }
  }, []);

  useEffect(() => {
    void loadContract();
  }, [loadContract]);

  const receipt = data?.receipt ?? null;
  const planLabel = useMemo(
    () => receipt ? getPlanLabel(receipt.commercial.plan) : '—',
    [receipt],
  );

  const copyProtocol = async () => {
    if (!receipt?.protocol) return;
    try {
      await navigator.clipboard.writeText(receipt.protocol);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const printReceipt = () => {
    if (!receipt) return;

    const printWindow = window.open('', '_blank', 'width=900,height=1100');
    if (!printWindow) {
      setErrorMessage('O navegador bloqueou a janela de impressão. Libere pop-ups para gerar a segunda via em PDF.');
      return;
    }
    printWindow.opener = null;

    const documentRows = legalDocuments.map(({ key, label }) => {
      const item = receipt.documents[key];
      return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(receipt.documents.version)}</td><td class="mono">${escapeHtml(item.hash)}</td></tr>`;
    }).join('');

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(receipt.protocol)} — Comprovante KÔMA</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #171717; margin: 0; padding: 36px; font-size: 12px; line-height: 1.45; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
  p { margin: 4px 0; }
  .muted { color: #666; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 26px; }
  .label { color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  .value { font-weight: 700; }
  .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #ddd; padding: 7px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; }
  .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #ddd; color: #666; font-size: 10px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>Comprovante de Contratação e Licenciamento Eletrônico</h1>
  <p class="muted">KÔMA · Protocolo <span class="mono">${escapeHtml(receipt.protocol)}</span></p>

  <h2>Aceite eletrônico</h2>
  <div class="grid">
    <div><div class="label">Data e hora</div><div class="value">${escapeHtml(formatAcceptedAt(receipt.acceptedAtBrasilia || receipt.acceptedAtUtc))}</div></div>
    <div><div class="label">Plano / ciclo</div><div class="value">${escapeHtml(planLabel)} · ${escapeHtml(receipt.commercial.billingCycle)}</div></div>
    <div><div class="label">Valor contratado</div><div class="value">${escapeHtml(formatMoney(receipt.commercial.billingAmount))}</div></div>
    <div><div class="label">Taxa KÔMA online</div><div class="value">${escapeHtml(formatRate(receipt.commercial.marketplaceRate))}</div></div>
  </div>

  <h2>Prestador</h2>
  <p><strong>${escapeHtml(receipt.provider.name)}</strong></p>
  <p>CPF: ${escapeHtml(receipt.provider.taxId)}</p>
  <p>${escapeHtml(receipt.provider.address)} · ${escapeHtml(receipt.provider.location)}</p>

  <h2>Contratante</h2>
  <div class="grid">
    <div><div class="label">Nome / razão social</div><div class="value">${escapeHtml(receipt.contractingParty.name)}</div></div>
    <div><div class="label">CPF/CNPJ</div><div class="value">${escapeHtml(receipt.contractingParty.taxId)}</div></div>
    <div><div class="label">Restaurante</div><div class="value">${escapeHtml(receipt.contractingParty.restaurantName)}</div></div>
    <div><div class="label">Contato</div><div class="value">${escapeHtml(receipt.contractingParty.email)} · ${escapeHtml(receipt.contractingParty.phone)}</div></div>
  </div>

  <h2>Representante</h2>
  <div class="grid">
    <div><div class="label">Nome</div><div class="value">${escapeHtml(receipt.representative.name)}</div></div>
    <div><div class="label">CPF</div><div class="value">${escapeHtml(receipt.representative.taxId)}</div></div>
    <div><div class="label">Função</div><div class="value">${escapeHtml(receipt.representative.role)}</div></div>
    <div><div class="label">Declaração de poderes</div><div class="value">${receipt.representative.powersDeclared ? 'Registrada' : 'Não registrada'}</div></div>
  </div>

  <h2>Documentos aceitos</h2>
  <table>
    <thead><tr><th>Documento</th><th>Versão</th><th>SHA-256</th></tr></thead>
    <tbody>${documentRows}</tbody>
  </table>

  <h2>Evidências técnicas</h2>
  <p>Request ID: <span class="mono">${escapeHtml(receipt.evidence.requestId)}</span></p>
  <p>IP de origem: <span class="mono">${escapeHtml(receipt.evidence.sourceIp)}</span> (${escapeHtml(receipt.evidence.ipSource)})</p>
  <p>User-Agent: <span class="mono">${escapeHtml(receipt.evidence.userAgent)}</span></p>
  <p>Fonte Legal v${escapeHtml(receipt.documents.version)}: commit <span class="mono">${escapeHtml(receipt.documents.sourceCommit)}</span></p>

  <div class="footer">
    Esta via é reproduzida do snapshot imutável registrado no momento do aceite. Os hashes acima identificam os documentos efetivamente aceitos.
  </div>
</body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  };

  if (state === 'loading' || state === 'idle') {
    return (
      <div className="rounded-3xl border border-koma-border bg-koma-panel p-8 text-center shadow-sm" aria-live="polite">
        <RefreshCw className="mx-auto h-6 w-6 animate-spin text-emerald-600 dark:text-emerald-400" />
        <p className="mt-3 text-sm font-bold text-koma-foreground">Consultando a via contratual…</p>
        <p className="mt-1 text-xs text-koma-muted">Buscando o comprovante vinculado a este restaurante.</p>
      </div>
    );
  }

  if (state === 'not_found') {
    return (
      <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 shadow-sm" aria-live="polite">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="space-y-3">
            <div>
              <h3 className="font-serif text-lg font-bold text-koma-foreground">Nenhum contrato vinculado ainda</h3>
              <p className="mt-1 text-xs leading-5 text-koma-subtle">
                O aceite eletrônico pode já existir, mas a segunda via só aparece aqui depois que o protocolo é vinculado a este restaurante pelo Super Admin.
              </p>
            </div>
            <p className="text-xs text-koma-muted">
              Para o primeiro cliente: registre o aceite em <strong>/contratar/&lt;plano&gt;</strong>, guarde o protocolo e faça o vínculo no provisionamento do tenant.
            </p>
            <button
              type="button"
              onClick={() => void loadContract()}
              className="inline-flex items-center gap-2 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-xs font-bold text-koma-foreground transition-colors hover:border-emerald-500"
            >
              <RefreshCw size={14} />
              Consultar novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'error' || !receipt) {
    return (
      <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 shadow-sm" aria-live="assertive">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
          <div>
            <h3 className="font-serif text-lg font-bold text-koma-foreground">Não foi possível abrir o contrato</h3>
            <p className="mt-1 text-xs leading-5 text-koma-subtle">{errorMessage || 'Tente novamente em instantes.'}</p>
            <button
              type="button"
              onClick={() => void loadContract()}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-xs font-bold text-koma-foreground transition-colors hover:border-emerald-500"
            >
              <RefreshCw size={14} />
              Tentar novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <section className="rounded-3xl border border-emerald-500/30 bg-koma-panel p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-content-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileSignature size={20} />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-serif text-xl font-bold text-koma-foreground">Contrato e documentos</h3>
                <span className="koma-badge-success inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wider">
                  <CheckCircle2 size={11} /> Via vinculada
                </span>
              </div>
              <p className="mt-1 text-xs text-koma-subtle">
                Segunda via preservada do aceite eletrônico. Ela não é regenerada a partir dos termos atuais.
              </p>
              <p className="mt-2 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">{receipt.protocol}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyProtocol()}
              className="inline-flex items-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-koma-foreground transition-colors hover:border-emerald-500"
            >
              <Clipboard size={13} />
              {copied ? 'Protocolo copiado' : 'Copiar protocolo'}
            </button>
            <button
              type="button"
              onClick={printReceipt}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-emerald-500"
            >
              <Printer size={13} />
              Imprimir / salvar PDF
            </button>
            <button
              type="button"
              onClick={() => void loadContract()}
              className="inline-flex items-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-koma-foreground transition-colors hover:border-emerald-500"
              aria-label="Atualizar contrato"
            >
              <RefreshCw size={13} />
              Atualizar
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border border-koma-border bg-koma-panel p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck size={17} className="text-emerald-600 dark:text-emerald-400" />
            <h4 className="font-serif text-sm font-bold text-koma-foreground">Condições congeladas</h4>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 text-xs">
            <div>
              <dt className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">Plano</dt>
              <dd className="mt-1 font-bold text-koma-foreground">{planLabel}</dd>
            </div>
            <div>
              <dt className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">Ciclo</dt>
              <dd className="mt-1 font-bold capitalize text-koma-foreground">{receipt.commercial.billingCycle}</dd>
            </div>
            <div>
              <dt className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">Valor contratado</dt>
              <dd className="mt-1 font-mono font-bold text-koma-foreground">{formatMoney(receipt.commercial.billingAmount)}</dd>
            </div>
            <div>
              <dt className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">Taxa KÔMA online</dt>
              <dd className="mt-1 font-mono font-bold text-emerald-700 dark:text-emerald-400">{formatRate(receipt.commercial.marketplaceRate)}</dd>
            </div>
            <div>
              <dt className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">Aceito em</dt>
              <dd className="mt-1 font-bold text-koma-foreground">{formatAcceptedAt(receipt.acceptedAtBrasilia || receipt.acceptedAtUtc)}</dd>
            </div>
            <div>
              <dt className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">Trial</dt>
              <dd className="mt-1 font-bold text-koma-foreground">{receipt.commercial.trialDays} dias · mensalidade fixa</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-3xl border border-koma-border bg-koma-panel p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Building2 size={17} className="text-emerald-600 dark:text-emerald-400" />
            <h4 className="font-serif text-sm font-bold text-koma-foreground">Partes da contratação</h4>
          </div>
          <div className="mt-4 space-y-4 text-xs">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">Contratante</p>
              <p className="mt-1 font-bold text-koma-foreground">{receipt.contractingParty.name}</p>
              <p className="mt-0.5 text-koma-subtle">{receipt.contractingParty.taxIdKind.toUpperCase()}: {receipt.contractingParty.taxId}</p>
              <p className="mt-0.5 text-koma-subtle">{receipt.contractingParty.restaurantName} · {receipt.contractingParty.email}</p>
            </div>
            <div className="border-t border-koma-border pt-3">
              <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-koma-muted">
                <UserRoundCheck size={12} /> Representante
              </p>
              <p className="mt-1 font-bold text-koma-foreground">{receipt.representative.name}</p>
              <p className="mt-0.5 text-koma-subtle">CPF: {receipt.representative.taxId} · {receipt.representative.role}</p>
              <p className="mt-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">Declaração de poderes registrada</p>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-koma-border bg-koma-panel p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="font-serif text-sm font-bold text-koma-foreground">Documentos aceitos</h4>
            <p className="mt-1 text-[10px] text-koma-muted">Legal v{receipt.documents.version} · hashes SHA-256 do conteúdo efetivamente aceito.</p>
          </div>
          <span className="rounded-xl border border-koma-border bg-koma-raised px-2.5 py-1 font-mono text-[9px] text-koma-subtle">
            tenant {String(data?.tenantId ?? '—')}
          </span>
        </div>

        <div className="mt-4 divide-y divide-koma-border overflow-hidden rounded-2xl border border-koma-border">
          {legalDocuments.map(({ key, label, href }) => {
            const document = receipt.documents[key];
            return (
              <div key={key} className="flex flex-col gap-2 bg-koma-raised/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-koma-foreground hover:text-emerald-700 dark:hover:text-emerald-400"
                  >
                    {label}
                    <ExternalLink size={11} />
                  </a>
                  <p className="mt-1 break-all font-mono text-[9px] text-koma-muted" title={document.hash}>{compactHash(document.hash)}</p>
                </div>
                <span className="shrink-0 rounded-lg border border-koma-border px-2 py-1 text-[9px] font-bold text-koma-subtle">v{receipt.documents.version}</span>
              </div>
            );
          })}
        </div>
      </section>

      <details className="rounded-3xl border border-koma-border bg-koma-panel p-5 shadow-sm">
        <summary className="cursor-pointer select-none text-xs font-bold text-koma-foreground">Evidências técnicas do aceite</summary>
        <div className="mt-4 grid gap-3 text-[10px] text-koma-subtle sm:grid-cols-2">
          <div><span className="block font-bold uppercase tracking-wider text-koma-muted">Request ID</span><code className="mt-1 block break-all">{receipt.evidence.requestId}</code></div>
          <div><span className="block font-bold uppercase tracking-wider text-koma-muted">IP de origem</span><code className="mt-1 block break-all">{receipt.evidence.sourceIp} · {receipt.evidence.ipSource}</code></div>
          <div><span className="block font-bold uppercase tracking-wider text-koma-muted">User-Agent</span><code className="mt-1 block break-all">{receipt.evidence.userAgent}</code></div>
          <div><span className="block font-bold uppercase tracking-wider text-koma-muted">Commit da Legal v{receipt.documents.version}</span><code className="mt-1 block break-all">{receipt.documents.sourceCommit}</code></div>
          <div className="sm:col-span-2"><span className="block font-bold uppercase tracking-wider text-koma-muted">Blob jurídico</span><code className="mt-1 block break-all">{receipt.documents.sourceBlobSha}</code></div>
        </div>
      </details>

      <section className="rounded-3xl border border-koma-border bg-koma-panel p-5 text-xs text-koma-subtle shadow-sm">
        <h4 className="font-serif text-sm font-bold text-koma-foreground">Prestador registrado no comprovante</h4>
        <p className="mt-2 font-bold text-koma-foreground">{receipt.provider.name}</p>
        <p className="mt-1">CPF: {receipt.provider.taxId}</p>
        <p className="mt-1">{receipt.provider.address} · {receipt.provider.location}</p>
      </section>

      {errorMessage && (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200" role="status">
          {errorMessage}
        </p>
      )}
    </div>
  );
};
