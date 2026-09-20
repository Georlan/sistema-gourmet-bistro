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

type BillingMethod = 'credit_card' | 'pix' | 'account_money';
type BillingCycle = 'mensal' | 'anual';

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
  acceptedAtBrasilia: string;
  contractingParty: {
    name: string;
    taxId: string;
    taxIdKind: string;
    restaurantName: string;
    email: string;
    phone: string;
  };
  representative: { name: string; taxId: string; role: string };
  commercial: {
    plan: string;
    billingCycle: string;
    fixedMonthlyPrice: string;
    marketplaceRate: string;
  };
  documents: {
    version: string;
    terms: { hash: string };
    commercial: { hash: string };
  };
  evidence: { sourceIp: string };
};

type ActivationResult = {
  restaurantId?: string;
  status?: 'ready' | 'awaiting_release' | 'already_activated';
  message?: string;
  slug?: string;
  trialDays?: number;
  trialEndsAt?: string;
  activationToken?: string;
};

type BillingCapabilities = {
  credit_card: boolean;
  pix: boolean;
  account_money: boolean;
  publicKey: string;
  environment?: string;
  isTestMode?: boolean;
};

type SavedSignup = {
  id: string;
  token?: string;
  data: {
    plan: SubscriptionPlanId;
    billing_cycle: BillingCycle;
    restaurant_name: string;
    responsible_name: string;
    email: string;
    phone: string;
  };
  receipt?: ContractReceipt | null;
  activation?: ActivationResult | null;
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
  return rawPlanId === 'pocket' || rawPlanId === 'pro' || rawPlanId === 'premium' ? rawPlanId : 'pro';
}

function resolveBillingCycle(planId: SubscriptionPlanId): BillingCycle {
  if (planId === 'pocket') return 'mensal';
  return new URLSearchParams(window.location.search).get('cobranca') === 'anual' ? 'anual' : 'mensal';
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function formatReceiptDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'medium' }).format(date);
}

export default function PlanContractPageV2() {
  const initialPlanId = useMemo(resolvePlanId, []);
  const initialCycle = useMemo(() => resolveBillingCycle(initialPlanId), [initialPlanId]);
  const returnedFromBalance = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get('retorno');
    return value === 'saldo-mercadopago' || value === 'account-money';
  }, []);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedPlanId, setSelectedPlanId] = useState<SubscriptionPlanId>(initialPlanId);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(initialCycle);
  const [billingMethod, setBillingMethod] = useState<BillingMethod>('credit_card');
  const [form, setForm] = useState<ContractForm>(EMPTY_FORM);
  const [accepted, setAccepted] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);
  const [signupToken, setSignupToken] = useState('');
  const [resumeCandidate, setResumeCandidate] = useState<SavedSignup | null>(null);
  const [signupNotice, setSignupNotice] = useState('');
  const [receipt, setReceipt] = useState<ContractReceipt | null>(null);
  const [activationResult, setActivationResult] = useState<ActivationResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingBilling, setIsCheckingBilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [capabilities, setCapabilities] = useState<BillingCapabilities>({
    credit_card: false,
    pix: false,
    account_money: false,
    publicKey: '',
  });

  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExp, setCardExp] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardDoc, setCardDoc] = useState('');

  const activePlanId = useMemo<SubscriptionPlanId>(() => {
    const value = receipt?.commercial.plan?.toLowerCase().trim();
    return value === 'pocket' || value === 'pro' || value === 'premium' ? value : selectedPlanId;
  }, [receipt, selectedPlanId]);
  const activeBillingCycle = useMemo<BillingCycle>(() => {
    const value = receipt?.commercial.billingCycle?.toLowerCase().trim();
    return value === 'anual' || value === 'annual' ? 'anual' : receipt ? 'mensal' : billingCycle;
  }, [receipt, billingCycle]);
  const plan = useMemo(
    () => SUBSCRIPTION_PLANS.find((candidate) => candidate.id === activePlanId) ?? SUBSCRIPTION_PLANS[1],
    [activePlanId],
  );
  const pricing = useMemo(() => getSubscriptionPricing(plan.price), [plan.price]);
  const fixedBillingRequired = receipt
    ? Number.parseFloat(receipt.commercial.fixedMonthlyPrice) > 0
    : plan.price > 0;
  const nextChargeAmount = fixedBillingRequired
    ? (activeBillingCycle === 'anual' ? pricing.annualTotal : pricing.monthly)
    : 0;
  const contractLocked = Boolean(receipt);
  const contractingTaxKind = taxIdKind(form.taxId);
  const isCompany = contractingTaxKind === 'cnpj';
  const representativeName = isCompany ? form.responsibleName.trim() : form.contractingPartyName.trim();
  const representativeTaxId = isCompany ? form.representativeTaxId.trim() : form.taxId.trim();
  const representativeRole = isCompany ? form.representativeRole.trim() : 'Titular da contratação';
  const representativeValid = Boolean(representativeName) && isValidCpf(representativeTaxId) && Boolean(representativeRole);
  const baseFieldsValid =
    form.contractingPartyName.trim().length >= 2
    && Boolean(contractingTaxKind)
    && form.restaurantName.trim().length >= 2
    && form.email.includes('@')
    && form.phone.replace(/\D/g, '').length >= 8;
  const cardFieldsValid =
    cardNumber.replace(/\D/g, '').length >= 13
    && cardHolder.trim().length >= 2
    && /^\d{2}\/\d{2,4}$/.test(cardExp.trim())
    && /^\d{3,4}$/.test(cardCvv.trim());
  const paymentFieldsValid = !fixedBillingRequired || billingMethod !== 'credit_card' || cardFieldsValid;
  const methodAvailable = !fixedBillingRequired || (billingMethod === 'credit_card'
    ? capabilities.credit_card
    : billingMethod === 'pix'
      ? capabilities.pix
      : capabilities.account_money);
  const canContinue = methodAvailable
    && ((baseFieldsValid && representativeValid && accepted) || Boolean(receipt))
    && paymentFieldsValid
    && !isSubmitting
    && !activationResult;

  const billingMethodLabel = billingMethod === 'pix'
    ? 'Pix'
    : billingMethod === 'account_money'
      ? 'Saldo Mercado Pago'
      : 'cartão de crédito';

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/api/contracts/payment-methods-v2`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const payload = await response.json();
        setCapabilities({
          credit_card: Boolean(payload.credit_card),
          pix: Boolean(payload.pix),
          account_money: Boolean(payload.account_money),
          publicKey: String(payload.publicKey || ''),
          environment: payload.environment,
          isTestMode: Boolean(payload.isTestMode),
        });
      })
      .catch(() => { /* cadastro continua recuperável */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.title = `Contratar ${plan.name} | KÔMA`;
  }, [plan.name]);

  useEffect(() => {
    if (!contractLocked && selectedPlanId === 'pocket' && billingCycle !== 'mensal') {
      setBillingCycle('mensal');
    }
  }, [selectedPlanId, billingCycle, contractLocked]);

  useEffect(() => {
    if (contractLocked) return;
    const params = new URLSearchParams(window.location.search);
    params.set('cobranca', billingCycle);
    params.delete('retorno');
    window.history.replaceState(null, '', `/contratar/${selectedPlanId}?${params.toString()}`);
  }, [billingCycle, selectedPlanId, contractLocked]);

  useEffect(() => {
    let token = '';
    try { token = localStorage.getItem('koma_signup_resume') || ''; } catch { /* storage opcional */ }
    if (!token) return;
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/api/signups/current`, {
      headers: { 'X-Signup-Token': token },
      signal: controller.signal,
    })
      .then(async response => {
        if (response.status === 404) {
          try { localStorage.removeItem('koma_signup_resume'); } catch { /* storage opcional */ }
          return;
        }
        if (!response.ok) return;
        const saved = await response.json() as SavedSignup;
        setResumeCandidate({ ...saved, token });
      })
      .catch(() => { /* nova contratação permanece disponível */ });
    return () => controller.abort();
  }, []);

  const applySavedSignup = (saved: SavedSignup) => {
    const token = saved.token || '';
    setSignupToken(token);
    setRequestId(saved.id);
    setSelectedPlanId(saved.data.plan);
    setBillingCycle(saved.data.billing_cycle);
    setForm(previous => ({
      ...previous,
      restaurantName: saved.data.restaurant_name,
      responsibleName: saved.data.responsible_name,
      contractingPartyName: saved.receipt?.contractingParty.name || saved.data.responsible_name,
      taxId: saved.receipt?.contractingParty.taxId || '',
      email: saved.data.email,
      phone: saved.data.phone,
      representativeTaxId: saved.receipt?.representative.taxId || '',
      representativeRole: saved.receipt?.representative.role || '',
    }));
    if (saved.receipt) {
      setReceipt(saved.receipt);
      setAccepted(true);
    }
    if (saved.activation) setActivationResult(saved.activation);
    setResumeCandidate(null);
    setStep(saved.receipt ? 3 : 2);
    setSignupNotice(returnedFromBalance
      ? 'Retomamos sua inscrição após a autorização no Mercado Pago.'
      : 'Inscrição recuperada. Você pode continuar de onde parou.');
  };

  const startFresh = () => {
    try { localStorage.removeItem('koma_signup_resume'); } catch { /* storage opcional */ }
    setResumeCandidate(null);
    setSignupToken('');
    setReceipt(null);
    setAccepted(false);
    setActivationResult(null);
    setRequestId(newRequestId());
    setStep(1);
    setSignupNotice('Nova contratação iniciada.');
  };

  useEffect(() => {
    if (!receipt || activationResult) return;
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`${API_BASE_URL}/api/contracts/${receipt.protocol}/billing/status`);
        if (!response.ok) return;
        const payload = await response.json();
        if (payload.billingStatus === 'ready' && !payload.isActivated) {
          setActivationResult({ status: 'awaiting_release', message: 'Meio de pagamento confirmado. A contratação segue para liberação.' });
        } else if (payload.isActivated && payload.restaurantId) {
          setActivationResult({ restaurantId: String(payload.restaurantId), slug: payload.slug });
        }
      } catch { /* estado é recuperável ao recarregar */ }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [receipt, activationResult]);

  const updateField = (field: keyof ContractForm, value: string) => {
    if (contractLocked) return;
    setForm(current => ({ ...current, [field]: value }));
    setError(null);
  };

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { setCopied(false); }
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
        const hasActiveBilling = Boolean(payload.isActivated)
          || Boolean(payload.restaurantId)
          || (Boolean(payload.paymentMethodType) && (billingStatus === 'pending' || billingStatus === 'ready'));
        if (hasActiveBilling) {
          setError('Esta contratação possui um meio financeiro em andamento. Cancele a tentativa antes de iniciar outro plano ou ciclo.');
          return;
        }
      } else if (response.status !== 404) {
        setError('Não foi possível verificar o estado financeiro. Tente novamente.');
        return;
      }
    } catch {
      setError('Falha de conexão ao verificar a contratação. Tente novamente.');
      return;
    } finally {
      setIsCheckingBilling(false);
    }
    setReceipt(null);
    setAccepted(false);
    setActivationResult(null);
    setSignupToken('');
    setRequestId(newRequestId());
    try { localStorage.removeItem('koma_signup_resume'); } catch { /* storage opcional */ }
    setSignupNotice('Inscrição anterior encerrada para edição. Seus dados foram preservados.');
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
      try { localStorage.setItem('koma_signup_resume', data.token); } catch { /* storage opcional */ }
      setSignupNotice(data.message);
      setForm(previous => ({ ...previous, contractingPartyName: previous.contractingPartyName || previous.responsibleName }));
      setStep(3);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar a inscrição.');
    } finally { setIsSubmitting(false); }
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
      if (!updated.ok) throw new Error('Não foi possível atualizar sua inscrição.');
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
      throw new Error('Pagamento por cartão está temporariamente indisponível.');
    }
    const [expMonth, expYear] = cardExp.split('/').map(value => value.trim());
    const cleanDoc = (cardDoc || representativeTaxId || form.taxId).replace(/\D/g, '');
    const response = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(mpPublicKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_number: cardNumber.replace(/\D/g, ''),
        expiration_month: Number.parseInt(expMonth || '0', 10),
        expiration_year: expYear?.length === 2 ? Number.parseInt(`20${expYear}`, 10) : Number.parseInt(expYear || '0', 10),
        security_code: cardCvv.trim(),
        cardholder: {
          name: cardHolder.trim(),
          identification: { type: cleanDoc.length > 11 ? 'CNPJ' : 'CPF', number: cleanDoc },
        },
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.id) throw new Error(payload?.cause?.[0]?.description || payload?.message || 'Não foi possível autorizar o cartão.');
    return String(payload.id);
  };

  const handleCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canContinue) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const activeReceipt = await createAcceptance();
      const freeFixedContract = Number.parseFloat(activeReceipt.commercial.fixedMonthlyPrice) === 0;
      let response: Response;
      if (freeFixedContract) {
        response = await fetch(
          `${API_BASE_URL}/api/contracts/${activeReceipt.protocol}/billing/activate-free`,
          { method: 'POST' },
        );
      } else if (billingMethod === 'pix') {
        response = await fetch(`${API_BASE_URL}/api/contracts/${activeReceipt.protocol}/billing/pix/select`, { method: 'POST' });
      } else {
        const body: Record<string, string> = {
          payment_method_type: billingMethod,
          payer_email: form.email.trim(),
        };
        if (billingMethod === 'credit_card') body.card_token_id = await tokenizeCard();
        response = await fetch(`${API_BASE_URL}/api/contracts/${activeReceipt.protocol}/billing/setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(contractErrorMessage(payload?.detail));
      if (billingMethod === 'account_money' && payload?.status === 'authorization_required' && payload?.authorizationUrl) {
        setSignupNotice('Abrindo a autorização segura do Saldo Mercado Pago. A mensalidade fixa hoje é R$ 0.');
        window.location.assign(String(payload.authorizationUrl));
        return;
      }
      setActivationResult({
        restaurantId: payload.restaurantId ? String(payload.restaurantId) : undefined,
        status: payload.status,
        message: payload.message,
        slug: payload.slug || undefined,
        trialDays: payload.trialDays ?? (freeFixedContract ? 0 : 7),
        trialEndsAt: payload.trialEndsAt || undefined,
        activationToken: payload.activationToken || undefined,
      });
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Não foi possível processar a contratação.');
    } finally { setIsSubmitting(false); }
  };

  if (activationResult && receipt) {
    const pixSelected = fixedBillingRequired && billingMethod === 'pix';
    return (
      <div className="koma-sub-wrapper">
        <header className="koma-sub-header">
          <a href="/" className="koma-sub-brand" aria-label="Voltar para o KÔMA"><img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" /></a>
          <span className="koma-sub-secure"><ShieldCheck size={15} /> Ativação segura</span>
        </header>
        <main className="koma-sub-success-page">
          <section className="koma-sub-success-card">
            <span className="koma-sub-success-icon"><CheckCircle2 size={32} /></span>
            <span className="koma-sub-eyebrow">{activationResult.status === 'awaiting_release' ? 'CONTRATAÇÃO RECEBIDA' : 'CONTRATAÇÃO CONCLUÍDA'}</span>
            <h1>{activationResult.status === 'awaiting_release' ? 'Recebemos sua contratação.' : 'Seu KÔMA está pronto.'}</h1>
            <p>{activationResult.message || (!fixedBillingRequired
              ? 'Pocket ativado sem mensalidade fixa e sem assinatura recorrente de R$ 0 no provedor.'
              : pixSelected
                ? 'Nenhum Pix é cobrado hoje. Depois da configuração, você inicia seus 7 dias grátis; o primeiro QR aparece no KÔMA somente no vencimento.'
                : 'A mensalidade fixa continua R$ 0 hoje. Depois da configuração, você escolhe quando iniciar os 7 dias grátis.')}</p>
            {activationResult.slug && <div className="koma-sub-success-detail"><span>Endereço do estabelecimento</span><strong>https://{activationResult.slug}.komafood.com.br</strong></div>}
            {activationResult.status === 'awaiting_release' ? (
              <div className="koma-sub-success-detail koma-sub-activation-pending"><span>Próximo passo</span><strong>Aguarde o convite para criar sua senha.</strong></div>
            ) : activationResult.activationToken ? (
              <a href={`/ativar#token=${encodeURIComponent(activationResult.activationToken)}`} className="koma-sub-primary-action">Concluir primeiro acesso <ArrowRight size={18} /></a>
            ) : (
              <div className="koma-sub-success-detail koma-sub-activation-pending"><span>Primeiro acesso</span><strong>Seu acesso está sendo preparado. Utilize o convite enviado ao responsável.</strong></div>
            )}
            <button type="button" className="koma-sub-text-action" onClick={() => setShowReceipt(current => !current)}><FileText size={16} /> {showReceipt ? 'Ocultar comprovante' : 'Ver comprovante de contratação'}</button>
          </section>
          {showReceipt && (
            <section className="koma-sub-receipt" aria-label="Comprovante de contratação">
              <div className="koma-sub-receipt-head"><div><span className="koma-sub-eyebrow">COMPROVANTE ELETRÔNICO</span><h2>Comprovante de Contratação e Licenciamento Eletrônico</h2></div><span>Legal v{receipt.documents.version}</span></div>
              <div className="koma-sub-receipt-grid">
                <div><strong>Contratante</strong><p>{receipt.contractingParty.name}<br />{receipt.contractingParty.taxIdKind.toUpperCase()} {receipt.contractingParty.taxId}<br />{receipt.contractingParty.restaurantName}</p></div>
                <div><strong>Condições congeladas</strong><p>Plano {receipt.commercial.plan.toUpperCase()} · {receipt.commercial.billingCycle}<br />Mensalidade-base R$ {receipt.commercial.fixedMonthlyPrice}</p></div>
                <div><strong>Protocolo e evidência</strong><p>{receipt.protocol}<br />Aceito em {formatReceiptDate(receipt.acceptedAtBrasilia)}<br />IP técnico: {receipt.evidence.sourceIp}</p></div>
                <div><strong>Documentos</strong><p>Termos: {receipt.documents.terms.hash}<br />Condições: {receipt.documents.commercial.hash}</p></div>
              </div>
              <div className="koma-sub-receipt-actions"><button type="button" onClick={() => void copyValue(receipt.protocol)}><Copy size={16} /> {copied ? 'Copiado' : 'Copiar protocolo'}</button><button type="button" onClick={() => window.print()}><Printer size={16} /> Imprimir / salvar em PDF</button></div>
            </section>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="koma-sub-wrapper">
      <header className="koma-sub-header">
        <a href="/" className="koma-sub-brand" aria-label="Voltar para o KÔMA"><img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" /></a>
        <nav className="koma-sub-nav" aria-label="Navegação da contratação"><a href="/#planos">Ver planos</a><a href="/legal">Legal e privacidade</a><span className="koma-sub-secure"><ShieldCheck size={14} /> Conexão segura</span></nav>
      </header>

      <main className="koma-sub-container">
        <section className="koma-sub-main">
          {resumeCandidate && (
            <div role="status" className="koma-sub-locked-note">
              <div><strong>Encontramos uma inscrição salva.</strong><p>Você decide se quer retomar ou começar outra contratação.</p></div>
              <button type="button" onClick={() => applySavedSignup(resumeCandidate)}>Retomar inscrição</button>
              <button type="button" onClick={startFresh}>Começar outra</button>
            </div>
          )}
          {signupNotice && <div role="status" className="koma-sub-locked-note">{signupNotice}</div>}

          {step === 1 ? (
            <>
              <div className="koma-sub-heading"><span className="koma-sub-eyebrow">01 · PLANO E COBRANÇA</span><h1>Escolha o KÔMA certo para sua operação.</h1><p>Pocket começa sem mensalidade. Pro e Premium mantêm 7 dias de teste no componente fixo, iniciados por você após concluir a configuração.</p></div>
              <div className="koma-sub-plan-grid" role="radiogroup" aria-label="Escolha um plano KÔMA">
                {SUBSCRIPTION_PLANS.map(candidate => {
                  const candidatePricing = getSubscriptionPricing(candidate.price);
                  const selected = candidate.id === selectedPlanId;
                  const displayedPrice = billingCycle === 'anual' && candidate.id !== 'pocket'
                    ? candidatePricing.annualMonthlyEquivalent
                    : candidatePricing.monthly;
                  return (
                    <button key={candidate.id} type="button" role="radio" aria-checked={selected} className={`koma-sub-plan-card ${selected ? 'is-selected' : ''}`} onClick={() => {
                        setSelectedPlanId(candidate.id);
                        if (candidate.id === 'pocket') setBillingCycle('mensal');
                      }}>
                      <div className="koma-sub-plan-top"><span>{candidate.name.replace('Kôma ', '')}</span>{candidate.recommended && <em>Recomendado</em>}</div>
                      <strong>{formatCurrency(displayedPrice)}<small>/mês{billingCycle === 'anual' && candidate.id !== 'pocket' ? ' equiv.' : ''}</small></strong>
                      <p>{candidate.tagline}</p><span className="koma-sub-fee">{formatPercentage(candidate.splitFeeRate)} por pedido online pago</span>
                      <ul>{candidate.features.slice(0, 3).map(feature => <li key={feature}><Check size={14} /> {feature}</li>)}</ul>
                    </button>
                  );
                })}
              </div>
              <div className="koma-sub-billing-selector" role="radiogroup" aria-label="Ciclo de cobrança">
                <button type="button" role="radio" aria-checked={billingCycle === 'mensal'} className={billingCycle === 'mensal' ? 'is-selected' : ''} onClick={() => setBillingCycle('mensal')}><span>Mensal</span><strong>{formatCurrency(pricing.monthly)}/mês</strong><small>{selectedPlanId === 'pocket' ? 'Sem componente fixo.' : 'Primeira cobrança depois do trial.'}</small></button>
                {selectedPlanId !== 'pocket' && <button type="button" role="radio" aria-checked={billingCycle === 'anual'} className={billingCycle === 'anual' ? 'is-selected' : ''} onClick={() => setBillingCycle('anual')}><span>Anual <em>Economize 10%</em></span><strong>{formatCurrency(pricing.annualMonthlyEquivalent)}/mês equivalente</strong><small>{formatCurrency(pricing.annualTotal)} por ano, cobrado depois do trial. O desconto anual não altera a taxa percentual.</small></button>}
              </div>
              <div className="koma-sub-trial-note"><Gift size={19} /><div><strong>{selectedPlanId === 'pocket' ? 'Pocket sem mensalidade fixa.' : '7 dias grátis no componente fixo.'}</strong><p>{selectedPlanId === 'pocket' ? 'Não é necessário cadastrar meio de pagamento para uma recorrência de R$ 0.' : 'Os 7 dias não começam sozinhos: depois da configuração, você escolhe quando iniciar.'}</p></div></div>
            </>
          ) : step === 2 ? (
            <>
              <button type="button" className="koma-sub-back" onClick={() => setStep(1)}><ArrowLeft size={16} /> Voltar para plano e cobrança</button>
              <div className="koma-sub-heading"><span className="koma-sub-eyebrow">02 · SEU RESTAURANTE</span><h1>Vamos começar.</h1><p>Salve seus dados para continuar agora ou retomar depois.</p></div>
              {error && <div role="alert" className="koma-sub-error">{error}</div>}
              <form id="koma-signup-form" className="koma-sub-form" onSubmit={saveSignup}>
                {(['restaurantName', 'responsibleName', 'email', 'phone'] as const).map(field => (
                  <label key={field} className="koma-sub-field"><span>{{ restaurantName: 'Nome do restaurante', responsibleName: 'Seu nome', email: 'E-mail', phone: 'WhatsApp' }[field]}</span><div><input required minLength={field === 'phone' ? 10 : 2} type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} value={form[field]} onChange={event => updateField(field, event.target.value)} /></div></label>
                ))}
              </form>
            </>
          ) : (
            <>
              <button type="button" className="koma-sub-back" onClick={() => void handleSwitchPlanOrCycle()} disabled={isCheckingBilling}><ArrowLeft size={16} /> {isCheckingBilling ? 'Verificando…' : receipt ? 'Trocar plano ou ciclo' : 'Voltar para plano e cobrança'}</button>
              <div className="koma-sub-heading"><span className="koma-sub-eyebrow">03 · CONTRATAÇÃO{fixedBillingRequired ? ' E PAGAMENTO' : ''}</span><h1>Ative seu restaurante.</h1><p>{fixedBillingRequired ? 'Escolha cartão, Pix ou Saldo Mercado Pago. Hoje: R$ 0 de mensalidade fixa.' : 'Pocket não exige meio de pagamento para a mensalidade fixa de R$ 0.'}</p></div>
              {error && <div className="koma-sub-error" role="alert"><Info size={18} /> {error}</div>}
              {contractLocked && <div className="koma-sub-locked-note"><Lock size={17} /> O aceite jurídico já foi registrado para esta tentativa.</div>}

              <form id="koma-checkout-form" className="koma-sub-form" onSubmit={handleCheckout}>
                <section className="koma-sub-section-card">
                  <div className="koma-sub-section-title"><span><Building2 size={18} /></span><div><h2>Contratante e restaurante</h2><p>Dados necessários para formalizar a contratação.</p></div></div>
                  <div className="koma-sub-form-grid">
                    <label className="koma-sub-field koma-sub-field-full"><span>Nome completo / Razão social</span><div><User size={16} /><input value={form.contractingPartyName} onChange={event => updateField('contractingPartyName', event.target.value)} disabled={contractLocked} required /></div></label>
                    <label className="koma-sub-field"><span>CPF / CNPJ</span><div><FileText size={16} /><input value={form.taxId} onChange={event => updateField('taxId', event.target.value)} inputMode="text" disabled={contractLocked} required /></div>{form.taxId.trim() && !contractingTaxKind && <small className="is-error">Informe um CPF ou CNPJ válido.</small>}</label>
                    <label className="koma-sub-field"><span>Nome do restaurante</span><div><Store size={16} /><input value={form.restaurantName} onChange={event => updateField('restaurantName', event.target.value)} disabled={contractLocked} required /></div></label>
                    <label className="koma-sub-field"><span>E-mail</span><div><Mail size={16} /><input type="email" value={form.email} onChange={event => updateField('email', event.target.value)} disabled={contractLocked} required /></div></label>
                    <label className="koma-sub-field"><span>Telefone / WhatsApp</span><div><Phone size={16} /><input type="tel" value={form.phone} onChange={event => updateField('phone', event.target.value)} disabled={contractLocked} required /></div></label>
                  </div>
                  {isCompany && (
                    <div className="koma-sub-representative">
                      <div className="koma-sub-section-title compact"><span><User size={17} /></span><div><h3>Responsável pelo aceite</h3><p>Identifique a pessoa física com poderes para contratar.</p></div></div>
                      <div className="koma-sub-form-grid">
                        <label className="koma-sub-field koma-sub-field-full"><span>Nome completo do responsável</span><div><User size={16} /><input value={form.responsibleName} onChange={event => updateField('responsibleName', event.target.value)} disabled={contractLocked} required /></div></label>
                        <label className="koma-sub-field"><span>CPF do responsável</span><div><FileText size={16} /><input value={form.representativeTaxId} onChange={event => updateField('representativeTaxId', event.target.value)} disabled={contractLocked} required /></div>{form.representativeTaxId.trim() && !isValidCpf(form.representativeTaxId) && <small className="is-error">Informe um CPF válido.</small>}</label>
                        <label className="koma-sub-field"><span>Cargo / função</span><div><Building2 size={16} /><input value={form.representativeRole} onChange={event => updateField('representativeRole', event.target.value)} disabled={contractLocked} required /></div></label>
                      </div>
                    </div>
                  )}
                </section>

                {fixedBillingRequired ? (
                <section className="koma-sub-section-card">
                  <div className="koma-sub-section-title"><span><CreditCard size={18} /></span><div><h2>Forma de pagamento</h2><p>Escolha o meio para o componente fixo após o trial.</p></div></div>
                  <div className="koma-sub-methods" role="radiogroup" aria-label="Forma de pagamento disponível">
                    <button type="button" role="radio" aria-checked={billingMethod === 'credit_card'} className={billingMethod === 'credit_card' ? 'is-selected' : ''} onClick={() => setBillingMethod('credit_card')}><span className="koma-sub-method-radio" /><CreditCard size={19} /><div><strong>Cartão de crédito{!capabilities.credit_card ? ' · indisponível no momento' : ''}</strong><small>Recorrente · R$ 0 hoje · cobrança automática depois do trial</small></div></button>
                    <button type="button" role="radio" aria-checked={billingMethod === 'pix'} className={billingMethod === 'pix' ? 'is-selected' : ''} onClick={() => setBillingMethod('pix')}><span className="koma-sub-method-radio" /><QrCode size={19} /><div><strong>Pix{!capabilities.pix ? ' · indisponível no momento' : ''}</strong><small>QR Code + Pix Copia e Cola · pague com qualquer banco · R$ 0 hoje</small></div></button>
                    <button type="button" role="radio" aria-checked={billingMethod === 'account_money'} className={billingMethod === 'account_money' ? 'is-selected' : ''} onClick={() => setBillingMethod('account_money')}><span className="koma-sub-method-radio" /><Wallet size={19} /><div><strong>Saldo Mercado Pago{!capabilities.account_money ? ' · indisponível no momento' : ''}</strong><small>Recorrente pela sua conta Mercado Pago · R$ 0 hoje</small></div></button>
                  </div>

                  {billingMethod === 'credit_card' && (
                    <div className="koma-sub-card-fields">
                      <label className="koma-sub-field koma-sub-field-full"><span>Número do cartão</span><div><CreditCard size={16} /><input value={cardNumber} onChange={event => setCardNumber(event.target.value)} inputMode="numeric" required /></div></label>
                      <label className="koma-sub-field koma-sub-field-full"><span>Nome impresso no cartão</span><div><User size={16} /><input value={cardHolder} onChange={event => setCardHolder(event.target.value)} required /></div></label>
                      <label className="koma-sub-field"><span>Validade</span><div><Info size={16} /><input value={cardExp} onChange={event => setCardExp(event.target.value)} placeholder="MM/AA" required /></div></label>
                      <label className="koma-sub-field"><span>CVV</span><div><Lock size={16} /><input type="password" value={cardCvv} onChange={event => setCardCvv(event.target.value)} inputMode="numeric" required /></div></label>
                      <label className="koma-sub-field koma-sub-field-full"><span>CPF/CNPJ do titular <small>(opcional se for o mesmo responsável)</small></span><div><FileText size={16} /><input value={cardDoc} onChange={event => setCardDoc(event.target.value)} /></div></label>
                    </div>
                  )}
                  {billingMethod === 'pix' && capabilities.pix && <div className="koma-sub-locked-note"><QrCode size={17} /> Nenhum Pix é cobrado hoje. {activeBillingCycle === 'anual' ? 'Depois da implantação e dos 7 dias grátis, o KÔMA gerará um único QR Code e Pix Copia e Cola do valor anual, quitando os próximos 12 meses.' : 'Quando a primeira mensalidade vencer, o KÔMA exibirá o QR Code e o Pix Copia e Cola; um novo QR será gerado a cada vencimento mensal.'} Você poderá pagar com qualquer banco ou PSP Pix.</div>}
                  {billingMethod === 'account_money' && capabilities.account_money && <div className="koma-sub-locked-note"><Wallet size={17} /> Ao continuar, você será levado ao Mercado Pago apenas para autorizar o uso do seu saldo. A recorrência começa depois do trial.</div>}
                  {!capabilities.credit_card && !capabilities.pix && !capabilities.account_money && <p role="status">Sua inscrição fica salva. Os meios de pagamento estão temporariamente indisponíveis.</p>}
                </section>
                ) : (
                  <section className="koma-sub-section-card">
                    <div className="koma-sub-section-title"><span><CheckCircle2 size={18} /></span><div><h2>Sem cobrança fixa</h2><p>O Pocket desta contratação tem mensalidade fixa de R$ 0. Nenhuma assinatura recorrente de R$ 0 será criada no Mercado Pago.</p></div></div>
                    <div className="koma-sub-locked-note"><Info size={17} /> Pagamentos online dos seus clientes continuam separados: quando você conectar a conta Mercado Pago do restaurante, aplica-se a taxa KÔMA contratada de {formatPercentage(plan.splitFeeRate)} nos pagamentos elegíveis, além das tarifas do provedor.</div>
                  </section>
                )}

                <section className="koma-sub-legal-acceptance">
                  <input id="legal-acceptance" type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={contractLocked} required />
                  <label htmlFor="legal-acceptance">
                    Declaro que as informações estão corretas, que <strong>possuo poderes</strong> para contratar e aceito os <a href="/legal/termos" target="_blank" rel="noreferrer">Termos de Contratação</a>, as <a href="/legal/planos" target="_blank" rel="noreferrer">Condições Comerciais</a>, o <a href="/legal/dpa" target="_blank" rel="noreferrer">Anexo de Tratamento de Dados</a> e a <a href="/legal/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>, versão {LEGAL_VERSION}.{' '}
                    {!fixedBillingRequired
                      ? <strong>Confirmo o Pocket com mensalidade fixa de R$ 0 e taxa KÔMA de {formatPercentage(plan.splitFeeRate)} sobre pagamentos online elegíveis. Não há recorrência fixa a autorizar.</strong>
                      : billingMethod === 'pix'
                        ? activeBillingCycle === 'anual'
                          ? <strong>Escolho Pix anual: R$ 0 hoje; depois da implantação e dos 7 dias grátis, será gerado um único QR Code/Pix Copia e Cola de {formatCurrency(nextChargeAmount)}, quitando os próximos 12 meses. Não há débito Pix automático.</strong>
                          : <strong>Escolho Pix mensal: R$ 0 hoje; depois da implantação e dos 7 dias grátis, cada vencimento mensal será pago por um novo QR Code/Pix Copia e Cola de {formatCurrency(nextChargeAmount)}. Não há débito Pix automático.</strong>
                        : <strong>Autorizo a recorrência por {billingMethodLabel}: R$ 0 hoje e primeira cobrança automática de {formatCurrency(nextChargeAmount)} somente depois dos 7 dias grátis.</strong>}
                  </label>
                </section>
              </form>
            </>
          )}
        </section>

        <aside className="koma-sub-sidebar">
          <section className="koma-sub-summary-card">
            <span className="koma-sub-eyebrow">SUA CONTRATAÇÃO</span>
            <div className="koma-sub-summary-plan"><div><strong>{plan.name.replace('Kôma ', '')}</strong><span>{activeBillingCycle === 'anual' ? 'Plano anual' : 'Plano mensal'}</span></div><span className="koma-sub-summary-price">{activeBillingCycle === 'anual' ? `${formatCurrency(pricing.annualMonthlyEquivalent)}/mês equiv.` : `${formatCurrency(pricing.monthly)}/mês`}</span></div>
            <dl className="koma-sub-summary-list">
              {fixedBillingRequired && activeBillingCycle === 'anual' && <div><dt>Total anual após o trial</dt><dd>{formatCurrency(pricing.annualTotal)}</dd></div>}
              <div><dt>Taxa KÔMA online</dt><dd>{formatPercentage(plan.splitFeeRate)}</dd></div><div><dt>Implantação</dt><dd>R$ 0</dd></div><div><dt>Prestador</dt><dd>{LEGAL_PROVIDER_NAME}</dd></div>
            </dl>
          </section>
          <section className="koma-sub-summary-card">
            <div className="koma-sub-timeline">
              {!fixedBillingRequired ? (
                <>
                  <div><span className="is-active"><CheckCircle2 size={16} /></span><div><strong>Hoje</strong><p>Mensalidade fixa do Pocket: R$ 0.</p></div></div>
                  <div><span><Info size={16} /></span><div><strong>Pagamentos online</strong><p>Taxa KÔMA contratada: {formatPercentage(plan.splitFeeRate)} nos pagamentos elegíveis.</p></div></div>
                </>
              ) : (
                <>
                  <div><span className="is-active"><Gift size={16} /></span><div><strong>Hoje</strong><p>Selecione {billingMethodLabel}. Mensalidade fixa: R$ 0.</p></div></div>
                  <div><span><Info size={16} /></span><div><strong>Depois da configuração</strong><p>Você escolhe quando iniciar os 7 dias grátis completos.</p></div></div>
                  <div><span>{billingMethod === 'pix' ? <QrCode size={16} /> : billingMethod === 'account_money' ? <Wallet size={16} /> : <CreditCard size={16} />}</span><div><strong>Depois do trial</strong><p>{billingMethod === 'pix' ? `QR Pix disponível: ${formatCurrency(nextChargeAmount)}.` : `Primeira cobrança automática: ${formatCurrency(nextChargeAmount)}.`}</p></div></div>
                </>
              )}
            </div>
            <div className="koma-sub-due-row"><span>A pagar hoje</span><strong>{formatCurrency(0)}</strong></div>
            <p className="koma-sub-summary-note">{!fixedBillingRequired
              ? 'Pocket não cria recorrência de mensalidade fixa. A conta Mercado Pago do restaurante para receber clientes é conectada separadamente.'
              : billingMethod === 'pix'
              ? activeBillingCycle === 'anual'
                ? 'Pix anual não é débito automático: depois do trial, um único QR/Copia e Cola universal quita os próximos 12 meses.'
                : 'Pix mensal não é débito automático: cada vencimento gera um novo QR/Copia e Cola universal.'
              : billingMethod === 'account_money'
                ? 'Saldo Mercado Pago é recorrente e depende de saldo disponível na sua conta Mercado Pago no vencimento.'
                : 'Cartão de crédito é recorrente: a primeira cobrança automática acontece somente depois dos 7 dias grátis iniciados por você.'}</p>
            {step === 1 ? (
              <button type="button" className="koma-sub-primary-action" onClick={() => { setStep(2); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Continuar <ArrowRight size={18} /></button>
            ) : step === 2 ? (
              <button type="submit" form="koma-signup-form" className="koma-sub-primary-action" disabled={isSubmitting}>{isSubmitting ? 'Salvando…' : 'Salvar e continuar'} <ArrowRight size={18} /></button>
            ) : (
              <button type="submit" form="koma-checkout-form" className="koma-sub-primary-action" disabled={!canContinue} aria-label="Aceitar e registrar contratação">
                {isSubmitting ? 'Processando…' : !fixedBillingRequired ? 'Ativar Pocket' : billingMethod === 'pix' ? 'Escolher Pix' : billingMethod === 'account_money' ? 'Autorizar Saldo Mercado Pago' : 'Ativar 7 dias grátis'} <ArrowRight size={18} />
              </button>
            )}
            <p className="koma-sub-fineprint">O aceite registra protocolo, hashes dos documentos, condições comerciais e evidências técnicas da contratação.</p>
          </section>
        </aside>
      </main>
    </div>
  );
}
