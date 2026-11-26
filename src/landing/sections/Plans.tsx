import React, { useState } from 'react';
import { Check, Minus } from 'lucide-react';
import {
  ANNUAL_DISCOUNT_RATE,
  FUTURE_MODULES,
  ONBOARDING_OFFER,
  PLAN_COMPARISON_MATRIX,
  SUBSCRIPTION_PLANS,
  formatCurrency,
  getSubscriptionPricing,
  type FeatureComparisonRow,
  type SubscriptionPlanId,
} from '../../config/subscriptionPlans';

const PLAN_PRESENTATION: Record<SubscriptionPlanId, {
  stage: string;
  action: string;
  fit: string;
}> = {
  pocket: {
    stage: 'ENTRADA SIMPLES',
    action: 'COMEÇAR',
    fit: 'Para lanchonetes, cafés e restaurantes enxutos com salão, balcão e delivery próprio.',
  },
  pro: {
    stage: 'MAIS RECOMENDADO',
    action: 'ORGANIZAR',
    fit: 'Para restaurantes com cozinha ativa, controle de estoque e entregas próprias.',
  },
  premium: {
    stage: 'GESTÃO COMPLETA',
    action: 'ESCALAR',
    fit: 'Para operações que querem fidelizar clientes com pontos, cashback e cupons.',
  },
};

const FUTURE_MODULE_ITEMS = Object.values(FUTURE_MODULES ?? {}) as Array<{
  id: string;
  name: string;
  status: string;
  available: boolean;
  summary: string;
}>;

const COMPARISON_CATEGORIES = PLAN_COMPARISON_MATRIX.reduce<string[]>((categories, row) => {
  if (!categories.includes(row.category)) categories.push(row.category);
  return categories;
}, []);

function comparisonValue(value: FeatureComparisonRow['pocket']) {
  if (value === true) return <span className="koma-comparison-yes"><Check size={16} aria-hidden="true" /> Incluído</span>;
  if (value === false) return <span className="koma-comparison-no"><Minus size={16} aria-hidden="true" /> Não</span>;
  return <span className="koma-comparison-text">{value}</span>;
}

export function Plans() {
  const [isYearly, setIsYearly] = useState(false);
  const billing = isYearly ? 'anual' : 'mensal';

  return (
    <section className="koma-plans-section koma-plans-section--simple" id="planos" aria-labelledby="plans-title">
      <div className="koma-plans-simple-heading">
        <div>
          <span>05 / PLANOS</span>
          <h2 id="plans-title">COMECE ENXUTO.<br />CRESÇA NO SEU RITMO.</h2>
        </div>
        <div>
          <p><strong>0% DE COMISSÃO KÔMA NOS PEDIDOS PRÓPRIOS.</strong> Válido para todos os planos, sem cobrança por volume de pedidos.</p>
          <small>
            Implantação padrão gratuita. Implantação VIP opcional por {formatCurrency(ONBOARDING_OFFER?.vip_price ?? 299)} ({ONBOARDING_OFFER?.vip_scope}). Tarifas de pagamento de terceiros são cobradas à parte pelo provedor conectado.
          </small>
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
        <p>
          {isYearly
            ? `Pocket, Pro e Premium: valor mensal equivalente com ${ANNUAL_DISCOUNT_RATE * 100}% de desconto na assinatura fixa.`
            : 'Pague mês a mês, sem fidelidade e com implantação padrão gratuita.'}
        </p>
      </div>

      <div className="koma-plan-trial-note" role="note" aria-label="Condição do período de teste">
        <strong>7 DIAS GRÁTIS APÓS A CONFIGURAÇÃO INICIAL</strong>
        <span>O período de teste começa somente depois que você prepara o essencial para operar; você não perde dias enquanto monta o cardápio.</span>
      </div>

      <div className="koma-plans-grid koma-plans-grid--simple">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const pricing = getSubscriptionPricing(plan.price);
          const displayPrice = isYearly ? pricing.annualMonthlyEquivalent : pricing.monthly;
          const presentation = PLAN_PRESENTATION[plan.id];
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

              <p className="koma-plan-tagline">{plan.tagline}</p>
              <p className="koma-plan-fit"><b>PARA QUEM É</b>{presentation.fit}</p>

              <div className="koma-plan-price" aria-label={`${formatCurrency(displayPrice)} por mês${isYearly ? ', equivalente no plano anual' : ''}`}>
                <span>R$</span>
                <strong>
                  {displayPrice.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
                <small>{isYearly ? '/mês equiv.' : '/mês'}</small>
              </div>
              <p className="koma-plan-billing-note">
                {isYearly
                  ? `${formatCurrency(pricing.annualTotal)} por ano · condições exibidas na contratação`
                  : 'Implantação padrão gratuita · VIP opcional R$ 299,00'}
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

              {plan.limitations.length > 0 && (
                <div className="koma-plan-limitations">
                  <strong>NÃO INCLUI NESTE PLANO</strong>
                  <ul>
                    {plan.limitations.map((limitation) => (
                      <li key={limitation}><Minus size={15} aria-hidden="true" />{limitation.replace(/^Sem /, '')}</li>
                    ))}
                  </ul>
                </div>
              )}

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

      <details className="koma-plan-comparison">
        <summary>
          <span className="koma-plan-comparison-copy">
            <strong>COMPARE TODOS OS RECURSOS</strong>
            <small>Veja exatamente o que muda entre Pocket, Pro e Premium.</small>
          </span>
          <span className="koma-plan-comparison-toggle" aria-hidden="true">+</span>
        </summary>
        <p className="koma-plan-comparison-swipe" aria-hidden="true">
          DESLIZE A TABELA PARA COMPARAR <span>→</span>
        </p>
        <div
          className="koma-plan-comparison-scroll"
          tabIndex={0}
          aria-label="Tabela comparativa dos planos. Em telas pequenas, use rolagem horizontal para ver todas as colunas."
        >
          <table>
            <caption>Comparação dos recursos incluídos nos planos KÔMA Pocket, Pro e Premium.</caption>
            <thead>
              <tr>
                <th scope="col">Recurso</th>
                <th scope="col">Pocket</th>
                <th scope="col">Pro</th>
                <th scope="col">Premium</th>
              </tr>
            </thead>
            {COMPARISON_CATEGORIES.map((category) => (
              <tbody key={category}>
                <tr className="koma-comparison-category">
                  <th colSpan={4} scope="rowgroup">{category}</th>
                </tr>
                {PLAN_COMPARISON_MATRIX.filter((row) => row.category === category).map((row) => (
                  <tr key={`${row.category}-${row.feature}`}>
                    <th scope="row">{row.feature}</th>
                    <td>{comparisonValue(row.pocket)}</td>
                    <td>{comparisonValue(row.pro)}</td>
                    <td>{comparisonValue(row.premium)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </details>

      {FUTURE_MODULE_ITEMS.length > 0 && (
        <div className="koma-plan-trial-note" role="note" aria-label="Módulos especializados em desenvolvimento">
          <strong>MÓDULOS ESPECIALIZADOS FUTUROS (EM PREPARAÇÃO)</strong>
          <span>
            Recursos como integração com iFood, emissão fiscal, autoatendimento (totem) e financeiro gerencial completo estão em fase de homologação e não fazem parte da oferta ativa de hoje nem estão disponíveis para compra avulsa nesta etapa.
          </span>
        </div>
      )}

      <p className="koma-plans-note">
        Implantação padrão gratuita; Implantação VIP opcional por {formatCurrency(ONBOARDING_OFFER?.vip_price ?? 299)}. A comissão KÔMA é 0% por pedido online próprio nos três planos; custos de gateways e adquirentes são cobrados à parte pelo provedor conectado. No anual, o desconto de 10% vale apenas para a assinatura fixa. App do entregador sem GPS ao vivo; atendimento prioritário não significa plantão 24 horas. Emissão fiscal, totem, financeiro gerencial avançado e integração com marketplaces ainda não estão disponíveis nesta fase.
      </p>
    </section>
  );
}
