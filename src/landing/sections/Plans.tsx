import React, { useState } from 'react';
import NumberFlow from '@number-flow/react';
import { Check } from 'lucide-react';
import {
  ANNUAL_DISCOUNT_RATE,
  SUBSCRIPTION_PLANS,
  formatCurrency,
  getSubscriptionPricing,
} from '../../config/subscriptionPlans';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';

const PLAN_PRESENTATION: Record<string, {
  stage: string;
  action: string;
  fit: string;
  features: string[];
  note: string;
}> = {
  pocket: {
    stage: 'PARA COMEÇAR',
    action: 'ORGANIZAR',
    fit: 'Operação pequena que precisa colocar salão e caixa em ordem.',
    features: ['Mesas, comandas e balcão', 'Cardápio, caixa e fechamento', 'Relatórios essenciais'],
    note: 'Cardápio online opcional por R$ 49/mês.',
  },
  pro: {
    stage: 'MELHOR ESCOLHA',
    action: 'CONECTAR',
    fit: 'Restaurante que quer salão, cozinha, delivery e gestão trabalhando juntos.',
    features: ['Tudo do Pocket', 'KDS e impressão automática', 'Estoque, financeiro e equipe', 'Retirada e delivery'],
    note: 'Cardápio online opcional por R$ 49/mês.',
  },
  premium: {
    stage: 'PARA VENDER ONLINE',
    action: 'EXPANDIR',
    fit: 'Operação que quer receber pedidos digitais no mesmo fluxo do restaurante.',
    features: ['Tudo do Pro', 'Cardápio online e QR Code inclusos', 'Pedidos digitais no PDV', 'Suporte prioritário'],
    note: 'Cardápio online já incluído.',
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
          <p><strong>POCKET</strong> organiza. <strong>PRO</strong> conecta. <strong>PREMIUM</strong> inclui o cardápio online.</p>
          <small>Escolha pelo momento da sua operação — não por uma lista interminável de recursos.</small>
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
        <p>{isYearly ? 'Economize 10% no plano anual' : 'Pague mês a mês'}</p>
      </div>

      <div className="koma-plans-grid koma-plans-grid--simple">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const pricing = getSubscriptionPricing(plan.price);
          const displayPrice = isYearly ? pricing.annualMonthlyEquivalent : pricing.monthly;
          const presentation = PLAN_PRESENTATION[plan.id];

          return (
            <article className={`koma-plan-card koma-plan-card--simple ${plan.recommended ? 'koma-plan-card--featured' : ''}`} key={plan.id}>
              <div className="koma-plan-card-heading">
                <div>
                  <span>{presentation.stage}</span>
                  <h3>{plan.name.replace('Kôma ', '')}</h3>
                </div>
                <small>{presentation.action}</small>
              </div>

              <p className="koma-plan-fit"><b>PARA QUEM É</b>{presentation.fit}</p>

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
                  ? `${formatCurrency(pricing.annualTotal)} por ano · Implantação: ${formatCurrency(plan.implementationFee)}`
                  : `Implantação: ${formatCurrency(plan.implementationFee)}`}
              </p>

              <ul>
                {presentation.features.map((feature) => (
                  <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>
                ))}
              </ul>
              <p className="koma-plan-extra">{presentation.note}</p>

              <a href={KOMA_LANDING_CONFIG.signupAnchor} className={`koma-btn ${plan.recommended ? 'koma-btn--primary' : 'koma-btn--outline-dark'}`}>
                ESCOLHER {plan.name.replace('Kôma ', '').toUpperCase()}
              </a>
            </article>
          );
        })}
      </div>
      <p className="koma-plans-note">Valores mensais públicos. Condições e compatibilidade são confirmadas antes da contratação.</p>
    </section>
  );
}
