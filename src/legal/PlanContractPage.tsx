import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, ExternalLink, Printer } from 'lucide-react';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../brand/komaBrand';
import { API_BASE_URL } from '../config/api';
import {
  SUBSCRIPTION_PLANS,
  formatCurrency,
  formatPercentage,
  getSubscriptionPricing,
  type SubscriptionPlanId,
} from '../config/subscriptionPlans';
import {
  LEGAL_SOURCE_BLOB_SHA,
  LEGAL_SOURCE_COMMIT,
  contractLegalBundle,
} from './legalEvidence';
import { LEGAL_PROVIDER_NAME, LEGAL_VERSION } from './legalContent';
import { isValidCpf, taxIdKind } from './taxId';
import './legal.css';

type ContractForm = {
  contractingPartyName: string;
  taxId: string;
  responsibleName: string;
  representativeTaxId: string;
  representativeRole: string;
  email: string;
  phone: string;
  restaurantName: string;
};

type ContractCopy = {
  kicker: string;
  description: string;
};

type ContractReceipt = {
  protocol: string;
  acceptedAtUtc: string;
  acceptedAtBrasilia: string;
  provider: { name: string; taxId: string; address: string; location: string };
  contractingParty: {
    name: string;
    taxId: string;
    taxIdKind: string;
    restaurantName: string;
    email: string;
    phone: string;
  };
  representative: { name: string; taxId: string; role: string; powersDeclared: boolean };
  commercial: {
    plan: string;
    billingCycle: string;
    fixedMonthlyPrice: string;
    billingAmount: string;
    annualMonthlyEquivalent: string | null;
    marketplaceRate: string;
    trialDays: number;
    trialWaivesFixedFeeOnly: boolean;
  };
  documents: {
    version: string;
    terms: { slug: string; hash: string };
    commercial: { slug: string; hash: string };
    dpa: { slug: string; hash: string };
    privacy: { slug: string; hash: string };
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
  provisioning: { status: string; message: string };
};

const EMPTY_FORM: ContractForm = {
  contractingPartyName: '',
  taxId: '',
  responsibleName: '',
  representativeTaxId: '',
  representativeRole: '',
  email: '',
  phone: '',
  restaurantName: '',
};

const CONTRACT_COPY: Record<SubscriptionPlanId, ContractCopy> = {
  pocket: {
    kicker: 'COMECE LEVE',
    description: 'Uma entrada enxuta para operar salão, balcão, delivery, caixa e cardápio digital com a base do KÔMA.',
  },
  pro: {
    kicker: 'GANHE CONTROLE',
    description: 'Mais gestão para conectar equipe, cozinha, estoque e financeiro com uma taxa online menor.',
  },
  premium: {
    kicker: 'OPERE EM ESCALA',
    description: 'A experiência mais completa do KÔMA, com entregadores, fidelização e a menor taxa online da plataforma.',
  },
};

function resolvePlanId(): SubscriptionPlanId | null {
  const [, rawPlanId] = window.location.pathname.split('/').filter(Boolean);
  if (rawPlanId === 'pocket' || rawPlanId === 'pro' || rawPlanId === 'premium') return rawPlanId;
  return null;
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function formatReceiptDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'medium' }).format(date);
}

export default function PlanContractPage() {
  const planId = useMemo(resolvePlanId, []);
  const plan = useMemo(
    () => SUBSCRIPTION_PLANS.find((candidate) => candidate.id === planId),
    [planId],
  );
  const isYearly = useMemo(
    () => new URLSearchParams(window.location.search).get('cobranca') === 'anual',
    [],
  );
  const [form, setForm] = useState<ContractForm>(EMPTY_FORM);
  const [accepted, setAccepted] = useState(false);
  const [requestId] = useState(newRequestId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ContractReceipt | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = plan ? `Contratar ${plan.name} | KÔMA` : 'Escolher plano | KÔMA';
    window.scrollTo(0, 0);
  }, [plan]);

  if (!plan || !planId) {
    return (
      <div className="koma-legal-shell">
        <header className="koma-legal-header">
          <a href="/landing" className="koma-legal-brand" aria-label="Voltar para o KÔMA">
            <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
          </a>
        </header>
        <main className="koma-contract-main">
          <section className="koma-contract-panel">
            <span className="koma-legal-kicker">PLANO NÃO ENCONTRADO</span>
            <h1>Escolha uma oferta vigente.</h1>
            <p>O endereço informado não corresponde a um plano disponível para contratação.</p>
            <a href="/landing#planos" className="koma-contract-action">Ver planos <ArrowRight size={17} aria-hidden="true" /></a>
          </section>
        </main>
      </div>
    );
  }

  const pricing = getSubscriptionPricing(plan.price);
  const displayedMonthlyPrice = isYearly ? pricing.annualMonthlyEquivalent : pricing.monthly;
  const planLabel = plan.name.replace('Kôma ', '');
  const copy = CONTRACT_COPY[planId];
  const contractingTaxKind = taxIdKind(form.taxId);
  const representativeCpfValid = isValidCpf(form.representativeTaxId);
  const allFieldsFilled = Object.values(form).every((value) => value.trim().length > 0);
  const canContinue = accepted && allFieldsFilled && Boolean(contractingTaxKind) && representativeCpfValid && !isSubmitting && !receipt;

  const updateField = (field: keyof ContractForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
    setReceipt(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canContinue) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/contracts/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
        body: JSON.stringify({
          request_id: requestId,
          contracting_party_name: form.contractingPartyName.trim(),
          contracting_party_tax_id: form.taxId.trim(),
          restaurant_name: form.restaurantName.trim(),
          representative_name: form.responsibleName.trim(),
          representative_tax_id: form.representativeTaxId.trim(),
          representative_role: form.representativeRole.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          plan: planId,
          billing_cycle: isYearly ? 'anual' : 'mensal',
          powers_declared: true,
          legal_version: LEGAL_VERSION,
          legal_source_commit: LEGAL_SOURCE_COMMIT,
          legal_source_blob_sha: LEGAL_SOURCE_BLOB_SHA,
          documents: contractLegalBundle(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.detail;
        if (Array.isArray(detail)) {
          throw new Error(detail.map(item => item?.msg).filter(Boolean).join(' · ') || 'Dados inválidos.');
        }
        throw new Error(typeof detail === 'string' ? detail : 'Não foi possível registrar a contratação.');
      }
      setReceipt(payload.receipt as ContractReceipt);
      window.setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível registrar a contratação.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyProtocol = async () => {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(receipt.protocol);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="koma-legal-shell">
      <header className="koma-legal-header">
        <a href="/landing" className="koma-legal-brand" aria-label="Voltar para o KÔMA">
          <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
        </a>
        <nav aria-label="Navegação da contratação">
          <a href="/landing#planos">Ver planos</a>
          <a href="/legal">Legal e privacidade</a>
        </nav>
      </header>

      <main className="koma-contract-main">
        <div className="koma-contract-topline">
          <a href="/landing#planos"><ArrowLeft size={14} aria-hidden="true" /> Voltar aos planos</a>
          <span>Contratação online / {planLabel} / {isYearly ? 'Anual' : 'Mensal'}</span>
        </div>

        <section className="koma-contract-hero">
          <div>
            <span className="koma-legal-kicker">{copy.kicker}</span>
            <h1>KÔMA<br /><em>{planLabel.toUpperCase()}.</em></h1>
            <p>{copy.description}</p>
            <p>
              Revise a oferta, identifique corretamente o contratante e o representante e consulte os documentos que
              regerão a contratação. O aceite final gera protocolo, hashes e comprovante individual.
            </p>
          </div>
          <aside
            className="koma-contract-price"
            aria-label={`${formatCurrency(displayedMonthlyPrice)} por mês${isYearly ? ', equivalente no plano anual' : ''} e ${formatPercentage(plan.splitFeeRate)} nos pedidos online pagos`}
          >
            <span>PLANO {isYearly ? 'ANUAL' : 'MENSAL'}</span>
            <strong>{formatCurrency(displayedMonthlyPrice)}</strong>
            <small>
              {isYearly
                ? `equivalente por mês · ${formatCurrency(pricing.annualTotal)} por ano em cobrança única`
                : 'por mês'}
              {' '}+ {formatPercentage(plan.splitFeeRate)} nos pedidos online pagos elegíveis
            </small>
          </aside>
        </section>

        <form className="koma-contract-grid" onSubmit={handleSubmit}>
          <section className="koma-contract-panel" aria-labelledby="contract-data-title">
            <h2 id="contract-data-title">Dados para a contratação</h2>
            <p>Esses dados identificarão o contratante, o representante e o restaurante no aceite eletrônico.</p>

            <div className="koma-contract-fields">
              <div className="koma-contract-field">
                <label htmlFor="contracting-party-name">Nome / razão social do contratante</label>
                <input id="contracting-party-name" name="contractingPartyName" autoComplete="organization" value={form.contractingPartyName} onChange={(event) => updateField('contractingPartyName', event.target.value)} placeholder="Pessoa ou empresa que contratará o KÔMA" required disabled={Boolean(receipt)} />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="contract-tax-id">CPF / CNPJ do contratante</label>
                <input id="contract-tax-id" name="taxId" inputMode="numeric" autoComplete="off" value={form.taxId} onChange={(event) => updateField('taxId', event.target.value)} placeholder="Documento do contratante" required disabled={Boolean(receipt)} />
                {form.taxId.trim() && !contractingTaxKind && <small>Informe um CPF ou CNPJ válido, incluindo dígitos verificadores.</small>}
              </div>
              <div className="koma-contract-field">
                <label htmlFor="restaurant-name">Nome do restaurante</label>
                <input id="restaurant-name" name="restaurantName" autoComplete="organization" value={form.restaurantName} onChange={(event) => updateField('restaurantName', event.target.value)} placeholder="Nome do estabelecimento" required disabled={Boolean(receipt)} />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="responsible-name">Responsável pela contratação</label>
                <input id="responsible-name" name="responsibleName" autoComplete="name" value={form.responsibleName} onChange={(event) => updateField('responsibleName', event.target.value)} placeholder="Nome completo" required disabled={Boolean(receipt)} />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="representative-tax-id">CPF do responsável</label>
                <input id="representative-tax-id" name="representativeTaxId" inputMode="numeric" autoComplete="off" value={form.representativeTaxId} onChange={(event) => updateField('representativeTaxId', event.target.value)} placeholder="CPF do responsável pelo aceite" required disabled={Boolean(receipt)} />
                {form.representativeTaxId.trim() && !representativeCpfValid && <small>Informe um CPF válido para quem está realizando o aceite.</small>}
              </div>
              <div className="koma-contract-field">
                <label htmlFor="representative-role">Cargo / função do representante</label>
                <input id="representative-role" name="representativeRole" value={form.representativeRole} onChange={(event) => updateField('representativeRole', event.target.value)} placeholder="Ex.: proprietário, sócio, administrador" required disabled={Boolean(receipt)} />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="contract-email">E-mail oficial</label>
                <input id="contract-email" name="email" type="email" autoComplete="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="voce@restaurante.com" required disabled={Boolean(receipt)} />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="contract-phone">Telefone / WhatsApp</label>
                <input id="contract-phone" name="phone" type="tel" autoComplete="tel" value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="(00) 00000-0000" required disabled={Boolean(receipt)} />
              </div>
            </div>

            <div className="koma-contract-acceptance">
              <input id="legal-acceptance" type="checkbox" checked={accepted} disabled={Boolean(receipt)} onChange={(event) => { setAccepted(event.target.checked); setError(null); }} />
              <label htmlFor="legal-acceptance">
                Li e aceito os <a href="/legal/termos" target="_blank" rel="noreferrer">Termos de Contratação</a>,
                {' '}as <a href="/legal/planos" target="_blank" rel="noreferrer">Condições Comerciais</a> e o
                {' '}<a href="/legal/dpa" target="_blank" rel="noreferrer">Anexo de Tratamento de Dados</a>,
                todos na versão {LEGAL_VERSION}. Declaro que os dados informados são verdadeiros e que possuo poderes
                para contratar em nome do estabelecimento quando estiver atuando como representante. Declaro também
                estar ciente da <a href="/legal/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>.
              </label>
            </div>

            <button type="submit" className="koma-contract-action" disabled={!canContinue}>
              {isSubmitting ? 'Registrando aceite…' : 'Aceitar e registrar contratação'} <ArrowRight size={17} aria-hidden="true" />
            </button>
            <p className="koma-contract-note">
              Ao confirmar, o KÔMA registra a versão e os hashes dos documentos, o preço e a taxa do plano, a identidade declarada, data/hora, IP técnico e User-Agent. A assinatura SaaS não é cobrada automaticamente nesta fase.
            </p>
            {error && <div className="koma-contract-status" role="alert"><strong>Não foi possível concluir:</strong> {error}</div>}
          </section>

          <aside className="koma-contract-panel koma-contract-summary" aria-labelledby="contract-summary-title">
            <div>
              <span className="koma-legal-kicker">RESUMO</span>
              <h2 id="contract-summary-title">Sua contratação</h2>
            </div>
            <dl>
              <div><dt>Plano</dt><dd>{planLabel}</dd></div>
              <div><dt>Cobrança</dt><dd>{isYearly ? 'Anual, parcela única' : 'Mensal'}</dd></div>
              <div><dt>Mensalidade</dt><dd>{formatCurrency(displayedMonthlyPrice)}/mês{isYearly ? ' equivalente' : ''}</dd></div>
              {isYearly && <div><dt>Total anual</dt><dd>{formatCurrency(pricing.annualTotal)}/ano</dd></div>}
              <div><dt>Taxa KÔMA online</dt><dd>{formatPercentage(plan.splitFeeRate)}</dd></div>
              <div><dt>Implantação</dt><dd>R$ 0</dd></div>
              <div><dt>Trial padrão</dt><dd>7 dias sem mensalidade; taxa online continua</dd></div>
              <div><dt>Pagamento online</dt><dd>via conta do restaurante</dd></div>
              <div><dt>Prestador</dt><dd>{LEGAL_PROVIDER_NAME}</dd></div>
            </dl>

            <p className="koma-contract-note">
              O CPF e o endereço jurídico do prestador são injetados pelo backend apenas no Comprovante de Contratação individual; não ficam hardcoded no bundle público.
            </p>

            <div className="koma-contract-legal-list" aria-label="Documentos da contratação">
              <a href="/legal/termos" target="_blank" rel="noreferrer">Termos de Contratação <ExternalLink size={15} aria-hidden="true" /></a>
              <a href="/legal/planos" target="_blank" rel="noreferrer">Condições Comerciais <ExternalLink size={15} aria-hidden="true" /></a>
              <a href="/legal/dpa" target="_blank" rel="noreferrer">Anexo de Dados (DPA) <ExternalLink size={15} aria-hidden="true" /></a>
              <a href="/legal/privacidade" target="_blank" rel="noreferrer">Política de Privacidade <ExternalLink size={15} aria-hidden="true" /></a>
              <a href="/legal/suboperadores" target="_blank" rel="noreferrer">Fornecedores e transferências <ExternalLink size={15} aria-hidden="true" /></a>
            </div>

            <p className="koma-contract-note">
              No anual, o desconto de 10% incide apenas sobre a mensalidade fixa e a cobrança é feita em parcela única. A taxa KÔMA por pedido permanece a do plano selecionado. Custos do provedor de pagamento são separados.
            </p>
          </aside>
        </form>

        {receipt && (
          <section className="koma-contract-panel" aria-labelledby="receipt-title">
            <div className="koma-contract-topline">
              <span className="koma-legal-kicker">COMPROVANTE ELETRÔNICO</span>
              <span>Legal v{receipt.documents.version}</span>
            </div>
            <div className="koma-contract-status" role="status">
              <CheckCircle2 size={18} aria-hidden="true" />
              <strong>Contratação registrada.</strong> Guarde o protocolo abaixo; ele será vinculado ao seu restaurante no provisionamento.
            </div>
            <h2 id="receipt-title">Comprovante de Contratação e Licenciamento Eletrônico</h2>
            <p className="koma-contract-note">Aceito em {formatReceiptDate(receipt.acceptedAtBrasilia)} · protocolo {receipt.protocol}</p>

            <div className="koma-contract-grid">
              <div>
                <h3>Prestador</h3>
                <p>{receipt.provider.name}<br />CPF {receipt.provider.taxId}<br />{receipt.provider.address}<br />{receipt.provider.location}</p>
                <h3>Contratante</h3>
                <p>{receipt.contractingParty.name}<br />{receipt.contractingParty.taxIdKind.toUpperCase()} {receipt.contractingParty.taxId}<br />Restaurante: {receipt.contractingParty.restaurantName}<br />{receipt.contractingParty.email} · {receipt.contractingParty.phone}</p>
                <h3>Representante</h3>
                <p>{receipt.representative.name}<br />CPF {receipt.representative.taxId}<br />{receipt.representative.role}</p>
              </div>
              <div>
                <h3>Condições congeladas</h3>
                <p>Plano {receipt.commercial.plan.toUpperCase()} · {receipt.commercial.billingCycle}<br />Mensalidade-base R$ {receipt.commercial.fixedMonthlyPrice}<br />Cobrança do ciclo R$ {receipt.commercial.billingAmount}<br />Taxa online {(Number(receipt.commercial.marketplaceRate) * 100).toFixed(2).replace('.', ',')}%</p>
                <h3>Evidência técnica</h3>
                <p>Data/hora UTC: {receipt.acceptedAtUtc}<br />IP: {receipt.evidence.sourceIp}<br />Request ID: {receipt.evidence.requestId}</p>
              </div>
            </div>

            <div className="koma-contract-legal-list" aria-label="Hashes dos documentos aceitos">
              <span>Termos · <code>{receipt.documents.terms.hash}</code></span>
              <span>Condições Comerciais · <code>{receipt.documents.commercial.hash}</code></span>
              <span>DPA · <code>{receipt.documents.dpa.hash}</code></span>
              <span>Privacidade · <code>{receipt.documents.privacy.hash}</code></span>
              <span>Fonte jurídica · commit <code>{receipt.documents.sourceCommit}</code></span>
            </div>

            <div className="flex flex-wrap gap-3">
              <button type="button" className="koma-contract-action" onClick={() => void copyProtocol()}><Copy size={16} /> {copied ? 'Protocolo copiado' : 'Copiar protocolo'}</button>
              <button type="button" className="koma-contract-action" onClick={() => window.print()}><Printer size={16} /> Imprimir / salvar em PDF</button>
            </div>
            <p className="koma-contract-note">A cobrança inicial permanece manual. Este comprovante registra o aceite e não significa que já houve débito ou pagamento da mensalidade.</p>
          </section>
        )}
      </main>

      <footer className="koma-legal-footer">
        <span>© {new Date().getFullYear()} KÔMA</span>
        <nav aria-label="Links legais da contratação">
          <a href="/legal">Central legal</a>
          <a href="/legal/privacidade">Privacidade</a>
        </nav>
      </footer>
    </div>
  );
}
