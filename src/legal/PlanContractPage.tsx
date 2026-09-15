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
  ShieldCheck,
  Store,
  User,
  Wallet,
} from 'lucide-react';
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

type BillingMethod = 'credit_card' | 'pix_automatic' | 'account_money';

type ActivationResult = {
  restaurantId?: string;
  status?: 'ready' | 'awaiting_release';
  message?: string;
  slug?: string;
  trialDays?: number;
  trialEndsAt?: string;
  activationToken?: string;
};

type BillingCapabilities = {
  credit_card: boolean;
  pix_automatic: boolean;
  account_money?: boolean;
  pix?: boolean;
  publicKey: string;
  environment?: string;
  isTestMode?: boolean;
  trialDays?: number;
  upfrontPaymentAllowed?: boolean;
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

export default function PlanContractPage() {
  const initialPlanId = useMemo(resolvePlanId, []);
  const initialBillingCycle = useMemo<'mensal' | 'anual'>(
    () => (new URLSearchParams(window.location.search).get('cobranca') === 'anual' ? 'anual' : 'mensal'),
    [],
  );
  const returnedFromHostedCheckout = useMemo(() => {
    const ret = new URLSearchParams(window.location.search).get('retorno');
    return ret === 'pix-automatico' || ret === 'saldo-mercadopago' || ret === 'account-money';
  }, []);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedPlanId, setSelectedPlanId] = useState<SubscriptionPlanId>(initialPlanId);
  const [billingCycle, setBillingCycle] = useState<'mensal' | 'anual'>(initialBillingCycle);
  const [billingMethod, setBillingMethod] = useState<BillingMethod>('credit_card');
  const [form, setForm] = useState<ContractForm>(EMPTY_FORM);
  const [accepted, setAccepted] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);
  const [signupToken, setSignupToken] = useState('');
  const [signupNotice, setSignupNotice] = useState('');
  const [capabilities, setCapabilities] = useState<BillingCapabilities>({
    credit_card: false,
    pix_automatic: false,
    account_money: false,
    publicKey: '',
  });
  const [receipt, setReceipt] = useState<ContractReceipt | null>(null);
  const [activationResult, setActivationResult] = useState<ActivationResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingBilling, setIsCheckingBilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExp, setCardExp] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardDoc, setCardDoc] = useState('');

  const activePlanId = useMemo<SubscriptionPlanId>(() => {
    if (receipt) {
      const p = receipt.commercial.plan.toLowerCase().trim();
      if (p === 'pocket' || p === 'pro' || p === 'premium') return p;
    }
    return selectedPlanId;
  }, [receipt, selectedPlanId]);

  const activeBillingCycle = useMemo<'mensal' | 'anual'>(() => {
    if (receipt) {
      const c = receipt.commercial.billingCycle.toLowerCase().trim();
      return c === 'anual' || c === 'annual' ? 'anual' : 'mensal';
    }
    return billingCycle;
  }, [receipt, billingCycle]);

  const plan = useMemo(
    () => SUBSCRIPTION_PLANS.find((candidate) => candidate.id === activePlanId) ?? SUBSCRIPTION_PLANS[1],
    [activePlanId],
  );
  const pricing = useMemo(() => getSubscriptionPricing(plan.price), [plan.price]);
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

  const cardFieldsValid =
    cardNumber.replace(/\D/g, '').length >= 13 &&
    cardHolder.trim().length >= 2 &&
    /^\d{2}\/\d{2,4}$/.test(cardExp.trim()) &&
    /^\d{3,4}$/.test(cardCvv.trim());

  const paymentFieldsValid = billingMethod === 'pix_automatic' || billingMethod === 'account_money' || cardFieldsValid;
  const methodAvailable =
    billingMethod === 'credit_card'
      ? capabilities.credit_card
      : billingMethod === 'pix_automatic'
        ? capabilities.pix_automatic
        : Boolean(capabilities.account_money);
  const canContinue =
    methodAvailable &&
    ((baseFieldsValid && representativeValid && accepted) || Boolean(receipt)) &&
    paymentFieldsValid &&
    !isSubmitting &&
    !activationResult;

  const amountDueToday = 0;
  const nextChargeAmount = activeBillingCycle === 'anual' ? pricing.annualTotal : pricing.monthly;
  const billingMethodLabel =
    billingMethod === 'pix_automatic'
      ? 'Pix Automático via Mercado Pago'
      : billingMethod === 'account_money'
        ? 'Saldo Mercado Pago'
        : 'cartão de crédito';

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/api/contracts/payment-methods`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const payload = await response.json();
        setCapabilities({
          credit_card: Boolean(payload.credit_card),
          pix_automatic: Boolean(payload.pix_automatic),
          account_money: Boolean(payload.account_money),
          pix: Boolean(payload.pix),
          publicKey: String(payload.publicKey || ''),
          environment: payload.environment,
          isTestMode: Boolean(payload.isTestMode),
          trialDays: Number(payload.trialDays || 7),
          upfrontPaymentAllowed: Boolean(payload.upfrontPaymentAllowed),
        });
      })
      .catch(() => { /* Cadastro segue disponível mesmo sem billing. */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.title = `Contratar ${plan.name} | KÔMA`;
  }, [plan.name]);

  useEffect(() => {
    if (contractLocked) return;
    const params = new URLSearchParams(window.location.search);
    params.set('cobranca', billingCycle);
    params.delete('retorno');
    window.history.replaceState(null, '', `/contratar/${selectedPlanId}?${params.toString()}`);
  }, [billingCycle, selectedPlanId, contractLocked]);

  useEffect(() => {
    const controller = new AbortController();
    let token = '';
    try { token = localStorage.getItem('koma_signup_resume') || ''; } catch { /* Storage opcional. */ }
    if (token) {
      fetch(`${API_BASE_URL}/api/signups/current`, {
        headers: { 'X-Signup-Token': token },
        signal: controller.signal,
      })
        .then(async response => {
          if (!response.ok) {
            if (response.status === 404) {
              try { localStorage.removeItem('koma_signup_resume'); } catch { /* Storage opcional. */ }
            }
            return;
          }
          const saved = await response.json();
          setSignupToken(token);
          setRequestId(saved.id);
          setSelectedPlanId(saved.data.plan);
          setBillingCycle(saved.data.billing_cycle);
          setForm(previous => ({
            ...previous,
            restaurantName: saved.data.restaurant_name,
            responsibleName: saved.data.responsible_name,
            contractingPartyName: saved.data.responsible_name,
            email: saved.data.email,
            phone: saved.data.phone,
          }));
          if (saved.receipt) {
            setReceipt(saved.receipt);
            setAccepted(true);
            setSelectedPlanId(saved.receipt.commercial.plan);
            setBillingCycle(saved.receipt.commercial.billingCycle);
            setForm(previous => ({
              ...previous,
              contractingPartyName: saved.receipt.contractingParty.name,
              restaurantName: saved.receipt.contractingParty.restaurantName,
              taxId: saved.receipt.contractingParty.taxId,
              email: saved.receipt.contractingParty.email,
              phone: saved.receipt.contractingParty.phone,
              responsibleName: saved.receipt.representative.name,
              representativeTaxId: saved.receipt.representative.taxId,
              representativeRole: saved.receipt.representative.role,
            }));
          }
          if (saved.activation) setActivationResult(saved.activation);
          setStep(3);
          setSignupNotice(
            returnedFromHostedCheckout
              ? 'Autorização retornada pelo Mercado Pago. Estamos confirmando a autorização recorrente e nenhuma mensalidade fixa será cobrada antes do fim dos 7 dias grátis.'
              : 'Encontramos uma inscrição salva. Você pode continuar ou usar “Trocar plano ou ciclo” para iniciar outra contratação sem redigitar seus dados.',
          );
        })
        .catch(() => { /* Novo cadastro continua possível. */ });
    }
    return () => controller.abort();
  }, [returnedFromHostedCheckout]);

  useEffect(() => {
    if (!receipt || activationResult) return;
    const poll = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`${API_BASE_URL}/api/contracts/${receipt.protocol}/billing/status`);
        if (!response.ok) return;
        const payload = await response.json();
        if (payload.billingStatus === 'ready' && !payload.isActivated) {
          setActivationResult({
            status: 'awaiting_release',
            message: 'Autorização recorrente confirmada. A contratação segue para liberação pela equipe KÔMA.',
          });
          return;
        }
        if (payload.isActivated && payload.restaurantId) {
          if (signupToken) {
            const resumed = await fetch(`${API_BASE_URL}/api/signups/current`, {
              headers: { 'X-Signup-Token': signupToken },
            });
            const saved = resumed.ok ? await resumed.json() : null;
            setActivationResult(saved?.activation || { restaurantId: String(payload.restaurantId), slug: payload.slug });
          } else {
            setActivationResult({ restaurantId: String(payload.restaurantId), slug: payload.slug });
          }
        }
      } catch {
        // Polling silencioso; o estado também é recuperável ao recarregar.
      }
    }, 5000);
    return () => window.clearInterval(poll);
  }, [receipt, activationResult, signupToken]);

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

  const handleSwitchPlanOrCycle = async () => {
    if (!receipt) {
      setStep(1);
      return;
    }
    setIsCheckingBilling(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/contracts/${receipt.protocol}/billing/status`);
      if (response.ok) {
        const payload = await response.json();
        const billingStatus = String(payload.billingStatus || '').trim().toLowerCase();
        const hasActiveBilling =
          Boolean(payload.isActivated) ||
          Boolean(payload.restaurantId) ||
          (Boolean(payload.paymentMethodType) && (billingStatus === 'pending' || billingStatus === 'ready'));
        if (hasActiveBilling) {
          setError('Esta contratação ainda possui uma autorização financeira em andamento. Cancele essa autorização antes de iniciar outro plano ou ciclo.');
          return;
        }
      } else if (response.status !== 404) {
        setError('Não foi possível verificar o status da autorização financeira. Tente novamente.');
        return;
      }
    } catch {
      setError('Falha de conexão ao verificar a autorização financeira. Tente novamente.');
      return;
    } finally {
      setIsCheckingBilling(false);
    }

    const previousPlan = receipt.commercial.plan.toLowerCase().trim();
    if (previousPlan === 'pocket' || previousPlan === 'pro' || previousPlan === 'premium') {
      setSelectedPlanId(previousPlan);
    }
    const previousCycle = receipt.commercial.billingCycle.toLowerCase().trim();
    setBillingCycle(previousCycle === 'anual' || previousCycle === 'annual' ? 'anual' : 'mensal');
    setReceipt(null);
    setAccepted(false);
    setActivationResult(null);
    setRequestId(newRequestId());
    setSignupToken('');
    try { localStorage.removeItem('koma_signup_resume'); } catch { /* Storage opcional. */ }
    setSignupNotice('Inscrição anterior encerrada para edição. Seus dados foram preservados; escolha outro plano ou ciclo e continue.');
    setStep(1);
  };

  const saveSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/signups${signupToken ? '/current' : ''}`, {
        method: signupToken ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signupToken ? { 'X-Signup-Token': signupToken } : {}),
        },
        body: JSON.stringify({
          restaurant_name: form.restaurantName,
          responsible_name: form.responsibleName,
          email: form.email,
          phone: form.phone,
          plan: selectedPlanId,
          billing_cycle: billingCycle,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(contractErrorMessage(data.detail));
      setSignupToken(data.token);
      setRequestId(data.id);
      try { localStorage.setItem('koma_signup_resume', data.token); } catch { /* Storage opcional. */ }
      setSignupNotice(data.message);
      setForm(previous => ({
        ...previous,
        contractingPartyName: previous.contractingPartyName || previous.responsibleName,
      }));
      setStep(3);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar a inscrição.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const createAcceptance = async (): Promise<ContractReceipt> => {
    if (receipt) return receipt;
    if (signupToken) {
      const updated = await fetch(`${API_BASE_URL}/api/signups/current`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Signup-Token': signupToken },
        body: JSON.stringify({
          restaurant_name: form.restaurantName,
          responsible_name: representativeName,
          email: form.email,
          phone: form.phone,
          plan: selectedPlanId,
          billing_cycle: billingCycle,
        }),
      });
      if (!updated.ok) throw new Error('Não foi possível atualizar sua inscrição. Recarregue para recuperar o cadastro.');
    }

    const response = await fetch(`${API_BASE_URL}/api/contracts/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
      body: JSON.stringify({
        request_id: requestId,
        signup_token: signupToken || undefined,
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
    const mpPublicKey = capabilities.publicKey;
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
      throw new Error(payload?.cause?.[0]?.description || payload?.message || 'Não foi possível autorizar o cartão.');
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
      const body: Record<string, string> = {
        payment_method_type: billingMethod,
        payer_email: form.email.trim(),
      };
      if (billingMethod === 'credit_card') body.card_token_id = await tokenizeCard();

      const response = await fetch(`${API_BASE_URL}/api/contracts/${activeReceipt.protocol}/billing/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(contractErrorMessage(payload?.detail));

      if (payload?.status === 'authorization_required' && payload?.authorizationUrl) {
        const methodRedirectLabel = billingMethod === 'account_money' ? 'do Saldo Mercado Pago' : 'do Pix Automático via Mercado Pago';
        setSignupNotice(`Abrindo a autorização segura ${methodRedirectLabel}. O valor da mensalidade fixa hoje é R$ 0.`);
        window.location.assign(String(payload.authorizationUrl));
        return;
      }

      setActivationResult({
        restaurantId: payload.restaurantId ? String(payload.restaurantId) : undefined,
        status: payload.status,
        message: payload.message,
        slug: payload.slug || undefined,
        trialDays: payload.trialDays || 7,
        trialEndsAt: payload.trialEndsAt || undefined,
        activationToken: payload.activationToken || undefined,
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
          <a href="/" className="koma-sub-brand" aria-label="Voltar para o KÔMA">
            <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
          </a>
          <span className="koma-sub-secure"><ShieldCheck size={15} /> Ativação segura</span>
        </header>
        <main className="koma-sub-success-page">
          <section className="koma-sub-success-card">
            <span className="koma-sub-success-icon"><CheckCircle2 size={32} /></span>
            <span className="koma-sub-eyebrow">{activationResult.status === 'awaiting_release' ? 'AUTORIZAÇÃO CONFIRMADA' : 'CONTRATAÇÃO CONCLUÍDA'}</span>
            <h1>{activationResult.status === 'awaiting_release' ? 'Recebemos sua contratação.' : 'Seu KÔMA está pronto.'}</h1>
            <p>
              {activationResult.status === 'awaiting_release'
                ? (activationResult.message || 'A equipe KÔMA foi avisada. Após a liberação, começam seus 7 dias grátis e você recebe o convite para criar sua senha.')
                : `Seu período de ${activationResult.trialDays || 7} dias sem mensalidade fixa começou. A primeira cobrança automática ocorrerá somente depois do trial.`}
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
                <strong>https://{activationResult.slug}.komafood.com.br</strong>
              </div>
            )}
            {activationResult.status === 'awaiting_release' ? (
              <div className="koma-sub-success-detail koma-sub-activation-pending">
                <span>Próximo passo</span>
                <strong>Aguarde o convite por e-mail ou WhatsApp para criar sua senha.</strong>
              </div>
            ) : activationResult.activationToken ? (
              <a href={`/ativar#token=${encodeURIComponent(activationResult.activationToken)}`} className="koma-sub-primary-action">
                Concluir primeiro acesso <ArrowRight size={18} />
              </a>
            ) : (
              <div className="koma-sub-success-detail koma-sub-activation-pending">
                <span>Primeiro acesso</span>
                <strong>Seu acesso está sendo preparado. Utilize o convite enviado ao responsável.</strong>
              </div>
            )}
            <button type="button" className="koma-sub-text-action" onClick={() => setShowReceipt((current) => !current)}>
              <FileText size={16} /> {showReceipt ? 'Ocultar comprovante' : 'Ver comprovante de contratação'}
            </button>
          </section>
          {showReceipt && (
            <section className="koma-sub-receipt" aria-label="Comprovante de contratação">
              <div className="koma-sub-receipt-head">
                <div><span className="koma-sub-eyebrow">COMPROVANTE ELETRÔNICO</span><h2>Comprovante de Contratação e Licenciamento Eletrônico</h2></div>
                <span>Legal v{receipt.documents.version}</span>
              </div>
              <div className="koma-sub-receipt-grid">
                <div><strong>Contratante</strong><p>{receipt.contractingParty.name}<br />{receipt.contractingParty.taxIdKind.toUpperCase()} {receipt.contractingParty.taxId}<br />{receipt.contractingParty.restaurantName}</p></div>
                <div><strong>Condições congeladas</strong><p>Plano {receipt.commercial.plan.toUpperCase()} · {receipt.commercial.billingCycle}<br />Mensalidade-base R$ {receipt.commercial.fixedMonthlyPrice}<br />Taxa online {(Number(receipt.commercial.marketplaceRate) * 100).toFixed(2).replace('.', ',')}%</p></div>
                <div><strong>Protocolo e evidência</strong><p>{receipt.protocol}<br />Aceito em {formatReceiptDate(receipt.acceptedAtBrasilia)}<br />IP técnico: {receipt.evidence.sourceIp}</p></div>
                <div><strong>Documentos</strong><p>Termos: {receipt.documents.terms.hash}<br />Condições: {receipt.documents.commercial.hash}</p></div>
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

  return (
    <div className="koma-sub-wrapper">
      <header className="koma-sub-header">
        <a href="/" className="koma-sub-brand" aria-label="Voltar para o KÔMA">
          <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
        </a>
        <nav className="koma-sub-nav" aria-label="Navegação da contratação">
          <a href="/#planos">Ver planos</a>
          <a href="/legal">Legal e privacidade</a>
          <span className="koma-sub-secure"><ShieldCheck size={14} /> Conexão segura</span>
        </nav>
      </header>

      <main className="koma-sub-container">
        <section className="koma-sub-main">
          {step === 1 ? (
            <>
              {signupNotice && <div role="status" className="koma-sub-locked-note">{signupNotice}</div>}
              <div className="koma-sub-heading">
                <span className="koma-sub-eyebrow">01 · PLANO E COBRANÇA</span>
                <h1>Escolha o KÔMA certo para sua operação.</h1>
                <p>Todos os meios de pagamento começam da mesma forma: 7 dias grátis e cobrança automática somente depois do trial.</p>
              </div>
              <div className="koma-sub-plan-grid" role="radiogroup" aria-label="Escolha um plano KÔMA">
                {SUBSCRIPTION_PLANS.map((candidate) => {
                  const candidatePricing = getSubscriptionPricing(candidate.price);
                  const selected = candidate.id === selectedPlanId;
                  const displayedPrice = billingCycle === 'anual' ? candidatePricing.annualMonthlyEquivalent : candidatePricing.monthly;
                  return (
                    <button key={candidate.id} type="button" role="radio" aria-checked={selected} className={`koma-sub-plan-card ${selected ? 'is-selected' : ''}`} onClick={() => setSelectedPlanId(candidate.id)}>
                      <div className="koma-sub-plan-top"><span>{candidate.name.replace('Kôma ', '')}</span>{candidate.recommended && <em>Recomendado</em>}</div>
                      <strong>{formatCurrency(displayedPrice)}<small>/mês{billingCycle === 'anual' ? ' equiv.' : ''}</small></strong>
                      <p>{candidate.tagline}</p>
                      <span className="koma-sub-fee">{formatPercentage(candidate.splitFeeRate)} por pedido online pago</span>
                      <ul>{candidate.features.slice(0, 3).map((feature) => <li key={feature}><Check size={14} /> {feature}</li>)}</ul>
                    </button>
                  );
                })}
              </div>
              <div className="koma-sub-billing-selector" role="radiogroup" aria-label="Ciclo de cobrança">
                <button type="button" role="radio" aria-checked={billingCycle === 'mensal'} className={billingCycle === 'mensal' ? 'is-selected' : ''} onClick={() => setBillingCycle('mensal')}>
                  <span>Mensal</span><strong>{formatCurrency(pricing.monthly)}/mês</strong><small>Primeira cobrança automática após 7 dias.</small>
                </button>
                <button type="button" role="radio" aria-checked={billingCycle === 'anual'} className={billingCycle === 'anual' ? 'is-selected' : ''} onClick={() => setBillingCycle('anual')}>
                  <span>Anual <em>Economize 10%</em></span><strong>{formatCurrency(pricing.annualMonthlyEquivalent)}/mês equivalente</strong><small>{formatCurrency(pricing.annualTotal)} por ano, cobrado automaticamente somente após os 7 dias grátis e renovado anualmente.</small>
                </button>
              </div>
              <div className="koma-sub-trial-note">
                <Gift size={19} />
                <div><strong>7 dias grátis em qualquer forma de pagamento.</strong><p>R$ 0 de mensalidade fixa hoje. A taxa KÔMA sobre pedidos online pagos continua aplicável durante o trial.</p></div>
              </div>
            </>
          ) : step === 2 ? (
            <>
              {signupNotice && <div role="status" className="koma-sub-locked-note">{signupNotice}</div>}
              <button type="button" className="koma-sub-back" onClick={() => setStep(1)}>
                <ArrowLeft size={16} /> Voltar para plano e cobrança
              </button>
              <div className="koma-sub-heading"><span className="koma-sub-eyebrow">02 · SEU RESTAURANTE</span><h1>Vamos começar.</h1><p>Salve seus dados para continuar agora ou retomar depois.</p></div>
              {error && <div role="alert" className="koma-sub-error">{error}</div>}
              <form id="koma-signup-form" className="koma-sub-form" onSubmit={saveSignup}>
                {(['restaurantName', 'responsibleName', 'email', 'phone'] as const).map((field) => (
                  <label key={field} className="koma-sub-field"><span>{{ restaurantName: 'Nome do restaurante', responsibleName: 'Seu nome', email: 'E-mail', phone: 'WhatsApp' }[field]}</span>
                    <div><input required minLength={field === 'phone' ? 10 : 2} maxLength={field === 'restaurantName' ? 255 : 100} type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} value={form[field]} onChange={event => updateField(field, event.target.value)} /></div>
                  </label>
                ))}
                <p>Usaremos estes dados para preparar e acompanhar sua inscrição. <a href="/legal/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>.</p>
              </form>
            </>
          ) : (
            <>
              {signupNotice && <div role="status" className="koma-sub-locked-note">{signupNotice}</div>}
              <button
                type="button"
                className="koma-sub-back"
                onClick={() => void handleSwitchPlanOrCycle()}
                disabled={isCheckingBilling}
              >
                <ArrowLeft size={16} /> {isCheckingBilling ? 'Verificando…' : receipt ? 'Trocar plano ou ciclo' : 'Voltar para plano e cobrança'}
              </button>
              <div className="koma-sub-heading"><span className="koma-sub-eyebrow">03 · CONTRATAÇÃO E PAGAMENTO</span><h1>Ative seu restaurante.</h1><p>Autorize o meio recorrente agora; a mensalidade fixa só começa depois dos 7 dias grátis.</p></div>
              {error && <div className="koma-sub-error" role="alert"><Info size={18} /> {error}</div>}
              {contractLocked && (
                <div className="koma-sub-locked-note">
                  <Lock size={17} /> O aceite jurídico já foi registrado para esta tentativa. Você pode autorizar o pagamento ou usar o botão acima para trocar de plano.
                </div>
              )}

              <form id="koma-checkout-form" className="koma-sub-form" onSubmit={handleCheckout}>
                <section className="koma-sub-section-card">
                  <div className="koma-sub-section-title"><span><Building2 size={18} /></span><div><h2>Contratante e restaurante</h2><p>Dados necessários para formalizar a contratação.</p></div></div>
                  <div className="koma-sub-form-grid">
                    <label className="koma-sub-field koma-sub-field-full"><span>Nome completo / Razão social</span><div><User size={16} /><input value={form.contractingPartyName} onChange={(event) => updateField('contractingPartyName', event.target.value)} placeholder="Pessoa ou empresa contratante" disabled={contractLocked} required /></div></label>
                    <label className="koma-sub-field"><span>CPF / CNPJ</span><div><FileText size={16} /><input value={form.taxId} onChange={(event) => updateField('taxId', event.target.value)} placeholder="Documento do contratante" inputMode="numeric" disabled={contractLocked} required /></div>{form.taxId.trim() && !contractingTaxKind && <small className="is-error">Informe um CPF ou CNPJ válido.</small>}</label>
                    <label className="koma-sub-field"><span>Nome do restaurante</span><div><Store size={16} /><input value={form.restaurantName} onChange={(event) => updateField('restaurantName', event.target.value)} placeholder="Nome do estabelecimento" disabled={contractLocked} required /></div></label>
                    <label className="koma-sub-field"><span>E-mail</span><div><Mail size={16} /><input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="voce@restaurante.com" disabled={contractLocked} required /></div></label>
                    <label className="koma-sub-field"><span>Telefone / WhatsApp</span><div><Phone size={16} /><input type="tel" value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="(00) 00000-0000" disabled={contractLocked} required /></div></label>
                  </div>
                  {isCompany && (
                    <div className="koma-sub-representative">
                      <div className="koma-sub-section-title compact"><span><User size={17} /></span><div><h3>Responsável pelo aceite</h3><p>Como o contratante é um CNPJ, precisamos identificar a pessoa física que possui poderes para contratar.</p></div></div>
                      <div className="koma-sub-form-grid">
                        <label className="koma-sub-field koma-sub-field-full"><span>Nome completo do responsável</span><div><User size={16} /><input value={form.responsibleName} onChange={(event) => updateField('responsibleName', event.target.value)} placeholder="Nome do representante" disabled={contractLocked} required /></div></label>
                        <label className="koma-sub-field"><span>CPF do responsável</span><div><FileText size={16} /><input value={form.representativeTaxId} onChange={(event) => updateField('representativeTaxId', event.target.value)} placeholder="CPF do representante" inputMode="numeric" disabled={contractLocked} required /></div>{form.representativeTaxId.trim() && !isValidCpf(form.representativeTaxId) && <small className="is-error">Informe um CPF válido.</small>}</label>
                        <label className="koma-sub-field"><span>Cargo / função</span><div><Building2 size={16} /><input value={form.representativeRole} onChange={(event) => updateField('representativeRole', event.target.value)} placeholder="Ex.: proprietário, sócio, administrador" disabled={contractLocked} required /></div></label>
                      </div>
                    </div>
                  )}
                </section>

                <section className="koma-sub-section-card">
                  <div className="koma-sub-section-title"><span><CreditCard size={18} /></span><div><h2>Forma de pagamento</h2><p>Escolha apenas como autorizar a recorrência. Todas as opções têm R$ 0 de mensalidade fixa hoje e 7 dias grátis antes da primeira cobrança.</p></div></div>
                  <div className="koma-sub-methods" role="radiogroup" aria-label="Forma de pagamento disponível">
                    <button type="button" role="radio" aria-checked={billingMethod === 'credit_card'} className={billingMethod === 'credit_card' ? 'is-selected' : ''} onClick={() => setBillingMethod('credit_card')}>
                      <span className="koma-sub-method-radio" /><CreditCard size={19} /><div><strong>Cartão de crédito{!capabilities.credit_card ? ' · indisponível no momento' : ''}</strong><small>Visa · Mastercard · Elo · Hipercard · Amex · R$ 0 hoje · primeira cobrança após 7 dias</small></div>
                    </button>
                    <button type="button" role="radio" aria-checked={billingMethod === 'pix_automatic'} className={billingMethod === 'pix_automatic' ? 'is-selected' : ''} onClick={() => setBillingMethod('pix_automatic')}>
                      <span className="koma-sub-method-radio" /><ShieldCheck size={19} /><div><strong>Pix Automático via Mercado Pago{!capabilities.pix_automatic ? ' · indisponível no momento' : ''}</strong><small>Autorização no ambiente do Mercado Pago · não gera QR Code · R$ 0 hoje</small></div>
                    </button>
                    <button type="button" role="radio" aria-checked={billingMethod === 'account_money'} className={billingMethod === 'account_money' ? 'is-selected' : ''} onClick={() => setBillingMethod('account_money')}>
                      <span className="koma-sub-method-radio" /><Wallet size={19} /><div><strong>Saldo Mercado Pago{!capabilities.account_money ? ' · indisponível no momento' : ''}</strong><small>Autorize sua conta Mercado Pago · R$ 0 hoje · cobrança automática após 7 dias</small></div>
                    </button>
                  </div>

                  {billingMethod === 'credit_card' && (
                    <div className="koma-sub-card-fields">
                      <label className="koma-sub-field koma-sub-field-full"><span>Número do cartão</span><div><CreditCard size={16} /><input value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} inputMode="numeric" placeholder="0000 0000 0000 0000" required /></div></label>
                      <label className="koma-sub-field koma-sub-field-full"><span>Nome impresso no cartão</span><div><User size={16} /><input value={cardHolder} onChange={(event) => setCardHolder(event.target.value)} placeholder="Como consta no cartão" required /></div></label>
                      <label className="koma-sub-field"><span>Validade</span><div><Info size={16} /><input value={cardExp} onChange={(event) => setCardExp(event.target.value)} placeholder="MM/AA" maxLength={7} required /></div></label>
                      <label className="koma-sub-field"><span>CVV</span><div><Lock size={16} /><input type="password" value={cardCvv} onChange={(event) => setCardCvv(event.target.value)} inputMode="numeric" placeholder="123" maxLength={4} required /></div></label>
                      <label className="koma-sub-field koma-sub-field-full"><span>CPF/CNPJ do titular do cartão <small>(opcional se for o mesmo responsável)</small></span><div><FileText size={16} /><input value={cardDoc} onChange={(event) => setCardDoc(event.target.value)} inputMode="numeric" placeholder="Documento do titular" /></div></label>
                    </div>
                  )}

                  {billingMethod === 'pix_automatic' && capabilities.pix_automatic && (
                    <div className="koma-sub-locked-note"><ShieldCheck size={17} /> O fluxo disponível hoje é hospedado pelo Mercado Pago: ao continuar, você sai do KÔMA para autorizar a recorrência lá. Este método não exibe QR Code Pix para leitura em outro banco e nenhuma mensalidade fixa é cobrada hoje.</div>
                  )}

                  {billingMethod === 'account_money' && capabilities.account_money && (
                    <div className="koma-sub-locked-note"><Wallet size={17} /> Ao continuar, você será levado ao ambiente seguro do Mercado Pago para autorizar a recorrência com seu Saldo Mercado Pago. R$ 0 será cobrado hoje e a cobrança automática ocorrerá no D+7.</div>
                  )}

                  {!capabilities.credit_card && !capabilities.pix_automatic && !capabilities.account_money && (
                    <p role="status">
                      {capabilities.isTestMode || capabilities.environment === 'homologation'
                        ? 'Ambiente de homologação: o checkout recorrente está temporariamente pausado enquanto as credenciais TEST do gateway são concluídas (KOMA_SAAS_CHECKOUT_ENABLED=false). Seu cadastro fica salvo.'
                        : 'Sua inscrição está salva. Os meios recorrentes estão temporariamente indisponíveis; você pode retomar neste dispositivo mais tarde.'}
                    </p>
                  )}
                </section>

                <section className="koma-sub-legal-acceptance">
                  <input id="legal-acceptance" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={contractLocked} required />
                  <label htmlFor="legal-acceptance">
                    Declaro que as informações estão corretas, que <strong>possuo poderes</strong> para contratar em nome do estabelecimento e aceito os <a href="/legal/termos" target="_blank" rel="noreferrer">Termos de Contratação</a>, as <a href="/legal/planos" target="_blank" rel="noreferrer">Condições Comerciais</a>, o <a href="/legal/dpa" target="_blank" rel="noreferrer">Anexo de Tratamento de Dados</a> e a <a href="/legal/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>, versão {LEGAL_VERSION}. <strong>Autorizo a recorrência por {billingMethodLabel}: R$ 0 de mensalidade fixa hoje, primeira cobrança automática de {formatCurrency(nextChargeAmount)} somente após 7 dias e renovações {activeBillingCycle === 'anual' ? 'anuais' : 'mensais'} até o cancelamento.</strong>
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
              <div><strong>{plan.name.replace('Kôma ', '')}</strong><span>{activeBillingCycle === 'anual' ? 'Plano anual' : 'Plano mensal'}</span></div>
              <span className="koma-sub-summary-price">{activeBillingCycle === 'anual' ? `${formatCurrency(pricing.annualMonthlyEquivalent)}/mês equiv.` : `${formatCurrency(pricing.monthly)}/mês`}</span>
            </div>
            <dl className="koma-sub-summary-list">
              {activeBillingCycle === 'anual' && <div><dt>Total anual após o trial</dt><dd>{formatCurrency(pricing.annualTotal)}</dd></div>}
              {activeBillingCycle === 'anual' && <div><dt>Economia anual</dt><dd>{formatCurrency(pricing.annualSavings)}</dd></div>}
              <div><dt>Taxa KÔMA online</dt><dd>{formatPercentage(plan.splitFeeRate)}</dd></div>
              <div><dt>Implantação</dt><dd>R$ 0</dd></div>
              <div><dt>Prestador</dt><dd>{LEGAL_PROVIDER_NAME}</dd></div>
            </dl>
          </section>

          <section className="koma-sub-summary-card">
            <div className="koma-sub-timeline">
              <div><span className="is-active"><Gift size={16} /></span><div><strong>Hoje</strong><p>Autorize {billingMethodLabel}. Mensalidade fixa: R$ 0.</p></div></div>
              <div><span><Info size={16} /></span><div><strong>{formatDisplayDate(reminderDate)}</strong><p>Você continua no período grátis e pode cancelar antes da primeira cobrança.</p></div></div>
              <div><span>{billingMethod === 'pix_automatic' ? <ShieldCheck size={16} /> : billingMethod === 'account_money' ? <Wallet size={16} /> : <CreditCard size={16} />}</span><div><strong>{formatDisplayDate(renewalDate)}</strong><p>Primeira cobrança automática: {formatCurrency(nextChargeAmount)}.</p></div></div>
            </div>
            <div className="koma-sub-due-row"><span>A pagar hoje</span><strong>{formatCurrency(amountDueToday)}</strong></div>
            <p className="koma-sub-summary-note">7 dias grátis em todas as formas de pagamento. Não existem dias bônus nem pagamento antecipado da mensalidade fixa.</p>

            {step === 1 ? (
              <button key="action-step-1" type="button" className="koma-sub-primary-action" onClick={() => { setStep(2); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Continuar <ArrowRight size={18} /></button>
            ) : step === 2 ? (
              <button key="action-step-2" type="submit" form="koma-signup-form" className="koma-sub-primary-action" disabled={isSubmitting}>{isSubmitting ? 'Salvando…' : 'Salvar e continuar'} <ArrowRight size={18} /></button>
            ) : (
              <button key="action-step-3" type="submit" form="koma-checkout-form" className="koma-sub-primary-action" disabled={!canContinue} aria-label="Aceitar e registrar contratação">
                {isSubmitting
                  ? 'Processando…'
                  : billingMethod === 'pix_automatic'
                    ? 'Continuar no Mercado Pago'
                    : billingMethod === 'account_money'
                      ? 'Autorizar Saldo Mercado Pago'
                      : 'Ativar 7 dias grátis'} <ArrowRight size={18} />
              </button>
            )}
            <p className="koma-sub-fineprint">O aceite registra protocolo, hashes dos documentos, condições comerciais e evidências técnicas da contratação.</p>
          </section>
        </aside>
      </main>
    </div>
  );
}
