import React, { useState } from 'react';
import { ANNUAL_DISCOUNT_RATE, PLAN_COMPARISON_MATRIX, SUBSCRIPTION_PLANS, formatCurrency, formatPercentage, getSubscriptionPricing, type FeatureComparisonRow, type SubscriptionPlanId } from '../../config/subscriptionPlans';

const highlights: Record<SubscriptionPlanId, number[]> = { pocket: [0, 1, 3, 5], pro: [0, 1, 2, 3], premium: [0, 1, 2, 3] };
const categories = [...new Set(PLAN_COMPARISON_MATRIX.map(row => row.category))];
function cell(value: FeatureComparisonRow['pocket']) { return value === true ? 'Incluído' : value === false ? '—' : value; }
export function Plans() {
  const [yearly, setYearly] = useState(false);
  return <section className="v2-section v2-plans" id="planos" aria-labelledby="plans-title"><div className="v2-wrap">
    <div className="v2-section-heading" data-reveal><p className="v2-eyebrow">Planos</p><h2 id="plans-title">Escolha o plano para a sua operação.</h2><p>Compare o valor fixo, a taxa KÔMA sobre pedidos online pagos e os recursos que mudam de um plano para outro.</p></div>
    <div className="v2-billing" role="group" aria-label="Período de cobrança"><button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>Mensal</button><button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>Anual <span>— {ANNUAL_DISCOUNT_RATE * 100}% no valor fixo</span></button></div>
    <div className="v2-plan-grid">{SUBSCRIPTION_PLANS.map(plan => {
      const pricing = getSubscriptionPricing(plan.price);
      const price = yearly ? pricing.annualMonthlyEquivalent : pricing.monthly;
      return <article key={plan.id} className="v2-plan-card" aria-labelledby={`v2-plan-${plan.id}`} data-reveal>
        <h3 id={`v2-plan-${plan.id}`}>{plan.name.replace(/^Kôma /, '')}</h3>
        <p className="v2-plan-price"><strong>{formatCurrency(price)}</strong><span>/{yearly ? 'mês equivalente' : 'mês'}</span></p>
        {yearly && <p className="v2-annual-total">{formatCurrency(pricing.annualTotal)} cobrados por ano</p>}
        <p className="v2-plan-fee"><strong>{formatPercentage(plan.splitFeeRate)}</strong> <span>taxa KÔMA por pedido online pago</span></p>
        <ul>{highlights[plan.id].map(index => <li key={index}>{plan.features[index]}</li>)}</ul>
        <a className="v2-button" href={`/contratar/${plan.id}?cobranca=${yearly ? 'anual' : 'mensal'}`}>Contratar {plan.name.replace(/^Kôma /, '')}</a>
      </article>;
    })}</div>
    <p className="v2-conditions">Sem taxa de implantação e sem módulos avulsos na oferta atual. Nos planos elegíveis, sete dias de teste do componente fixo começam após a implantação essencial. A taxa KÔMA pode incidir em pedidos online pagos elegíveis durante o teste. Custos do provedor de pagamento são separados.{yearly ? ' No anual, o desconto vale apenas para o valor fixo; a taxa KÔMA não muda.' : ''}</p>
    <details className="v2-plan-details"><summary><span className="v2-details-closed">Comparar todos os recursos +</span><span className="v2-details-open">Ocultar comparação −</span></summary><div className="v2-table-scroll" tabIndex={0} aria-label="Comparação de recursos; role horizontalmente para ver todas as colunas"><table><caption>Recursos dos planos KÔMA</caption><thead><tr><th scope="col">Recurso</th><th scope="col">Pocket</th><th scope="col">Pro</th><th scope="col">Premium</th></tr></thead>{categories.map(category => <tbody key={category}><tr><th colSpan={4} scope="rowgroup">{category}</th></tr>{PLAN_COMPARISON_MATRIX.filter(row => row.category === category).map(row => <tr key={`${row.category}-${row.feature}`}><th scope="row">{row.feature}</th><td>{cell(row.pocket)}</td><td>{cell(row.pro)}</td><td>{cell(row.premium)}</td></tr>)}</tbody>)}</table></div></details>
  </div></section>;
}
