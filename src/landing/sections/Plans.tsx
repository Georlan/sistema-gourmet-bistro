import React, { useState } from 'react';
import { Check } from 'lucide-react';
import {
  ANNUAL_DISCOUNT_RATE,
  SUBSCRIPTION_PLANS,
  formatCurrency,
  formatPercentage,
  getSubscriptionPricing,
  type SubscriptionPlanId,
} from '../../config/subscriptionPlans';

const PLAN_PRESENTATION: Record<SubscriptionPlanId, {
  stage: string;
  action: string;
  fit: string;
  note: string;
}> = {
  pocket: {
    stage: 'ENTRADA SIMPLES',
    action: 'COMEÇAR',
    fit: 'Para quem quer vender no salão, balcão e delivery com uma operação enxuta.',
    note: 'Tudo o que é essencial para começar: cardápio digital, pedidos, caixa, clientes e fila de preparo na tela.',
  },
  pro: {
    stage: 'MAIS RECOMENDADO',
    action: 'ORGANIZAR',
    fit: 'Para quem quer conectar equipe, cozinha, estoque e financeiro em uma operação mais profissional.',
    note: 'É o melhor equilíbrio entre recursos de gestão e uma taxa menor nos pedidos pagos online.',
  },
  premium: {
    stage: 'MENOR TAXA',
    action: 'ESCALAR',
    fit: 'Para quem quer gestão completa, entregadores e fidelização com a menor taxa KÔMA.',
    note: 'App do entregador, pontos, cashback e cupons já fazem parte do plano. Não existem módulos pagos à parte.',
  },
};

export function Plans() {
  const [isYearly, setIsYearly] = useState(false);

  return (
    <section className="koma-plans-section koma-plans-section--simple" id="planos" aria-labelledby="plans-title">
      <div className="koma-plans-simple-heading">
        <div>
          <span>05 / PLANOS</span>
          <h2 id="plans-title">COMECE LEVE.<br />CRESÇA PAGANDO MENOS.</h2>
        </div>
        <div>
          <p><strong>SEM TAXA DE IMPLANTAÇÃO.</strong> Sem add-ons. Você escolhe o plano e já sabe o que está incluído.</p>
          <small>Quanto mais completo o plano, menor a taxa KÔMA nos pedidos online pagos. Cardápio digital, mesas e delivery já começam no Pocket.</small>
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
        <p>{isYearly ? `Valor mensal equivalente com ${ANNUAL_DISCOUNT_RATE * 100}% de desconto na assinatura. Cobrança anual.` : 'Pague mês a mês, sem taxa de implantação'}</p>
      </div>

      <div className="koma-plans-grid koma-plans-grid--simple">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const pricing = getSubscriptionPricing(plan.price);
          const displayPrice = isYearly ? pricing.annualMonthlyEquivalent : pricing.monthly;
          const presentation = PLAN_PRESENTATION[plan.id];
          const billing = isYearly ? 'anual' : 'mensal';
          const planLabel = plan.name.replace('Kôma ', '').toUpperCase();

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
                  {displayPrice.toLocaleString('pt-BR', {
                    minimumFractionDigits: isYearly ? 2 : 0,
                    maximumFractionDigits: 2,
                  })}
                </strong>
                <small>/mês</small>
              </div>
              <p className="koma-plan-billing-note">
                {isYearly
                  ? `${formatCurrency(pricing.annualTotal)} por ano · sem taxa de implantação`
                  : 'Sem taxa de implantação'}
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

              <div className="koma-plan-addons" aria-label={`Taxa de pagamentos online do ${plan.name}`}>
                <h4>PAGAMENTOS ONLINE</h4>
                <dl>
                  <div className="is-included">
                    <dt>Taxa KÔMA por pedido online pago</dt>
                    <dd>{formatPercentage(plan.splitFeeRate)}</dd>
                  </div>
                </dl>
                <p>
                  {plan.id === 'premium'
                    ? 'A menor taxa KÔMA entre os planos. Você só paga essa taxa quando recebe um pedido online pago pelo sistema.'
                    : 'Você só paga essa taxa quando recebe um pedido online pago pelo sistema.'}
                </p>
              </div>

              <a
                href={`/contratar/${plan.id}?cobranca=${billing}`}
                className={`koma-btn ${plan.recommended ? 'koma-btn--primary' : 'koma-btn--outline-dark'}`}
              >
                CONTRATAR {planLabel}
              </a>
            </article>
          );
        })}
      </div>
      <p className="koma-plans-note">Sem taxa de implantação e sem add-ons. A taxa KÔMA incide somente sobre pedidos online pagos pelo sistema; custos do provedor de pagamento são separados e seguem as condições do provedor. No anual, o desconto de 10% vale apenas para a assinatura fixa e a taxa por pedido permanece igual. A disponibilidade do pagamento online depende da ativação da conta do provedor. App do entregador sem GPS ao vivo; suporte prioritário não significa plantão 24 horas. Emissão fiscal e integração com marketplaces não fazem parte desta oferta.</p>
    </section>
  );
}
