import React from 'react';
import { ArrowDownRight, Clock3, RotateCcw, WalletCards } from 'lucide-react';
import {
  formatPlanBadge,
  formatPlanScopeText,
  getFeatureAvailability,
} from '../landingContractAdapter';
import type { SubscriptionFeatureId } from '../../config/subscriptionPlans';

export interface BenefitItem {
  text: string;
  badge?: string;
  feature?: SubscriptionFeatureId;
}

export interface Benefit {
  num: string;
  eyebrow: string;
  title: string;
  description: string;
  items: BenefitItem[];
  result: string;
  icon: typeof WalletCards;
  tone: 'dark' | 'light' | 'green';
}

export const LANDING_BENEFITS: Benefit[] = [
  {
    num: '01',
    eyebrow: 'MAIS CONTROLE',
    title: 'SAIBA ONDE O DINHEIRO VAI.',
    description: `Caixa e histórico começam no Pocket. Estoque, financeiro e relatórios completos entram no ${formatPlanScopeText(getFeatureAvailability('inventory'))}.`,
    items: [
      { text: 'CAIXA E HISTÓRICO', badge: 'TODOS OS PLANOS' },
      { text: 'ESTOQUE E FINANCEIRO', feature: 'inventory' },
      { text: 'RELATÓRIOS COMPLETOS', feature: 'advanced_reports' },
    ],
    result: 'DECIDA COM NÚMEROS, NÃO COM ACHISMO.',
    icon: WalletCards,
    tone: 'dark',
  },
  {
    num: '02',
    eyebrow: 'MAIS RETORNO',
    title: 'DÊ MOTIVOS PARA O CLIENTE VOLTAR.',
    description: `Histórico de clientes faz parte da base. Pontos, cashback e cupons são recursos do ${formatPlanScopeText(getFeatureAvailability('loyalty'))}.`,
    items: [
      { text: 'HISTÓRICO DO CLIENTE', badge: 'TODOS OS PLANOS' },
      { text: 'PONTOS E CASHBACK', feature: 'loyalty' },
      { text: 'CUPONS', feature: 'coupons' },
    ],
    result: 'A VENDA TERMINA. O RELACIONAMENTO CONTINUA.',
    icon: RotateCcw,
    tone: 'light',
  },
  {
    num: '03',
    eyebrow: 'MAIS TEMPO',
    title: 'DEIXE O SISTEMA FAZER O REPETITIVO.',
    description: `Equipe com permissões e delivery estão na base. Impressão automática e KDS entram no ${formatPlanScopeText(getFeatureAvailability('printing'))}; app do entregador é ${formatPlanScopeText(getFeatureAvailability('courier_app'))}.`,
    items: [
      { text: 'EQUIPE E DELIVERY', badge: 'TODOS OS PLANOS' },
      { text: 'IMPRESSÃO E KDS', feature: 'printing' },
      { text: 'APP DO ENTREGADOR', feature: 'courier_app' },
    ],
    result: 'MENOS CORRERIA. MAIS TEMPO PARA ATENDER.',
    icon: Clock3,
    tone: 'green',
  },
];

export function resolveBenefitItemLabel(item: BenefitItem): string {
  const badge = item.badge ?? (item.feature ? formatPlanBadge(getFeatureAvailability(item.feature)) : '');
  return badge ? `${item.text} — ${badge}` : item.text;
}

export function Capabilities() {
  return (
    <section className="koma-benefits-section" id="recursos" aria-labelledby="benefits-title">
      <div className="koma-benefits-heading">
        <div>
          <span>05 / MAIS RESULTADO</span>
          <h2 id="benefits-title">MENOS CORRERIA.<br />MAIS CONTROLE.</h2>
        </div>
        <div>
          <p>O Kôma vai além do pedido com recursos de controle e relacionamento que crescem conforme o plano escolhido.</p>
          <a href="#implantacao">VEJA COMO É COMEÇAR <ArrowDownRight size={17} aria-hidden="true" /></a>
        </div>
      </div>

      <div className="koma-benefits-grid">
        {LANDING_BENEFITS.map((benefit) => {
          const Icon = benefit.icon;

          return (
            <article className={`koma-benefit-card koma-benefit-card--${benefit.tone}`} key={benefit.num}>
              <div className="koma-benefit-card-top">
                <span>{benefit.num} / {benefit.eyebrow}</span>
                <Icon size={23} strokeWidth={1.7} aria-hidden="true" />
              </div>
              <h3>{benefit.title}</h3>
              <p>{benefit.description}</p>
              <ul>
                {benefit.items.map((item) => (
                  <li key={item.text}>{resolveBenefitItemLabel(item)}</li>
                ))}
              </ul>
              <strong>{benefit.result}</strong>
            </article>
          );
        })}
      </div>
    </section>
  );
}
