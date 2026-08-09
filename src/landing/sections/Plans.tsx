import React from 'react';
import { SUBSCRIPTION_PLANS } from '../../config/subscriptionPlans';
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
  return (
    <section className="koma-plans-section" id="planos" aria-labelledby="plans-title">
      <div className="koma-section-heading koma-section-heading--light">
        <span>07 / PLANOS</span>
        <h2 id="plans-title">COMECE PELO<br />TAMANHO CERTO.</h2>
        <p>Três níveis de operação. Você evolui sem precisar trocar de sistema.</p>
      </div>

      <div className="koma-plans-grid">
        {SUBSCRIPTION_PLANS.map((plan) => (
          <article className={`koma-plan-card ${plan.recommended ? 'koma-plan-card--featured' : ''}`} key={plan.id}>
            <div className="koma-plan-card-heading">
              <div>
                <span>{plan.recommended ? 'MAIS ESCOLHIDO' : 'PLANO KÔMA'}</span>
                <h3>{plan.name.replace('Kôma ', '')}</h3>
              </div>
              <small>MENSAL</small>
            </div>
            <p className="koma-plan-tagline">{plan.tagline}</p>
            <div className="koma-plan-price">
              <span>R$</span>
              <strong>{plan.price}</strong>
              <small>/mês</small>
            </div>
            <ul>
              {LANDING_PLAN_FEATURES[plan.id].map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <a href={KOMA_LANDING_CONFIG.signupAnchor} className={`koma-btn ${plan.recommended ? 'koma-btn--primary' : 'koma-btn--outline-dark'}`}>
              Escolher o {plan.name}
            </a>
          </article>
        ))}
      </div>
      <p className="koma-plans-note">Valores e recursos podem ser ajustados conforme contratação e implantação.</p>
    </section>
  );
}
