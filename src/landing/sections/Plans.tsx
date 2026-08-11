import React, { useState } from 'react';
import NumberFlow from '@number-flow/react';
import { Check, MessageCircle, Wrench } from 'lucide-react';
import {
  ANNUAL_DISCOUNT_RATE,
  SUBSCRIPTION_PLANS,
  formatCurrency,
  getSubscriptionPricing,
} from '../../config/subscriptionPlans';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';

const LANDING_PLAN_FEATURES: Record<string, string[]> = {
  pocket: [
    'Mesas, comandas e balcão',
    'Gestão de cardápio e caixa',
    'Relatórios operacionais básicos',
  ],
  pro: [
    'Tudo do Pocket',
    'KDS e impressão automática',
    'Equipe, cargos e permissões',
    'Relatórios financeiros completos',
    'Pedidos de retirada e delivery',
  ],
  premium: [
    'Tudo do Pro',
    'Cardápio online e QR Code inclusos',
    'Aceite de pedidos digitais no PDV',
    'Maior franquia do Chef Virtual',
    'Mais automação para a operação',
  ],
};

export function Plans() {
  const [isYearly, setIsYearly] = useState(false);

  return (
    <section className="koma-plans-section" id="planos" aria-labelledby="plans-title">
      <div className="koma-section-heading koma-section-heading--light">
        <span>05 / PLANOS</span>
        <h2 id="plans-title">ESCOLHA COM<br />CLAREZA.</h2>
        <p>Comece com o que sua operação precisa hoje e evolua sem trocar de sistema.</p>
      </div>

      <div className="koma-plans-risk" aria-label="Como reduzimos o risco da contratação">
        <div>
          <span>ANTES DE CONTRATAR</span>
          <strong>ENTENDA O ENCAIXE NA SUA OPERAÇÃO.</strong>
          <p>Mostramos o fluxo, conferimos seus equipamentos e planejamos a implantação com você.</p>
        </div>
        <ul>
          <li><MessageCircle aria-hidden="true" /><span><b>CONVERSA INICIAL</b> sem custo</span></li>
          <li><Wrench aria-hidden="true" /><span><b>COMPATIBILIDADE</b> verificada antes</span></li>
          <li><Check aria-hidden="true" /><span><b>IMPLANTAÇÃO</b> acompanhada</span></li>
        </ul>
      </div>

      <div className="koma-plans-billing" aria-label="Período de cobrança dos planos">
        <div className="koma-plans-billing-switch" role="group" aria-label="Escolha entre cobrança mensal ou anual">
          <button
            type="button"
            className={!isYearly ? 'is-active' : ''}
            aria-pressed={!isYearly}
            onClick={() => setIsYearly(false)}
          >
            Mensal
          </button>
          <button
            type="button"
            className={isYearly ? 'is-active' : ''}
            aria-pressed={isYearly}
            onClick={() => setIsYearly(true)}
          >
            Anual
            <span>{ANNUAL_DISCOUNT_RATE * 100}% OFF</span>
          </button>
        </div>
        <p>{isYearly ? '10% de desconto no pagamento anual' : 'Pagamento mês a mês'}</p>
      </div>

      <div className="koma-plans-grid">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const pricing = getSubscriptionPricing(plan.price);
          const displayPrice = isYearly ? pricing.annualMonthlyEquivalent : pricing.monthly;

          return (
            <article className={`koma-plan-card ${plan.recommended ? 'koma-plan-card--featured' : ''}`} key={plan.id}>
              <div className="koma-plan-card-heading">
                <div>
                  <span>{plan.recommended ? 'MAIS ESCOLHIDO' : 'PLANO KÔMA'}</span>
                  <h3>{plan.name.replace('Kôma ', '')}</h3>
                </div>
                <small>{isYearly ? 'ANUAL' : 'MENSAL'}</small>
              </div>
              <p className="koma-plan-tagline">{plan.tagline}</p>
              <div className="koma-plan-price">
                <span>R$</span>
                <strong>
                  <NumberFlow
                    value={displayPrice}
                    locales="pt-BR"
                    format={{
                      minimumFractionDigits: isYearly ? 2 : 0,
                      maximumFractionDigits: 2,
                    }}
                    willChange
                  />
                </strong>
                <small>/mês</small>
              </div>
              <p className="koma-plan-billing-note">
                {isYearly
                  ? `${formatCurrency(pricing.annualTotal)} cobrados anualmente`
                  : 'Cobrança mensal'}
              </p>
              <ul>
                {LANDING_PLAN_FEATURES[plan.id].map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <a href={KOMA_LANDING_CONFIG.signupAnchor} className={`koma-btn ${plan.recommended ? 'koma-btn--primary' : 'koma-btn--outline-dark'}`}>
                Conversar sobre o {plan.name}
              </a>
            </article>
          );
        })}
      </div>
      <p className="koma-plans-note">Valores, taxas de implantação e disponibilidade de recursos são confirmados na proposta comercial.</p>
    </section>
  );
}
