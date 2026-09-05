import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink } from 'lucide-react';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../brand/komaBrand';
import {
  SUBSCRIPTION_PLANS,
  formatCurrency,
  formatPercentage,
  getSubscriptionPricing,
  type SubscriptionPlanId,
} from '../config/subscriptionPlans';
import { LEGAL_PROVIDER_NAME, LEGAL_VERSION } from './legalContent';
import './legal.css';

type ContractForm = {
  contractingPartyName: string;
  taxId: string;
  responsibleName: string;
  representativeRole: string;
  email: string;
  phone: string;
  restaurantName: string;
};

type ContractCopy = {
  kicker: string;
  description: string;
};

const EMPTY_FORM: ContractForm = {
  contractingPartyName: '',
  taxId: '',
  responsibleName: '',
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
  const [previewComplete, setPreviewComplete] = useState(false);

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
  const canContinue = accepted && Object.values(form).every((value) => value.trim().length > 0);

  const updateField = (field: keyof ContractForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setPreviewComplete(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canContinue) return;
    // Nesta etapa a tela valida UX + identificação + seleção comercial + documentos.
    // O próximo passo conecta o evento ao registro imutável de aceite e ao provisionamento seguro.
    setPreviewComplete(true);
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
              regerão a contratação. Nada fica escondido no fim do processo.
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
                <input
                  id="contracting-party-name"
                  name="contractingPartyName"
                  autoComplete="organization"
                  value={form.contractingPartyName}
                  onChange={(event) => updateField('contractingPartyName', event.target.value)}
                  placeholder="Pessoa ou empresa que contratará o KÔMA"
                  required
                />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="contract-tax-id">CPF / CNPJ do contratante</label>
                <input
                  id="contract-tax-id"
                  name="taxId"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.taxId}
                  onChange={(event) => updateField('taxId', event.target.value)}
                  placeholder="Documento do contratante"
                  required
                />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="restaurant-name">Nome do restaurante</label>
                <input
                  id="restaurant-name"
                  name="restaurantName"
                  autoComplete="organization"
                  value={form.restaurantName}
                  onChange={(event) => updateField('restaurantName', event.target.value)}
                  placeholder="Nome do estabelecimento"
                  required
                />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="responsible-name">Responsável pela contratação</label>
                <input
                  id="responsible-name"
                  name="responsibleName"
                  autoComplete="name"
                  value={form.responsibleName}
                  onChange={(event) => updateField('responsibleName', event.target.value)}
                  placeholder="Nome completo"
                  required
                />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="representative-role">Cargo / função do representante</label>
                <input
                  id="representative-role"
                  name="representativeRole"
                  value={form.representativeRole}
                  onChange={(event) => updateField('representativeRole', event.target.value)}
                  placeholder="Ex.: proprietário, sócio, administrador"
                  required
                />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="contract-email">E-mail oficial</label>
                <input
                  id="contract-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  placeholder="voce@restaurante.com"
                  required
                />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="contract-phone">Telefone / WhatsApp</label>
                <input
                  id="contract-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) => updateField('phone', event.target.value)}
                  placeholder="(00) 00000-0000"
                  required
                />
              </div>
            </div>

            <div className="koma-contract-acceptance">
              <input
                id="legal-acceptance"
                type="checkbox"
                checked={accepted}
                onChange={(event) => {
                  setAccepted(event.target.checked);
                  setPreviewComplete(false);
                }}
              />
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
              Revisar contratação <ArrowRight size={17} aria-hidden="true" />
            </button>
            <p className="koma-contract-note">
              Esta etapa apresenta a oferta, a identidade declarada e a versão jurídica selecionadas. O registro
              imutável do aceite, os hashes dos documentos, a prova de sessão e o provisionamento automático serão
              conectados ao backend antes da liberação definitiva do self-service.
            </p>

            {previewComplete && (
              <div className="koma-contract-status" role="status">
                <CheckCircle2 size={18} aria-hidden="true" />
                <strong> Revisão pronta.</strong> Os dados do contratante, o plano, a cobrança e a versão jurídica estão prontos para o endpoint de contratação da próxima etapa.
              </div>
            )}
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
              <div><dt>Trial padrão</dt><dd>7 dias sem mensalidade</dd></div>
              <div><dt>Pagamento online</dt><dd>via conta do restaurante</dd></div>
              <div><dt>Prestador</dt><dd>{LEGAL_PROVIDER_NAME}</dd></div>
            </dl>

            <p className="koma-contract-note">
              O CPF e os demais dados jurídicos necessários do prestador constarão do Comprovante de Contratação individual entregue após o aceite definitivo.
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
