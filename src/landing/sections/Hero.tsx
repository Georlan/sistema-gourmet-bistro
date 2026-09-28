import React from 'react';
import { SUBSCRIPTION_PLANS, formatCurrency } from '../../config/subscriptionPlans';

const entryPrice = Math.min(...SUBSCRIPTION_PLANS.map(plan => plan.price));
export function Hero() {
  return <section className="v2-hero" aria-labelledby="hero-title">
    <div className="v2-wrap v2-hero-grid">
      <div className="v2-hero-copy" data-reveal>
        <p className="v2-eyebrow">Sistema para restaurantes</p>
        <h1 id="hero-title">Pedidos, cozinha e caixa. <em>Um só fluxo.</em></h1>
        <p className="v2-lead">Salão, balcão, retirada e delivery acompanham a mesma operação, do pedido ao fechamento.</p>
        <div className="v2-actions"><a className="v2-button" href="#planos">Ver planos</a><a className="v2-text-link" href="#como-funciona">Ver o produto <span aria-hidden="true">↗</span></a></div>
        <p className="v2-hero-price">Planos a partir de <strong>{formatCurrency(entryPrice)}/mês</strong>. Taxa KÔMA por pedido online pago conforme o plano.</p>
      </div>
      <figure className="v2-hero-visual" data-reveal>
        <div className="v2-laptop"><div className="v2-laptop-screen"><img src="/landing-v2/pedidos.webp" alt="Tela real de Pedidos por etapa com mesas em atendimento, pedidos digitais e itens prontos" width="1610" height="440" fetchPriority="high" /></div><div className="v2-laptop-base" aria-hidden="true" /></div>
        <figcaption>Pedidos por etapa · prévia com dados de demonstração</figcaption>
      </figure>
    </div>
  </section>;
}
