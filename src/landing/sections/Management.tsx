import React from 'react';
import { ChartNoAxesCombined, ShoppingBag, Workflow } from 'lucide-react';

const GROUPS = [
  {
    num: '01',
    slug: 'vender',
    eyebrow: 'VENDER',
    icon: ShoppingBag,
    title: 'PDV, MESAS E COMANDAS.',
    text: 'Controle mesas e comandas digitais pelo PDV e App do Garçom. Salão, balcão e pedidos online alimentam a mesma operação.',
    features: ['App do Garçom no navegador desde o Pocket', 'Retirada e delivery próprio', 'Cardápio digital com QR Code integrado ao PDV'], 
  },
  {
    num: '02',
    slug: 'operar',
    eyebrow: 'OPERAR',
    icon: Workflow,
    title: 'COZINHA EM SINCRONIA.',
    text: 'A fila de preparo recebe itens e observações na tela. Nos planos Pro e Premium, o KDS organiza a cozinha sem redigitar pedidos.',
    features: ['Fila de preparo na tela em todos os planos', 'KDS e impressão automática no Pro e Premium', 'Status compartilhado pela equipe'],
  },
  {
    num: '03',
    slug: 'controlar',
    eyebrow: 'CONTROLAR',
    icon: ChartNoAxesCombined,
    title: 'SAIBA COMO SEU NEGÓCIO VAI.',
    text: 'Acompanhe vendas, custos e clientes para decidir com mais clareza.',
    features: ['Caixa e histórico em todos os planos', 'Estoque, relatórios e financeiro no Pro e Premium', 'Fidelidade e cupons no Premium'],
  },
];

export function Management() {
  return (
    <section className="koma-management-section" id="gestao" aria-labelledby="management-title">
      <div className="koma-section-heading koma-section-heading--light">
        <span>02 / O QUE VOCÊ RESOLVE</span>
        <h2 id="management-title">VENDER. OPERAR.<br />CONTROLAR.</h2>
        <p>Sistema de comandas para restaurantes, cardápio digital integrado ao PDV e delivery próprio no mesmo fluxo. Estoque e relatórios nos planos Pro e Premium.</p>
      </div>

      <div className="koma-management-grid">
        {GROUPS.map((group) => {
          const Icon = group.icon;

          return (
          <article className={`koma-management-card koma-management-card--${group.slug}`} key={group.num}>
            <div className="koma-management-card-top">
              <span>{group.num} / {group.eyebrow}</span>
              <i aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></i>
            </div>
            <h3>{group.title}</h3>
            <p>{group.text}</p>
            <ul>
              {group.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
          </article>
          );
        })}
      </div>
    </section>
  );
}
