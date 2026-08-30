import React, { useState } from 'react';
import NumberFlow from '@number-flow/react';
import { Check } from 'lucide-react';
import {
  ANNUAL_DISCOUNT_RATE,
  SUBSCRIPTION_PLANS,
  formatCurrency,
  getSubscriptionPricing,
  getPlanAddons,
  type SubscriptionPlanId,
} from '../../config/subscriptionPlans';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';

const PLAN_PRESENTATION: Record<SubscriptionPlanId, {
  stage: string;
  action: string;
  fit: string;
  note: string;
}> = {
  pocket: {
    stage: 'PARA COMEÇAR',
    action: 'ORGANIZAR',
    fit: 'Para quem atende mesas, faz entregas ou os dois, com uma operação enxuta.',
    note: 'Delivery funciona mesmo sem cardápio digital ou app do entregador.',
  },
  pro: {
    stage: 'MELHOR ESCOLHA',
    action: 'CONECTAR',
    fit: 'Para vender online e ter atendimento, cozinha e gestão trabalhando juntos.',
    note: 'Receba pedidos online sem precisar contratar o app do entregador.',
  },
  premium: {
    stage: 'PACOTE COMPLETO',
    action: 'EXPANDIR',
    fit: 'Para reunir gestão, entregadores e fidelização, com suporte prioritário.',
    note: 'Os três adicionais abaixo já fazem parte do seu plano.',
  },
};

export function Plans() {
  const [isYearly, setIsYearly] = useState(false);

  return (
    <section className="koma-plans-section koma-plans-section--simple" id="planos" aria-labelledby="plans-title">
      <div className="koma-plans-simple-heading">
        <div>
          <span>08 / PLANOS</span>
          <h2 id="plans-title">COMECE CERTO.<br />CRESÇA SEM TROCAR.</h2>
        </div>
        <div>
          <p><strong>POCKET</strong> organiza. <strong>PRO</strong> conecta e vende online. <strong>PREMIUM</strong> reúne entregas e fidelização.</p>
          <small>Mesas e delivery em todos os planos. Adicione só o que fizer sentido para você.</small>
        </div>
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
            Anual <span>{ANNUAL_DISCOUNT_RATE * 100}% OFF</span>
          </button>
        </div>
        <p>{isYearly ? `Valor mensal equivalente com ${ANNUAL_DISCOUNT_RATE * 100}% de desconto. Cobrança anual.` : 'Pague mês a mês'}</p>
      </div>

      <div className="koma-plans-grid koma-plans-grid--simple">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const pricing = getSubscriptionPricing(plan.price);
          const displayPrice = isYearly ? pricing.annualMonthlyEquivalent : pricing.monthly;
          const presentation = PLAN_PRESENTATION[plan.id];

          return (
            <article aria-labelledby={`plan-${plan.id}-title`} className={`koma-plan-card koma-plan-card--simple ${plan.recommended ? 'koma-plan-card--featured' : ''}`} key={plan.id}>
              <div className="koma-plan-card-heading">
                <div>
                  <span>{presentation.stage}</span>
                  <h3 id={`plan-${plan.id}-title`}>{plan.name.replace('Kôma ', '')}</h3>
                </div>
                <small>{presentation.action}</small>
              </div>

              <p className="koma-plan-fit"><b>PARA QUEM É</b>{presentation.fit}</p>

              <div className="koma-plan-price" aria-label={`${formatCurrency(displayPrice)} por mês${isYearly ? ', equivalente no plano anual' : ''}`}>
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
                  ? `${formatCurrency(pricing.annualTotal)} por ano · Implantação: ${formatCurrency(plan.implementationFee)}`
                  : `Implantação: ${formatCurrency(plan.implementationFee)}`}
              </p>
              {isYearly && (
                <p className="koma-plan-savings is-active">
                  ECONOMIZE {formatCurrency(pricing.annualSavings)} POR ANO
                </p>
              )}

              <ul className="koma-plan-features">
                {plan.features.map((feature) => (
                  <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>
                ))}
              </ul>
              <p className="koma-plan-extra">{presentation.note}</p>

              <div className="koma-plan-addons" aria-label={`Adicionais do ${plan.name}`}>
                <h4>{plan.id === 'premium' ? 'JÁ INCLUÍDOS NO PACOTE' : 'PERSONALIZE SEU PLANO'}</h4>
                <dl>
                  {getPlanAddons(plan.id).map(addon => (
                    <div className={addon.included ? 'is-included' : ''} key={addon.id}>
                      <dt>{addon.name}</dt>
                      <dd>{addon.included ? <><Check size={13} aria-hidden="true" /> Incluído</> : <>{formatCurrency(addon.price)}<small>/mês</small></>}</dd>
                    </div>
                  ))}
                </dl>
                <p>{plan.id === 'premium' ? 'Sem cobrança extra por esses adicionais.' : 'Opcionais, cobrados à parte por mês, inclusive no plano anual.'}</p>
              </div>

              <a href={KOMA_LANDING_CONFIG.signupAnchor} className={`koma-btn ${plan.recommended ? 'koma-btn--primary' : 'koma-btn--outline-dark'}`}>
                ESCOLHER {plan.name.replace('Kôma ', '').toUpperCase()}
              </a>
            </article>
          );
        })}
      </div>
      <p className="koma-plans-note">O desconto anual vale para o plano, sem incluir implantação ou adicionais. O app do entregador não inclui rastreamento GPS ao vivo. Condições e compatibilidade são confirmadas antes da contratação.</p>
    </section>
  );
}
