import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  FileText,
  Gift,
  Info,
  Lock,
  Mail,
  Phone,
  Printer,
  QrCode,
  ShieldCheck,
  Store,
  User,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../brand/komaBrand';
import { API_BASE_URL } from '../config/api';
import {
  getSubscriptionPaymentOption,
  getSubscriptionPaymentOptions,
  type SubscriptionPaymentOptionId,
} from '../config/subscriptionPaymentOptions';
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
import './planSubscriptionFlow.css';
import './paymentOptionsCatalog.css';

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

type BillingMethod = 'credit_card' | 'pix';
type PaymentPreview = SubscriptionPaymentOptionId;

type ActivationResult = {
  restaurantId: string;
  slug?: string;
  trialDays?: number;
  trialEndsAt?: string;
};

type PixData = {
  paymentId: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
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

function resolvePlanId(): SubscriptionPlanId {
  const [, rawPlanId] = window.location.pathname.split('/').filter(Boolean);
  if (rawPlanId === 'pocket' || rawPlanId === 'pro' || rawPlanId === 'premium') return rawPlanId;
  return 'pro';
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

function addDays(base: Date, days: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date;
}

function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatReceiptDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'medium' }).format(date);
}

function contractErrorMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item && typeof item === 'object' && 'msg' in item ? String(item.msg) : ''))
      .filter(Boolean);
    if (messages.length) return messages.join(' · ');
  }
  return 'Não foi possível registrar a contratação.';
}

function PaymentOptionIcon({ optionId }: { optionId: SubscriptionPaymentOptionId }) {
  if (optionId === 'pix_annual' || optionId === 'pix_automatic') return <QrCode size={18} />;
  if (optionId === 'boleto') return <FileText size={18} />;
  return <CreditCard size={18} />;
}

export default function PlanContractPage() {
  const initialPlanId = useMemo(resolvePlanId, []);
  const initialBillingCycle = useMemo<'mensal' | 'anual'>(
    () => (new URLSearchParams(window.location.search).get('cobranca') === 'anual' ? 'anual' : 'mensal'),
    [],
  );

  const [step, setStep] = useState<1 | 2>(1);
  const [selectedPlanId, setSelectedPlanId] = useState<SubscriptionPlanId>(initialPlanId);
  const [billingCycle, setBillingCycle] = useState<'mensal' | 'anual'>(initialBillingCycle);
  const [billingMethod, setBillingMethod] = useState<BillingMethod>('credit_card');
  const [paymentPreview, setPaymentPreview] = useState<PaymentPreview | null>(null);
  const [form, setForm] = useState<ContractForm>(EMPTY_FORM);
  const [accepted, setAccepted] = useState(false);
  const [requestId] = useState(newRequestId);
  const [receipt, setReceipt] = useState<ContractReceipt | null>(null);
  const [activationResult, setActivationResult] = useState<ActivationResult | null>(null);
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExp, setCardExp] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardDoc, setCardDoc] = useState('');

  const plan = useMemo(
    () => SUBSCRIPTION_PLANS.find((candidate) => candidate.id === selectedPlanId) ?? SUBSCRIPTION_PLANS[1],
    [selectedPlanId],
  );
  const pricing = useMemo(() => getSubscriptionPricing(plan.price), [plan.price]);
  const paymentOptions = useMemo(() => getSubscriptionPaymentOptions(billingCycle), [billingCycle]);
  const creditCardOption = useMemo(() => getSubscriptionPaymentOption('credit_card'), []);
  const now = useMemo(() => new Date(), []);
  const reminderDate = useMemo(() => addDays(now, 5), [now]);
  const renewalDate = useMemo(() => addDays(now, 7), [now]);
  const contractingTaxKind = taxIdKind(form.taxId);
  const isCompany = contractingTaxKind === 'cnpj';
  const contractLocked = Boolean(receipt);

  const representativeName = isCompany ? form.responsibleName.trim() : form.contractingPartyName.trim();
  const representativeTaxId = isCompany ? form.representativeTaxId.trim() : form.taxId.trim();
  const representativeRole = isCompany ? form.representativeRole.trim() : 'Titular da contratação';
  const representativeValid = Boolean(representativeName) && isValidCpf(representativeTaxId) && Boolean(representativeRole);

  const baseFieldsValid =
    form.contractingPartyName.trim().length >= 2 &&
    Boolean(contractingTaxKind) &&
    form.restaurantName.trim().length >= 2 &&
    form.email.includes('@') &&
    form.phone.replace(/\D/g, '').length >= 8;

  const paymentFieldsValid =
    billingMethod === 'pix'
      ? billingCycle === 'anual'
      : cardNumber.replace(/\D/g, '').length >= 13 &&
        cardHolder.trim().length >= 2 &&
        /^\d{2}\/\d{2,4}$/.test(cardExp.trim()) &&
        /^\d{3,4}$/.test(cardCvv.trim());

  const canContinue =
    baseFieldsValid && representativeValid && accepted && paymentFieldsValid && !isSubmitting && !activationResult && !pixData;

  const amountDueToday = billingMethod === 'pix' && billingCycle === 'anual' ? pricing.annualTotal : 0;
  const nextChargeAmount = billingCycle === 'anual' ? pricing.annualTotal : pricing.monthly;

  const paymentPreviewDetails = useMemo(() => {
    if (!paymentPreview) return null;
    const option = getSubscriptionPaymentOption(paymentPreview);
    return {
      title: option.previewTitle,
      text: option.previewDescription,
    };
  }, [paymentPreview]);

  useEffect(() => {
    document.title = `Contratar ${plan.name} | KÔMA`;
  }, [plan.name]);

  useEffect(() => {
    if (billingCycle === 'mensal' && billingMethod === 'pix') setBillingMethod('credit_card');
    setPaymentPreview(null);
  }, [billingCycle, billingMethod]);

  useEffect(() => {
    if (contractLocked) return;
    const params = new URLSearchParams(window.location.search);
    params.set('cobranca', billingCycle);
    window.history.replaceState(null, '', `/contratar/${selectedPlanId}?${params.toString()}`);
  }, [billingCycle, selectedPlanId, contractLocked]);

  useEffect(() => {
    if (!receipt || !pixData || activationResult) return;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/contracts/${receipt.protocol}/billing/status`);
        if (!response.ok) return;
        const payload = await response.json();
        if (payload.isActivated && payload.restaurantId) {
          setActivationResult({ restaurantId: String(payload.restaurantId) });
        }
      } catch {
        // A confirmação também pode ser verificada manualmente; mantemos o polling silencioso.
      }
    }, 5000);
    return () => window.clearInterval(poll);
  }, [receipt, pixData, activationResult]);

  const updateField = (field: keyof ContractForm, value: string) => {
    if (contractLocked) return;
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  };

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const createAcceptance = async (): Promise<ContractReceipt> => {
    if (receipt) return receipt;

    const response = await fetch(`${API_BASE_URL}/api/contracts/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
      body: JSON.stringify({
        request_id: requestId,
        contracting_party_name: form.contractingPartyName.trim(),
        contracting_party_tax_id: form.taxId.trim(),
        restaurant_name: form.restaurantName.trim(),
        representative_name: representativeName,
        representative_tax_id: representativeTaxId,
        representative_role: representativeRole,
        email: form.email.trim(),
        phone: form.phone.trim(),
        plan: selectedPlanId,
        billing_cycle: billingCycle,
        powers_declared: true,
        legal_version: LEGAL_VERSION,
        legal_source_commit: LEGAL_SOURCE_COMMIT,
        legal_source_blob_sha: LEGAL_SOURCE_BLOB_SHA,
        documents: contractLegalBundle(),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(contractErrorMessage(payload?.detail));
    const nextReceipt = payload.receipt as ContractReceipt;
    setReceipt(nextReceipt);
    return nextReceipt;
  };

  const tokenizeCard = async (): Promise<string> => {
    const mpPublicKey = (import.meta.env.VITE_MERCADO_PAGO_PUBLIC_KEY as string | undefined)?.trim();
    if (!mpPublicKey || (!mpPublicKey.startsWith('TEST-') && !mpPublicKey.startsWith('APP_USR-'))) {
      throw new Error('Pagamento por cartão está temporariamente indisponível: a chave pública do Mercado Pago não está configurada.');
    }

    const cleanCardNumber = cardNumber.replace(/\D/g, '');
    const [expMonth, expYear] = cardExp.split('/').map((value) => value.trim());
    const cleanDoc = (cardDoc || representativeTaxId || form.taxId).replace(/\D/g, '');
    const response = await fetch(
      `https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(mpPublicKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_number: cleanCardNumber,
          expiration_month: Number.parseInt(expMonth || '0', 10),
          expiration_year: expYear?.length === 2 ? Number.parseInt(`20${expYear}`, 10) : Number.parseInt(expYear || '0', 10),
          security_code: cardCvv.trim(),
          cardholder: {
            name: cardHolder.trim(),
            identification: {
              type: cleanDoc.length > 11 ? 'CNPJ' : 'CPF',
              number: cleanDoc,
            },
          },
        }),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.id) {
      const message = payload?.cause?.[0]?.description || payload?.message || 'Não foi possível autorizar o cartão.';
      throw new Error(message);
    }
    return String(payload.id);
  };

  const handleCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canContinue) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const activeReceipt = await createAcceptance();

      if (billingMethod === 'credit_card') {
        const cardTokenId = await tokenizeCard();
        const response = await fetch(`${API_BASE_URL}/api/contracts/${activeReceipt.protocol}/billing/setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payment_method_type: 'credit_card',
            card_token_id: cardTokenId,
            payer_email: form.email.trim(),
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail || 'Falha ao autorizar o pagamento do plano.');
        setActivationResult({
          restaurantId: String(payload.restaurantId),
          slug: payload.slug || undefined,
          trialDays: payload.trialDays || 7,
          trialEndsAt: payload.trialEndsAt || undefined,
        });
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/contracts/${activeReceipt.protocol}/billing/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_method_type: 'pix',
          payer_email: form.email.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail || 'Falha ao gerar o Pix anual.');
      setPixData({
        paymentId: String(payload.paymentId),
        qrCode: payload.qrCode || null,
        qrCodeBase64: payload.qrCodeBase64 || null,
        ticketUrl: payload.ticketUrl || null,
        expiresAt: payload.expiresAt || null,
      });
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Não foi possível processar a contratação.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (activationResult && receipt) {
    return (
      <div className="koma-sub-wrapper">
        <header className="koma-sub-header">
          <a href="/landing" className="koma-sub-brand" aria-label="Voltar para o KÔMA">
            <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
          </a>
          <span className="koma-sub-secure"><ShieldCheck size={15} /> Ativação segura</span>
        </header>

        <main className="koma-sub-success-page">
          <section className="koma-sub-success-card">
            <span className="koma-sub-success-icon"><CheckCircle2 size={32} /></span>
            <span className="koma-sub-eyebrow">CONTRATAÇÃO CONCLUÍDA</span>
            <h1>Seu KÔMA está pronto.</h1>
            <p>
              O restaurante foi provisionado com sucesso. {billingMethod === 'credit_card'
                ? `Seu período de ${activationResult.trialDays || 7} dias sem mensalidade fixa já começou.`
                : 'O pagamento Pix foi confirmado e a ativação foi concluída.'}
            </p>

            {activationResult.trialEndsAt && (
              <div className="koma-sub-success-detail">
                <span>Período sem mensalidade fixa até</span>
                <strong>{formatReceiptDate(activationResult.trialEndsAt)}</strong>
              </div>
            )}
            {activationResult.slug && (
              <div className="koma-sub-success-detail">
                <span>Endereço do estabelecimento</span>
                <strong>https://{activationResult.slug}.koma.com.br</strong>
              </div>
            )}

            <a href="/ativar" className="koma-sub-primary-action">Concluir primeiro acesso <ArrowRight size={18} /></a>
            <button type="button" className="koma-sub-text-action" onClick={() => setShowReceipt((current) => !current)}>
              <FileText size={16} /> {showReceipt ? 'Ocultar comprovante' : 'Ver comprovante de contratação'}
            </button>
          </section>

          {showReceipt && (
            <section className="koma-sub-receipt" aria-label="Comprovante de contratação">
              <div className="koma-sub-receipt-head">
                <div>
                  <span className="koma-sub-eyebrow">COMPROVANTE ELETRÔNICO</span>
                  <h2>Comprovante de Contratação e Licenciamento Eletrônico</h2>
                </div>
                <span>Legal v{receipt.documents.version}</span>
              </div>
              <div className="koma-sub-receipt-grid">
                <div>
                  <strong>Contratante</strong>
                  <p>{receipt.contractingParty.name}<br />{receipt.contractingParty.taxIdKind.toUpperCase()} {receipt.contractingParty.taxId}<br />{receipt.contractingParty.restaurantName}</p>
                </div>
                <div>
                  <strong>Condições congeladas</strong>
                  <p>Plano {receipt.commercial.plan.toUpperCase()} · {receipt.commercial.billingCycle}<br />Mensalidade-base R$ {receipt.commercial.fixedMonthlyPrice}<br />Taxa online {(Number(receipt.commercial.marketplaceRate) * 100).toFixed(2).replace('.', ',')}%</p>
                </div>
                <div>
                  <strong>Protocolo e evidência</strong>
                  <p>{receipt.protocol}<br />Aceito em {formatReceiptDate(receipt.acceptedAtBrasilia)}<br />IP técnico: {receipt.evidence.sourceIp}</p>
                </div>
                <div>
                  <strong>Documentos</strong>
                  <p>Termos: {receipt.documents.terms.hash}<br />Condições: {receipt.documents.commercial.hash}</p>
                </div>
              </div>
              <div className="koma-sub-receipt-actions">
                <button type="button" onClick={() => void copyValue(receipt.protocol)}><Copy size={16} /> {copied ? 'Copiado' : 'Copiar protocolo'}</button>
                <button type="button" onClick={() => window.print()}><Printer size={16} /> Imprimir / salvar em PDF</button>
              </div>
            </section>
          )}
        </main>
      </div>
    );
  }

  if (pixData && receipt) {
    return (
      <div className="koma-sub-wrapper">
        <header className="koma-sub-header">
          <a href="/landing" className="koma-sub-brand" aria-label="Voltar para o KÔMA">
            <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
          </a>
          <span className="koma-sub-secure"><ShieldCheck size={15} /> Pagamento seguro</span>
        </header>

        <main className="koma-sub-pix-page">
          <section className="koma-sub-pix-card">
            <span className="koma-sub-eyebrow">PIX ANUAL · AGUARDANDO CONFIRMAÇÃO</span>
            <h1>Finalize o pagamento para ativar o restaurante.</h1>
            <p>
              O Pix é uma cobrança anual antecipada de <strong>{formatCurrency(pricing.annualTotal)}</strong>. A ativação acontece automaticamente após a confirmação do pagamento.
            </p>
            {pixData.qrCode && (
              <div className="koma-sub-qr">
                <QRCodeSVG value={pixData.qrCode} size={220} />
              </div>
            )}
            {pixData.qrCode && (
              <button type="button" className="koma-sub-primary-action" onClick={() => void copyValue(pixData.qrCode || '')}>
                <Copy size={17} /> {copied ? 'Código Pix copiado' : 'Copiar código Pix'}
              </button>
            )}
            {pixData.ticketUrl && (
              <a href={pixData.ticketUrl} target="_blank" rel="noreferrer" className="koma-sub-text-link">Abrir página do pagamento</a>
            )}
            <div className="koma-sub-pix-status"><Info size={17} /> Estamos verificando a confirmação automaticamente.</div>
            <button type="button" className="koma-sub-text-action" onClick={() => setShowReceipt((current) => !current)}>
              <FileText size={16} /> {showReceipt ? 'Ocultar comprovante' : 'Ver comprovante da contratação'}
            </button>
          </section>

          {showReceipt && (
            <section className="koma-sub-receipt">
              <div className="koma-sub-receipt-head">
                <div>
                  <span className="koma-sub-eyebrow">CONTRATO REGISTRADO</span>
                  <h2>{receipt.protocol}</h2>
                </div>
                <span>{formatReceiptDate(receipt.acceptedAtBrasilia)}</span>
              </div>
              <p className="koma-sub-receipt-note">O comprovante foi registrado antes da geração do Pix e permanece vinculado a esta tentativa de pagamento.</p>
            </section>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="koma-sub-wrapper">
      <header className="koma-sub-header">
        <a href="/landing" className="koma-sub-brand" aria-label="Voltar para o KÔMA">
          <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
        </a>
        <nav className="koma-sub-nav" aria-label="Navegação da contratação">
          <a href="/landing#planos">Ver planos</a>
          <a href="/legal">Legal e privacidade</a>
          <span className="koma-sub-secure"><ShieldCheck size={14} /> Conexão segura</span>
        </nav>
      </header>

      <main className="koma-sub-container">
        <section className="koma-sub-main">
          {step === 1 ? (
            <>
              <div className="koma-sub-heading">
                <span className="koma-sub-eyebrow">01 · PLANO E COBRANÇA</span>
                <h1>Escolha o KÔMA certo para sua operação.</h1>
                <p>Compare preço, taxa online e recursos. Você pode trocar de plano aqui sem voltar para a landing page.</p>
              </div>

              <div className="koma-sub-plan-grid" role="radiogroup" aria-label="Escolha um plano KÔMA">
                {SUBSCRIPTION_PLANS.map((candidate) => {
                  const candidatePricing = getSubscriptionPricing(candidate.price);
                  const selected = candidate.id === selectedPlanId;
                  const displayedPrice = billingCycle === 'anual' ? candidatePricing.annualMonthlyEquivalent : candidatePricing.monthly;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`koma-sub-plan-card ${selected ? 'is-selected' : ''}`}
                      onClick={() => setSelectedPlanId(candidate.id)}
                    >
                      <div className="koma-sub-plan-top">
                        <span>{candidate.name.replace('Kôma ', '')}</span>
                        {candidate.recommended && <em>Recomendado</em>}
                      </div>
                      <strong>{formatCurrency(displayedPrice)}<small>/mês{billingCycle === 'anual' ? ' equiv.' : ''}</small></strong>
                      <p>{candidate.tagline}</p>
                      <span className="koma-sub-fee">{formatPercentage(candidate.splitFeeRate)} por pedido online pago</span>
                      <ul>
                        {candidate.features.slice(0, 3).map((feature) => (
                          <li key={feature}><Check size={14} /> {feature}</li>
                        ))}
                      </ul>
                    </button>
                  );
                })}
              </div>

              <div className="koma-sub-billing-selector" role="radiogroup" aria-label="Ciclo de cobrança">
                <button type="button" role="radio" aria-checked={billingCycle === 'mensal'} className={billingCycle === 'mensal' ? 'is-selected' : ''} onClick={() => setBillingCycle('mensal')}>
                  <span>Mensal</span>
                  <strong>{formatCurrency(pricing.monthly)}/mês</strong>
                  <small>Flexível, renovação mensal.</small>
                </button>
                <button type="button" role="radio" aria-checked={billingCycle === 'anual'} className={billingCycle === 'anual' ? 'is-selected' : ''} onClick={() => setBillingCycle('anual')}>
                  <span>Anual <em>Economize 10%</em></span>
                  <strong>{formatCurrency(pricing.annualMonthlyEquivalent)}/mês equivalente</strong>
                  <small>{formatCurrency(pricing.annualTotal)} no ano · economia de {formatCurrency(pricing.annualSavings)}. Valor mensal equivalente não representa 12 parcelas.</small>
                </button>
              </div>

              <div className="koma-sub-trial-note">
                <Gift size={19} />
                <div>
                  <strong>7 dias sem mensalidade fixa no cartão.</strong>
                  <p>A taxa KÔMA sobre pedidos online continua aplicável durante o período de teste.</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <button type="button" className="koma-sub-back" onClick={() => setStep(1)} disabled={contractLocked}>
                <ArrowLeft size={16} /> {contractLocked ? 'Plano congelado nesta contratação' : 'Voltar para plano e cobrança'}
              </button>

              <div className="koma-sub-heading">
                <span className="koma-sub-eyebrow">02 · DADOS E PAGAMENTO</span>
                <h1>Ative seu restaurante.</h1>
                <p>Use um método disponível agora ou explore as próximas formas de pagamento. Landing e checkout usam o mesmo catálogo de disponibilidade.</p>
              </div>

              {error && <div className="koma-sub-error" role="alert"><Info size={18} /> {error}</div>}
              {contractLocked && (
                <div className="koma-sub-locked-note"><Lock size={17} /> O aceite jurídico já foi registrado. Você pode corrigir ou trocar apenas a forma de pagamento nesta tentativa.</div>
              )}

              <form id="koma-checkout-form" className="koma-sub-form" onSubmit={handleCheckout}>
                <section className="koma-sub-section-card">
                  <div className="koma-sub-section-title">
                    <span><Building2 size={18} /></span>
                    <div><h2>Contratante e restaurante</h2><p>Dados usados no contrato eletrônico e no provisionamento do tenant.</p></div>
                  </div>

                  <div className="koma-sub-form-grid">
                    <label className="koma-sub-field koma-sub-field-full">
                      <span>Nome completo / Razão social</span>
                      <div><User size={16} /><input value={form.contractingPartyName} onChange={(event) => updateField('contractingPartyName', event.target.value)} placeholder="Pessoa ou empresa contratante" disabled={contractLocked} required /></div>
                    </label>
                    <label className="koma-sub-field">
                      <span>CPF / CNPJ</span>
                      <div><FileText size={16} /><input value={form.taxId} onChange={(event) => updateField('taxId', event.target.value)} placeholder="Documento do contratante" inputMode="numeric" disabled={contractLocked} required /></div>
                      {form.taxId.trim() && !contractingTaxKind && <small className="is-error">Informe um CPF ou CNPJ válido.</small>}
                    </label>
                    <label className="koma-sub-field">
                      <span>Nome do restaurante</span>
                      <div><Store size={16} /><input value={form.restaurantName} onChange={(event) => updateField('restaurantName', event.target.value)} placeholder="Nome do estabelecimento" disabled={contractLocked} required /></div>
                    </label>
                    <label className="koma-sub-field">
                      <span>E-mail</span>
                      <div><Mail size={16} /><input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="voce@restaurante.com" disabled={contractLocked} required /></div>
                    </label>
                    <label className="koma-sub-field">
                      <span>Telefone / WhatsApp</span>
                      <div><Phone size={16} /><input type="tel" value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="(00) 00000-0000" disabled={contractLocked} required /></div>
                    </label>
                  </div>

                  {isCompany && (
                    <div className="koma-sub-representative">
                      <div className="koma-sub-section-title compact">
                        <span><User size={17} /></span>
                        <div><h3>Responsável pelo aceite</h3><p>Como o contratante é um CNPJ, precisamos identificar a pessoa física que possui poderes para contratar.</p></div>
                      </div>
                      <div className="koma-sub-form-grid">
                        <label className="koma-sub-field koma-sub-field-full">
                          <span>Nome completo do responsável</span>
                          <div><User size={16} /><input value={form.responsibleName} onChange={(event) => updateField('responsibleName', event.target.value)} placeholder="Nome do representante" disabled={contractLocked} required /></div>
                        </label>
                        <label className="koma-sub-field">
                          <span>CPF do responsável</span>
                          <div><FileText size={16} /><input value={form.representativeTaxId} onChange={(event) => updateField('representativeTaxId', event.target.value)} placeholder="CPF do representante" inputMode="numeric" disabled={contractLocked} required /></div>
                          {form.representativeTaxId.trim() && !isValidCpf(form.representativeTaxId) && <small className="is-error">Informe um CPF válido.</small>}
                        </label>
                        <label className="koma-sub-field">
                          <span>Cargo / função</span>
                          <div><Building2 size={16} /><input value={form.representativeRole} onChange={(event) => updateField('representativeRole', event.target.value)} placeholder="Ex.: proprietário, sócio, administrador" disabled={contractLocked} required /></div>
                        </label>
                      </div>
                    </div>
                  )}
                </section>

                <section className="koma-sub-section-card">
                  <div className="koma-sub-section-title">
                    <span><CreditCard size={18} /></span>
                    <div><h2>Forma de pagamento</h2><p>Somente métodos marcados como Disponível podem gerar cobrança. Os demais são previews informativos do roadmap de pagamentos.</p></div>
                  </div>

                  <div className="koma-sub-methods" role="radiogroup" aria-label="Forma de pagamento disponível">
                    <button type="button" role="radio" aria-checked={billingMethod === 'credit_card'} className={billingMethod === 'credit_card' ? 'is-selected' : ''} onClick={() => { setBillingMethod('credit_card'); setPaymentPreview(null); }}>
                      <span className="koma-sub-method-radio" />
                      <CreditCard size={19} />
                      <div><strong>{creditCardOption.label}</strong><small>{billingCycle === 'anual' ? `R$ 0 hoje · ${formatCurrency(pricing.annualTotal)} após 7 dias` : `R$ 0 hoje · ${formatCurrency(pricing.monthly)} após 7 dias`}</small></div>
                    </button>
                  </div>

                  {billingMethod === 'credit_card' && (
                    <div className="koma-sub-card-fields">
                      <label className="koma-sub-field koma-sub-field-full">
                        <span>Número do cartão</span>
                        <div><CreditCard size={16} /><input value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} inputMode="numeric" placeholder="0000 0000 0000 0000" required /></div>
                      </label>
                      <label className="koma-sub-field koma-sub-field-full">
                        <span>Nome impresso no cartão</span>
                        <div><User size={16} /><input value={cardHolder} onChange={(event) => setCardHolder(event.target.value)} placeholder="Como consta no cartão" required /></div>
                      </label>
                      <label className="koma-sub-field">
                        <span>Validade</span>
                        <div><Info size={16} /><input value={cardExp} onChange={(event) => setCardExp(event.target.value)} placeholder="MM/AA" maxLength={7} required /></div>
                      </label>
                      <label className="koma-sub-field">
                        <span>CVV</span>
                        <div><Lock size={16} /><input type="password" value={cardCvv} onChange={(event) => setCardCvv(event.target.value)} inputMode="numeric" placeholder="123" maxLength={4} required /></div>
                      </label>
                      <label className="koma-sub-field koma-sub-field-full">
                        <span>CPF/CNPJ do titular do cartão <small>(opcional se for o mesmo responsável)</small></span>
                        <div><FileText size={16} /><input value={cardDoc} onChange={(event) => setCardDoc(event.target.value)} inputMode="numeric" placeholder="Documento do titular" /></div>
                      </label>
                    </div>
                  )}

                  <div className="koma-sub-coming-payments" aria-label="Próximas formas de pagamento">
                    <div className="koma-sub-coming-head">
                      <strong>Mais formas para facilitar a adesão</strong>
                      <small>O status vem do catálogo canônico. Previews indisponíveis nunca criam pagamento real.</small>
                    </div>
                    <div className="koma-sub-coming-grid">
                      {paymentOptions
                        .filter((option) => option.id !== 'credit_card')
                        .map((option) => (
                          <button
                            type="button"
                            key={option.id}
                            className={`koma-sub-coming-method ${paymentPreview === option.id ? 'is-previewing' : ''}`}
                            aria-pressed={paymentPreview === option.id}
                            onClick={() => setPaymentPreview(option.id)}
                          >
                            <PaymentOptionIcon optionId={option.id} />
                            <span><strong>{option.label}</strong><small>{option.checkoutSummary}</small></span>
                            <em className={`koma-sub-method-badge ${option.status === 'study' ? 'is-study' : ''}`}>{option.statusLabel}</em>
                          </button>
                        ))}
                    </div>
                    {paymentPreviewDetails && (
                      <div className="koma-sub-payment-preview" role="status">
                        <Info size={19} />
                        <div><strong>{paymentPreviewDetails.title}</strong><p>{paymentPreviewDetails.text} <b>O cartão continua sendo o método selecionado e disponível nesta etapa.</b></p></div>
                      </div>
                    )}
                  </div>
                </section>

                <section className="koma-sub-legal-acceptance">
                  <input id="legal-acceptance" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={contractLocked} required />
                  <label htmlFor="legal-acceptance">
                    Declaro que as informações estão corretas, que <strong>possuo poderes</strong> para contratar em nome do estabelecimento e aceito os <a href="/legal/termos" target="_blank" rel="noreferrer">Termos de Contratação</a>, as <a href="/legal/planos" target="_blank" rel="noreferrer">Condições Comerciais</a>, o <a href="/legal/dpa" target="_blank" rel="noreferrer">Anexo de Tratamento de Dados</a> e a <a href="/legal/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>, versão {LEGAL_VERSION}.
                  </label>
                </section>
              </form>
            </>
          )}
        </section>

        <aside className="koma-sub-sidebar">
          <section className="koma-sub-summary-card">
            <span className="koma-sub-eyebrow">SUA CONTRATAÇÃO</span>
            <div className="koma-sub-summary-plan">
              <div><strong>{plan.name.replace('Kôma ', '')}</strong><span>{billingCycle === 'anual' ? 'Plano anual' : 'Plano mensal'}</span></div>
              <span className="koma-sub-summary-price">{billingCycle === 'anual' ? `${formatCurrency(pricing.annualMonthlyEquivalent)}/mês equiv.` : `${formatCurrency(pricing.monthly)}/mês`}</span>
            </div>
            <dl className="koma-sub-summary-list">
              {billingCycle === 'anual' && <div><dt>Total anual</dt><dd>{formatCurrency(pricing.annualTotal)}</dd></div>}
              {billingCycle === 'anual' && <div><dt>Economia anual</dt><dd>{formatCurrency(pricing.annualSavings)}</dd></div>}
              <div><dt>Taxa KÔMA online</dt><dd>{formatPercentage(plan.splitFeeRate)}</dd></div>
              <div><dt>Implantação</dt><dd>R$ 0</dd></div>
              <div><dt>Prestador</dt><dd>{LEGAL_PROVIDER_NAME}</dd></div>
            </dl>
          </section>

          <section className="koma-sub-summary-card">
            <div className="koma-sub-timeline">
              <div>
                <span className="is-active"><Gift size={16} /></span>
                <div><strong>Hoje</strong><p>{billingMethod === 'pix' && billingCycle === 'anual' ? `Pagamento Pix de ${formatCurrency(amountDueToday)}` : 'R$ 0 de mensalidade fixa no cartão'}</p></div>
              </div>
              <div>
                <span><Info size={16} /></span>
                <div><strong>{formatDisplayDate(reminderDate)}</strong><p>{billingMethod === 'pix' ? 'Pix confirmado: ativação acontece automaticamente.' : 'Lembrete antes do fim do período sem mensalidade.'}</p></div>
              </div>
              <div>
                <span><CreditCard size={16} /></span>
                <div><strong>{billingMethod === 'pix' ? 'Após confirmação' : formatDisplayDate(renewalDate)}</strong><p>{billingMethod === 'pix' ? 'Restaurante liberado para o primeiro acesso.' : `Primeira cobrança: ${formatCurrency(nextChargeAmount)}.`}</p></div>
              </div>
            </div>

            <div className="koma-sub-due-row"><span>A pagar hoje</span><strong>{formatCurrency(amountDueToday)}</strong></div>
            {billingMethod === 'credit_card' && <p className="koma-sub-summary-note">7 dias sem mensalidade fixa. A taxa por pedidos online pagos continua aplicável.</p>}
            {billingMethod === 'pix' && <p className="koma-sub-summary-note">Pix disponível apenas no anual antecipado.</p>}

            {step === 1 ? (
              <button type="button" className="koma-sub-primary-action" onClick={() => { setStep(2); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                Continuar <ArrowRight size={18} />
              </button>
            ) : (
              <button type="submit" form="koma-checkout-form" className="koma-sub-primary-action" disabled={!canContinue} aria-label="Aceitar e registrar contratação">
                {isSubmitting ? 'Processando…' : billingMethod === 'pix' ? 'Gerar Pix anual' : 'Ativar 7 dias grátis'} <ArrowRight size={18} />
              </button>
            )}
            <p className="koma-sub-fineprint">O aceite registra protocolo, hashes dos documentos, condições comerciais e evidências técnicas da contratação.</p>
          </section>
        </aside>
      </main>
    </div>
  );
}
