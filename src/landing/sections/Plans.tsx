import React, { useState } from 'react';
import {
  ANNUAL_DISCOUNT_RATE,
  SUBSCRIPTION_PLANS,
  formatCurrency,
  getSubscriptionPricing,
} from '../../config/subscriptionPlans';

const PLAN_FEATURES: Record<string, string[]> = {
  pocket: ['Mesas, comandas e balcão', 'Cardápio e frente de caixa', 'Relatórios essenciais'],
  pro: ['Tudo do Pocket', 'KDS e impressão automática', 'Equipe e permissões', 'Relatórios completos', 'Retirada e delivery'],
  premium: ['Tudo do Pro', 'Cardápio digital e QR Code', 'Pedidos digitais no PDV', 'Suporte prioritário'],
};

function displayPrice(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function Plans({ onOpenLead }: { onOpenLead: () => void }) {
  const [isYearly, setIsYearly] = useState(false);

  return (
    <section className="koma-plans-section" id="planos" aria-labelledby="plans-title">
      <div className="koma-container">
        <header className="koma-plans-heading">
          <div>
            <p className="koma-eyebrow"><span />Planos para cada momento</p>
            <h2 id="plans-title">Comece com o que precisa.<br /><em>Evolua sem trocar de sistema.</em></h2>
          </div>
          <div className="koma-billing-toggle" role="group" aria-label="Período de cobrança">
            <button type="button" className={!isYearly ? 'is-active' : ''} aria-pressed={!isYearly} onClick={() => setIsYearly(false)}>Mensal</button>
            <button type="button" className={isYearly ? 'is-active' : ''} aria-pressed={isYearly} onClick={() => setIsYearly(true)}>Anual <span>{ANNUAL_DISCOUNT_RATE * 100}% off</span></button>
          </div>
        </header>

        <div className="koma-plans-grid">
          {SUBSCRIPTION_PLANS.map((plan) => {
            const pricing = getSubscriptionPricing(plan.price);
            const price = isYearly ? pricing.annualMonthlyEquivalent : pricing.monthly;
            return (
              <article className={`koma-plan-card ${plan.recommended ? 'is-featured' : ''}`} key={plan.id}>
                <header>
                  <span>{plan.recommended ? 'Mais escolhido' : 'Plano Kôma'}</span>
                  <h3>{plan.name.replace('Kôma ', '')}</h3>
                  <p>{plan.tagline}</p>
                </header>
                <div className="koma-plan-price"><small>R$</small><strong>{displayPrice(price)}</strong><span>/mês</span></div>
                <p className="koma-plan-billing">
                  {isYearly ? `${formatCurrency(pricing.annualTotal)} cobrados por ano` : 'Cobrança mensal'}
                </p>
                <ul>{PLAN_FEATURES[plan.id].map((feature) => <li key={feature}><i aria-hidden="true">✓</i>{feature}</li>)}</ul>
                <button type="button" className={`koma-btn ${plan.recommended ? 'koma-btn--primary' : 'koma-btn--outline'}`} onClick={onOpenLead}>
                  Conversar sobre o {plan.name.replace('Kôma ', '')}
                </button>
                <small className="koma-plan-setup">Implantação: {formatCurrency(plan.implementationFee)}</small>
              </article>
            );
          })}
        </div>
        <p className="koma-plans-note">Os recursos e a compatibilidade dos equipamentos são confirmados antes da contratação.</p>
      </div>
    </section>
  );
}
